"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { LenderView } from "@/components/LenderView";
import { DemoView } from "@/components/DemoView";

type Tab = "lender" | "demo";

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export default function MarketsPage() {
  const { address, isConnected } = useAccount();
  const { mutate: connect } = useConnect();
  const { mutate: disconnect } = useDisconnect();
  const [tab, setTab] = useState<Tab>("lender");

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
          padding: "16px 32px",
          borderBottom: "1px solid rgba(8,145,178,0.08)",
          background: "rgba(248,248,252,0.92)",
          backdropFilter: "blur(16px)",
        }}
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
          <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "16px", fontWeight: 600, letterSpacing: "0.1em", color: "var(--slate)" }}>
            Confidential<span style={{ color: "#0891b2" }}>Guard</span>
          </span>
        </Link>

        <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
          <Link href="/dashboard" style={{ fontSize: "12px", color: "var(--muted)", textDecoration: "none", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Dashboard
          </Link>
          <Link href="/markets" style={{ fontSize: "12px", color: "#0891b2", textDecoration: "none", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "2px solid #0891b2", paddingBottom: "4px" }}>
            Markets
          </Link>
        </div>

        <div>
          {!isConnected ? (
            <button
              onClick={() => connect({ connector: injected() })}
              style={{
                padding: "10px 16px",
                background: "linear-gradient(135deg, #0891b2, #06b6d4)",
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
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span style={{ fontFamily: "Space Mono,monospace", fontSize: "11px", color: "var(--slate2)" }}>
                {shortAddr(address!)}
              </span>
              <button
                onClick={() => disconnect()}
                style={{
                  padding: "6px 12px",
                  background: "rgba(8,145,178,0.1)",
                  border: "1px solid rgba(8,145,178,0.2)",
                  color: "#0891b2",
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
          )}
        </div>
      </div>

      {/* Main Content */}
      <div style={{ paddingTop: "80px", minHeight: "calc(100vh - 80px)" }}>
        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid rgba(8,145,178,0.08)", background: "#fafbfc", position: "sticky", top: "80px", zIndex: 40 }}>
          <button
            onClick={() => setTab("lender")}
            style={{
              padding: "16px 24px",
              border: "none",
              background: tab === "lender" ? "white" : "transparent",
              borderBottom: tab === "lender" ? "2px solid #0891b2" : "none",
              color: tab === "lender" ? "#0891b2" : "var(--muted)",
              fontWeight: tab === "lender" ? 700 : 600,
              cursor: "pointer",
              fontSize: "13px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              transition: "all 0.2s",
            }}
          >
            Pool & Rates
          </button>
          <button
            onClick={() => setTab("demo")}
            style={{
              padding: "16px 24px",
              border: "none",
              background: tab === "demo" ? "white" : "transparent",
              borderBottom: tab === "demo" ? "2px solid #0891b2" : "none",
              color: tab === "demo" ? "#0891b2" : "var(--muted)",
              fontWeight: tab === "demo" ? 700 : 600,
              cursor: "pointer",
              fontSize: "13px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              transition: "all 0.2s",
            }}
          >
            Risk Simulator
          </button>
        </div>

        {/* Content */}
        <div style={{ background: "white" }}>
          {tab === "lender" && <LenderView />}
          {tab === "demo" && <DemoView />}
        </div>
      </div>
    </div>
  );
}
