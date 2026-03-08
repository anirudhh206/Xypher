"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  useAccount, useConnect, useDisconnect, useBalance,
  useReadContract, useWriteContract, useWaitForTransactionReceipt,
} from "wagmi";
import { injected } from "wagmi/connectors";
import { parseEther, formatEther, isAddress } from "viem";
import {
  CONTRACTS, ATTESTATION_ABI, LENDER_ABI, FEED_ABI, NFT_ABI, OWNABLE_ABI,
  TIER_NAMES, TIER_RATES, TIER_COLORS, SEPOLIA_EXPLORER,
} from "@/lib/contracts";

type Tab = "overview" | "borrow" | "position" | "verify" | "settings";

// ── Helpers ────────────────────────────────────────────────────────────────
function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
function formatPrice(raw: bigint | undefined): string {
  if (!raw) return "—";
  return `$${(Number(raw) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
function formatExpiry(expiry: bigint | undefined): { label: string; pct: number } {
  if (!expiry) return { label: "—", pct: 0 };
  const now = Math.floor(Date.now() / 1000);
  const remaining = Number(expiry) - now;
  if (remaining <= 0) return { label: "Expired", pct: 0 };
  const h = Math.floor(remaining / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  return { label: `${h}h ${m}m`, pct: Math.min(100, (remaining / 86400) * 100) };
}
function hfColor(hf: number) {
  return hf > 2.5 ? "#10b981" : hf > 1.5 ? "#f59e0b" : "#ef4444";
}
// Health factor is returned in BPS (10000 = 1.0x)
function hfFromBps(bps: bigint | undefined): string {
  if (!bps) return "—";
  if (bps === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff")) return "∞";
  return (Number(bps) / 10000).toFixed(2);
}

// ── Price ticker ───────────────────────────────────────────────────────────
function PriceTicker() {
  const { data: ethData } = useReadContract({ address: CONTRACTS.ethUsdFeed, abi: FEED_ABI, functionName: "latestRoundData" });
  const { data: btcData } = useReadContract({ address: CONTRACTS.btcUsdFeed, abi: FEED_ABI, functionName: "latestRoundData" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <div style={{ display: "flex", gap: "6px", alignItems: "center", padding: "4px 10px", background: "var(--card)", border: "1px solid rgba(8,145,178,0.15)", fontSize: "11px" }}>
        <span style={{ color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>ETH</span>
        <span style={{ fontWeight: 700, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>{formatPrice(ethData?.[1])}</span>
      </div>
      <div style={{ display: "flex", gap: "6px", alignItems: "center", padding: "4px 10px", background: "var(--card)", border: "1px solid rgba(8,145,178,0.15)", fontSize: "11px" }}>
        <span style={{ color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>BTC</span>
        <span style={{ fontWeight: 700, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>{formatPrice(btcData?.[1])}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10px", color: "#10b981", fontFamily: "Space Mono,monospace" }}>
        <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10b981" }} className="pulse-cyan" />
        Chainlink Live
      </div>
    </div>
  );
}

// ── Wallet sidebar section ─────────────────────────────────────────────────
function WalletSection() {
  const { address, isConnected } = useAccount();
  const { mutate: connect } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });

  if (!isConnected) {
    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
        <button type="button" onClick={() => connect({ connector: injected() })} className="btn-cyan"
          style={{ width: "100%", justifyContent: "center", padding: "10px", fontSize: "10px", clipPath: "polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%)" }}>
          Connect MetaMask
        </button>
        <div style={{ fontSize: "10px", color: "var(--muted)", textAlign: "center", marginTop: "8px", fontFamily: "Space Mono,monospace" }}>Sepolia Testnet required</div>
      </div>
    );
  }
  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: "rgba(8,145,178,0.05)", border: "1px solid rgba(8,145,178,0.12)" }}>
        <div style={{ width: "30px", height: "30px", background: "linear-gradient(135deg,#4f46e5,#0b4a57)", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0, clipPath: "polygon(4px 0%,100% 0%,calc(100% - 4px) 100%,0% 100%)" }}>
          {address ? address.slice(2, 4).toUpperCase() : "??"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--slate)", lineHeight: 1.2 }}>{address ? shortAddr(address) : "—"}</div>
          <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>{balance ? `${Number(formatEther(balance.value)).toFixed(4)} ETH` : "Loading…"}</div>
        </div>
        <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
      </div>
      <button type="button" onClick={() => disconnect()}
        style={{ width: "100%", marginTop: "8px", padding: "6px", background: "transparent", color: "var(--muted)", border: "1px solid rgba(0,0,0,0.1)", fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Space Mono,monospace" }}>
        Disconnect
      </button>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [txMsg, setTxMsg] = useState<string | null>(null);
  const [txErr, setTxErr] = useState<string | null>(null);

  // Borrow tab state
  const [collateralInput, setCollateralInput] = useState("0.1");
  const [borrowInput, setBorrowInput] = useState("0.05");

  // Verify tab state
  const [verifyAddr, setVerifyAddr] = useState("");
  const [verifyResult, setVerifyResult] = useState<{ valid: boolean; tier: number; expiry: bigint } | null>(null);

  const { address, isConnected } = useAccount();

  // ── Attestation (real on-chain) ──────────────────────────────────────────
  const { data: attestData, refetch: refetchAttest } = useReadContract({
    address: CONTRACTS.attestation,
    abi: ATTESTATION_ABI,
    functionName: "verifyAttestation",
    args: [address ?? "0x0000000000000000000000000000000000000000", 1],
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const { data: hasPerm, refetch: refetchPerm } = useReadContract({
    address: CONTRACTS.attestation,
    abi: ATTESTATION_ABI,
    functionName: "hasPermission",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  // ── Real loan position (real on-chain) ───────────────────────────────────
  const { data: positionData, refetch: refetchPosition } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "getPosition",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const { data: maxBorrowData } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "getMaxBorrow",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });
  const { data: poolStats, refetch: refetchPool } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "getPoolStats",
    query: { refetchInterval: 30_000 },
  });
  const { data: tier1Rate } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "tierRates",
    args: [1],
  });
  const { data: nftSupply } = useReadContract({
    address: CONTRACTS.nft,
    abi: NFT_ABI,
    functionName: "totalSupply",
    query: { refetchInterval: 60_000 },
  });
  const { data: attestOwner } = useReadContract({
    address: CONTRACTS.attestation,
    abi: OWNABLE_ABI,
    functionName: "owner",
  });

  // ── Verify-any-address read ───────────────────────────────────────────────
  const { data: verifyData, refetch: doVerify, isFetching: isVerifying } = useReadContract({
    address: CONTRACTS.attestation,
    abi: ATTESTATION_ABI,
    functionName: "verifyAttestation",
    args: [isAddress(verifyAddr) ? verifyAddr as `0x${string}` : "0x0000000000000000000000000000000000000000", 1],
    query: { enabled: false },
  });
  useEffect(() => {
    if (verifyData) setVerifyResult({ valid: verifyData[0], tier: verifyData[1], expiry: verifyData[2] });
  }, [verifyData]);

  // ── Writes ────────────────────────────────────────────────────────────────
  const { mutate: grantPerm, data: grantHash, isPending: isGranting } = useWriteContract();
  const { mutate: revokePerm, data: revokeHash, isPending: isRevoking } = useWriteContract();
  const { mutate: doDeposit, data: depositHash, isPending: isDepositing } = useWriteContract();
  const { mutate: doBorrow, data: borrowHash, isPending: isBorrowing } = useWriteContract();
  const { mutate: doRepay, data: repayHash, isPending: isRepaying } = useWriteContract();
  const { mutate: doWithdraw, data: withdrawHash, isPending: isWithdrawing } = useWriteContract();

  const { isLoading: grantPending, isSuccess: grantDone } = useWaitForTransactionReceipt({ hash: grantHash });
  const { isLoading: depositPending, isSuccess: depositDone } = useWaitForTransactionReceipt({ hash: depositHash });
  const { isLoading: borrowPending, isSuccess: borrowDone } = useWaitForTransactionReceipt({ hash: borrowHash });
  const { isLoading: repayPending, isSuccess: repayDone } = useWaitForTransactionReceipt({ hash: repayHash });

  useEffect(() => { if (grantDone) { refetchPerm(); setTxMsg("Permission granted — TEE will score your credit in the next 5-min cycle"); } }, [grantDone, refetchPerm]);
  useEffect(() => { if (depositDone) { refetchPosition(); setTxMsg("Collateral deposited on-chain"); } }, [depositDone, refetchPosition]);
  useEffect(() => { if (borrowDone) { refetchPosition(); refetchPool(); setTxMsg("Loan funded — funds sent to your wallet"); } }, [borrowDone, refetchPosition, refetchPool]);
  useEffect(() => { if (repayDone) { refetchPosition(); refetchPool(); setTxMsg("Loan repaid — collateral released"); } }, [repayDone, refetchPosition, refetchPool]);

  // ── Derived state ─────────────────────────────────────────────────────────
  const [isAttested, tier, expiryRaw] = attestData ?? [false, undefined, undefined];
  const expiry    = formatExpiry(expiryRaw);
  const tierColor = tier ? TIER_COLORS[tier] : "var(--muted)";
  const tierName  = tier ? TIER_NAMES[tier] : "—";
  const tierRate  = tier ? TIER_RATES[tier] : "—";

  // positionData = [collateral, borrowed, interest, tier, healthFactor] — all bigint
  const [posCollateral, posBorrowed, posInterest, posTier, posHF] = positionData ?? [];
  const hasLoan = posBorrowed !== undefined && posBorrowed > 0n;
  const hasCollateral = posCollateral !== undefined && posCollateral > 0n;

  // Pool stats = [liquidity, borrowed, available, utilisationBps]
  const [poolLiquidity, poolBorrowed, poolAvailable, poolUtil] = poolStats ?? [];

  const [maxBorrowWei] = maxBorrowData ?? [];

  const NavItem = ({ t, icon, label }: { t: Tab; icon: string; label: string }) => (
    <button type="button" onClick={() => setTab(t)}
      style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: "10px 20px", background: tab === t ? "rgba(8,145,178,0.08)" : "transparent", border: "none", borderLeft: `2px solid ${tab === t ? "var(--cyan)" : "transparent"}`, color: tab === t ? "var(--cyan)" : "var(--muted)", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "all .2s", textAlign: "left" }}
      onMouseEnter={e => { if (tab !== t) (e.currentTarget as HTMLElement).style.color = "var(--slate2)"; }}
      onMouseLeave={e => { if (tab !== t) (e.currentTarget as HTMLElement).style.color = "var(--muted)"; }}
    >
      <span style={{ fontSize: "15px", width: "18px", textAlign: "center" }}>{icon}</span>
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--void)", color: "var(--slate)" }}>

      {/* ── SIDEBAR ── */}
      <aside style={{ width: "220px", flexShrink: 0, background: "var(--deep)", borderRight: "1px solid rgba(8,145,178,0.1)", display: "flex", flexDirection: "column", position: "fixed", inset: "0 auto 0 0", zIndex: 50 }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "10px", padding: "22px 20px", textDecoration: "none", borderBottom: "1px solid rgba(8,145,178,0.1)" }}>
          <div className="guard-emblem" style={{ width: "22px", height: "22px" } as React.CSSProperties} />
          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontWeight: 600, letterSpacing: "0.15em", color: "var(--slate)", textTransform: "uppercase" }}>
            C<span style={{ color: "var(--cyan)" }}>Guard</span>
          </span>
        </Link>

        <WalletSection />

        {/* Live attestation badge */}
        {isConnected && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>CREDIT TIER</span>
              {isAttested
                ? <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", fontFamily: "Space Mono,monospace" }}>LIVE</span>
                : <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)", fontFamily: "Space Mono,monospace" }}>PENDING</span>
              }
            </div>
            {isAttested && tier
              ? <div style={{ marginTop: "4px", fontSize: "12px", fontWeight: 700, color: tierColor, fontFamily: "Space Mono,monospace" }}>T{tier} · {tierName}</div>
              : <div style={{ marginTop: "4px", fontSize: "10px", color: "var(--muted)" }}>Grant permission to start</div>
            }
          </div>
        )}

        <nav style={{ flex: 1, padding: "10px 0" }}>
          <NavItem t="overview" icon="◈" label="Overview" />
          <NavItem t="borrow"   icon="⬡" label="Borrow" />
          <NavItem t="position" icon="◎" label="My Position" />
          <NavItem t="verify"   icon="◇" label="Verify Wallet" />
          <NavItem t="settings" icon="≡" label="Settings" />
        </nav>

        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(8,145,178,0.08)" }}>
          {[
            { label: "CRE Guardian",   color: "#10b981" },
            { label: "CCIP Bridge",    color: "#10b981" },
            { label: "ACE Compliance", color: "#10b981" },
          ].map(s => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "5px", fontSize: "10px", color: s.color }}>
              <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: s.color, flexShrink: 0 }} className="pulse-cyan" />
              {s.label}
            </div>
          ))}
          <div style={{ fontSize: "9px", color: "var(--muted)", marginTop: "4px", fontFamily: "Space Mono,monospace" }}>Sepolia Testnet</div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <div style={{ marginLeft: "220px", flex: 1, display: "flex", flexDirection: "column" }}>

        {/* Topbar */}
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 32px", borderBottom: "1px solid rgba(8,145,178,0.1)", background: "rgba(248,248,252,0.94)", backdropFilter: "blur(14px)", position: "sticky", top: 0, zIndex: 40 }}>
          <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "22px", fontWeight: 400 }}>
            {tab === "overview" && <><em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Credit</em> Overview</>}
            {tab === "borrow"   && <>Borrow <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Capital</em></>}
            {tab === "position" && <>My <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Position</em></>}
            {tab === "verify"   && <>Verify <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Wallet</em></>}
            {tab === "settings" && <><em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Account</em> Settings</>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            <PriceTicker />
            {isAttested && tier && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 14px", background: "var(--card)", border: `1px solid ${tierColor}33` }}>
                <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>TIER</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "22px", fontWeight: 600, color: tierColor, lineHeight: 1 }}>{tier}</div>
                <div style={{ padding: "2px 7px", background: `${tierColor}20`, fontSize: "9px", fontWeight: 700, color: tierColor, fontFamily: "Space Mono,monospace" }}>{tierName.toUpperCase()}</div>
              </div>
            )}
            <button type="button" onClick={() => { refetchAttest(); refetchPosition(); refetchPool(); }} className="btn-cyan"
              style={{ padding: "8px 18px", fontSize: "10px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
              Refresh
            </button>
          </div>
        </header>

        {/* Notifications */}
        {txMsg && (
          <div style={{ margin: "16px 32px 0", padding: "12px 16px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "#059669" }}>
            <span>✓ {txMsg}</span>
            <button type="button" onClick={() => setTxMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "16px" }}>×</button>
          </div>
        )}
        {txErr && (
          <div style={{ margin: "16px 32px 0", padding: "12px 16px", background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.25)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "#dc2626" }}>
            <span>✕ {txErr}</span>
            <button type="button" onClick={() => setTxErr(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "16px" }}>×</button>
          </div>
        )}

        {/* CRE banner */}
        <div style={{ padding: "10px 32px", background: "rgba(245,158,11,0.06)", borderBottom: "1px solid rgba(245,158,11,0.2)", fontSize: "11px", color: "#92400e", fontFamily: "Space Mono,monospace" }}>
          ⚠ <strong>CRE workflow pending Chainlink early-access.</strong> Attestation tier, loan positions, and contract reads are all live on Sepolia. Cross-chain DeFi positions will populate when TEE workflow deploys.
        </div>

        {/* ── CONTENT ── */}
        <div style={{ padding: "28px 32px", flex: 1 }}>

          {/* ════ OVERVIEW ════ */}
          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>

              {!isConnected && (
                <div style={{ padding: "32px", background: "rgba(8,145,178,0.05)", border: "1px solid rgba(8,145,178,0.2)", textAlign: "center" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "28px", marginBottom: "10px" }}>Connect your wallet to begin</div>
                  <div style={{ fontSize: "13px", color: "var(--muted)" }}>MetaMask on Sepolia Testnet required</div>
                </div>
              )}

              {/* KPI row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px" }}>
                {[
                  { label: "Credit Tier",     value: isAttested && tier ? `Tier ${tier}` : "—",  sub: isAttested ? `${tierName} · ${tierRate} APR` : isConnected ? "Get assessed below" : "Connect wallet",          color: tierColor },
                  { label: "Attestation",     value: isAttested ? expiry.label : "—",             sub: isAttested ? "On-chain · 24h cycle" : "Grant permission to start",                                             color: "var(--cyan)" },
                  { label: "My Collateral",   value: hasCollateral ? `${Number(formatEther(posCollateral!)).toFixed(4)} ETH` : "—", sub: hasCollateral ? "Deposited in ConfidentialLender" : "No position yet",      color: "#10b981" },
                  { label: "My Loan",         value: hasLoan ? `${Number(formatEther(posBorrowed!)).toFixed(4)} ETH` : "—",         sub: hasLoan ? `+ ${Number(formatEther(posInterest ?? 0n)).toFixed(6)} interest` : "No active loan", color: hasLoan ? "#f59e0b" : "var(--muted)" },
                ].map(s => (
                  <div key={s.label} style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "18px 20px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px", fontFamily: "Space Mono,monospace" }}>{s.label}</div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "28px", fontWeight: 500, color: s.color, lineHeight: 1, marginBottom: "5px" }}>{s.value}</div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 300 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Assess My Credit */}
              {isConnected && (
                <div style={{ background: "var(--card)", border: `1px solid ${isAttested ? "rgba(8,145,178,0.25)" : "rgba(8,145,178,0.15)"}`, padding: "24px 28px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "32px" }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "22px", marginBottom: "8px" }}>
                        {isAttested ? <>Your <em style={{ color: tierColor, fontStyle: "italic" }}>Credit Score</em></> : <>Assess My <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Credit</em></>}
                      </div>
                      {isAttested && tier ? (
                        <>
                          <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "12px" }}>
                            <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "80px", fontWeight: 300, color: tierColor, lineHeight: 1 }}>{tier}</div>
                            <div>
                              <div style={{ fontSize: "16px", fontWeight: 700, color: tierColor, fontFamily: "Space Mono,monospace" }}>{tierName.toUpperCase()}</div>
                              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "4px" }}>Undercollateralized credit rate: <strong style={{ color: tierColor }}>{tierRate} APR</strong></div>
                              <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>Expires in: <strong style={{ color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>{expiry.label}</strong></div>
                            </div>
                          </div>
                          <div style={{ height: "3px", background: "rgba(0,0,0,0.08)", borderRadius: "2px", marginBottom: "12px" }}>
                            <div style={{ height: "100%", width: `${expiry.pct}%`, background: `linear-gradient(90deg,var(--cyan-dim),${tierColor})`, borderRadius: "2px" }} />
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.8 }}>
                            Score computed by Chainlink TEE: aggregated DeFi positions on Aave / Morpho / Compound + TradFi (Plaid) — all inside the secure enclave. Only your tier number is on-chain.
                          </div>
                        </>
                      ) : hasPerm ? (
                        <div>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
                            <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b" }} className="pulse-cyan" />
                            <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--slate)" }}>Assessment In Progress</span>
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.8 }}>
                            Permission granted. The Chainlink TEE is querying your Aave, Morpho, Compound, and Plaid positions privately inside the secure enclave. Your attestation will be minted on-chain within the next 5-minute cron cycle.
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.8, marginBottom: "16px" }}>
                            Grant permission to let the Chainlink TEE privately read your cross-chain DeFi positions and TradFi bank data. No raw data ever leaves the secure enclave. Only your credit tier (1–5) is written on-chain.
                          </div>
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px", marginBottom: "18px" }}>
                            {[
                              { n: "1", t: "TEE reads positions", b: "Aave · Morpho · Compound · Plaid queried inside Intel SGX enclave" },
                              { n: "2", t: "Score computed privately", b: "UHF + Contagion Risk + Debt Serviceability → Tier 1–5" },
                              { n: "3", t: "Attestation minted", b: "Only the tier number is written on-chain. No financial data exposed" },
                            ].map(s => (
                              <div key={s.n} style={{ padding: "14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.08)" }}>
                                <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--cyan)", fontFamily: "Space Mono,monospace", marginBottom: "6px" }}>0{s.n}</div>
                                <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--slate)", marginBottom: "4px" }}>{s.t}</div>
                                <div style={{ fontSize: "10px", color: "var(--muted)", lineHeight: 1.6 }}>{s.b}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action column */}
                    <div style={{ width: "200px", flexShrink: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
                      {isAttested ? (
                        <>
                          <button type="button" onClick={() => setTab("borrow")} className="btn-cyan"
                            style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: "11px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
                            Borrow Capital →
                          </button>
                          <button type="button" onClick={() => setTab("position")}
                            style={{ width: "100%", padding: "10px", background: "transparent", color: "var(--cyan)", border: "1px solid rgba(8,145,178,0.3)", fontSize: "10px", fontWeight: 700, cursor: "pointer", fontFamily: "Space Mono,monospace", letterSpacing: "0.1em" }}>
                            View Position →
                          </button>
                          <a href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.attestation}`} target="_blank" rel="noreferrer"
                            style={{ display: "block", textAlign: "center", fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", textDecoration: "none", marginTop: "4px" }}>
                            View on Etherscan ↗
                          </a>
                        </>
                      ) : hasPerm ? (
                        <button type="button" disabled
                          style={{ width: "100%", padding: "12px", background: "rgba(245,158,11,0.08)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.3)", fontSize: "10px", fontWeight: 700, fontFamily: "Space Mono,monospace", cursor: "not-allowed" }}>
                          Scoring…
                        </button>
                      ) : (
                        <>
                          <button type="button"
                            onClick={() => grantPerm({ address: CONTRACTS.attestation, abi: ATTESTATION_ABI, functionName: "grantPermission" })}
                            disabled={isGranting || grantPending}
                            className="btn-cyan"
                            style={{ width: "100%", justifyContent: "center", padding: "12px", fontSize: "11px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
                            {isGranting || grantPending ? "Confirming…" : "Assess My Credit →"}
                          </button>
                          {grantHash && (
                            <a href={`${SEPOLIA_EXPLORER}/tx/${grantHash}`} target="_blank" rel="noreferrer"
                              style={{ fontSize: "9px", color: "var(--cyan)", textAlign: "center", display: "block", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                              Tx: {shortAddr(grantHash)} ↗
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Deployed contracts */}
              <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>Deployed Contracts · Sepolia</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "9px", color: "#10b981", fontFamily: "Space Mono,monospace" }}>
                    <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10b981" }} className="pulse-cyan" />
                    Live on-chain
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
                  {[
                    { name: "ConfidentialGuardAttestation", addr: CONTRACTS.attestation, extra: attestOwner ? `owner: ${shortAddr(attestOwner)}` : "…" },
                    { name: "ConfidentialLender",           addr: CONTRACTS.lender,      extra: `supply: ${nftSupply !== undefined ? nftSupply.toString() : "…"} NFTs` },
                    { name: "CCIP Receiver · Base Sepolia", addr: CONTRACTS.ccipReceiver, extra: "Base Sepolia chain" },
                  ].map(c => (
                    <a key={c.addr} href={`${SEPOLIA_EXPLORER}/address/${c.addr}`} target="_blank" rel="noreferrer"
                      style={{ textDecoration: "none", padding: "10px 14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.08)", transition: "border-color .2s" }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.3)"}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.08)"}
                    >
                      <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginBottom: "3px" }}>{c.name}</div>
                      <div style={{ fontSize: "10px", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>{shortAddr(c.addr)} ↗</div>
                      <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginTop: "4px" }}>{c.extra}</div>
                    </a>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════ BORROW ════ */}
          {tab === "borrow" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

              {/* Pool stats (real on-chain) */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px" }}>
                {[
                  { label: "Pool Liquidity", value: poolLiquidity ? `${Number(formatEther(poolLiquidity)).toFixed(3)} ETH` : "Loading…", color: "var(--slate)" },
                  { label: "Available",      value: poolAvailable ? `${Number(formatEther(poolAvailable)).toFixed(3)} ETH` : "Loading…", color: "#10b981" },
                  { label: "Utilization",    value: poolUtil ? `${(Number(poolUtil) / 100).toFixed(1)}%` : "Loading…",                  color: "var(--cyan)" },
                  { label: "Your Max Borrow",value: maxBorrowWei ? `${Number(formatEther(maxBorrowWei)).toFixed(4)} ETH` : isAttested ? "—" : "Needs attestation", color: isAttested ? "#10b981" : "var(--muted)" },
                ].map(s => (
                  <div key={s.label} style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "18px 20px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "8px", fontFamily: "Space Mono,monospace" }}>{s.label}</div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "28px", fontWeight: 500, color: s.color, lineHeight: 1 }}>{s.value}</div>
                  </div>
                ))}
              </div>

              {!isConnected && (
                <div style={{ padding: "20px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", textAlign: "center", color: "#d97706", fontSize: "13px" }}>
                  Connect MetaMask to access the lending pool.
                </div>
              )}

              {isConnected && !isAttested && (
                <div style={{ padding: "20px", background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#dc2626", marginBottom: "6px" }}>Attestation Required</div>
                  <div style={{ fontSize: "12px", color: "var(--slate2)", marginBottom: "12px" }}>You need a valid credit attestation before borrowing. The TEE will score your cross-chain positions and issue your tier on-chain.</div>
                  <button type="button" onClick={() => setTab("overview")} className="btn-cyan"
                    style={{ padding: "10px 20px", fontSize: "10px", clipPath: "polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%)" }}>
                    Get Assessed →
                  </button>
                </div>
              )}

              {isConnected && isAttested && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

                  {/* Deposit Collateral */}
                  <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.18)", padding: "24px" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", marginBottom: "6px" }}>
                      Step 1 — Deposit <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Collateral</em>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "18px", fontFamily: "Space Mono,monospace" }}>
                      Deposit ETH as collateral. Tier {tier} allows {tier === 1 ? "90%" : tier === 2 ? "80%" : tier === 3 ? "70%" : "60%"} LTV.
                    </div>
                    {hasCollateral && (
                      <div style={{ padding: "10px 14px", background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", marginBottom: "14px", fontSize: "11px", color: "#059669", fontFamily: "Space Mono,monospace" }}>
                        Current collateral: {Number(formatEther(posCollateral!)).toFixed(4)} ETH
                      </div>
                    )}
                    <label style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", display: "block", marginBottom: "7px", fontFamily: "Space Mono,monospace" }}>Amount (ETH)</label>
                    <input type="number" value={collateralInput} onChange={e => setCollateralInput(e.target.value)} min="0.001" step="0.01" className="guard-input" style={{ marginBottom: "14px" }} />
                    <button type="button" className="btn-cyan"
                      style={{ width: "100%", justifyContent: "center", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}
                      disabled={isDepositing || depositPending}
                      onClick={() => doDeposit({ address: CONTRACTS.lender, abi: LENDER_ABI, functionName: "depositCollateral", value: parseEther(collateralInput || "0") })}>
                      {isDepositing || depositPending ? "Confirming…" : "Deposit Collateral →"}
                    </button>
                    {depositHash && (
                      <a href={`${SEPOLIA_EXPLORER}/tx/${depositHash}`} target="_blank" rel="noreferrer"
                        style={{ display: "block", marginTop: "8px", fontSize: "9px", color: "var(--cyan)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                        Tx: {shortAddr(depositHash)} ↗
                      </a>
                    )}
                  </div>

                  {/* Borrow */}
                  <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.18)", padding: "24px" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", marginBottom: "6px" }}>
                      Step 2 — <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Borrow</em>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "18px", fontFamily: "Space Mono,monospace" }}>
                      Your Tier {tier} attestation ({tierName}) unlocks {tierRate} APR. Max borrow: {maxBorrowWei ? `${Number(formatEther(maxBorrowWei)).toFixed(4)} ETH` : "—"}.
                    </div>
                    {hasLoan && (
                      <div style={{ padding: "10px 14px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", marginBottom: "14px", fontSize: "11px", color: "#d97706", fontFamily: "Space Mono,monospace" }}>
                        Active loan: {Number(formatEther(posBorrowed!)).toFixed(4)} ETH principal
                      </div>
                    )}
                    <label style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", display: "block", marginBottom: "7px", fontFamily: "Space Mono,monospace" }}>Amount (ETH)</label>
                    <input type="number" value={borrowInput} onChange={e => setBorrowInput(e.target.value)} min="0.001" step="0.01" className="guard-input" style={{ marginBottom: "14px" }} />
                    <button type="button" className="btn-cyan"
                      style={{ width: "100%", justifyContent: "center", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}
                      disabled={isBorrowing || borrowPending || !hasCollateral}
                      onClick={() => {
                        setTxErr(null);
                        doBorrow({ address: CONTRACTS.lender, abi: LENDER_ABI, functionName: "borrow", args: [parseEther(borrowInput || "0")] });
                      }}>
                      {isBorrowing || borrowPending ? "Confirming…" : !hasCollateral ? "Deposit Collateral First" : "Borrow →"}
                    </button>
                    {borrowHash && (
                      <a href={`${SEPOLIA_EXPLORER}/tx/${borrowHash}`} target="_blank" rel="noreferrer"
                        style={{ display: "block", marginTop: "8px", fontSize: "9px", color: "var(--cyan)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                        Tx: {shortAddr(borrowHash)} ↗
                      </a>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════ MY POSITION ════ */}
          {tab === "position" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

              {!isConnected && (
                <div style={{ padding: "20px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", textAlign: "center", color: "#d97706" }}>Connect wallet to view your position.</div>
              )}

              {isConnected && !hasCollateral && !hasLoan && (
                <div style={{ padding: "32px", background: "rgba(8,145,178,0.04)", border: "1px solid rgba(8,145,178,0.15)", textAlign: "center" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "22px", marginBottom: "10px" }}>No active position</div>
                  <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>{isAttested ? "You have a valid attestation. Deposit collateral to start borrowing." : "Get your credit assessed first, then deposit collateral."}</div>
                  <button type="button" onClick={() => setTab(isAttested ? "borrow" : "overview")} className="btn-cyan"
                    style={{ padding: "10px 24px", fontSize: "10px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
                    {isAttested ? "Go to Borrow →" : "Get Assessed →"}
                  </button>
                </div>
              )}

              {isConnected && (hasCollateral || hasLoan) && (
                <>
                  {/* Real position stats */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "12px" }}>
                    {[
                      { label: "Collateral",    value: posCollateral ? `${Number(formatEther(posCollateral)).toFixed(4)} ETH` : "—",  color: "#10b981" },
                      { label: "Borrowed",      value: posBorrowed   ? `${Number(formatEther(posBorrowed)).toFixed(4)} ETH`   : "—",  color: "#f59e0b" },
                      { label: "Interest",      value: posInterest   ? `${Number(formatEther(posInterest)).toFixed(6)} ETH`   : "—",  color: "var(--muted)" },
                      { label: "Health Factor", value: hfFromBps(posHF),                                                              color: hfColor(posHF ? Number(posHF) / 10000 : 999) },
                      { label: "Borrow Tier",   value: posTier ? `Tier ${posTier}` : "—",                                            color: posTier ? TIER_COLORS[posTier] : "var(--muted)" },
                    ].map(s => (
                      <div key={s.label} style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "16px 18px", textAlign: "center" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "26px", fontWeight: 500, color: s.color, lineHeight: 1, marginBottom: "6px" }}>{s.value}</div>
                        <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

                    {/* Repay */}
                    {hasLoan && (
                      <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "24px" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", marginBottom: "14px" }}>
                          <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Repay</em> Loan
                        </div>
                        <div style={{ padding: "12px 14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.1)", marginBottom: "16px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "5px" }}>
                            <span style={{ color: "var(--muted)" }}>Principal</span>
                            <span style={{ fontFamily: "Space Mono,monospace", color: "var(--slate)" }}>{posBorrowed ? Number(formatEther(posBorrowed)).toFixed(6) : "—"} ETH</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "5px" }}>
                            <span style={{ color: "var(--muted)" }}>Accrued Interest</span>
                            <span style={{ fontFamily: "Space Mono,monospace", color: "#f59e0b" }}>{posInterest ? Number(formatEther(posInterest)).toFixed(6) : "0"} ETH</span>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", borderTop: "1px solid rgba(8,145,178,0.1)", paddingTop: "6px", marginTop: "6px" }}>
                            <span style={{ fontWeight: 600, color: "var(--slate)" }}>Total Owed</span>
                            <span style={{ fontFamily: "Space Mono,monospace", fontWeight: 700, color: "var(--cyan)" }}>
                              {posBorrowed && posInterest ? Number(formatEther(posBorrowed + posInterest)).toFixed(6) : "—"} ETH
                            </span>
                          </div>
                        </div>
                        <button type="button" className="btn-cyan"
                          style={{ width: "100%", justifyContent: "center", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}
                          disabled={isRepaying || repayPending}
                          onClick={() => doRepay({
                            address: CONTRACTS.lender,
                            abi: LENDER_ABI,
                            functionName: "repay",
                            value: posBorrowed && posInterest ? posBorrowed + posInterest + parseEther("0.0001") : 0n,
                          })}>
                          {isRepaying || repayPending ? "Repaying…" : "Repay Full Loan →"}
                        </button>
                        {repayHash && (
                          <a href={`${SEPOLIA_EXPLORER}/tx/${repayHash}`} target="_blank" rel="noreferrer"
                            style={{ display: "block", marginTop: "8px", fontSize: "9px", color: "var(--cyan)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                            Tx: {shortAddr(repayHash)} ↗
                          </a>
                        )}
                      </div>
                    )}

                    {/* Withdraw Collateral */}
                    {hasCollateral && !hasLoan && (
                      <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "24px" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", marginBottom: "14px" }}>
                          Withdraw <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Collateral</em>
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "16px" }}>
                          You have {posCollateral ? Number(formatEther(posCollateral)).toFixed(4) : "—"} ETH deposited. Repay your loan first to withdraw.
                        </div>
                        <button type="button" className="btn-cyan"
                          style={{ width: "100%", justifyContent: "center", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}
                          disabled={isWithdrawing}
                          onClick={() => doWithdraw({ address: CONTRACTS.lender, abi: LENDER_ABI, functionName: "withdrawCollateral", args: [posCollateral!] })}>
                          {isWithdrawing ? "Withdrawing…" : "Withdraw All Collateral →"}
                        </button>
                        {withdrawHash && (
                          <a href={`${SEPOLIA_EXPLORER}/tx/${withdrawHash}`} target="_blank" rel="noreferrer"
                            style={{ display: "block", marginTop: "8px", fontSize: "9px", color: "var(--cyan)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                            Tx: {shortAddr(withdrawHash)} ↗
                          </a>
                        )}
                      </div>
                    )}

                    {/* Cross-chain positions — honest state */}
                    <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "24px" }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", marginBottom: "6px" }}>
                        Cross-Chain <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>DeFi Positions</em>
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "16px", fontFamily: "Space Mono,monospace" }}>Aggregated by Chainlink TEE</div>
                      <div style={{ padding: "20px", background: "rgba(8,145,178,0.04)", border: "1px solid rgba(8,145,178,0.12)", textAlign: "center" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b", margin: "0 auto 10px" }} className="pulse-cyan" />
                        <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--slate)", marginBottom: "6px" }}>TEE Workflow Pending Deployment</div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.7 }}>
                          Your Aave, Morpho, Compound, and Plaid positions will appear here once the Chainlink CRE workflow deploys to the DON. The TEE queries these privately — no raw data touches the chain.
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ════ VERIFY WALLET (LenderView) ════ */}
          {tab === "verify" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "28px" }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "22px", marginBottom: "8px" }}>
                  Lender <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Verification</em>
                </div>
                <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "20px", lineHeight: 1.8 }}>
                  Paste any wallet address. The contract returns cryptographic proof of their credit tier — no financial data, no positions, no amounts. Just the tier and whether it's valid.
                </div>

                <div style={{ display: "flex", gap: "10px", marginBottom: "18px" }}>
                  <input
                    type="text"
                    value={verifyAddr}
                    onChange={e => { setVerifyAddr(e.target.value); setVerifyResult(null); }}
                    placeholder="0x... wallet address"
                    className="guard-input"
                    style={{ flex: 1, fontFamily: "Space Mono,monospace", fontSize: "12px" }}
                  />
                  <button type="button" className="btn-cyan"
                    style={{ padding: "10px 20px", fontSize: "10px", whiteSpace: "nowrap", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}
                    disabled={!isAddress(verifyAddr) || isVerifying}
                    onClick={() => { setVerifyResult(null); doVerify(); }}>
                    {isVerifying ? "Checking…" : "Verify →"}
                  </button>
                </div>

                {!isAddress(verifyAddr) && verifyAddr.length > 0 && (
                  <div style={{ fontSize: "11px", color: "#ef4444", fontFamily: "Space Mono,monospace", marginBottom: "12px" }}>Invalid address format</div>
                )}

                {verifyResult && (
                  <div style={{ padding: "24px", background: verifyResult.valid ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)", border: `1px solid ${verifyResult.valid ? "rgba(16,185,129,0.3)" : "rgba(239,68,68,0.25)"}` }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "64px", fontWeight: 300, color: verifyResult.valid ? (TIER_COLORS[verifyResult.tier] ?? "var(--muted)") : "#ef4444", lineHeight: 1 }}>
                        {verifyResult.valid ? verifyResult.tier : "✕"}
                      </div>
                      <div>
                        <div style={{ fontSize: "16px", fontWeight: 700, color: verifyResult.valid ? (TIER_COLORS[verifyResult.tier] ?? "var(--muted)") : "#ef4444", fontFamily: "Space Mono,monospace", marginBottom: "6px" }}>
                          {verifyResult.valid ? `TIER ${verifyResult.tier} — VALID` : "NOT VERIFIED"}
                        </div>
                        {verifyResult.valid && (
                          <>
                            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>
                              Tier name: <strong style={{ color: "var(--slate)" }}>{TIER_NAMES[verifyResult.tier]}</strong>
                            </div>
                            <div style={{ fontSize: "12px", color: "var(--muted)", marginBottom: "4px" }}>
                              Rate: <strong style={{ color: "var(--cyan)" }}>{TIER_RATES[verifyResult.tier]} APR</strong>
                            </div>
                            <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                              Expires: <strong style={{ color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>{formatExpiry(verifyResult.expiry).label}</strong>
                            </div>
                          </>
                        )}
                        {!verifyResult.valid && (
                          <div style={{ fontSize: "12px", color: "var(--muted)" }}>No valid attestation found for this address.</div>
                        )}
                      </div>
                    </div>

                    <div style={{ marginTop: "16px", padding: "10px 14px", background: "rgba(8,145,178,0.04)", border: "1px solid rgba(8,145,178,0.1)", fontSize: "10px", fontFamily: "Space Mono,monospace", color: "var(--muted)" }}>
                      <span style={{ color: "var(--cyan)" }}>verifyAttestation</span>({shortAddr(verifyAddr)}, minTier=1) → ({verifyResult.valid.toString()}, {verifyResult.tier}, {formatExpiry(verifyResult.expiry).label})
                    </div>
                    <div style={{ marginTop: "8px", fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>
                      ↳ No financial data returned. Only cryptographic truth of tier validity.
                    </div>
                  </div>
                )}

                {/* How it works for lenders */}
                <div style={{ marginTop: "20px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px" }}>
                  {[
                    { n: "I", t: "Zero data exposure", b: "verifyAttestation() returns only (bool, tier, expiry). No collateral amounts, no positions, no scores." },
                    { n: "II", t: "On-chain truth", b: "The attestation was minted by the Chainlink TEE workflow. It cannot be forged. Only the CRE workflow address can mint." },
                    { n: "III", t: "24-hour freshness", b: "Attestations expire after 24h. The guardian re-scores automatically. Stale scores cannot be replayed." },
                  ].map(s => (
                    <div key={s.n} style={{ padding: "14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.08)" }}>
                      <div style={{ fontSize: "10px", fontWeight: 700, color: "var(--cyan)", fontFamily: "Space Mono,monospace", marginBottom: "6px" }}>{s.n}</div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--slate)", marginBottom: "4px" }}>{s.t}</div>
                      <div style={{ fontSize: "10px", color: "var(--muted)", lineHeight: 1.6 }}>{s.b}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ════ SETTINGS ════ */}
          {tab === "settings" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px", alignItems: "start" }}>

              <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "22px 20px" }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px", marginBottom: "16px" }}>
                  TEE <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Permission</em>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                  <div>
                    <div style={{ fontSize: "12px", color: "var(--slate)", fontWeight: 500 }}>Cross-chain position read</div>
                    <div style={{ fontSize: "10px", color: "var(--muted)", marginTop: "2px" }}>Aave · Morpho · Compound · Plaid</div>
                  </div>
                  <span style={{ fontSize: "9px", fontWeight: 700, padding: "3px 8px", fontFamily: "Space Mono,monospace", background: hasPerm ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: hasPerm ? "#10b981" : "#ef4444", border: `1px solid ${hasPerm ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}>
                    {!isConnected ? "—" : hasPerm ? "GRANTED" : "REVOKED"}
                  </span>
                </div>
                {isConnected && (
                  hasPerm ? (
                    <button type="button" onClick={() => revokePerm({ address: CONTRACTS.attestation, abi: ATTESTATION_ABI, functionName: "revokePermission" })} disabled={isRevoking}
                      style={{ width: "100%", padding: "10px", background: "rgba(220,38,38,0.08)", color: "#ef4444", border: "1px solid rgba(220,38,38,0.2)", fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Space Mono,monospace" }}>
                      {isRevoking ? "Revoking…" : "Revoke Permission"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => grantPerm({ address: CONTRACTS.attestation, abi: ATTESTATION_ABI, functionName: "grantPermission" })} disabled={isGranting || grantPending} className="btn-cyan"
                      style={{ width: "100%", justifyContent: "center", padding: "10px", fontSize: "10px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
                      {isGranting || grantPending ? "Confirming…" : "Grant Permission →"}
                    </button>
                  )
                )}
                {(grantHash || revokeHash) && (
                  <a href={`${SEPOLIA_EXPLORER}/tx/${grantHash ?? revokeHash}`} target="_blank" rel="noreferrer"
                    style={{ display: "block", marginTop: "8px", fontSize: "9px", color: "var(--cyan)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                    View tx on Etherscan →
                  </a>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)" }}>
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(8,145,178,0.08)", fontFamily: "'Cormorant Garamond',serif", fontSize: "17px" }}>
                    Wallet <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Info</em>
                  </div>
                  {[
                    ["Address", address ? shortAddr(address) : "Not connected",  address ? "var(--cyan)" : "var(--muted)"],
                    ["Network", "Sepolia Testnet",                                "var(--slate2)"],
                    ["Status",  isConnected ? "Connected" : "Disconnected",       isConnected ? "#10b981" : "#ef4444"],
                    ["NFTs Minted", nftSupply !== undefined ? nftSupply.toString() : "…", "var(--muted)"],
                  ].map(([l, v, c]) => (
                    <div key={l as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.06)", fontSize: "12px" }}>
                      <span style={{ color: "var(--muted)", fontWeight: 300 }}>{l}</span>
                      <span style={{ fontFamily: "Space Mono,monospace", fontSize: "11px", color: c as string }}>{v}</span>
                    </div>
                  ))}
                </div>

                <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "14px 18px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px", fontFamily: "Space Mono,monospace" }}>CCIP Cross-Chain</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontSize: "11px", color: "var(--slate2)" }}>Base Sepolia Receiver</span>
                    <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", fontFamily: "Space Mono,monospace" }}>LIVE</span>
                  </div>
                  <a href="https://ccip.chain.link/" target="_blank" rel="noreferrer"
                    style={{ display: "block", fontSize: "10px", color: "var(--cyan)", fontFamily: "Space Mono,monospace", textDecoration: "none", marginTop: "4px" }}>
                    {shortAddr(CONTRACTS.ccipReceiver)} · Base Sepolia ↗
                  </a>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
