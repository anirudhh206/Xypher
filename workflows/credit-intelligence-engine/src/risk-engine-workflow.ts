// ============================================================
// ConfidentialGuard Protocol — Risk Engine Workflow
// workflows/credit-intelligence-engine/src/risk-engine-workflow.ts
//
// PRIMARY WORKFLOW — fires on PermissionGranted(address indexed subject)
//
// TRIGGER
//   Log trigger on ConfidentialGuardAttestation.sol
//   Event: PermissionGranted(address indexed subject)
//   This fires every time a user calls grantPermission().
//
// PIPELINE (inside TEE)
//   1. Extract subject address from log topics[1]
//   2. Aggregate positions across Aave, Morpho, Compound, Plaid
//   3. Fetch live prices from Chainlink Data Feeds (callContract)
//   4. Compute CreditScoreDetails via risk engine
//   5. Mint on-chain attestation with mintAttestation(subject, tier)
//
// PRIVACY GUARANTEE
//   Steps 2–4 compute the full financial picture inside the TEE.
//   Only `tier` (uint8 1–5) is written on-chain. No position
//   amounts, health factors, or raw scores are ever exposed.
// ============================================================

import {
  EVMClient,
  hexToBase64,
  bytesToHex,
  encodeCallMsg,
  type EVMLog,
} from '@chainlink/cre-sdk'
import { handler } from '@chainlink/cre-sdk'
import type { Runtime } from '@chainlink/cre-sdk'
import {
  keccak256,
  stringToBytes,
  type Address,
  encodeFunctionData,
  decodeAbiParameters,
} from 'viem'
import {
  computeCreditScore,
  buildPriceMap,
} from '@confidential-guard/risk-engine'
import type { WorkflowConfig } from './config'
import { aggregatePositions } from './position-aggregator'
import { mintAttestation } from './attestation-minter'

// ── Constants ─────────────────────────────────────────────────

const SEPOLIA_CHAIN_SELECTOR =
  EVMClient.SUPPORTED_CHAIN_SELECTORS['ethereum-testnet-sepolia']

// Event topic: keccak256("PermissionGranted(address)")
const PERMISSION_GRANTED_TOPIC: string = keccak256(
  stringToBytes('PermissionGranted(address)'),
)

// Chainlink ETH/USD Price Feed on Sepolia
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses
const ETH_USD_FEED_SEPOLIA = '0x694AA1769357215DE4FAC081bf1f309aDC325306' as Address
const BTC_USD_FEED_SEPOLIA = '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43' as Address

// latestRoundData() ABI — only the fields we use
const LATEST_ROUND_DATA_ABI = [
  {
    name: 'latestRoundData',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'roundId', type: 'uint80' },
      { name: 'answer', type: 'int256' },
      { name: 'startedAt', type: 'uint256' },
      { name: 'updatedAt', type: 'uint256' },
      { name: 'answeredInRound', type: 'uint80' },
    ],
  },
] as const

// Well-known token addresses on Sepolia (for price map keying)
const WETH_ADDRESS_SEPOLIA = '0xdd13e55209fd76afe204dbda4007c227904f0a81'
const WBTC_ADDRESS_SEPOLIA = '0x29f2d40b0605204364af54ec677bd022da425d03'

// ── Helpers ───────────────────────────────────────────────────

/**
 * Extracts the subject address from the PermissionGranted log.
 *
 * topics[0] = event signature hash  (32 bytes)
 * topics[1] = indexed `subject`     (32 bytes, left-padded address)
 *
 * We strip the 12 zero-padding bytes and take the last 20 bytes as hex.
 */
function extractSubjectFromLog(log: EVMLog, runtime: Runtime<WorkflowConfig>): Address | null {
  if (log.topics.length < 2) {
    runtime.log('[RiskEngineWorkflow] Log missing indexed subject topic')
    return null
  }

  // topics[1] is the 32-byte ABI-encoded address (0x000...0<address>)
  const topicHex = bytesToHex(log.topics[1])
  // Last 40 hex chars = 20 bytes = Ethereum address
  const address = `0x${topicHex.slice(-40)}` as Address

  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    runtime.log(`[RiskEngineWorkflow] Could not parse subject from topic: ${topicHex}`)
    return null
  }

  return address
}

/**
 * Fetches a Chainlink Data Feed answer using EVMClient.callContract.
 * Returns the answer scaled to 1e18 (wei), or null on failure.
 *
 * Chainlink feeds return int256 scaled to 8 decimals.
 * We scale up to 1e18 by multiplying by 1e10.
 */
function fetchChainlinkPrice(
  evmClient: EVMClient,
  runtime: Runtime<WorkflowConfig>,
  feedAddress: Address,
  symbol: string,
): bigint | null {
  try {
    const calldata = encodeFunctionData({
      abi: LATEST_ROUND_DATA_ABI,
      functionName: 'latestRoundData',
    })

    const reply = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: '0x0000000000000000000000000000000000000000',
          to: feedAddress,
          data: calldata,
        }),
      })
      .result()

    if (reply.data.length === 0) {
      runtime.log(`[RiskEngineWorkflow] Empty callContract reply for ${symbol} feed`)
      return null
    }

    const [, answer] = decodeAbiParameters(
      [
        { name: 'roundId', type: 'uint80' },
        { name: 'answer', type: 'int256' },
        { name: 'startedAt', type: 'uint256' },
        { name: 'updatedAt', type: 'uint256' },
        { name: 'answeredInRound', type: 'uint80' },
      ],
      bytesToHex(reply.data),
    )

    if (answer <= 0n) {
      runtime.log(`[RiskEngineWorkflow] Invalid ${symbol} price: ${answer}`)
      return null
    }

    // Chainlink answer is int256 with 8 decimals → scale to 1e18
    const priceWei = BigInt(answer) * 10_000_000_000n // × 1e10
    runtime.log(`[RiskEngineWorkflow] ${symbol}/USD = ${priceWei}`)
    return priceWei
  } catch (err: unknown) {
    runtime.log(`[RiskEngineWorkflow] Failed to fetch ${symbol} price: ${String(err)}`)
    return null
  }
}

// ── Trigger ───────────────────────────────────────────────────

/**
 * Creates the log trigger for PermissionGranted events.
 * The trigger fires every time a user calls grantPermission().
 */
export function createRiskEngineTrigger(config: WorkflowConfig) {
  const evmClient = new EVMClient(SEPOLIA_CHAIN_SELECTOR)

  return evmClient.logTrigger({
    // 20-byte contract address, base64-encoded for protobuf JSON
    addresses: [hexToBase64(config.attestationContractAddress)],
    topics: [
      // topics[0] must match PermissionGranted(address) event signature
      { values: [hexToBase64(PERMISSION_GRANTED_TOPIC)] },
    ],
  })
}

// ── Handler ───────────────────────────────────────────────────

/**
 * Main TEE handler — executes the full credit assessment pipeline.
 *
 * Called by the CRE runner whenever a PermissionGranted log is
 * detected on the attestation contract.
 */
export function riskEngineHandler(
  runtime: Runtime<WorkflowConfig>,
  log: EVMLog,
): string {
  runtime.log('[RiskEngineWorkflow] ═══ Credit Assessment Started ═══')

  // ── Step 1: Extract subject ───────────────────────────────
  const subject = extractSubjectFromLog(log, runtime)
  if (subject === null) {
    runtime.log('[RiskEngineWorkflow] Aborting: could not extract subject address')
    return JSON.stringify({ ok: false, reason: 'invalid_log' })
  }

  runtime.log(`[RiskEngineWorkflow] Subject: ${subject}`)

  // ── Step 2: Aggregate positions (Aave + Morpho + Compound + Plaid) ──
  const { positions, plaidData } = aggregatePositions(runtime, subject)

  if (positions.length === 0 && plaidData === null) {
    runtime.log('[RiskEngineWorkflow] No positions or Plaid data — skipping mint')
    return JSON.stringify({ ok: false, reason: 'no_data', subject })
  }

  // ── Step 3: Fetch live prices from Chainlink Data Feeds ───
  const evmClient = new EVMClient(SEPOLIA_CHAIN_SELECTOR)

  const ethPrice = fetchChainlinkPrice(evmClient, runtime, ETH_USD_FEED_SEPOLIA, 'ETH')
  const btcPrice = fetchChainlinkPrice(evmClient, runtime, BTC_USD_FEED_SEPOLIA, 'BTC')

  const rawPrices: Record<string, bigint> = {}
  if (ethPrice !== null) rawPrices[WETH_ADDRESS_SEPOLIA] = ethPrice
  if (btcPrice !== null) rawPrices[WBTC_ADDRESS_SEPOLIA] = btcPrice

  // CANONICAL_USD_ASSET is always $1.00 — set in buildPriceMap automatically
  const prices = buildPriceMap(rawPrices)

  // ── Step 4: Compute Confidential Credit Score ─────────────
  runtime.log('[RiskEngineWorkflow] Computing credit score inside TEE...')

  const scoreDetails = computeCreditScore(positions, prices, plaidData)

  runtime.log(
    `[RiskEngineWorkflow] ` +
    `UHF=${scoreDetails.creditScore.unifiedHealthFactor.toFixed(4)} ` +
    `Tier=${scoreDetails.creditScore.tier} ` +
    `Contagion=${scoreDetails.creditScore.contagionRiskScore} ` +
    `DSS=${scoreDetails.creditScore.debtServiceabilityScore} ` +
    `CascadeAt=${(scoreDetails.creditScore.cascadeThreshold * 100).toFixed(1)}%`,
  )

  // ── Step 5: Mint on-chain attestation ─────────────────────
  // ONLY `tier` goes on-chain. All other scores are discarded here.
  try {
    mintAttestation(runtime, subject, scoreDetails.creditScore.tier)
    runtime.log(
      `[RiskEngineWorkflow] ✓ Attestation minted — ` +
      `subject=${subject} tier=${scoreDetails.creditScore.tier}`,
    )
  } catch (err: unknown) {
    runtime.log(`[RiskEngineWorkflow] Mint failed: ${String(err)}`)
    return JSON.stringify({
      ok: false,
      reason: 'mint_failed',
      subject,
      error: String(err),
    })
  }

  runtime.log('[RiskEngineWorkflow] ═══ Credit Assessment Complete ═══')

  return JSON.stringify({
    ok: true,
    subject,
    tier: scoreDetails.creditScore.tier,
  })
}

// ── Handler Entry ─────────────────────────────────────────────

export { handler }
