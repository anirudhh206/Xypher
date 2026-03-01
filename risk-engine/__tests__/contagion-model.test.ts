// ============================================================
// ConfidentialGuard Protocol — Contagion Model Test Suite
// risk-engine/__tests__/contagion-model.test.ts
//
// 100% coverage on contagion-model.ts.
//
// Key invariants verified:
//   1. CANONICAL_USD_ASSET is NEVER shocked (USD stays at peg)
//   2. All non-USD prices are reduced by exactly dropFraction
//   3. Score formula: round((1 − firstCascadeAt / 0.50) × 100)
//   4. Empty positions → no risk (score 0, cascadeThreshold Infinity)
//   5. Already-undercollateralized → maximum risk (score 100)
//
// Expected cascade thresholds derived from:
//   stressedHF = UHF × (1 − dropFraction)
//   (valid when collateral is volatile, debt is USD-denominated)
// ============================================================

import { describe, expect, it } from 'bun:test'
import {
  applyPriceShock,
  computeCascadeThreshold,
  computeContagionRisk,
  simulatePriceShocks,
} from '../src/contagion-model'
import { buildPriceMap } from '../src/health-factor'
import {
  CANONICAL_USD_ASSET,
  PRICE_DROP_SCENARIOS,
  WEI_PER_TOKEN,
  type PositionData,
  type PriceMap,
} from '../src/types'

const ETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
const W = WEI_PER_TOKEN

// CANONICAL_USD_ASSET is always $1.00 and is NEVER affected by applyPriceShock.
// Using it as the debt asset is the correct way to model a DeFi borrower:
// collateral (ETH, WBTC) is volatile; debt (stablecoins) stays at peg.
//
// If USDC were used as the debt asset (with its real token address in the
// price map), applyPriceShock would reduce USDC's price too — causing the
// numerator and denominator to both fall by the same factor and cancelling
// out. UHF would stay constant at every shock level → no cascade ever.
// CANONICAL_USD_ASSET sidesteps this by always resolving to WEI_PER_TOKEN.
const BASE_PRICES: PriceMap = buildPriceMap({ [ETH]: 3_000n * W })

// ── Cascade threshold calculation helpers ─────────────────────
// For single ETH/CANONICAL_USD_ASSET positions:
//   UHF = (collateral × ETH_price × liqThreshold) / (debt × $1)
//   stressedHF at drop d = UHF × (1 - d)
//   (ETH shocked, CANONICAL never shocked → ratio changes)
//   cascade when stressedHF < 1.0 → d > 1 - 1/UHF

function cascadePos(
  collateralAmountEth: bigint,
  debtUSD: bigint,
  liqThreshold = 0.825,
): PositionData {
  return {
    protocol: 'aave',
    chainId: 1,
    collateralAsset: ETH,
    collateralAmount: collateralAmountEth * W,
    debtAsset: CANONICAL_USD_ASSET,   // USD debt — immune to price shocks
    debtAmount: debtUSD * W,
    liquidationThreshold: liqThreshold,
  }
}

// Position that SURVIVES all scenarios (cascade-resistant):
// 10 ETH, 10,000 USD → UHF = 24,750 / 10,000 = 2.475
// At 50% drop: stressedHF = 2.475 × 0.50 = 1.2375 > 1.0 ✓
const RESILIENT = cascadePos(10n, 10_000n)

// Position that cascades at 10% drop:
// Need UHF × 0.95 ≥ 1.0 (survives 5%) AND UHF × 0.90 < 1.0 (cascades 10%)
// → 1.0526 ≤ UHF < 1.1111
// adjustedCollateral = 10 × 3000 × 0.825 = 24,750
// debt = 23,000 → UHF = 24750/23000 ≈ 1.0761
//   At 5%:  1.0761 × 0.95 ≈ 1.022 ≥ 1.0 ✓
//   At 10%: 1.0761 × 0.90 ≈ 0.969 < 1.0 ✓
const CASCADE_AT_10PCT = cascadePos(10n, 23_000n)

// Position that cascades at 30% drop:
// Need UHF × 0.75 ≥ 1.0 AND UHF × 0.70 < 1.0
// → 1.3333 ≤ UHF < 1.4286
// debt = 18,000 → UHF = 24750/18000 = 1.375
//   At 25%: 1.375 × 0.75 = 1.031 ≥ 1.0 ✓
//   At 30%: 1.375 × 0.70 = 0.9625 < 1.0 ✓
const CASCADE_AT_30PCT = cascadePos(10n, 18_000n)

// Position that cascades at 5% drop:
// Need UHF × 0.95 < 1.0 AND UHF ≥ 1.0 (not already liquidatable)
// → 1.0 ≤ UHF < 1.0526
// debt = 24,000 → UHF = 24750/24000 = 1.03125
//   At 5%: 1.03125 × 0.95 = 0.9797 < 1.0 ✓
const CASCADE_AT_5PCT = cascadePos(10n, 24_000n)

// Position already undercollateralized at current prices (UHF = 0.825 < 1.0):
const UNDERWATER = cascadePos(10n, 30_000n)

describe('applyPriceShock', () => {
  it('does NOT modify CANONICAL_USD_ASSET price (USD stays at peg)', () => {
    const shocked = applyPriceShock(BASE_PRICES, 0.50)
    expect(shocked[CANONICAL_USD_ASSET]).toBe(W)
  })

  it('reduces non-USD prices by exactly the drop fraction', () => {
    // 30% drop → ETH price should be 70% of original
    // $3,000 × 0.70 = $2,100 → bigint: 2_100 × 1e18
    const shocked = applyPriceShock(BASE_PRICES, 0.30)
    expect(shocked[ETH]).toBe(2_100n * W)
  })

  it('50% drop halves all non-USD prices exactly', () => {
    const shocked = applyPriceShock(BASE_PRICES, 0.50)
    expect(shocked[ETH]).toBe(1_500n * W)
    // CANONICAL_USD_ASSET is always unchanged
    expect(shocked[CANONICAL_USD_ASSET]).toBe(W)
  })

  it('0% drop leaves all prices unchanged', () => {
    const shocked = applyPriceShock(BASE_PRICES, 0.00)
    expect(shocked[ETH]).toBe(3_000n * W)
    expect(shocked[CANONICAL_USD_ASSET]).toBe(W)
  })

  it('non-CANONICAL token prices are reduced proportionally', () => {
    // ETH is a real token address — it IS shocked unlike CANONICAL_USD_ASSET
    const shocked = applyPriceShock(BASE_PRICES, 0.10)
    // ETH price = $3,000 × 0.90 = $2,700 in shocked prices
    const expectedEth = (3_000n * W * 9_000n) / 10_000n  // 90.00% retention
    expect(shocked[ETH]).toBe(expectedEth)
  })

  it('preserves 4 basis-point precision for retention fraction', () => {
    // 15% drop → retain 85.00% → retainBps = round(0.85 × 10_000) = 8500
    // ETH: 3_000 × 1e18 × 8500 / 10_000 = 2_550 × 1e18
    const shocked = applyPriceShock(BASE_PRICES, 0.15)
    expect(shocked[ETH]).toBe(2_550n * W)
  })

  it('returns a fresh PriceMap (does not mutate original)', () => {
    const original = { ...BASE_PRICES }
    const shocked = applyPriceShock(BASE_PRICES, 0.30)
    // Verify original is unchanged
    expect(BASE_PRICES[ETH]).toBe(3_000n * W)
    // And shocked is different
    expect(shocked[ETH]).toBe(2_100n * W)
  })
})

describe('simulatePriceShocks', () => {
  it('returns exactly 8 results — one per PRICE_DROP_SCENARIOS entry', () => {
    const results = simulatePriceShocks([RESILIENT], BASE_PRICES)
    expect(results.length).toBe(PRICE_DROP_SCENARIOS.length)
    expect(results.length).toBe(8)
  })

  it('results are ordered by ascending dropFraction matching PRICE_DROP_SCENARIOS', () => {
    const results = simulatePriceShocks([RESILIENT], BASE_PRICES)
    results.forEach((r, i) => {
      // Non-null assertion safe: forEach index always within array bounds
      expect(r.dropFraction).toBe(PRICE_DROP_SCENARIOS[i]!)
    })
  })

  it('all scenarios show isCascade=false for cascade-resistant portfolio', () => {
    const results = simulatePriceShocks([RESILIENT], BASE_PRICES)
    expect(results.every(r => !r.isCascade)).toBe(true)
  })

  it('all scenarios show isCascade=true for already-undercollateralized portfolio', () => {
    const results = simulatePriceShocks([UNDERWATER], BASE_PRICES)
    // Even at 5% drop, a position with UHF 0.825 gets worse → all cascade
    expect(results.every(r => r.isCascade)).toBe(true)
  })

  it('isCascade flips to true at the correct scenario for cascade-at-30% position', () => {
    const results = simulatePriceShocks([CASCADE_AT_30PCT], BASE_PRICES)
    // Scenarios [0.05, 0.10, 0.15, 0.20, 0.25] → no cascade
    // Scenario [0.30] → first cascade
    const first5 = results.slice(0, 5)
    expect(first5.every(r => !r.isCascade)).toBe(true)
    expect(results[5]?.isCascade).toBe(true) // 0.30 at index 5
  })

  it('stressedHealthFactor decreases monotonically for ETH/USDC positions', () => {
    const results = simulatePriceShocks([RESILIENT], BASE_PRICES)
    for (let i = 1; i < results.length; i++) {
      expect(results[i]!.stressedHealthFactor).toBeLessThan(results[i - 1]!.stressedHealthFactor)
    }
  })
})

describe('computeCascadeThreshold', () => {
  it('returns Infinity for a cascade-resistant portfolio (survives all 8 scenarios)', () => {
    expect(computeCascadeThreshold([RESILIENT], BASE_PRICES)).toBe(Infinity)
  })

  it('returns Infinity for empty positions (no debt, no risk)', () => {
    expect(computeCascadeThreshold([], BASE_PRICES)).toBe(Infinity)
  })

  it('returns 0.10 for position that cascades at 10% drop', () => {
    expect(computeCascadeThreshold([CASCADE_AT_10PCT], BASE_PRICES)).toBe(0.10)
  })

  it('returns 0.30 for position that cascades at 30% drop', () => {
    expect(computeCascadeThreshold([CASCADE_AT_30PCT], BASE_PRICES)).toBe(0.30)
  })

  it('returns 0.05 for position that cascades at 5% drop (most vulnerable)', () => {
    expect(computeCascadeThreshold([CASCADE_AT_5PCT], BASE_PRICES)).toBe(0.05)
  })

  it('returns 0.05 for already-undercollateralized position (first scenario always cascades)', () => {
    // computeCascadeThreshold doesn't check baseline — it just finds first shocked cascade
    // UHF = 0.825 → shocked at 5% makes it worse → isCascade true at 0.05
    expect(computeCascadeThreshold([UNDERWATER], BASE_PRICES)).toBe(0.05)
  })
})

describe('computeContagionRisk', () => {
  it('returns score=0 and cascadeThreshold=Infinity for empty positions', () => {
    const result = computeContagionRisk([], BASE_PRICES)
    expect(result.score).toBe(0)
    expect(result.cascadeThreshold).toBe(Infinity)
  })

  it('returns score=100 and cascadeThreshold=0 for already-undercollateralized portfolio', () => {
    // Baseline UHF = 0.825 < 1.0 → maximum risk
    const result = computeContagionRisk([UNDERWATER], BASE_PRICES)
    expect(result.score).toBe(100)
    expect(result.cascadeThreshold).toBe(0)
  })

  it('returns score=0 and cascadeThreshold=Infinity for cascade-resistant portfolio', () => {
    const result = computeContagionRisk([RESILIENT], BASE_PRICES)
    expect(result.score).toBe(0)
    expect(result.cascadeThreshold).toBe(Infinity)
  })

  it('computes score=90 for cascade at 5% drop', () => {
    // score = round((1 - 0.05 / 0.50) × 100) = round(0.90 × 100) = 90
    const result = computeContagionRisk([CASCADE_AT_5PCT], BASE_PRICES)
    expect(result.score).toBe(90)
    expect(result.cascadeThreshold).toBe(0.05)
  })

  it('computes score=80 for cascade at 10% drop', () => {
    // score = round((1 - 0.10 / 0.50) × 100) = round(0.80 × 100) = 80
    const result = computeContagionRisk([CASCADE_AT_10PCT], BASE_PRICES)
    expect(result.score).toBe(80)
    expect(result.cascadeThreshold).toBe(0.10)
  })

  it('computes score=40 for cascade at 30% drop', () => {
    // score = round((1 - 0.30 / 0.50) × 100) = round(0.40 × 100) = 40
    const result = computeContagionRisk([CASCADE_AT_30PCT], BASE_PRICES)
    expect(result.score).toBe(40)
    expect(result.cascadeThreshold).toBe(0.30)
  })

  it('score is always in [0, 100]', () => {
    const cases = [[], [RESILIENT], [CASCADE_AT_5PCT], [UNDERWATER], [CASCADE_AT_30PCT]]
    for (const positions of cases) {
      const { score } = computeContagionRisk(positions, BASE_PRICES)
      expect(score).toBeGreaterThanOrEqual(0)
      expect(score).toBeLessThanOrEqual(100)
    }
  })

  it('aggregates risk across multiple positions (worst combined UHF)', () => {
    // Adding a second healthy position alongside CASCADE_AT_5PCT
    // improves the aggregate UHF → moves cascade threshold out
    const combined = computeContagionRisk([CASCADE_AT_5PCT, RESILIENT], BASE_PRICES)
    const single = computeContagionRisk([CASCADE_AT_5PCT], BASE_PRICES)
    // Combined should have lower (or equal) contagion than single vulnerable position
    expect(combined.score).toBeLessThanOrEqual(single.score)
  })
})
