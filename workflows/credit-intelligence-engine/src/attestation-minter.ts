import {
  EVMClient,
  TxStatus,
  prepareReportRequest,
  hexToBase64,
} from '@chainlink/cre-sdk'
import type { Runtime } from '@chainlink/cre-sdk'
import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from 'viem'
import type { CreditTier } from '@confidential-guard/risk-engine'
import type { WorkflowConfig } from './config'

// ── ABI ───────────────────────────────────────────────────────
const MINT_ATTESTATION_ABI = [
  {
    name: 'mintAttestation',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'subject', type: 'address' },
      { name: 'tier', type: 'uint8' },
    ],
    outputs: [],
  },
] as const

// ── Constants ─────────────────────────────────────────────────
const VALID_TIERS = [1, 2, 3, 4, 5] as const
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

// ── Types ─────────────────────────────────────────────────────

/**
 * Result returned by mintAttestation.
 * Caller (risk-engine-workflow.ts) uses txStatus to decide
 * whether to retry or escalate.
 */
export interface MintAttestationResult {
  txStatus: TxStatus
  subject:  Address
  tier:     CreditTier
}

// ── Core Function ─────────────────────────────────────────────

/**
 * Mints an on-chain attestation for the given subject address.
 *
 * Flow:
 *   1. Validate inputs (tier range, non-zero subject)
 *   2. ABI-encode calldata for mintAttestation(address, uint8)
 *   3. TEE signs calldata via CRE report pipeline
 *   4. EVMClient submits DON-signed report to on-chain contract
 *   5. Validate txStatus — throws on failure so caller can retry
 *
 * Privacy note: subject address is never logged in plaintext.
 * Only a 5-byte keccak256 prefix is logged for traceability.
 *
 * @param runtime  - CRE runtime (provides config, report, log)
 * @param subject  - The wallet address being attested
 * @param tier     - Credit tier 1–5. This is the ONLY value written on-chain.
 *
 * @returns MintAttestationResult with txStatus for caller to inspect
 * @throws  if inputs are invalid, report signing fails, or TX is not confirmed
 */
export function mintAttestation(
  runtime: Runtime<WorkflowConfig>,
  subject: Address,
  tier:    CreditTier,
): MintAttestationResult {

  // ── Step 0: Input validation ───────────────────────────────
  // Validate before encoding — catches bad input before wasting
  // a DON signature on a call that will revert on-chain.

  if (!subject || subject === ZERO_ADDRESS) {
    throw new Error('[AttestationMinter] Invalid subject: zero address')
  }

  if (!VALID_TIERS.includes(tier as typeof VALID_TIERS[number])) {
    throw new Error(`[AttestationMinter] Invalid tier: ${tier}. Must be 1–5.`)
  }

  const contractAddress = runtime.config.attestationContractAddress as Address

  if (!contractAddress || contractAddress === ZERO_ADDRESS) {
    throw new Error('[AttestationMinter] attestationContractAddress not configured')
  }

  // Privacy: log a 5-byte hash prefix, never the raw address
  const subjectTag = keccak256(toBytes(subject)).slice(0, 12)

  runtime.log(
    `[AttestationMinter] Minting tier ${tier} attestation ` +
    `for subject ${subjectTag}… on contract ${contractAddress}`,
  )

  // ── Step 1: ABI-encode calldata ────────────────────────────
  const calldata: Hex = encodeFunctionData({
    abi:          MINT_ATTESTATION_ABI,
    functionName: 'mintAttestation',
    args:         [subject, tier],
  })

  runtime.log(`[AttestationMinter] Calldata: ${calldata.slice(0, 18)}…`)

  // ── Step 2: TEE signs the calldata ─────────────────────────
  // prepareReportRequest wraps the hex calldata with the EVM encoder
  // parameters expected by the CRE report pipeline.
  const report = runtime.report(prepareReportRequest(calldata)).result()

  runtime.log('[AttestationMinter] Report signed by DON quorum')

  // ── Step 3: Resolve chain selector from config ─────────────
  // Derive from runtime.config so this works across deployments
  // (Sepolia, mainnet, Base) without code changes.
  // Falls back to Sepolia for local dev / hackathon environment.
  type ChainName = keyof typeof EVMClient.SUPPORTED_CHAIN_SELECTORS
  const chainSelectorName = (runtime.config.chainSelectorName ?? 'ethereum-testnet-sepolia') as ChainName
  const chainSelector = EVMClient.SUPPORTED_CHAIN_SELECTORS[chainSelectorName]

  if (!chainSelector) {
    throw new Error(
      `[AttestationMinter] Unsupported chainSelectorName: ${chainSelectorName}`
    )
  }

  // ── Step 4: Submit to on-chain contract ────────────────────
  // receiver = attestation contract address (base64-encoded).
  // EVMClient decodes the DON-signed report and calls mintAttestation().
  // The onlyWorkflow modifier on-chain validates the CRE sender.
  const evmClient  = new EVMClient(chainSelector)
  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: hexToBase64(contractAddress),
      report,
    })
    .result()

  // ── Step 5: Validate TX status ─────────────────────────────
  // Do not silently swallow failures. Throw so the caller
  // (risk-engine-workflow.ts) can catch, log, and retry.
  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(
      `[AttestationMinter] TX not confirmed for subject ${subjectTag}… ` +
      `— txStatus: ${TxStatus[writeResult.txStatus]}`,
    )
  }

  runtime.log(
    `[AttestationMinter] mintAttestation confirmed — ` +
    `subject: ${subjectTag}… tier: ${tier} txStatus: ${TxStatus[writeResult.txStatus]}`,
  )

  return {
    txStatus: writeResult.txStatus,
    subject,
    tier,
  }
}