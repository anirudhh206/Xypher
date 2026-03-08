import { ethers } from "hardhat";
import * as fs    from "fs";
import * as path  from "path";

const SEPOLIA_CHAIN_SELECTOR = 16015286601757825753n;
const DEPLOYMENTS_PATH = path.join(__dirname, "../deployments.json");

async function main() {
  const deployments = JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, "utf8"));

  const attestationAddress    = deployments.sepolia.attestation;
  const attestationReceiver   = deployments.baseSepolia.attestationReceiver;

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Registering ${attestationAddress} as allowed sender on ${attestationReceiver}`);

  const receiver = await ethers.getContractAt("CrossChainAttestationReceiver", attestationReceiver);
  const tx = await receiver.setAllowedSender(SEPOLIA_CHAIN_SELECTOR, attestationAddress);
  await tx.wait();

  const registered = await receiver.allowedSenders(SEPOLIA_CHAIN_SELECTOR);
  console.log(`✅ Registered: ${registered}`);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
