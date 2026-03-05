import {
  EVMClient,
  TxStatus,
  CronCapability,
  encodeCallMsg,
  hexToBase64,
  bytesToHex,
  bytesToBigint,
  bigintToProtoBigInt,
  prepareReportRequest,
} from '@chainlink/cre-sdk'
import { handler } from '@chainlink/cre-sdk'
import type { CronPayload, Runtime } from '@chainlink/cre-sdk'
import {
  keccak256,
  stringToBytes,
  toBytes,
  type Address,
  encodeFunctionData,
  decodeAbiParameters,
} from 'viem'
import {
  computeCreditScore,
  buildPriceMap,
  HF_CRITICAL,
} from '@confidential-guard/risk-engine'
import type { WorkflowConfig } from './config'
import { aggregatePositions } from './position-aggregator'
import { mintAttestation } from './attestation-minter'

// ── Privacy helper ────────────────────────────────────────────
// Never log raw wallet addresses from a TEE workflow.
// 5-byte keccak256 prefix gives traceability without exposure.
const tag = (addr: Address): string => keccak256(toBytes(addr)).slice(0, 12)

// Guardian intervenes when HF drops below this floor
const GUARDIAN_HF_FLOOR = 1.3

// AttestationMinted event topic for scanning active subjects
const ATTESTATION_MINTED_TOPIC: string = keccak256(
  stringToBytes('AttestationMinted(address,uint8,uint64)'),
)
const GET_ATTESTATION_ABI = [
  {
    name: 'getAttestation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'subject', type: 'address' }],
    outputs: [
      { name: 'tier', type: 'uint8' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'expiry', type: 'uint64' },
      { name: 'active', type: 'bool' },
      { name: 'exists', type: 'bool' },
    ],
  },
] as const

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
const TRIGGER_GUARDIAN_ACTION_ABI = [
  {
    name: 'triggerGuardianAction',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'destinationChain', type: 'uint64' },
    ],
    outputs: [],
  },
] as const

const ETH_USD_FEED_SEPOLIA = '0x694AA1769357215DE4FAC081bf1f309aDC325306' as Address
const BTC_USD_FEED_SEPOLIA = '0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43' as Address
const WETH_ADDRESS_SEPOLIA = '0xdd13e55209fd76afe204dbda4007c227904f0a81'
const WBTC_ADDRESS_SEPOLIA = '0x29f2d40b0605204364af54ec677bd022da425d03'

const SCAN_BLOCK_WINDOW = 7200n

function discoverActiveSubjects(
  evmClient: EVMClient,
  runtime: Runtime<WorkflowConfig>,
): Address[] {
  const contractAddress = runtime.config.attestationContractAddress as Address

  try {
    // Get current block number
    const headerReply = evmClient.headerByNumber(runtime, {}).result()
    const blockNumberBytes = headerReply.header?.blockNumber?.absVal
    if (!blockNumberBytes || blockNumberBytes.length === 0) {
      runtime.log('[GuardianMonitor] Could not get latest block number')
      return []
    }

    const latestBlock = bytesToBigint(blockNumberBytes)
    if (latestBlock === 0n) {
      runtime.log('[GuardianMonitor] Latest block is 0 — skipping scan')
      return []
    }

    const fromBlock = latestBlock > SCAN_BLOCK_WINDOW ? latestBlock - SCAN_BLOCK_WINDOW : 0n

    const logsReply = evmClient
      .filterLogs(runtime, {
        filterQuery: {
          // 20-byte address, base64-encoded for protobuf JSON bytes field
          addresses: [hexToBase64(contractAddress)],
          fromBlock: bigintToProtoBigInt(fromBlock),
          toBlock: bigintToProtoBigInt(latestBlock),
          // topics[0] = AttestationMinted event signature (32-byte hash, base64)
          topics: [{ topic: [hexToBase64(ATTESTATION_MINTED_TOPIC)] }],
        },
      })
      .result()

    const subjects: Address[] = []

    for (const log of logsReply.logs) {
      if (log.topics.length < 2) continue
      const subjectHex = bytesToHex(log.topics[1])
      const subject = `0x${subjectHex.slice(-40)}` as Address
      if (/^0x[0-9a-fA-F]{40}$/.test(subject)) {
        subjects.push(subject)
      }
    }

    // Deduplicate. Note: revoked subjects will still appear here since
    // AttestationMinted events are never deleted. isAttestationActive()
    // filters them per-subject below. At scale, maintain an off-chain
    // index rather than scanning all mint events.
    return [...new Set(subjects)]
  } catch (err: unknown) {
    runtime.log(`[GuardianMonitor] filterLogs error: ${String(err)}`)
    return []
  }
}

function fetchPrices(
  evmClient: EVMClient,
  runtime: Runtime<WorkflowConfig>,
): ReturnType<typeof buildPriceMap> {
  const rawPrices: Record<string, bigint> = {}

  for (const [address, feed, symbol] of [
    [WETH_ADDRESS_SEPOLIA, ETH_USD_FEED_SEPOLIA, 'ETH'],
    [WBTC_ADDRESS_SEPOLIA, BTC_USD_FEED_SEPOLIA, 'BTC'],
  ] as const) {
    try {
      const calldata = encodeFunctionData({
        abi: LATEST_ROUND_DATA_ABI,
        functionName: 'latestRoundData',
      })

      const reply = evmClient
        .callContract(runtime, {
          call: encodeCallMsg({
            from: '0x0000000000000000000000000000000000000000',
            to: feed,
            data: calldata,
          }),
        })
        .result()

      if (reply.data.length > 0) {
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
        if (answer > 0n) {
          rawPrices[address] = BigInt(answer) * 10_000_000_000n
          runtime.log(`[GuardianMonitor] ${symbol}/USD = ${rawPrices[address]}`)
        }
      }
    } catch (err: unknown) {
      runtime.log(`[GuardianMonitor] Failed to fetch ${symbol} price: ${String(err)}`)
    }
  }

  return buildPriceMap(rawPrices)
}

function isAttestationActive(
  evmClient: EVMClient,
  runtime: Runtime<WorkflowConfig>,
  subject: Address,
): boolean {
  try {
    const contractAddress = runtime.config.attestationContractAddress as Address
    const calldata = encodeFunctionData({
      abi: GET_ATTESTATION_ABI,
      functionName: 'getAttestation',
      args: [subject],
    })

    const reply = evmClient
      .callContract(runtime, {
        call: encodeCallMsg({
          from: '0x0000000000000000000000000000000000000000',
          to: contractAddress,
          data: calldata,
        }),
      })
      .result()

    if (reply.data.length === 0) return false

    const [, , , active, exists] = decodeAbiParameters(
      [
        { name: 'tier', type: 'uint8' },
        { name: 'timestamp', type: 'uint64' },
        { name: 'expiry', type: 'uint64' },
        { name: 'active', type: 'bool' },
        { name: 'exists', type: 'bool' },
      ],
      bytesToHex(reply.data),
    )

    return Boolean(exists) && Boolean(active)
  } catch {
    return false
  }
}

function triggerCCIPRebalance(
  runtime: Runtime<WorkflowConfig>,
  evmClient: EVMClient,
  subject: Address,
): boolean {
  const vaultAddress = runtime.config.guardianVaultAddress as Address
  const destChainName = runtime.config.ccipDestinationChain

  // Resolve destination chain selector bigint from config string
  type ChainName = keyof typeof EVMClient.SUPPORTED_CHAIN_SELECTORS
  const destChainSelector =
    EVMClient.SUPPORTED_CHAIN_SELECTORS[destChainName as ChainName]

  if (destChainSelector === undefined) {
    throw new Error(
      `[GuardianMonitor] Unknown ccipDestinationChain: "${destChainName}"`,
    )
  }

  const subjectTag = tag(subject)

  runtime.log(
    `[GuardianMonitor] Triggering CCIP rebalance for ${subjectTag}… ` +
    `→ chain ${destChainName} (selector: ${destChainSelector})`,
  )

  // ABI-encode triggerGuardianAction(address user, uint64 destinationChain)
  const calldata = encodeFunctionData({
    abi: TRIGGER_GUARDIAN_ACTION_ABI,
    functionName: 'triggerGuardianAction',
    args: [subject, destChainSelector],
  })

  // TEE signs the calldata, DON submits to GuardianVault on source chain
  const report = runtime.report(prepareReportRequest(calldata)).result()

  const writeResult = evmClient
    .writeReport(runtime, {
      receiver: hexToBase64(vaultAddress),
      report,
    })
    .result()

  if (writeResult.txStatus !== TxStatus.SUCCESS) {
    throw new Error(
      `[GuardianMonitor] CCIP rebalance not confirmed for ${subjectTag}… ` +
      `— txStatus: ${TxStatus[writeResult.txStatus]}`,
    )
  }

  runtime.log(
    `[GuardianMonitor] CCIP guardian action confirmed for ${subjectTag}…`,
  )

  return true
}

export function createGuardianMonitorTrigger(config: WorkflowConfig) {
  const cronCap = new CronCapability()
  return cronCap.trigger({ schedule: config.guardianSchedule })
}

export function guardianMonitorHandler(
  runtime: Runtime<WorkflowConfig>,
  _payload: CronPayload,
): string {
  runtime.log('[GuardianMonitor] ═══ Guardian Scan Started ═══')
  runtime.log(`[GuardianMonitor] Time: ${runtime.now().toISOString()}`)

  // ── Invariant: HF_CRITICAL must be below GUARDIAN_HF_FLOOR ──
  // If violated, every subject goes straight to CCIP rebalance
  // and the attestation refresh branch never fires.
  if (HF_CRITICAL >= GUARDIAN_HF_FLOOR) {
    throw new Error(
      `[GuardianMonitor] Config error: HF_CRITICAL (${HF_CRITICAL}) ` +
      `must be < GUARDIAN_HF_FLOOR (${GUARDIAN_HF_FLOOR})`,
    )
  }

  // ── Resolve chain selector from config ──────────────────────
  type ChainName = keyof typeof EVMClient.SUPPORTED_CHAIN_SELECTORS
  const chainSelectorName = runtime.config.chainSelectorName as ChainName
  const chainSelector = EVMClient.SUPPORTED_CHAIN_SELECTORS[chainSelectorName]

  if (!chainSelector) {
    throw new Error(
      `[GuardianMonitor] Unsupported chainSelectorName: ${chainSelectorName}`,
    )
  }

  const evmClient = new EVMClient(chainSelector)

  const subjects = discoverActiveSubjects(evmClient, runtime)
  runtime.log(`[GuardianMonitor] Active subjects to scan: ${subjects.length}`)

  if (subjects.length === 0) {
    runtime.log('[GuardianMonitor] No active subjects — scan complete')
    return JSON.stringify({ ok: true, scanned: 0, refreshed: 0, critical: 0 })
  }

  // ── Fetch prices — abort if unavailable ─────────────────────
  const prices = fetchPrices(evmClient, runtime)
  if (Object.keys(prices).length === 0) {
    runtime.log('[GuardianMonitor] No prices available — aborting scan to prevent false triggers')
    return JSON.stringify({ ok: false, reason: 'no_prices', scanned: 0, refreshed: 0, critical: 0 })
  }

  let refreshed = 0
  let critical = 0

  for (const subject of subjects) {
    const subjectTag = tag(subject)
    runtime.log(`[GuardianMonitor] Checking subject: ${subjectTag}…`)

    if (!isAttestationActive(evmClient, runtime, subject)) {
      runtime.log(`[GuardianMonitor] ${subjectTag}…: no active attestation, skipping`)
      continue
    }

    const { positions, plaidData } = aggregatePositions(runtime, subject)

    if (positions.length === 0) {
      runtime.log(`[GuardianMonitor] ${subjectTag}…: no positions, skipping`)
      continue
    }

    const scoreDetails = computeCreditScore(positions, prices, plaidData)
    const { unifiedHealthFactor, tier } = scoreDetails.creditScore

    runtime.log(
      `[GuardianMonitor] ${subjectTag}…: UHF=${unifiedHealthFactor.toFixed(4)} tier=${tier}`,
    )

    if (unifiedHealthFactor < HF_CRITICAL) {
      runtime.log(
        `[GuardianMonitor] CRITICAL: ${subjectTag}… HF=${unifiedHealthFactor.toFixed(4)} ` +
        `— dispatching CCIP rebalance to ${runtime.config.ccipDestinationChain}`,
      )
      try {
        triggerCCIPRebalance(runtime, evmClient, subject)
      } catch (err: unknown) {
        runtime.log(
          `[GuardianMonitor] CCIP rebalance failed for ${subjectTag}…: ${String(err)}`,
        )
      }
      critical++
    } else if (unifiedHealthFactor < GUARDIAN_HF_FLOOR) {
       runtime.log(
        `[GuardianMonitor] HF degraded for ${subjectTag}… ` +
        `(${unifiedHealthFactor.toFixed(4)} < ${GUARDIAN_HF_FLOOR}) — refreshing attestation`,
      )

      try {
        mintAttestation(runtime, subject, scoreDetails.creditScore.tier)
        runtime.log(`[GuardianMonitor] Attestation refreshed for ${subjectTag}…`)
        refreshed++
      } catch (err: unknown) {
        runtime.log(
          `[GuardianMonitor] Failed to refresh attestation for ${subjectTag}…: ${String(err)}`,
        )
      }
    } else {
      runtime.log(`[GuardianMonitor] ${subjectTag}…: HF healthy, no action needed`)
    }
  }

  runtime.log(
    `[GuardianMonitor] ═══ Scan Complete — ` +
    `scanned=${subjects.length} refreshed=${refreshed} critical=${critical} ═══`,
  )

  return JSON.stringify({
    ok: true,
    scanned: subjects.length,
    refreshed,
    critical,
  })
}

export { handler }
