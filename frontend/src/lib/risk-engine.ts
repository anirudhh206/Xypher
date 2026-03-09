
export type CreditTier = 1 | 2 | 3 | 4 | 5;
export type PriceMap = Record<string, number>;
export type PlaidData = any; 
export type PositionData = any;
export type CreditScore = any;
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
export function computeUnifiedHealthFactor(positions: MockPositionData[]): number {
  const totalCollateralUSD = positions.reduce((sum, p) => sum + p.collateralUSD, 0);
  const totalDebtUSD = positions.reduce((sum, p) => sum + p.debtUSD, 0);

  if (totalDebtUSD === 0) {
    return 999; // No debt = infinite health factor
  }

  return totalCollateralUSD / totalDebtUSD;
}
export function computeContagionRisk(
  positions: MockPositionData[],
  prices: PriceMap,
): number {
  const totalCollateral = positions.reduce((sum, p) => sum + p.collateralUSD, 0);
  const cryptoCollateral = positions
    .filter((p) => p.collateralAsset !== "USDC" && p.collateralAsset !== "USDT")
    .reduce((sum, p) => sum + p.collateralUSD, 0);

  if (totalCollateral === 0) return 0;

  const cryptoRatio = cryptoCollateral / totalCollateral;
  return Math.round(cryptoRatio * 100);
}
export function computeDebtServiceability(_plaidData: PlaidData | null): number {
  return 75; 
}

export function computeCreditTier(
  uhf: number,
  contagion: number,
  dss: number,
): CreditTier {
  if (uhf > 3.0 && contagion < 20 && dss > 90) {
    return 1 as CreditTier;
  }
  if (uhf > 2.0 && contagion < 40 && dss > 75) {
    return 2 as CreditTier;
  }
  if (uhf > 1.5 && contagion < 60 && dss > 60) {
    return 3 as CreditTier;
  }
  if (uhf > 1.2 && contagion < 75 && dss > 40) {
    return 4 as CreditTier;
  }
  return 5 as CreditTier;
}
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
    unifiedHealthFactor: Math.max(0, Math.min(9.99, uhf)), 
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
export function getTierLTV(tier: CreditTier): number {
  const ltv: Record<number, number> = {
    1: 0.9, 
    2: 0.8, 
    3: 0.7, 
    4: 0.6, 
    5: 0.0, 
  };
  return ltv[tier] || 0;
}
export function getMaxBorrowAmount(
  collateralUSD: number,
  tier: CreditTier,
): number {
  const ltv = getTierLTV(tier);
  return collateralUSD * ltv;
}
