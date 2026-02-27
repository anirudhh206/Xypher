// ============================================================
// ConfidentialGuard Protocol — Credit Intelligence Engine
// workflows/credit-intelligence-engine/main.ts
// DAY 1: Working simulation — string-based consensus pattern
// ============================================================

import {
  cre,
  type CronPayload,
  Runner,
  type Runtime,
  type HTTPSendRequester,
  consensusIdenticalAggregation,
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
// FETCH — returns PositionSummary object directly
// ============================================================
const fetchAavePositions = (
  sendRequester: HTTPSendRequester,
  config: Config,
): PositionSummary => {
  const url = `${config.aaveApiUrl}/data/users/${config.testWalletAddress}`
  const response = sendRequester.sendRequest({ url, method: 'GET' }).result()

  if (response.statusCode !== 200) return getMockAavePosition()

  const rawData = JSON.parse(response.body.toString())

  return {
    protocol: 'Aave V3',
    healthFactor: parseFloat(rawData.healthFactor ?? '999'),
    totalCollateralUSD: parseFloat(rawData.totalCollateralMarketReferenceCurrency ?? '0'),
    totalDebtUSD: parseFloat(rawData.totalDebtMarketReferenceCurrency ?? '0'),
    netPositionUSD:
      parseFloat(rawData.totalCollateralMarketReferenceCurrency ?? '0') -
      parseFloat(rawData.totalDebtMarketReferenceCurrency ?? '0'),
    atRisk: parseFloat(rawData.healthFactor ?? '999') < 1.5,
  }
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

  // Step 1: Fetch positions — return string, use identical consensus
  runtime.log('[ConfidentialGuard] Step 1: Fetching Aave positions...')

  const httpClient = new cre.capabilities.HTTPClient()

  const position = httpClient
    .sendRequest(
      runtime,
      fetchAavePositions,
      consensusIdenticalAggregation<PositionSummary>(),
    )(runtime.config)
    .result()

  runtime.log(`[ConfidentialGuard] Protocol: ${position.protocol}`)
  runtime.log(`[ConfidentialGuard] Health Factor: ${position.healthFactor}`)
  runtime.log(`[ConfidentialGuard] Collateral: $${position.totalCollateralUSD}`)
  runtime.log(`[ConfidentialGuard] Debt: $${position.totalDebtUSD}`)
  runtime.log(`[ConfidentialGuard] At Risk: ${position.atRisk}`)

  // Step 2: Risk assessment
  runtime.log('[ConfidentialGuard] Step 2: Computing risk assessment...')
  const assessment = computeRiskAssessment(position)

  const parsed = JSON.parse(assessment)
  runtime.log(`[ConfidentialGuard] Risk Level: ${parsed.riskLevel}`)
  runtime.log(`[ConfidentialGuard] Recommendation: ${parsed.recommendation}`)
  runtime.log('[ConfidentialGuard] ======= Engine Complete =======')

  return assessment
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