// ============================================================
// ConfidentialGuard Protocol — Debt Serviceability Score
// risk-engine/src/debt-serviceability.ts
//
// Translates TradFi cash-flow data from Plaid into a 0–100
// Debt Serviceability Score (DSS) that the Credit Score
// aggregator combines with the Unified Health Factor and
// Contagion Risk Score to assign a credit tier.
//
// ── What "Debt Serviceability" Means ─────────────────────────
//
// In TradFi credit analysis, debt serviceability answers:
//   "Can this counterparty service their existing obligations
//    without distress, and how much capacity do they have
//    to take on additional debt?"
//
// The gold standard metric is Debt Service Coverage Ratio
// (DSCR = net income / debt payments). However, the Plaid
// sandbox API exposes balance sheet data, not income streams.
// We therefore approximate serviceability from three balance-
// sheet proxies that are robustly supported by the API:
//
//   1. Credit Utilization Rate  (weight: 40%)
//      How much of their approved credit are they drawing?
//      Low utilization → disciplined borrower, capacity available.
//      Breakpoints mirror FICO/VantageScore bureau thresholds.
//
//   2. Liquidity Buffer Ratio   (weight: 35%)
//      Liquid assets (checking/savings) relative to outstanding
//      credit obligations. High buffer → can absorb shocks.
//      Exceptional threshold: 3× liquid vs outstanding debt.
//
//   3. Debt Load Ratio          (weight: 25%)
//      Outstanding debt as a fraction of total financial picture
//      (liquid assets + total credit facility).
//      Measures structural leverage of the entire balance sheet.
//
// ── Score Interpretation ──────────────────────────────────────
//
//   > 90  Tier 1 eligible: institutional-grade cash management
//   > 75  Tier 2 eligible: strong, disciplined borrower
//   > 60  Tier 3 eligible: adequate, some capacity constraints
//   > 40  Tier 4 eligible: showing strain, limited capacity
//   ≤ 40  Tier 5: no new credit, serviceability at risk
//
// ── Null / No-Data Handling ───────────────────────────────────
//
// null input → NEUTRAL_DSS (50). No TradFi data available.
// We do not penalize an institution for not connecting Plaid;
// we simply cannot reward them with a TradFi premium either.
//
// All-zero PlaidData (connected but no accounts) → NEUTRAL_DSS.
// An empty Plaid connection tells us nothing actionable.
//
// ── Weights Rationale ─────────────────────────────────────────
//
// Credit utilization carries the most weight (40%) because it
// is the most direct signal of discipline and available capacity
// — the same weighting used in FICO Score composition.
//
// Liquidity buffer (35%) matters more than debt load because it
// predicts short-term shock absorption ability, which is the
// primary risk in institutional DeFi lending.
//
// Debt load (25%) captures structural leverage that the other
// two metrics can miss (e.g. high limit, low utilization, but
// a very small balance sheet overall).
//
// Zero external dependencies. Pure TypeScript. No `any`.
// Runs inside TEE enclave — no I/O, no side effects.
// ============================================================

import { DSS_MAX, NEUTRAL_DSS, type PlaidData } from './types'

// ============================================================
// CONSTANTS — NO MAGIC NUMBERS
// ============================================================

/**
 * Credit utilization thresholds.
 * Mirror FICO Score bureau breakpoints used by major credit bureaus.
 */
const UTILIZATION_EXCELLENT_CEILING = 0.30 // 0–30% → excellent
const UTILIZATION_GOOD_CEILING = 0.50      // 30–50% → good
const UTILIZATION_FAIR_CEILING = 0.75      // 50–75% → fair
// > 75% → poor range

/**
 * Utilization sub-score at each breakpoint boundary.
 * Scores interpolate linearly between these values per segment.
 */
const UTILIZATION_SCORE_FLOOR_EXCELLENT = 100
const UTILIZATION_SCORE_FLOOR_GOOD = 75
const UTILIZATION_SCORE_FLOOR_FAIR = 40
const UTILIZATION_SCORE_FLOOR_POOR = 10
const UTILIZATION_SCORE_FLOOR_MAXED = 0

/**
 * Liquidity ratio at which the liquidity buffer sub-score is capped.
 * Liquid assets ≥ 3× outstanding credit debt is considered exceptional.
 * Ratios above this do not improve the score further.
 */
const LIQUIDITY_RATIO_EXCEPTIONAL = 3.0

/**
 * Weights for the three DSS components.
 * Must sum to exactly 1.0.
 */
const WEIGHT_CREDIT_UTILIZATION = 0.40
const WEIGHT_LIQUIDITY_BUFFER = 0.35
const WEIGHT_DEBT_LOAD = 0.25

// Compile-time weight validation (evaluated at module load — caught in tests)
const _WEIGHT_SUM =
  WEIGHT_CREDIT_UTILIZATION + WEIGHT_LIQUIDITY_BUFFER + WEIGHT_DEBT_LOAD
// Intentional: _WEIGHT_SUM === 1.0 is verified in the test suite

// ============================================================
// RESULT TYPE
// ============================================================

/**
 * Full Debt Serviceability Score result.
 * Sub-scores are exposed for TEE audit log transparency
 * and for fine-grained unit testing.
 */
export interface DebtServiceability {
  /**
   * Composite score in [0, 100].
   * Weighted combination of the three sub-scores below.
   */
  readonly score: number

  /**
   * Credit utilization sub-score [0, 100].
   * 100 = no credit drawn. 0 = all credit maxed out.
   * Weight: 40%.
   */
  readonly utilizationScore: number

  /**
   * Liquidity buffer sub-score [0, 100].
   * 100 = liquid assets ≥ 3× outstanding debt (or zero debt).
   * 0   = zero liquid assets with outstanding debt.
   * Weight: 35%.
   */
  readonly liquidityBufferScore: number

  /**
   * Debt load sub-score [0, 100].
   * 100 = zero outstanding debt relative to total financial picture.
   * 0   = outstanding debt equals entire balance sheet.
   * Weight: 25%.
   */
  readonly debtLoadScore: number

  /**
   * True when a valid, non-empty PlaidData was provided.
   * False when input was null or contained no usable accounts.
   * Used by credit-score.ts to log data source availability.
   */
  readonly hasPlaidData: boolean
}

// ============================================================
// INTERNAL HELPERS
// ============================================================

/**
 * Linear interpolation between `a` and `b` by fraction `t`.
 * `t` is clamped to [0, 1] before interpolation to guard
 * against floating-point edge values drifting outside range.
 */
function lerp(a: number, b: number, t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return a + (b - a) * clamped
}

/**
 * Maps credit utilization (0–1) to a sub-score (0–100) using
 * a piecewise-linear curve that mirrors bureau scoring breakpoints.
 *
 * Curve shape:
 *   [0%  – 30%]  100 → 75   Excellent: ample remaining capacity
 *   (30% – 50%]   75 → 40   Good: disciplined but less room
 *   (50% – 75%]   40 → 10   Fair: drawing heavily on credit lines
 *   (75% – 100%]  10 →  0   Poor: near or at capacity
 *
 * @param utilization - Credit utilization ratio in [0, 1].
 *   Already clamped to this range by PlaidAdapter.normalize().
 */
function scoreFromUtilization(utilization: number): number {
  if (utilization <= UTILIZATION_EXCELLENT_CEILING) {
    // Excellent band: linearly grade from 100 down to 75 at the 30% ceiling.
    const t = utilization / UTILIZATION_EXCELLENT_CEILING
    return Math.round(lerp(UTILIZATION_SCORE_FLOOR_EXCELLENT, UTILIZATION_SCORE_FLOOR_GOOD, t))
  }

  if (utilization <= UTILIZATION_GOOD_CEILING) {
    // Good band: linearly grade from 75 down to 40 at the 50% ceiling.
    const t = (utilization - UTILIZATION_EXCELLENT_CEILING) /
      (UTILIZATION_GOOD_CEILING - UTILIZATION_EXCELLENT_CEILING)
    return Math.round(lerp(UTILIZATION_SCORE_FLOOR_GOOD, UTILIZATION_SCORE_FLOOR_FAIR, t))
  }

  if (utilization <= UTILIZATION_FAIR_CEILING) {
    // Fair band: linearly grade from 40 down to 10 at the 75% ceiling.
    const t = (utilization - UTILIZATION_GOOD_CEILING) /
      (UTILIZATION_FAIR_CEILING - UTILIZATION_GOOD_CEILING)
    return Math.round(lerp(UTILIZATION_SCORE_FLOOR_FAIR, UTILIZATION_SCORE_FLOOR_POOR, t))
  }

  // Poor band: linearly grade from 10 down to 0 at 100% utilization.
  const t = (utilization - UTILIZATION_FAIR_CEILING) /
    (1.0 - UTILIZATION_FAIR_CEILING)
  return Math.round(lerp(UTILIZATION_SCORE_FLOOR_POOR, UTILIZATION_SCORE_FLOOR_MAXED, t))
}

/**
 * Scores the ratio of liquid assets to outstanding credit debt.
 *
 * Rationale: an institution that holds 3× or more cash relative
 * to its outstanding obligations can absorb significant shocks
 * without distress — this earns the maximum sub-score.
 *
 * Special case: zero outstanding debt → perfect liquidity adequacy
 * regardless of how much cash is held.
 *
 * Score is linearly proportional to the ratio, capped at
 * LIQUIDITY_RATIO_EXCEPTIONAL (3.0). Ratios above 3× do not
 * improve the score further — marginal returns diminish.
 *
 * @param totalLiquidAssetsUSD - Sum of depository available balances.
 * @param totalCreditUsedUSD   - Total outstanding credit debt.
 */
function scoreLiquidityBuffer(
  totalLiquidAssetsUSD: number,
  totalCreditUsedUSD: number,
): number {
  // No outstanding debt — liquidity is definitionally adequate
  if (totalCreditUsedUSD === 0) {
    return DSS_MAX
  }

  const ratio = totalLiquidAssetsUSD / totalCreditUsedUSD

  // Cap at LIQUIDITY_RATIO_EXCEPTIONAL — perfect score above that threshold
  if (ratio >= LIQUIDITY_RATIO_EXCEPTIONAL) {
    return DSS_MAX
  }

  // Proportional score: 0 ratio → 0 points, EXCEPTIONAL ratio → 100 points
  return Math.round((ratio / LIQUIDITY_RATIO_EXCEPTIONAL) * DSS_MAX)
}

/**
 * Scores the overall debt load as a fraction of total balance sheet.
 *
 * `totalWealth` is defined as liquid assets plus total credit facility
 * (not just used credit). This prevents gaming by opening unused lines.
 *
 * A borrower using $1M of a $10M credit line with $3M liquid holds
 * $1M debt / ($3M liquid + $10M facility) = 7.7% debt load → score 92.
 *
 * Special case: zero total wealth → no meaningful picture → neutral score.
 *
 * @param totalLiquidAssetsUSD - Sum of depository available balances.
 * @param totalCreditLimitUSD  - Total credit facility size.
 * @param totalCreditUsedUSD   - Total outstanding credit debt.
 */
function scoreDebtLoad(
  totalLiquidAssetsUSD: number,
  totalCreditLimitUSD: number,
  totalCreditUsedUSD: number,
): number {
  const totalWealth = totalLiquidAssetsUSD + totalCreditLimitUSD

  // No financial picture to evaluate → neutral
  if (totalWealth === 0) {
    return NEUTRAL_DSS
  }

  const debtRatio = totalCreditUsedUSD / totalWealth
  return Math.round((1 - debtRatio) * DSS_MAX)
}

/**
 * Returns true when PlaidData contains at least one piece of
 * actionable financial data — i.e. not a completely empty connection.
 */
function hasUsableData(data: PlaidData): boolean {
  return (
    data.totalLiquidAssetsUSD > 0 ||
    data.totalCreditLimitUSD > 0 ||
    data.totalCreditUsedUSD > 0
  )
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Computes the Debt Serviceability Score (DSS) from Plaid
 * balance sheet data.
 *
 * Returns a neutral DSS of 50 when `data` is null or contains
 * no usable financial information. This represents the absence
 * of TradFi data — not an adverse finding. The neutral score
 * does not prevent eligibility for Tier 3 or 4, but forecloses
 * Tier 1 and Tier 2 which require DSS > 90 and > 75 respectively.
 *
 * When valid data is present, the composite score is:
 *   DSS = round(
 *     utilizationScore × 0.40 +
 *     liquidityBufferScore × 0.35 +
 *     debtLoadScore × 0.25
 *   )
 *
 * The result is clamped to [0, 100] to guard against sub-score
 * interactions producing marginally out-of-range composites.
 *
 * @param data - Normalized PlaidData from PlaidAdapter, or null
 *               when Plaid integration is unavailable.
 */
export function computeDebtServiceability(
  data: PlaidData | null,
): DebtServiceability {
  // Null input: no TradFi data available
  if (data === null) {
    return {
      score: NEUTRAL_DSS,
      utilizationScore: NEUTRAL_DSS,
      liquidityBufferScore: NEUTRAL_DSS,
      debtLoadScore: NEUTRAL_DSS,
      hasPlaidData: false,
    }
  }

  // Connected Plaid but no usable account data
  if (!hasUsableData(data)) {
    return {
      score: NEUTRAL_DSS,
      utilizationScore: NEUTRAL_DSS,
      liquidityBufferScore: NEUTRAL_DSS,
      debtLoadScore: NEUTRAL_DSS,
      hasPlaidData: true,
    }
  }

  const utilizationScore = scoreFromUtilization(data.totalCreditUtilization)

  const liquidityBufferScore = scoreLiquidityBuffer(
    data.totalLiquidAssetsUSD,
    data.totalCreditUsedUSD,
  )

  const debtLoadScore = scoreDebtLoad(
    data.totalLiquidAssetsUSD,
    data.totalCreditLimitUSD,
    data.totalCreditUsedUSD,
  )

  const composite =
    utilizationScore * WEIGHT_CREDIT_UTILIZATION +
    liquidityBufferScore * WEIGHT_LIQUIDITY_BUFFER +
    debtLoadScore * WEIGHT_DEBT_LOAD

  return {
    score: Math.min(DSS_MAX, Math.max(0, Math.round(composite))),
    utilizationScore,
    liquidityBufferScore,
    debtLoadScore,
    hasPlaidData: true,
  }
}
