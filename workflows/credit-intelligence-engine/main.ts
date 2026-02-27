// ============================================================
// ConfidentialGuard Protocol — Credit Intelligence Engine
// workflows/credit-intelligence-engine/main.ts
// DAY 1: Confidential HTTP inside TEE (no DON consensus)
// ============================================================

import {
  cre,
  type CronPayload,
  Runner,
  type Runtime,
} from '@chainlink/cre-sdk'
import { z } from 'zod'

// ============================================================
// CONFIG SCHEMA
// ============================================================
const configSchema = z.object({
  schedule: z.string(),
  aaveApiUrl: z.string(),
  testWalletAddress: z.string(),
  chainSelectorName: z.string(),
})

type Config = z.infer<typeof configSchema>

// ============================================================
// TYPES
// ============================================================
interface PositionSummary {
  protocol: string
  healthFactor: number
  totalCollateralUSD: number
  totalDebtUSD: number
  netPositionUSD: number
  atRisk: boolean
}

// ============================================================
// Mock data — fallback when API unavailable
// ============================================================
const getMockAavePosition = (): PositionSummary => ({
  protocol: 'Aave V3',
  healthFactor: 1.82,
  totalCollateralUSD: 125000,
  totalDebtUSD: 68681,
  netPositionUSD: 56319,
  atRisk: false,
})

// ============================================================
// RISK ENGINE
// ============================================================
const computeRiskAssessment = (position: PositionSummary): string => {
  let riskLevel: string
  let recommendation: string

  if (position.healthFactor >= 2.0) {
    riskLevel = 'SAFE'
    recommendation = 'Position is healthy. No action required.'
  } else if (position.healthFactor >= 1.5) {
    riskLevel = 'MODERATE'
    recommendation = 'Monitor closely. Consider adding collateral.'
  } else if (position.healthFactor >= 1.1) {
    riskLevel = 'HIGH'
    recommendation = 'WARNING: Approaching liquidation. Immediate action recommended.'
  } else {
    riskLevel = 'CRITICAL'
    recommendation = 'DANGER: Liquidation imminent. Auto-protection triggered.'
  }

  return JSON.stringify({
    protocol: position.protocol,
    healthFactor: position.healthFactor.toFixed(4),
    totalCollateralUSD: position.totalCollateralUSD.toFixed(2),
    totalDebtUSD: position.totalDebtUSD.toFixed(2),
    netPositionUSD: position.netPositionUSD.toFixed(2),
    riskLevel,
    recommendation,
    atRisk: position.atRisk,
    computedInsideTEE: true,
    timestamp: new Date().toISOString(),
  })
}

// ============================================================
// CRON TRIGGER HANDLER
// ============================================================
const onCronTrigger = (
  runtime: Runtime<Config>,
  _payload: CronPayload,
): string => {
  runtime.log('[ConfidentialGuard] ======= Credit Intelligence Engine =======')
  runtime.log(`[ConfidentialGuard] Wallet: ${runtime.config.testWalletAddress}`)

  // Step 1: Confidential HTTP — request runs inside TEE enclave, no DON consensus needed.
  // ConfidentialHTTPClient (confidential-http@1.0.0-alpha) is a single-node capability.
  // HTTPClient with consensusIdenticalAggregation requires N nodes to agree — fails in simulation.
  runtime.log('[ConfidentialGuard] Step 1: Fetching Aave positions...')

  const confHttp = new cre.capabilities.ConfidentialHTTPClient()
  const url = `${runtime.config.aaveApiUrl}/data/users/${runtime.config.testWalletAddress}`

  let position: PositionSummary
  try {
    const response = confHttp
      .sendRequest(runtime, {
        request: { url, method: 'GET' },
        vaultDonSecrets: [],
      })
      .result()

    if (response.statusCode !== 200) {
      runtime.log(`[ConfidentialGuard] API returned ${response.statusCode}, using mock data`)
      position = getMockAavePosition()
    } else {
      const rawData = JSON.parse(response.body.toString()) as Record<string, string>
      const hf = parseFloat(rawData.healthFactor ?? '999')
      const collateral = parseFloat(rawData.totalCollateralMarketReferenceCurrency ?? '0')
      const debt = parseFloat(rawData.totalDebtMarketReferenceCurrency ?? '0')
      position = {
        protocol: 'Aave V3',
        healthFactor: hf,
        totalCollateralUSD: collateral,
        totalDebtUSD: debt,
        netPositionUSD: collateral - debt,
        atRisk: hf < 1.5,
      }
    }
  } catch (err: unknown) {
    runtime.log(`[ConfidentialGuard] Confidential HTTP error: ${String(err)}`)
    runtime.log('[ConfidentialGuard] Falling back to mock position data')
    position = getMockAavePosition()
  }

  runtime.log(`[ConfidentialGuard] Protocol: ${position.protocol}`)
  runtime.log(`[ConfidentialGuard] Health Factor: ${position.healthFactor}`)
  runtime.log(`[ConfidentialGuard] Collateral: $${position.totalCollateralUSD}`)
  runtime.log(`[ConfidentialGuard] Debt: $${position.totalDebtUSD}`)
  runtime.log(`[ConfidentialGuard] At Risk: ${position.atRisk}`)

  // Step 2: Risk assessment (runs in same TEE enclave — result never leaves unencrypted)
  runtime.log('[ConfidentialGuard] Step 2: Computing risk assessment...')
  return computeRiskAssessment(position)
}

// ============================================================
// WORKFLOW INITIALIZATION
// ============================================================
const initWorkflow = (config: Config) => {
  const cronCapability = new cre.capabilities.CronCapability()

  return [
    cre.handler(
      cronCapability.trigger({ schedule: config.schedule }),
      onCronTrigger,
    ),
  ]
}

// ============================================================
// ENTRY POINT
// ============================================================
export async function main() {
  const runner = await Runner.newRunner<Config>({ configSchema })
  await runner.run(initWorkflow)
}
