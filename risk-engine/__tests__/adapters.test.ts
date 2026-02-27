// ============================================================
// ConfidentialGuard Protocol — Adapter Unit Tests
// risk-engine/__tests__/adapters.test.ts
//
// 100% coverage target across all four adapters.
// Tests every valid path, every error path, every edge case.
//
// Run: bun test
// Coverage: bun test --coverage
// ============================================================

import { describe, it, expect } from 'bun:test'

import { AaveAdapter } from '../src/adapters/aave.adapter'
import { MorphoAdapter } from '../src/adapters/morpho.adapter'
import { CompoundAdapter } from '../src/adapters/compound.adapter'
import { PlaidAdapter } from '../src/adapters/plaid.adapter'
import { CANONICAL_USD_ASSET, WEI_PER_TOKEN } from '../src/types'

// ============================================================
// TEST FIXTURES — Realistic mock API responses
// Based on actual API response shapes from each protocol.
// ============================================================

// ── Aave V3 fixtures ─────────────────────────────────────────

const AAVE_VALID_AGGREGATE: unknown = {
  healthFactor: '1.8532',
  totalCollateralMarketReferenceCurrency: '125000.50',
  totalDebtMarketReferenceCurrency: '68000.00',
  currentLiquidationThreshold: '0.8200',
}

const AAVE_VALID_WITH_RESERVES: unknown = {
  healthFactor: '2.1000',
  totalCollateralMarketReferenceCurrency: '200000.00',
  totalDebtMarketReferenceCurrency: '80000.00',
  currentLiquidationThreshold: '0.8250',
  userReserves: [
    {
      reserve: {
        underlyingAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        decimals: 18,
        reserveLiquidationThreshold: '8250', // basis points: 82.5%
      },
      currentATokenBalance: '30000000000000000000', // 30 WETH
      currentVariableDebt: '0',
      currentStableDebt: '0',
      usageAsCollateralEnabledOnUser: true,
    },
    {
      reserve: {
        underlyingAsset: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
        symbol: 'WBTC',
        decimals: 8,
        reserveLiquidationThreshold: '7500', // basis points: 75%
      },
      currentATokenBalance: '100000000', // 1 WBTC (8 decimals)
      currentVariableDebt: '0',
      currentStableDebt: '0',
      usageAsCollateralEnabledOnUser: true,
    },
  ],
}

const AAVE_RESERVES_NOT_COLLATERAL: unknown = {
  healthFactor: '1.5000',
  totalCollateralMarketReferenceCurrency: '50000.00',
  totalDebtMarketReferenceCurrency: '30000.00',
  userReserves: [
    {
      reserve: {
        underlyingAsset: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        symbol: 'WETH',
        decimals: 18,
        reserveLiquidationThreshold: '8250',
      },
      currentATokenBalance: '10000000000000000000',
      currentVariableDebt: '0',
      currentStableDebt: '0',
      usageAsCollateralEnabledOnUser: false, // not used as collateral
    },
  ],
}

const AAVE_ZERO_POSITION: unknown = {
  healthFactor: '0',
  totalCollateralMarketReferenceCurrency: '0',
  totalDebtMarketReferenceCurrency: '0',
}

// ── Morpho Blue fixtures ──────────────────────────────────────

const MORPHO_WETH_USDC_MARKET = {
  uniqueKey: '0xb323495f7e4148be5643a4ea4a8221eef163e4bccfdedc2a6f4696baacbc86cc',
  loanAsset: {
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    symbol: 'USDC',
    decimals: 6,
  },
  collateralAsset: {
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
    symbol: 'WETH',
    decimals: 18,
  },
  lltv: '860000000000000000', // 0.86 in WAD
  state: {
    borrowAssets: '5000000000000', // $5M USDC
    borrowShares: '4995000000000000000000', // total shares
  },
}

const MORPHO_VALID_GRAPHQL: unknown = {
  data: {
    userByAddress: {
      marketPositions: [
        {
          market: MORPHO_WETH_USDC_MARKET,
          borrowShares: '100000000000000000000', // user shares
          borrowAssets: '100200000000', // $100,200 USDC pre-computed
          collateral: '60000000000000000000', // 60 WETH
          supplyShares: '0',
        },
      ],
    },
  },
}

const MORPHO_VALID_FLAT: unknown = {
  marketPositions: [
    {
      market: MORPHO_WETH_USDC_MARKET,
      borrowShares: '50000000000000000000',
      borrowAssets: '50100000000', // $50,100 USDC
      collateral: '30000000000000000000', // 30 WETH
      supplyShares: '0',
    },
  ],
}

const MORPHO_VALID_WAD_DECIMAL: unknown = {
  positions: [
    {
      market: {
        ...MORPHO_WETH_USDC_MARKET,
        lltv: '0.8600', // decimal fraction format
      },
      borrowShares: '0',
      borrowAssets: '25000000000', // $25,000 USDC
      collateral: '15000000000000000000', // 15 WETH
      supplyShares: '0',
    },
  ],
}

const MORPHO_PURE_SUPPLY: unknown = {
  positions: [
    {
      market: MORPHO_WETH_USDC_MARKET,
      borrowShares: '0',
      borrowAssets: '0',
      collateral: '0', // no collateral
      supplyShares: '200000000000000000000', // lender only
    },
  ],
}

const MORPHO_NO_BORROW_ASSETS_FALLBACK: unknown = {
  positions: [
    {
      market: MORPHO_WETH_USDC_MARKET,
      borrowShares: '100000000000000000000',
      // borrowAssets absent — force shares calculation fallback
      collateral: '60000000000000000000',
      supplyShares: '0',
    },
  ],
}

// ── Compound V3 fixtures ──────────────────────────────────────

const COMPOUND_USDC_COMET: unknown = {
  markets: [
    {
      comet: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
      baseToken: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
      },
      borrowBalance: '50000000000', // $50,000 USDC (6 decimals)
      collateralAssets: [
        {
          asset: {
            address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            symbol: 'WETH',
            decimals: 18,
          },
          balance: '25000000000000000000', // 25 WETH
          liquidateCollateralFactor: '825000000000000000', // 0.825 WAD
          collateralUsdValue: '62500.00',
        },
        {
          asset: {
            address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599',
            symbol: 'WBTC',
            decimals: 8,
          },
          balance: '100000000', // 1 WBTC (8 decimals)
          liquidateCollateralFactor: '0.75', // decimal format
          collateralUsdValue: '37500.00',
        },
      ],
    },
  ],
}

const COMPOUND_SINGLE_COLLATERAL: unknown = {
  positions: [
    {
      baseToken: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
      },
      borrowBalanceOf: '20000000000', // $20,000 USDC (6 decimals)
      collateralAssets: [
        {
          asset: {
            address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            symbol: 'WETH',
            decimals: 18,
          },
          balance: '12000000000000000000', // 12 WETH
          liquidateCollateralFactor: '825000000000000000',
        },
      ],
    },
  ],
}

const COMPOUND_ZERO_BORROW: unknown = {
  markets: [
    {
      baseToken: {
        address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        symbol: 'USDC',
        decimals: 6,
      },
      borrowBalance: '0',
      collateralAssets: [
        {
          asset: {
            address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            symbol: 'WETH',
            decimals: 18,
          },
          balance: '5000000000000000000',
          liquidateCollateralFactor: '825000000000000000',
        },
      ],
    },
  ],
}

// ── Plaid fixtures ────────────────────────────────────────────

const PLAID_FULL_RESPONSE: unknown = {
  accounts: [
    {
      account_id: 'acc_checking_001',
      type: 'depository',
      subtype: 'checking',
      name: 'Premier Checking',
      mask: '1234',
      balances: {
        current: 125000.50,
        available: 120000.00, // $5k pending debits
        limit: null,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    },
    {
      account_id: 'acc_savings_002',
      type: 'depository',
      subtype: 'savings',
      name: 'High Yield Savings',
      mask: '5678',
      balances: {
        current: 500000.00,
        available: 500000.00, // no pending
        limit: null,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    },
    {
      account_id: 'acc_credit_003',
      type: 'credit',
      subtype: 'credit card',
      name: 'Business Platinum',
      mask: '9012',
      balances: {
        current: 15000.00, // amount owed
        available: 85000.00,
        limit: 100000.00,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    },
    {
      account_id: 'acc_loan_004',
      type: 'loan',
      subtype: 'mortgage',
      name: 'Home Mortgage',
      mask: '3456',
      balances: {
        current: 750000.00, // outstanding balance
        available: null,
        limit: null,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    },
  ],
  request_id: 'req_abc123',
}

const PLAID_OVER_LIMIT_CREDIT: unknown = {
  accounts: [
    {
      account_id: 'acc_overlimit',
      type: 'credit',
      subtype: 'credit card',
      name: 'Overlimit Card',
      mask: '0000',
      balances: {
        current: 5200.00, // $200 over limit
        available: 0,
        limit: 5000.00,
        iso_currency_code: 'USD',
        unofficial_currency_code: null,
      },
    },
  ],
  request_id: 'req_overlimit',
}

const PLAID_NON_USD: unknown = {
  accounts: [
    {
      account_id: 'acc_gbp',
      type: 'depository',
      subtype: 'checking',
      name: 'GBP Account',
      mask: '1111',
      balances: {
        current: 50000,
        available: 48000,
        limit: null,
        iso_currency_code: 'GBP', // NOT USD
        unofficial_currency_code: null,
      },
    },
  ],
  request_id: 'req_gbp',
}

const PLAID_ERROR_RESPONSE: unknown = {
  error_type: 'ITEM_ERROR',
  error_code: 'ITEM_LOGIN_REQUIRED',
  error_message: 'the login details of this item have changed',
  display_message: 'Please re-enter your credentials.',
  request_id: 'req_error123',
}

// ============================================================
// AAVE ADAPTER TESTS
// ============================================================

describe('AaveAdapter', () => {
  describe('normalize — valid paths', () => {
    it('returns aggregate position when userReserves is absent', () => {
      const result = AaveAdapter.normalize(AAVE_VALID_AGGREGATE)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.data).toHaveLength(1)
      const position = result.data[0]!
      expect(position.protocol).toBe('aave')
      expect(position.collateralAsset).toBe(CANONICAL_USD_ASSET)
      expect(position.debtAsset).toBe(CANONICAL_USD_ASSET)
      // collateralAmount should be ~$125,000.50 in 1e18 scaling
      expect(position.collateralAmount > 0n).toBe(true)
      expect(position.debtAmount > 0n).toBe(true)
      expect(position.liquidationThreshold).toBeCloseTo(0.82, 2)
    })

    it('returns per-reserve positions when userReserves is present', () => {
      const result = AaveAdapter.normalize(AAVE_VALID_WITH_RESERVES)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // Two collateral reserves → two positions
      expect(result.data).toHaveLength(2)

      const [wethPos, wbtcPos] = result.data
      expect(wethPos!.protocol).toBe('aave')
      expect(wethPos!.collateralAsset).toBe(
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // lowercase
      )
      expect(wbtcPos!.collateralAsset).toBe(
        '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599',
      )
      // Each receives half the total debt (equal split, 2 positions)
      expect(wethPos!.debtAmount).toBe(wbtcPos!.debtAmount)
      // Debt asset is CANONICAL_USD_ASSET for Aave aggregate debt
      expect(wethPos!.debtAsset).toBe(CANONICAL_USD_ASSET)
    })

    it('applies correct liquidation thresholds from basis points', () => {
      const result = AaveAdapter.normalize(AAVE_VALID_WITH_RESERVES)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const [wethPos, wbtcPos] = result.data
      expect(wethPos!.liquidationThreshold).toBeCloseTo(0.825, 3) // 8250 bp
      expect(wbtcPos!.liquidationThreshold).toBeCloseTo(0.75, 3)  // 7500 bp
    })

    it('falls through to aggregate when no reserves are enabled as collateral', () => {
      const result = AaveAdapter.normalize(AAVE_RESERVES_NOT_COLLATERAL)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // userReserves present but none with usageAsCollateralEnabledOnUser=true
      // → falls back to aggregate
      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.collateralAsset).toBe(CANONICAL_USD_ASSET)
    })

    it('uses Sepolia chain ID via normalizeTestnet', () => {
      const result = AaveAdapter.normalizeTestnet(AAVE_VALID_AGGREGATE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.chainId).toBe(11155111)
    })

    it('uses mainnet chain ID by default', () => {
      const result = AaveAdapter.normalize(AAVE_VALID_AGGREGATE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.chainId).toBe(1)
    })

    it('respects useIndividualReserves: false option', () => {
      const result = AaveAdapter.normalize(AAVE_VALID_WITH_RESERVES, {
        useIndividualReserves: false,
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Forces aggregate even when reserves are present
      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.collateralAsset).toBe(CANONICAL_USD_ASSET)
    })

    it('derives liquidation threshold from health factor when field absent', () => {
      const body: unknown = {
        healthFactor: '2.0',
        totalCollateralMarketReferenceCurrency: '200000',
        totalDebtMarketReferenceCurrency: '100000',
        // no currentLiquidationThreshold
      }
      const result = AaveAdapter.normalize(body)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // HF * debt / collateral = 2.0 * 100000 / 200000 = 1.0
      // → capped/adjusted by risk engine; adapter just sets what it can derive
      expect(result.data[0]!.liquidationThreshold).toBeGreaterThan(0)
    })
  })

  describe('normalize — error paths', () => {
    it('returns INVALID_RESPONSE for non-object body', () => {
      const result = AaveAdapter.normalize('not an object')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
      expect(result.error.protocol).toBe('aave')
    })

    it('returns INVALID_RESPONSE for array body', () => {
      const result = AaveAdapter.normalize([])
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns INVALID_RESPONSE when required fields are missing', () => {
      const result = AaveAdapter.normalize({ healthFactor: '1.5' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns PARSE_ERROR when numeric fields are non-finite strings', () => {
      const result = AaveAdapter.normalize({
        healthFactor: '1.5',
        totalCollateralMarketReferenceCurrency: 'not-a-number',
        totalDebtMarketReferenceCurrency: '50000',
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('PARSE_ERROR')
    })

    it('returns NO_POSITIONS when both collateral and debt are zero', () => {
      const result = AaveAdapter.normalize(AAVE_ZERO_POSITION)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
    })

    it('returns INVALID_RESPONSE for null body', () => {
      const result = AaveAdapter.normalize(null)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })
  })
})

// ============================================================
// MORPHO ADAPTER TESTS
// ============================================================

describe('MorphoAdapter', () => {
  describe('normalize — valid paths', () => {
    it('processes GraphQL envelope shape correctly', () => {
      const result = MorphoAdapter.normalize(MORPHO_VALID_GRAPHQL)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.data).toHaveLength(1)
      const pos = result.data[0]!
      expect(pos.protocol).toBe('morpho')
      expect(pos.collateralAsset).toBe(
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      )
      expect(pos.debtAsset).toBe(
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      )
      expect(pos.collateralAmount).toBe(60000000000000000000n) // 60 WETH
      expect(pos.debtAmount).toBe(100200000000n) // $100,200 USDC pre-computed
      expect(pos.liquidationThreshold).toBeCloseTo(0.86, 4)
    })

    it('processes flat marketPositions shape', () => {
      const result = MorphoAdapter.normalize(MORPHO_VALID_FLAT)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data).toHaveLength(1)
      expect(result.data[0]!.debtAmount).toBe(50100000000n)
    })

    it('handles LLTV in decimal fraction format', () => {
      const result = MorphoAdapter.normalize(MORPHO_VALID_WAD_DECIMAL)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.liquidationThreshold).toBeCloseTo(0.86, 4)
    })

    it('computes borrow from shares when borrowAssets is absent', () => {
      const result = MorphoAdapter.normalize(MORPHO_NO_BORROW_ASSETS_FALLBACK)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const pos = result.data[0]!
      // borrowShares = 100e18, totalBorrowAssets = 5_000_000_000_000 (USDC)
      // totalBorrowShares = 4_995e18
      // assets = 100e18 * (5_000_000_000_000 + 1) / (4_995e18 + 1_000_000)
      // ≈ slightly less than 100200000000 (the pre-computed value)
      expect(pos.debtAmount).toBeGreaterThan(0n)
    })

    it('normalizes token addresses to lowercase', () => {
      const result = MorphoAdapter.normalize(MORPHO_VALID_GRAPHQL)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const pos = result.data[0]!
      expect(pos.collateralAsset).toBe(pos.collateralAsset.toLowerCase())
      expect(pos.debtAsset).toBe(pos.debtAsset.toLowerCase())
    })

    it('sets chainId to 1 by default', () => {
      const result = MorphoAdapter.normalize(MORPHO_VALID_FLAT)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.chainId).toBe(1)
    })

    it('sets chainId to 11155111 via normalizeTestnet', () => {
      const result = MorphoAdapter.normalizeTestnet(MORPHO_VALID_FLAT)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.chainId).toBe(11155111)
    })

    it('sets chainId to 8453 via normalizeBase', () => {
      const result = MorphoAdapter.normalizeBase(MORPHO_VALID_FLAT)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.chainId).toBe(8453)
    })

    it('sets chainId to 84532 via normalizeBaseSepolia', () => {
      const result = MorphoAdapter.normalizeBaseSepolia(MORPHO_VALID_FLAT)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.chainId).toBe(84532)
    })
  })

  describe('normalize — error paths', () => {
    it('returns NO_POSITIONS for pure supply positions', () => {
      const result = MorphoAdapter.normalize(MORPHO_PURE_SUPPLY)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
      expect(result.error.protocol).toBe('morpho')
    })

    it('returns INVALID_RESPONSE for non-object body', () => {
      const result = MorphoAdapter.normalize('invalid')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns NO_POSITIONS when no positions array found', () => {
      const result = MorphoAdapter.normalize({ someOtherKey: [] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
    })

    it('returns INVALID_RESPONSE when positions fail validation', () => {
      const result = MorphoAdapter.normalize({
        positions: [
          { market: { invalidField: true } }, // malformed position
        ],
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns INVALID_RESPONSE for null body', () => {
      const result = MorphoAdapter.normalize(null)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns INVALID_RESPONSE when token address is not a valid EVM address', () => {
      const result = MorphoAdapter.normalize({
        positions: [
          {
            market: {
              ...MORPHO_WETH_USDC_MARKET,
              loanAsset: {
                address: 'not-an-address', // invalid
                symbol: 'USDC',
                decimals: 6,
              },
            },
            borrowShares: '100000',
            collateral: '1000000',
            supplyShares: '0',
          },
        ],
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })
  })
})

// ============================================================
// COMPOUND ADAPTER TESTS
// ============================================================

describe('CompoundAdapter', () => {
  describe('normalize — valid paths', () => {
    it('splits debt proportionally across multiple collateral assets', () => {
      const result = CompoundAdapter.normalize(COMPOUND_USDC_COMET)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      // Two collateral assets → two PositionData entries
      expect(result.data).toHaveLength(2)

      const totalDebt = result.data.reduce(
        (sum, p) => sum + p.debtAmount,
        0n,
      )
      // $50,000 USDC normalised to 1e18: 50000 * 1e6 * 1e12 = 50000 * 1e18
      const expectedTotalDebt = 50000n * WEI_PER_TOKEN
      expect(totalDebt).toBe(expectedTotalDebt)
    })

    it('assigns all debt to single collateral asset (no splitting)', () => {
      const result = CompoundAdapter.normalize(COMPOUND_SINGLE_COLLATERAL)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.data).toHaveLength(1)
      const pos = result.data[0]!
      expect(pos.protocol).toBe('compound')
      // $20,000 USDC (6 dec) → scaled to 1e18
      expect(pos.debtAmount).toBe(20000n * WEI_PER_TOKEN)
      expect(pos.collateralAsset).toBe(
        '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      )
    })

    it('normalises USDC borrow balance from 6 decimals to 1e18', () => {
      const result = CompoundAdapter.normalize(COMPOUND_SINGLE_COLLATERAL)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // borrowBalanceOf = "20000000000" (6 dec) → 20000 * 1e18
      expect(result.data[0]!.debtAmount).toBe(20_000_000_000n * 1_000_000_000_000n)
    })

    it('handles borrowBalanceOf field name (alternate API version)', () => {
      // COMPOUND_SINGLE_COLLATERAL uses borrowBalanceOf
      const result = CompoundAdapter.normalize(COMPOUND_SINGLE_COLLATERAL)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.debtAmount).toBeGreaterThan(0n)
    })

    it('handles liquidation factor in WAD format', () => {
      const result = CompoundAdapter.normalize(COMPOUND_USDC_COMET)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // First collateral (WETH): 825000000000000000 WAD → 0.825
      expect(result.data[0]!.liquidationThreshold).toBeCloseTo(0.825, 3)
    })

    it('handles liquidation factor in decimal format', () => {
      const result = CompoundAdapter.normalize(COMPOUND_USDC_COMET)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Second collateral (WBTC): "0.75" → 0.75
      expect(result.data[1]!.liquidationThreshold).toBeCloseTo(0.75, 3)
    })

    it('sets chainId to 1 by default', () => {
      const result = CompoundAdapter.normalize(COMPOUND_SINGLE_COLLATERAL)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.chainId).toBe(1)
    })

    it('sets chainId correctly via chain-specific wrappers', () => {
      const sepolia = CompoundAdapter.normalizeTestnet(COMPOUND_SINGLE_COLLATERAL)
      const polygon = CompoundAdapter.normalizePolygon(COMPOUND_SINGLE_COLLATERAL)
      const arbitrum = CompoundAdapter.normalizeArbitrum(COMPOUND_SINGLE_COLLATERAL)
      const base = CompoundAdapter.normalizeBase(COMPOUND_SINGLE_COLLATERAL)
      const optimism = CompoundAdapter.normalizeOptimism(COMPOUND_SINGLE_COLLATERAL)

      expect(sepolia.ok && sepolia.data[0]!.chainId).toBe(11155111)
      expect(polygon.ok && polygon.data[0]!.chainId).toBe(137)
      expect(arbitrum.ok && arbitrum.data[0]!.chainId).toBe(42161)
      expect(base.ok && base.data[0]!.chainId).toBe(8453)
      expect(optimism.ok && optimism.data[0]!.chainId).toBe(10)
    })

    it('normalizes token addresses to lowercase', () => {
      const result = CompoundAdapter.normalize(COMPOUND_SINGLE_COLLATERAL)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data[0]!.collateralAsset).toBe(
        result.data[0]!.collateralAsset.toLowerCase(),
      )
    })
  })

  describe('normalize — error paths', () => {
    it('returns NO_POSITIONS when all borrows are zero', () => {
      const result = CompoundAdapter.normalize(COMPOUND_ZERO_BORROW)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
      expect(result.error.protocol).toBe('compound')
    })

    it('returns INVALID_RESPONSE for non-object body', () => {
      const result = CompoundAdapter.normalize(42)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns NO_POSITIONS when no recognized positions array found', () => {
      const result = CompoundAdapter.normalize({ unknownKey: [] })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
    })

    it('returns INVALID_RESPONSE when positions fail validation', () => {
      const result = CompoundAdapter.normalize({
        markets: [{ missingBaseToken: true }],
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns INVALID_RESPONSE for null body', () => {
      const result = CompoundAdapter.normalize(null)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })
  })
})

// ============================================================
// PLAID ADAPTER TESTS
// ============================================================

describe('PlaidAdapter', () => {
  describe('normalize — valid paths', () => {
    it('computes totalLiquidAssetsUSD from depository available balances', () => {
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // checking available: 120,000 + savings available: 500,000 = 620,000
      expect(result.data.totalLiquidAssetsUSD).toBeCloseTo(620_000, 0)
    })

    it('computes totalCreditLimitUSD from credit accounts', () => {
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Business Platinum: limit 100,000
      expect(result.data.totalCreditLimitUSD).toBeCloseTo(100_000, 0)
    })

    it('computes totalCreditUsedUSD from credit account current balances', () => {
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Business Platinum: current 15,000
      expect(result.data.totalCreditUsedUSD).toBeCloseTo(15_000, 0)
    })

    it('computes totalCreditUtilization correctly', () => {
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // 15,000 / 100,000 = 0.15
      expect(result.data.totalCreditUtilization).toBeCloseTo(0.15, 3)
    })

    it('clamps credit utilization to 1.0 for over-limit accounts', () => {
      const result = PlaidAdapter.normalize(PLAID_OVER_LIMIT_CREDIT)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // 5200 / 5000 = 1.04 → clamped to 1.0
      expect(result.data.totalCreditUtilization).toBe(1.0)
    })

    it('excludes loan account balance from liquid assets', () => {
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // Mortgage 750k should NOT be in liquid assets
      expect(result.data.totalLiquidAssetsUSD).toBeLessThan(750_000)
    })

    it('includes loan account in accounts array with correct type', () => {
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return

      const loanAccount = result.data.accounts.find(
        (a) => a.accountId === 'acc_loan_004',
      )
      expect(loanAccount).toBeDefined()
      expect(loanAccount!.type).toBe('loan')
      expect(loanAccount!.currentUSD).toBeCloseTo(750_000, 0)
    })

    it('returns correct account count', () => {
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.accounts).toHaveLength(4)
    })

    it('excludes non-USD account from liquid assets totals', () => {
      const result = PlaidAdapter.normalize(PLAID_NON_USD)
      // Should fail — only non-USD accounts present
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
    })

    it('uses available balance for depository when current differs', () => {
      // Checking: current=125000.50, available=120000.00
      // We should use 120000 (available), not 125000.50 (current)
      const result = PlaidAdapter.normalize(PLAID_FULL_RESPONSE)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // If it used current: 125000.50 + 500000 = 625000.50
      // If it used available: 120000 + 500000 = 620000
      expect(result.data.totalLiquidAssetsUSD).toBeCloseTo(620_000, 0)
    })

    it('sets totalCreditUtilization to 0 when no credit accounts exist', () => {
      const noCredit: unknown = {
        accounts: [
          {
            account_id: 'acc_dep',
            type: 'depository',
            subtype: 'checking',
            name: 'Checking',
            mask: '0000',
            balances: {
              current: 10000,
              available: 9500,
              limit: null,
              iso_currency_code: 'USD',
              unofficial_currency_code: null,
            },
          },
        ],
        request_id: 'req_nocredit',
      }
      const result = PlaidAdapter.normalize(noCredit)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.data.totalCreditUtilization).toBe(0)
      expect(result.data.totalCreditLimitUSD).toBe(0)
    })
  })

  describe('normalize — error paths', () => {
    it('returns INVALID_RESPONSE for Plaid error envelope', () => {
      const result = PlaidAdapter.normalize(PLAID_ERROR_RESPONSE)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
      expect(result.error.protocol).toBe('plaid')
      expect(result.error.message).toContain('ITEM_ERROR')
    })

    it('returns INVALID_RESPONSE when accounts field is missing', () => {
      const result = PlaidAdapter.normalize({ request_id: 'req_noaccounts' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns NO_POSITIONS for empty accounts array', () => {
      const result = PlaidAdapter.normalize({ accounts: [], request_id: 'req' })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
    })

    it('returns INVALID_RESPONSE when all entries fail validation', () => {
      const result = PlaidAdapter.normalize({
        accounts: [{ missing_account_id: true, invalid: 'data' }],
        request_id: 'req',
      })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns INVALID_RESPONSE for non-object body', () => {
      const result = PlaidAdapter.normalize('not an object')
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns INVALID_RESPONSE for null body', () => {
      const result = PlaidAdapter.normalize(null)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('INVALID_RESPONSE')
    })

    it('returns NO_POSITIONS when only non-USD accounts exist', () => {
      const result = PlaidAdapter.normalize(PLAID_NON_USD)
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('NO_POSITIONS')
    })
  })
})
