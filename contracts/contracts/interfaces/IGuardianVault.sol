// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─────────────────────────────────────────────────────────────────────────────
// IGuardianVault — Interface for the cross-chain guardian collateral vault
//
// The GuardianVault monitors positions using Chainlink Data Feeds. When a
// position's health factor drops below the guardian threshold (1.2), it
// automatically dispatches a CCIP message to the receiver on the target
// chain to trigger collateral rebalancing.
// ─────────────────────────────────────────────────────────────────────────────
interface IGuardianVault {

  // ─────────────────────────────────────────────────────────────────────
  // Structs
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice Tracks a user's collateral position in the vault.
   * @dev collateralToken == address(0) means native ETH collateral.
   */
  struct VaultPosition {
    address collateralToken;     // address(0) = native ETH
    uint256 collateralAmount;    // in token's native decimals (wei for ETH)
    uint256 debtAmount;          // in USD, 1e18 precision
    uint64  lastHealthCheck;     // block.timestamp of last HF computation
    uint64  lastGuardianTrigger; // block.timestamp of last CCIP guardian dispatch
  }

  // ─────────────────────────────────────────────────────────────────────
  // Events
  // ─────────────────────────────────────────────────────────────────────

  /// @notice Emitted when a user deposits collateral into the vault.
  event CollateralDeposited(
    address indexed user,
    address indexed token,
    uint256         amount
  );

  /// @notice Emitted when a user withdraws collateral from the vault.
  event CollateralWithdrawn(
    address indexed user,
    address indexed token,
    uint256         amount
  );

  /**
   * @notice Emitted when a CCIP guardian action is dispatched.
   * @param user             The user whose position triggered the action.
   * @param destinationChain CCIP chain selector of the target chain.
   * @param messageId        Unique CCIP message identifier.
   */
  event GuardianActionTriggered(
    address indexed user,
    uint64  indexed destinationChain,
    bytes32         messageId
  );

  /// @notice Emitted when a health factor is computed and cached.
  event HealthFactorUpdated(address indexed user, uint256 healthFactor);

  /// @notice Emitted when a destination chain is added or removed.
  event DestinationChainUpdated(uint64 indexed chainSelector, bool allowed, address receiver);

  /// @notice Emitted when excess CCIP fee ETH is stored for the caller to pull.
  /// @dev Using pull-over-push to avoid guardian actions failing if caller has no receive().
  event RefundPending(address indexed caller, uint256 amount);

  /// @notice Emitted when a trusted lender is added or removed.
  event TrustedLenderUpdated(address indexed lender, bool trusted);

  // ─────────────────────────────────────────────────────────────────────
  // Errors
  // ─────────────────────────────────────────────────────────────────────

  /// @notice Withdrawal would leave position below minimum health factor.
  error InsufficientCollateral(address user, uint256 available, uint256 required);

  /// @notice Health factor is already below guardian threshold — cannot borrow more.
  error HealthFactorTooLow(address user, uint256 healthFactor, uint256 minimum);

  /// @notice Caller is not authorised for this operation.
  error UnauthorizedCaller();

  /// @notice Destination chain selector is not in the allowed set.
  error InvalidChainSelector(uint64 chainSelector);

  /// @notice ETH value sent doesn't match the deposit amount.
  error EthAmountMismatch(uint256 sent, uint256 expected);

  /// @notice ERC20 token is not supported as collateral.
  error UnsupportedToken(address token);

  /// @notice Caller has no pending ETH refund to withdraw.
  error NoRefundPending();

  /// @notice Position health factor is above the guardian threshold — action not needed.
  error PositionHealthy(address user, uint256 healthFactor, uint256 minimum);

  /// @notice msg.value is insufficient to cover the CCIP fee.
  error InsufficientFeeProvided(uint256 sent, uint256 required);

  /// @notice Guardian was triggered too recently — cooldown has not elapsed.
  error GuardianCooldownActive(address user, uint64 cooldownEndsAt);

  // ─────────────────────────────────────────────────────────────────────
  // State-changing functions
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice Deposits collateral into the vault.
   * @dev For ETH: pass token=address(0), amount=msg.value.
   *      For ERC20: approve this contract first, then call with token and amount.
   * @param token  Collateral token address. address(0) = native ETH.
   * @param amount Amount in token's native units (msg.value for ETH).
   */
  function depositCollateral(address token, uint256 amount) external payable;

  /**
   * @notice Withdraws collateral. Reverts if resulting HF < minimum.
   * @param token  Collateral token address. address(0) = native ETH.
   * @param amount Amount to withdraw in token's native units.
   */
  function withdrawCollateral(address token, uint256 amount) external;

  /**
   * @notice Sets the outstanding debt for a user's position.
   * @dev Only callable by trusted lenders registered via setTrustedLender().
   *      Prevents users from self-reporting a zero debt to make their HF appear infinite.
   * @param user          Position owner address.
   * @param debtAmountUSD Total outstanding debt in USD (1e18 precision).
   */
  function setDebtAmount(address user, uint256 debtAmountUSD) external;

  /**
   * @notice Registers or deregisters a trusted lender allowed to report debt amounts.
   * @dev Only callable by owner. Trusted lenders are protocol adapters for
   *      Aave, Morpho, Compound — not end users.
   * @param lender  Contract address to trust or revoke.
   * @param trusted True to allow, false to disallow.
   */
  function setTrustedLender(address lender, bool trusted) external;

  /**
   * @notice Dispatches a CCIP guardian action for a user's position.
   * @dev Called by automation (Chainlink Automation or keeper) when HF drops.
   *      Validates that the position is actually below the guardian threshold.
   * @param user             Address of the position owner.
   * @param destinationChain CCIP chain selector of the target chain.
   */
  function triggerGuardianAction(address user, uint64 destinationChain) external payable;

  /**
   * @notice Withdraws any excess CCIP fee ETH owed to the caller.
   * @dev Pull-over-push pattern: excess refunds from triggerGuardianAction are
   *      stored in pendingRefunds[msg.sender] and claimed here instead of being
   *      pushed during the guardian action call. This ensures that automation
   *      bots (which may not have a receive() function) do not get blocked.
   */
  function withdrawRefund() external;

  // ─────────────────────────────────────────────────────────────────────
  // View functions
  // ─────────────────────────────────────────────────────────────────────

  /**
   * @notice Computes and returns the current health factor for a user's position.
   * @dev Uses Chainlink Data Feed for live price. Result in 1e18 precision.
   *      1e18 = HF of 1.0. Below 1e18 = liquidatable.
   * @param user Address to query.
   * @return healthFactor Current HF in 1e18 precision.
   */
  function getHealthFactor(address user) external view returns (uint256 healthFactor);

  /**
   * @notice Returns the vault position for a user.
   * @param user Address to query.
   */
  function getVaultPosition(address user) external view returns (VaultPosition memory);
}
