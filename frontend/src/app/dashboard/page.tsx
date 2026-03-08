"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import {
  useAccount, useConnect, useDisconnect, useBalance,
  useReadContract, useWriteContract, useWaitForTransactionReceipt
} from "wagmi";
import { injected } from "wagmi/connectors";
import { parseEther, formatEther } from "viem";
import {
  CONTRACTS, ATTESTATION_ABI, LENDER_ABI, FEED_ABI, NFT_ABI, OWNABLE_ABI,
  TIER_NAMES, TIER_RATES, TIER_COLORS, SEPOLIA_EXPLORER,
} from "@/lib/contracts";

type Tab = "overview" | "positions" | "loans" | "settings";
const POSITIONS = [
  { protocol: "Aave v3",        chain: "Ethereum",  asset: "ETH / USDC",    collateral: "$28,400", debt: "$18,500", hf: 2.85, status: "Safe"     },
  { protocol: "Morpho Blue",    chain: "Base",       asset: "wstETH / USDC", collateral: "$21,600", debt: "$11,200", hf: 3.42, status: "Safe"     },
  { protocol: "Compound v3",    chain: "Arbitrum",   asset: "WBTC / USDC",   collateral: "$19,800", debt: "$9,800",  hf: 2.18, status: "Safe"     },
  { protocol: "Plaid (TradFi)", chain: "Off-chain",  asset: "Bank + Credit",  collateral: "—",       debt: "—",       hf: 4.90, status: "Verified" },
];

function hfColor(hf: number) {
  return hf > 2.5 ? "#10b981" : hf > 1.5 ? "#f59e0b" : "#ef4444";
}

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

// ── Price ticker shown in topbar ──────────────────────────────────────────
function PriceTicker() {
  const { data: ethData } = useReadContract({ address: CONTRACTS.ethUsdFeed, abi: FEED_ABI, functionName: "latestRoundData" });
  const { data: btcData } = useReadContract({ address: CONTRACTS.btcUsdFeed, abi: FEED_ABI, functionName: "latestRoundData" });
  const eth = formatPrice(ethData?.[1]);
  const btc = formatPrice(btcData?.[1]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 12px", background: "var(--card)", border: "1px solid rgba(8,145,178,0.15)", fontSize: "11px" }}>
        <span style={{ color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>ETH</span>
        <span style={{ fontWeight: 700, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>{eth}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "6px", padding: "4px 12px", background: "var(--card)", border: "1px solid rgba(8,145,178,0.15)", fontSize: "11px" }}>
        <span style={{ color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>BTC</span>
        <span style={{ fontWeight: 700, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>{btc}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10px", color: "#10b981", fontFamily: "Space Mono,monospace" }}>
        <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10b981" }} className="pulse-cyan" />
        Chainlink Live
      </div>
    </div>
  );
}

// ── Sidebar wallet section ─────────────────────────────────────────────────
function WalletSection() {
  const { address, isConnected } = useAccount();
  const { mutate: connect } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const { data: balance } = useBalance({ address });

  if (!isConnected) {
    return (
      <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
        <button
          type="button"
          onClick={() => connect({ connector: injected() })}
          className="btn-cyan"
          style={{ width: "100%", justifyContent: "center", padding: "10px", fontSize: "10px", clipPath: "polygon(6px 0%,100% 0%,calc(100% - 6px) 100%,0% 100%)" }}
        >
          Connect MetaMask
        </button>
        <div style={{ fontSize: "10px", color: "var(--muted)", textAlign: "center", marginTop: "8px", fontFamily: "Space Mono,monospace" }}>
          Sepolia Testnet required
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", background: "rgba(8,145,178,0.05)", border: "1px solid rgba(8,145,178,0.12)" }}>
        <div style={{ width: "30px", height: "30px", background: "linear-gradient(135deg,#4f46e5,#0b4a57)", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700, flexShrink: 0, clipPath: "polygon(4px 0%,100% 0%,calc(100% - 4px) 100%,0% 100%)" }}>
          {address ? address.slice(2, 4).toUpperCase() : "??"}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--slate)", lineHeight: 1.2 }}>
            {address ? shortAddr(address) : "—"}
          </div>
          <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>
            {balance ? `${Number(formatEther(balance.value)).toFixed(4)} ETH` : "Loading…"}
          </div>
        </div>
        <div style={{ width: "7px", height: "7px", borderRadius: "50%", background: "#10b981", flexShrink: 0 }} />
      </div>
      <button
        type="button"
        onClick={() => disconnect()}
        style={{ width: "100%", marginTop: "8px", padding: "6px", background: "transparent", color: "var(--muted)", border: "1px solid rgba(0,0,0,0.1)", fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Space Mono,monospace" }}
      >
        Disconnect
      </button>
    </div>
  );
}

// ── Main dashboard ─────────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab] = useState<Tab>("overview");
  const [loanAmount, setLoanAmount] = useState("0.05");
  const [loanTerm, setLoanTerm] = useState<number>(30);
  const [txMsg, setTxMsg] = useState<string | null>(null);

  const { address, isConnected } = useAccount();

  // ── Contract reads ───────────────────────────────────────────────────────
  const { data: attestData, refetch: refetchAttest } = useReadContract({
    address: CONTRACTS.attestation,
    abi: ATTESTATION_ABI,
    functionName: "verifyAttestation",
    args: [address ?? "0x0000000000000000000000000000000000000000", 1],
    query: { enabled: !!address, refetchInterval: 30_000 },
  });

  const { data: hasPerm, refetch: refetchPerm } = useReadContract({
    address: CONTRACTS.attestation,
    abi: ATTESTATION_ABI,
    functionName: "hasPermission",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  const { data: poolInfo } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "getPoolInfo",
    query: { refetchInterval: 30_000 },
  });

  const { data: tier1Rate } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "tierRates",
    args: [1],
  });

  // ── On-chain contract verification reads ─────────────────────────────────
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
  const { data: lenderOwner } = useReadContract({
    address: CONTRACTS.lender,
    abi: OWNABLE_ABI,
    functionName: "owner",
  });

  // ── Contract writes ──────────────────────────────────────────────────────
  const { mutate: grantPerm, data: grantTxHash, isPending: isGranting } = useWriteContract();
  const { mutate: revokePerm, data: revokeTxHash, isPending: isRevoking } = useWriteContract();
  const { mutate: doLoan, data: loanTxHash, isPending: isLoaning } = useWriteContract();

  const { isLoading: grantConfirming, isSuccess: grantDone } = useWaitForTransactionReceipt({ hash: grantTxHash });
  const { isLoading: loanConfirming, isSuccess: loanDone } = useWaitForTransactionReceipt({ hash: loanTxHash });

  useEffect(() => { if (grantDone) { refetchPerm(); setTxMsg("Permission granted — TEE will scan your positions within 5 min"); } }, [grantDone, refetchPerm]);
  useEffect(() => { if (loanDone) { setTxMsg("Loan request submitted on-chain!"); } }, [loanDone]);

  // ── Derived state ────────────────────────────────────────────────────────
  const [isAttested, tier, expiryRaw] = attestData ?? [false, undefined, undefined];
  const expiry      = formatExpiry(expiryRaw);
  const tierColor   = tier ? TIER_COLORS[tier] : "var(--muted)";
  const tierName    = tier ? TIER_NAMES[tier] : "—";
  const tierRate    = tier ? TIER_RATES[tier] : "—";

  const [totalPoolEth, utilization, availableEth] = poolInfo ?? [undefined, undefined, undefined];
  const utilizationPct = utilization ? Number(utilization) / 100 : 0; // bps/100 = pct
  const loanRateBps = tier1Rate ? Number(tier1Rate) : 0;

  // ── Nav item ─────────────────────────────────────────────────────────────
  const NavItem = ({ t, icon, label }: { t: Tab; icon: string; label: string }) => (
    <button type="button" onClick={() => setTab(t)} style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%", padding: "10px 20px", background: tab === t ? "rgba(8,145,178,0.08)" : "transparent", border: "none", borderLeft: `2px solid ${tab === t ? "var(--cyan)" : "transparent"}`, color: tab === t ? "var(--cyan)" : "var(--muted)", fontSize: "13px", fontWeight: 500, cursor: "pointer", transition: "all .2s", textAlign: "left" }}
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

        {/* Live wallet section */}
        <WalletSection />

        {/* Attestation badge in sidebar */}
        {isConnected && (
          <div style={{ padding: "10px 16px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>ATTESTATION</span>
              {isAttested
                ? <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", fontFamily: "Space Mono,monospace" }}>LIVE</span>
                : <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)", fontFamily: "Space Mono,monospace" }}>PENDING</span>
              }
            </div>
            {isAttested && tier && (
              <div style={{ marginTop: "4px", fontSize: "12px", fontWeight: 700, color: tierColor, fontFamily: "Space Mono,monospace" }}>
                T{tier} · {tierName}
              </div>
            )}
          </div>
        )}

        <nav style={{ flex: 1, padding: "10px 0" }}>
          <NavItem t="overview"  icon="◈" label="Overview"  />
          <NavItem t="positions" icon="⬡" label="Positions" />
          <NavItem t="loans"     icon="◎" label="Loans"     />
          <NavItem t="settings"  icon="◇" label="Settings"  />
        </nav>

        {/* Infrastructure status */}
        <div style={{ padding: "14px 16px", borderTop: "1px solid rgba(8,145,178,0.08)" }}>
          {[
            { label: "CRE Guardian",  color: "#10b981", dot: true },
            { label: "CCIP Bridge",   color: "#10b981", dot: true },
            { label: "ACE Compliance",color: "#10b981", dot: true },
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
            {tab === "overview"  && <><em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Credit</em> Overview</>}
            {tab === "positions" && <>Cross-Chain <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Positions</em></>}
            {tab === "loans"     && <>Available <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Loans</em></>}
            {tab === "settings"  && <><em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Account</em> Settings</>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
            {/* Live Chainlink prices */}
            <PriceTicker />
            {/* UHF + Tier chip */}
            {isAttested && tier && (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "6px 14px", background: "var(--card)", border: `1px solid ${tierColor}33` }}>
                <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>TIER</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "22px", fontWeight: 600, color: tierColor, lineHeight: 1 }}>{tier}</div>
                <div style={{ padding: "2px 7px", background: `${tierColor}20`, fontSize: "9px", fontWeight: 700, color: tierColor, fontFamily: "Space Mono,monospace" }}>{tierName.toUpperCase()}</div>
              </div>
            )}
            <button type="button" onClick={() => refetchAttest()} className="btn-cyan" style={{ padding: "8px 18px", fontSize: "10px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
              Refresh
            </button>
          </div>
        </header>

        {/* Tx notification */}
        {txMsg && (
          <div style={{ margin: "16px 32px 0", padding: "12px 16px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "13px", color: "#059669" }}>
            <span>✓ {txMsg}</span>
            <button type="button" onClick={() => setTxMsg(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: "16px" }}>×</button>
          </div>
        )}

        {/* ── CRE PENDING BANNER ── */}
        <div style={{ margin: "0", padding: "10px 32px", background: "rgba(245,158,11,0.08)", borderBottom: "1px solid rgba(245,158,11,0.25)", display: "flex", alignItems: "center", gap: "10px" }}>
          <span style={{ fontSize: "13px" }}>⚠</span>
          <span style={{ fontSize: "11px", color: "#92400e", fontFamily: "Space Mono,monospace" }}>
            <strong>CRE workflow deployment pending Chainlink early-access approval.</strong>
            {" "}Position data below is a TEE-simulation output demonstrating what the live workflow will compute.
            Wallet connection, attestation reads/writes, and price feeds are all live on Sepolia.
          </span>
        </div>

        {/* ── PAGE CONTENT ── */}
        <div style={{ padding: "28px 32px", flex: 1 }}>

          {/* ════ OVERVIEW ════ */}
          {tab === "overview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "22px" }}>

              {/* Not connected banner */}
              {!isConnected && (
                <div style={{ padding: "24px 28px", background: "rgba(8,145,178,0.05)", border: "1px solid rgba(8,145,178,0.2)", textAlign: "center" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "24px", marginBottom: "10px", color: "var(--slate)" }}>Connect your wallet to begin</div>
                  <div style={{ fontSize: "13px", color: "var(--muted)", marginBottom: "18px" }}>MetaMask on Sepolia Testnet required to read your attestation and interact with the protocol</div>
                </div>
              )}

              {/* Stat row */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "14px" }}>
                {[
                  { label: "Credit Tier",     value: isAttested && tier ? `Tier ${tier}` : "—",      sub: isAttested ? tierName + " · Undercollateralized" : isConnected ? "Not yet attested" : "Connect wallet", color: tierColor },
                  { label: "Attestation",     value: isAttested ? expiry.label : "—",                sub: isAttested ? "Until expiry (24h cycle)" : "Grant permission to start", color: "var(--cyan)"  },
                  { label: "Total Collateral",value: "$69.8k",   sub: "TEE simulation · CRE pending", color: "var(--muted)" },
                  { label: "Total Debt",      value: "$39.5k",   sub: "TEE simulation · CRE pending", color: "var(--muted)" },
                ].map(s => (
                  <div key={s.label} style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "18px 20px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px", fontFamily: "Space Mono,monospace" }}>{s.label}</div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "30px", fontWeight: 500, color: s.color, lineHeight: 1, marginBottom: "5px" }}>{s.value}</div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", fontWeight: 300 }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Middle row: Positions + Attestation card */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: "16px" }}>

                {/* Positions summary */}
                <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)" }}>
                  <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(8,145,178,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px" }}>Your <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Positions</em></span>
                      <span style={{ marginLeft: "10px", fontSize: "9px", padding: "2px 6px", background: "rgba(245,158,11,0.1)", color: "#b45309", border: "1px solid rgba(245,158,11,0.25)", fontFamily: "Space Mono,monospace", fontWeight: 700 }}>TEE SIM</span>
                    </div>
                    <button type="button" onClick={() => setTab("positions")} style={{ fontSize: "10px", color: "var(--cyan)", background: "none", border: "none", cursor: "pointer", fontFamily: "Space Mono,monospace", fontWeight: 700 }}>View All →</button>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>{["Protocol", "Asset", "Collateral", "Debt", "Health Factor", "Status"].map(h => (
                        <th key={h} style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--muted)", padding: "10px 18px", textAlign: "left", borderBottom: "1px solid rgba(8,145,178,0.07)", fontFamily: "Space Mono,monospace" }}>{h}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {POSITIONS.map(p => (
                        <tr key={p.protocol}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(8,145,178,0.03)"}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                        >
                          <td style={{ padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.05)" }}>
                            <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--slate)" }}>{p.protocol}</div>
                            <div style={{ fontSize: "10px", color: "var(--muted)" }}>{p.chain}</div>
                          </td>
                          <td style={{ padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "12px", color: "var(--slate2)" }}>{p.asset}</td>
                          <td style={{ padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "12px", fontWeight: 500, color: "var(--slate)" }}>{p.collateral}</td>
                          <td style={{ padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "12px", color: "var(--slate2)" }}>{p.debt}</td>
                          <td style={{ padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.05)" }}>
                            <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "19px", fontWeight: 500, color: hfColor(p.hf) }}>{p.hf.toFixed(2)}</span>
                          </td>
                          <td style={{ padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.05)" }}>
                            <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", padding: "2px 7px", fontFamily: "Space Mono,monospace", background: p.status === "Safe" ? "rgba(16,185,129,0.1)" : "rgba(8,145,178,0.1)", color: p.status === "Safe" ? "#10b981" : "var(--cyan)", border: `1px solid ${p.status === "Safe" ? "rgba(16,185,129,0.2)" : "rgba(8,145,178,0.2)"}` }}>{p.status}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Live Attestation card */}
                <div style={{ background: "var(--card)", border: `1px solid ${isAttested ? "rgba(8,145,178,0.25)" : "rgba(0,0,0,0.1)"}`, display: "flex", flexDirection: "column" }}>
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(8,145,178,0.08)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px" }}><em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Attestation</em></span>
                    {isAttested
                      ? <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 7px", background: "rgba(16,185,129,0.12)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", fontFamily: "Space Mono,monospace" }}>ON-CHAIN</span>
                      : <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 7px", background: "rgba(245,158,11,0.1)", color: "#f59e0b", border: "1px solid rgba(245,158,11,0.2)", fontFamily: "Space Mono,monospace" }}>PENDING</span>
                    }
                  </div>

                  {isAttested && tier ? (
                    <>
                      <div style={{ padding: "22px 18px", textAlign: "center", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
                        <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "72px", fontWeight: 300, color: tierColor, lineHeight: 1 }}>{tier}</div>
                        <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.25em", color: tierColor, textTransform: "uppercase", fontFamily: "Space Mono,monospace", marginTop: "4px" }}>{tierName.toUpperCase()}</div>
                        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "5px" }}>{tierRate} · Instant release</div>
                      </div>
                      <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(8,145,178,0.08)", flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 300 }}>Rate/year</span>
                          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontWeight: 500, color: tierColor }}>{tierRate}</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 300 }}>On-chain rate</span>
                          <span style={{ fontFamily: "Space Mono,monospace", fontSize: "11px", color: "var(--slate2)" }}>{loanRateBps} bps/day</span>
                        </div>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "12px", color: "var(--muted)", fontWeight: 300 }}>Permission</span>
                          <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: hasPerm ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)", color: hasPerm ? "#10b981" : "#f59e0b", border: `1px solid ${hasPerm ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`, fontFamily: "Space Mono,monospace" }}>{hasPerm ? "GRANTED" : "REVOKED"}</span>
                        </div>
                      </div>
                      <div style={{ padding: "14px 18px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "6px" }}>
                          <span style={{ color: "var(--muted)" }}>Expires in</span>
                          <span style={{ color: "var(--cyan)", fontFamily: "Space Mono,monospace", fontWeight: 700 }}>{expiry.label}</span>
                        </div>
                        <div style={{ height: "3px", background: "rgba(0,0,0,0.08)", borderRadius: "2px" }}>
                          <div style={{ height: "100%", width: `${expiry.pct}%`, background: `linear-gradient(90deg,var(--cyan-dim),${tierColor})`, borderRadius: "2px", transition: "width .5s" }} />
                        </div>
                        {expiryRaw && (
                          <a href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.attestation}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: "8px", fontSize: "9px", color: "var(--muted)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                            View on Sepolia Explorer →
                          </a>
                        )}
                      </div>
                    </>
                  ) : (
                    <div style={{ padding: "24px 18px", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: "12px" }}>
                      {!isConnected ? (
                        <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.7 }}>Connect your MetaMask wallet to check your on-chain attestation status.</div>
                      ) : hasPerm ? (
                        <>
                          <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#f59e0b" }} className="pulse-cyan" />
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--slate)" }}>Attestation Pending</div>
                          <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.7 }}>Permission granted. The Chainlink TEE will scan your positions in the next 5-minute cycle and mint your attestation on-chain.</div>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--slate)" }}>Grant Permission</div>
                          <div style={{ fontSize: "11px", color: "var(--muted)", lineHeight: 1.7 }}>Allow the TEE to read your cross-chain positions. No data leaves the enclave.</div>
                          <button type="button" onClick={() => grantPerm({ address: CONTRACTS.attestation, abi: ATTESTATION_ABI, functionName: "grantPermission" })} disabled={isGranting || grantConfirming} className="btn-cyan" style={{ width: "100%", justifyContent: "center", padding: "10px", fontSize: "10px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
                            {isGranting || grantConfirming ? "Confirming…" : "Grant Permission →"}
                          </button>
                          {grantTxHash && (
                            <a href={`${SEPOLIA_EXPLORER}/tx/${grantTxHash}`} target="_blank" rel="noreferrer" style={{ fontSize: "9px", color: "var(--cyan)", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                              Tx: {shortAddr(grantTxHash)} →
                            </a>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Protocol addresses + live chain reads */}
              <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "16px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>Deployed Contracts · Sepolia</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "9px", color: "#10b981", fontFamily: "Space Mono,monospace" }}>
                    <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#10b981" }} className="pulse-cyan" />
                    Live on-chain
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "10px" }}>
                  <a href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.attestation}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "10px 14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.08)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.3)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.08)"}
                  >
                    <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginBottom: "3px" }}>ConfidentialGuardAttestation</div>
                    <div style={{ fontSize: "10px", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>{shortAddr(CONTRACTS.attestation)} ↗</div>
                    {attestOwner && <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginTop: "4px" }}>owner: {shortAddr(attestOwner)}</div>}
                  </a>
                  <a href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.lender}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "10px 14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.08)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.3)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.08)"}
                  >
                    <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginBottom: "3px" }}>ConfidentialLender</div>
                    <div style={{ fontSize: "10px", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>{shortAddr(CONTRACTS.lender)} ↗</div>
                    {lenderOwner && <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginTop: "4px" }}>owner: {shortAddr(lenderOwner)}</div>}
                  </a>
                  <a href={`${SEPOLIA_EXPLORER}/address/${CONTRACTS.nft}`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "10px 14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.08)" }}
                    onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.3)"}
                    onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.08)"}
                  >
                    <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginBottom: "3px" }}>CreditIdentityNFT</div>
                    <div style={{ fontSize: "10px", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>{shortAddr(CONTRACTS.nft)} ↗</div>
                    <div style={{ fontSize: "9px", color: "var(--muted)", fontFamily: "Space Mono,monospace", marginTop: "4px" }}>
                      supply: {nftSupply !== undefined ? nftSupply.toString() : "…"}
                    </div>
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* ════ POSITIONS ════ */}
          {tab === "positions" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: "12px" }}>
                {[
                  { l: "Total Collateral", v: "$69.8k", c: "var(--muted)", sim: true },
                  { l: "Total Debt",       v: "$39.5k", c: "var(--muted)", sim: true },
                  { l: "Unified HF",       v: "3.21",   c: "var(--cyan)",  sim: true },
                  { l: "Avg LTV",          v: "42%",    c: "#10b981",      sim: true },
                  { l: "Protocols",        v: "4",      c: "var(--slate)", sim: false },
                ].map(s => (
                  <div key={s.l} style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "16px 18px", textAlign: "center" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "28px", fontWeight: 500, color: s.c, lineHeight: 1, marginBottom: "6px" }}>{s.v}</div>
                    <div style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace", textTransform: "uppercase", letterSpacing: "0.12em" }}>{s.l}</div>
                    {s.sim && <div style={{ fontSize: "8px", color: "#b45309", marginTop: "4px", fontFamily: "Space Mono,monospace" }}>sim</div>}
                  </div>
                ))}
              </div>

              <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px" }}>All <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Positions</em></span>
                  <span style={{ marginLeft: "12px", fontSize: "10px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>Aggregated by Chainlink TEE · Confidential HTTP</span>
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["Protocol", "Chain", "Collateral Asset", "Debt Asset", "Collateral Value", "Debt Value", "Health Factor", "Liq. Price", "Status"].map(h => (
                      <th key={h} style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--muted)", padding: "10px 16px", textAlign: "left", borderBottom: "1px solid rgba(8,145,178,0.08)", fontFamily: "Space Mono,monospace", whiteSpace: "nowrap" }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {POSITIONS.map(p => (
                      <tr key={p.protocol}
                        onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(8,145,178,0.03)"}
                        onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "transparent"}
                      >
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "13px", fontWeight: 600, color: "var(--slate)" }}>{p.protocol}</td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "12px", color: "var(--slate2)" }}>{p.chain}</td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "12px", color: "var(--slate2)", fontFamily: "Space Mono,monospace" }}>{p.asset.split(" / ")[0]}</td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "12px", color: "var(--slate2)", fontFamily: "Space Mono,monospace" }}>{p.asset.includes("/") ? p.asset.split(" / ")[1] : "—"}</td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "13px", fontWeight: 600, color: "var(--slate)" }}>{p.collateral}</td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "13px", color: "var(--slate2)" }}>{p.debt}</td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)" }}>
                          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "22px", fontWeight: 500, color: hfColor(p.hf) }}>{p.hf.toFixed(2)}</span>
                        </td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)", fontSize: "12px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>
                          {p.protocol === "Aave v3" ? "$1,890" : p.protocol === "Morpho Blue" ? "$1,720" : p.protocol === "Compound v3" ? "$28,500" : "—"}
                        </td>
                        <td style={{ padding: "14px 16px", borderBottom: "1px solid rgba(8,145,178,0.05)" }}>
                          <span style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "3px 8px", fontFamily: "Space Mono,monospace", background: p.status === "Safe" ? "rgba(16,185,129,0.1)" : "rgba(8,145,178,0.1)", color: p.status === "Safe" ? "#10b981" : "var(--cyan)", border: `1px solid ${p.status === "Safe" ? "rgba(16,185,129,0.2)" : "rgba(8,145,178,0.2)"}` }}>{p.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ padding: "12px 18px", background: "rgba(8,145,178,0.03)", borderTop: "1px solid rgba(8,145,178,0.08)", display: "flex", alignItems: "center", gap: "10px" }}>
                  <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--cyan)", flexShrink: 0 }} className="pulse-cyan" />
                  <span style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "Space Mono,monospace" }}>
                    All data aggregated inside Chainlink TEE via Confidential HTTP — no raw data stored on-chain
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* ════ LOANS ════ */}
          {tab === "loans" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>

              {/* Live pool info from contract */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "14px" }}>
                {[
                  {
                    label: "Pool Size",
                    value: totalPoolEth ? `${Number(formatEther(totalPoolEth)).toFixed(3)} ETH` : "Loading…",
                    sub: "Total deposited capital",
                    color: "var(--slate)",
                  },
                  {
                    label: "Available",
                    value: availableEth ? `${Number(formatEther(availableEth)).toFixed(3)} ETH` : "Loading…",
                    sub: "Ready to lend now",
                    color: "#10b981",
                  },
                  {
                    label: "Utilization",
                    value: utilization ? `${utilizationPct.toFixed(1)}%` : "Loading…",
                    sub: "Of pool deployed",
                    color: "var(--cyan)",
                  },
                ].map(s => (
                  <div key={s.label} style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "20px 22px" }}>
                    <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px", fontFamily: "Space Mono,monospace" }}>{s.label}</div>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "32px", fontWeight: 500, color: s.color, lineHeight: 1, marginBottom: "5px" }}>{s.value}</div>
                    <div style={{ fontSize: "11px", color: "var(--muted)" }}>{s.sub}</div>
                  </div>
                ))}
              </div>

              {/* Attestation gate */}
              {!isConnected && (
                <div style={{ padding: "20px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", textAlign: "center", fontSize: "13px", color: "#d97706" }}>
                  Connect MetaMask to request a loan from the on-chain pool.
                </div>
              )}

              {isConnected && !isAttested && (
                <div style={{ padding: "20px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)" }}>
                  <div style={{ fontSize: "13px", fontWeight: 600, color: "#d97706", marginBottom: "6px" }}>Attestation Required</div>
                  <div style={{ fontSize: "12px", color: "var(--slate2)" }}>You need a valid on-chain attestation before requesting a loan. Go to Overview → Grant Permission to start the TEE scoring process.</div>
                </div>
              )}

              {/* Request Loan form */}
              {isAttested && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

                  {/* Loan request form */}
                  <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.18)", padding: "24px" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", marginBottom: "6px" }}>
                      Request <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Loan</em>
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "20px", fontFamily: "Space Mono,monospace" }}>
                      Your Tier {tier} attestation unlocks {tierRate} undercollateralized credit
                    </div>

                    <div style={{ marginBottom: "16px" }}>
                      <label htmlFor="loanAmount" style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", display: "block", marginBottom: "7px", fontFamily: "Space Mono,monospace" }}>Amount (ETH)</label>
                      <input
                        type="number"
                        value={loanAmount}
                        id="loanAmount"
                        onChange={e => setLoanAmount(e.target.value)}
                        min="0.01"
                        step="0.01"
                        className="guard-input"
                        placeholder="0.05"
                      />
                    </div>

                    <div style={{ marginBottom: "20px" }}>
                      <label style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", display: "block", marginBottom: "7px", fontFamily: "Space Mono,monospace" }}>Term (days)</label>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "8px" }}>
                        {[7, 14, 30, 90].map(d => (
                          <button type="button" key={d} onClick={() => setLoanTerm(d)} style={{ padding: "8px 0", background: loanTerm === d ? "var(--cyan)" : "var(--deep)", color: loanTerm === d ? "#ffffff" : "var(--muted)", border: `1px solid ${loanTerm === d ? "var(--cyan)" : "rgba(8,145,178,0.15)"}`, fontSize: "11px", fontWeight: 700, cursor: "pointer", fontFamily: "Space Mono,monospace" }}>
                            {d}d
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Cost preview */}
                    <div style={{ padding: "12px 14px", background: "var(--deep)", border: "1px solid rgba(8,145,178,0.1)", marginBottom: "18px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "5px" }}>
                        <span style={{ color: "var(--muted)" }}>Rate/day</span>
                        <span style={{ fontFamily: "Space Mono,monospace", color: "var(--slate2)" }}>{loanRateBps} bps</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "5px" }}>
                        <span style={{ color: "var(--muted)" }}>Interest ({loanTerm} days)</span>
                        <span style={{ fontFamily: "Space Mono,monospace", color: "var(--slate2)" }}>
                          {(parseFloat(loanAmount || "0") * loanRateBps * loanTerm / 10000).toFixed(6)} ETH
                        </span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", borderTop: "1px solid rgba(8,145,178,0.1)", paddingTop: "6px", marginTop: "6px" }}>
                        <span style={{ fontWeight: 600, color: "var(--slate)" }}>Total repay</span>
                        <span style={{ fontFamily: "Space Mono,monospace", fontWeight: 700, color: "var(--cyan)" }}>
                          {(parseFloat(loanAmount || "0") * (1 + loanRateBps * loanTerm / 10000)).toFixed(6)} ETH
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={isLoaning || loanConfirming || !loanAmount}
                      onClick={() => doLoan({
                        address: CONTRACTS.lender,
                        abi: LENDER_ABI,
                        functionName: "requestLoan",
                        args: [parseEther(loanAmount || "0"), loanTerm],
                      })}
                      className="btn-cyan"
                      style={{ width: "100%", justifyContent: "center", clipPath: "polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%)" }}
                    >
                      {isLoaning || loanConfirming ? "Submitting…" : "Request Loan on-chain →"}
                    </button>

                    {loanTxHash && (
                      <a href={`${SEPOLIA_EXPLORER}/tx/${loanTxHash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: "10px", fontSize: "10px", color: "var(--cyan)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                        Tx: {shortAddr(loanTxHash)} · View on Etherscan →
                      </a>
                    )}
                  </div>

                  {/* How verification works */}
                  <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "24px" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", marginBottom: "16px" }}>
                      How <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>It Works</em>
                    </div>
                    {[
                      { n: "1", title: "Lender calls verifyAttestation()", body: `The ConfidentialLender contract reads your Tier ${tier} attestation directly on-chain before releasing any funds.` },
                      { n: "2", title: "No financial data exposed", body: "Only your tier number and expiry timestamp are readable. All positions, scores, and source data stay inside the TEE." },
                      { n: "3", title: "CCIP cross-chain bridge", body: "If your health factor drops, the Guardian auto-rebalances collateral across chains via CCIP — receiver live on Base Sepolia." },
                    ].map(s => (
                      <div key={s.n} style={{ display: "flex", gap: "14px", marginBottom: "16px" }}>
                        <div style={{ width: "24px", height: "24px", background: "rgba(8,145,178,0.1)", border: "1px solid rgba(8,145,178,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 700, color: "var(--cyan)", flexShrink: 0, fontFamily: "Space Mono,monospace" }}>{s.n}</div>
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 600, color: "var(--slate)", marginBottom: "3px" }}>{s.title}</div>
                          <div style={{ fontSize: "11px", color: "var(--slate2)", lineHeight: 1.7 }}>{s.body}</div>
                        </div>
                      </div>
                    ))}

                    <div style={{ marginTop: "8px", padding: "10px 14px", background: "rgba(8,145,178,0.04)", border: "1px solid rgba(8,145,178,0.12)", fontSize: "10px", fontFamily: "Space Mono,monospace", color: "var(--muted)" }}>
                      <span style={{ color: "var(--cyan)" }}>verifyAttestation</span>({shortAddr(address ?? "0x0")}, minTier=1) → (true, {tier}, {expiry.label})
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════ SETTINGS ════ */}
          {tab === "settings" && (
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "18px", alignItems: "start" }}>

              <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)" }}>
                <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
                  <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px" }}>Account <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Details</em></span>
                </div>
                <div style={{ padding: "22px 20px" }}>
                  {[
                    ["Institution Name", "text",  "Goldman Sachs Digital Assets"],
                    ["Contact Email",    "email", "treasury@gs.com"             ],
                    ["Primary Chain",    "text",  "Ethereum / Sepolia"          ],
                  ].map(([l, t, v]) => (
                    <div key={l} style={{ marginBottom: "18px" }}>
                      <label htmlFor={l.toLowerCase().replace(/\s+/g, '-')} style={{ fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", display: "block", marginBottom: "7px", fontFamily: "Space Mono,monospace" }}>{l}</label>
                      <input type={t} id={l.toLowerCase().replace(/\s+/g, '-')} defaultValue={v} className="guard-input" />
                    </div>
                  ))}
                  <button type="button" className="btn-cyan" style={{ width: "100%", justifyContent: "center", clipPath: "polygon(10px 0%,100% 0%,calc(100% - 10px) 100%,0% 100%)" }}>
                    Save Changes →
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>

                {/* Live wallet info */}
                <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)" }}>
                  <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
                    <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px" }}>Wallet <em style={{ color: "var(--cyan)", fontStyle: "italic" }}>Info</em></span>
                  </div>
                  <div>
                    {[
                      ["Address",  address ? shortAddr(address) : "Not connected",  address ? "var(--cyan)"   : "var(--muted)"],
                      ["Network",  "Sepolia Testnet",                                 "var(--slate2)"],
                      ["Status",   isConnected ? "Connected" : "Disconnected",        isConnected ? "#10b981" : "#ef4444"],
                      ["Contract", shortAddr(CONTRACTS.attestation),                  "var(--muted)"],
                    ].map(([l, v, c]) => (
                      <div key={l as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 18px", borderBottom: "1px solid rgba(8,145,178,0.06)", fontSize: "12px" }}>
                        <span style={{ color: "var(--muted)", fontWeight: 300 }}>{l}</span>
                        <span style={{ fontFamily: "Space Mono,monospace", fontSize: "11px", color: c as string }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* TEE Permissions — live from contract */}
                <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "16px 18px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "14px", fontFamily: "Space Mono,monospace" }}>TEE Permission</div>

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
                      <button type="button" onClick={() => revokePerm({ address: CONTRACTS.attestation, abi: ATTESTATION_ABI, functionName: "revokePermission" })} disabled={isRevoking} style={{ width: "100%", padding: "10px", background: "rgba(220,38,38,0.08)", color: "#ef4444", border: "1px solid rgba(220,38,38,0.2)", fontSize: "9px", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase", cursor: "pointer", fontFamily: "Space Mono,monospace" }}>
                        {isRevoking ? "Revoking…" : "Revoke Permission"}
                      </button>
                    ) : (
                      <button type="button" onClick={() => grantPerm({ address: CONTRACTS.attestation, abi: ATTESTATION_ABI, functionName: "grantPermission" })} disabled={isGranting || grantConfirming} className="btn-cyan" style={{ width: "100%", justifyContent: "center", padding: "10px", fontSize: "10px", clipPath: "polygon(8px 0%,100% 0%,calc(100% - 8px) 100%,0% 100%)" }}>
                        {isGranting || grantConfirming ? "Confirming…" : "Grant Permission →"}
                      </button>
                    )
                  )}

                  {(grantTxHash || revokeTxHash) && (
                    <a href={`${SEPOLIA_EXPLORER}/tx/${grantTxHash ?? revokeTxHash}`} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: "8px", fontSize: "9px", color: "var(--cyan)", textAlign: "center", fontFamily: "Space Mono,monospace", textDecoration: "none" }}>
                      View tx on Etherscan →
                    </a>
                  )}
                </div>

                {/* CCIP Bridge */}
                <div style={{ background: "var(--card)", border: "1px solid rgba(8,145,178,0.1)", padding: "14px 18px" }}>
                  <div style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--muted)", marginBottom: "10px", fontFamily: "Space Mono,monospace" }}>CCIP Cross-Chain</div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                    <span style={{ fontSize: "11px", color: "var(--slate2)" }}>Base Sepolia Receiver</span>
                    <span style={{ fontSize: "9px", fontWeight: 700, padding: "2px 6px", background: "rgba(16,185,129,0.1)", color: "#10b981", border: "1px solid rgba(16,185,129,0.2)", fontFamily: "Space Mono,monospace" }}>LIVE</span>
                  </div>
                  <a href={`https://ccip.chain.link/`} target="_blank" rel="noreferrer" style={{ display: "block", fontSize: "10px", color: "var(--cyan)", fontFamily: "Space Mono,monospace", textDecoration: "none", marginTop: "4px" }}>
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
