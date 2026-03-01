
export type {
  // Protocols
  Protocol,

  // Credit tiers
  CreditTier,

  // Core domain types
  PositionData,
  PriceMap,
  CreditScore,
  AttestationView,

  // Plaid TradFi types
  PlaidAccountType,
  PlaidAccount,
  PlaidData,

  // Adapter result types
  AdapterResult,
  AdapterProtocol,
  AdapterError,
  AdapterErrorCode,

  // Contagion simulation types
  PriceDropScenario,
} from './types'

export {
  // Protocol registry
  PROTOCOLS,

  // Tier boundary constants
  TIER_MIN,
  TIER_MAX,

  // Health factor thresholds
  HF_INSTITUTIONAL,
  HF_STRONG,
  HF_ADEQUATE,
  HF_WEAK,
  HF_CRITICAL,

  // Score thresholds per tier
  CONTAGION_THRESHOLD_TIER_1,
  CONTAGION_THRESHOLD_TIER_2,
  CONTAGION_THRESHOLD_TIER_3,
  CONTAGION_THRESHOLD_TIER_4,
  CONTAGION_SCORE_MAX,

  DSS_THRESHOLD_TIER_1,
  DSS_THRESHOLD_TIER_2,
  DSS_THRESHOLD_TIER_3,
  DSS_THRESHOLD_TIER_4,
  DSS_MAX,
  NEUTRAL_DSS,

  // Numeric constants
  WEI_PER_TOKEN,
  BASIS_POINTS_DIVISOR,
  ATTESTATION_VALIDITY_SECONDS,

  // Contagion simulation
  PRICE_DROP_SCENARIOS,

  // Canonical asset identifiers
  CANONICAL_USD_ASSET,

  ok,
  err,
  ADAPTER_ERROR_CODES,
} from './types'

// ── Data Adapters ─────────────────────────────────────────────
export { AaveAdapter } from './adapters/aave.adapter'
export type { AaveAdapterOptions } from './adapters/aave.adapter'

export { MorphoAdapter } from './adapters/morpho.adapter'
export type { MorphoAdapterOptions } from './adapters/morpho.adapter'

export { CompoundAdapter } from './adapters/compound.adapter'
export type { CompoundAdapterOptions } from './adapters/compound.adapter'

export { PlaidAdapter } from './adapters/plaid.adapter'

// ── Risk Engine ───────────────────────────────────────────────
export {
  computeUnifiedHealthFactor,
  computePositionHealthFactor,
  isLiquidatable,
  computeTotalCollateralUSD,
  computeTotalDebtUSD,
  buildPriceMap,
} from './health-factor'

export {
  applyPriceShock,
  simulatePriceShocks,
  computeCascadeThreshold,
  computeContagionRisk,
} from './contagion-model'
export type { ShockResult, ContagionRisk } from './contagion-model'

export { computeDebtServiceability } from './debt-serviceability'
export type { DebtServiceability } from './debt-serviceability'

export {
  computeCreditScore,
  getTier,
  isUndercollateralizedEligible,
  isAtRisk,
} from './credit-score'
export type { CreditScoreDetails } from './credit-score'
