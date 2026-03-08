"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { parseEther } from "viem";
import { useAccount, useConnect, useDisconnect, useWriteContract } from "wagmi";
import { injected } from "wagmi/connectors";
import {
  CONTRACTS,
  ATTESTATION_ABI,
  LENDER_ABI,
  TIER_NAMES,
  TIER_COLORS,
  SEPOLIA_EXPLORER,
} from "@/lib/contracts";
import {
  useUserPositions,
  useUserCreditScore,
  useUserLoans,
  useAttestation,
  useLiveETHPrice,
  useLiveBTCPrice,
  type UserCreditScore,
} from "@/hooks/useRiskEngine";
import { useDepositCollateral, useRepay, useWithdrawCollateral } from "@/hooks/useLending";
import { getTierLTV } from "@/lib/risk-engine";

type Tab = "overview" | "positions" | "attestation" | "borrow" | "settings";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function fmt$(usd: number, decimals = 0): string {
  return `$${usd.toLocaleString("en-US", { maximumFractionDigits: decimals })}`;
}

function fmtETH(eth: number, decimals = 4): string {
  return `${eth.toFixed(decimals)} ETH`;
}

function hfColor(hf: number) {
  if (hf === 0) return "var(--muted)";
  return hf > 2.0 ? "#10b981" : hf > 1.2 ? "#f59e0b" : "#ef4444";
}

function hfLabel(hf: number): string {
  if (hf === 0) return "—";
  if (hf >= 999) return "∞";
  return hf.toFixed(2);
}

const CARD = {
  padding: "12px",
  background: "rgba(8,145,178,0.06)",
  borderRadius: "6px",
  border: "1px solid rgba(8,145,178,0.12)",
  fontSize: "12px",
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// PRICE TICKER — live Chainlink feed data
// ─────────────────────────────────────────────────────────────────────────────

function PriceTicker() {
  const ethPrice = useLiveETHPrice();
  const btcPrice = useLiveBTCPrice();
  const live = ethPrice > 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 12px",
          background: "var(--card)",
          border: "1px solid rgba(8,145,178,0.15)",
          fontSize: "11px",
        }}
      >
        <span style={{ color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>ETH</span>
        <span style={{ fontWeight: 700, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>
          {live ? fmt$(ethPrice) : "…"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "4px 12px",
          background: "var(--card)",
          border: "1px solid rgba(8,145,178,0.15)",
          fontSize: "11px",
        }}
      >
        <span style={{ color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>BTC</span>
        <span style={{ fontWeight: 700, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>
          {live ? fmt$(btcPrice) : "…"}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "5px",
          fontSize: "10px",
          color: live ? "#10b981" : "var(--muted)",
          fontFamily: "Space Mono,monospace",
        }}
      >
        <div
          style={{
            width: "5px",
            height: "5px",
            borderRadius: "50%",
            background: live ? "#10b981" : "var(--muted)",
          }}
          className={live ? "pulse-cyan" : undefined}
        />
        {live ? "Live · Chainlink" : "Loading…"}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WALLET SECTION
// ─────────────────────────────────────────────────────────────────────────────

function WalletSection() {
  const { address, isConnected } = useAccount();
  const { mutate: connect } = useConnect();
  const { mutate: disconnect } = useDisconnect();

  if (!isConnected) {
    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
        <button
          onClick={() => connect({ connector: injected() })}
          style={{
            width: "100%",
            padding: "10px 16px",
            background: "linear-gradient(135deg, var(--cyan), #06b6d4)",
            border: "none",
            color: "#ffffff",
            fontWeight: 700,
            cursor: "pointer",
            fontSize: "12px",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            borderRadius: "4px",
          }}
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
      <div
        style={{
          fontSize: "10px",
          color: "var(--muted)",
          marginBottom: "6px",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }}
      >
        Connected
      </div>
      <div
        style={{
          fontFamily: "Space Mono,monospace",
          fontSize: "12px",
          fontWeight: 700,
          color: "var(--slate)",
          marginBottom: "8px",
        }}
      >
        {shortAddr(address!)}
      </div>
      <button
        onClick={() => disconnect()}
        style={{
          width: "100%",
          padding: "6px 12px",
          background: "rgba(8,145,178,0.1)",
          border: "1px solid rgba(8,145,178,0.2)",
          color: "var(--cyan)",
          fontWeight: 600,
          cursor: "pointer",
          fontSize: "11px",
          textTransform: "uppercase",
          borderRadius: "3px",
        }}
      >
        Disconnect
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT SCORE CARD
// ─────────────────────────────────────────────────────────────────────────────

function CreditScoreCard({ score }: { score: UserCreditScore }) {
  if (score.loading) {
    return <div style={{ padding: "16px", color: "var(--muted)" }}>Computing credit score…</div>;
  }

  if (!score.score) {
    return (
      <div style={{ padding: "16px", fontSize: "13px", color: "var(--slate2)", lineHeight: 1.7 }}>
        No external DeFi positions found.
        <br />
        <span style={{ fontSize: "11px", color: "var(--muted)" }}>
          Deposit collateral to Aave or Morpho on Sepolia, or use our lender below.
        </span>
      </div>
    );
  }

  const { tier, unifiedHealthFactor, contagionScore, debtServiceabilityScore } = score.score;

  return (
    <div style={{ padding: "16px" }}>
      <div style={{ marginBottom: "16px" }}>
        <div
          style={{
            fontSize: "11px",
            color: "var(--muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: "4px",
          }}
        >
          Credit Tier
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "50%",
              background: TIER_COLORS[tier],
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "20px",
            }}
          >
            {tier}
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--slate)" }}>
              {TIER_NAMES[tier]}
            </div>
            <div style={{ fontSize: "11px", color: "var(--muted)" }}>
              {(getTierLTV(tier) * 100).toFixed(0)}% LTV
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "12px" }}>
        {[
          { label: "UHF", value: unifiedHealthFactor.toFixed(2) },
          { label: "Contagion", value: `${contagionScore}%` },
          { label: "DSS", value: `${debtServiceabilityScore}%` },
          { label: "Max LTV", value: `${(getTierLTV(tier) * 100).toFixed(0)}%` },
        ].map(({ label, value }) => (
          <div key={label} style={{ padding: "10px", background: "rgba(8,145,178,0.06)", borderRadius: "4px" }}>
            <div style={{ color: "var(--muted)", marginBottom: "4px" }}>{label}</div>
            <div style={{ fontWeight: 700, color: "var(--slate)" }}>{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ─────────────────────────────────────────────────────────────────────────────

function OverviewTab({
  positions,
  creditScore,
}: {
  positions: ReturnType<typeof useUserPositions>;
  creditScore: UserCreditScore;
}) {
  if (positions.loading) {
    return (
      <div style={{ padding: "32px", textAlign: "center", color: "var(--muted)" }}>
        Fetching positions from Aave &amp; Morpho…
      </div>
    );
  }

  if (positions.positions.length === 0) {
    return (
      <div style={{ padding: "32px", textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: "12px" }}>🔍</div>
        <div style={{ fontSize: "14px", color: "var(--slate2)", lineHeight: 1.8 }}>
          No active positions found on Aave or Morpho (Sepolia).
          <br />
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>
            Deposit collateral to an external protocol — or use the Borrow tab to work with our lender directly.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", padding: "20px" }}>
      <div>
        <h3
          style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--muted)",
            marginBottom: "12px",
          }}
        >
          Portfolio Summary
        </h3>
        <div style={{ display: "grid", gap: "8px" }}>
          {[
            { label: "Total Collateral (USD)", value: fmt$(positions.totalCollateralUSD) },
            { label: "Total Debt (USD)", value: fmt$(positions.totalDebtUSD) },
            {
              label: "Unified Health Factor",
              value: hfLabel(positions.unifiedHealthFactor),
              color: hfColor(positions.unifiedHealthFactor),
            },
          ].map(({ label, value, color }) => (
            <div key={label} style={CARD}>
              <div style={{ color: "var(--muted)", marginBottom: "3px" }}>{label}</div>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: "16px",
                  color: color ?? "var(--slate)",
                }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3
          style={{
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--muted)",
            marginBottom: "12px",
          }}
        >
          Credit Assessment
        </h3>
        <CreditScoreCard score={creditScore} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIONS TAB
// ─────────────────────────────────────────────────────────────────────────────

function PositionsTab({
  positions,
}: {
  positions: ReturnType<typeof useUserPositions>;
}) {
  if (positions.loading) {
    return <div style={{ padding: "24px", color: "var(--muted)" }}>Loading positions…</div>;
  }

  if (positions.positions.length === 0) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "var(--muted)" }}>
        No positions found on Aave or Morpho (Sepolia)
      </div>
    );
  }

  const headers = [
    "Protocol",
    "Chain",
    "Collateral Asset",
    "Collateral (USD)",
    "Debt Asset",
    "Debt (USD)",
    "Health Factor",
  ];

  return (
    <div style={{ padding: "16px", overflowX: "auto" }}>
      <table style={{ width: "100%", fontSize: "12px", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid rgba(8,145,178,0.15)" }}>
            {headers.map((h) => (
              <th
                key={h}
                style={{
                  padding: "8px",
                  textAlign: "left",
                  color: "var(--muted)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  fontSize: "10px",
                  letterSpacing: "0.08em",
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.positions.map((pos, i) => {
            const hf = pos.debtUSD > 0 ? pos.collateralUSD / pos.debtUSD : 999;
            return (
              <tr key={i} style={{ borderBottom: "1px solid rgba(8,145,178,0.06)" }}>
                <td style={{ padding: "12px 8px", textTransform: "capitalize", fontWeight: 500 }}>
                  {pos.protocol}
                </td>
                <td style={{ padding: "12px 8px", textTransform: "capitalize" }}>{pos.chain}</td>
                <td
                  style={{
                    padding: "12px 8px",
                    fontFamily: "Space Mono,monospace",
                    fontWeight: 600,
                  }}
                >
                  {pos.collateralAsset}
                </td>
                <td style={{ padding: "12px 8px", color: "#10b981" }}>
                  {fmt$(pos.collateralUSD)}
                </td>
                <td
                  style={{
                    padding: "12px 8px",
                    fontFamily: "Space Mono,monospace",
                    fontWeight: 600,
                  }}
                >
                  {pos.debtAsset}
                </td>
                <td style={{ padding: "12px 8px", color: "#ef4444" }}>
                  {fmt$(pos.debtUSD)}
                </td>
                <td
                  style={{
                    padding: "12px 8px",
                    color: hfColor(hf),
                    fontWeight: 700,
                    fontFamily: "Space Mono,monospace",
                  }}
                >
                  {hfLabel(hf)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTESTATION TAB
// ─────────────────────────────────────────────────────────────────────────────

function AttestationTab({ attestation }: { attestation: ReturnType<typeof useAttestation> }) {
  const { mutate: grantPermission } = useWriteContract();
  const [isPending, setIsPending] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);

  const handleGrant = () => {
    setIsPending(true);
    setTxError(null);
    grantPermission(
      { address: CONTRACTS.attestation, abi: ATTESTATION_ABI, functionName: "grantPermission" },
      {
        onSuccess: (hash) => {
          setIsPending(false);
          console.log("grantPermission tx:", hash);
          setTimeout(() => attestation.refetch(), 3_000);
        },
        onError: (err) => {
          setIsPending(false);
          setTxError((err as Error).message ?? String(err));
        },
      },
    );
  };

  if (attestation.isLoading) {
    return (
      <div style={{ padding: "24px", color: "var(--muted)" }}>
        ⏳ Reading attestation from contract…
      </div>
    );
  }

  if (attestation.isError) {
    return (
      <div style={{ padding: "24px" }}>
        <div
          style={{
            padding: "16px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "6px",
            marginBottom: "16px",
          }}
        >
          <div style={{ fontSize: "13px", color: "#ef4444", fontWeight: 600, marginBottom: "4px" }}>
            ❌ Contract Read Error
          </div>
          <div style={{ fontSize: "12px", color: "var(--slate2)", lineHeight: 1.6 }}>
            Could not read the attestation contract. Ensure you are on Sepolia.
          </div>
          <div
            style={{
              marginTop: "8px",
              fontSize: "11px",
              fontFamily: "Space Mono,monospace",
              color: "var(--muted)",
            }}
          >
            {CONTRACTS.attestation}
          </div>
        </div>
        <a
          href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.attestation}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "12px", color: "var(--cyan)" }}
        >
          View on Etherscan ↗
        </a>
        <button
          onClick={() => attestation.refetch()}
          style={{
            marginLeft: "16px",
            padding: "8px 16px",
            background: "rgba(8,145,178,0.1)",
            border: "1px solid var(--cyan)",
            color: "var(--cyan)",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: "11px",
            borderRadius: "4px",
          }}
        >
          ↻ Retry
        </button>
      </div>
    );
  }

  if (!attestation.isValid) {
    return (
      <div style={{ padding: "24px" }}>
        <div
          style={{
            marginBottom: "16px",
            padding: "16px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.2)",
            borderRadius: "6px",
          }}
        >
          <div style={{ fontSize: "13px", color: "#ef4444", fontWeight: 600, marginBottom: "4px" }}>
            No Active Attestation
          </div>
          <div style={{ fontSize: "12px", color: "var(--slate2)", lineHeight: 1.6 }}>
            Your on-chain credit attestation doesn&apos;t exist or has expired. Grant permission so
            the Chainlink CRE workflow can assess your credit and mint a tier attestation.
          </div>
        </div>

        <div
          style={{
            marginBottom: "16px",
            padding: "12px",
            background: "rgba(100,116,139,0.06)",
            border: "1px solid rgba(100,116,139,0.12)",
            borderRadius: "4px",
            fontSize: "11px",
            fontFamily: "Space Mono,monospace",
            color: "var(--muted)",
          }}
        >
          <div style={{ marginBottom: "4px", fontWeight: 600, color: "var(--slate2)" }}>
            Debug
          </div>
          <div>Contract: {CONTRACTS.attestation}</div>
          <div>isValid: false · tier: {attestation.tier} · expiry: {attestation.expiry.toString()}</div>
          <a
            href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.attestation}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--cyan)", textDecoration: "underline", display: "block", marginTop: "4px" }}
          >
            View contract ↗
          </a>
        </div>

        {txError && (
          <div
            style={{
              marginBottom: "12px",
              padding: "12px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.2)",
              borderRadius: "4px",
              fontSize: "12px",
              color: "#ef4444",
              fontFamily: "Space Mono,monospace",
              lineHeight: 1.4,
              wordBreak: "break-all",
            }}
          >
            {txError}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={handleGrant}
            disabled={isPending}
            style={{
              padding: "12px 20px",
              background: isPending
                ? "var(--muted)"
                : "linear-gradient(135deg, var(--cyan), #06b6d4)",
              border: "none",
              color: "#ffffff",
              fontWeight: 700,
              cursor: isPending ? "wait" : "pointer",
              fontSize: "12px",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              borderRadius: "4px",
            }}
          >
            {isPending ? "Sending transaction…" : "Grant Permission"}
          </button>
          <button
            onClick={() => attestation.refetch()}
            style={{
              padding: "8px 16px",
              background: "rgba(8,145,178,0.1)",
              border: "1px solid rgba(8,145,178,0.25)",
              color: "var(--cyan)",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "11px",
              textTransform: "uppercase",
              borderRadius: "4px",
            }}
          >
            ↻ Check Status
          </button>
        </div>
      </div>
    );
  }

  const expiryDate = new Date(Number(attestation.expiry) * 1000);
  const expired = Date.now() > expiryDate.getTime();

  return (
    <div style={{ padding: "24px" }}>
      <div
        style={{
          padding: "24px",
          background: expired
            ? "rgba(239,68,68,0.08)"
            : attestation.tier <= 2
              ? "rgba(16,185,129,0.08)"
              : "rgba(249,115,22,0.08)",
          border: expired
            ? "1px solid rgba(239,68,68,0.3)"
            : attestation.tier <= 2
              ? "1px solid rgba(16,185,129,0.3)"
              : "1px solid rgba(249,115,22,0.3)",
          borderRadius: "8px",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: "80px",
            height: "80px",
            borderRadius: "50%",
            background: TIER_COLORS[attestation.tier],
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#ffffff",
            fontWeight: 700,
            fontSize: "36px",
            margin: "0 auto 12px",
          }}
        >
          {attestation.tier}
        </div>
        <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--slate)", marginBottom: "4px" }}>
          {TIER_NAMES[attestation.tier]}
        </div>
        <div style={{ fontSize: "13px", color: "var(--slate2)", marginBottom: "12px" }}>
          Verified Credit Tier · {(getTierLTV(attestation.tier) * 100).toFixed(0)}% LTV
        </div>
        {expired && (
          <div
            style={{
              marginBottom: "12px",
              padding: "6px 12px",
              background: "rgba(239,68,68,0.15)",
              borderRadius: "4px",
              fontSize: "11px",
              color: "#ef4444",
              fontWeight: 600,
            }}
          >
            ⚠️ EXPIRED
          </div>
        )}
        <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "16px" }}>
          {expired ? "Expired" : "Expires"}: {expiryDate.toLocaleString()}
        </div>
        <a
          href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.attestation}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: "11px", color: "var(--cyan)", fontWeight: 600, textDecoration: "none" }}
        >
          View Contract on Etherscan →
        </a>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BORROW TAB — fully real on-chain data, zero mock values
// ─────────────────────────────────────────────────────────────────────────────

function BorrowTab({
  loans,
  ethPrice,
}: {
  loans: ReturnType<typeof useUserLoans>;
  ethPrice: number;
}) {
  const loan = loans.loans[0] ?? null;

  // State
  const [depositAmt, setDepositAmt] = useState("");
  const [borrowAmt, setBorrowAmt] = useState("");
  const [repayAmt, setRepayAmt] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");

  // Hooks
  const { deposit, isPending: depositPending, isSuccess: depositSuccess, error: depositError } =
    useDepositCollateral();
  const { repay, isPending: repayPending, isSuccess: repaySuccess, error: repayError } = useRepay();
  const { withdraw, isPending: withdrawPending, isSuccess: withdrawSuccess, error: withdrawError } =
    useWithdrawCollateral();
  const { mutate: borrow } = useWriteContract();
  const [borrowPending, setBorrowPending] = useState(false);
  const [borrowError, setBorrowError] = useState<string | null>(null);
  const [borrowSuccess, setBorrowSuccess] = useState(false);

  // Derived
  const collateralETH = loan?.collateralETH ?? 0;
  const borrowedETH = loan?.borrowedAmount ?? 0;
  const interestETH = loan?.interestAccrued ?? 0;
  const healthFactor = loan?.healthFactor ?? 0;
  const maxBorrowETH = loan?.maxBorrowETH ?? 0;
  const availableETH = Math.max(0, maxBorrowETH - borrowedETH);
  const repayTotal = borrowedETH + interestETH;

  // Pre-fill repay amount when loan is loaded
  useEffect(() => {
    if (repayTotal > 0) {
      setRepayAmt(repayTotal.toFixed(6));
    }
  }, [repayTotal]);

  const handleBorrow = () => {
    const amount = parseFloat(borrowAmt);
    if (isNaN(amount) || amount <= 0) return;
    if (amount > availableETH) {
      setBorrowError(`Exceeds available credit (${availableETH.toFixed(4)} ETH)`);
      return;
    }
    setBorrowError(null);
    setBorrowSuccess(false);
    setBorrowPending(true);
    borrow(
      {
        address: CONTRACTS.lender,
        abi: LENDER_ABI,
        functionName: "borrow",
        args: [parseEther(amount.toString())],
      },
      {
        onSuccess: () => {
          setBorrowAmount("");
          setBorrowPending(false);
          setBorrowSuccess(true);
        },
        onError: (err) => {
          setBorrowPending(false);
          setBorrowError((err as Error).message ?? "Borrow failed");
        },
      },
    );
  };

  // Consolidate: avoid TS error from setBorrowAmount
  function setBorrowAmount(v: string) {
    setBorrowAmt(v);
  }

  const btnStyle = (active: boolean, danger = false): React.CSSProperties => ({
    padding: "10px 16px",
    background: !active
      ? "var(--muted)"
      : danger
        ? "linear-gradient(135deg, #ef4444, #dc2626)"
        : "linear-gradient(135deg, var(--cyan), #06b6d4)",
    border: "none",
    color: "#ffffff",
    fontWeight: 700,
    cursor: active ? "pointer" : "not-allowed",
    fontSize: "12px",
    textTransform: "uppercase",
    borderRadius: "4px",
    whiteSpace: "nowrap",
    letterSpacing: "0.05em",
  });

  const sectionHead = (label: string, sub?: string) => (
    <div style={{ marginBottom: "16px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--slate)" }}>{label}</div>
      {sub && <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px" }}>{sub}</div>}
    </div>
  );

  const inputStyle: React.CSSProperties = {
    flex: 1,
    padding: "10px 12px",
    border: "1px solid rgba(8,145,178,0.2)",
    background: "rgba(8,145,178,0.04)",
    color: "var(--slate)",
    fontFamily: "Space Mono,monospace",
    fontSize: "12px",
    borderRadius: "4px",
    outline: "none",
  };

  const statusMsg = (
    msg: string | null | undefined,
    type: "success" | "error",
  ) =>
    msg ? (
      <div
        style={{
          marginTop: "8px",
          padding: "8px 12px",
          background:
            type === "success" ? "rgba(16,185,129,0.08)" : "rgba(239,68,68,0.08)",
          border: `1px solid ${type === "success" ? "rgba(16,185,129,0.25)" : "rgba(239,68,68,0.25)"}`,
          borderRadius: "4px",
          fontSize: "11px",
          color: type === "success" ? "#10b981" : "#ef4444",
          fontFamily: "Space Mono,monospace",
          wordBreak: "break-all",
        }}
      >
        {type === "success" ? "✓ " : "✗ "}{msg}
      </div>
    ) : null;

  return (
    <div style={{ padding: "24px", display: "grid", gap: "24px", maxWidth: "720px" }}>

      {/* ── Stats row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
        {[
          {
            label: "Collateral",
            value: fmtETH(collateralETH),
            sub: ethPrice > 0 ? fmt$(collateralETH * ethPrice) : "—",
            color: "var(--slate)",
          },
          {
            label: "Borrowed",
            value: fmtETH(borrowedETH),
            sub: ethPrice > 0 ? fmt$(borrowedETH * ethPrice) : "—",
            color: borrowedETH > 0 ? "#ef4444" : "var(--slate)",
          },
          {
            label: "Health Factor",
            value: hfLabel(healthFactor),
            sub: healthFactor >= 999 ? "No debt" : healthFactor > 2 ? "Healthy" : healthFactor > 1.2 ? "Caution" : healthFactor > 0 ? "At risk" : "—",
            color: hfColor(healthFactor),
          },
          {
            label: "Available",
            value: fmtETH(availableETH, 4),
            sub: `Max ${fmtETH(maxBorrowETH, 4)}`,
            color: "#10b981",
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} style={{ ...CARD, padding: "14px" }}>
            <div style={{ fontSize: "10px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "6px" }}>
              {label}
            </div>
            <div style={{ fontWeight: 700, fontSize: "14px", color, fontFamily: "Space Mono,monospace" }}>
              {value}
            </div>
            <div style={{ fontSize: "10px", color: "var(--slate2)", marginTop: "2px" }}>{sub}</div>
          </div>
        ))}
      </div>

      {loans.loading && (
        <div style={{ color: "var(--muted)", fontSize: "12px" }}>Loading position from contract…</div>
      )}

      {/* ── Step 1: Deposit Collateral ── */}
      <div style={{ ...CARD, padding: "20px" }}>
        {sectionHead("Step 1 — Deposit Collateral", "Send ETH to ConfidentialLender as collateral")}

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="number"
            placeholder="0.05"
            min="0.001"
            step="0.001"
            value={depositAmt}
            onChange={(e) => setDepositAmt(e.target.value)}
            title="Collateral amount in ETH"
            style={inputStyle}
          />
          <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>ETH</span>
          <button
            onClick={() => deposit(parseFloat(depositAmt))}
            disabled={depositPending || !depositAmt || parseFloat(depositAmt) <= 0}
            style={btnStyle(!depositPending && !!depositAmt && parseFloat(depositAmt) > 0)}
          >
            {depositPending ? "Depositing…" : "Deposit"}
          </button>
        </div>

        {depositAmt && ethPrice > 0 && (
          <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--muted)" }}>
            ≈ {fmt$(parseFloat(depositAmt || "0") * ethPrice)} at current price
          </div>
        )}
        {statusMsg(depositSuccess ? "Collateral deposited successfully" : null, "success")}
        {statusMsg(depositError, "error")}
      </div>

      {/* ── Step 2: Borrow ── */}
      <div style={{ ...CARD, padding: "20px" }}>
        {sectionHead(
          "Step 2 — Borrow ETH",
          collateralETH === 0
            ? "Deposit collateral first to unlock borrowing"
            : `Available: ${availableETH.toFixed(4)} ETH based on your collateral & tier`,
        )}

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <input
            type="number"
            placeholder="0.01"
            min="0.001"
            step="0.001"
            value={borrowAmt}
            onChange={(e) => setBorrowAmt(e.target.value)}
            disabled={collateralETH === 0 || availableETH === 0}
            title="Borrow amount in ETH"
            style={{ ...inputStyle, opacity: collateralETH === 0 ? 0.5 : 1 }}
          />
          <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>ETH</span>
          <button
            onClick={() => setBorrowAmt(availableETH.toFixed(4))}
            disabled={availableETH === 0}
            style={{
              padding: "10px 12px",
              background: "rgba(8,145,178,0.1)",
              border: "1px solid rgba(8,145,178,0.25)",
              color: "var(--cyan)",
              fontWeight: 600,
              cursor: "pointer",
              fontSize: "11px",
              borderRadius: "4px",
              whiteSpace: "nowrap",
            }}
          >
            Max
          </button>
          <button
            onClick={handleBorrow}
            disabled={
              borrowPending ||
              collateralETH === 0 ||
              !borrowAmt ||
              parseFloat(borrowAmt) <= 0 ||
              parseFloat(borrowAmt) > availableETH
            }
            style={btnStyle(
              !borrowPending &&
                collateralETH > 0 &&
                !!borrowAmt &&
                parseFloat(borrowAmt) > 0 &&
                parseFloat(borrowAmt) <= availableETH,
            )}
          >
            {borrowPending ? "Borrowing…" : "Borrow"}
          </button>
        </div>

        {borrowAmt && ethPrice > 0 && (
          <div style={{ marginTop: "6px", fontSize: "11px", color: "var(--muted)" }}>
            ≈ {fmt$(parseFloat(borrowAmt || "0") * ethPrice)} · Available: {fmtETH(availableETH, 4)}
          </div>
        )}
        {statusMsg(borrowSuccess ? "Borrow transaction confirmed" : null, "success")}
        {statusMsg(borrowError, "error")}
      </div>

      {/* ── Active Loan: Repay + Withdraw ── */}
      {(borrowedETH > 0 || collateralETH > 0) && (
        <div style={{ ...CARD, padding: "20px" }}>
          {sectionHead("Manage Position")}

          {borrowedETH > 0 && (
            <div style={{ marginBottom: "20px" }}>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Repay Loan
              </div>
              <div style={{ fontSize: "12px", color: "var(--slate2)", marginBottom: "10px" }}>
                Outstanding: {fmtETH(borrowedETH)} + {fmtETH(interestETH, 6)} interest
                = <strong style={{ color: "var(--slate)" }}>{fmtETH(repayTotal, 6)}</strong>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="number"
                  placeholder={repayTotal.toFixed(6)}
                  min="0"
                  step="0.000001"
                  value={repayAmt}
                  onChange={(e) => setRepayAmt(e.target.value)}
                  title="Repay amount in ETH"
                  style={inputStyle}
                />
                <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>ETH</span>
                <button
                  onClick={() => repay(parseFloat(repayAmt))}
                  disabled={repayPending || !repayAmt || parseFloat(repayAmt) <= 0}
                  style={btnStyle(!repayPending && !!repayAmt && parseFloat(repayAmt) > 0)}
                >
                  {repayPending ? "Repaying…" : "Repay"}
                </button>
              </div>
              {statusMsg(repaySuccess ? "Loan repaid successfully" : null, "success")}
              {statusMsg(repayError, "error")}
            </div>
          )}

          {collateralETH > 0 && (
            <div>
              <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Withdraw Collateral
              </div>
              {borrowedETH > 0 && (
                <div style={{ fontSize: "11px", color: "#f59e0b", marginBottom: "8px" }}>
                  ⚠ Repay all debt before withdrawing collateral
                </div>
              )}
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="number"
                  placeholder={collateralETH.toFixed(4)}
                  min="0.001"
                  step="0.001"
                  value={withdrawAmt}
                  onChange={(e) => setWithdrawAmt(e.target.value)}
                  disabled={borrowedETH > 0}
                  title="Withdraw amount in ETH"
                  style={{ ...inputStyle, opacity: borrowedETH > 0 ? 0.5 : 1 }}
                />
                <span style={{ fontSize: "11px", color: "var(--muted)", whiteSpace: "nowrap" }}>ETH</span>
                <button
                  onClick={() => setWithdrawAmt(collateralETH.toFixed(4))}
                  disabled={borrowedETH > 0}
                  style={{
                    padding: "10px 12px",
                    background: "rgba(8,145,178,0.1)",
                    border: "1px solid rgba(8,145,178,0.25)",
                    color: "var(--cyan)",
                    fontWeight: 600,
                    cursor: "pointer",
                    fontSize: "11px",
                    borderRadius: "4px",
                    whiteSpace: "nowrap",
                  }}
                >
                  Max
                </button>
                <button
                  onClick={() => withdraw(parseFloat(withdrawAmt))}
                  disabled={
                    withdrawPending ||
                    borrowedETH > 0 ||
                    !withdrawAmt ||
                    parseFloat(withdrawAmt) <= 0
                  }
                  style={btnStyle(
                    !withdrawPending &&
                      borrowedETH === 0 &&
                      !!withdrawAmt &&
                      parseFloat(withdrawAmt) > 0,
                    true,
                  )}
                >
                  {withdrawPending ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
              {statusMsg(withdrawSuccess ? "Collateral withdrawn" : null, "success")}
              {statusMsg(withdrawError, "error")}
            </div>
          )}
        </div>
      )}

      {/* ── Loan details ── */}
      {loan && (
        <div style={{ ...CARD, padding: "16px" }}>
          <div style={{ fontSize: "11px", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "12px" }}>
            Position Details · ConfidentialLender
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", fontSize: "12px" }}>
            {[
              { label: "Tier", value: TIER_NAMES[loan.tier] ?? `T${loan.tier}`, color: TIER_COLORS[loan.tier] },
              { label: "Collateral", value: fmtETH(loan.collateralETH) },
              { label: "Borrowed", value: fmtETH(loan.borrowedAmount) },
              { label: "Interest", value: fmtETH(loan.interestAccrued, 6) },
              { label: "Health Factor", value: hfLabel(loan.healthFactor), color: hfColor(loan.healthFactor) },
              { label: "Max Borrow", value: fmtETH(loan.maxBorrowETH) },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div style={{ color: "var(--muted)", marginBottom: "2px" }}>{label}</div>
                <div style={{ fontWeight: 700, color: color ?? "var(--slate)", fontFamily: "Space Mono,monospace" }}>
                  {value}
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "12px", fontSize: "11px", color: "var(--muted)" }}>
            Contract:{" "}
            <a
              href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.lender}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--cyan)" }}
            >
              {CONTRACTS.lender}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { address, isConnected } = useAccount();
  const [tab, setTab] = useState<Tab>("overview");
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const ethPrice = useLiveETHPrice();
  const positions = useUserPositions();
  const creditScore = useUserCreditScore(positions.positions);
  const loans = useUserLoans(ethPrice);
  const attestation = useAttestation();

  if (!isMounted) return null;

  if (!isConnected) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--void)",
        }}
      >
        <div style={{ textAlign: "center", padding: "24px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔐</div>
          <h1
            style={{
              fontSize: "24px",
              fontWeight: 700,
              color: "var(--slate)",
              marginBottom: "8px",
            }}
          >
            Connect Your Wallet
          </h1>
          <p style={{ fontSize: "14px", color: "var(--slate2)", marginBottom: "24px" }}>
            Sign in with MetaMask on Sepolia to access your credit dashboard.
          </p>
          <WalletSection />
        </div>
      </div>
    );
  }

  const tabs: Tab[] = ["overview", "positions", "attestation", "borrow", "settings"];

  return (
    <div style={{ minHeight: "100vh", background: "var(--void)" }}>
      {/* Header */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 32px",
          borderBottom: "1px solid rgba(8,145,178,0.08)",
          background: "rgba(248,248,252,0.94)",
          backdropFilter: "blur(16px)",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none" }}>
          <span
            style={{
              fontFamily: "'Cormorant Garamond',serif",
              fontSize: "16px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              color: "var(--slate)",
            }}
          >
            Confidential<span style={{ color: "var(--cyan)" }}>Guard</span>
          </span>
        </Link>

        <PriceTicker />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontFamily: "Space Mono,monospace",
            fontSize: "11px",
          }}
        >
          <span style={{ color: "var(--muted)" }}>{shortAddr(address!)}</span>
          <div
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              background: "#10b981",
            }}
            className="pulse-cyan"
          />
        </div>
      </div>

      {/* Body */}
      <div style={{ paddingTop: "72px", display: "flex", minHeight: "calc(100vh - 72px)" }}>
        {/* Sidebar */}
        <div
          style={{
            width: "220px",
            borderRight: "1px solid rgba(8,145,178,0.08)",
            background: "#fafbfc",
            display: "flex",
            flexDirection: "column",
            flexShrink: 0,
          }}
        >
          <WalletSection />
          <div style={{ flex: 1, overflow: "auto", padding: "12px" }}>
            {tabs.map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setTab(t)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  marginBottom: "2px",
                  border: "none",
                  background:
                    tab === t
                      ? "linear-gradient(135deg, rgba(8,145,178,0.12), rgba(8,145,178,0.06))"
                      : "transparent",
                  borderLeft: tab === t ? "3px solid var(--cyan)" : "3px solid transparent",
                  color: tab === t ? "var(--cyan)" : "var(--slate2)",
                  fontWeight: tab === t ? 700 : 500,
                  cursor: "pointer",
                  textAlign: "left",
                  fontSize: "12px",
                  textTransform: "capitalize",
                  transition: "all .15s",
                  borderRadius: "0 4px 4px 0",
                }}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
            {tab === "overview" && (
              <OverviewTab positions={positions} creditScore={creditScore} />
            )}
            {tab === "positions" && <PositionsTab positions={positions} />}
            {tab === "attestation" && <AttestationTab attestation={attestation} />}
            {tab === "borrow" && <BorrowTab loans={loans} ethPrice={ethPrice} />}
            {tab === "settings" && (
              <div style={{ padding: "24px", color: "var(--slate2)", fontSize: "13px" }}>
                Settings coming soon
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
