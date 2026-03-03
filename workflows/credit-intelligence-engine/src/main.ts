// ============================================================
// ConfidentialGuard Protocol — Workflow Source Modules
// workflows/credit-intelligence-engine/src/main.ts
//
// This file is intentionally a no-op stub.
//
// The CRE workflow entry point is at the root:
//   workflows/credit-intelligence-engine/main.ts
//
// That file imports from this src/ directory:
//   import { createRiskEngineTrigger, riskEngineHandler } from './src/risk-engine-workflow'
//   import { createGuardianMonitorTrigger, guardianMonitorHandler } from './src/guardian-monitor'
//   import { configSchema } from './src/config'
//
// The tsconfig.json includes both "main.ts" (root) and "src/**/*.ts".
// The Chainlink Javy WASM compiler uses root main.ts as the entry point.
// ============================================================

export type { WorkflowConfig } from './config'
