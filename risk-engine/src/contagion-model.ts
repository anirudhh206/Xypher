// ============================================================
// ConfidentialGuard Protocol — Contagion Risk Model
// risk-engine/src/contagion-model.ts
//
// Simulates correlated price shock cascades across 8 scenarios
// to quantify how sensitive a portfolio is to drawdowns in
// the collateral assets backing its debt.
//
// ── Algorithm ─────────────────────────────────────────────────
//
// For each dropFraction in PRICE_DROP_SCENARIOS [5%, 10%, …, 50%]:
//   1. Shock prices: reduce every non-USD asset price by dropFraction
//   2. Recompute UHF with the shocked PriceMap
//   3. If stressedHF < 1.0 → cascade trigger (liquidation eligible)
//
// firstCascadeAt = smallest dropFraction that triggers cascade.
//
// Contagion Score (0–100 integer):
//   No cascade found   → 0                      (cascade-resistant)
//   Baseline UHF < 1.0 → 100                    (already undercollateralized)
//   Otherwise          → round((1 − firstCascadeAt / 0.50) × 100)
//
// Score → Tier boundary mapping (from types.ts constants):
//   score < 20  → eligible for Tier 1 (cascade only at 40–50% drop)
//   score < 40  → eligible for Tier 2 (cascade at 30% drop)
//   score < 60  → eligible for Tier 3 (cascade at 20% drop)
//   score < 75  → eligible for Tier 4 (cascade at 15% drop)
//   score ≥ 75  → Tier 5              (cascade at 10% drop or less)
//
// ── Why USD Is Exempt from Shocks ────────────────────────────
//
// CANONICAL_USD_ASSET prices are held at their baseline value.
// This correctly models a correlated crypto drawdown: ETH/BTC/WBTC
// fall together while USD-denominated debt stays fixed.
// Shocking USD alongside collateral would understate risk by also
// reducing the debt side, producing misleadingly high stressed HFs.
//
// ── Precision ─────────────────────────────────────────────────
//
// Shock multiplier uses 4 basis-point precision:
//   retainBps = round((1 − dropFraction) × 10_000)
//   shockedPrice = price × retainBps / 10_000
//
// This matches the liquidation threshold precision in health-factor.ts
// and eliminates floating-point contamination in the bigint path.
//
// Zero external dependencies. Pure TypeScript. No `any`.
// Runs inside TEE enclave — no I/O, no side effects.
// ============================================================

import {
  CANONICAL_USD_ASSET,
  CONTAGION_SCORE_MAX,
  PRICE_DROP_SCENARIOS,
  type PositionData,
  type PriceDropScenario,
  type PriceMap,
} from './types'
import { computeUnifiedHealthFactor } from './health-factor'

// ============================================================
// CONSTANTS
// ============================================================

/**
 * Largest tested price drop scenario (50%).
 * Denominator that normalises cascade threshold → 0–100 score.
 */
const MAX_DROP_SCENARIO = 0.50

/**
 * UHF below this indicates liquidation eligibility.
 * Must match the definition used across the rest of the engine.
 */
const LIQUIDATION_HF = 1.0

/**
 * Basis-point denominator for the shock multiplier.
 * 30% drop → retain 70.00% → retainBps = 7000 → price × 7000 / 10_000.
 */
const SHOCK_BPS = 10_000n
const SHOCK_BPS_NUMBER = 10_000

// ============================================================
// PRICE SHOCK APPLICATION
// ============================================================

/**
 * Returns a new PriceMap with every non-USD asset price reduced
 * by `dropFraction`. CANONICAL_USD_ASSET is held at its original
 * price — it represents USD, which stays at peg during crypto crashes.
 *
 * The shock multiplier is computed with 4 basis-point precision
 * to keep arithmetic entirely in bigint:
 *   retainBps = Math.round((1 − dropFraction) × 10_000)
 *   shockedPrice = originalPrice × retainBps / 10_000
 *
 * @param prices       - Baseline PriceMap (1e18-scaled USD per token unit).
 * @param dropFraction - Fractional price decrease in [0, 1).
 *                       0.0 = no shock; 0.5 = 50% price drop.
 */
export function applyPriceShock(
  prices: PriceMap,
  dropFraction: number,
): PriceMap {
  const retainBps = BigInt(Math.round((1 - dropFraction) * SHOCK_BPS_NUMBER))

  const shocked: Record<string, bigint> = {}
  for (const [asset, price] of Object.entries(prices)) {
    // USD stays at peg — shocks don't reduce the debt side
    if (asset === CANONICAL_USD_ASSET) {
      shocked[asset] = price
    } else {
      shocked[asset] = (price * retainBps) / SHOCK_BPS
    }
  }

  return shocked as PriceMap
}

// ============================================================
// SCENARIO SIMULATION RESULT
// ============================================================

/**
 * Outcome of applying a single price shock scenario.
 */
export interface ShockResult {
  /** The price drop fraction applied (e.g. 0.20 = 20% drop). */
  readonly dropFraction: PriceDropScenario
  /** UHF recomputed after the price shock. */
  readonly stressedHealthFactor: number
  /** True when stressedHF < 1.0 — portfolio enters liquidation range. */
  readonly isCascade: boolean
}

// ============================================================
// FULL SCENARIO SUITE
// ============================================================

/**
 * Runs all 8 price drop scenarios and returns per-scenario results.
 *
 * The ordered results let the CRE workflow log a complete stress
 * test breakdown for transparency inside the TEE attestation record.
 * Each scenario is independent — order follows PRICE_DROP_SCENARIOS.
 *
 * @param positions - Active lending positions across all protocols.
 * @param prices    - Baseline PriceMap (current market prices).
 */
export function simulatePriceShocks(
  positions: readonly PositionData[],
  prices: PriceMap,
): readonly ShockResult[] {
  return PRICE_DROP_SCENARIOS.map((dropFraction) => {
    const shockedPrices = applyPriceShock(prices, dropFraction)
    const stressedHealthFactor = computeUnifiedHealthFactor(positions, shockedPrices)
    return {
      dropFraction,
      stressedHealthFactor,
      isCascade: stressedHealthFactor < LIQUIDATION_HF,
    }
  })
}

// ============================================================
// CASCADE THRESHOLD
// ============================================================

/**
 * Returns the smallest price drop fraction in PRICE_DROP_SCENARIOS
 * that triggers portfolio liquidation (UHF < 1.0).
 *
 * Scenarios are tested in ascending order [5%, 10%, …, 50%].
 * The first scenario where stressedHF < 1.0 is the cascade threshold.
 *
 * Returns Infinity when no tested scenario causes cascade —
 * indicating the portfolio survives all stress tests.
 *
 * @param positions - Active lending positions.
 * @param prices    - Baseline PriceMap.
 */
export function computeCascadeThreshold(
  positions: readonly PositionData[],
  prices: PriceMap,
): number {
  for (const dropFraction of PRICE_DROP_SCENARIOS) {
    const shockedPrices = applyPriceShock(prices, dropFraction)
    const stressedHF = computeUnifiedHealthFactor(positions, shockedPrices)
    if (stressedHF < LIQUIDATION_HF) {
      return dropFraction
    }
  }
  return Infinity
}

// ============================================================
// CONTAGION RISK RESULT
// ============================================================

/**
 * Contagion risk assessment for a lending portfolio.
 */
export interface ContagionRisk {
  /**
   * Integer score in [0, 100]. Higher = more vulnerable to cascade.
   *   0   = survives all tested scenarios (cascade-resistant)
   *   20  = cascade at 40% drop
   *   40  = cascade at 30% drop
   *   60  = cascade at 20% drop
   *   80  = cascade at 10% drop
   *   90  = cascade at 5% drop
   *   100 = already undercollateralized at current prices
   */
  readonly score: number
  /**
   * Minimum price drop fraction (0–1) that triggers cascade.
   *   Infinity = no tested scenario causes cascade
   *   0        = already undercollateralized at baseline prices
   */
  readonly cascadeThreshold: number
}

// ============================================================
// PUBLIC API — CONTAGION RISK COMPUTATION
// ============================================================

/**
 * Computes the contagion risk score for a lending portfolio.
 *
 * Scoring formula (when a cascade exists):
 *   score = round((1 − firstCascadeAt / 0.50) × 100)
 *
 * This maps cascade sensitivity to a [0, 100] scale anchored to the
 * 50% scenario: a portfolio that survives everything up to a 40% drop
 * scores 20; one that falls at 5% scores 90.
 *
 * Portfolios that survive the full 50% test score 0 — indistinguishable
 * from those that never cascade at all. The `cascadeThreshold` field
 * disambiguates the two cases when needed.
 *
 * @param positions - All active lending positions across all protocols.
 * @param prices    - Current baseline PriceMap (1e18-scaled USD).
 * @returns ContagionRisk with score (0–100) and cascadeThreshold.
 */
export function computeContagionRisk(
  positions: readonly PositionData[],
  prices: PriceMap,
): ContagionRisk {
  // Empty portfolio: no exposure, no contagion
  if (positions.length === 0) {
    return { score: 0, cascadeThreshold: Infinity }
  }

  // Already undercollateralized at current prices → maximum risk
  const baselineHF = computeUnifiedHealthFactor(positions, prices)
  if (baselineHF < LIQUIDATION_HF) {
    return { score: CONTAGION_SCORE_MAX, cascadeThreshold: 0 }
  }

  const cascadeThreshold = computeCascadeThreshold(positions, prices)

  // Portfolio survives all tested scenarios → minimal contagion
  if (cascadeThreshold === Infinity) {
    return { score: 0, cascadeThreshold: Infinity }
  }

  const score = Math.round(
    (1 - cascadeThreshold / MAX_DROP_SCENARIO) * 100,
  )

  return {
    // Math.min guards against floating-point producing a value
    // marginally above CONTAGION_SCORE_MAX due to rounding
    score: Math.min(score, CONTAGION_SCORE_MAX),
    cascadeThreshold,
  }
}
