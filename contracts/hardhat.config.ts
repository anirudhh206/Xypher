import * as dotenv from 'dotenv'
import type { HardhatUserConfig } from 'hardhat/config'
import '@nomicfoundation/hardhat-toolbox'

dotenv.config()

// ─────────────────────────────────────────────────────────────────────────────
// Network-specific configuration
// ─────────────────────────────────────────────────────────────────────────────
const DEPLOYER_PRIVATE_KEY  = process.env['DEPLOYER_PRIVATE_KEY']  ?? ''
const ETHERSCAN_API_KEY     = process.env['ETHERSCAN_API_KEY']     ?? ''
const BASESCAN_API_KEY      = process.env['BASESCAN_API_KEY']      ?? ''
const SEPOLIA_RPC_URL       = process.env['SEPOLIA_RPC_URL']       ?? ''
const BASE_SEPOLIA_RPC_URL  = process.env['BASE_SEPOLIA_RPC_URL']  ?? ''

const config: HardhatUserConfig = {
  // ── Solidity compiler ────────────────────────────────────────────────────
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs:    200,   // Balanced: deploy cost vs call cost
      },
      viaIR: true,     // Keep deterministic for audit trails
      evmVersion: 'cancun', // Broadly supported — no PUSH0 yet on all L2s
    },
  },

  // ── Source paths ─────────────────────────────────────────────────────────
  paths: {
    sources:   './contracts',
    tests:     './test',
    cache:     './cache',
    artifacts: './artifacts',
  },

  // ── Networks ─────────────────────────────────────────────────────────────
  networks: {
    hardhat: {
      chainId: 31337,
      // Fork Sepolia for integration tests when needed
      // forking: { url: SEPOLIA_RPC_URL },
    },
    localhost: {
      url:     'http://127.0.0.1:8545',
      chainId: 31337,
    },
    sepolia: {
      url:      SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId:  11155111,
      gasPrice: 'auto',
    },
    'base-sepolia': {
      url:      BASE_SEPOLIA_RPC_URL,
      accounts: DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [],
      chainId:  84532,
      gasPrice: 'auto',
    },
  },

  // ── Etherscan verification ───────────────────────────────────────────────
  etherscan: {
    apiKey: {
      sepolia:      ETHERSCAN_API_KEY,
      baseSepolia:  BASESCAN_API_KEY,
    },
    customChains: [
      {
        network:    'baseSepolia',
        chainId:    84532,
        urls: {
          apiURL:     'https://api-sepolia.basescan.org/api',
          browserURL: 'https://sepolia.basescan.org',
        },
      },
    ],
  },

  // ── TypeChain ────────────────────────────────────────────────────────────
  typechain: {
    outDir: 'typechain-types',
    target: 'ethers-v6',
  },

  // ── Gas reporter ─────────────────────────────────────────────────────────
  gasReporter: {
    enabled:  process.env['REPORT_GAS'] === 'true',
    currency: 'USD',
  },
}

export default config
