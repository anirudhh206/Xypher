// ============================================================
// ConfidentialGuard Protocol — Position Aggregator
// workflows/credit-intelligence-engine/src/position-aggregator.ts
//
// Runs inside the TEE enclave. Uses ConfidentialHTTPClient to
// query Aave, Morpho, Compound, and Plaid — all in a single
// execution. Credentials for Plaid are injected from Vault DON
// at runtime; DeFi endpoints are public.
//
// Returns:
//   positions  — normalized PositionData[] (empty if no active positions)
//   plaidData  — PlaidData | null (null if unavailable or error)
//
// PRIVACY: No raw wallet addresses or dollar amounts are logged.
// Only keccak256 prefix tags and aggregate counts appear in logs.
// ============================================================

import {
  ConfidentialHTTPClient,
  json,
  ok as isHttpOk,
} from '@chainlink/cre-sdk'
import type { Runtime } from '@chainlink/cre-sdk'
import {
  AaveAdapter,
  MorphoAdapter,
  CompoundAdapter,
  PlaidAdapter,
  type PositionData,
  type PlaidData,
  ADAPTER_ERROR_CODES,
} from '@confidential-guard/risk-engine'
import { keccak256, toBytes } from 'viem'
import type { WorkflowConfig } from './config'

// ── Privacy helper ────────────────────────────────────────────
// Never log raw wallet addresses from a TEE workflow.
// 5-byte keccak256 prefix gives traceability without exposure.
const tag = (addr: string): string => keccak256(toBytes(addr)).slice(0, 12)

// ── Internal Types ────────────────────────────────────────────

export interface AggregatedPositions {
  readonly positions: readonly PositionData[]
  readonly plaidData: PlaidData | null
}

// ── Helpers ───────────────────────────────────────────────────

/**
 * Sends a confidential GET request inside the TEE and parses the JSON body.
 * Returns null on non-2xx status or any parse error — never throws.
 *
 * Note: relies on ConfidentialHTTPClient default timeout.
 * If undefined, a hanging upstream could stall the entire scan.
 */
function confGet(
  confHttp: ConfidentialHTTPClient,
  runtime: Runtime<WorkflowConfig>,
  url: string,
  protocolName: string,
  subjectTag: string,
): unknown | null {
  try {
    const response = confHttp
      .sendRequest(runtime, {
        request: { url, method: 'GET' },
        vaultDonSecrets: [],
      })
      .result()

    if (!isHttpOk(response)) {
      runtime.log(
        `[PositionAggregator] Non-2xx (${response.statusCode}) from ${protocolName} for ${subjectTag}…`,
      )
      return null
    }

    return json(response)
  } catch (err: unknown) {
    runtime.log(
      `[PositionAggregator] HTTP error fetching ${protocolName} for ${subjectTag}…: ${String(err)}`,
    )
    return null
  }
}

/**
 * Sends a confidential POST request inside the TEE with a JSON body.
 * Injects Plaid credentials from Vault DON.
 * Returns null on failure — never throws.
 *
 * Note: relies on ConfidentialHTTPClient default timeout.
 */
function confPost(
  confHttp: ConfidentialHTTPClient,
  runtime: Runtime<WorkflowConfig>,
  url: string,
  bodyJson: string,
  secretKey: string,
  secretNamespace: string,
): unknown | null {
  try {
    const response = confHttp
      .sendRequest(runtime, {
        request: {
          url,
          method: 'POST',
          body: { case: 'bodyString', value: bodyJson },
        },
        vaultDonSecrets: [{ key: secretKey, namespace: secretNamespace }],
      })
      .result()

    if (!isHttpOk(response)) {
      runtime.log(
        `[PositionAggregator] Non-2xx (${response.statusCode}) from Plaid`,
      )
      return null
    }

    return json(response)
  } catch (err: unknown) {
    runtime.log(
      `[PositionAggregator] Plaid HTTP error: ${String(err)}`,
    )
    return null
  }
}

// ── Protocol Fetchers ─────────────────────────────────────────

function fetchAavePositions(
  confHttp: ConfidentialHTTPClient,
  runtime: Runtime<WorkflowConfig>,
  subject: string,
  subjectTag: string,
): PositionData[] {
  const url = `${runtime.config.aaveApiUrl}/v1/users/${subject}`
  runtime.log(`[PositionAggregator] Fetching Aave for ${subjectTag}…`)

  const raw = confGet(confHttp, runtime, url, 'Aave', subjectTag)
  if (raw === null) return []

  const result = AaveAdapter.normalize(raw, {
    chainId: 11155111, // Ethereum Sepolia
    useIndividualReserves: true,
  })

  if (!result.ok) {
    if (result.error.code !== ADAPTER_ERROR_CODES.NO_POSITIONS) {
      runtime.log(`[PositionAggregator] Aave adapter error: ${result.error.message}`)
    }
    return []
  }

  runtime.log(`[PositionAggregator] Aave: ${result.data.length} position(s)`)
  return result.data
}

function fetchMorphoPositions(
  confHttp: ConfidentialHTTPClient,
  runtime: Runtime<WorkflowConfig>,
  subject: string,
  subjectTag: string,
): PositionData[] {
  // Morpho Blue uses a REST endpoint; GraphQL variant is also supported
  // by the adapter but the REST endpoint is simpler for ConfidentialHTTP.
  const url = `${runtime.config.morphoApiUrl}/v1/users/${subject}/positions`
  runtime.log(`[PositionAggregator] Fetching Morpho for ${subjectTag}…`)

  const raw = confGet(confHttp, runtime, url, 'Morpho', subjectTag)
  if (raw === null) return []

  const result = MorphoAdapter.normalize(raw, {
    chainId: 11155111,
  })

  if (!result.ok) {
    if (result.error.code !== ADAPTER_ERROR_CODES.NO_POSITIONS) {
      runtime.log(`[PositionAggregator] Morpho adapter error: ${result.error.message}`)
    }
    return []
  }

  runtime.log(`[PositionAggregator] Morpho: ${result.data.length} position(s)`)
  return result.data
}

function fetchCompoundPositions(
  confHttp: ConfidentialHTTPClient,
  runtime: Runtime<WorkflowConfig>,
  subject: string,
  subjectTag: string,
): PositionData[] {
  const url = `${runtime.config.compoundApiUrl}/v1/accounts/${subject}`
  runtime.log(`[PositionAggregator] Fetching Compound for ${subjectTag}…`)

  const raw = confGet(confHttp, runtime, url, 'Compound', subjectTag)
  if (raw === null) return []

  const result = CompoundAdapter.normalize(raw, {
    chainId: 11155111,
  })

  if (!result.ok) {
    if (result.error.code !== ADAPTER_ERROR_CODES.NO_POSITIONS) {
      runtime.log(`[PositionAggregator] Compound adapter error: ${result.error.message}`)
    }
    return []
  }

  runtime.log(`[PositionAggregator] Compound: ${result.data.length} position(s)`)
  return result.data
}

function fetchPlaidData(
  confHttp: ConfidentialHTTPClient,
  runtime: Runtime<WorkflowConfig>,
): PlaidData | null {
  // Plaid /accounts/balance/get requires a POST with access_token.
  // The access_token is injected by Vault DON via vaultDonSecrets —
  // this body is a template; the DON substitutes {{secret.plaidToken}}.
  const body = JSON.stringify({
    client_id: '{{secret.plaidClientId}}',
    secret: '{{secret.plaidSecret}}',
  })

  const url = `${runtime.config.plaidApiUrl}/accounts/balance/get`
  runtime.log('[PositionAggregator] Fetching Plaid balance data')

  const raw = confPost(
    confHttp,
    runtime,
    url,
    body,
    runtime.config.plaidSecretKey,
    runtime.config.plaidSecretNamespace,
  )

  if (raw === null) return null

  const result = PlaidAdapter.normalize(raw)

  if (!result.ok) {
    runtime.log(`[PositionAggregator] Plaid adapter error: ${result.error.message}`)
    return null
  }

  // Privacy: log only account count — never dollar amounts
  runtime.log(
    `[PositionAggregator] Plaid: ${result.data.accounts.length} account(s) aggregated`,
  )
  return result.data
}

// ── Main Export ───────────────────────────────────────────────

/**
 * Aggregates all DeFi + TradFi positions for a given subject address.
 *
 * Runs entirely inside the TEE. Protocol failures are non-fatal.
 * The caller is responsible for checking whether the result is
 * actionable (positions.length > 0 or plaidData !== null).
 *
 * Note: CRE TEE runtime executes these fetches sequentially.
 * If ConfidentialHTTPClient gains concurrent request support,
 * these can be parallelised for ~4x throughput improvement.
 */
export function aggregatePositions(
  runtime: Runtime<WorkflowConfig>,
  subject: string,
): AggregatedPositions {
  const subjectTag = tag(subject)
  runtime.log(`[PositionAggregator] Starting aggregation for ${subjectTag}…`)

  const confHttp = new ConfidentialHTTPClient()

  const aavePositions = fetchAavePositions(confHttp, runtime, subject, subjectTag)
  const morphoPositions = fetchMorphoPositions(confHttp, runtime, subject, subjectTag)
  const compoundPositions = fetchCompoundPositions(confHttp, runtime, subject, subjectTag)
  const plaidData = fetchPlaidData(confHttp, runtime)

  const positions: PositionData[] = [
    ...aavePositions,
    ...morphoPositions,
    ...compoundPositions,
  ]

  runtime.log(
    `[PositionAggregator] Aggregation complete: ` +
    `${positions.length} position(s), Plaid: ${plaidData !== null ? 'ok' : 'unavailable'}`,
  )

  return {
    positions,
    plaidData,
  }
}
