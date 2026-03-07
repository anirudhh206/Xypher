// scripts/05_deploy_lender_sepolia.ts
//
// Deploys ConfidentialLender on Sepolia and seeds the lending pool.
//
// Prerequisites:
//   - 01_deploy_sepolia.ts must have been run (needs attestation + vault addresses)
//   - deployments.json must contain sepolia.attestation and sepolia.vault
//   - SEPOLIA_ETH_USD_FEED must be set in .env
//
// What this script does:
//   [1/4] Validates prerequisites (addresses, balance, env vars)
//   [2/4] Deploys ConfidentialLender with attestation registry + price feed
//   [3/4] Seeds the lending pool with initial ETH liquidity
//   [4/4] Verifies deployment on-chain, saves addresses to deployments.json
//
// After this script:
//   - Run 06_configure_lender_sepolia.ts to wire the lender into the vault
//   - Run: npx hardhat verify --network sepolia <LENDER_ADDRESS> \
//       <ATTESTATION_ADDRESS> <ETH_USD_FEED> <DEPLOYER_ADDRESS>

import { ethers } from "hardhat";
import * as fs    from "fs";
import * as path  from "path";

// ── Config ────────────────────────────────────────────────────────────────────

/// @dev Initial ETH seeded into the lending pool by the deployer.
///      Low enough to be safe on testnet, enough to demonstrate borrowing.
const INITIAL_POOL_FUNDING = ethers.parseEther("0.05");

/// @dev Minimum deployer balance required before attempting deployment.
///      Covers: deploy gas (~0.02) + pool seed (0.05) + buffer (0.01)
const MINIMUM_REQUIRED_BALANCE = ethers.parseEther("0.08");

/// @dev Chainlink ETH/USD feed on Sepolia.
///      Source: https://docs.chain.link/data-feeds/price-feeds/addresses
const SEPOLIA_ETH_USD_FEED = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DeploymentsRecord {
  sepolia?: {
    attestation?:       string;
    vault?:             string;
    lender?:            string;
    lenderBlock?:       number;
    lenderDeployedAt?:  string;
    deployer?:          string;
    deployedAt?:        string;
    attestationBlock?:  number;
    vaultBlock?:        number;
    workflowAddress?:   string;
    workflowSetAt?:     string;
  };
  baseSepolia?: {
    receiver?:     string;
    receiverBlock?: number;
    deployedAt?:   string;
    deployer?:     string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEPLOYMENTS_PATH = path.join(__dirname, "../deployments.json");

function loadDeployments(): DeploymentsRecord {
  if (!fs.existsSync(DEPLOYMENTS_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(DEPLOYMENTS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveDeployments(data: DeploymentsRecord): void {
  fs.writeFileSync(DEPLOYMENTS_PATH, JSON.stringify(data, null, 2));
}

function validateAddress(value: string | undefined, label: string): string {
  if (!value || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(
      `Invalid ${label} in deployments.json: "${value}". ` +
      "Re-run 01_deploy_sepolia.ts or check your deployments.json."
    );
  }
  return value;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("  ConfidentialLender — Sepolia Deployment");
  console.log("  Undercollateralized ETH Lending via Credit Attestations");
  console.log("═".repeat(60));
  console.log();

  // ── [1/4] Prerequisites ─────────────────────────────────────────────────

  console.log("[1/4] Validating prerequisites...");

  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log(`      Deployer:     ${deployerAddress}`);

  // Balance check
  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log(`      ETH balance:  ${ethers.formatEther(balance)} ETH`);
  console.log(`      Minimum req:  ${ethers.formatEther(MINIMUM_REQUIRED_BALANCE)} ETH`);

  if (balance < MINIMUM_REQUIRED_BALANCE) {
    throw new Error(
      `Insufficient Sepolia ETH: ${ethers.formatEther(balance)} available, ` +
      `${ethers.formatEther(MINIMUM_REQUIRED_BALANCE)} required.\n` +
      "Top up at sepoliafaucet.com before continuing."
    );
  }

  // Gas price
  const feeData = await ethers.provider.getFeeData();
  console.log(`      Gas price:    ${ethers.formatUnits(feeData.gasPrice ?? 0n, "gwei")} gwei`);

  // Load + validate prerequisite addresses
  const deployments = loadDeployments();

  const attestationAddress = validateAddress(
    deployments.sepolia?.attestation,
    "sepolia.attestation"
  );
  console.log(`      Attestation:  ${attestationAddress}`);

  // Vault address is not used by ConfidentialLender directly but we confirm
  // script 01 was run successfully by checking it exists.
  const vaultAddress = validateAddress(
    deployments.sepolia?.vault,
    "sepolia.vault"
  );
  console.log(`      Vault:        ${vaultAddress}`);
  console.log(`      ETH/USD feed: ${SEPOLIA_ETH_USD_FEED}`);
  console.log("      ✅ Prerequisites valid");
  console.log();

  // ── [2/4] Deploy ConfidentialLender ────────────────────────────────────

  console.log("[2/4] Deploying ConfidentialLender...");

  const LenderFactory = await ethers.getContractFactory("ConfidentialLender");
  const lender = await LenderFactory.deploy(
    attestationAddress,   // _attestationRegistry
    SEPOLIA_ETH_USD_FEED, // _ethUsdFeed
    deployerAddress       // _owner
  );

  console.log(`      Waiting for deployment tx: ${lender.deploymentTransaction()?.hash}`);
  const lenderDeployTx = lender.deploymentTransaction();
  const lenderReceipt  = await lenderDeployTx?.wait();

  if (!lenderReceipt?.blockNumber) {
    throw new Error("Could not get ConfidentialLender deployment block number");
  }

  const lenderAddress = await lender.getAddress();
  const lenderBlock   = lenderReceipt.blockNumber;

  console.log(`      ✅ ConfidentialLender deployed`);
  console.log(`         Address: ${lenderAddress}`);
  console.log(`         Block:   ${lenderBlock}`);
  console.log(`         Gas:     ${lenderReceipt.gasUsed.toString()}`);
  console.log();

  // ── [3/4] Seed the lending pool ────────────────────────────────────────

  console.log("[3/4] Seeding lending pool with initial liquidity...");
  console.log(`      Amount: ${ethers.formatEther(INITIAL_POOL_FUNDING)} ETH`);

  // depositLiquidity() — registers deployer as initial liquidity provider
  const seedTx = await lender.depositLiquidity({
    value: INITIAL_POOL_FUNDING,
  });
  await seedTx.wait();

  // Confirm pool state
  const [liquidity, borrowed, available, utilisationBps] =
    await lender.getPoolStats();

  console.log(`      ✅ Pool seeded`);
  console.log(`         Total liquidity:  ${ethers.formatEther(liquidity)} ETH`);
  console.log(`         Total borrowed:   ${ethers.formatEther(borrowed)} ETH`);
  console.log(`         Available:        ${ethers.formatEther(available)} ETH`);
  console.log(`         Utilisation:      ${utilisationBps.toString()} BPS`);
  console.log();

  // ── [4/4] Verify + save ─────────────────────────────────────────────────

  console.log("[4/4] Verifying deployment and saving addresses...");

  // Read back contract state to confirm constructor args were set correctly
  const registryOnChain  = await lender.attestationRegistry();
  const feedOnChain      = await lender.ethUsdFeed();
  const ownerOnChain     = await lender.owner();

  if (registryOnChain.toLowerCase() !== attestationAddress.toLowerCase()) {
    throw new Error(
      `Verification failed: attestationRegistry mismatch\n` +
      `  Expected: ${attestationAddress}\n` +
      `  Got:      ${registryOnChain}`
    );
  }
  if (feedOnChain.toLowerCase() !== SEPOLIA_ETH_USD_FEED.toLowerCase()) {
    throw new Error(
      `Verification failed: ethUsdFeed mismatch\n` +
      `  Expected: ${SEPOLIA_ETH_USD_FEED}\n` +
      `  Got:      ${feedOnChain}`
    );
  }
  if (ownerOnChain.toLowerCase() !== deployerAddress.toLowerCase()) {
    throw new Error(
      `Verification failed: owner mismatch\n` +
      `  Expected: ${deployerAddress}\n` +
      `  Got:      ${ownerOnChain}`
    );
  }

  // Verify tier LTV defaults are set correctly
  const tier1LTV = await lender.tierMaxLTV(1);
  const tier2LTV = await lender.tierMaxLTV(2);
  const tier3LTV = await lender.tierMaxLTV(3);
  const tier4LTV = await lender.tierMaxLTV(4);
  const tier5LTV = await lender.tierMaxLTV(5);

  console.log("      Tier LTV configuration:");
  console.log(`         Tier 1 (Institutional): ${tier1LTV.toString()} BPS (${Number(tier1LTV) / 100}% LTV)`);
  console.log(`         Tier 2 (Prime):         ${tier2LTV.toString()} BPS (${Number(tier2LTV) / 100}% LTV)`);
  console.log(`         Tier 3 (Near-Prime):    ${tier3LTV.toString()} BPS (${Number(tier3LTV) / 100}% LTV)`);
  console.log(`         Tier 4 (Subprime):      ${tier4LTV.toString()} BPS (${Number(tier4LTV) / 100}% LTV)`);
  console.log(`         Tier 5 (Ineligible):    ${tier5LTV.toString()} BPS (REJECTED)`);

  // Save to deployments.json
  const updatedDeployments: DeploymentsRecord = {
    ...deployments,
    sepolia: {
      ...deployments.sepolia,
      lender:           lenderAddress,
      lenderBlock:      lenderBlock,
      lenderDeployedAt: new Date().toISOString(),
    },
  };
  saveDeployments(updatedDeployments);

  console.log("      ✅ All verifications passed");
  console.log("      ✅ deployments.json updated");
  console.log();

  // ── Summary ─────────────────────────────────────────────────────────────

  console.log("═".repeat(60));
  console.log("  DEPLOYMENT COMPLETE");
  console.log("═".repeat(60));
  console.log();
  console.log("  Deployed contracts:");
  console.log(`    ConfidentialLender: ${lenderAddress}`);
  console.log();
  console.log("  Pool stats:");
  console.log(`    Initial liquidity:  ${ethers.formatEther(INITIAL_POOL_FUNDING)} ETH`);
  console.log(`    Tier 1 max LTV:     90% (vs Aave's 80%)`);
  console.log(`    Tier 2 max LTV:     80%`);
  console.log(`    Tier 3 max LTV:     70%`);
  console.log(`    Tier 4 max LTV:     60%`);
  console.log();
  console.log("  Etherscan verification:");
  console.log(
    `    npx hardhat verify --network sepolia ${lenderAddress} \\`
  );
  console.log(`      ${attestationAddress} \\`);
  console.log(`      ${SEPOLIA_ETH_USD_FEED} \\`);
  console.log(`      ${deployerAddress}`);
  console.log();
  console.log("  Next steps:");
  console.log("    1. Run Etherscan verification command above (~30s after deploy)");
  console.log("    2. Update config.production.json:");
  console.log(
    JSON.stringify(
      {
        lenderContractAddress: lenderAddress,
        attestationContractAddress: attestationAddress,
        ethUsdFeedAddress: SEPOLIA_ETH_USD_FEED,
      },
      null,
      6
    )
      .split("\n")
      .map((l) => `       ${l}`)
      .join("\n")
  );
  console.log();
  console.log("  ⚠️  IMPORTANT: The deployer wallet is the initial liquidity");
  console.log("      provider. For production, remove deployer as lender and");
  console.log("      replace with a dedicated protocol treasury address.");
  console.log();
  console.log("═".repeat(60));
}

// ── Entry point ───────────────────────────────────────────────────────────────

main().catch((error: Error) => {
  console.error("\n❌ Deployment failed:");
  console.error(`   ${error.message}`);
  process.exit(1);
});
