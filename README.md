# Xypher Sovereign — Confidential Credit Oracle

> *The world's first system that privately aggregates an institution's complete financial picture — across DeFi protocols and TradFi banks — inside a hardware-secured enclave, then issues cryptographically verifiable credit attestations that enable undercollateralized lending on any blockchain.*

**Chainlink Convergence Hackathon 2026** · [Live Demo](https://xypher.vercel.app) · [Etherscan](https://sepolia.etherscan.io/address/0x213f4f61448c062cFBEC012Ce81008a8EFf35E05)

---

## The Problem Worth $1.5 Trillion

Every DeFi lending protocol forces everyone to overcollateralize at 150%+ — regardless of their actual creditworthiness. A hedge fund with $500M in credit lines at JPMorgan and a perfect 10-year repayment history walks into DeFi and gets treated identically to an anonymous wallet that deposited yesterday.

Three walls make this unsolvable — until now:

| Wall | Problem | Xypher's Solution |
|------|---------|-------------------|
| **Identity** | DeFi cannot see your TradFi creditworthiness | Chainlink CRE TEE aggregates DeFi + TradFi privately |
| **Privacy** | Proving positions exposes your entire strategy | Only a tier number (1–5) ever touches the blockchain |
| **Fragmentation** | No system spans Aave + Morpho + Compound + banks | Unified Health Factor across all protocols in one enclave |

> This is technically unsolvable until Chainlink CRE Confidential Compute launched on February 16, 2026. The hackathon started February 19. We built this in the three weeks between those two dates.

---

## What Xypher Does

```
┌─────────────────────────────────────────────────────────────────┐
│                    Chainlink CRE TEE Enclave                    │
│                                                                 │
│  Aave V3 API ──┐                                                │
│  Morpho API ───┼──► Unified Health Factor                       │
│  Compound API ─┤    Contagion Risk Score    ──► Tier (1–5)      │
│  Plaid API ────┘    Debt Serviceability                         │
│                                                                 │
│  API credentials never leave. Raw data never leaves.           │
│  Hardware-enforced privacy — not just promises.                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ConfidentialGuardAttestation.sol
              (only tier + timestamp + expiry on-chain)
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
           ConfidentialLender     CCIP Broadcast
           (undercollateralized   (attestation valid
            lending on Sepolia)    on every chain)
```

---

## Credit Tier System

| Tier | Name | LTV | vs Aave | Who Qualifies |
|------|------|-----|---------|---------------|
| **1** | Sovereign | **90%** | +36% more capital | Institutional grade |
| **2** | Assured | **80%** | +21% more capital | Prime credit |
| **3** | Verified | **70%** | +6% more capital | Near-prime |
| **4** | Building | **60%** | Standard | Subprime |
| **5** | Restricted | — | Ineligible | High risk |

> Aave v3 WETH max LTV = 66%. A Tier 1 borrower gets **90% LTV** — 36% more capital efficiency, cryptographically proven, privately computed.

---

## Architecture

### 6 Chainlink Services — Every One Essential

```
┌──────────────────────────────────────────────────────────────┐
│  1. CRE Confidential HTTP    — private API calls in TEE      │
│  2. CRE Confidential Compute — hardware-attested risk engine │
│  3. Chainlink Data Feeds     — ETH/USD, BTC/USD pricing      │
│  4. Chainlink Automation     — guardian monitor every 5 min  │
│  5. Chainlink CCIP           — cross-chain attestation sync  │
│  6. Chainlink ACE            — compliance proof generation   │
└──────────────────────────────────────────────────────────────┘
```

### Smart Contract Layer

**Ethereum Sepolia**

| Contract | Address | Purpose |
|----------|---------|---------|
| `ConfidentialGuardAttestation` | [`0x213f4f61448c062cFBEC012Ce81008a8EFf35E05`](https://sepolia.etherscan.io/address/0x213f4f61448c062cFBEC012Ce81008a8EFf35E05) | Core attestation registry — stores tier + expiry only |
| `GuardianVault` | [`0x607A1d43BAcE9Ef8C370102750eec33b1A97198C`](https://sepolia.etherscan.io/address/0x607A1d43BAcE9Ef8C370102750eec33b1A97198C) | Position monitoring + auto-rebalance trigger |
| `ConfidentialLender` | [`0x5718b01d28dA26dBDB0C534A26E2dc8c756B7288`](https://sepolia.etherscan.io/address/0x5718b01d28dA26dBDB0C534A26E2dc8c756B7288) | Undercollateralized ETH lending powered by attestations |
| `CreditIdentityNFT` | [`0x8208ebBB6DF76fB8998A339861FaF41ADD7A70e1`](https://sepolia.etherscan.io/address/0x8208ebBB6DF76fB8998A339861FaF41ADD7A70e1) | Soulbound ERC-5192 credit identity token |

**Base Sepolia**

| Contract | Address | Purpose |
|----------|---------|---------|
| `CCIPGuardianReceiver` | [`0x021cBE5e32F61559A52262F0d281928C28760Df3`](https://sepolia.basescan.org/address/0x021cBE5e32F61559A52262F0d281928C28760Df3) | Receives CCIP messages, executes cross-chain rebalancing |
| `CrossChainAttestationReceiver` | [`0x10c6e8c1A1a44289dd26d871233604dB18D5f97a`](https://sepolia.basescan.org/address/0x10c6e8c1A1a44289dd26d871233604dB18D5f97a) | Receives attestation broadcasts from Sepolia |

---

## Risk Computation Engine

Four proprietary algorithms run inside the TEE enclave. Zero external dependencies. 100% unit tested.

### 1. Unified Health Factor (UHF)
Not per-protocol health factors — a single weighted aggregate across **all positions on all chains simultaneously**. If you have ETH collateral on Aave and the same ETH on Morpho, the correlation is captured. Standard per-protocol HF misses this entirely.

### 2. Contagion Risk Score (0–100)
Simulates 8 price crash scenarios from 5% to 50% drops in 5% increments. Finds the exact percentage drop that triggers a cascade liquidation across your entire portfolio. No DeFi protocol does this today.

### 3. Debt Serviceability Score (0–100)
Takes Plaid bank data — cash flows, existing debt payments, income — and scores how well an institution can service new debt. This is what banks use. We port it to DeFi for the first time.

### 4. Confidential Credit Score (CCS) → Tier 1–5
Combines all three scores into a single tier. Only this number ever touches the blockchain. Not the health factor. Not the collateral amounts. Not the bank data. **Just one number.**

---

## Repository Structure

```
Xypher/
├── contracts/
│   ├── contracts/
│   │   ├── core/
│   │   │   ├── ConfidentialGuardAttestation.sol
│   │   │   ├── GuardianVault.sol
│   │   │   ├── ConfidentialLender.sol
│   │   │   ├── CreditIdentityNFT.sol
│   │   │   ├── CCIPGuardianReceiver.sol
│   │   │   └── CrossChainAttestationReceiver.sol
│   │   ├── interfaces/
│   │   │   └── IConfidentialGuard.sol        ← proposed EIP standard
│   │   └── libraries/
│   │       ├── AttestationLib.sol
│   │       └── HealthFactorLib.sol
│   ├── scripts/                              ← 9 deployment scripts
│   ├── test/                                 ← 257 tests, 0 failures
│   └── hardhat.config.ts
│
├── workflows/
│   └── credit-intelligence-engine/
│       ├── src/
│       │   ├── main.ts                       ← CRE workflow entry
│       │   ├── config.ts
│       │   ├── attestation-minter.ts
│       │   └── guardian-monitor.ts
│       ├── dist/
│       │   ├── main.js                       ← compiled (623KB)
│       │   └── main.wasm                     ← WASM bundle (2.3MB)
│       └── workflow.yaml
│
└── frontend/
    ├── src/
    │   ├── app/dashboard/                    ← main dashboard
    │   ├── hooks/useRiskEngine.ts            ← live on-chain data
    │   └── lib/contracts.ts                  ← contract config
    └── package.json
```

---

## Test Suite — 257 Tests, 0 Failures

| Contract | Tests |
|----------|-------|
| ConfidentialGuardAttestation | 107 |
| CCIPGuardianReceiver | 49 |
| ConfidentialLender | 34 |
| CreditIdentityNFT | 25 |
| CrossChainAttestationReceiver | 25 |
| GuardianVault | 22 |
| AttestationLib | 20 |
| **Total** | **257** |

```bash
cd contracts
npx hardhat test
# 257 passing (0 failing)
```

---

## The Demo Flow

**5 minutes. All 6 Chainlink services. Live on Sepolia.**

```
1. Connect wallet (MetaMask, Sepolia)
         │
         ▼
2. Grant Permission
   grantPermission() → ConfidentialGuardAttestation
         │
         ▼
3. CRE Workflow Assesses Credit
   TEE queries Aave + Morpho + Plaid privately
   Computes UHF + Contagion + DSS → Tier
         │
         ▼
4. Attestation Minted On-Chain
   mintAttestation(wallet, tier, expiry)
   Soulbound NFT issued automatically
         │
         ▼
5. Borrow at Tier LTV
   Tier 1 → 90% LTV (vs Aave's 66%)
   ConfidentialLender verifies attestation on every borrow
         │
         ▼
6. CCIP Broadcasts Attestation Cross-Chain
   Tier valid on Base Sepolia automatically
         │
         ▼
7. Guardian Monitors Position
   Chainlink Automation polls every 5 min
   If HF drops → CCIP rebalancing fires automatically
```

---

## Local Setup

### Prerequisites
- Node.js 20+
- Bun (for CRE workflow compilation)
- MetaMask with Sepolia ETH

### Contracts

```bash
cd contracts
npm install
cp .env.example .env
# Fill in: SEPOLIA_RPC_URL, BASE_SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY,
#          ETHERSCAN_API_KEY, BASESCAN_API_KEY

npx hardhat test                    # run full test suite (257 passing)
npx hardhat run scripts/01_deploy_sepolia.ts --network sepolia
npx hardhat run scripts/02_deploy_base_sepolia.ts --network base-sepolia
npx hardhat run scripts/03_configure_sepolia.ts --network sepolia
```

### CRE Workflow

```bash
cd workflows/credit-intelligence-engine
bun install
bun run build                       # compiles to dist/main.js + main.wasm

# Simulate (requires CRE CLI 1.3.0+)
cre workflow simulate . --broadcast --target staging-settings
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
# Connect MetaMask on Sepolia
```

---

## IConfidentialGuard — Proposed EIP Standard

Any lending protocol can integrate Xypher with three lines:

```solidity
IConfidentialGuard attestation = IConfidentialGuard(ATTESTATION_REGISTRY);

function borrow(uint256 amount) external {
    (bool valid, uint8 tier, ) = attestation.verifyAttestation(msg.sender, 4);
    require(valid, "No valid credit attestation");
    uint256 ltvBps = tierMaxLTV[tier];  // 9000, 8000, 7000, or 6000
    // ... rest of lending logic
}
```

This interface is designed as a formal EIP — a universal credit attestation primitive that any protocol on any chain can consume without coupling to Xypher's internal architecture.

---

## Security Model

- **Attestation verified on every borrow** — no stale credit assumptions
- **Health factor checked on every borrow** — pool never under-secured
- **Liquidation at HF < 1.0** — 5% bonus incentivises keepers
- **Checks-Effects-Interactions** on all state-changing functions
- **ReentrancyGuard** on all ETH-transfer functions
- **Pausable** emergency circuit breaker
- **Immutable** workflowAddress — set once at deployment
- **Auto-expiring** attestations — credit refreshed continuously

---

## Why This Is Different

**Goldman Sachs gets preferential borrowing terms because banks know their creditworthiness. Xypher brings that to DeFi — privately.**

No central party holds the trust. No server stores your data. No competitor can see your positions. The attestation IS the trust — computed in hardware, written on-chain, valid everywhere.

This is what happens when Equifax meets blockchain. Except nobody owns it. Nobody can hack it. And nobody can take it from you.

---

*Built for Chainlink Convergence Hackathon · February–March 2026 · Solo submission*
