// ============================================================
// ConfidentialGuard Protocol — Attestation Minter
// workflows/credit-intelligence-engine/src/attestation-minter.ts
//
// Writes a single on-chain attestation by calling
// mintAttestation(address subject, uint8 tier) on
// ConfidentialGuardAttestation.sol via the CRE report pipeline.
//
// FLOW
//   1. ABI-encode mintAttestation(subject, tier) calldata
//   2. runtime.report() — TEE signs the calldata, producing a
//      Report with threshold signatures from the DON quorum
//   3. EVMClient.writeReport() — submits the signed report to
//      the ConfidentialGuardAttestation contract on Sepolia
//
// PRIVACY
//   Only `tier` (uint8 1–5) appears on-chain. The full
//   CreditScoreDetails (UHF, contagion, DSS) is computed
//   inside the TEE and discarded after minting.
// ============================================================

import {
  EVMClient,
  prepareReportRequest,
  hexToBase64,
} from '@chainlink/cre-sdk'
import type { Runtime } from '@chainlink/cre-sdk'
import { encodeFunctionData, type Address, type Hex } from 'viem'
import type { CreditTier } from '@confidential-guard/risk-engine'
import type { WorkflowConfig } from './config'

// ── ABI Fragment ──────────────────────────────────────────────
// Only the function we call — no need for the full ABI.
// Matches ConfidentialGuardAttestation.sol exactly.

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

// ── Chain Selector ────────────────────────────────────────────
// Ethereum Sepolia — the deployment target for the hackathon.
// In production, derive from config.chainSelectorName.

const SEPOLIA_CHAIN_SELECTOR =
  EVMClient.SUPPORTED_CHAIN_SELECTORS['ethereum-testnet-sepolia']

// ── Core Function ─────────────────────────────────────────────

/**
 * Mints an on-chain attestation for the given subject address.
 *
 * @param runtime  - CRE runtime (provides config, report, log)
 * @param subject  - The wallet address being attested
 * @param tier     - Credit tier 1–5. This is the ONLY value written on-chain.
 *
 * @throws if the report signing or on-chain write fails. The
 *         caller (risk-engine-workflow.ts) is responsible for
 *         catching and logging.
 */
export function mintAttestation(
  runtime: Runtime<WorkflowConfig>,
  subject: Address,
  tier: CreditTier,
): void {
  const contractAddress = runtime.config.attestationContractAddress as Address

  runtime.log(
    `[AttestationMinter] Minting tier ${tier} attestation for ${subject} ` +
    `on contract ${contractAddress}`,
  )

  // Step 1: ABI-encode the calldata for mintAttestation(address, uint8)
  const calldata: Hex = encodeFunctionData({
    abi: MINT_ATTESTATION_ABI,
    functionName: 'mintAttestation',
    args: [subject, tier],
  })

  runtime.log(`[AttestationMinter] Calldata: ${calldata.slice(0, 18)}…`)

  // Step 2: TEE signs the calldata.
  // prepareReportRequest wraps the hex calldata with the EVM encoder
  // parameters expected by the CRE report pipeline.
  const report = runtime.report(prepareReportRequest(calldata)).result()

  runtime.log('[AttestationMinter] Report signed by DON quorum')

  // Step 3: Submit to on-chain contract.
  // receiver = the contract that will execute the report (base64-encoded bytes).
  // The EVMClient decodes the report and calls mintAttestation() with the
  // DON-signed calldata — the onlyWorkflow modifier validates the sender.
  const evmClient = new EVMClient(SEPOLIA_CHAIN_SELECTOR)

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: hexToBase64(contractAddress),
      report,
    })
    .result()

  runtime.log(
    `[AttestationMinter] mintAttestation tx submitted — ` +
    `txStatus: ${writeResult.txStatus}`,
  )
}
