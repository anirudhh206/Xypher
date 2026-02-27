// ============================================================
// ConfidentialGuard Protocol — Aave V3 Data Adapter
// risk-engine/src/adapters/aave.adapter.ts
//
// Normalizes raw Aave API response → PositionData[]
// Zero external dependencies. No Zod, no Axios.
// Runs inside TEE — all validation is manual and explicit.
// ============================================================

import {
  ADAPTER_ERROR_CODES,
  CANONICAL_USD_ASSET,
  ok,
  err,
  type AdapterResult,
  type PositionData,
} from '../types'

const CHAIN_ID_ETHEREUM_MAINNET = 1
const CHAIN_ID_ETHEREUM_SEPOLIA = 11155111

const USD_PRECISION_FACTOR = 1_000_000 // 1e6
const USD_PRECISION_SCALE = 1_000_000_000_000n // 1e12 (to reach 1e18 total)

function usdToWei(usdAmount: number): bigint {
  return BigInt(Math.round(usdAmount * USD_PRECISION_FACTOR)) * USD_PRECISION_SCALE
}

interface RawAaveReserveInfo {
  underlyingAsset: string
  symbol: string
  decimals: number
  /** Liquidation threshold in basis points, e.g. "8500" = 85% */
  reserveLiquidationThreshold: string
}

interface RawAaveUserReserve {
  reserve: RawAaveReserveInfo
  /** Deposited aToken balance in token wei */
  currentATokenBalance: string
  /** Variable debt in token wei */
  currentVariableDebt: string
  /** Stable debt in token wei */
  currentStableDebt: string
  usageAsCollateralEnabledOnUser: boolean
}

interface RawAaveUserData {
  healthFactor: string
  totalCollateralMarketReferenceCurrency: string
  totalDebtMarketReferenceCurrency: string
  currentLiquidationThreshold?: string
  
  userReserves?: RawAaveUserReserve[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasRequiredAaveFields(raw: unknown): raw is RawAaveUserData {
  if (!isRecord(raw)) return false
  return (
    typeof raw['healthFactor'] === 'string' &&
    typeof raw['totalCollateralMarketReferenceCurrency'] === 'string' &&
    typeof raw['totalDebtMarketReferenceCurrency'] === 'string'
  )
}


function parseLiquidationThreshold(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback

  const parsed = parseFloat(raw)
  if (!isFinite(parsed) || parsed < 0) return fallback

  // Basis points if value > 1 (e.g. 8200 → 0.82)
  if (parsed > 1) return parsed / 10_000

  return parsed
}

function buildAggregatePosition(
  data: RawAaveUserData,
  chainId: number,
): PositionData {
  const collateralUSD = parseFloat(data.totalCollateralMarketReferenceCurrency)
  const debtUSD = parseFloat(data.totalDebtMarketReferenceCurrency)

  let liqThreshold = parseLiquidationThreshold(data.currentLiquidationThreshold, 0)
  if (liqThreshold === 0 && collateralUSD > 0 && debtUSD > 0) {
    const hf = parseFloat(data.healthFactor)
    if (isFinite(hf) && hf > 0) {
      liqThreshold = (hf * debtUSD) / collateralUSD
    }
  }

  return {
    protocol: 'aave',
    chainId,
    collateralAsset: CANONICAL_USD_ASSET,
    collateralAmount: usdToWei(collateralUSD),
    debtAsset: CANONICAL_USD_ASSET,
    debtAmount: usdToWei(debtUSD),
    liquidationThreshold: liqThreshold,
  }
}

// ============================================================
// INDIVIDUAL RESERVE POSITION BUILDER
// When `userReserves` is present, creates one PositionData per
// active collateral reserve. Debt is represented in USD via
// CANONICAL_USD_ASSET, split proportionally by collateral value.
//
// This gives the contagion model per-asset granularity —
// it can simulate WETH dropping 30% while WBTC holds.
// ============================================================

function buildReservePositions(
  data: RawAaveUserData,
  chainId: number,
): PositionData[] {
  const reserves = data.userReserves ?? []
  const totalDebtUSD = parseFloat(data.totalDebtMarketReferenceCurrency)

  const collateralReserves = reserves.filter(
    (r) =>
      r.usageAsCollateralEnabledOnUser &&
      BigInt(r.currentATokenBalance) > 0n,
  )

  if (collateralReserves.length === 0) return []

  const positionCount = BigInt(collateralReserves.length)
  const totalDebtWei = usdToWei(totalDebtUSD)

  return collateralReserves.map((r): PositionData => {
    const liqThreshold = parseLiquidationThreshold(
      r.reserve.reserveLiquidationThreshold,
      0.8, 
    )

    return {
      protocol: 'aave',
      chainId,
      collateralAsset: r.reserve.underlyingAsset.toLowerCase(),
      collateralAmount: BigInt(r.currentATokenBalance),
      debtAsset: CANONICAL_USD_ASSET,
      debtAmount: totalDebtWei / positionCount,
      liquidationThreshold: liqThreshold,
    }
  })
}

export interface AaveAdapterOptions {

  chainId?: number
  useIndividualReserves?: boolean
}


export const AaveAdapter = {
  normalize(
    rawBody: unknown,
    options: AaveAdapterOptions = {},
  ): AdapterResult<PositionData[]> {
    const chainId = options.chainId ?? CHAIN_ID_ETHEREUM_MAINNET
    const useIndividualReserves = options.useIndividualReserves ?? true

    // ── Structural validation ────────────────────────────────
    if (!isRecord(rawBody)) {
      return err({
        protocol: 'aave',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message: 'Response body is not a JSON object',
      })
    }

    if (!hasRequiredAaveFields(rawBody)) {
      return err({
        protocol: 'aave',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message:
          'Response missing required fields: healthFactor, ' +
          'totalCollateralMarketReferenceCurrency, totalDebtMarketReferenceCurrency',
      })
    }

    //  Value validation
    const collateralUSD = parseFloat(rawBody.totalCollateralMarketReferenceCurrency)
    const debtUSD = parseFloat(rawBody.totalDebtMarketReferenceCurrency)

    if (!isFinite(collateralUSD) || !isFinite(debtUSD)) {
      return err({
        protocol: 'aave',
        code: ADAPTER_ERROR_CODES.PARSE_ERROR,
        message: 'Could not parse collateral or debt USD values as finite numbers',
      })
    }

    // No active position
    if (collateralUSD === 0 && debtUSD === 0) {
      return err({
        protocol: 'aave',
        code: ADAPTER_ERROR_CODES.NO_POSITIONS,
        message: 'Wallet has no active Aave positions',
      })
    }

    // Build positions 
    if (useIndividualReserves && Array.isArray(rawBody.userReserves) && rawBody.userReserves.length > 0) {
      const positions = buildReservePositions(rawBody, chainId)
      if (positions.length > 0) {
        return ok(positions)
      }
    }
    return ok([buildAggregatePosition(rawBody, chainId)])
  },

  normalizeTestnet(
    rawBody: unknown,
    options: Omit<AaveAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return AaveAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_ETHEREUM_SEPOLIA,
    })
  },
} as const
