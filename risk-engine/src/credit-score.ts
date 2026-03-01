// ============================================================
// ConfidentialGuard Protocol — Credit Score Aggregator
// risk-engine/src/credit-score.ts
//
// Combines three independently computed risk dimensions into
// a single Confidential Credit Score (CCS) and assigns a
// credit tier (1–5) that is the ONLY value written on-chain.
//
// ── Three Dimensions ─────────────────────────────────────────
//
//   1. Unified Health Factor (UHF)
//      Cross-chain, cross-protocol collateral health.
//      Measures on-chain solvency. Source: health-factor.ts.
//
//   2. Contagion Risk Score (0–100)
//      Cascade sensitivity to correlated price drawdowns.
//      Models portfolio fragility. Source: contagion-model.ts.
//
//   3. Debt Serviceability Score (0–100)
//      TradFi cash-flow adequacy from Plaid balance data.
//      Models off-chain repayment capacity. Source: debt-serviceability.ts.
//
// ── Tier Assignment — Worst Dimension Wins ───────────────────
//
// Each tier has mandatory minimum thresholds across all three
// dimensions. A portfolio qualifies for a tier ONLY when it
// meets every threshold simultaneously. If any single dimension
// falls short, the tier degrades — regardless of excellence in
// the other two.
//
//   Tier | UHF    | Contagion | DSS | Quality            | Rate
//   ─────|────────|───────────|─────|────────────────────|──────────────
//     1  | > 3.0  | < 20      | > 90| Institutional      | 3–4% undercol
//     2  | > 2.0  | < 40      | > 75| Strong             | 5–6%
//     3  | > 1.5  | < 60      | > 60| Adequate           | 7–9%
//     4  | > 1.2  | < 75      | > 40| Weak (overcol)     | 10–12%
//     5  | ≤ 1.2  | any       | any | At Risk / no credit| —
//
// This design prevents dimension gaming: a borrower cannot
// compensate for a dangerously low health factor by maintaining
// impeccable Plaid data. Every pillar must stand independently.
//
// ── Why This Is The Intellectual Heart ───────────────────────
//
// This is the point in the system where on-chain cryptographic
// data (UHF), off-chain TradFi data (DSS), and financial
// engineering (contagion model) merge into a single output.
//
// The output — a single integer 1–5 — is all that ever leaves
// the TEE. It encodes maximum information about creditworthiness
// while revealing zero information about the underlying positions,
// balances, or strategies. This is "minimum disclosure" in practice.
//
// Zero external dependencies. Pure TypeScript. No `any`.
// Runs inside TEE enclave — no I/O, no side effects.
// ============================================================

import {
  CONTAGION_THRESHOLD_TIER_1,
  CONTAGION_THRESHOLD_TIER_2,
  CONTAGION_THRESHOLD_TIER_3,
  CONTAGION_THRESHOLD_TIER_4,
  DSS_THRESHOLD_TIER_1,
  DSS_THRESHOLD_TIER_2,
  DSS_THRESHOLD_TIER_3,
  DSS_THRESHOLD_TIER_4,
  HF_ADEQUATE,
  HF_CRITICAL,
  HF_INSTITUTIONAL,
  HF_STRONG,
  HF_WEAK,
  TIER_MAX,
  TIER_MIN,
  type CreditScore,
  type CreditTier,
  type PlaidData,
  type PositionData,
  type PriceMap,
} from './types'
import { computeUnifiedHealthFactor } from './health-factor'
import { computeContagionRisk } from './contagion-model'
import { computeDebtServiceability } from './debt-serviceability'

// ============================================================
// TIER THRESHOLDS
// Structured to allow exhaustive iteration in assignTier().
// Each entry defines the MINIMUM requirements for that tier.
// ============================================================

interface TierRequirement {
  readonly tier: CreditTier
  /** UHF must be strictly greater than this value */
  readonly minUHF: number
  /** Contagion score must be strictly less than this value */
  readonly maxContagion: number
  /** DSS must be strictly greater than this value */
  readonly minDSS: number
}

/**
 * Tier requirements in descending quality order (Tier 1 first).
 * `assignTier()` iterates from the top and returns the first
 * tier whose requirements are fully satisfied.
 *
 * HF_CRITICAL (1.0) is the Tier 5 boundary — positions at or
 * below this are liquidation-eligible and receive no new credit.
 */
const TIER_REQUIREMENTS: readonly TierRequirement[] = [
  {
    tier: 1,
    minUHF: HF_INSTITUTIONAL,      // > 3.0
    maxContagion: CONTAGION_THRESHOLD_TIER_1, // < 20
    minDSS: DSS_THRESHOLD_TIER_1,  // > 90
  },
  {
    tier: 2,
    minUHF: HF_STRONG,             // > 2.0
    maxContagion: CONTAGION_THRESHOLD_TIER_2, // < 40
    minDSS: DSS_THRESHOLD_TIER_2,  // > 75
  },
  {
    tier: 3,
    minUHF: HF_ADEQUATE,           // > 1.5
    maxContagion: CONTAGION_THRESHOLD_TIER_3, // < 60
    minDSS: DSS_THRESHOLD_TIER_3,  // > 60
  },
  {
    tier: 4,
    minUHF: HF_WEAK,               // > 1.2
    maxContagion: CONTAGION_THRESHOLD_TIER_4, // < 75
    minDSS: DSS_THRESHOLD_TIER_4,  // > 40
  },
  // Tier 5 is the fallback — no requirement check needed
] as const

// ============================================================
// TIER ASSIGNMENT — INTERNAL
// ============================================================

/**
 * Assigns a credit tier given the three computed risk dimensions.
 *
 * Algorithm: iterate TIER_REQUIREMENTS from best to worst.
 * Return the first tier where ALL three thresholds are met.
 * Default to Tier 5 (at risk) if no tier's requirements are met.
 *
 * The UHF comparison is strict (>) not (>=) to prevent boundary
 * gaming — a UHF of exactly 3.0 does not qualify for Tier 1.
 * Contagion is strict (<) for the same reason.
 * DSS is strict (>) — exactly 90 does not qualify for Tier 1.
 *
 * @param uhf       - Unified Health Factor (0 to Infinity).
 * @param contagion - Contagion risk score (0–100).
 * @param dss       - Debt Serviceability Score (0–100).
 */
function assignTier(
  uhf: number,
  contagion: number,
  dss: number,
): CreditTier {
  for (const req of TIER_REQUIREMENTS) {
    if (
      uhf > req.minUHF &&
      contagion < req.maxContagion &&
      dss > req.minDSS
    ) {
      return req.tier
    }
  }

  // Tier 5: no tier requirements satisfied, or UHF ≤ HF_CRITICAL
  return TIER_MAX
}

// ============================================================
// RESULT DETAILS TYPE
// ============================================================

/**
 * Detailed breakdown of a credit score computation.
 * Used internally by the CRE workflow for TEE audit logging.
 * Only `CreditScore.tier` leaves the enclave and goes on-chain.
 */
export interface CreditScoreDetails {
  readonly creditScore: CreditScore
  /**
   * True when Plaid data was available and contributed to DSS.
   * False when DSS is the neutral fallback value.
   */
  readonly hasPlaidData: boolean
  /** DSS sub-score breakdown for audit log */
  readonly dssUtilizationScore: number
  readonly dssLiquidityBufferScore: number
  readonly dssDebtLoadScore: number
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Computes the full Confidential Credit Score for a lending portfolio.
 *
 * This is the primary entry point called by the CRE workflow after
 * all data has been ingested. It orchestrates the three risk engine
 * modules and produces the final CreditScore that includes the tier.
 *
 * Execution order:
 *   1. computeUnifiedHealthFactor()  — on-chain risk (bigint precision)
 *   2. computeContagionRisk()        — cascade stress test
 *   3. computeDebtServiceability()   — TradFi cash-flow analysis
 *   4. assignTier()                  — worst-dimension-wins aggregation
 *
 * @param positions - All active lending positions across all protocols.
 * @param prices    - Live PriceMap from Chainlink Data Feeds (TEE).
 * @param plaidData - Normalized Plaid balance data, or null if unavailable.
 * @returns CreditScoreDetails with the full breakdown and the final CreditScore.
 */
export function computeCreditScore(
  positions: readonly PositionData[],
  prices: PriceMap,
  plaidData: PlaidData | null,
): CreditScoreDetails {
  // ── Step 1: On-chain risk ─────────────────────────────────
  const uhf = computeUnifiedHealthFactor(positions, prices)

  // ── Step 2: Cascade stress test ───────────────────────────
  const { score: contagionRiskScore, cascadeThreshold } =
    computeContagionRisk(positions, prices)

  // ── Step 3: TradFi cash-flow analysis ────────────────────
  const dss = computeDebtServiceability(plaidData)

  // ── Step 4: Tier assignment (worst dimension wins) ────────
  const tier = assignTier(uhf, contagionRiskScore, dss.score)

  const creditScore: CreditScore = {
    unifiedHealthFactor: uhf,
    tier,
    debtServiceabilityScore: dss.score,
    contagionRiskScore,
    cascadeThreshold,
  }

  return {
    creditScore,
    hasPlaidData: dss.hasPlaidData,
    dssUtilizationScore: dss.utilizationScore,
    dssLiquidityBufferScore: dss.liquidityBufferScore,
    dssDebtLoadScore: dss.debtLoadScore,
  }
}

/**
 * Returns the credit tier for a pre-computed CreditScore.
 * Convenience accessor used by the guardian monitor when
 * re-evaluating tier from a cached score.
 *
 * This is a pure re-derivation — it does not re-run the full
 * risk engine. Use computeCreditScore() for fresh assessments.
 */
export function getTier(score: CreditScore): CreditTier {
  return assignTier(
    score.unifiedHealthFactor,
    score.contagionRiskScore,
    score.debtServiceabilityScore,
  )
}

/**
 * Returns true when the given tier qualifies for undercollateralized
 * lending (Tier 1, 2, or 3). Tier 4 requires overcollateralized terms.
 * Tier 5 receives no new credit.
 *
 * Used by the frontend lender verification view to gate credit offers.
 */
export function isUndercollateralizedEligible(tier: CreditTier): boolean {
  return tier <= (TIER_MIN + 2) // Tiers 1, 2, 3
}

/**
 * Returns true when the portfolio is in the at-risk zone —
 * UHF below the liquidation threshold regardless of other scores.
 * Guardian monitor uses this to decide whether to trigger CCIP.
 *
 * @param uhf - Unified Health Factor.
 */
export function isAtRisk(uhf: number): boolean {
  return uhf <= HF_CRITICAL
}
