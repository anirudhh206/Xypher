// ============================================================
// ConfidentialGuard Protocol — Credit Intelligence Engine
// workflows/credit-intelligence-engine/main.ts
//
// CRE workflow entry point. Composes two workflows:
//
//   1. Risk Engine Workflow (log trigger)
//      Fires on PermissionGranted(address indexed subject).
//      Runs the full TEE credit assessment pipeline and mints
//      an on-chain attestation with only the credit tier.
//
//   2. Guardian Monitor Workflow (cron trigger)
//      Fires every 5 minutes. Scans all active subjects,
//      refreshes degraded attestations, signals CCIP when
//      health factor is critical (Day 6).
//
// Both workflows share the same WorkflowConfig schema.
// Secrets (Plaid credentials) are injected from Vault DON
// at runtime — they are NOT in the config or this file.
// ============================================================

import { Runner, handler } from '@chainlink/cre-sdk'
import { configSchema, type WorkflowConfig } from './src/config'
import {
  createRiskEngineTrigger,
  riskEngineHandler,
} from './src/risk-engine-workflow'
import {
  createGuardianMonitorTrigger,
  guardianMonitorHandler,
} from './src/guardian-monitor'

// ── Workflow Initializer ──────────────────────────────────────
//
// Called by the CRE Runner after config is validated and parsed.
// Returns an array of HandlerEntry objects — one per workflow.

function initWorkflow(config: WorkflowConfig) {
  return [
    // PRIMARY: Credit assessment triggered by user grantPermission()
    handler(
      createRiskEngineTrigger(config),
      riskEngineHandler,
    ),

    // SECONDARY: Guardian health monitor on a cron schedule
    handler(
      createGuardianMonitorTrigger(config),
      guardianMonitorHandler,
    ),
  ] as const
}

// ── Entry Point ───────────────────────────────────────────────

export async function main(): Promise<void> {
  const runner = await Runner.newRunner<WorkflowConfig>({ configSchema })
  await runner.run(initWorkflow)
}

await main()
