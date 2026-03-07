// ============================================================
// ConfidentialGuard Protocol — Sepolia Post-Deploy Configuration
// scripts/03_configure_sepolia.ts
//
// Configures cross-chain connections on Ethereum Sepolia:
//   - GuardianVault: register Base Sepolia receiver as destination chain
//
// Run with:
//   npx hardhat run scripts/03_configure_sepolia.ts --network sepolia
//
// Prerequisites:
//   - 01_deploy_sepolia.ts (vault deployed)
//   - 02_deploy_base_sepolia.ts (receiver deployed, address in deployments.json)
// ============================================================

import hre from 'hardhat'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// ── CCIP Chain Selectors ──────────────────────────────────────────────────────
// Source: https://docs.chain.link/ccip/supported-networks/v1_2_0/testnet
const BASE_SEPOLIA_CHAIN_SELECTOR = 10344971235874465080n

// ── Deployments Record ────────────────────────────────────────────────────────
const DEPLOYMENTS_FILE = join(__dirname, '..', 'deployments.json')

interface DeploymentsRecord {
  sepolia?: {
    attestation?: string
    vault?:       string
  }
  baseSepolia?: {
    receiver?: string
  }
}

function loadDeployments(): DeploymentsRecord {
  if (!existsSync(DEPLOYMENTS_FILE)) return {}
  try {
    return JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf-8')) as DeploymentsRecord
  } catch {
    return {}
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { ethers, network } = hre

  if (network.name !== 'sepolia') {
    throw new Error(
      `Wrong network: "${network.name}". ` +
      'Run with: npx hardhat run scripts/03_configure_sepolia.ts --network sepolia',
    )
  }

  const deployments = loadDeployments()
  const vaultAddress    = deployments.sepolia?.vault
  const receiverAddress = deployments.baseSepolia?.receiver

  const addressRegex = /^0x[0-9a-fA-F]{40}$/

  if (!vaultAddress || !addressRegex.test(vaultAddress)) {
    throw new Error(`Invalid vault address in deployments.json: "${vaultAddress}". Re-run 01_deploy_sepolia.ts.`)
  }
  if (!receiverAddress || !addressRegex.test(receiverAddress)) {
    throw new Error(`Invalid receiver address in deployments.json: "${receiverAddress}". Re-run 02_deploy_base_sepolia.ts.`)
  }

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()

  const balance = await ethers.provider.getBalance(deployerAddress)
  const minimum = ethers.parseEther('0.005')
  if (balance < minimum) {
    throw new Error(
      `Insufficient Sepolia ETH: ${ethers.formatEther(balance)} available, ` +
      `~0.005 ETH required for configuration transactions`,
    )
  }

  console.log('=== ConfidentialGuard Protocol — Sepolia Configuration ===')
  console.log()
  console.log(`Network:             ${network.name}`)
  console.log(`Deployer:            ${deployerAddress}`)
  console.log(`GuardianVault:       ${vaultAddress}`)
  console.log(`CCIPGuardianReceiver: ${receiverAddress} (Base Sepolia)`)
  console.log()

  const vault = await ethers.getContractAt('GuardianVault', vaultAddress)

  // ── Step 1: Set Base Sepolia as destination chain ─────────────────────────
  console.log('[1/2] Setting Base Sepolia as allowed destination chain on GuardianVault...')
  console.log(`      Chain selector: ${BASE_SEPOLIA_CHAIN_SELECTOR}`)
  console.log(`      Receiver:       ${receiverAddress}`)

  const setDestTx = await vault.setDestinationChain(
    BASE_SEPOLIA_CHAIN_SELECTOR,
    true,
    receiverAddress,
  )
  await setDestTx.wait()
  console.log(`      Tx: ${setDestTx.hash}`)
  console.log()

  // ── Step 2: Verify configuration ─────────────────────────────────────────
  console.log('[2/2] Verifying configuration...')

  const isAllowed = await vault.allowedDestinationChains(BASE_SEPOLIA_CHAIN_SELECTOR)
  const registeredReceiver = await vault.destinationReceivers(BASE_SEPOLIA_CHAIN_SELECTOR)
  const poolBalance = await vault.guardianPool()

  console.log(`      Base Sepolia allowed:   ${isAllowed ? 'YES' : 'NO'}`)
  console.log(`      Registered receiver:    ${registeredReceiver}`)
  console.log(`      Guardian pool balance:  ${ethers.formatEther(poolBalance)} ETH`)
  console.log()

  if (!isAllowed) {
    throw new Error(
      `Verification failed: Base Sepolia chain selector ${BASE_SEPOLIA_CHAIN_SELECTOR} ` +
      `not marked as allowed on GuardianVault`,
    )
  }
  if (registeredReceiver.toLowerCase() !== receiverAddress.toLowerCase()) {
    throw new Error(
      `Verification failed: registered receiver mismatch\n` +
      `  Expected: ${receiverAddress}\n` +
      `  Got:      ${registeredReceiver}`,
    )
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('=== CONFIGURATION COMPLETE ===')
  console.log()
  console.log('Cross-chain route configured:')
  console.log(`  GuardianVault (Sepolia) → CCIPGuardianReceiver (Base Sepolia)`)
  console.log(`  Via CCIP selector: ${BASE_SEPOLIA_CHAIN_SELECTOR}`)
  console.log()
  console.log('Next steps:')
  console.log('  1. Register the CRE workflow on the Chainlink DON')
  console.log(`     Set config.attestationContractAddress: ${deployments.sepolia?.attestation}`)
  console.log(`     Set config.guardianVaultAddress:       ${vaultAddress}`)
  console.log()
  console.log('  2. After CRE workflow registration, update the workflow address:')
  console.log('     npx hardhat run scripts/04_set_workflow.ts --network sepolia')
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Configuration failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
