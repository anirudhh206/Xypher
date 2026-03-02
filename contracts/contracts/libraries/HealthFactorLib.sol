// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

// ─────────────────────────────────────────────────────────────────────────────
// HealthFactorLib — On-chain health factor computation via Chainlink Data Feeds
//
// PURPOSE
// This library handles the on-chain safety check layer only. The full risk
// engine (UHF, contagion model, debt serviceability, credit tier) runs in the
// Chainlink TEE off-chain. HealthFactorLib exists for two purposes:
//   1. GuardianVault: detect when HF drops below the guardian threshold (1.2)
//      to trigger CCIP cross-chain rebalancing.
//   2. On-chain lender verification: confirm that a borrower's position is
//      above the minimum health factor before issuing undercollateralised credit.
//
// FORMULA
//   adjustedCollateralUSD = collateralUSD × (liquidationThresholdBps / 10_000)
//   healthFactor          = adjustedCollateralUSD × 1e18 / debtUSD
//
// All values returned in 1e18 precision (1e18 = HF of 1.0).
// ─────────────────────────────────────────────────────────────────────────────
library HealthFactorLib {

  // ── Constants ─────────────────────────────────────────────────────────────

  /// @notice 1e18 — standard precision unit for health factor values.
  uint256 internal constant PRECISION = 1e18;

  /// @notice Basis point denominator (10,000 bps = 100%).
  uint256 internal constant BASIS_POINTS = 10_000;

  /// @notice HF below this → position is liquidatable. 1e18 = 1.0 HF.
  uint256 internal constant LIQUIDATION_HF_MIN = 1e18;

  /// @notice HF below this → guardian automation should trigger. 1.2 in 1e18.
  uint256 internal constant GUARDIAN_HF_MIN = 12e17;

  /// @notice Default price feed staleness limit used by GuardianVault: 1 hour.
  uint256 internal constant DEFAULT_MAX_AGE = 3_600;

  // ── Errors ────────────────────────────────────────────────────────────────

  /// @notice Feed returned a price older than maxAge.
  error StalePrice(address feed, uint256 updatedAt, uint256 blockTimestamp);

  /// @notice Feed returned a zero or negative price (impossible in a healthy feed).
  error NegativePrice(address feed, int256 price);

  /// @notice debtUSD == 0 was passed to computeHealthFactor.
  error ZeroDebt();

  // ── Functions ─────────────────────────────────────────────────────────────

  /**
   * @notice Fetches the latest price from a Chainlink Data Feed.
   * @dev Validates staleness and non-negative price. Staleness check is
   *      skipped when maxAge == 0 (use only in tests or if you have an
   *      external staleness oracle).
   *
   *      Security: always use maxAge in production. A stale price feed
   *      can silently understate collateral value, allowing under-collateralised
   *      positions to appear healthy.
   *
   * @param feed   AggregatorV3Interface — the Chainlink Data Feed contract.
   * @param maxAge Maximum acceptable price age in seconds. 0 = skip check.
   * @return price    Raw price from the feed (in feed's native decimals).
   * @return decimals Feed precision (use normalisePrice to convert to 1e18).
   */
  function getPrice(
    AggregatorV3Interface feed,
    uint256 maxAge
  ) internal view returns (uint256 price, uint8 decimals) {
    (
      /* roundId */,
      int256  answer,
      /* startedAt */,
      uint256 updatedAt,
      /* answeredInRound */
    ) = feed.latestRoundData();

    if (answer <= 0) revert NegativePrice(address(feed), answer);
    if (maxAge > 0 && block.timestamp - updatedAt > maxAge) {
      revert StalePrice(address(feed), updatedAt, block.timestamp);
    }

    price    = uint256(answer);
    decimals = feed.decimals();
  }

  /**
   * @notice Normalises a raw feed price to 1e18 precision.
   * @dev Most Chainlink feeds return 8 decimals (USD pairs) or 18 decimals.
   *      Scales up or down as needed. Safe for all realistic feed decimal counts.
   * @param price        Raw price from feed.latestRoundData().
   * @param feedDecimals feed.decimals().
   * @return Normalised price in 1e18 precision.
   */
  function normalisePrice(
    uint256 price,
    uint8   feedDecimals
  ) internal pure returns (uint256) {
    if (feedDecimals < 18) {
      return price * (10 ** uint256(18 - feedDecimals));
    } else if (feedDecimals > 18) {
      return price / (10 ** uint256(feedDecimals - 18));
    }
    return price;
  }

  /**
   * @notice Computes the health factor for a single-asset position.
   * @dev Full formula:
   *        collateralUSD  = normalised(collateralAmount) × collateralPriceUSD / 1e18
   *        adjustedColl   = collateralUSD × liquidationThresholdBps / 10_000
   *        healthFactor   = adjustedColl × 1e18 / debtUSD
   *
   *      For ETH (18 decimals), normalisation is a no-op.
   *      For USDC (6 decimals), normalisation multiplies by 1e12.
   *
   * @param collateralAmount         Collateral in token's native decimals.
   * @param collateralDecimals       Token decimals (18 for ETH, 6 for USDC, etc.).
   * @param collateralPriceUSD       Collateral price in 1e18 (use normalisePrice first).
   * @param liquidationThresholdBps  Liquidation threshold in basis points (8250 = 82.5%).
   * @param debtUSD                  Total debt in USD, 1e18 precision. Must be > 0.
   * @return healthFactor HF in 1e18 precision. 1e18 = exactly HF 1.0.
   */
  function computeHealthFactor(
    uint256 collateralAmount,
    uint8   collateralDecimals,
    uint256 collateralPriceUSD,
    uint256 liquidationThresholdBps,
    uint256 debtUSD
  ) internal pure returns (uint256 healthFactor) {
    if (debtUSD == 0) revert ZeroDebt();

    // Step 1: Normalise collateral to 1e18 precision.
    uint256 normalisedCollateral;
    if (collateralDecimals < 18) {
      normalisedCollateral = collateralAmount * (10 ** uint256(18 - collateralDecimals));
    } else if (collateralDecimals > 18) {
      normalisedCollateral = collateralAmount / (10 ** uint256(collateralDecimals - 18));
    } else {
      normalisedCollateral = collateralAmount;
    }

    // Step 2: collateralUSD = normalisedCollateral × price / 1e18
    // Both normalisedCollateral and collateralPriceUSD are in 1e18 → divide by 1e18.
    uint256 collateralUSD = (normalisedCollateral * collateralPriceUSD) / PRECISION;

    // Step 3: Apply liquidation threshold.
    uint256 adjustedCollateral = (collateralUSD * liquidationThresholdBps) / BASIS_POINTS;

    // Step 4: HF = adjustedCollateral × 1e18 / debtUSD (result in 1e18).
    healthFactor = (adjustedCollateral * PRECISION) / debtUSD;
  }

  /**
   * @notice Returns true if a position's HF is below the liquidation threshold.
   * @dev Uses strict inequality: HF == 1e18 is NOT liquidatable.
   * @param healthFactor HF in 1e18 precision.
   */
  function isLiquidatable(uint256 healthFactor) internal pure returns (bool) {
    return healthFactor < LIQUIDATION_HF_MIN;
  }

  /**
   * @notice Returns true if guardian automation should act on this position.
   * @dev Guardian threshold (1.2) is more conservative than liquidation (1.0),
   *      giving time to rebalance before the position becomes liquidatable.
   * @param healthFactor HF in 1e18 precision.
   */
  function needsGuardianAction(uint256 healthFactor) internal pure returns (bool) {
    return healthFactor < GUARDIAN_HF_MIN;
  }
}
