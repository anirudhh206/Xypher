
export const PROTOCOLS = ['aave', 'morpho', 'compound'] as const
export type Protocol = (typeof PROTOCOLS)[number]
export const TIER_MIN = 1 as const
export const TIER_MAX = 5 as const
export type CreditTier = 1 | 2 | 3 | 4 | 5

/** Tier 1 threshold: institutional-grade credit */
export const HF_INSTITUTIONAL = 3.0
/** Tier 2 threshold: strong credit */
export const HF_STRONG = 2.0
/** Tier 3 threshold: adequate credit */
export const HF_ADEQUATE = 1.5
/** Tier 4 threshold: weak credit, overcollateralized lending only */
export const HF_WEAK = 1.2
/** Below this: no new credit, at risk of liquidation */

export const HF_CRITICAL = 1.0
export const CONTAGION_THRESHOLD_TIER_1 = 20
export const CONTAGION_THRESHOLD_TIER_2 = 40
export const CONTAGION_THRESHOLD_TIER_3 = 60
export const CONTAGION_THRESHOLD_TIER_4 = 75
export const CONTAGION_SCORE_MAX = 100
export const DSS_THRESHOLD_TIER_1 = 90
export const DSS_THRESHOLD_TIER_2 = 75
export const DSS_THRESHOLD_TIER_3 = 60
export const DSS_THRESHOLD_TIER_4 = 40
export const DSS_MAX = 100

/** 1e18 — standard 18-decimal ERC-20 token unit in wei */
export const WEI_PER_TOKEN = 1_000_000_000_000_000_000n

/** Basis points divisor (10 000 = 100.00%) */
export const BASIS_POINTS_DIVISOR = 10_000n

/** Attestation validity period in seconds (24 hours) */
export const ATTESTATION_VALIDITY_SECONDS = 86_400n

export const PRICE_DROP_SCENARIOS = [
  0.05, 0.10, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50,
] as const
export type PriceDropScenario = (typeof PRICE_DROP_SCENARIOS)[number]

export const CANONICAL_USD_ASSET =
  '0x0000000000000000000000000000000000000001' as const

// ============================================================
// POSITION DATA
// The unified representation of a single on-chain lending
// position. One entry per independent market/vault.
//
// All token amounts are in wei (bigint) for exact arithmetic.
// Never use `number` for on-chain values — floating point
// precision errors in risk calculations are unacceptable.
// ============================================================

export interface PositionData {
  readonly protocol: Protocol
  readonly chainId: number
  /** Checksummed ERC-20 token address of the collateral asset */
  readonly collateralAsset: string
  /** Collateral amount in wei */
  readonly collateralAmount: bigint
  /** Checksummed ERC-20 token address of the debt asset */
  readonly debtAsset: string
  /** Debt amount in wei */
  readonly debtAmount: bigint
  /**
   * Liquidation threshold as a fraction (0–1).
   * e.g. 0.825 means the position is liquidated when
   * collateral value drops to 82.5% of its deposit value.
   */
  readonly liquidationThreshold: number
}

// ============================================================
// PRICE MAP
// Maps asset address (lowercase) → USD price scaled to 1e18.
// i.e. $1.00 USD = 1_000_000_000_000_000_000n
// Sourced from Chainlink Data Feeds inside the TEE.
// ============================================================

export type PriceMap = Readonly<Record<string, bigint>>

// ============================================================
// PLAID DATA
// Normalized TradFi balance and cash-flow data from Plaid.
// Used exclusively by the Debt Serviceability Score algorithm.
// Raw Plaid responses never leave the adapter layer.
// ============================================================

export type PlaidAccountType =
  | 'depository'
  | 'credit'
  | 'loan'
  | 'investment'
  | 'other'

export interface PlaidAccount {
  readonly accountId: string
  readonly type: PlaidAccountType
  /** Available balance in USD (null if not reported) */
  readonly availableUSD: number | null
  /** Current balance in USD */
  readonly currentUSD: number
  /** Credit/loan limit in USD (null for non-credit accounts) */
  readonly limitUSD: number | null
}

export interface PlaidData {
  readonly accounts: readonly PlaidAccount[]
  /** Sum of available balances across all depository accounts */
  readonly totalLiquidAssetsUSD: number
  /** Sum of all credit limits across credit accounts */
  readonly totalCreditLimitUSD: number
  /** Sum of current balances across credit accounts (amount owed) */
  readonly totalCreditUsedUSD: number
  /**
   * Overall credit utilization ratio (0–1).
   * 0 = no credit used, 1 = all credit maxed out.
   * Returns 0 when totalCreditLimitUSD is 0.
   */
  readonly totalCreditUtilization: number
}

// ============================================================
// CREDIT SCORE
// Full output of the risk engine. Stays inside the TEE.
// Only `tier` is ever written on-chain.
// ============================================================

export interface CreditScore {
  /** Weighted aggregate health factor across all positions */
  readonly unifiedHealthFactor: number
  /** Credit tier 1–5. The ONLY value that goes on-chain. */
  readonly tier: CreditTier
  /** Debt serviceability score 0–100 from Plaid cash-flow data */
  readonly debtServiceabilityScore: number
  /** Contagion risk score 0–100 (higher = more dangerous) */
  readonly contagionRiskScore: number

  readonly cascadeThreshold: number
}

// ============================================================
// ATTESTATION VIEW
// Returned by ConfidentialGuardAttestation.sol verifyAttestation().
// Read-only view of on-chain state. No financial data exposed.
// ============================================================

export interface AttestationView {
  readonly tier: CreditTier
  /** block.timestamp when the attestation was minted */
  readonly timestamp: bigint
  /** block.timestamp + 24h — hard expiry enforced on-chain */
  readonly expiry: bigint
  readonly active: boolean
}

// ============================================================
// ADAPTER RESULT
// Typed result/error union returned by every adapter function.
// Never throws. All failure modes are explicit.
// ============================================================

export type AdapterResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: AdapterError }

export type AdapterProtocol = Protocol | 'plaid'

export interface AdapterError {
  readonly protocol: AdapterProtocol
  readonly code: AdapterErrorCode
  readonly message: string
  /** HTTP status code when the failure came from a non-2xx response */
  readonly statusCode?: number
}

export const ADAPTER_ERROR_CODES = {
  /** Network-level failure before a response was received */
  NETWORK_ERROR: 'NETWORK_ERROR',
  /** Response received but structure does not match expected schema */
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  /** Response received but JSON parsing failed */
  PARSE_ERROR: 'PARSE_ERROR',
  /** API rate limit exceeded (HTTP 429) */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Wallet address not found in the protocol (HTTP 404) */
  NOT_FOUND: 'NOT_FOUND',
  /** Wallet has no active positions in this protocol */
  NO_POSITIONS: 'NO_POSITIONS',
} as const

export type AdapterErrorCode =
  (typeof ADAPTER_ERROR_CODES)[keyof typeof ADAPTER_ERROR_CODES]

// ============================================================
// RESULT CONSTRUCTORS
// Typed helpers — use these instead of constructing literals.
// ============================================================

export const ok = <T>(data: T): AdapterResult<T> =>
  ({ ok: true, data }) as const

export const err = <T>(error: AdapterError): AdapterResult<T> =>
  ({ ok: false, error }) as const
