
import {
  CANONICAL_USD_ASSET,
  WEI_PER_TOKEN,
  type PositionData,
  type PriceMap,
} from './types'
const LIQUIDATION_THRESHOLD_PRECISION = 10_000
const LIQUIDATION_THRESHOLD_PRECISION_BIG = 10_000n

export const INFINITE_HEALTH_FACTOR = Infinity

function resolvePrice(prices: PriceMap, asset: string): bigint {
  const target = asset.toLowerCase()
  if (target === CANONICAL_USD_ASSET) {
    return prices[CANONICAL_USD_ASSET] ?? WEI_PER_TOKEN
  }

  return prices[target] ?? 0n
}

function thresholdToBasisPoints(threshold: number): bigint {
  return BigInt(Math.round(threshold * LIQUIDATION_THRESHOLD_PRECISION))
}

function computeCollateralUSD(position: PositionData, prices: PriceMap): bigint {
  const price = resolvePrice(prices, position.collateralAsset)
  if (price === 0n) return 0n
  return (position.collateralAmount * price) / WEI_PER_TOKEN
}

function computeAdjustedCollateralUSD(
  position: PositionData,
  prices: PriceMap,
): bigint {
  const collateralUSD = computeCollateralUSD(position, prices)
  const thresholdBps = thresholdToBasisPoints(position.liquidationThreshold)
  return (collateralUSD * thresholdBps) / LIQUIDATION_THRESHOLD_PRECISION_BIG
}
function computeDebtUSD(position: PositionData, prices: PriceMap): bigint {
  const price = resolvePrice(prices, position.debtAsset)
  const effectivePrice = price > 0n ? price : WEI_PER_TOKEN
  return (position.debtAmount * effectivePrice) / WEI_PER_TOKEN
}
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
 return Number(totalAdjustedCollateralUSD) / Number(totalDebtUSD)
}

export function computePositionHealthFactor(
  position: PositionData,
  prices: PriceMap,
): number {
  return computeUnifiedHealthFactor([position], prices)
}

export function isLiquidatable(
  position: PositionData,
  prices: PriceMap,
): boolean {
  if (position.debtAmount === 0n) return false
  return computePositionHealthFactor(position, prices) < 1.0
}

export function computeTotalCollateralUSD(
  positions: readonly PositionData[],
  prices: PriceMap,
): bigint {
  return positions.reduce(
    (sum, pos) => sum + computeCollateralUSD(pos, prices),
    0n,
  )
}

export function computeTotalDebtUSD(
  positions: readonly PositionData[],
  prices: PriceMap,
): bigint {
  return positions.reduce(
    (sum, pos) => sum + computeDebtUSD(pos, prices),
    0n,
  )
}
export function buildPriceMap(
  tokenPrices: Readonly<Record<string, bigint>>,
): PriceMap {
  return {
    ...tokenPrices,
    // CANONICAL_USD_ASSET is always $1.00
    [CANONICAL_USD_ASSET]: WEI_PER_TOKEN,
  }
}
