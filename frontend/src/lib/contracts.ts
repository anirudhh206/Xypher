import { parseAbi } from "viem";

// ── Deployed contract addresses (Sepolia) ──────────────────────────────────
export const CONTRACTS = {
  attestation: "0x213f4f61448c062cFBEC012Ce81008a8EFf35E05" as const,
  lender:      "0x5718b01d28dA26dBDB0C534A26E2dc8c756B7288" as const,
  nft:         "0x8208ebBB6DF76fB8998A339861FaF41ADD7A70e1" as const,
  vault:       "0x607A1d43BAcE9Ef8C370102750eec33b1A97198C" as const,
  ethUsdFeed:  "0x694AA1769357215DE4FAC081bf1f309aDC325306" as const,
  btcUsdFeed:  "0x1b44F3514812d835EB1BDB0acB33d3fA3351Ee43" as const,
  ccipReceiver: "0x021cBE5e32F61559A52262F0d281928C28760Df3" as const,
};

// ── ABIs ───────────────────────────────────────────────────────────────────
export const ATTESTATION_ABI = parseAbi([
  "function verifyAttestation(address subject, uint8 minTier) view returns (bool valid, uint8 tier, uint64 expiry)",
  "function hasPermission(address subject) view returns (bool)",
  "function grantPermission() nonpayable",
  "function revokePermission() nonpayable",
]);

export const LENDER_ABI = parseAbi([
  // Pool stats
  "function getPoolStats() view returns (uint256 liquidity, uint256 borrowed, uint256 available, uint256 utilisationBps)",
  // Per-user position (real on-chain data)
  "function getPosition(address borrower) view returns (uint256 collateral, uint256 borrowed, uint256 interest, uint8 tier, uint256 healthFactor)",
  "function getMaxBorrow(address borrower) view returns (uint256 maxETH, uint8 tier)",
  "function getHealthFactor(address borrower) view returns (uint256)",
  // Actions
  "function depositCollateral() payable",
  "function withdrawCollateral(uint256 amount) nonpayable",
  "function borrow(uint256 amount) nonpayable",
  "function repay() payable",
  // Config
  "function tierRates(uint8 tier) view returns (uint256)",
]);

export const FEED_ABI = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
]);

export const NFT_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
]);

export const OWNABLE_ABI = parseAbi([
  "function owner() view returns (address)",
]);

// ── Tier metadata ───────────────────────────────────────────────────────────
export const TIER_NAMES: Record<number, string> = {
  1: "Sovereign",
  2: "Assured",
  3: "Verified",
  4: "Building",
  5: "Restricted",
};

export const TIER_RATES: Record<number, string> = {
  1: "3–4%",
  2: "5–6%",
  3: "7–9%",
  4: "10–12%",
  5: "—",
};

export const TIER_COLORS: Record<number, string> = {
  1: "var(--cyan)",
  2: "#10b981",
  3: "#6366f1",
  4: "#f59e0b",
  5: "#ef4444",
};

export const SEPOLIA_EXPLORER = "https://sepolia.etherscan.io";
