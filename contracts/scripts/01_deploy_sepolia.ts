// ============================================================
// ConfidentialGuard Protocol — Sepolia Deployment Script
// scripts/01_deploy_sepolia.ts
//
// Deploys to Ethereum Sepolia:
//   1. ConfidentialGuardAttestation — ERC-style attestation registry
//   2. GuardianVault — CCIP-enabled health factor guardian
//
// Run with:
//   npx hardhat run scripts/01_deploy_sepolia.ts --network sepolia
//
// After this script:
//   - Record ATTESTATION_ADDRESS and VAULT_ADDRESS
//   - Run 02_deploy_base_sepolia.ts with VAULT_ADDRESS
//   - Run 03_configure_sepolia.ts with RECEIVER_ADDRESS
//   - Register the CRE workflow, then run 04_set_workflow.ts
// ============================================================

import hre from 'hardhat'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

// ── Sepolia Chainlink Addresses ───────────────────────────────────────────────
// Source: https://docs.chain.link/ccip/supported-networks/v1_2_0/testnet
// Source: https://docs.chain.link/data-feeds/price-feeds/addresses
const SEPOLIA_CCIP_ROUTER    = '0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59'
const SEPOLIA_ETH_USD_FEED   = '0x694AA1769357215DE4FAC081bf1f309aDC325306'

// CCIP chain selectors (for post-deploy configuration reference)
const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n

// Guardian pool initial funding: 0.05 ETH covers ~5 CCIP messages
// CCIP fee on testnet ~0.005-0.01 ETH per message
const GUARDIAN_POOL_INITIAL_FUNDING = hre.ethers.parseEther('0.05')

// ── Deployment Record ─────────────────────────────────────────────────────────
const DEPLOYMENTS_FILE = join(__dirname, '..', 'deployments.json')

interface DeploymentsRecord {
  sepolia?: {
    attestation?:      string
    vault?:            string
    deployer?:         string
    deployedAt?:       string
    attestationBlock?: number
    vaultBlock?:       number
  }
  baseSepolia?: {
    receiver?:      string
    deployer?:      string
    deployedAt?:    string
    receiverBlock?: number
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

function saveDeployments(data: DeploymentsRecord): void {
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(data, null, 2))
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { ethers, network } = hre

  // Validate network
  if (network.name !== 'sepolia') {
    throw new Error(
      `Wrong network: "${network.name}". ` +
      'Run with: npx hardhat run scripts/01_deploy_sepolia.ts --network sepolia',
    )
  }

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()

  console.log('=== ConfidentialGuard Protocol — Sepolia Deployment ===')
  console.log()
  console.log(`Network:  ${network.name} (chainId: ${network.config.chainId})`)
  console.log(`Deployer: ${deployerAddress}`)

  const deployerBalance = await ethers.provider.getBalance(deployerAddress)
  console.log(`Balance:  ${ethers.formatEther(deployerBalance)} ETH`)
  console.log()

  // Ensure the deployer has enough ETH for deployment + pool funding
  const minimumRequired = GUARDIAN_POOL_INITIAL_FUNDING + ethers.parseEther('0.02')
  if (deployerBalance < minimumRequired) {
    throw new Error(
      `Insufficient ETH: ${ethers.formatEther(deployerBalance)} ETH available, ` +
      `${ethers.formatEther(minimumRequired)} ETH required (deploy + pool funding)`,
    )
  }

  // ── Step 1: Deploy ConfidentialGuardAttestation ──────────────────────────
  console.log('[1/5] Deploying ConfidentialGuardAttestation...')
  console.log(`      - Initial workflow address: ${deployerAddress} (update after CRE registration)`)
  console.log(`      - Owner: ${deployerAddress}`)

  const AttestationFactory = await ethers.getContractFactory('ConfidentialGuardAttestation')
  const attestation = await AttestationFactory.deploy(
    deployerAddress, // workflowAddress — placeholder, updated after CRE workflow registration
    deployerAddress, // owner
  )
  await attestation.waitForDeployment()
  const attestationAddress = await attestation.getAddress()
  const attestationTx = attestation.deploymentTransaction()
  const attestationBlock = (await attestationTx?.wait())?.blockNumber ?? 0

  console.log(`      Deployed at: ${attestationAddress}`)
  console.log(`      Block:        ${attestationBlock}`)
  console.log(`      Tx:           ${attestationTx?.hash ?? 'unknown'}`)
  console.log()

  // ── Step 2: Deploy GuardianVault ─────────────────────────────────────────
  console.log('[2/5] Deploying GuardianVault...')
  console.log(`      - CCIP Router:   ${SEPOLIA_CCIP_ROUTER}`)
  console.log(`      - ETH/USD Feed:  ${SEPOLIA_ETH_USD_FEED}`)
  console.log(`      - Owner:         ${deployerAddress}`)

  const VaultFactory = await ethers.getContractFactory('GuardianVault')
  const vault = await VaultFactory.deploy(
    SEPOLIA_CCIP_ROUTER,
    SEPOLIA_ETH_USD_FEED,
    deployerAddress,
  )
  await vault.waitForDeployment()
  const vaultAddress = await vault.getAddress()
  const vaultTx = vault.deploymentTransaction()
  const vaultBlock = (await vaultTx?.wait())?.blockNumber ?? 0

  console.log(`      Deployed at: ${vaultAddress}`)
  console.log(`      Block:        ${vaultBlock}`)
  console.log(`      Tx:           ${vaultTx?.hash ?? 'unknown'}`)
  console.log()

  // ── Step 3: Fund the guardian pool ───────────────────────────────────────
  console.log('[3/5] Funding GuardianVault guardian pool...')
  console.log(`      Amount: ${ethers.formatEther(GUARDIAN_POOL_INITIAL_FUNDING)} ETH`)

  const fundTx = await vault.fundGuardianPool({ value: GUARDIAN_POOL_INITIAL_FUNDING })
  await fundTx.wait()
  const guardianPool = await vault.guardianPool()

  console.log(`      Pool balance: ${ethers.formatEther(guardianPool)} ETH`)
  console.log(`      Tx: ${fundTx.hash}`)
  console.log()

  // ── Step 4: Register deployer as trusted lender (for test setup) ─────────
  // In production, the CRE guardian-monitor calls setDebtAmount() via the
  // trusted lender. The actual lender contracts (Aave adapter, etc.) should
  // be registered. For now, we register the deployer for testing.
  console.log('[4/5] Registering deployer as trusted lender (for testing)...')
  const lenderTx = await vault.setTrustedLender(deployerAddress, true)
  await lenderTx.wait()
  console.log(`      Registered: ${deployerAddress}`)
  console.log(`      Tx: ${lenderTx.hash}`)
  console.log()

  // ── Step 5: Save deployment record ───────────────────────────────────────
  console.log('[5/5] Saving deployment record...')
  const deployments = loadDeployments()
  deployments.sepolia = {
    attestation: attestationAddress,
    vault:       vaultAddress,
    deployer:    deployerAddress,
    deployedAt:  new Date().toISOString(),
    attestationBlock,
    vaultBlock,
  }
  saveDeployments(deployments)
  console.log(`      Saved to: deployments.json`)
  console.log()

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('=== DEPLOYMENT COMPLETE ===')
  console.log()
  console.log('Addresses (Ethereum Sepolia):')
  console.log(`  ConfidentialGuardAttestation: ${attestationAddress}`)
  console.log(`  GuardianVault:                ${vaultAddress}`)
  console.log()
  console.log('Next steps:')
  console.log(`  1. Deploy CCIPGuardianReceiver on Base Sepolia:`)
  console.log(`     npx hardhat run scripts/02_deploy_base_sepolia.ts --network base-sepolia`)
  console.log()
  console.log(`  2. Configure cross-chain connections:`)
  console.log(`     npx hardhat run scripts/03_configure_sepolia.ts --network sepolia`)
  console.log()
  console.log(`  3. Register CRE workflow on the Chainlink DON`)
  console.log(`     - Set attestationContractAddress: ${attestationAddress}`)
  console.log(`     - Set guardianVaultAddress: ${vaultAddress}`)
  console.log()
  console.log(`  4. Update workflow address after CRE registration:`)
  console.log(`     npx hardhat run scripts/04_set_workflow.ts --network sepolia`)
  console.log()
  console.log('Etherscan verification:')
  console.log(`  npx hardhat verify --network sepolia ${attestationAddress} \\`)
  console.log(`    "${deployerAddress}" "${deployerAddress}"`)
  console.log()
  console.log(`  npx hardhat verify --network sepolia ${vaultAddress} \\`)
  console.log(`    "${SEPOLIA_CCIP_ROUTER}" "${SEPOLIA_ETH_USD_FEED}" "${deployerAddress}"`)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Deployment failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
