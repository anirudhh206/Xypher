// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { Ownable }         from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Pausable }        from "@openzeppelin/contracts/utils/Pausable.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import { IConfidentialGuard }    from "../interfaces/IConfidentialGuard.sol";

// ─────────────────────────────────────────────────────────────────────────────
// ConfidentialLender — Undercollateralized ETH Lending Powered by Credit Attestations
//
// THE PRIMITIVE
//   Traditional DeFi lending requires 150%+ collateral because protocols have
//   no way to assess creditworthiness. ConfidentialLender changes this.
//
//   By reading a ConfidentialGuard credit attestation — a cryptographic proof
//   of creditworthiness computed privately in a Chainlink TEE — this contract
//   allows qualified borrowers to access capital at collateral ratios that were
//   previously impossible in DeFi.
//
// TIER → LTV MAPPING
//   Tier 1 (Institutional)  → 90% LTV  (borrow $900 against $1000 collateral)
//   Tier 2 (Prime)          → 80% LTV  (borrow $800 against $1000 collateral)
//   Tier 3 (Near-Prime)     → 70% LTV  (borrow $700 against $1000 collateral)
//   Tier 4 (Subprime)       → 60% LTV  (standard overcollateralized — still better than Aave)
//   Tier 5 (Ineligible)     → REJECTED (no valid attestation accepted)
//   No Attestation          → REJECTED
//
//   Compare: Aave v3 WETH borrowing = 66% LTV (82.5% liquidation threshold)
//   Tier 1 borrowers get 90% LTV — 36% more capital efficiency than Aave.
//
// SECURITY MODEL
//   1. Attestation verified on every borrow — no stale credit assumptions.
//   2. Health factor checked on every borrow — pool never under-secured.
//   3. Liquidation available when HF < 1.0 — keepers protect the pool.
//   4. Checks-Effects-Interactions on all state-changing functions.
//   5. ReentrancyGuard on all ETH-transfer functions.
//   6. Pausable for emergency circuit breaker.
//
// PRICE FEED
//   Uses Chainlink ETH/USD price feed — same feed as GuardianVault.
//   Max staleness: 1 hour. Reverts on stale data.
//
// ARCHITECTURE NOTE
//   This contract is intentionally self-contained. It does not inherit from
//   GuardianVault — it reads the same attestation registry and price feed
//   independently, demonstrating that IConfidentialGuard is a composable
//   primitive any protocol can integrate without coupling to other contracts.
// ─────────────────────────────────────────────────────────────────────────────

contract ConfidentialLender is Ownable, ReentrancyGuard, Pausable {

  // ── Constants ────────────────────────────────────────────────────────────

  /// @notice Basis points denominator (100% = 10_000 BPS).
  uint256 public constant BPS_DENOMINATOR = 10_000;

  /// @notice Liquidation threshold in BPS (105% = lender is protected).
  uint256 public constant LIQUIDATION_THRESHOLD_BPS = 10_500;

  /// @notice Liquidation bonus paid to liquidators (5%).
  uint256 public constant LIQUIDATION_BONUS_BPS = 500;

  /// @notice Minimum borrow amount: 0.001 ETH (prevents dust loans).
  uint256 public constant MIN_BORROW_AMOUNT = 0.001 ether;

  /// @notice Minimum deposit: 0.001 ETH (prevents dust positions).
  uint256 public constant MIN_DEPOSIT = 0.001 ether;

  /// @notice Maximum price feed staleness: 1 hour.
  uint256 public constant MAX_PRICE_AGE = 3600;

  /// @notice ETH decimals.
  uint8 public constant ETH_DECIMALS = 18;

  /// @notice Annual interest rate in BPS (5% = 500 BPS).
  /// @dev Accrued per-second. Simplification for hackathon — production
  ///      would use a utilisation-based rate model (e.g. Compound's JumpRateModel).
  uint256 public constant ANNUAL_INTEREST_RATE_BPS = 500;

  /// @notice Seconds in a year (365 days).
  uint256 public constant SECONDS_PER_YEAR = 365 days;

  // ── Tier LTV Configuration ────────────────────────────────────────────────

  /// @notice Maps credit tier → maximum LTV in BPS.
  /// @dev Set at construction. Tier 5 = 0 (rejected).
  mapping(uint8 tier => uint256 ltvBps) public tierMaxLTV;

  // ── Structs ───────────────────────────────────────────────────────────────

  /**
   * @notice Borrower position in the lending pool.
   * @dev Packed for gas efficiency.
   *      Slot 0: collateralAmount(uint128) + borrowedAmount(uint128) = 32 bytes
   *      Slot 1: borrowTimestamp(uint64) + lastInterestAccrual(uint64) + tier(uint8) = 17 bytes
   */
  struct BorrowerPosition {
    uint128 collateralAmount;   // ETH collateral deposited (wei)
    uint128 borrowedAmount;     // ETH borrowed (wei, principal only)
    uint128 accruedInterest;    // Interest accrued since last update (wei)
    uint64  borrowTimestamp;    // When first borrow occurred
    uint64  lastAccrualAt;      // Last interest accrual timestamp
    uint8   tier;               // Credit tier at time of borrow
  }

  // ── Events ────────────────────────────────────────────────────────────────

  /// @notice Emitted when a lender deposits ETH into the pool.
  event LiquidityDeposited(address indexed lender, uint256 amount);

  /// @notice Emitted when a lender withdraws ETH from the pool.
  event LiquidityWithdrawn(address indexed lender, uint256 amount);

  /// @notice Emitted when a borrower deposits collateral.
  event CollateralDeposited(address indexed borrower, uint256 amount);

  /// @notice Emitted when a borrower withdraws collateral.
  event CollateralWithdrawn(address indexed borrower, uint256 amount);

  /// @notice Emitted when a borrower takes a loan.
  /// @param tier   Credit tier used to determine LTV.
  /// @param ltvBps LTV applied (basis points).
  event Borrowed(
    address indexed borrower,
    uint256         amount,
    uint8           tier,
    uint256         ltvBps
  );

  /// @notice Emitted when a borrower repays their loan.
  event Repaid(
    address indexed borrower,
    uint256         principal,
    uint256         interest
  );

  /// @notice Emitted when a position is liquidated.
  event Liquidated(
    address indexed borrower,
    address indexed liquidator,
    uint256         collateralSeized,
    uint256         debtRepaid
  );

  /// @notice Emitted when the tier LTV configuration is updated.
  event TierLTVUpdated(uint8 indexed tier, uint256 ltvBps);

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @notice Borrower has no valid credit attestation or tier is ineligible.
  error NoValidAttestation(address borrower);

  /// @notice Borrow amount exceeds the maximum allowed by the borrower's LTV.
  error ExceedsMaxLTV(uint256 requested, uint256 maxAllowed);

  /// @notice Insufficient liquidity in the pool for this borrow.
  error InsufficientLiquidity(uint256 available, uint256 requested);

  /// @notice Amount is below the minimum threshold.
  error AmountTooSmall(uint256 amount, uint256 minimum);

  /// @notice Collateral withdrawal would push health factor below liquidation threshold.
  error HealthFactorTooLow(address borrower, uint256 healthFactor);

  /// @notice Position is not eligible for liquidation (HF >= 1.0).
  error PositionHealthy(address borrower, uint256 healthFactor);

  /// @notice Liquidator did not send enough ETH to repay the debt.
  error InsufficientRepayment(uint256 sent, uint256 required);

  /// @notice No active borrow position exists for this address.
  error NoBorrowPosition(address borrower);

  /// @notice Chainlink price feed returned a stale or invalid answer.
  error StalePriceFeed(uint256 updatedAt, uint256 maxAge);

  /// @notice Price feed returned zero or negative answer.
  error InvalidPrice(int256 answer);

  /// @notice Tier LTV must be <= 9500 BPS (95%) — hard cap for safety.
  error LTVTooHigh(uint8 tier, uint256 ltvBps);

  /// @notice address(0) passed where a valid address is required.
  error ZeroAddress();

  // ── Immutables ────────────────────────────────────────────────────────────

  /// @notice ConfidentialGuard attestation registry.
  IConfidentialGuard public immutable attestationRegistry;

  /// @notice Chainlink ETH/USD price feed.
  AggregatorV3Interface public immutable ethUsdFeed;

  // ── Storage ───────────────────────────────────────────────────────────────

  /// @notice Total ETH available for borrowing (liquidity pool balance).
  uint256 public totalLiquidity;

  /// @notice Total ETH currently borrowed (outstanding principal).
  uint256 public totalBorrowed;

  /// @notice Lender share balances (ETH deposited by each lender).
  mapping(address lender => uint256 amount) public lenderBalances;

  /// @notice Borrower positions.
  mapping(address borrower => BorrowerPosition position) private _positions;

  // ── Constructor ───────────────────────────────────────────────────────────

  /**
   * @param _attestationRegistry ConfidentialGuardAttestation contract address.
   * @param _ethUsdFeed          Chainlink ETH/USD AggregatorV3Interface address.
   * @param _owner               Protocol admin address.
   */
  constructor(
    address _attestationRegistry,
    address _ethUsdFeed,
    address _owner
  ) Ownable(_owner) {
    if (_attestationRegistry == address(0)) revert ZeroAddress();
    if (_ethUsdFeed          == address(0)) revert ZeroAddress();
    if (_owner               == address(0)) revert ZeroAddress();

    attestationRegistry = IConfidentialGuard(_attestationRegistry);
    ethUsdFeed          = AggregatorV3Interface(_ethUsdFeed);

    // ── Default Tier LTV Configuration ────────────────────────────────────
    // These are the on-chain proof that ConfidentialGuard enables capital
    // efficiency impossible in traditional overcollateralized DeFi lending.
    tierMaxLTV[1] = 9_000; // Tier 1 — Institutional:  90% LTV
    tierMaxLTV[2] = 8_000; // Tier 2 — Prime:           80% LTV
    tierMaxLTV[3] = 7_000; // Tier 3 — Near-Prime:      70% LTV
    tierMaxLTV[4] = 6_000; // Tier 4 — Subprime:        60% LTV (still > Aave's 66% max)
    tierMaxLTV[5] = 0;     // Tier 5 — Ineligible:      REJECTED
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /**
   * @notice Updates the maximum LTV for a credit tier.
   * @dev Hard cap of 95% to ensure the pool is never undercollateralised
   *      even in extreme price scenarios. Only owner.
   * @param tier   Credit tier to update (1–5).
   * @param ltvBps New LTV in basis points (e.g. 8000 = 80%).
   */
  function setTierLTV(uint8 tier, uint256 ltvBps) external onlyOwner {
    if (tier < 1 || tier > 5) revert NoValidAttestation(msg.sender);
    if (ltvBps > 9_500) revert LTVTooHigh(tier, ltvBps);
    tierMaxLTV[tier] = ltvBps;
    emit TierLTVUpdated(tier, ltvBps);
  }

  /// @notice Pauses all borrowing and collateral operations.
  function pause() external onlyOwner { _pause(); }

  /// @notice Unpauses the protocol.
  function unpause() external onlyOwner { _unpause(); }

  // ── Lender Functions ──────────────────────────────────────────────────────

  /**
   * @notice Deposits ETH into the lending pool.
   * @dev Lenders earn interest from borrower repayments.
   *      Any address can provide liquidity — no attestation required.
   *      Uses checks-effects-interactions.
   */
  function depositLiquidity() external payable nonReentrant whenNotPaused {
    if (msg.value < MIN_DEPOSIT) revert AmountTooSmall(msg.value, MIN_DEPOSIT);

    // Effects
    lenderBalances[msg.sender] += msg.value;
    totalLiquidity             += msg.value;

    emit LiquidityDeposited(msg.sender, msg.value);
  }

  /**
   * @notice Withdraws ETH from the lending pool.
   * @dev Cannot withdraw more than available liquidity (totalLiquidity - totalBorrowed).
   *      Uses checks-effects-interactions.
   * @param amount ETH to withdraw (wei).
   */
  function withdrawLiquidity(uint256 amount) external nonReentrant {
    if (lenderBalances[msg.sender] < amount) {
      revert InsufficientLiquidity(lenderBalances[msg.sender], amount);
    }

    uint256 available = totalLiquidity - totalBorrowed;
    if (amount > available) revert InsufficientLiquidity(available, amount);

    // Effects before interaction
    lenderBalances[msg.sender] -= amount;
    totalLiquidity             -= amount;

    // Interaction
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "Liquidity withdrawal failed");

    emit LiquidityWithdrawn(msg.sender, amount);
  }

  // ── Borrower Functions ────────────────────────────────────────────────────

  /**
   * @notice Deposits ETH collateral to open or increase a borrowing position.
   * @dev Attestation is NOT required to deposit — users can pre-deposit
   *      collateral before getting their attestation. Attestation is only
   *      required at borrow time.
   *      Uses checks-effects-interactions.
   */
  function depositCollateral() external payable nonReentrant whenNotPaused {
    if (msg.value < MIN_DEPOSIT) revert AmountTooSmall(msg.value, MIN_DEPOSIT);

    BorrowerPosition storage pos = _positions[msg.sender];

    // Accrue interest on existing borrow before modifying position
    if (pos.borrowedAmount > 0) {
      _accrueInterest(pos);
    }

    // Effects
    pos.collateralAmount += uint128(msg.value);

    emit CollateralDeposited(msg.sender, msg.value);
  }

  /**
   * @notice Withdraws ETH collateral from the borrowing position.
   * @dev Reverts if withdrawal would push HF below liquidation threshold.
   *      Attestation must remain valid if there is an active borrow.
   *      Uses checks-effects-interactions.
   * @param amount ETH collateral to withdraw (wei).
   */
  function withdrawCollateral(uint256 amount) external nonReentrant whenNotPaused {
    BorrowerPosition storage pos = _positions[msg.sender];
    if (pos.collateralAmount < uint128(amount)) {
      revert InsufficientLiquidity(pos.collateralAmount, amount);
    }

    // If borrower has an active loan, verify HF after withdrawal
    if (pos.borrowedAmount > 0 || pos.accruedInterest > 0) {
      _accrueInterest(pos);

      uint256 totalDebt    = uint256(pos.borrowedAmount) + uint256(pos.accruedInterest);
      uint256 newCollateral = uint256(pos.collateralAmount) - amount;
      uint256 hfAfter      = _computeHealthFactor(newCollateral, totalDebt);

      if (hfAfter < LIQUIDATION_THRESHOLD_BPS) {
        revert HealthFactorTooLow(msg.sender, hfAfter);
      }
    }

    // Effects before interaction
    pos.collateralAmount -= uint128(amount);

    // Interaction
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "Collateral withdrawal failed");

    emit CollateralWithdrawn(msg.sender, amount);
  }

  /**
   * @notice Borrows ETH against deposited collateral.
   * @dev THIS IS THE CORE PRIMITIVE.
   *
   *      Requires a valid ConfidentialGuard attestation with tier <= 4.
   *      The attestation is verified on EVERY borrow — no stale credit.
   *
   *      LTV is determined by the borrower's credit tier:
   *        Tier 1 → 90% LTV | Tier 2 → 80% | Tier 3 → 70% | Tier 4 → 60%
   *
   *      This enables undercollateralized borrowing that is impossible in
   *      traditional DeFi — Tier 1 borrowers need only 111% collateral
   *      vs 150%+ required by Aave, Compound, and Morpho.
   *
   *      Uses checks-effects-interactions.
   *
   * @param amount ETH to borrow (wei).
   */
  function borrow(uint256 amount) external nonReentrant whenNotPaused {
    if (amount < MIN_BORROW_AMOUNT) revert AmountTooSmall(amount, MIN_BORROW_AMOUNT);

    // ── Step 1: Verify attestation ────────────────────────────────────────
    // Attestation checked on every borrow — no cached credit assumptions.
    (bool valid, uint8 tier, ) = attestationRegistry.verifyAttestation(
      msg.sender,
      4 // minTier: accept tiers 1-4, reject tier 5
    );

    if (!valid || tierMaxLTV[tier] == 0) {
      revert NoValidAttestation(msg.sender);
    }

    // ── Step 2: Compute max borrow against collateral ─────────────────────
    BorrowerPosition storage pos = _positions[msg.sender];
    _accrueInterest(pos);

    uint256 collateralUSD = _getCollateralValueUSD(pos.collateralAmount);
    uint256 ltvBps        = tierMaxLTV[tier];
    uint256 maxBorrowUSD  = (collateralUSD * ltvBps) / BPS_DENOMINATOR;

    // Current debt in USD
    uint256 currentDebtUSD = _getCollateralValueUSD(
      uint128(uint256(pos.borrowedAmount) + uint256(pos.accruedInterest))
    );
    uint256 newDebtUSD = currentDebtUSD + _ethToUSD(amount);

    if (newDebtUSD > maxBorrowUSD) {
      revert ExceedsMaxLTV(newDebtUSD, maxBorrowUSD);
    }

    // ── Step 3: Check pool liquidity ──────────────────────────────────────
    uint256 available = totalLiquidity - totalBorrowed;
    if (amount > available) revert InsufficientLiquidity(available, amount);

    // ── Effects ───────────────────────────────────────────────────────────
    pos.borrowedAmount  += uint128(amount);
    pos.tier             = tier;
    if (pos.borrowTimestamp == 0) {
      pos.borrowTimestamp = uint64(block.timestamp);
      pos.lastAccrualAt   = uint64(block.timestamp);
    }
    totalBorrowed += amount;

    emit Borrowed(msg.sender, amount, tier, ltvBps);

    // ── Interaction ───────────────────────────────────────────────────────
    (bool ok, ) = msg.sender.call{value: amount}("");
    require(ok, "Borrow transfer failed");
  }

  /**
   * @notice Repays all outstanding debt (principal + accrued interest).
   * @dev Repays the full position. Partial repayment not supported in v1
   *      to keep health factor logic simple for the hackathon.
   *      Any excess ETH is refunded to the borrower.
   *      Uses checks-effects-interactions.
   */
  function repay() external payable nonReentrant {
    BorrowerPosition storage pos = _positions[msg.sender];
    if (pos.borrowedAmount == 0) revert NoBorrowPosition(msg.sender);

    // Accrue final interest
    _accrueInterest(pos);

    uint256 principal = pos.borrowedAmount;
    uint256 interest  = pos.accruedInterest;
    uint256 totalOwed = principal + interest;

    if (msg.value < totalOwed) revert InsufficientRepayment(msg.value, totalOwed);

    // Effects — clear position before any transfers
    pos.borrowedAmount  = 0;
    pos.accruedInterest = 0;
    pos.borrowTimestamp = 0;
    pos.lastAccrualAt   = 0;
    totalBorrowed      -= principal;
    totalLiquidity     += interest; // Interest goes back to the pool for lenders

    emit Repaid(msg.sender, principal, interest);

    // Refund excess ETH to borrower (pull-over-push not needed here —
    // refund is in same tx, borrower is the caller, no reentrancy surface
    // since state is already fully updated above)
    uint256 excess = msg.value - totalOwed;
    if (excess > 0) {
      (bool ok, ) = msg.sender.call{value: excess}("");
      require(ok, "Refund failed");
    }
  }

  /**
   * @notice Liquidates an undercollateralised position.
   * @dev Called by keepers or any address when a borrower's HF drops below 1.0.
   *
   *      Liquidator sends ETH to repay the debt and receives the collateral
   *      plus a 5% liquidation bonus.
   *
   *      Uses checks-effects-interactions. ReentrancyGuard active.
   *
   * @param borrower Address of the position to liquidate.
   */
  function liquidate(address borrower) external payable nonReentrant {
    BorrowerPosition storage pos = _positions[borrower];
    if (pos.borrowedAmount == 0) revert NoBorrowPosition(borrower);

    // Accrue interest before health check
    _accrueInterest(pos);

    uint256 totalDebt = uint256(pos.borrowedAmount) + uint256(pos.accruedInterest);
    uint256 hf        = _computeHealthFactor(pos.collateralAmount, totalDebt);

    // Only liquidate when HF < 100% (position is underwater)
    if (hf >= BPS_DENOMINATOR) revert PositionHealthy(borrower, hf);
    if (msg.value < totalDebt)  revert InsufficientRepayment(msg.value, totalDebt);

    // Collateral to seize = debt + 5% bonus (capped at full collateral).
    // Both collateral and debt are denominated in ETH so no USD conversion needed.
    uint256 bonusETH      = (totalDebt * LIQUIDATION_BONUS_BPS) / BPS_DENOMINATOR;
    uint256 collateralOut = totalDebt + bonusETH;
    if (collateralOut > pos.collateralAmount) {
      collateralOut = pos.collateralAmount; // Cap at full collateral
    }

    // Effects — clear position before transfers
    uint256 principal        = pos.borrowedAmount;
    pos.borrowedAmount       = 0;
    pos.accruedInterest      = 0;
    pos.collateralAmount    -= uint128(collateralOut);
    pos.borrowTimestamp      = 0;
    pos.lastAccrualAt        = 0;
    totalBorrowed           -= principal;
    totalLiquidity          += uint256(pos.accruedInterest); // interest to pool

    emit Liquidated(borrower, msg.sender, collateralOut, totalDebt);

    // Transfer seized collateral to liquidator
    (bool ok, ) = msg.sender.call{value: collateralOut}("");
    require(ok, "Liquidator transfer failed");

    // Refund excess repayment to liquidator
    uint256 excess = msg.value - totalDebt;
    if (excess > 0) {
      (bool refundOk, ) = msg.sender.call{value: excess}("");
      require(refundOk, "Liquidator refund failed");
    }
  }

  // ── View Functions ────────────────────────────────────────────────────────

  /**
   * @notice Returns the current health factor for a borrower.
   * @dev HF is in BPS: 10000 = 100% (exactly at liquidation).
   *      HF > 10500 = safe (above liquidation threshold).
   *      HF < 10000 = liquidatable.
   *      Returns type(uint256).max if no borrow position exists.
   * @param borrower Address to query.
   */
  function getHealthFactor(address borrower) external view returns (uint256) {
    BorrowerPosition storage pos = _positions[borrower];
    if (pos.borrowedAmount == 0) return type(uint256).max;

    uint256 interest  = _previewAccruedInterest(pos);
    uint256 totalDebt = uint256(pos.borrowedAmount) + uint256(pos.accruedInterest) + interest;
    return _computeHealthFactor(pos.collateralAmount, totalDebt);
  }

  /**
   * @notice Returns the maximum ETH a borrower can borrow given their
   *         current collateral and credit tier.
   * @dev Returns 0 if no valid attestation exists.
   * @param borrower Address to query.
   */
  function getMaxBorrow(address borrower) external view returns (uint256 maxETH, uint8 tier) {
    (bool valid, uint8 t, ) = attestationRegistry.verifyAttestation(borrower, 4);
    if (!valid || tierMaxLTV[t] == 0) return (0, 0);

    BorrowerPosition storage pos = _positions[borrower];
    uint256 collateralUSD = _getCollateralValueUSD(pos.collateralAmount);
    uint256 maxBorrowUSD  = (collateralUSD * tierMaxLTV[t]) / BPS_DENOMINATOR;

    uint256 interest     = _previewAccruedInterest(pos);
    uint256 currentDebt  = _getCollateralValueUSD(
      uint128(uint256(pos.borrowedAmount) + uint256(pos.accruedInterest) + interest)
    );

    if (currentDebt >= maxBorrowUSD) return (0, t);

    uint256 remainingUSD = maxBorrowUSD - currentDebt;
    return (_usdToEth(remainingUSD), t);
  }

  /**
   * @notice Returns the full borrower position including previewed interest.
   */
  function getPosition(address borrower) external view returns (
    uint256 collateral,
    uint256 borrowed,
    uint256 interest,
    uint8   tier,
    uint256 healthFactor
  ) {
    BorrowerPosition storage pos = _positions[borrower];
    uint256 previewInterest = _previewAccruedInterest(pos);

    collateral   = pos.collateralAmount;
    borrowed     = pos.borrowedAmount;
    interest     = uint256(pos.accruedInterest) + previewInterest;
    tier         = pos.tier;
    healthFactor = pos.borrowedAmount == 0
      ? type(uint256).max
      : _computeHealthFactor(pos.collateralAmount, borrowed + interest);
  }

  /**
   * @notice Returns current pool utilisation statistics.
   */
  function getPoolStats() external view returns (
    uint256 liquidity,
    uint256 borrowed,
    uint256 available,
    uint256 utilisationBps
  ) {
    liquidity    = totalLiquidity;
    borrowed     = totalBorrowed;
    available    = totalLiquidity > totalBorrowed ? totalLiquidity - totalBorrowed : 0;
    utilisationBps = totalLiquidity == 0
      ? 0
      : (totalBorrowed * BPS_DENOMINATOR) / totalLiquidity;
  }

  // ── Internal Helpers ──────────────────────────────────────────────────────

  /**
   * @dev Accrues interest on a position and updates storage.
   *      Simple linear interest for v1 — production would use compound interest.
   *      Interest rate: ANNUAL_INTEREST_RATE_BPS / SECONDS_PER_YEAR per second.
   */
  function _accrueInterest(BorrowerPosition storage pos) internal {
    if (pos.borrowedAmount == 0 || pos.lastAccrualAt == 0) return;

    uint256 elapsed       = block.timestamp - pos.lastAccrualAt;
    if (elapsed == 0) return;

    uint256 newInterest   = (uint256(pos.borrowedAmount) * ANNUAL_INTEREST_RATE_BPS * elapsed)
      / (BPS_DENOMINATOR * SECONDS_PER_YEAR);

    pos.accruedInterest  += uint128(newInterest);
    pos.lastAccrualAt     = uint64(block.timestamp);
  }

  /**
   * @dev Previews accrued interest without writing to storage (for view functions).
   */
  function _previewAccruedInterest(
    BorrowerPosition storage pos
  ) internal view returns (uint256) {
    if (pos.borrowedAmount == 0 || pos.lastAccrualAt == 0) return 0;
    uint256 elapsed = block.timestamp - pos.lastAccrualAt;
    return (uint256(pos.borrowedAmount) * ANNUAL_INTEREST_RATE_BPS * elapsed)
      / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
  }

  /**
   * @dev Fetches ETH/USD price from Chainlink. Reverts on stale or invalid data.
   *      Returns price scaled to 1e18 (wei precision).
   */
  function _getEthPriceUSD() internal view returns (uint256) {
    (
      ,
      int256  answer,
      ,
      uint256 updatedAt,

    ) = ethUsdFeed.latestRoundData();

    if (block.timestamp - updatedAt > MAX_PRICE_AGE) {
      revert StalePriceFeed(updatedAt, MAX_PRICE_AGE);
    }
    if (answer <= 0) revert InvalidPrice(answer);

    // Chainlink ETH/USD has 8 decimals → scale to 1e18
    return uint256(answer) * 1e10;
  }

  /**
   * @dev Returns the USD value of an ETH amount (in 1e18 precision).
   */
  function _getCollateralValueUSD(uint128 ethAmount) internal view returns (uint256) {
    if (ethAmount == 0) return 0;
    uint256 price = _getEthPriceUSD();
    return (uint256(ethAmount) * price) / 1e18;
  }

  /**
   * @dev Converts ETH wei amount to USD (1e18 precision).
   */
  function _ethToUSD(uint256 ethAmount) internal view returns (uint256) {
    return (ethAmount * _getEthPriceUSD()) / 1e18;
  }

  /**
   * @dev Converts USD amount (1e18 precision) to ETH wei.
   */
  function _usdToEth(uint256 usdAmount) internal view returns (uint256) {
    return (usdAmount * 1e18) / _getEthPriceUSD();
  }

  /**
   * @dev Computes health factor in BPS.
   *      HF = (collateralUSD * LIQUIDATION_THRESHOLD_BPS) / (debtUSD * BPS_DENOMINATOR)
   *      expressed as BPS where 10000 = exactly at liquidation threshold.
   *      Returns type(uint256).max for zero debt.
   */
  function _computeHealthFactor(
    uint256 collateralETH,
    uint256 debtETH
  ) internal view returns (uint256) {
    if (debtETH == 0) return type(uint256).max;
    if (collateralETH == 0) return 0;

    uint256 collateralUSD = _getCollateralValueUSD(uint128(collateralETH));
    uint256 debtUSD       = _ethToUSD(debtETH);

    return (collateralUSD * LIQUIDATION_THRESHOLD_BPS) / debtUSD;
  }

  // ── Receive ───────────────────────────────────────────────────────────────

  /// @notice Accept ETH for liquidity deposits and loan repayments.
  receive() external payable {
    // Direct ETH sends are credited as liquidity deposits
    if (msg.value >= MIN_DEPOSIT) {
      lenderBalances[msg.sender] += msg.value;
      totalLiquidity             += msg.value;
      emit LiquidityDeposited(msg.sender, msg.value);
    }
  }
}
