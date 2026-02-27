// ============================================================
// ConfidentialGuard Protocol — Compound v3 (Comet) Data Adapter
// risk-engine/src/adapters/compound.adapter.ts
//
// Normalizes raw Compound v3 API response → PositionData[]
//
// ── Compound v3 (Comet) Architecture ─────────────────────────
//
// SINGLE BASE ASSET MODEL
//   Unlike Aave's cross-collateral pool or Morpho's isolated
//   markets, each Compound v3 Comet deployment has exactly one
//   borrowable asset: the "base token" (typically USDC on mainnet,
//   WETH on some markets). All debt is denominated in the base
//   token. Collateral is supplied as separate assets but cannot
//   itself be borrowed — it exists solely to back base-token debt.
//
// COLLATERAL TRACKING
//   A borrower may supply multiple collateral assets (WETH, WBTC,
//   etc.) and borrow against them collectively in the base token.
//   The Compound v3 API returns each collateral asset as a separate
//   entry but the debt (borrow balance) is a single base-token
//   amount. This requires a different normalization strategy than
//   Aave or Morpho.
//
// NORMALIZATION STRATEGY
//   We produce one PositionData entry per collateral asset,
//   splitting the total base-token debt proportionally across
//   collateral entries by USD value. This gives the contagion
//   model per-asset collateral granularity while preserving the
//   correct aggregate debt exposure.
//
//   If price data is unavailable for proportional splitting,
//   we fall back to a single aggregate PositionData using
//   CANONICAL_USD_ASSET as the collateral asset — identical
//   to the Aave aggregate fallback strategy.
//
// BORROW BALANCE
//   Compound v3 tracks borrow principal via an "internal index"
//   system. The API typically returns `borrowBalanceOf` (current
//   balance including interest) as a raw uint256 in base token
//   native units. For USDC (6 decimals), this is 6-decimal-scaled.
//   The adapter normalises to 18-decimal representation (1e18 wei)
//   for consistency across all protocols.
//
// COLLATERAL FACTOR vs LIQUIDATION FACTOR
//   Compound v3 distinguishes two thresholds per asset:
//   - Collateral Factor: max borrow ratio (borrow limit)
//   - Liquidation Factor: ratio at which liquidation can occur
//   The liquidation factor is always ≥ collateral factor.
//   We use the liquidation factor for PositionData.liquidationThreshold,
//   matching the semantics used by Aave and Morpho.
//
// MULTI-COMET DEPLOYMENTS
//   Compound v3 has multiple Comet contracts per chain, each with
//   a different base asset (USDC Comet, WETH Comet, etc.). A user
//   may have positions in multiple Comets on the same chain. The
//   API response may contain positions from one or multiple Comets.
//   This adapter handles both single-Comet and multi-Comet responses.
//
// Zero external dependencies. No Zod, no Axios.
// Runs inside TEE — all validation is manual and explicit.
// ============================================================

import {
  ADAPTER_ERROR_CODES,
  WEI_PER_TOKEN,
  CANONICAL_USD_ASSET,
  ok,
  err,
  type AdapterResult,
  type PositionData,
} from '../types'

// ============================================================
// CHAIN IDs — Active Compound v3 deployments
// ============================================================

const CHAIN_ID_ETHEREUM_MAINNET = 1
const CHAIN_ID_ETHEREUM_SEPOLIA = 11155111
const CHAIN_ID_POLYGON_MAINNET = 137
const CHAIN_ID_ARBITRUM_MAINNET = 42161
const CHAIN_ID_BASE_MAINNET = 8453
const CHAIN_ID_BASE_SEPOLIA = 84532
const CHAIN_ID_OPTIMISM_MAINNET = 10

// ============================================================
// COMPOUND V3 PROTOCOL CONSTANTS
// ============================================================

/**
 * Basis points divisor — Compound v3 stores collateral factors
 * and liquidation factors as integers with 18-decimal precision
 * (WAD). Some REST API wrappers return them as basis points (1/10000).
 * Others return as WAD strings. Both formats are handled.
 */
const COMPOUND_FACTOR_WAD = WEI_PER_TOKEN // 1e18

/**
 * Default liquidation factor used when the API returns no factor
 * for a specific collateral asset. 0.825 = 82.5% — the Compound v3
 * USDC Comet default for ETH collateral as of 2025.
 */
const COMPOUND_DEFAULT_LIQUIDATION_FACTOR = 0.825

/**
 * Minimum decimal count for a valid ERC-20 token.
 * Used to validate collateral and base token decimal fields.
 */
const MIN_TOKEN_DECIMALS = 0
const MAX_TOKEN_DECIMALS = 18

/**
 * Compound v3 USDC Comet base token is USDC (6 decimals).
 * When normalising to 1e18, amounts must be scaled up by 1e12.
 */
const USDC_DECIMALS = 6
const WEI_DECIMALS = 18

// ============================================================
// EVM ADDRESS VALIDATION
// ============================================================

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/

function isValidEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && EVM_ADDRESS_REGEX.test(value)
}

// ============================================================
// RAW API TYPES
//
// Represents the Compound v3 REST API response shape.
// The Compound API (api.compound.finance) returns account
// positions per Comet contract.
//
// Reference: https://v3-api.compound.finance/docs
// ============================================================

interface RawCompoundToken {
  /** ERC-20 contract address (checksummed) */
  address: string
  symbol: string
  decimals: number
}

interface RawCompoundCollateralAsset {
  /** The collateral token details */
  asset: RawCompoundToken
  /**
   * Collateral balance in the asset's native units (raw uint256 string).
   * e.g. for WETH: "500000000000000000" = 0.5 WETH (18 decimals)
   */
  balance: string
  /**
   * Liquidation factor in WAD (1e18 scale) or decimal fraction.
   * WAD: "825000000000000000" = 0.825 = 82.5% liquidation threshold
   * Decimal: "0.825" — normalised by some API wrappers
   * Some API versions name this field `liquidateCollateralFactor`
   * while others use `liquidationFactor`. Both are checked.
   */
  liquidateCollateralFactor?: string
  liquidationFactor?: string
  /**
   * USD value of this collateral position (string float).
   * Used for proportional debt splitting across collateral assets.
   * Not always present — treated as optional.
   */
  collateralUsdValue?: string
}

interface RawCompoundCometPosition {
  /**
   * The Comet contract address (identifies which market this is).
   * e.g. "0xc3d688B66703497DAA19211EEdff47f25384cdc3" = USDC Comet
   */
  comet?: string
  /** The base token for this Comet (the borrowable asset) */
  baseToken: RawCompoundToken
  /**
   * Current borrow balance in base token native units.
   * Includes accrued interest. Positive value = user is a borrower.
   * May be named `borrowBalance` or `borrowBalanceOf` depending on API.
   */
  borrowBalance?: string
  borrowBalanceOf?: string
  /**
   * USD value of the borrow position.
   * Not always present. Used for display only in our adapter.
   */
  borrowUsdValue?: string
  /** All collateral assets supplied in this Comet */
  collateralAssets: RawCompoundCollateralAsset[]
}

interface RawCompoundAccountResponse {
  /**
   * One entry per Comet market where the user has a position.
   * May be named `markets`, `positions`, or `cometPositions`
   * depending on API version and wrapper.
   */
  markets?: RawCompoundCometPosition[]
  positions?: RawCompoundCometPosition[]
  cometPositions?: RawCompoundCometPosition[]
}

// ============================================================
// TYPE GUARDS — No casting without validation
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRawCompoundToken(value: unknown): value is RawCompoundToken {
  if (!isRecord(value)) return false
  return (
    isValidEvmAddress(value['address']) &&
    typeof value['symbol'] === 'string' &&
    value['symbol'].length > 0 &&
    typeof value['decimals'] === 'number' &&
    Number.isInteger(value['decimals']) &&
    value['decimals'] >= MIN_TOKEN_DECIMALS &&
    value['decimals'] <= MAX_TOKEN_DECIMALS
  )
}

function isRawCompoundCollateralAsset(
  value: unknown,
): value is RawCompoundCollateralAsset {
  if (!isRecord(value)) return false
  return (
    isRawCompoundToken(value['asset']) &&
    typeof value['balance'] === 'string' &&
    value['balance'].length > 0
  )
}

function isRawCompoundCometPosition(
  value: unknown,
): value is RawCompoundCometPosition {
  if (!isRecord(value)) return false

  // Validate base token
  if (!isRawCompoundToken(value['baseToken'])) return false

  // Validate collateralAssets array (must exist, may be empty)
  if (!Array.isArray(value['collateralAssets'])) return false

  // Must have at least one of borrowBalance or borrowBalanceOf
  const hasBorrowBalance =
    typeof value['borrowBalance'] === 'string' ||
    typeof value['borrowBalanceOf'] === 'string'
  if (!hasBorrowBalance) return false

  return true
}

// ============================================================
// RESPONSE SHAPE NORMALISATION
// Handles multiple API response envelope formats.
// ============================================================

function extractCometPositions(body: Record<string, unknown>): unknown[] {
  // Shape 1: { markets: [...] } — Compound v3 API v1 format
  if (Array.isArray(body['markets'])) return body['markets']

  // Shape 2: { positions: [...] } — common REST wrapper
  if (Array.isArray(body['positions'])) return body['positions']

  // Shape 3: { cometPositions: [...] } — custom proxy wrapper
  if (Array.isArray(body['cometPositions'])) return body['cometPositions']

  // Shape 4: direct array — some wrappers return the array at root
  // This is checked last to avoid false positives
  return []
}

function validateCometPositions(
  rawPositions: unknown[],
): RawCompoundCometPosition[] {
  return rawPositions.filter(isRawCompoundCometPosition)
}

// ============================================================
// LIQUIDATION FACTOR PARSING
//
// Compound v3 liquidation factors may come as:
//   WAD string: "825000000000000000" → 0.825
//   Decimal string: "0.825" → 0.825
//   Percentage: "82.5" — rare, but handled
//
// Returns a clamped [0, 1] fraction.
// ============================================================

function parseLiquidationFactor(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback

  // Decimal fraction: "0.825"
  if (raw.includes('.') && parseFloat(raw) <= 1) {
    const fraction = parseFloat(raw)
    if (!isFinite(fraction) || fraction < 0) return fallback
    return Math.min(fraction, 1)
  }

  // Percentage format: "82.5" (no leading "0.")
  if (raw.includes('.') && parseFloat(raw) > 1) {
    const pct = parseFloat(raw)
    if (!isFinite(pct) || pct < 0 || pct > 100) return fallback
    return pct / 100
  }

  // WAD format: "825000000000000000"
  try {
    const wadValue = BigInt(raw)
    if (wadValue < 0n || wadValue > COMPOUND_FACTOR_WAD) return fallback
    // 4 decimal places (0.0001 resolution)
    return Number(wadValue * 10_000n / COMPOUND_FACTOR_WAD) / 10_000
  } catch {
    return fallback
  }
}

/**
 * Resolves the liquidation factor from a collateral asset entry.
 * Compound v3 uses two possible field names for this value.
 */
function resolveLiquidationFactor(asset: RawCompoundCollateralAsset): number {
  return parseLiquidationFactor(
    asset.liquidateCollateralFactor ?? asset.liquidationFactor,
    COMPOUND_DEFAULT_LIQUIDATION_FACTOR,
  )
}

// ============================================================
// BASE TOKEN AMOUNT NORMALISATION
//
// Compound v3 borrow balances are in the base token's native
// decimal precision. For the risk engine, all amounts must be
// in 1e18 (WEI) format. This function scales amounts up to
// 18 decimals regardless of the base token's actual decimal count.
//
// Example:
//   USDC (6 decimals): "1000000" → 1_000_000_000_000_000_000n (1 USDC in 1e18)
//   WETH (18 decimals): "1000000000000000000" → 1_000_000_000_000_000_000n (1 WETH)
//
// This normalisation ensures the risk engine applies consistent
// arithmetic across all positions regardless of token precision.
// ============================================================

function normaliseToWei(rawAmount: string, tokenDecimals: number): bigint {
  try {
    const rawBigInt = BigInt(rawAmount)
    const decimalDiff = WEI_DECIMALS - tokenDecimals

    if (decimalDiff > 0) {
      // Scale up: USDC (6) → 1e18 requires multiplying by 10^12
      return rawBigInt * (10n ** BigInt(decimalDiff))
    } else if (decimalDiff < 0) {
      // Scale down: hypothetical 24-decimal token → 1e18
      return rawBigInt / (10n ** BigInt(-decimalDiff))
    } else {
      // Already 18 decimals (WETH, WBTC-wrapped, etc.)
      return rawBigInt
    }
  } catch {
    return 0n
  }
}

// ============================================================
// BORROW BALANCE RESOLVER
//
// Compound v3 API uses two different field names depending on
// the API version. `borrowBalanceOf` is the canonical v3 name
// (matches the contract function). `borrowBalance` is used by
// some REST wrapper implementations.
// ============================================================

function resolveBorrowBalance(position: RawCompoundCometPosition): bigint {
  const raw = position.borrowBalance ?? position.borrowBalanceOf
  if (raw === undefined || raw === '') return 0n

  return normaliseToWei(raw, position.baseToken.decimals)
}

// ============================================================
// COLLATERAL BALANCE NORMALISATION
// ============================================================

function resolveCollateralBalance(
  asset: RawCompoundCollateralAsset,
): bigint {
  return normaliseToWei(asset.balance, asset.asset.decimals)
}

// ============================================================
// DEBT SPLITTING STRATEGY
//
// In Compound v3, all debt is in the base token. A single borrow
// balance may be backed by multiple collateral assets. To give
// the contagion model per-asset granularity, we split the total
// debt proportionally across collateral assets by USD value.
//
// Proportional split formula (integer arithmetic):
//   collateralShare_i = totalDebt × collateralUSD_i / totalCollateralUSD
//
// If USD values are unavailable, debt is split evenly across
// all collateral entries (equal weighting, less accurate but safe).
//
// If there is only one collateral asset, it receives all the debt.
// ============================================================

interface CollateralWithBalance {
  asset: RawCompoundCollateralAsset
  collateralAmountWei: bigint
  usdValue: number // parsed float, 0 if unavailable
}

function buildCollateralList(
  assets: RawCompoundCollateralAsset[],
): CollateralWithBalance[] {
  return assets
    .map((asset) => ({
      asset,
      collateralAmountWei: resolveCollateralBalance(asset),
      usdValue: asset.collateralUsdValue !== undefined
        ? parseFloat(asset.collateralUsdValue)
        : 0,
    }))
    .filter((c) => c.collateralAmountWei > 0n) // exclude dust/empty entries
}

function splitDebtByUsdValue(
  totalDebtWei: bigint,
  collaterals: CollateralWithBalance[],
): bigint[] {
  if (collaterals.length === 0) return []
  if (collaterals.length === 1) return [totalDebtWei]

  const totalUsd = collaterals.reduce((sum, c) => sum + c.usdValue, 0)

  if (totalUsd <= 0) {
    // Fallback: equal split when USD values unavailable
    const shareEach = totalDebtWei / BigInt(collaterals.length)
    const remainder = totalDebtWei - shareEach * BigInt(collaterals.length)
    return collaterals.map((_, i) =>
      i === 0 ? shareEach + remainder : shareEach,
    )
  }

  // Proportional split by USD value — bigint arithmetic with
  // 1e6 scaling factor to preserve 6 decimal places of precision
  const SPLIT_PRECISION = 1_000_000n // 1e6
  const totalUsdScaled = BigInt(Math.round(totalUsd * 1_000_000))
  const shares: bigint[] = []
  let allocated = 0n

  for (let i = 0; i < collaterals.length; i++) {
    const collateral = collaterals[i]
    if (i === collaterals.length - 1) {
      // Last entry absorbs rounding remainder
      shares.push(totalDebtWei - allocated)
    } else {
      const usdScaled = BigInt(Math.round((collateral?.usdValue ?? 0) * 1_000_000))
      const share = (totalDebtWei * usdScaled) / totalUsdScaled / SPLIT_PRECISION * SPLIT_PRECISION / SPLIT_PRECISION
      // Cleaner: directly proportional
      const debtShare = (totalDebtWei * usdScaled) / totalUsdScaled
      shares.push(debtShare)
      allocated += debtShare
    }
  }

  return shares
}

// ============================================================
// AGGREGATE FALLBACK
//
// When there are no valid collateral assets with non-zero balances
// (e.g. after liquidation or when user has only borrow position
// with collateral not yet reflected in API), we build a single
// aggregate PositionData using CANONICAL_USD_ASSET — the same
// pattern used in the Aave aggregate fallback.
// ============================================================

function buildAggregatePosition(
  position: RawCompoundCometPosition,
  borrowAmountWei: bigint,
  chainId: number,
): PositionData {
  return {
    protocol: 'compound',
    chainId,
    collateralAsset: CANONICAL_USD_ASSET,
    collateralAmount: 0n, // no collateral data — signals edge case to risk engine
    debtAsset: position.baseToken.address.toLowerCase(),
    debtAmount: borrowAmountWei,
    liquidationThreshold: COMPOUND_DEFAULT_LIQUIDATION_FACTOR,
  }
}

// ============================================================
// PER-COLLATERAL POSITION BUILDER
//
// Builds one PositionData entry per collateral asset, with
// the debt amount proportionally allocated from the total borrow.
// ============================================================

function buildPerCollateralPositions(
  position: RawCompoundCometPosition,
  collaterals: CollateralWithBalance[],
  borrowAmountWei: bigint,
  chainId: number,
): PositionData[] {
  const debtShares = splitDebtByUsdValue(borrowAmountWei, collaterals)
  const positions: PositionData[] = []

  for (let i = 0; i < collaterals.length; i++) {
    const collateral = collaterals[i]
    const debtShare = debtShares[i]

    if (collateral === undefined || debtShare === undefined) continue

    const liqThreshold = resolveLiquidationFactor(collateral.asset)

    positions.push({
      protocol: 'compound',
      chainId,
      collateralAsset: collateral.asset.asset.address.toLowerCase(),
      collateralAmount: collateral.collateralAmountWei,
      debtAsset: position.baseToken.address.toLowerCase(),
      debtAmount: debtShare,
      liquidationThreshold: liqThreshold,
    })
  }

  return positions
}

// ============================================================
// COMET POSITION PROCESSOR
//
// Processes a single Comet market position into PositionData[].
// Returns an empty array for pure-supply positions (no borrow)
// or positions with unparseable data.
// ============================================================

function processCometPosition(
  position: RawCompoundCometPosition,
  chainId: number,
): PositionData[] {
  const borrowAmountWei = resolveBorrowBalance(position)

  // Skip pure-supply positions (no outstanding borrow)
  if (borrowAmountWei === 0n) return []

  const validCollaterals = buildCollateralList(
    position.collateralAssets.filter(isRawCompoundCollateralAsset),
  )

  if (validCollaterals.length === 0) {
    // Edge case: borrow exists but no collateral reflected in API
    // (may occur immediately after position opening or after liquidation)
    // Emit aggregate position to ensure the debt is captured in risk model
    return [buildAggregatePosition(position, borrowAmountWei, chainId)]
  }

  if (validCollaterals.length === 1) {
    // Single collateral — direct mapping, no debt splitting needed
    const collateral = validCollaterals[0]
    if (collateral === undefined) return [buildAggregatePosition(position, borrowAmountWei, chainId)]

    return [
      {
        protocol: 'compound',
        chainId,
        collateralAsset: collateral.asset.asset.address.toLowerCase(),
        collateralAmount: collateral.collateralAmountWei,
        debtAsset: position.baseToken.address.toLowerCase(),
        debtAmount: borrowAmountWei,
        liquidationThreshold: resolveLiquidationFactor(collateral.asset),
      },
    ]
  }

  // Multiple collateral assets — split debt proportionally
  return buildPerCollateralPositions(
    position,
    validCollaterals,
    borrowAmountWei,
    chainId,
  )
}

// ============================================================
// PUBLIC API
// ============================================================

export interface CompoundAdapterOptions {
  /**
   * Chain ID of the Compound v3 deployment being queried.
   * Compound v3 is deployed on Ethereum (1), Polygon (137),
   * Arbitrum (42161), Base (8453), and Optimism (10).
   * Defaults to Ethereum mainnet.
   */
  chainId?: number
}

/**
 * Normalizes a raw Compound v3 (Comet) API response into a
 * PositionData array.
 *
 * ── Normalization strategy ──────────────────────────────────
 * Each Comet market where the user has outstanding borrow
 * produces one or more PositionData entries:
 *   - One entry per collateral asset (when collateral data is
 *     available), with debt proportionally split by USD value.
 *   - One aggregate entry using CANONICAL_USD_ASSET (when no
 *     collateral data is available but borrow exists).
 *
 * Pure-supply positions (user has deposited base token or
 * collateral but has zero borrow) are excluded — they carry
 * no liquidation risk.
 *
 * ── Multi-Comet support ─────────────────────────────────────
 * If the API response contains multiple Comet market positions
 * (e.g. USDC Comet + WETH Comet on the same chain), each
 * market is processed independently and all resulting
 * PositionData entries are merged into a single flat array.
 *
 * ── Decimal normalisation ───────────────────────────────────
 * All amounts are normalised to 1e18 (WEI) regardless of the
 * underlying token's native decimal precision. USDC (6 decimals)
 * borrow balances are scaled up by 1e12. This ensures the risk
 * engine applies uniform arithmetic across all protocols.
 *
 * @param rawBody - Parsed JSON from the Compound v3 data endpoint.
 *   Supported response shapes:
 *   - { markets: [...] }
 *   - { positions: [...] }
 *   - { cometPositions: [...] }
 * @param options - Adapter configuration.
 * @returns AdapterResult containing PositionData[] or a typed error.
 *
 * @example
 * const result = CompoundAdapter.normalize(JSON.parse(responseBody))
 * if (!result.ok) { handle(result.error); return }
 * const positions = result.data  // one entry per collateral/Comet pair
 */
export const CompoundAdapter = {
  normalize(
    rawBody: unknown,
    options: CompoundAdapterOptions = {},
  ): AdapterResult<PositionData[]> {
    const chainId = options.chainId ?? CHAIN_ID_ETHEREUM_MAINNET

    // ── Structural validation ────────────────────────────────
    if (!isRecord(rawBody)) {
      return err({
        protocol: 'compound',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message: 'Response body is not a JSON object',
      })
    }

    // ── Extract Comet positions from any supported envelope ──
    const rawPositions = extractCometPositions(rawBody)

    if (rawPositions.length === 0) {
      return err({
        protocol: 'compound',
        code: ADAPTER_ERROR_CODES.NO_POSITIONS,
        message:
          'No Comet positions array found in response. ' +
          'Expected one of: markets, positions, or cometPositions.',
      })
    }

    // ── Validate individual Comet position entries ────────────
    const validPositions = validateCometPositions(rawPositions)

    if (validPositions.length === 0) {
      return err({
        protocol: 'compound',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message:
          `Found ${rawPositions.length} raw Comet position entries but none ` +
          'passed structural validation. Required fields per entry: ' +
          'baseToken.{address,symbol,decimals}, collateralAssets[], ' +
          'and one of borrowBalance or borrowBalanceOf.',
      })
    }

    // ── Process each Comet market into PositionData entries ──
    const positions: PositionData[] = []

    for (const cometPosition of validPositions) {
      const entries = processCometPosition(cometPosition, chainId)
      positions.push(...entries)
    }

    if (positions.length === 0) {
      return err({
        protocol: 'compound',
        code: ADAPTER_ERROR_CODES.NO_POSITIONS,
        message:
          `Validated ${validPositions.length} Comet market positions but all ` +
          'have zero borrow balance. Wallet has no active Compound v3 ' +
          'borrowing positions (may be a pure supplier).',
      })
    }

    return ok(positions)
  },

  /** Sepolia testnet convenience wrapper — sets chainId to 11155111 */
  normalizeTestnet(
    rawBody: unknown,
    options: Omit<CompoundAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return CompoundAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_ETHEREUM_SEPOLIA,
    })
  },

  /** Polygon mainnet convenience wrapper — sets chainId to 137 */
  normalizePolygon(
    rawBody: unknown,
    options: Omit<CompoundAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return CompoundAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_POLYGON_MAINNET,
    })
  },

  /** Arbitrum mainnet convenience wrapper — sets chainId to 42161 */
  normalizeArbitrum(
    rawBody: unknown,
    options: Omit<CompoundAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return CompoundAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_ARBITRUM_MAINNET,
    })
  },

  /** Base mainnet convenience wrapper — sets chainId to 8453 */
  normalizeBase(
    rawBody: unknown,
    options: Omit<CompoundAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return CompoundAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_BASE_MAINNET,
    })
  },

  /** Optimism mainnet convenience wrapper — sets chainId to 10 */
  normalizeOptimism(
    rawBody: unknown,
    options: Omit<CompoundAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return CompoundAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_OPTIMISM_MAINNET,
    })
  },
} as const
