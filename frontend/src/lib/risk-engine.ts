/**
 * Risk Engine Integration
 * Exposes the @confidential-guard/risk-engine calculations to the frontend
 * 
 * In production: These would be called via TEE enclave over HTTPS
 * For demo: We compute client-side using exported functions
 */

// Type definitions for risk engine
// These are frontend approximations of the backend risk engine calculations

export type CreditTier = 1 | 2 | 3 | 4 | 5;
export type PriceMap = Record<string, number>;
export type PlaidData = any; // Placeholder for production Plaid integration
export type PositionData = any;
export type CreditScore = any;

// Mock/stub exports since risk-engine is backend
// In production, this would call CRE workflow endpoints

export interface MockPositionData {
  protocol: "aave" | "morpho" | "compound";
  chain: string;
  collateralAsset: string;
  collateralAmount: bigint;
  debtAsset: string;
  debtAmount: bigint;
  collateralUSD: number;
  debtUSD: number;
}

export interface CreditScoreResult {
  tier: CreditTier;
  unifiedHealthFactor: number;
  contagionScore: number;
  debtServiceabilityScore: number;
  breakdown: {
    label: string;
    value: number;
    threshold: number;
    pass: boolean;
  }[];
}

/**
 * Compute unified health factor from multiple positions
 * UHF = sum(collateral USD) / sum(debt USD)
 */
export function computeUnifiedHealthFactor(positions: MockPositionData[]): number {
  const totalCollateralUSD = positions.reduce((sum, p) => sum + p.collateralUSD, 0);
  const totalDebtUSD = positions.reduce((sum, p) => sum + p.debtUSD, 0);

  if (totalDebtUSD === 0) {
    return 999; // No debt = infinite health factor
  }

  return totalCollateralUSD / totalDebtUSD;
}

/**
 * Simulate contagion risk via price drops
 * Returns 0-100 score where 0 = resistant, 100 = vulnerable
 */
export function computeContagionRisk(
  positions: MockPositionData[],
  prices: PriceMap,
): number {
  // Simplified: if collateral is 90% or more crypto, high contagion
  const totalCollateral = positions.reduce((sum, p) => sum + p.collateralUSD, 0);
  const cryptoCollateral = positions
    .filter((p) => p.collateralAsset !== "USDC" && p.collateralAsset !== "USDT")
    .reduce((sum, p) => sum + p.collateralUSD, 0);

  if (totalCollateral === 0) return 0;

  const cryptoRatio = cryptoCollateral / totalCollateral;

  // Linear scoring: 0% crypto = 0 score, 100% crypto = 100 score
  return Math.round(cryptoRatio * 100);
}

/**
 * Debt serviceability score (0-100)
 * Placeholder: requires Plaid data
 */
export function computeDebtServiceability(_plaidData: PlaidData | null): number {
  // In production: analyze cash flow vs debt obligations
  // For demo: return neutral score if no Plaid data
  return 75; // Neutral/good assumption
}

/**
 * Assign credit tier (1-5) based on three dimensions
 * Tier = max(1, min(5, floor(some_calculation)))
 */
export function computeCreditTier(
  uhf: number,
  contagion: number,
  dss: number,
): CreditTier {
  // Tier assignment logic (worst dimension wins):
  // Tier 1: UHF > 3.0 AND contagion < 20 AND DSS > 90
  if (uhf > 3.0 && contagion < 20 && dss > 90) {
    return 1 as CreditTier;
  }
  // Tier 2: UHF > 2.0 AND contagion < 40 AND DSS > 75
  if (uhf > 2.0 && contagion < 40 && dss > 75) {
    return 2 as CreditTier;
  }
  // Tier 3: UHF > 1.5 AND contagion < 60 AND DSS > 60
  if (uhf > 1.5 && contagion < 60 && dss > 60) {
    return 3 as CreditTier;
  }
  // Tier 4: UHF > 1.2 AND contagion < 75 AND DSS > 40
  if (uhf > 1.2 && contagion < 75 && dss > 40) {
    return 4 as CreditTier;
  }
  // Tier 5: Everything else
  return 5 as CreditTier;
}

/**
 * Main credit score computation
 */
export function calculateCreditScore(
  positions: MockPositionData[],
  plaidData: PlaidData | null = null,
): CreditScoreResult {
  const uhf = computeUnifiedHealthFactor(positions);
  const contagion = computeContagionRisk(positions, {});
  const dss = computeDebtServiceability(plaidData);
  const tier = computeCreditTier(uhf, contagion, dss);

  return {
    tier,
    unifiedHealthFactor: Math.max(0, Math.min(9.99, uhf)), // Cap at 9.99 for display
    contagionScore: Math.round(contagion),
    debtServiceabilityScore: Math.round(dss),
    breakdown: [
      {
        label: "Unified Health Factor",
        value: Math.max(0, Math.min(9.99, uhf)),
        threshold: tier === 1 ? 3.0 : tier === 2 ? 2.0 : tier === 3 ? 1.5 : 1.2,
        pass: uhf > (tier === 1 ? 3.0 : tier === 2 ? 2.0 : tier === 3 ? 1.5 : 1.2),
      },
      {
        label: "Contagion Risk",
        value: contagion,
        threshold: tier === 1 ? 20 : tier === 2 ? 40 : tier === 3 ? 60 : 75,
        pass: contagion < (tier === 1 ? 20 : tier === 2 ? 40 : tier === 3 ? 60 : 75),
      },
      {
        label: "Debt Serviceability",
        value: dss,
        threshold: tier === 1 ? 90 : tier === 2 ? 75 : tier === 3 ? 60 : 40,
        pass: dss > (tier === 1 ? 90 : tier === 2 ? 75 : tier === 3 ? 60 : 40),
      },
    ],
  };
}

/**
 * Get LTV for a specific tier
 */
export function getTierLTV(tier: CreditTier): number {
  const ltv: Record<number, number> = {
    1: 0.9, // 90% LTV
    2: 0.8, // 80% LTV
    3: 0.7, // 70% LTV
    4: 0.6, // 60% LTV
    5: 0.0, // No lending
  };
  return ltv[tier] || 0;
}

/**
 * Calculate max borrowable amount given tier and collateral
 */
export function getMaxBorrowAmount(
  collateralUSD: number,
  tier: CreditTier,
): number {
  const ltv = getTierLTV(tier);
  return collateralUSD * ltv;
}
