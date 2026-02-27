// ============================================================
// ConfidentialGuard Protocol — Morpho Blue Data Adapter
// risk-engine/src/adapters/morpho.adapter.ts
//
// Normalizes raw Morpho Blue GraphQL API response → PositionData[]
//
// ── Morpho Blue key concepts ───────────────────────────────────
//
// ISOLATED MARKETS
//   Unlike Aave's cross-collateral pool, every Morpho Blue market
//   is a fully independent lending pair: one collateral token, one
//   loan token, one oracle, one IRM, one LLTV. A position in
//   market A cannot be liquidated by price movements in market B.
//   This gives the contagion model true per-asset granularity —
//   no proportional debt splitting, no CANONICAL_USD_ASSET.
//
// LLTV (Liquidation Loan-to-Value)
//   Stored on-chain as a WAD (1e18-scaled uint256).
//   e.g. "860000000000000000" → 0.86 (86% LTV at liquidation).
//   Some API layers normalise to a decimal string ("0.86") before
//   returning. Both formats are handled here.
//
// SHARE ACCOUNTING
//   Borrow amounts are tracked as shares to prevent rounding-based
//   inflation attacks. The on-chain conversion formula uses virtual
//   shares to guarantee a 1:1 ratio on the first borrow:
//
//     assets = shares × (totalBorrowAssets + VIRTUAL_ASSETS)
//              ─────────────────────────────────────────────
//              (totalBorrowShares + VIRTUAL_SHARES)
//
//   where VIRTUAL_ASSETS = 1, VIRTUAL_SHARES = 1e6 (Morpho invariant).
//   Reference: MathLib.toAssetsDown in morpho-blue/src/libraries/MathLib.sol
//
//   The API commonly pre-computes `borrowAssets` per position;
//   this adapter prefers that field and falls back to the formula.
//
// MARKET ID (uniqueKey)
//   keccak256(loanToken ‖ collateralToken ‖ oracle ‖ irm ‖ lltv)
//   Immutable. Uniquely identifies a market across the protocol.
//
// RESPONSE SHAPES (multiple handled)
//   1. GraphQL envelope: { data: { userByAddress: { marketPositions: [] } } }
//   2. REST flat array:  { marketPositions: [] }
//   3. REST flat array:  { positions: [] }
//
// Zero external dependencies. No Zod, no Axios.
// Runs inside TEE — all validation is manual and explicit.
// ============================================================

import {
  ADAPTER_ERROR_CODES,
  WEI_PER_TOKEN,
  ok,
  err,
  type AdapterResult,
  type PositionData,
} from '../types'

// ============================================================
// CHAIN IDs — All active Morpho Blue deployments
// ============================================================

const CHAIN_ID_ETHEREUM_MAINNET = 1
const CHAIN_ID_ETHEREUM_SEPOLIA = 11155111
const CHAIN_ID_BASE_MAINNET = 8453
const CHAIN_ID_BASE_SEPOLIA = 84532

// ============================================================
// MORPHO BLUE PROTOCOL CONSTANTS
// Source: github.com/morpho-org/morpho-blue
// ============================================================

/**
 * Virtual assets appended to total borrow assets in the share → asset
 * conversion. Prevents first-depositor share-inflation exploits.
 * Value: 1 (defined as constant in MathLib.toAssetsDown).
 */
const MORPHO_VIRTUAL_ASSETS = 1n

/**
 * Virtual shares appended to total borrow shares in the share → asset
 * conversion. Ensures the initial share-to-asset ratio starts at 1:1
 * and cannot be manipulated below ~1e-6 per share.
 * Value: 1e6 (Morpho Blue protocol invariant).
 */
const MORPHO_VIRTUAL_SHARES = 1_000_000n // 1e6

/**
 * WAD — 1e18, the fixed-point scaling factor for LLTV values as
 * stored in Morpho Blue market parameters on-chain.
 */
const MORPHO_WAD = WEI_PER_TOKEN // 1_000_000_000_000_000_000n

// ============================================================
// EVM ADDRESS VALIDATION
// Morpho market token addresses must be valid EVM addresses.
// Applied during type-guard validation before building PositionData.
// ============================================================

const EVM_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/

function isValidEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && EVM_ADDRESS_REGEX.test(value)
}

// ============================================================
// RAW API TYPES
// Typed representations of the Morpho Blue GraphQL API response.
// Validated by type guards before use. Never used as `unknown`.
// ============================================================

interface RawMorphoToken {
  /** Checksummed ERC-20 contract address */
  address: string
  symbol: string
  decimals: number
}

interface RawMorphoMarketState {
  /**
   * Total borrow assets outstanding across all users in this market.
   * Used to convert borrowShares → borrowAssets when borrowAssets is absent.
   */
  borrowAssets?: string
  /**
   * Total borrow shares outstanding across all users in this market.
   * Denominator in the shares → assets conversion.
   */
  borrowShares?: string
}

interface RawMorphoMarket {
  /**
   * keccak256(loanToken ‖ collateralToken ‖ oracle ‖ irm ‖ lltv).
   * Immutable market identifier. "0x" + 64 hex chars (bytes32).
   */
  uniqueKey: string
  /** The asset being borrowed (loan token = debt side of the position) */
  loanAsset: RawMorphoToken
  /** The asset deposited as collateral (collateral token) */
  collateralAsset: RawMorphoToken
  /**
   * Liquidation LTV in WAD (1e18) or decimal string.
   * On-chain: "860000000000000000" = 0.86
   * API-normalised: "0.8600" = 0.86
   */
  lltv: string
  /** Market aggregate state — required for shares → assets conversion */
  state?: RawMorphoMarketState
}

interface RawMorphoPosition {
  market: RawMorphoMarket
  /** User's borrow shares in this market */
  borrowShares: string
  /**
   * User's outstanding borrow in loan token's native units (wei).
   * Pre-computed by the API including accrued interest.
   * Preferred over shares-based conversion when present.
   * May be absent on older API versions — adapter falls back to formula.
   */
  borrowAssets?: string
  /** User's collateral deposited in this market, in collateral token wei */
  collateral: string
  /**
   * User's lending supply shares in this market (lender role).
   * Non-zero only for users who are lenders (not borrowers).
   * Not used in PositionData — pure supply is not a liquidation risk.
   */
  supplyShares: string
}

// ============================================================
// TYPE GUARDS — No casting without validation
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRawMorphoToken(value: unknown): value is RawMorphoToken {
  if (!isRecord(value)) return false
  return (
    isValidEvmAddress(value['address']) &&
    typeof value['symbol'] === 'string' &&
    value['symbol'].length > 0 &&
    typeof value['decimals'] === 'number' &&
    Number.isInteger(value['decimals']) &&
    value['decimals'] >= 0 &&
    value['decimals'] <= 18
  )
}

function isRawMorphoMarket(value: unknown): value is RawMorphoMarket {
  if (!isRecord(value)) return false
  return (
    typeof value['uniqueKey'] === 'string' &&
    value['uniqueKey'].length > 0 &&
    isRawMorphoToken(value['loanAsset']) &&
    isRawMorphoToken(value['collateralAsset']) &&
    typeof value['lltv'] === 'string' &&
    value['lltv'].length > 0
  )
}

function isRawMorphoPosition(value: unknown): value is RawMorphoPosition {
  if (!isRecord(value)) return false
  return (
    isRawMorphoMarket(value['market']) &&
    typeof value['borrowShares'] === 'string' &&
    typeof value['collateral'] === 'string' &&
    typeof value['supplyShares'] === 'string'
  )
}

// ============================================================
// RESPONSE SHAPE NORMALISATION
//
// Morpho's official GraphQL API at blue-api.morpho.org/graphql
// nests positions under data.userByAddress.marketPositions.
// REST wrappers and custom proxy layers may flatten the structure.
// We probe all known shapes and fall through gracefully.
// ============================================================

function extractRawPositions(body: Record<string, unknown>): unknown[] {
  // Shape 1 — Official GraphQL envelope
  //   { data: { userByAddress: { marketPositions: [...] } } }
  const data = body['data']
  if (isRecord(data)) {
    const user = data['userByAddress']
    if (isRecord(user) && Array.isArray(user['marketPositions'])) {
      return user['marketPositions']
    }
    // Shape 1b — Alternate GraphQL: data.marketPositions (proxy APIs)
    if (Array.isArray(data['marketPositions'])) {
      return data['marketPositions']
    }
  }

  // Shape 2 — REST flat: { marketPositions: [...] }
  if (Array.isArray(body['marketPositions'])) {
    return body['marketPositions']
  }

  // Shape 3 — REST flat: { positions: [...] }
  if (Array.isArray(body['positions'])) {
    return body['positions']
  }

  return []
}

function validatePositions(rawPositions: unknown[]): RawMorphoPosition[] {
  return rawPositions.filter(isRawMorphoPosition)
}

// ============================================================
// LLTV PARSING
//
// Morpho stores LLTV on-chain as WAD (1e18-scaled bigint string).
// e.g. "860000000000000000" → 0.86 (86% liquidation LTV).
//
// Some API layers pre-normalise to a decimal fraction string
// before returning: "0.8600" → 0.86.
//
// Both formats are detected by the presence of a decimal point.
// Values are clamped to [0, 1]; invalid strings return fallback.
// ============================================================

function parseLltvFromWad(raw: string, fallback: number): number {
  if (raw === '') return fallback

  // Decimal fraction format: "0.8600" from API-normalised responses
  if (raw.includes('.')) {
    const fraction = parseFloat(raw)
    if (!isFinite(fraction) || fraction < 0 || fraction > 1) return fallback
    return fraction
  }

  // WAD format: "860000000000000000" from raw GraphQL / on-chain data
  try {
    const wadValue = BigInt(raw)
    if (wadValue < 0n || wadValue > MORPHO_WAD) return fallback
    // 4 decimal places (0.0001 resolution) — sufficient for LTV ratios
    return Number(wadValue * 10_000n / MORPHO_WAD) / 10_000
  } catch {
    // BigInt() throws on non-integer strings (e.g. "0.86" without dot check)
    return fallback
  }
}

// ============================================================
// SHARE → ASSET CONVERSION
//
// Implements MathLib.toAssetsDown from the Morpho Blue contracts.
// Uses virtual shares to prevent first-depositor rounding attacks.
//
//   assets = shares × (totalBorrowAssets + VIRTUAL_ASSETS)
//            ─────────────────────────────────────────────
//            (totalBorrowShares + VIRTUAL_SHARES)
//
// Rounds down (floor division), which is conservative for debt:
// it ensures we never overstate a borrower's debt from rounding.
//
// The denominator is guaranteed ≥ VIRTUAL_SHARES (1e6), so
// division by zero is structurally impossible.
// ============================================================

function computeBorrowAssetsFromShares(
  borrowShares: bigint,
  totalBorrowAssets: bigint,
  totalBorrowShares: bigint,
): bigint {
  const numerator = borrowShares * (totalBorrowAssets + MORPHO_VIRTUAL_ASSETS)
  const denominator = totalBorrowShares + MORPHO_VIRTUAL_SHARES
  return numerator / denominator // bigint division is floor (rounds down)
}

// ============================================================
// BORROW AMOUNT RESOLVER
//
// Strategy:
//   1. Use `borrowAssets` if the API provided it — this is the
//      most accurate value (includes interest accrued since last
//      on-chain interaction, computed from the API's price model).
//   2. Compute from `borrowShares` using the virtual-shares formula
//      with the market's `state.borrowAssets` and `state.borrowShares`
//      as the market totals. Less accurate (uses last checkpoint) but
//      always available from raw GraphQL.
//   3. Return 0n if neither source is parseable (defensive).
// ============================================================

function resolveBorrowAssets(position: RawMorphoPosition): bigint {
  // Preferred path: API-provided borrowAssets (most accurate)
  if (position.borrowAssets !== undefined && position.borrowAssets !== '') {
    try {
      const assets = BigInt(position.borrowAssets)
      if (assets >= 0n) return assets
    } catch { /* non-integer string — fall through */ }
  }

  // Fallback: compute from shares using Morpho virtual-shares formula
  try {
    const borrowShares = BigInt(position.borrowShares)
    if (borrowShares === 0n) return 0n

    const state = position.market.state
    const totalBorrowAssets =
      state?.borrowAssets !== undefined ? BigInt(state.borrowAssets) : 0n
    const totalBorrowShares =
      state?.borrowShares !== undefined ? BigInt(state.borrowShares) : 0n

    return computeBorrowAssetsFromShares(borrowShares, totalBorrowAssets, totalBorrowShares)
  } catch {
    return 0n
  }
}

// ============================================================
// MARKET POSITION BUILDER
//
// Converts a single validated RawMorphoPosition into a PositionData.
//
// Returns null when:
//   - The collateral field cannot be parsed as a bigint.
//   - Both collateral and debt are 0 (pure supplier: has supplyShares
//     but no collateral deposited and no borrow outstanding).
//     Pure supply positions carry no liquidation risk.
//
// liqThreshold = LLTV, the fraction at which the position becomes
// undercollateralised and eligible for liquidation.
// Conservative fallback of 0.77 = median Morpho Blue market LLTV.
// ============================================================

const MORPHO_DEFAULT_LLTV_FALLBACK = 0.77

function buildMarketPosition(
  position: RawMorphoPosition,
  chainId: number,
): PositionData | null {
  let collateralAmount: bigint
  try {
    collateralAmount = BigInt(position.collateral)
  } catch {
    return null // Unparseable collateral — skip position entirely
  }

  const debtAmount = resolveBorrowAssets(position)

  // Skip pure-supply positions: user is a lender only (supplyShares > 0,
  // no collateral deposited, no outstanding borrow)
  if (collateralAmount === 0n && debtAmount === 0n) {
    return null
  }

  const liqThreshold = parseLltvFromWad(
    position.market.lltv,
    MORPHO_DEFAULT_LLTV_FALLBACK,
  )

  return {
    protocol: 'morpho',
    chainId,
    // Normalise addresses to lowercase for consistent map lookups
    collateralAsset: position.market.collateralAsset.address.toLowerCase(),
    collateralAmount,
    debtAsset: position.market.loanAsset.address.toLowerCase(),
    debtAmount,
    liquidationThreshold: liqThreshold,
  }
}

// ============================================================
// PUBLIC API
// ============================================================

export interface MorphoAdapterOptions {
  /**
   * Chain ID of the Morpho Blue deployment being queried.
   * Morpho Blue is deployed on Ethereum mainnet (1), Base (8453),
   * and their respective testnets. Defaults to Ethereum mainnet.
   */
  chainId?: number
}

/**
 * Normalizes a raw Morpho Blue API response into a PositionData array.
 *
 * Each market where the user has collateral deposited OR outstanding
 * borrow produces exactly one PositionData entry. Markets where the
 * user is a pure lender (supplyShares only, no collateral) are
 * excluded — they carry no liquidation risk.
 *
 * Because Morpho Blue markets are fully isolated, the contagion model
 * must treat each PositionData independently. There is no cross-market
 * liquidity pooling that could trigger cascade liquidation across entries
 * — cascade risk must be evaluated purely on individual market health.
 *
 * @param rawBody - Parsed JSON from the Morpho Blue data endpoint.
 *   Supported response shapes:
 *   - GraphQL: { data: { userByAddress: { marketPositions: [...] } } }
 *   - REST:    { marketPositions: [...] }
 *   - REST:    { positions: [...] }
 * @param options - Adapter configuration.
 * @returns AdapterResult containing PositionData[] or a typed error.
 *
 * @example
 * const result = MorphoAdapter.normalize(JSON.parse(responseBody))
 * if (!result.ok) { handle(result.error); return }
 * const positions = result.data  // one entry per active market
 */
export const MorphoAdapter = {
  normalize(
    rawBody: unknown,
    options: MorphoAdapterOptions = {},
  ): AdapterResult<PositionData[]> {
    const chainId = options.chainId ?? CHAIN_ID_ETHEREUM_MAINNET

    // ── Structural validation ────────────────────────────────
    if (!isRecord(rawBody)) {
      return err({
        protocol: 'morpho',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message: 'Response body is not a JSON object',
      })
    }

    // ── Extract positions from any supported response envelope ─
    const rawPositions = extractRawPositions(rawBody)

    if (rawPositions.length === 0) {
      return err({
        protocol: 'morpho',
        code: ADAPTER_ERROR_CODES.NO_POSITIONS,
        message:
          'No market positions array found in response. ' +
          'Expected one of: data.userByAddress.marketPositions, ' +
          'marketPositions, or positions.',
      })
    }

    // ── Validate individual position entries ──────────────────
    const validPositions = validatePositions(rawPositions)

    if (validPositions.length === 0) {
      return err({
        protocol: 'morpho',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message:
          `Found ${rawPositions.length} raw position entries but none passed ` +
          'structural validation. Required fields per entry: ' +
          'market.uniqueKey, market.loanAsset.{address,symbol,decimals}, ' +
          'market.collateralAsset.{address,symbol,decimals}, market.lltv, ' +
          'borrowShares, collateral, supplyShares.',
      })
    }

    // ── Build per-market PositionData entries ─────────────────
    const positions: PositionData[] = []

    for (const position of validPositions) {
      const positionData = buildMarketPosition(position, chainId)
      if (positionData !== null) {
        positions.push(positionData)
      }
    }

    if (positions.length === 0) {
      return err({
        protocol: 'morpho',
        code: ADAPTER_ERROR_CODES.NO_POSITIONS,
        message:
          `Validated ${validPositions.length} position entries but all are ` +
          'pure supply positions (no collateral deposited, no outstanding borrow). ' +
          'Wallet has no active Morpho Blue borrowing positions.',
      })
    }

    return ok(positions)
  },

  /** Sepolia testnet convenience wrapper — sets chainId to 11155111 */
  normalizeTestnet(
    rawBody: unknown,
    options: Omit<MorphoAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return MorphoAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_ETHEREUM_SEPOLIA,
    })
  },

  /** Base mainnet convenience wrapper — sets chainId to 8453 */
  normalizeBase(
    rawBody: unknown,
    options: Omit<MorphoAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return MorphoAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_BASE_MAINNET,
    })
  },

  /** Base Sepolia testnet convenience wrapper — sets chainId to 84532 */
  normalizeBaseSepolia(
    rawBody: unknown,
    options: Omit<MorphoAdapterOptions, 'chainId'> = {},
  ): AdapterResult<PositionData[]> {
    return MorphoAdapter.normalize(rawBody, {
      ...options,
      chainId: CHAIN_ID_BASE_SEPOLIA,
    })
  },
} as const
