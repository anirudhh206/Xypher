import { ethers } from "hardhat";
import * as fs    from "fs";
import * as path  from "path";

const BASE_SEPOLIA_CCIP_ROUTER   = "0xD3b06cEbF099CE7DA4AcCf578aaebFDBd6e88a93";
const SEPOLIA_CHAIN_SELECTOR     = 16015286601757825753n;
const MINIMUM_BALANCE            = ethers.parseEther("0.01");

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
  console.log("  CrossChainAttestationReceiver — Base Sepolia Deployment");
  console.log("═".repeat(60));
  console.log();

  const [deployer] = await ethers.getSigners();
  console.log(`[1/4] Deployer: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`      Balance:  ${ethers.formatEther(balance)} ETH`);
  if (balance < MINIMUM_BALANCE) {
    throw new Error(`Insufficient Base Sepolia ETH: ${ethers.formatEther(balance)} available, ${ethers.formatEther(MINIMUM_BALANCE)} required.`);
  }

  const feeData = await ethers.provider.getFeeData();
  console.log(`      Gas:      ${ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei")} gwei`);

  const deployments = load();
  const attestationAddress = validateAddress(deployments.sepolia?.attestation, "sepolia.attestation");
  console.log(`      Sepolia attestation: ${attestationAddress}`);
  console.log();

  // ── [2/4] Deploy CrossChainAttestationReceiver ────────────────────────────

  console.log("[2/4] Deploying CrossChainAttestationReceiver...");
  const ReceiverFactory = await ethers.getContractFactory("CrossChainAttestationReceiver");
  const receiver = await ReceiverFactory.deploy(BASE_SEPOLIA_CCIP_ROUTER, deployer.address);
  const receiverReceipt = await receiver.deploymentTransaction()?.wait();
  if (!receiverReceipt?.blockNumber) throw new Error("Receiver deployment receipt missing");

  const receiverAddress = await receiver.getAddress();
  console.log(`      ✅ CrossChainAttestationReceiver: ${receiverAddress}`);
  console.log(`         Block: ${receiverReceipt.blockNumber}`);
  console.log(`         Gas:   ${receiverReceipt.gasUsed}`);
  console.log();

  // ── [3/4] Register Sepolia attestation as allowed sender ─────────────────

  console.log("[3/4] Registering Sepolia attestation as allowed sender...");
  const setTx = await receiver.setAllowedSender(SEPOLIA_CHAIN_SELECTOR, attestationAddress);
  await setTx.wait();

  const registeredSender = await receiver.allowedSenders(SEPOLIA_CHAIN_SELECTOR);
  if (registeredSender.toLowerCase() !== attestationAddress.toLowerCase()) {
    throw new Error(`Sender registration mismatch: expected ${attestationAddress}, got ${registeredSender}`);
  }
  console.log(`      ✅ Allowed sender registered`);
  console.log(`         Chain selector: ${SEPOLIA_CHAIN_SELECTOR}`);
  console.log(`         Sender:         ${attestationAddress}`);
  console.log();

  // ── [4/4] Save + print next steps ────────────────────────────────────────

  console.log("[4/4] Saving to deployments.json...");
  const updated = {
    ...deployments,
    baseSepolia: {
      ...deployments.baseSepolia,
      attestationReceiver:        receiverAddress,
      attestationReceiverBlock:   receiverReceipt.blockNumber,
      attestationReceiverDeployedAt: new Date().toISOString(),
    },
  };
  save(updated);
  console.log("      ✅ deployments.json updated");
  console.log();

  console.log("═".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log();
  console.log("  Deployed:");
  console.log(`    CrossChainAttestationReceiver: ${receiverAddress}`);
  console.log();
  console.log("  Next: Register Base Sepolia receiver on Sepolia attestation");
  console.log("    npx hardhat run scripts/08_configure_broadcast.ts --network sepolia");
  console.log();
  console.log("  Etherscan verification:");
  console.log(`    npx hardhat verify --network base-sepolia ${receiverAddress} \\`);
  console.log(`      ${BASE_SEPOLIA_CCIP_ROUTER} ${deployer.address}`);
  console.log("═".repeat(60));
}

main().catch((err: Error) => {
  console.error("\n❌ Deployment failed:", err.message);
  process.exit(1);
});
