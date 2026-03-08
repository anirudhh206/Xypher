"use client";

import Link from "next/link";

export default function E2ETestingPage() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--void)",
        padding: "40px",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <h1
          style={{
            fontSize: "32px",
            fontWeight: 700,
            marginBottom: "24px",
            color: "var(--slate)",
          }}
        >
          End-to-End Testing Guide
        </h1>

        <div
          style={{
            padding: "24px",
            background: "rgba(6,182,212,0.08)",
            border: "1px solid rgba(6,182,212,0.2)",
            borderRadius: "8px",
            marginBottom: "32px",
          }}
        >
          <p style={{ fontSize: "14px", color: "var(--slate2)", lineHeight: 1.8 }}>
            This guide walks through the complete ConfidentialGuard flow from wallet connection to
            cross-chain borrowing with credit attestation.
          </p>
        </div>

        {/* Test Phases */}
        <div style={{ display: "grid", gap: "24px" }}>
          {/* Phase 1 */}
          <Phase
            number="1"
            title="Wallet Connection & Setup"
            steps={[
              {
                action: "Connect wallet",
                details:
                  "Click 'Connect Wallet' on dashboard. Use Sepolia test network (chain ID 11155111)",
              },
              {
                action: "Fund wallet",
                details:
                  "Ensure >= 10 ETH on Sepolia. Visit https://www.alchemy.com/faucets/ethereum-sepolia",
              },
              {
                action: "Navigate to Dashboard",
                details:
                  "You should see 'No active positions' message as positions auto-fetch from Aave/Morpho/Compound",
              },
            ]}
          />

          {/* Phase 2 */}
          <Phase
            number="2"
            title="Deposit Collateral"
            steps={[
              {
                action: "Bridge to test protocols",
                details:
                  "In a real flow, deposit 1+ ETH to Aave/Morpho/Compound on Sepolia to create positions",
              },
              {
                action: "Or use demo data",
                details:
                  "Check LenderView in /markets - it pulls mock positions based on wallet address hash for demo",
              },
              {
                action: "Verify positions appear",
                details:
                  "After 30-60 seconds, refresh dashboard. Positions should appear in Overview tab with UHF computed",
              },
            ]}
          />

          {/* Phase 3 */}
          <Phase
            number="3"
            title="Credit Score Assessment"
            steps={[
              {
                action: "Review credit score card",
                details:
                  "In Overview tab, CreditScoreCard shows: Tier (1-5), UHF, Contagion Score, DSS, and LTV limits",
              },
              {
                action: "Trigger attestation",
                details:
                  "Go to Attestation tab. Click 'Grant Permission' to call grantPermission() on-chain",
              },
              {
                action: "Wait for CRE workflow",
                details:
                  "In production, Chainlink CRE queries Aave/Morpho/Compound + Plaid inside TEE and computes tier",
              },
              {
                action: "View attestation",
                details:
                  "Once valid, Attestation tab shows tier badge, expiry, and link to contract on Etherscan",
              },
            ]}
          />

          {/* Phase 4 */}
          <Phase
            number="4"
            title="Borrowing & Health Factor"
            steps={[
              {
                action: "Go to Borrow tab",
                details:
                  "Shows collateral value, already borrowed, max borrowable (based on tier LTV), and available credit",
              },
              {
                action: "Enter borrow amount",
                details:
                  "In input field, enter ETH amount <= available credit (or pool liquidity). Button disables if exceeds limit",
              },
              {
                action: "Execute borrow",
                details:
                  "Click 'Borrow'. Transaction sent to ConfidentialLender.borrow(). Wait for confirmation",
              },
              {
                action: "Verify loan created",
                details:
                  "After tx succeeds, 'Active Loans' section appears showing: borrowed amount, health factor, interest accrued, tier",
              },
            ]}
          />

          {/* Phase 5 */}
          <Phase
            number="5"
            title="Risk Simulation"
            steps={[
              {
                action: "Go to /markets",
                details:
                  "Navigate to Markets page. Click 'Risk Simulator' tab to see price impact on positions",
              },
              {
                action: "Adjust price sliders",
                details:
                  "Drag ETH/BTC price sliders or use preset buttons (Crash, Normal, Rally). UHF and tier recompute in real-time",
              },
              {
                action: "Observe tier changes",
                details:
                  "If price drops 30%+, positions may drop tiers or enter liquidation risk. UI shows red warning",
              },
              {
                action: "Understand LTV limits",
                details:
                  "Each tier has different max borrowing ratios (90%, 80%, 70%, 60%, 0%). Simulator shows how HF affects access",
              },
            ]}
          />

          {/* Phase 6 */}
          <Phase
            number="6"
            title="Positions & Pool Stats"
            steps={[
              {
                action: "Go to /markets → Pool & Rates",
                details:
                  "Shows real pool liquidity, total borrowed, utilisation %, and APY for each tier",
              },
              {
                action: "Check Positions tab",
                details:
                  "Dashboard > Positions shows all multi-protocol positions in a table: protocol, chain, assets, collateral, debt, health factor",
              },
              {
                action: "Verify real-time updates",
                details:
                  "Dashboard and market data refresh every 30 seconds. Prices update live. Positions aggregate cross-chain",
              },
            ]}
          />

          {/* Phase 7 */}
          <Phase
            number="7"
            title="Cross-Chain Behavior"
            steps={[
              {
                action: "Deposit on multiple chains",
                details:
                  "In production: positions on Ethereum (Aave), Base (Morpho), Arbitrum (Compound) all aggregate into 1 UHF",
              },
              {
                action: "Verify cross-chain UHF",
                details:
                  "Unified Health Factor = sum(all collateral USD) / sum(all debt USD). Single tier governs all chains",
              },
              {
                action: "Test borrow from multiple tiers",
                details:
                  "If collateral on Base but borrow on Ethereum — UHF covers both. CCIP rebalances if tier drops below threshold",
              },
            ]}
          />

          {/* Phase 8 */}
          <Phase
            number="8"
            title="Error Handling & Edge Cases"
            steps={[
              {
                action: "Attempt borrow > available",
                details:
                  "Try to borrow more than (collateral * LTV - already borrowed). Tx should revert with clear error",
              },
              {
                action: "Wallet disconnect mid-flow",
                details:
                  "Borrow tab should show 'No credit score available' when wallet disconnects. Reconnect restores state",
              },
              {
                action: "Low health factor",
                details:
                  "If HF drops below 1.0, you're in liquidation zone. Attestation should reflect Tier 5. Borrow disabled",
              },
              {
                action: "No positions scenario",
                details:
                  "If no active positions (or all positions are stablecoins = 0 positions), credit score shows 'No positions found'",
              },
            ]}
          />
        </div>

        {/* Results Table */}
        <div style={{ marginTop: "40px" }}>
          <h2
            style={{
              fontSize: "20px",
              fontWeight: 700,
              marginBottom: "16px",
              color: "var(--slate)",
            }}
          >
            Expected Results
          </h2>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              background: "rgba(8,145,178,0.05)",
              border: "1px solid rgba(8,145,178,0.15)",
              borderRadius: "8px",
              overflow: "hidden",
            }}
          >
            <thead>
              <tr style={{ background: "rgba(8,145,178,0.1)", borderBottom: "1px solid rgba(8,145,178,0.15)" }}>
                <th
                  style={{
                    padding: "12px",
                    textAlign: "left",
                    fontWeight: 700,
                    fontSize: "12px",
                    color: "var(--slate)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Feature
                </th>
                <th
                  style={{
                    padding: "12px",
                    textAlign: "left",
                    fontWeight: 700,
                    fontSize: "12px",
                    color: "var(--slate)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Status
                </th>
                <th
                  style={{
                    padding: "12px",
                    textAlign: "left",
                    fontWeight: 700,
                    fontSize: "12px",
                    color: "var(--slate)",
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                  }}
                >
                  Notes
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  feature: "Real-time position fetching",
                  status: "✅ Complete",
                  notes: "Fetches Aave/Morpho/Compound via mock APIs (deterministic by wallet address)",
                },
                {
                  feature: "Unified Health Factor",
                  status: "✅ Complete",
                  notes: "Computed client-side. In production via Chainlink CRE TEE",
                },
                {
                  feature: "Credit score calculation",
                  status: "✅ Complete",
                  notes: "Tier 1-5 assigned based on UHF, contagion, DSS. Mock Plaid for now",
                },
                {
                  feature: "On-chain attestation",
                  status: "✅ Complete",
                  notes: "grantPermission() and verifyAttestation() work on Sepolia",
                },
                {
                  feature: "Borrow with health factor",
                  status: "✅ Complete",
                  notes: "Borrow limited by (collateral * tier LTV - already borrowed)",
                },
                {
                  feature: "Cross-chain aggregation",
                  status: "✅ Framework Ready",
                  notes: "Multi-chain positions aggregate in UHF. Real positions need Aave/Morpho/Compound on multiple chains",
                },
                {
                  feature: "Price simulation",
                  status: "✅ Complete",
                  notes: "Demo shows how price swings impact tier and borrow capacity",
                },
                {
                  feature: "Pool stats & rates",
                  status: "✅ Complete",
                  notes: "Fetches from contract. Displays utilisation and APY by tier",
                },
              ].map((row, i) => (
                <tr key={i} style={{ borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
                  <td style={{ padding: "12px", color: "var(--slate)" }}>{row.feature}</td>
                  <td style={{ padding: "12px", color: "var(--slate)", fontWeight: 600 }}>
                    {row.status}
                  </td>
                  <td style={{ padding: "12px", fontSize: "12px", color: "var(--slate2)" }}>
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Navigation */}
        <div
          style={{
            display: "flex",
            gap: "16px",
            marginTop: "40px",
            flexWrap: "wrap",
          }}
        >
          <Link
            href="/dashboard"
            style={{
              padding: "12px 24px",
              background: "linear-gradient(135deg, #0891b2, #06b6d4)",
              color: "#ffffff",
              textDecoration: "none",
              fontWeight: 700,
              borderRadius: "6px",
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Go to Dashboard
          </Link>
          <Link
            href="/markets"
            style={{
              padding: "12px 24px",
              background: "rgba(8,145,178,0.1)",
              border: "1px solid rgba(8,145,178,0.3)",
              color: "var(--slate)",
              textDecoration: "none",
              fontWeight: 700,
              borderRadius: "6px",
              fontSize: "12px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Go to Markets
          </Link>
        </div>
      </div>
    </div>
  );
}

function Phase({
  number,
  title,
  steps,
}: {
  number: string;
  title: string;
  steps: { action: string; details: string }[];
}) {
  return (
    <div
      style={{
        padding: "20px",
        background: "white",
        border: "1px solid rgba(8,145,178,0.15)",
        borderRadius: "8px",
      }}
    >
      <h2
        style={{
          fontSize: "16px",
          fontWeight: 700,
          marginBottom: "16px",
          color: "var(--slate)",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <span
          style={{
            width: "32px",
            height: "32px",
            borderRadius: "50%",
            background: "linear-gradient(135deg, #0891b2, #06b6d4)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontWeight: 700,
          }}
        >
          {number}
        </span>
        {title}
      </h2>

      <div style={{ display: "grid", gap: "12px" }}>
        {steps.map((step, i) => (
          <div
            key={i}
            style={{
              padding: "12px",
              background: "rgba(8,145,178,0.05)",
              borderLeft: "2px solid #0891b2",
              borderRadius: "4px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                fontWeight: 700,
                color: "#0891b2",
                marginBottom: "4px",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {step.action}
            </div>
            <div style={{ fontSize: "12px", color: "var(--slate2)", lineHeight: 1.6 }}>
              {step.details}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
