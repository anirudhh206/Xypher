import { ethers } from "hardhat";
import * as fs    from "fs";
import * as path  from "path";

const BASE_SEPOLIA_CHAIN_SELECTOR = 10344971235874465080n;
const MINIMUM_BALANCE             = ethers.parseEther("0.005");

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
    throw new Error(`Invalid ${label} in deployments.json: "${value}".`);
  }
  return value;
}

async function main() {
  console.log("═".repeat(60));
  console.log("  Configure Cross-Chain Broadcast (Sepolia)");
  console.log("  Registers Base Sepolia receiver as broadcast destination");
  console.log("═".repeat(60));
  console.log();

  const [deployer] = await ethers.getSigners();
  console.log(`[1/3] Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`      Balance:  ${ethers.formatEther(balance)} ETH`);
  if (balance < MINIMUM_BALANCE) {
    throw new Error(`Insufficient Sepolia ETH: ${ethers.formatEther(balance)} available.`);
  }

  const deployments = load();
  const attestationAddress = validateAddress(deployments.sepolia?.attestation, "sepolia.attestation");
  const receiverAddress    = validateAddress(deployments.baseSepolia?.attestationReceiver, "baseSepolia.attestationReceiver");

  console.log(`      Attestation: ${attestationAddress}`);
  console.log(`      Receiver:    ${receiverAddress}`);
  console.log();

  // ── [2/3] Register destination chain ─────────────────────────────────────

  console.log("[2/3] Registering Base Sepolia as broadcast destination...");
  const attestation = await ethers.getContractAt("ConfidentialGuardAttestation", attestationAddress);

  const existing = await attestation.destinationChains(BASE_SEPOLIA_CHAIN_SELECTOR);
  if (existing.active && existing.receiver.toLowerCase() === receiverAddress.toLowerCase()) {
    console.log("      ℹ️  Already configured — no action needed");
  } else {
    const tx = await attestation.registerDestinationChain(BASE_SEPOLIA_CHAIN_SELECTOR, receiverAddress);
    await tx.wait();
    console.log(`      ✅ Destination chain registered`);
    console.log(`         Chain selector: ${BASE_SEPOLIA_CHAIN_SELECTOR}`);
    console.log(`         Receiver:       ${receiverAddress}`);
  }
  console.log();

  // ── [3/3] Verify ─────────────────────────────────────────────────────────

  console.log("[3/3] Verifying configuration...");
  const dest = await attestation.destinationChains(BASE_SEPOLIA_CHAIN_SELECTOR);

  if (!dest.active) {
    throw new Error("Verification failed: destination chain not marked active");
  }
  if (dest.receiver.toLowerCase() !== receiverAddress.toLowerCase()) {
    throw new Error(
      `Verification failed: receiver mismatch\n  Expected: ${receiverAddress}\n  Got: ${dest.receiver}`
    );
  }

  const chains = await attestation.getRegisteredChains();
  console.log(`      Registered chains: ${chains.length}`);
  console.log(`      Broadcast pool:    ${ethers.formatEther(await attestation.broadcastPool())} ETH`);

  const updated = {
    ...deployments,
    sepolia: {
      ...deployments.sepolia,
      broadcastConfiguredAt: new Date().toISOString(),
      broadcastDestinations: chains.map((c: bigint) => c.toString()),
    },
  };
  save(updated);

  console.log("      ✅ Verified");
  console.log("      ✅ deployments.json updated");
  console.log();

  console.log("═".repeat(60));
  console.log("  BROADCAST CONFIGURED");
  console.log("═".repeat(60));
  console.log();
  console.log("  Cross-chain credit portability is now live:");
  console.log("  Attestation minted on Sepolia → auto-mirrors to Base Sepolia");
  console.log("  Any protocol on Base Sepolia can call verifyAttestation()");
  console.log("  on the CrossChainAttestationReceiver to check credit tier.");
  console.log();
  console.log("  Next: Run 01 through 08 in order to deploy everything.");
  console.log("═".repeat(60));
}

main().catch((err: Error) => {
  console.error("\n❌ Configuration failed:", err.message);
  process.exit(1);
});
