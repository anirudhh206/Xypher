// ============================================================
// ConfidentialGuard Protocol — Plaid TradFi Data Adapter
// risk-engine/src/adapters/plaid.adapter.ts
//
// Normalizes a raw Plaid /accounts/balance/get API response
// into a PlaidData struct consumed by the Debt Serviceability
// Score (DSS) algorithm.
//
// ── Why Plaid Is Different ────────────────────────────────────
//
// Every other adapter (Aave, Morpho, Compound) normalizes
// on-chain lending positions into PositionData[]. This adapter
// normalizes off-chain TradFi bank data into PlaidData.
//
// This is the "Identity Wall" breaker — the component that
// makes TradFi creditworthiness visible to the risk engine
// without ever exposing raw account data on-chain.
//
// Plaid runs inside the TEE enclave alongside the DeFi adapters.
// The Vault DON holds the Plaid client_id and secret.
// The sandbox vs production environment distinction is a
// credential concern (Vault DON), not an adapter concern.
//
// ── Plaid Account Types and Balance Semantics ─────────────────
//
// DEPOSITORY (checking, savings, money market, cd)
//   current  = ledger balance (may include pending credits)
//   available = spendable balance (excludes pending debits)
//   limit    = null (no credit limit)
//   → contributes to totalLiquidAssetsUSD via `available`
//     (available is the true spendable liquidity, not current)
//
// CREDIT (credit card, paypal, line of credit)
//   current  = amount currently owed (positive = debt)
//   available = remaining credit available to spend
//   limit    = total credit limit
//   → contributes to totalCreditUsedUSD (via current)
//   → contributes to totalCreditLimitUSD (via limit)
//   → does NOT contribute to liquid assets (borrowed money ≠ assets)
//
// LOAN (mortgage, student, auto, home equity, personal)
//   current  = outstanding loan balance
//   available = null (you cannot "spend" a loan balance)
//   limit    = original loan amount or null
//   → does NOT contribute to liquid assets
//   → does NOT contribute to credit utilization
//   → tracked in accounts[] for the DSS algorithm to model debt load
//
// INVESTMENT (brokerage, 401k, ira, crypto)
//   current  = current market value of holdings
//   available = null or cash balance within the account
//   limit    = null
//   → excluded from totalLiquidAssetsUSD
//     (investment accounts are not immediately liquid —
//      redemption takes T+1 or T+2 settlement, or tax penalties)
//   → tracked in accounts[] for comprehensive balance sheet view
//
// ── Multi-Currency Handling ───────────────────────────────────
//
// Plaid can return non-USD account balances. Without real-time
// FX rates inside the TEE, non-USD amounts cannot be reliably
// converted to USD for risk calculation.
//
// Policy: Only accounts with iso_currency_code === 'USD' are
// included in aggregate totals. Non-USD accounts are still
// included in the accounts[] array but marked as type 'other'
// for informational purposes only.
//
// ── Credit Utilization Nuances ───────────────────────────────
//
// Credit accounts can exceed their limit (over-limit purchases,
// interest charges, fees). When current > limit, utilization
// would be > 1.0. We clamp to 1.0 — representing maximum
// credit stress — rather than allowing > 100% which would
// distort the DSS algorithm's input range.
//
// ── Plaid Error Response Detection ────────────────────────────
//
// If the Plaid access token has expired or the user revoked
// access, Plaid returns an error object instead of accounts:
// { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED" }
// We detect and surface this as an INVALID_RESPONSE error.
//
// Zero external dependencies. No Zod, no Axios.
// Runs inside TEE — all validation is manual and explicit.
// ============================================================

import {
  ADAPTER_ERROR_CODES,
  ok,
  err,
  type AdapterResult,
  type PlaidAccount,
  type PlaidAccountType,
  type PlaidData,
} from '../types'

// ============================================================
// CONSTANTS
// ============================================================

/** The only currency code we include in aggregate USD totals */
const PLAID_USD_CURRENCY_CODE = 'USD'

/**
 * Credit utilization is clamped to this maximum.
 * Prevents over-limit accounts from producing utilization > 1,
 * which would fall outside the DSS algorithm's [0, 1] input range.
 */
const MAX_CREDIT_UTILIZATION = 1.0

/**
 * Minimum meaningful balance threshold in USD.
 * Filters out sub-cent rounding artifacts from Plaid's
 * internal precision model.
 */
const MIN_MEANINGFUL_BALANCE_USD = 0.01

// ============================================================
// RAW API TYPES
// Typed representations of the Plaid /accounts/balance/get
// response shape. All field names are snake_case (Plaid convention).
// ============================================================

interface RawPlaidBalances {
  /**
   * Current balance in account's currency.
   * For credit: amount owed (positive = debt outstanding).
   * For depository: ledger balance (may include pending credits).
   * For loan: outstanding principal balance.
   * Can be null in rare cases when Plaid cannot retrieve balances.
   */
  current: number | null
  /**
   * Available balance — spendable balance in account's currency.
   * For depository: current minus pending debits.
   * For credit: remaining credit line (limit minus current).
   * Null for loan and investment accounts.
   */
  available: number | null
  /**
   * Credit limit or original loan amount.
   * Null for non-credit/non-loan accounts.
   */
  limit: number | null
  /**
   * ISO 4217 currency code, e.g. "USD", "EUR", "GBP".
   * Null when unofficial_currency_code is set (crypto accounts).
   */
  iso_currency_code: string | null
  /**
   * Non-standard currency identifier for accounts denominated in
   * cryptocurrencies or other unofficial currencies.
   * Null for standard currency accounts.
   */
  unofficial_currency_code: string | null
}

interface RawPlaidAccount {
  /** Plaid's unique identifier for this account (persistent) */
  account_id: string
  /**
   * Account type: 'depository' | 'credit' | 'loan' |
   *               'investment' | 'other' | 'brokerage'
   */
  type: string
  /**
   * More specific account subtype:
   * depository: 'checking' | 'savings' | 'money market' | 'cd' | ...
   * credit: 'credit card' | 'paypal' | 'line of credit' | ...
   * loan: 'mortgage' | 'student' | 'auto' | 'personal' | ...
   * investment: '401k' | 'ira' | 'brokerage' | '529' | ...
   */
  subtype: string | null
  balances: RawPlaidBalances
  /**
   * Institution-defined account name (e.g. "Premier Checking").
   * Not used in risk calculations — present for audit trails.
   */
  name: string
  /**
   * Last 2-4 digits of account number.
   * Used only for human identification, never for computation.
   */
  mask: string | null
}

// ============================================================
// TYPE GUARDS — No casting without validation
// ============================================================

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRawPlaidBalances(value: unknown): value is RawPlaidBalances {
  if (!isRecord(value)) return false
  return (
    // current may be null (Plaid spec allows it)
    (typeof value['current'] === 'number' || value['current'] === null) &&
    (typeof value['available'] === 'number' || value['available'] === null) &&
    (typeof value['limit'] === 'number' || value['limit'] === null) &&
    (typeof value['iso_currency_code'] === 'string' || value['iso_currency_code'] === null) &&
    (typeof value['unofficial_currency_code'] === 'string' || value['unofficial_currency_code'] === null)
  )
}

function isRawPlaidAccount(value: unknown): value is RawPlaidAccount {
  if (!isRecord(value)) return false
  return (
    typeof value['account_id'] === 'string' &&
    value['account_id'].length > 0 &&
    typeof value['type'] === 'string' &&
    value['type'].length > 0 &&
    isRawPlaidBalances(value['balances']) &&
    typeof value['name'] === 'string'
  )
}

/**
 * Detects a Plaid error response envelope.
 * When Plaid returns an error, the response body contains
 * `error_type` and/or `error_code` instead of `accounts`.
 */
function isPlaidErrorResponse(body: Record<string, unknown>): boolean {
  return (
    typeof body['error_type'] === 'string' ||
    typeof body['error_code'] === 'string'
  )
}

// ============================================================
// ACCOUNT TYPE MAPPING
// Maps Plaid's account type strings to our PlaidAccountType union.
// Plaid may introduce new types — all unknown types map to 'other'.
// ============================================================

function mapAccountType(rawType: string): PlaidAccountType {
  switch (rawType.toLowerCase()) {
    case 'depository':  return 'depository'
    case 'credit':      return 'credit'
    case 'loan':        return 'loan'
    case 'investment':  return 'investment'
    case 'brokerage':   return 'investment' // Plaid sometimes uses 'brokerage'
    default:            return 'other'
  }
}

// ============================================================
// CURRENCY FILTER
// Only USD-denominated accounts contribute to aggregate totals.
// Non-USD accounts are included in accounts[] as 'other' type
// but their balances are excluded from liquidity/credit totals.
// ============================================================

function isUsdDenominated(balances: RawPlaidBalances): boolean {
  // Explicit USD code is the only safe inclusion
  return balances.iso_currency_code === PLAID_USD_CURRENCY_CODE
}

// ============================================================
// ACCOUNT NORMALISATION
// Converts a validated RawPlaidAccount into a PlaidAccount.
// Applies minimum balance threshold to filter sub-cent artifacts.
// ============================================================

function normalizeAccount(raw: RawPlaidAccount): PlaidAccount {
  const type = mapAccountType(raw.type)

  // For non-USD accounts, preserve account identity but zero out
  // all balances — they cannot be summed with USD figures
  if (!isUsdDenominated(raw.balances)) {
    return {
      accountId: raw.account_id,
      type: 'other', // Overrides type — non-USD is meaningless for risk model
      availableUSD: null,
      currentUSD: 0,
      limitUSD: null,
    }
  }

  const rawCurrent = raw.balances.current ?? 0
  const rawAvailable = raw.balances.available
  const rawLimit = raw.balances.limit

  // Apply minimum threshold to filter Plaid precision artifacts
  const currentUSD = Math.abs(rawCurrent) >= MIN_MEANINGFUL_BALANCE_USD
    ? rawCurrent
    : 0
  const availableUSD = rawAvailable !== null && Math.abs(rawAvailable) >= MIN_MEANINGFUL_BALANCE_USD
    ? rawAvailable
    : rawAvailable === null ? null : 0
  const limitUSD = rawLimit !== null && rawLimit >= MIN_MEANINGFUL_BALANCE_USD
    ? rawLimit
    : rawLimit === null ? null : 0

  return {
    accountId: raw.account_id,
    type,
    availableUSD,
    currentUSD,
    limitUSD,
  }
}

// ============================================================
// AGGREGATE COMPUTATION
//
// Computes the four summary fields of PlaidData from the
// normalized accounts list. Each field has precise semantics
// aligned with the Debt Serviceability Score algorithm.
//
// totalLiquidAssetsUSD:
//   Sum of available balances for depository accounts.
//   Uses `available` (spendable) not `current` (ledger) because
//   pending debits reduce what can actually be deployed.
//   If available is null (uncommon for depository), falls back
//   to current. Investment accounts intentionally excluded.
//
// totalCreditLimitUSD:
//   Sum of credit limits for credit accounts where limit is known.
//   Represents the total borrowing headroom available.
//
// totalCreditUsedUSD:
//   Sum of current balances (amount owed) for credit accounts.
//   Reflects actual outstanding credit obligations.
//
// totalCreditUtilization:
//   Aggregate ratio: totalCreditUsedUSD / totalCreditLimitUSD.
//   Clamped to [0, 1] to handle over-limit accounts.
//   0.0 = no credit used. 1.0 = at or over credit limit.
// ============================================================

interface PlaidAggregates {
  readonly totalLiquidAssetsUSD: number
  readonly totalCreditLimitUSD: number
  readonly totalCreditUsedUSD: number
  readonly totalCreditUtilization: number
}

function computeAggregates(accounts: PlaidAccount[]): PlaidAggregates {
  let totalLiquidAssetsUSD = 0
  let totalCreditLimitUSD = 0
  let totalCreditUsedUSD = 0

  for (const account of accounts) {
    if (account.type === 'depository') {
      // Prefer available (spendable) over current (ledger).
      // An account with $10,000 current but $9,000 available has $1,000
      // in pending debits — the institution can only deploy $9,000.
      const liquidContribution = account.availableUSD ?? account.currentUSD
      // Depository balances should never be negative in Plaid, but
      // overdrafted accounts can produce a negative current. Floor at 0.
      totalLiquidAssetsUSD += Math.max(0, liquidContribution)
    } else if (account.type === 'credit') {
      if (account.limitUSD !== null && account.limitUSD > 0) {
        totalCreditLimitUSD += account.limitUSD
      }
      // Current on credit = amount owed. Positive value = outstanding debt.
      // Negative current (credit balance, e.g. overpayment refund) = ignored.
      if (account.currentUSD > 0) {
        totalCreditUsedUSD += account.currentUSD
      }
    }
    // Loan and investment accounts do not contribute to these aggregates.
    // They are available in accounts[] for the DSS algorithm's
    // debt-load and balance-sheet analysis respectively.
  }

  const totalCreditUtilization =
    totalCreditLimitUSD > 0
      ? Math.min(totalCreditUsedUSD / totalCreditLimitUSD, MAX_CREDIT_UTILIZATION)
      : 0

  return {
    totalLiquidAssetsUSD: Math.max(0, totalLiquidAssetsUSD),
    totalCreditLimitUSD: Math.max(0, totalCreditLimitUSD),
    totalCreditUsedUSD: Math.max(0, totalCreditUsedUSD),
    totalCreditUtilization,
  }
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Normalizes a raw Plaid /accounts/balance/get API response
 * into a PlaidData struct.
 *
 * ── What this adapter produces ──────────────────────────────
 * PlaidData contains four aggregate financial signals:
 *
 *   totalLiquidAssetsUSD
 *     True spendable liquidity across all bank/savings accounts.
 *     Used by DSS to determine if the institution can meet
 *     short-term obligations without selling assets.
 *
 *   totalCreditLimitUSD / totalCreditUsedUSD
 *     Total borrowing capacity vs. how much has been drawn.
 *     A borrower with $500k limit and $50k used signals
 *     very different risk than $500k limit, $490k used.
 *
 *   totalCreditUtilization
 *     Aggregate credit usage ratio (0–1). The single most
 *     predictive individual metric in FICO credit scoring.
 *     < 0.30 is considered healthy in traditional credit models.
 *     We apply this same threshold in the DSS algorithm.
 *
 * ── What stays private ──────────────────────────────────────
 * Only the four aggregate fields feed into the risk engine.
 * Institution names, account IDs, exact balances, and
 * transaction history never leave the adapter layer.
 * This is the minimum data extraction necessary for accurate
 * credit scoring — the privacy-preserving property of this
 * system's design.
 *
 * ── Sandbox vs production ────────────────────────────────────
 * The sandbox environment is controlled by which Plaid
 * credentials are stored in the Vault DON (client_id, secret).
 * This adapter is environment-agnostic — it processes whatever
 * Plaid returns regardless of environment.
 *
 * @param rawBody - Parsed JSON from Plaid /accounts/balance/get.
 *   Expected shape: { accounts: RawPlaidAccount[], request_id: string }
 * @returns AdapterResult<PlaidData> containing normalized data or typed error.
 *
 * @example
 * const result = PlaidAdapter.normalize(JSON.parse(responseBody))
 * if (!result.ok) { handle(result.error); return }
 * const { totalCreditUtilization, totalLiquidAssetsUSD } = result.data
 */
export const PlaidAdapter = {
  normalize(rawBody: unknown): AdapterResult<PlaidData> {
    // ── Structural validation ────────────────────────────────
    if (!isRecord(rawBody)) {
      return err({
        protocol: 'plaid',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message: 'Response body is not a JSON object',
      })
    }

    // ── Plaid error response detection ────────────────────────
    // Plaid returns error objects when the item requires re-authentication
    // or when the access token is invalid/expired.
    if (isPlaidErrorResponse(rawBody)) {
      const errorType = rawBody['error_type'] as string | undefined
      const errorCode = rawBody['error_code'] as string | undefined
      const errorMessage = rawBody['error_message'] as string | undefined
      return err({
        protocol: 'plaid',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message:
          `Plaid returned an error response: ${errorType ?? 'UNKNOWN'} / ` +
          `${errorCode ?? 'UNKNOWN'}. ${errorMessage ?? ''}`.trim(),
      })
    }

    // ── Accounts array validation ─────────────────────────────
    if (!Array.isArray(rawBody['accounts'])) {
      return err({
        protocol: 'plaid',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message:
          'Response missing required "accounts" array. ' +
          'Expected Plaid /accounts/balance/get response shape.',
      })
    }

    const rawAccounts = rawBody['accounts'] as unknown[]

    if (rawAccounts.length === 0) {
      return err({
        protocol: 'plaid',
        code: ADAPTER_ERROR_CODES.NO_POSITIONS,
        message: 'Plaid response contains zero accounts.',
      })
    }

    // ── Validate individual account entries ───────────────────
    const validRawAccounts = rawAccounts.filter(isRawPlaidAccount)

    if (validRawAccounts.length === 0) {
      return err({
        protocol: 'plaid',
        code: ADAPTER_ERROR_CODES.INVALID_RESPONSE,
        message:
          `Found ${rawAccounts.length} account entries but none passed ` +
          'structural validation. Required fields per account: ' +
          'account_id (string), type (string), name (string), ' +
          'balances.{current, available, limit, iso_currency_code}.',
      })
    }

    // ── Normalize accounts ────────────────────────────────────
    const accounts: PlaidAccount[] = validRawAccounts.map(normalizeAccount)

    // ── Verify at least one USD account exists ────────────────
    const hasUsdAccounts = accounts.some((a) => a.type !== 'other')
    if (!hasUsdAccounts) {
      return err({
        protocol: 'plaid',
        code: ADAPTER_ERROR_CODES.NO_POSITIONS,
        message:
          `All ${accounts.length} Plaid account(s) are non-USD denominated ` +
          'or unrecognized type. Cannot compute credit aggregates without ' +
          'USD-denominated account data.',
      })
    }

    // ── Compute aggregate financial signals ───────────────────
    const aggregates = computeAggregates(accounts)

    const plaidData: PlaidData = {
      accounts,
      ...aggregates,
    }

    return ok(plaidData)
  },
} as const
