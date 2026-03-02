// ============================================================
// ConfidentialGuard Protocol — Workflow Configuration Schema
// workflows/credit-intelligence-engine/src/config.ts
//
// Validates all environment-specific parameters injected by the
// CRE runner from config.{staging|production}.json.
//
// Secrets (Plaid credentials, etc.) come from Vault DON at
// runtime — they are NOT in the config schema. The schema only
// defines static, non-sensitive workflow parameters.
// ============================================================

import { z } from 'zod'

// ── Validators ────────────────────────────────────────────────

const evmAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed 40-character hex address')

const nonEmptyString = z.string().min(1)

// ── Config Schema ─────────────────────────────────────────────

export const configSchema = z.object({
  // On-chain: contract that mints/verifies attestations
  attestationContractAddress: evmAddress,

  // CRE chain selector (e.g. "ethereum-testnet-sepolia")
  chainSelectorName: nonEmptyString,

  // ── DeFi Protocol API endpoints ───────────────────────────
  // Queried via ConfidentialHTTPClient inside the TEE.
  // Pattern: /v1/users/{address}/summary
  aaveApiUrl: z.string().url('aaveApiUrl must be a valid URL'),
  morphoApiUrl: z.string().url('morphoApiUrl must be a valid URL'),
  compoundApiUrl: z.string().url('compoundApiUrl must be a valid URL'),

  // ── TradFi (Plaid) ────────────────────────────────────────
  // Base URL for Plaid /accounts/balance/get
  plaidApiUrl: z.string().url('plaidApiUrl must be a valid URL'),
  // Vault DON secret key for Plaid client_id/secret injection
  plaidSecretKey: nonEmptyString,
  plaidSecretNamespace: nonEmptyString,

  // ── Guardian Automation ───────────────────────────────────
  // Cron schedule (5-field: sec min hour dom month)
  guardianSchedule: nonEmptyString,
})

export type WorkflowConfig = z.infer<typeof configSchema>
