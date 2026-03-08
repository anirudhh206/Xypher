"use client";
import Link from "next/link";
import Navbar from "@/components/Navbar";

const TIERS = [
  { n:"1", name:"Sovereign",  range:"UHF > 3.0", rate:"3–4%",   hold:"Instant",  color:"#0891b2", bar:"linear-gradient(90deg,#0891b2,#06b6d4)",  desc:"Undercollateralized · Max freedom" },
  { n:"2", name:"Assured",    range:"UHF > 2.0", rate:"5–6%",   hold:"2 Hours",  color:"#059669", bar:"linear-gradient(90deg,#059669,#10b981)",  desc:"Sub-par collateral · High trust" },
  { n:"3", name:"Verified",   range:"UHF > 1.5", rate:"7–9%",   hold:"6 Hours",  color:"#4f46e5", bar:"linear-gradient(90deg,#4f46e5,#6366f1)",  desc:"Near-par collateral · Established" },
  { n:"4", name:"Building",   range:"UHF > 1.2", rate:"10–12%", hold:"24 Hours", color:"#d97706", bar:"linear-gradient(90deg,#d97706,#ea580c)",  desc:"Over-collateralized · Growing" },
  { n:"5", name:"Restricted", range:"UHF < 1.2", rate:"—",      hold:"—",        color:"#dc2626", bar:"linear-gradient(90deg,#dc2626,#b91c1c)",  desc:"No new credit · Risk zone" },
];

const WALLS = [
  { n:"01", label:"Identity Wall",      icon:"🏦",
    problem:"DeFi demands 150% collateral from Goldman Sachs because it can't see TradFi creditworthiness.",
    solution:"Confidential HTTP queries Plaid + Credora inside TEE. TradFi data never appears on-chain." },
  { n:"02", label:"Privacy Wall",       icon:"🔒",
    problem:"Proving creditworthiness on-chain exposes your full financial strategy. Institutions refuse.",
    solution:"All computation inside TEE. ZK-style proofs reveal only your tier — never the underlying data." },
  { n:"03", label:"Fragmentation Wall", icon:"⛓",
    problem:"$50M across Aave, Morpho, Compound on 3 chains. No unified health factor exists anywhere.",
    solution:"CRE Automation queries all protocols. UHF computed privately. CCIP executes cross-chain rebalancing." },
];

const FEATURES = [
  { n:"01", title:"Confidential HTTP",    body:"Chainlink CRE queries Aave, Morpho, Compound, and Plaid inside a DON — with vault-encrypted credentials never exposed to any node operator." },
  { n:"02", title:"TEE Computation",      body:"Your Unified Health Factor and Credit Score are computed inside a Chainlink TEE. No node sees raw data. Only the encrypted result exits the enclave." },
  { n:"03", title:"ZK-Style Attestation", body:"A compact 64-byte on-chain attestation proves your credit tier with cryptographic finality. Your balance, positions, and identity remain completely private." },
  { n:"04", title:"Cross-Chain Unified",  body:"Positions on Ethereum, Base, and Arbitrum aggregated into one Unified Health Factor. One score governs your access across all participating lenders." },
  { n:"05", title:"Guardian Automation",  body:"Chainlink CRE Automation monitors your UHF every 5 minutes. If critical thresholds are breached, CCIP rebalancing executes cross-chain automatically." },
  { n:"06", title:"ACE Compliance",       body:"Chainlink ACE generates regulatory proof that you passed compliance checks — without revealing which checks ran or what data was evaluated." },
];

const STEPS = [
  { n:"I",   title:"Grant Permission",         body:"Call grantPermission() on-chain. Your wallet authorizes the protocol to assess your positions. No data leaves your control — you set the scope." },
  { n:"II",  title:"TEE Aggregates Everything", body:"Chainlink CRE sends Confidential HTTP requests to Aave, Morpho, Compound, and Plaid — all authenticated with DON-managed vault credentials. Zero exposure." },
  { n:"III", title:"Credit Score Computed",     body:"Inside the TEE, your Unified Health Factor, contagion risk, and debt serviceability are computed. The algorithm runs in hardware isolation — Chainlink nodes see nothing." },
  { n:"IV",  title:"Attestation Minted",        body:"A single tier (1–5) is written to the ConfidentialGuardAttestation contract. Lenders call verifyAttestation() to unlock undercollateralized loans." },
];

const S: React.CSSProperties = { borderTop: "1px solid rgba(0,0,0,0.08)", borderBottom: "1px solid rgba(0,0,0,0.08)" };

export default function Home() {
  return (
    <>
      <Navbar />

      {/* ── HERO ── */}
      <section style={{ minHeight: "100vh", display: "grid", placeItems: "center", position: "relative", overflow: "hidden", padding: "160px 64px 100px", background: "var(--void)" }}>
        <div style={{ position: "relative", zIndex: 2, textAlign: "center", maxWidth: "1000px" }}>

          {/* TEE label */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "16px", marginBottom: "44px" }}>
            <div style={{ width: "52px", height: "1px", background: "linear-gradient(90deg,transparent,var(--cyan))" }} />
            <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 16px", border: "1px solid rgba(8,145,178,0.25)", background: "rgba(8,145,178,0.06)", borderRadius: "2px" }}>
              <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--cyan)" }} className="pulse-cyan" />
              <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>TEE · Chainlink CRE · Solana</span>
            </div>
            <div style={{ width: "52px", height: "1px", background: "linear-gradient(90deg,var(--cyan),transparent)" }} />
          </div>

          <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(52px,8vw,108px)", fontWeight: 300, lineHeight: 0.92, letterSpacing: "-0.02em", marginBottom: "10px", color: "var(--slate)" }}>
            Your Credit Score.<br />
            <em style={{ fontStyle: "italic", color: "var(--cyan)", fontWeight: 300 }}>Computed in Secret.</em><br />
            <strong style={{ fontWeight: 700 }}>Verified Forever.</strong>
          </h1>

          <div style={{ width: "1px", height: "52px", background: "linear-gradient(180deg,var(--cyan),transparent)", margin: "32px auto" }} />

          <p style={{ fontSize: "14px", fontWeight: 300, letterSpacing: "0.05em", color: "var(--slate2)", maxWidth: "460px", margin: "0 auto 48px", lineHeight: 2 }}>
            The first TEE-powered credit intelligence protocol for DeFi. Prove your creditworthiness across chains without exposing a single position, balance, or identity.
          </p>

          <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
            <Link href="/getstarted" className="btn-cyan">Request Attestation →</Link>
            <a href="#how" className="btn-ghost">See How It Works</a>
          </div>

          {/* Stats bar */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: "80px", ...S }}>
            {[["0 Bytes", "Data Exposed On-Chain"], ["6", "Chainlink Services"], ["3", "Chains Unified"], ["150% → 80%", "Collateral Unlocked"]].map(([n, l]) => (
              <div key={l} style={{ flex: 1, maxWidth: "240px", padding: "28px 20px", textAlign: "center", borderRight: "1px solid rgba(0,0,0,0.08)" }}>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "36px", fontWeight: 600, color: "var(--cyan)", lineHeight: 1, marginBottom: "6px" }}>{n}</div>
                <div style={{ fontSize: "10px", fontWeight: 500, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--muted)" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THREE WALLS ── */}
      <section id="how" style={{ padding: "120px 64px", background: "var(--deep)", ...S }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "end", marginBottom: "64px", paddingBottom: "48px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <div>
              <div className="eyebrow"><div className="eyebrow-line" /><span className="eyebrow-text">The Problem</span></div>
              <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(34px,4.5vw,58px)", fontWeight: 400, lineHeight: 1.05, color: "var(--slate)" }}>
                Three Walls Blocking<br /><em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Institutional DeFi</em>
              </h2>
            </div>
            <p style={{ fontSize: "14px", fontWeight: 300, color: "var(--slate2)", lineHeight: 1.9, maxWidth: "440px" }}>
              Goldman Sachs has a AAA credit rating. DeFi asks for 150% collateral anyway. ConfidentialGuard breaks every wall between TradFi reputation and DeFi capital.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "0", border: "1px solid rgba(0,0,0,0.09)" }}>
            {WALLS.map((w, i) => (
              <div key={w.n} className="guard-card" style={{ padding: "48px 36px", borderRight: i < 2 ? "1px solid rgba(0,0,0,0.09)" : "none" }}>
                <div style={{ fontSize: "28px", marginBottom: "16px" }}>{w.icon}</div>
                <div style={{ fontFamily: "Space Mono,monospace", fontSize: "9px", fontWeight: 700, letterSpacing: "0.28em", color: "var(--cyan)", marginBottom: "10px", textTransform: "uppercase" }}>{w.n} — {w.label}</div>
                <div style={{ marginBottom: "16px", padding: "12px", background: "rgba(220,38,38,0.04)", border: "1px solid rgba(220,38,38,0.12)" }}>
                  <div style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "#dc2626", marginBottom: "6px" }}>Problem</div>
                  <p style={{ fontSize: "12px", color: "var(--slate2)", lineHeight: 1.8, fontWeight: 300 }}>{w.problem}</p>
                </div>
                <div style={{ padding: "12px", background: "rgba(8,145,178,0.04)", border: "1px solid rgba(8,145,178,0.18)" }}>
                  <div style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--cyan)", marginBottom: "6px" }}>Solution</div>
                  <p style={{ fontSize: "12px", color: "var(--slate2)", lineHeight: 1.8, fontWeight: 300 }}>{w.solution}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section style={{ padding: "120px 64px", background: "var(--void)", ...S }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "100px", alignItems: "start" }}>
            <div>
              <div className="eyebrow"><div className="eyebrow-line" /><span className="eyebrow-text">Methodology</span></div>
              <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(34px,4vw,56px)", fontWeight: 400, lineHeight: 1.05, color: "var(--slate)" }}>
                Four Acts of<br /><em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Private Verification</em>
              </h2>
              <p style={{ fontSize: "13px", fontWeight: 300, color: "var(--slate2)", lineHeight: 1.9, marginTop: "18px", maxWidth: "320px" }}>From permission grant to on-chain attestation — every byte of sensitive data stays inside the TEE.</p>
              <Link href="/getstarted" className="btn-cyan" style={{ marginTop: "32px", display: "inline-flex" }}>Request Attestation →</Link>
            </div>
            <div>
              {STEPS.map(s => (
                <div key={s.n} style={{ display: "grid", gridTemplateColumns: "52px 1fr", gap: "24px", padding: "30px 0", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                  <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "36px", fontWeight: 300, color: "var(--cyan)", lineHeight: 1, opacity: 0.5 }}>{s.n}</div>
                  <div>
                    <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "21px", fontWeight: 500, marginBottom: "8px", color: "var(--slate)" }}>{s.title}</h3>
                    <p style={{ fontSize: "13px", color: "var(--slate2)", lineHeight: 1.9, fontWeight: 300 }}>{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section style={{ padding: "120px 64px", background: "var(--deep)", ...S }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "end", marginBottom: "64px", paddingBottom: "48px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <div>
              <div className="eyebrow"><div className="eyebrow-line" /><span className="eyebrow-text">Capabilities</span></div>
              <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(34px,4.5vw,58px)", fontWeight: 400, lineHeight: 1.05, color: "var(--slate)" }}>
                Six Chainlink Services.<br /><em style={{ fontStyle: "italic", color: "var(--cyan)" }}>One Unified Score.</em>
              </h2>
            </div>
            <p style={{ fontSize: "14px", fontWeight: 300, color: "var(--slate2)", lineHeight: 1.9, maxWidth: "440px" }}>
              CRE, Data Feeds, Automation, CCIP, and ACE — all orchestrated to produce a single on-chain attestation that unlocks undercollateralized capital.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", border: "1px solid rgba(0,0,0,0.09)" }}>
            {FEATURES.map((f, i) => (
              <div key={f.n} className="guard-card" style={{ padding: "42px 34px", borderRight: i % 3 !== 2 ? "1px solid rgba(0,0,0,0.09)" : "none", borderBottom: i < 3 ? "1px solid rgba(0,0,0,0.09)" : "none" }}>
                <div style={{ fontFamily: "Space Mono,monospace", fontSize: "9px", fontWeight: 700, letterSpacing: "0.28em", color: "var(--cyan)", marginBottom: "12px", textTransform: "uppercase" }}>{f.n}</div>
                <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "21px", fontWeight: 500, marginBottom: "12px", color: "var(--slate)" }}>{f.title}</h3>
                <p style={{ fontSize: "13px", color: "var(--slate2)", lineHeight: 1.9, fontWeight: 300 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CREDIT TIERS ── */}
      <section id="tiers" style={{ padding: "120px 64px", background: "var(--void)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "end", marginBottom: "64px", paddingBottom: "48px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <div>
              <div className="eyebrow"><div className="eyebrow-line" /><span className="eyebrow-text">Credit Tiers</span></div>
              <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(34px,4.5vw,58px)", fontWeight: 400, lineHeight: 1.05, color: "var(--slate)" }}>
                Better Score.<br /><em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Lower Collateral.</em>
              </h2>
            </div>
            <p style={{ fontSize: "14px", fontWeight: 300, color: "var(--slate2)", lineHeight: 1.9, maxWidth: "440px" }}>
              Your Unified Health Factor across all chains determines your tier. Tier 1 unlocks undercollateralized loans at 3–4%. Attestations expire in 24h to stay current with market conditions.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", border: "1px solid rgba(0,0,0,0.09)" }}>
            {TIERS.map((t, i) => (
              <div key={t.n} className="guard-card" style={{ padding: "34px 24px", borderRight: i < 4 ? "1px solid rgba(0,0,0,0.09)" : "none", position: "relative" }}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: t.bar }} />
                <div style={{ fontFamily: "Space Mono,monospace", fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", color: t.color, marginBottom: "8px", textTransform: "uppercase" }}>Tier {t.n}</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "21px", fontWeight: 600, marginBottom: "4px", color: "var(--slate)" }}>{t.name}</div>
                <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "18px" }}>{t.range}</div>
                <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "40px", fontWeight: 300, color: t.color, lineHeight: 1, marginBottom: "4px" }}>{t.rate}</div>
                <div style={{ fontSize: "9px", color: "var(--muted)", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: "12px" }}>Interest Rate</div>
                <div style={{ fontSize: "12px", color: "var(--slate2)", fontWeight: 300 }}>Release: <strong style={{ color: t.color, fontWeight: 600 }}>{t.hold}</strong></div>
                <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--muted)", fontWeight: 300 }}>{t.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECURITY ── */}
      <section id="security" style={{ padding: "120px 64px", background: "var(--deep)", ...S }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "64px" }}>
            <div className="eyebrow" style={{ justifyContent: "center" }}><div className="eyebrow-line" /><span className="eyebrow-text">Threat Model</span><div className="eyebrow-line" /></div>
            <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(34px,4.5vw,58px)", fontWeight: 400, color: "var(--slate)" }}>
              Every Attack Vector.<br /><em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Mitigated.</em>
            </h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "1px", background: "rgba(0,0,0,0.09)" }}>
            {[
              ["🔑", "API Credential Leakage",   "Vault DON DKG: credentials split across quorum. Enclave recombines only at execution, then discards."],
              ["⚡", "Fake Attestation Mint",     "onlyWorkflow modifier. workflowAddress immutable at deploy. No upgrade path."],
              ["⏰", "Stale Attestation Replay",  "24h expiry enforced on-chain. block.timestamp > a.expiry → hard revert."],
              ["📡", "CCIP Message Spoofing",     "GuardianVault validates msg.sender == ccipRouter && sourceChainSelector in allowedSources."],
              ["👁", "Front-Running Score",       "Only tier (int 1–5) stored on-chain. Zero financial data extractable from any transaction."],
              ["🛡", "TEE Hardware Compromise",   "DKG requires quorum. Single TEE compromise cannot reconstruct full credentials."],
            ].map(([icon, title, body]) => (
              <div key={title as string} className="guard-card" style={{ padding: "40px 32px" }}>
                <div style={{ fontSize: "22px", marginBottom: "14px" }}>{icon}</div>
                <h3 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "18px", fontWeight: 500, marginBottom: "10px", color: "var(--slate)" }}>{title}</h3>
                <p style={{ fontSize: "12px", color: "var(--slate2)", lineHeight: 1.8, fontWeight: 300 }}>{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding: "120px 64px", background: "var(--void)", borderTop: "1px solid rgba(0,0,0,0.08)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "80px", alignItems: "center" }}>
          <div>
            <div className="eyebrow"><div className="eyebrow-line" /><span className="eyebrow-text">Your Moment</span></div>
            <h2 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(40px,5vw,68px)", fontWeight: 300, lineHeight: 1.05, marginBottom: "20px", color: "var(--slate)" }}>
              The Enclave<br /><em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Awaits.</em>
            </h2>
            <p style={{ fontSize: "13px", color: "var(--slate2)", lineHeight: 1.9, fontWeight: 300, maxWidth: "380px" }}>Your creditworthiness is already there — across Aave, Morpho, and your bank. ConfidentialGuard reads it privately, proves it cryptographically, and unlocks capital you already deserve.</p>
            <div style={{ display: "flex", gap: "14px", flexWrap: "wrap", marginTop: "36px" }}>
              <Link href="/getstarted" className="btn-cyan">Get Attested →</Link>
              <a href="#tiers" className="btn-ghost">View Tiers</a>
            </div>
          </div>
          <div>
            {[
              ["⬡", "Connect in Minutes",      "From wallet connect to first attestation — faster than any KYC process you have ever seen."],
              ["◈", "No Data Stored Anywhere", "Not on IPFS. Not on any server. The TEE computes and discards. Only the tier survives."],
              ["◆", "40× Better Than Overcollateral", "Tier 1 institutions access capital at 80% LTV. Traditional DeFi demands 150%+."],
            ].map(([icon, title, body]) => (
              <div key={title as string} style={{ display: "flex", alignItems: "flex-start", gap: "16px", padding: "24px 0", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
                <div style={{ width: "32px", height: "32px", border: "1px solid rgba(8,145,178,0.3)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: "14px", color: "var(--cyan)" }}>{icon}</div>
                <div>
                  <h4 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px", fontWeight: 500, marginBottom: "4px", color: "var(--slate)" }}>{title}</h4>
                  <p style={{ fontSize: "12px", color: "var(--slate2)", fontWeight: 300, lineHeight: 1.7 }}>{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{ borderTop: "1px solid rgba(0,0,0,0.09)", padding: "72px 64px 44px", background: "var(--deep)" }}>
        <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "60px", paddingBottom: "52px", borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
            <div>
              <Link href="/" style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
                <div className="guard-emblem" style={{ width: "26px", height: "26px" } as React.CSSProperties} />
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "17px", fontWeight: 600, letterSpacing: "0.2em", color: "var(--slate)", textTransform: "uppercase" }}>Confidential<span style={{ color: "var(--cyan)" }}>Guard</span></span>
              </Link>
              <p style={{ fontSize: "13px", color: "var(--muted)", fontWeight: 300, lineHeight: 1.8, marginTop: "14px", maxWidth: "260px" }}>Privacy-preserving credit intelligence for institutional DeFi. Powered by Chainlink TEE on Solana.</p>
            </div>
            {[
              ["Protocol", ["How It Works/#how", "Credit Tiers/#tiers", "Security/#security", "Dashboard/dashboard"]],
              ["Account",  ["Get Started/getstarted", "Connect Wallet/signup", "Dashboard/dashboard", "Request Attestation/signup"]],
              ["Legal",    ["Privacy Policy/#", "Terms of Service/#", "Security Disclosure/#", "Status/#"]],
            ].map(([heading, links]) => (
              <div key={heading as string}>
                <h4 style={{ fontSize: "10px", fontWeight: 700, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--cyan)", marginBottom: "20px" }}>{heading}</h4>
                <ul style={{ listStyle: "none" }}>
                  {(links as string[]).map(l => { const [label, href] = l.split("/"); return (
                    <li key={label} style={{ marginBottom: "10px" }}>
                      <Link href={"/" + href} style={{ fontSize: "13px", color: "var(--muted)", textDecoration: "none", fontWeight: 300, transition: "color .2s" }}
                        onMouseEnter={e => (e.currentTarget.style.color = "var(--cyan)")}
                        onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
                      >{label}</Link>
                    </li>
                  ); })}
                </ul>
              </div>
            ))}
          </div>
          <div style={{ marginTop: "36px", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "11px", color: "var(--muted)", flexWrap: "wrap", gap: "10px" }}>
            <span>© 2026 ConfidentialGuard Protocol. All rights reserved.</span>
            <span style={{ fontFamily: "Space Mono,monospace", letterSpacing: "0.18em", color: "var(--cyan)", fontSize: "10px" }}>◆ POWERED BY CHAINLINK TEE · SOLANA ◆</span>
          </div>
        </div>
      </footer>
    </>
  );
}
