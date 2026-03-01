
// UHF solves this. It uses the same formula as Aave's health
// factor but applied to the entire cross-chain, cross-protocol
// position set:
//
//   UHF = Σ(collateral_i × price_i × liqThreshold_i)
//         ─────────────────────────────────────────────
//                  Σ(debt_j × price_j)
//
// ── Arithmetic Model ──────────────────────────────────────────
//
// All intermediate values use bigint to eliminate floating
// point rounding errors from financial calculations.
//
// Price representation: 1 USD = WEI_PER_TOKEN (1e18).
//   ETH at $3,000 → 3_000 × 1e18 = 3_000_000_000_000_000_000_000n
//
// Collateral USD value (in 1e18-scaled USD):
//   collateralUSD = collateralAmount × price / WEI_PER_TOKEN
//
// Liquidation adjustment (4 basis-point precision):
//   adjustedCollateral = collateralUSD × round(threshold × 10_000) / 10_000n
//
// Final conversion to Number:
//   UHF = Number(totalAdjustedCollateral) / Number(totalDebt)
//   Both are in the same 1e18-scaled USD unit, so the ratio
//   is dimensionless and safe to express as a float.
//
// ── Missing Price Handling ────────────────────────────────────
//
// If a position's price is absent from the PriceMap:
//   - Collateral contribution → 0 (no value without a price)
//   - Debt contribution → counted at face value (conservative)
// This ensures missing prices always reduce UHF, never inflate it.
// The CRE workflow must include prices for all assets in positions.
// CANONICAL_USD_ASSET should always be in the PriceMap at WEI_PER_TOKEN.
//
// Zero external dependencies. Pure TypeScript. No `any`.
// Runs inside TEE enclave — no I/O, no side effects.
// ============================================================

import {
  CANONICAL_USD_ASSET,
  WEI_PER_TOKEN,
  type PositionData,
  type PriceMap,
} from './types'

// ============================================================
// PRECISION CONSTANTS
// ============================================================

/**
 * Basis points multiplier for liquidation threshold conversion.
 * Converts a fraction (0.825) to basis points (8250) for bigint math.
 * 4 decimal places covers all known protocol liquidation thresholds.
 */
const LIQUIDATION_THRESHOLD_PRECISION = 10_000
const LIQUIDATION_THRESHOLD_PRECISION_BIG = 10_000n

/**
 * Sentinel value returned when a portfolio has no debt.
 * Mathematically correct: a position with collateral but zero debt
 * has infinite margin of safety.
 */
export const INFINITE_HEALTH_FACTOR = Infinity

// ============================================================
// PRICE LOOKUP
// Resolves a token price from the PriceMap with a defined
// fallback for missing entries.
//
// With noUncheckedIndexedAccess: true, PriceMap access returns
// bigint | undefined. Missing prices → 0n (conservative fallback).
// ============================================================

function resolvePrice(prices: PriceMap, asset: string): bigint {
  // Always normalise to lowercase before any lookup or comparison.
  // Prevents consensus failures when one API returns a checksummed
  // address (0xABC...) while another returns lowercase (0xabc...).
  // Both must resolve identically inside the TEE — the comparison
  // branch must be deterministic regardless of input casing.
  const target = asset.toLowerCase()

  // CANONICAL_USD_ASSET is always $1.00 — inject if absent from map
  if (target === CANONICAL_USD_ASSET) {
    return prices[CANONICAL_USD_ASSET] ?? WEI_PER_TOKEN
  }

  return prices[target] ?? 0n
}

// ============================================================
// LIQUIDATION THRESHOLD → BASIS POINTS
//
// Converts a fractional liquidation threshold (e.g. 0.825) to
// an integer basis-point value (8250) for safe bigint arithmetic.
//
// Uses Math.round (not Math.floor) to handle IEEE 754 edge cases:
//   0.77 * 10_000 = 7699.999... → Math.floor gives 7699 (wrong)
//                                → Math.round gives 7700 (correct)
// ============================================================

function thresholdToBasisPoints(threshold: number): bigint {
  return BigInt(Math.round(threshold * LIQUIDATION_THRESHOLD_PRECISION))
}

// ============================================================
// CORE VALUE COMPUTATION HELPERS
// ============================================================

/**
 * Computes the USD value of a position's collateral in 1e18-scaled
 * bigint. Returns 0 if the price is missing from the PriceMap.
 */
function computeCollateralUSD(position: PositionData, prices: PriceMap): bigint {
  const price = resolvePrice(prices, position.collateralAsset)
  if (price === 0n) return 0n
  return (position.collateralAmount * price) / WEI_PER_TOKEN
}

/**
 * Computes the liquidation-threshold-adjusted collateral value.
 * This is the "effective collateral" — the amount of collateral
 * that absorbs losses before liquidation is triggered.
 *
 * adjustedCollateral = collateralUSD × liqThreshold
 */
function computeAdjustedCollateralUSD(
  position: PositionData,
  prices: PriceMap,
): bigint {
  const collateralUSD = computeCollateralUSD(position, prices)
  const thresholdBps = thresholdToBasisPoints(position.liquidationThreshold)
  return (collateralUSD * thresholdBps) / LIQUIDATION_THRESHOLD_PRECISION_BIG
}

/**
 * Computes the USD value of a position's debt in 1e18-scaled bigint.
 * Uses the debt asset's price from the PriceMap.
 * If the price is missing, uses face value (conservative — treats
 * debt as if it has full USD value even without a price).
 */
function computeDebtUSD(position: PositionData, prices: PriceMap): bigint {
  const price = resolvePrice(prices, position.debtAsset)
  // If debt price is missing, use face value (WEI_PER_TOKEN = $1 per token unit)
  // This is the conservative fallback for unknown debt asset prices
  const effectivePrice = price > 0n ? price : WEI_PER_TOKEN
  return (position.debtAmount * effectivePrice) / WEI_PER_TOKEN
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Computes the Unified Health Factor across all positions.
 *
 * UHF = Σ(adjustedCollateral_i) / Σ(debtUSD_j)
 *
 * where adjustedCollateral_i = collateral_i × price_i × liqThreshold_i
 * and   debtUSD_j             = debt_j × price_j
 *
 * @param positions - All active lending positions across all protocols.
 * @param prices    - PriceMap with 1e18-scaled USD prices.
 *                    Must include CANONICAL_USD_ASSET for Aave positions.
 * @returns UHF as a float. Returns Infinity if total debt is zero.
 *          Values < 1.0 indicate the portfolio is undercollateralized.
 */
export function computeUnifiedHealthFactor(
  positions: readonly PositionData[],
  prices: PriceMap,
): number {
  if (positions.length === 0) return INFINITE_HEALTH_FACTOR

  let totalAdjustedCollateralUSD = 0n
  let totalDebtUSD = 0n

  for (const position of positions) {
    totalAdjustedCollateralUSD += computeAdjustedCollateralUSD(position, prices)
    totalDebtUSD += computeDebtUSD(position, prices)
  }

  if (totalDebtUSD === 0n) return INFINITE_HEALTH_FACTOR

  // Both values are in 1e18-scaled USD. Their ratio is dimensionless.
  // Number() conversion is safe: the ratio is a small float (0–∞),
  // and relative precision loss from the conversion cancels in numerator/denominator.
  return Number(totalAdjustedCollateralUSD) / Number(totalDebtUSD)
}

/**
 * Computes the health factor for a single isolated position.
 * Used by the guardian monitor to assess per-market risk.
 *
 * singleHF = (collateral × price × liqThreshold) / (debt × debtPrice)
 *
 * @returns Health factor for this position alone.
 *          Returns Infinity if the position has no debt.
 */
export function computePositionHealthFactor(
  position: PositionData,
  prices: PriceMap,
): number {
  return computeUnifiedHealthFactor([position], prices)
}

/**
 * Returns true if the position is currently eligible for liquidation.
 * A position is liquidatable when its individual health factor < 1.0.
 */
export function isLiquidatable(
  position: PositionData,
  prices: PriceMap,
): boolean {
  if (position.debtAmount === 0n) return false
  return computePositionHealthFactor(position, prices) < 1.0
}

/**
 * Computes total portfolio collateral value in 1e18-scaled USD bigint.
 * This is the RAW collateral value before liquidation threshold adjustment.
 * Use computeUnifiedHealthFactor for liquidation risk assessment.
 */
export function computeTotalCollateralUSD(
  positions: readonly PositionData[],
  prices: PriceMap,
): bigint {
  return positions.reduce(
    (sum, pos) => sum + computeCollateralUSD(pos, prices),
    0n,
  )
}

/**
 * Computes total portfolio debt value in 1e18-scaled USD bigint.
 */
export function computeTotalDebtUSD(
  positions: readonly PositionData[],
  prices: PriceMap,
): bigint {
  return positions.reduce(
    (sum, pos) => sum + computeDebtUSD(pos, prices),
    0n,
  )
}

/**
 * Builds a minimal PriceMap with CANONICAL_USD_ASSET pre-seeded.
 * Convenience helper for tests and TEE workflow price injection.
 *
 * @param tokenPrices - Map of token address (lowercase) → USD price in 1e18.
 */
export function buildPriceMap(
  tokenPrices: Readonly<Record<string, bigint>>,
): PriceMap {
  return {
    ...tokenPrices,
    // CANONICAL_USD_ASSET is always $1.00
    [CANONICAL_USD_ASSET]: WEI_PER_TOKEN,
  }
}
