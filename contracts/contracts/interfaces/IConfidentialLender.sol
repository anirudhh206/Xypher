// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
// IConfidentialLender — Interface for the ConfidentialGuard undercollateralized
// lending primitive.
//
// ARCHITECTURE
// ┌──────────────────────────────────────────────────────────────────────────┐
// │  Borrower wallet          ConfidentialLender        ConfidentialGuard   │
// │  depositCollateral() ──→  checks collateral         attestationRegistry  │
// │  borrow(amount)      ──→  verifyAttestation() ──→  returns (valid, tier)│
// │                           applies tier LTV                               │
// │                           sends ETH to borrower                         │
// │                                                                          │
// │  Lender wallet                                                           │
// │  depositLiquidity()  ──→  funds the borrow pool                         │
// │  withdrawLiquidity() ──→  reclaims ETH + interest                       │
// └──────────────────────────────────────────────────────────────────────────┘
//
// TIER → LTV MAPPING (default configuration)
//   Tier 1 (Institutional) → 90% LTV
//   Tier 2 (Prime)         → 80% LTV
//   Tier 3 (Near-Prime)    → 70% LTV
//   Tier 4 (Subprime)      → 60% LTV
//   Tier 5 (Ineligible)    → REJECTED
//
// Compare: Aave v3 WETH max LTV = 80%, liquidation threshold = 82.5%
// Tier 1 borrowers get 90% LTV — the highest capital efficiency in DeFi,
// made possible only by the ConfidentialGuard credit attestation primitive.
//
// INTEGRATION
//   Any protocol can verify a borrower's position via getPosition() and
//   getHealthFactor(). Any address can provide liquidity via depositLiquidity().
//   Liquidations are permissionless — any keeper can call liquidate().
// ─────────────────────────────────────────────────────────────────────────────

interface IConfidentialLender {

  // ─────────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────────

  /// @notice Emitted when a lender deposits ETH into the pool.
  event LiquidityDeposited(address indexed lender, uint256 amount);

  /// @notice Emitted when a lender withdraws ETH from the pool.
  event LiquidityWithdrawn(address indexed lender, uint256 amount);

  /// @notice Emitted when a borrower deposits ETH collateral.
  event CollateralDeposited(address indexed borrower, uint256 amount);

  /// @notice Emitted when a borrower withdraws ETH collateral.
  event CollateralWithdrawn(address indexed borrower, uint256 amount);

  /**
   * @notice Emitted when a borrower takes a loan.
   * @param borrower The wallet that borrowed.
   * @param amount   ETH borrowed (wei).
   * @param tier     Credit tier used to determine LTV.
   * @param ltvBps   Maximum LTV applied in basis points (e.g. 9000 = 90%).
   */
  event Borrowed(
    address indexed borrower,
    uint256         amount,
    uint8           tier,
    uint256         ltvBps
  );

  /**
   * @notice Emitted when a borrower fully repays their loan.
   * @param borrower  The wallet that repaid.
   * @param principal Principal amount repaid (wei).
   * @param interest  Interest paid (wei).
   */
  event Repaid(
    address indexed borrower,
    uint256         principal,
    uint256         interest
  );

  /**
   * @notice Emitted when a position is liquidated.
   * @param borrower         The wallet whose position was liquidated.
   * @param liquidator       The keeper that triggered liquidation.
   * @param collateralSeized ETH collateral transferred to liquidator (wei).
   * @param debtRepaid       Total debt (principal + interest) repaid (wei).
   */
  event Liquidated(
    address indexed borrower,
    address indexed liquidator,
    uint256         collateralSeized,
    uint256         debtRepaid
  );

  /// @notice Emitted when owner updates the LTV for a credit tier.
  event TierLTVUpdated(uint8 indexed tier, uint256 ltvBps);

  // ─────────────────────────────────────────────────────────────────────────
  // Errors
  // ─────────────────────────────────────────────────────────────────────────

  /// @notice Borrower has no valid ConfidentialGuard attestation or tier is ineligible (tier 5).
  error NoValidAttestation(address borrower);

  /// @notice Requested borrow amount exceeds maximum allowed by borrower's LTV.
  error ExceedsMaxLTV(uint256 requested, uint256 maxAllowed);

  /// @notice Insufficient ETH liquidity in the pool for the requested borrow.
  error InsufficientLiquidity(uint256 available, uint256 requested);

  /// @notice Amount is below the protocol minimum threshold.
  error AmountTooSmall(uint256 amount, uint256 minimum);

  /// @notice Collateral withdrawal would push health factor below liquidation threshold.
  error HealthFactorTooLow(address borrower, uint256 healthFactor);

  /// @notice Position is not eligible for liquidation — health factor is sufficient.
  error PositionHealthy(address borrower, uint256 healthFactor);

  /// @notice Liquidator or repayer did not send enough ETH to cover the debt.
  error InsufficientRepayment(uint256 sent, uint256 required);

  /// @notice No active borrow position exists for this address.
  error NoBorrowPosition(address borrower);

  /// @notice Chainlink ETH/USD price feed data is stale.
  error StalePriceFeed(uint256 updatedAt, uint256 maxAge);

  /// @notice Chainlink price feed returned a zero or negative answer.
  error InvalidPrice(int256 answer);

  /// @notice Proposed LTV exceeds the protocol hard cap of 95%.
  error LTVTooHigh(uint8 tier, uint256 ltvBps);

  /// @notice address(0) passed where a valid address is required.
  error ZeroAddress();

  // ─────────────────────────────────────────────────────────────────────────
  // Lender functions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @notice Deposits ETH into the lending pool to earn interest from borrowers.
   * @dev No attestation required — any address can provide liquidity.
   *      Interest is earned from borrower repayments and accrues to the pool.
   *      Emits LiquidityDeposited.
   */
  function depositLiquidity() external payable;

  /**
   * @notice Withdraws ETH from the lending pool.
   * @dev Reverts if requested amount exceeds available liquidity
   *      (totalLiquidity - totalBorrowed).
   *      Emits LiquidityWithdrawn.
   * @param amount ETH to withdraw (wei).
   */
  function withdrawLiquidity(uint256 amount) external;

  // ─────────────────────────────────────────────────────────────────────────
  // Borrower functions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @notice Deposits ETH collateral to open or increase a borrowing position.
   * @dev Attestation is NOT required to deposit collateral — users can
   *      pre-deposit before receiving their credit attestation.
   *      Attestation is only verified at borrow time.
   *      Emits CollateralDeposited.
   */
  function depositCollateral() external payable;

  /**
   * @notice Withdraws ETH collateral from the borrowing position.
   * @dev Reverts if withdrawal would push health factor below the
   *      liquidation threshold (105%). Safe to call after full repayment.
   *      Emits CollateralWithdrawn.
   * @param amount ETH collateral to withdraw (wei).
   */
  function withdrawCollateral(uint256 amount) external;

  /**
   * @notice Borrows ETH against deposited collateral.
   * @dev THIS IS THE CORE PRIMITIVE — undercollateralized lending in DeFi.
   *
   *      Requires a valid ConfidentialGuard attestation (tier 1–4).
   *      Attestation is verified on EVERY borrow — no stale credit assumptions.
   *
   *      Maximum borrow is determined by tier LTV:
   *        Tier 1 → 90% of collateral USD value
   *        Tier 2 → 80% of collateral USD value
   *        Tier 3 → 70% of collateral USD value
   *        Tier 4 → 60% of collateral USD value
   *
   *      Tier 1 borrowers need only 111% collateral vs 150%+ on Aave —
   *      the highest capital efficiency achievable in DeFi today.
   *
   *      Emits Borrowed.
   *
   * @param amount ETH to borrow (wei). Must be >= MIN_BORROW_AMOUNT.
   */
  function borrow(uint256 amount) external;

  /**
   * @notice Repays all outstanding debt (principal + accrued interest).
   * @dev Full repayment only in v1. Send exact amount or slightly more —
   *      any excess ETH is refunded to the caller.
   *      Interest accrues at ANNUAL_INTEREST_RATE_BPS per year.
   *      Emits Repaid.
   */
  function repay() external payable;

  /**
   * @notice Liquidates an undercollateralised position.
   * @dev Permissionless — any keeper or address can liquidate when HF < 100%.
   *      Liquidator sends ETH to repay the debt and receives collateral
   *      plus a LIQUIDATION_BONUS_BPS (5%) bonus.
   *      Any excess ETH sent is refunded to the liquidator.
   *      Emits Liquidated.
   * @param borrower Address of the position to liquidate.
   */
  function liquidate(address borrower) external payable;

  // ─────────────────────────────────────────────────────────────────────────
  // Admin functions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @notice Updates the maximum LTV for a credit tier.
   * @dev Only owner. Hard cap of 95% (9500 BPS) enforced on-chain.
   *      Emits TierLTVUpdated.
   * @param tier   Credit tier to update (1–5).
   * @param ltvBps New maximum LTV in basis points (e.g. 9000 = 90%).
   */
  function setTierLTV(uint8 tier, uint256 ltvBps) external;

  // ─────────────────────────────────────────────────────────────────────────
  // View functions
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @notice Returns the current health factor for a borrower in BPS.
   * @dev HF > 10500 = safe (above liquidation threshold).
   *      HF < 10000 = liquidatable.
   *      Returns type(uint256).max if no borrow position exists.
   * @param borrower Address to query.
   */
  function getHealthFactor(address borrower) external view returns (uint256);

  /**
   * @notice Returns the maximum ETH a borrower can currently borrow.
   * @dev Returns (0, 0) if no valid attestation exists.
   *      Accounts for existing debt and accrued interest.
   * @param borrower Address to query.
   * @return maxETH Maximum additional ETH borrowable (wei).
   * @return tier   Credit tier of the borrower.
   */
  function getMaxBorrow(address borrower) external view returns (uint256 maxETH, uint8 tier);

  /**
   * @notice Returns the full borrower position including previewed interest.
   * @param borrower Address to query.
   * @return collateral   ETH collateral deposited (wei).
   * @return borrowed     ETH principal borrowed (wei).
   * @return interest     Total accrued + previewed interest (wei).
   * @return tier         Credit tier at time of last borrow.
   * @return healthFactor Current health factor in BPS.
   */
  function getPosition(address borrower) external view returns (
    uint256 collateral,
    uint256 borrowed,
    uint256 interest,
    uint8   tier,
    uint256 healthFactor
  );

  /**
   * @notice Returns current pool utilisation statistics.
   * @return liquidity      Total ETH in the pool (wei).
   * @return borrowed       Total ETH currently borrowed (wei).
   * @return available      ETH available to borrow (wei).
   * @return utilisationBps Pool utilisation in basis points (e.g. 7500 = 75%).
   */
  function getPoolStats() external view returns (
    uint256 liquidity,
    uint256 borrowed,
    uint256 available,
    uint256 utilisationBps
  );
}
