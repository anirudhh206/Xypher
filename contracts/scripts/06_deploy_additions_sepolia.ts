import { ethers } from "hardhat";
import * as fs    from "fs";
import * as path  from "path";

const SEPOLIA_CCIP_ROUTER        = "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59";
const BASE_SEPOLIA_CHAIN_SELECTOR = 10344971235874465080n;
const INITIAL_BROADCAST_FUND     = ethers.parseEther("0.02");
const MINIMUM_BALANCE            = ethers.parseEther("0.05");

const DEPLOYMENTS_PATH = path.join(__dirname, "../deployments.json");

function load(): any {
  if (!fs.existsSync(DEPLOYMENTS_PATH)) return {};
  try { return JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, "utf8")); }
  catch { return {}; }
}

function save(data: any): void {
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(data, null, 2));
}

function validateAddress(value: string | undefined, label: string): string {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`Invalid ${label} in deployments.json: "${value}". Re-run 01_deploy_sepolia.ts.`);
  }
  return value;
}

async function main() {
  console.log("═".repeat(60));
  console.log("  ConfidentialGuard — Additions Deployment (Sepolia)");
  console.log("  CreditIdentityNFT + CrossChain Broadcast Setup");
  console.log("═".repeat(60));
  console.log();

  const [deployer] = await ethers.getSigners();
  console.log(`[1/5] Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`      Balance:  ${ethers.formatEther(balance)} ETH`);
  if (balance < MINIMUM_BALANCE) {
    throw new Error(`Insufficient ETH: ${ethers.formatEther(balance)} available, ${ethers.formatEther(MINIMUM_BALANCE)} required.`);
  }

  const feeData = await ethers.provider.getFeeData();
  console.log(`      Gas:      ${ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei")} gwei`);

  const deployments = load();
  const attestationAddress = validateAddress(deployments.sepolia?.attestation, "sepolia.attestation");
  console.log(`      Attestation: ${attestationAddress}`);
  console.log();

  // ── [2/5] Deploy CreditIdentityNFT ───────────────────────────────────────

  console.log("[2/5] Deploying CreditIdentityNFT...");
  const NFTFactory = await ethers.getContractFactory("CreditIdentityNFT");
  const nft = await NFTFactory.deploy(attestationAddress, deployer.address);
  const nftReceipt = await nft.deploymentTransaction()?.wait();
  if (!nftReceipt?.blockNumber) throw new Error("CreditIdentityNFT deployment receipt missing");

  const nftAddress = await nft.getAddress();
  console.log(`      ✅ CreditIdentityNFT: ${nftAddress}`);
  console.log(`         Block: ${nftReceipt.blockNumber}`);
  console.log(`         Gas:   ${nftReceipt.gasUsed}`);
  console.log();

  // ── [3/5] Wire CCIP router into attestation contract ─────────────────────

  console.log("[3/5] Setting CCIP router on ConfidentialGuardAttestation...");
  const attestation = await ethers.getContractAt("ConfidentialGuardAttestation", attestationAddress);
  const setRouterTx = await attestation.setCCIPRouter(SEPOLIA_CCIP_ROUTER);
  await setRouterTx.wait();
  console.log(`      ✅ CCIP router set: ${SEPOLIA_CCIP_ROUTER}`);
  console.log();

  // ── [4/5] Fund broadcast pool ─────────────────────────────────────────────

  console.log("[4/5] Funding broadcast pool...");
  console.log(`      Amount: ${ethers.formatEther(INITIAL_BROADCAST_FUND)} ETH`);
  const fundTx = await attestation.fundBroadcastPool({ value: INITIAL_BROADCAST_FUND });
  await fundTx.wait();
  const poolBalance = await attestation.broadcastPool();
  console.log(`      ✅ Broadcast pool funded: ${ethers.formatEther(poolBalance)} ETH`);
  console.log();

  // ── [5/5] Save + verify ───────────────────────────────────────────────────

  console.log("[5/5] Verifying and saving...");

  const registryOnChain = await nft.attestationRegistry();
  if (registryOnChain.toLowerCase() !== attestationAddress.toLowerCase()) {
    throw new Error(`NFT registry mismatch: expected ${attestationAddress}, got ${registryOnChain}`);
  }

  const routerOnChain = await attestation.ccipRouter();
  if (routerOnChain.toLowerCase() !== SEPOLIA_CCIP_ROUTER.toLowerCase()) {
    throw new Error(`CCIP router mismatch: expected ${SEPOLIA_CCIP_ROUTER}, got ${routerOnChain}`);
  }

  const updated = {
    ...deployments,
    sepolia: {
      ...deployments.sepolia,
      nft:              nftAddress,
      nftBlock:         nftReceipt.blockNumber,
      nftDeployedAt:    new Date().toISOString(),
      ccipRouterSet:    SEPOLIA_CCIP_ROUTER,
      broadcastPool:    ethers.formatEther(poolBalance),
    },
  };
  save(updated);

  console.log("      ✅ All verifications passed");
  console.log("      ✅ deployments.json updated");
  console.log();

  console.log("═".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log();
  console.log("  Deployed:");
  console.log(`    CreditIdentityNFT:  ${nftAddress}`);
  console.log();
  console.log("  Next: Deploy CrossChainAttestationReceiver on Base Sepolia");
  console.log("    npx hardhat run scripts/07_deploy_receiver_base_sepolia.ts --network base-sepolia");
  console.log();
  console.log("  Etherscan verification:");
  console.log(`    npx hardhat verify --network sepolia ${nftAddress} \\`);
  console.log(`      ${attestationAddress} ${deployer.address}`);
  console.log("═".repeat(60));
}

main().catch((err: Error) => {
  console.error("\n❌ Deployment failed:", err.message);
  process.exit(1);
});
