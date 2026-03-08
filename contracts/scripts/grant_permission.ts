import hre from 'hardhat'
import { readFileSync } from 'fs'
import { join } from 'path'

async function main() {
  const { ethers, network } = hre
  if (network.name !== 'sepolia') throw new Error('Run with --network sepolia')
  const [deployer] = await ethers.getSigners()
  const deployments = JSON.parse(readFileSync(join(__dirname, '..', 'deployments.json'), 'utf-8'))
  const attestationAddress = deployments.sepolia.attestation

  const attestation = await ethers.getContractAt('ConfidentialGuardAttestation', attestationAddress)
  const tx = await attestation.connect(deployer).grantPermission()
  const receipt = await tx.wait()
  console.log('PermissionGranted tx hash:', tx.hash)
  console.log('Block:', receipt?.blockNumber)
  console.log('Log index: 0')
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1) })
