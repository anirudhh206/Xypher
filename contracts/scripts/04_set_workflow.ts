// ============================================================
// ConfidentialGuard Protocol — Update CRE Workflow Address
// scripts/04_set_workflow.ts
//
// After registering the CRE workflow on the Chainlink DON, this
// script updates the workflowAddress on ConfidentialGuardAttestation
// to point to the DON's execution address.
//
// Run with:
//   WORKFLOW_ADDRESS=0x... \
//   npx hardhat run scripts/04_set_workflow.ts --network sepolia
//
// Prerequisites:
//   - 01_deploy_sepolia.ts (attestation deployed)
//   - CRE workflow registered on the Chainlink DON
//   - WORKFLOW_ADDRESS env var set to the DON workflow address
// ============================================================

import hre from 'hardhat'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

// ── Deployments Record ────────────────────────────────────────────────────────
const DEPLOYMENTS_FILE = join(__dirname, '..', 'deployments.json')

interface DeploymentsRecord {
  sepolia?: {
    attestation?: string
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
      'Run with: npx hardhat run scripts/04_set_workflow.ts --network sepolia',
    )
  }

  // The CRE DON execution address — obtained after workflow registration
  const newWorkflowAddress = process.env['WORKFLOW_ADDRESS']
  if (!newWorkflowAddress || !/^0x[0-9a-fA-F]{40}$/.test(newWorkflowAddress)) {
    throw new Error(
      'WORKFLOW_ADDRESS env var must be set to the CRE DON execution address. ' +
      'Example: WORKFLOW_ADDRESS=0xABCD... npx hardhat run scripts/04_set_workflow.ts --network sepolia',
    )
  }

  const deployments = loadDeployments()
  const attestationAddress = deployments.sepolia?.attestation

  if (!attestationAddress) {
    throw new Error('Attestation contract address not found. Run 01_deploy_sepolia.ts first.')
  }

  const [deployer] = await ethers.getSigners()
  const deployerAddress = await deployer.getAddress()

  console.log('=== ConfidentialGuard Protocol — Update Workflow Address ===')
  console.log()
  console.log(`Network:     ${network.name}`)
  console.log(`Deployer:    ${deployerAddress}`)
  console.log(`Contract:    ${attestationAddress}`)
  console.log()

  const attestation = await ethers.getContractAt('ConfidentialGuardAttestation', attestationAddress)

  // Read current workflow address
  const currentWorkflow = await attestation.workflowAddress()
  console.log(`Current workflow address: ${currentWorkflow}`)
  console.log(`New workflow address:     ${newWorkflowAddress}`)
  console.log()

  if (currentWorkflow.toLowerCase() === newWorkflowAddress.toLowerCase()) {
    console.log('Workflow address is already set to the target. No action needed.')
    return
  }

  // ── Update workflow address ───────────────────────────────────────────────
  console.log('Calling setWorkflowAddress()...')
  const tx = await attestation.setWorkflowAddress(newWorkflowAddress)
  const receipt = await tx.wait()

  console.log(`Tx:    ${tx.hash}`)
  console.log(`Block: ${receipt?.blockNumber ?? 'unknown'}`)
  console.log()

  // ── Verify update ─────────────────────────────────────────────────────────
  const updatedWorkflow = await attestation.workflowAddress()
  if (updatedWorkflow.toLowerCase() !== newWorkflowAddress.toLowerCase()) {
    throw new Error(
      `Verification failed: on-chain workflowAddress is ${updatedWorkflow}, ` +
      `expected ${newWorkflowAddress}`,
    )
  }

  console.log('=== UPDATE COMPLETE ===')
  console.log()
  console.log(`workflowAddress updated to: ${updatedWorkflow}`)
  console.log()
  console.log('The CRE workflow can now call mintAttestation() on:')
  console.log(`  ${attestationAddress}`)
  console.log()
  console.log('Update config.production.json:')
  console.log(`  "attestationContractAddress": "${attestationAddress}"`)
  console.log(`  "guardianVaultAddress":        "${deployments.sepolia?.vault ?? '<vault address>'}"`)
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('Update failed:', err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
