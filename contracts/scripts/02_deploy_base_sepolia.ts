import hre from 'hardhat'
import { writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
const BASE_SEPOLIA_CCIP_ROUTER = '0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93'
const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n
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
  if (network.name !== 'base-sepolia') {
    throw new Error(
      `Wrong network: "${network.name}". ` +
      'Run with: npx hardhat run scripts/02_deploy_base_sepolia.ts --network base-sepolia',
    )
  }

  // Load the Sepolia vault address from the previous deployment
  const deployments = loadDeployments()
  const sepoliaVaultAddress = deployments.sepolia?.vault

  if (!sepoliaVaultAddress || !/^0x[0-9a-fA-F]{40}$/.test(sepoliaVaultAddress)) {
    throw new Error(
      `Invalid Sepolia vault address in deployments.json: "${sepoliaVaultAddress}". ` +
      'Re-run 01_deploy_sepolia.ts.',
    )
  }

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()

  console.log('=== ConfidentialGuard Protocol — Base Sepolia Deployment ===')
  console.log()
  console.log(`Network:  ${network.name} (chainId: ${network.config.chainId})`)
  console.log(`Deployer: ${deployerAddress}`)

  const deployerBalance = await ethers.provider.getBalance(deployerAddress)
  const minimumRequired = ethers.parseEther('0.01')
  if (deployerBalance < minimumRequired) {
    throw new Error(
      `Insufficient Base Sepolia ETH: ${ethers.formatEther(deployerBalance)} available, ` +
      `${ethers.formatEther(minimumRequired)} required`,
    )
  }
  console.log(`Balance:  ${ethers.formatEther(deployerBalance)} ETH`)
  console.log()
  console.log(`Sepolia GuardianVault: ${sepoliaVaultAddress} (from deployments.json)`)
  console.log()

  // ── Step 1: Deploy CCIPGuardianReceiver ───────────────────────────────────
  console.log('[1/3] Deploying CCIPGuardianReceiver...')
  console.log(`      - CCIP Router: ${BASE_SEPOLIA_CCIP_ROUTER}`)
  console.log(`      - Owner:       ${deployerAddress}`)

  const ReceiverFactory = await ethers.getContractFactory('CCIPGuardianReceiver')
  const receiver = await ReceiverFactory.deploy(
    BASE_SEPOLIA_CCIP_ROUTER,
    deployerAddress,
  )
  await receiver.waitForDeployment()
  const receiverAddress = await receiver.getAddress()
  const receiverTx = receiver.deploymentTransaction()
  const receiverReceipt = await receiverTx?.wait()
  if (!receiverReceipt?.blockNumber) {
    throw new Error('Could not get receiver deployment block number')
  }
  const receiverBlock = receiverReceipt.blockNumber

  console.log(`      Deployed at: ${receiverAddress}`)
  console.log(`      Block:        ${receiverBlock}`)
  console.log(`      Tx:           ${receiverTx?.hash ?? 'unknown'}`)
  console.log()

  // ── Step 2: Register Sepolia as allowed source chain ─────────────────────
  // The receiver will only process CCIP messages from the GuardianVault
  // on Ethereum Sepolia. Any other message is rejected.
  console.log('[2/3] Registering Sepolia as allowed source chain...')
  console.log(`      Chain selector: ${SEPOLIA_CHAIN_SELECTOR}`)
  console.log(`      Allowed sender: ${sepoliaVaultAddress}`)

  const setSourceTx = await receiver.setSourceChain(
    SEPOLIA_CHAIN_SELECTOR,
    true,
    sepoliaVaultAddress,
  )
  await setSourceTx.wait()
  console.log(`      Tx: ${setSourceTx.hash}`)
  console.log()

  // ── Step 3: Save deployment record ───────────────────────────────────────
  console.log('[3/3] Saving deployment record...')
  deployments.baseSepolia = {
    receiver:      receiverAddress,
    deployer:      deployerAddress,
    deployedAt:    new Date().toISOString(),
    receiverBlock,
  }
  saveDeployments(deployments)
  console.log(`      Saved to: deployments.json`)
  console.log()

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('=== DEPLOYMENT COMPLETE ===')
  console.log()
  console.log('Addresses (Base Sepolia):')
  console.log(`  CCIPGuardianReceiver: ${receiverAddress}`)
  console.log()
  console.log('Source chain configuration applied:')
  console.log(`  Sepolia selector ${SEPOLIA_CHAIN_SELECTOR} → ${sepoliaVaultAddress}`)
  console.log()
  console.log('Next steps:')
  console.log(`  1. Configure GuardianVault on Sepolia to point to this receiver:`)
  console.log(`     npx hardhat run scripts/03_configure_sepolia.ts --network sepolia`)
  console.log()
  console.log('Basescan verification:')
  console.log(`  npx hardhat verify --network base-sepolia ${receiverAddress} \\`)
  console.log(`    "${BASE_SEPOLIA_CCIP_ROUTER}" "${deployerAddress}"`)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Deployment failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
