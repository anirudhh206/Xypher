"use client";
import Link from "next/link";

export default function GetStarted() {
  return (
    <>
      {/* Top bar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 64px", borderBottom: "1px solid rgba(0,0,0,0.09)", background: "rgba(248,248,252,0.92)", backdropFilter: "blur(16px)" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
          <div className="guard-emblem" />
          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "19px", fontWeight: 600, letterSpacing: "0.2em", color: "var(--slate)", textTransform: "uppercase" }}>
            Confidential<span style={{ color: "var(--cyan)" }}>Guard</span>
          </span>
        </Link>
        <Link href="/" style={{ fontSize: "11px", fontWeight: 600, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--muted)", textDecoration: "none", transition: "color .2s" }}
          onMouseEnter={e => (e.currentTarget.style.color = "var(--cyan)")}
          onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
        >← Back to Home</Link>
      </div>

      {/* Main */}
      <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "110px 24px 60px", background: "var(--void)" }}>

        {/* TEE label */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px", marginBottom: "28px" }}>
          <div style={{ width: "40px", height: "1px", background: "linear-gradient(90deg,transparent,var(--cyan))" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "5px 14px", border: "1px solid rgba(8,145,178,0.25)", background: "rgba(8,145,178,0.06)" }}>
            <div style={{ width: "5px", height: "5px", borderRadius: "50%", background: "var(--cyan)" }} className="pulse-cyan" />
            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.28em", textTransform: "uppercase", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>TEE Ready</span>
          </div>
          <div style={{ width: "40px", height: "1px", background: "linear-gradient(90deg,var(--cyan),transparent)" }} />
        </div>

        {/* Title */}
        <h1 style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "clamp(44px,7vw,84px)", fontWeight: 300, lineHeight: 0.95, letterSpacing: "-0.02em", textAlign: "center", marginBottom: "10px", color: "var(--slate)" }}>
          Choose Your<br /><em style={{ fontStyle: "italic", color: "var(--cyan)" }}>Role.</em>
        </h1>

        <div style={{ width: "1px", height: "40px", background: "linear-gradient(180deg,var(--cyan),transparent)", margin: "24px auto" }} />

        <p style={{ fontSize: "14px", fontWeight: 300, color: "var(--slate2)", maxWidth: "400px", margin: "0 auto 48px", lineHeight: 2, textAlign: "center" }}>
          Are you an institution seeking undercollateralized credit, or a lender looking to deploy capital with cryptographic risk guarantees?
        </p>

        {/* Role cards */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", maxWidth: "660px", width: "100%" }}>

          {/* Borrower */}
          <Link href="/signup?role=borrower" style={{ textDecoration: "none" }}>
            <div style={{ background: "#ffffff", border: "1px solid rgba(8,145,178,0.22)", padding: "40px 32px", textAlign: "left", position: "relative", overflow: "hidden", transition: "all .3s", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(8,145,178,0.14)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.5)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.22)"; }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "linear-gradient(90deg,#0891b2,#06b6d4)" }} />
              <div style={{ position: "absolute", top: "14px", right: "14px", fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", color: "#ffffff", background: "var(--cyan)", padding: "3px 10px", fontFamily: "Space Mono,monospace" }}>BORROWER</div>
              <div style={{ fontSize: "26px", marginBottom: "16px" }}>🏦</div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "28px", fontWeight: 500, marginBottom: "10px", color: "var(--slate)" }}>Institution<br />/ Fund</div>
              <div style={{ fontSize: "13px", color: "var(--slate2)", lineHeight: 1.8, fontWeight: 300, marginBottom: "24px" }}>Connect your wallet, grant permission, and let the TEE assess your cross-chain creditworthiness. Unlock undercollateralized loans in minutes.</div>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--cyan)" }}>Get Attested →</div>
            </div>
          </Link>

          {/* Lender */}
          <Link href="/signup?role=lender" style={{ textDecoration: "none" }}>
            <div style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.1)", padding: "40px 32px", textAlign: "left", position: "relative", overflow: "hidden", transition: "all .3s", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-3px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 8px 24px rgba(0,0,0,0.1)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(8,145,178,0.35)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(0)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.06)"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(0,0,0,0.1)"; }}
            >
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: "3px", background: "linear-gradient(90deg,#4f46e5,#6366f1)" }} />
              <div style={{ fontSize: "26px", marginBottom: "16px" }}>📊</div>
              <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "28px", fontWeight: 500, marginBottom: "10px", color: "var(--slate)" }}>Lender<br />/ Protocol</div>
              <div style={{ fontSize: "13px", color: "var(--slate2)", lineHeight: 1.8, fontWeight: 300, marginBottom: "24px" }}>Call verifyAttestation() on our contract. Accept borrowers by cryptographic tier — no financial data exposure required on either side.</div>
              <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "#4f46e5" }}>Integrate Now →</div>
            </div>
          </Link>
        </div>

        {/* Already attested */}
        <div style={{ marginTop: "32px", textAlign: "center" }}>
          <Link href="/dashboard" style={{ fontSize: "13px", color: "var(--muted)", textDecoration: "none", transition: "color .2s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "var(--cyan)")}
            onMouseLeave={e => (e.currentTarget.style.color = "var(--muted)")}
          >Already attested? → View your Dashboard</Link>
        </div>

        <div style={{ marginTop: "20px", fontSize: "11px", color: "var(--muted)", textAlign: "center" }}>
          By continuing you agree to our <a href="#" style={{ color: "var(--cyan)", textDecoration: "none" }}>Terms</a> and <a href="#" style={{ color: "var(--cyan)", textDecoration: "none" }}>Privacy Policy</a>. No data stored outside the TEE.
        </div>
      </div>

      {/* Footer brand */}
      <div style={{ position: "fixed", bottom: "22px", left: "50%", transform: "translateX(-50%)", fontSize: "10px", color: "var(--muted)", letterSpacing: "0.22em", fontFamily: "Space Mono,monospace" }}>
        ◆ POWERED BY CHAINLINK TEE · SOLANA ◆
      </div>
    </>
  );
}
