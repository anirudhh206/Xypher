"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { CONTRACTS, LENDER_ABI, TIER_NAMES } from "@/lib/contracts";

// Tier colors as hex values (matches contracts.ts)
const TIER_COLORS: Record<number, string> = {
  1: "#0891b2", // cyan
  2: "#10b981", // green
  3: "#6366f1", // indigo
  4: "#f59e0b", // amber
  5: "#ef4444", // red
};

interface PoolStats {
  liquidity: number;
  borrowed: number;
  available: number;
  utilisation: number;
}

interface TierRate {
  tier: number;
  rate: number;
  minHealthFactor: number;
}

export function LenderView() {
  const [poolStats, setPoolStats] = useState<PoolStats>({
    liquidity: 0,
    borrowed: 0,
    available: 0,
    utilisation: 0,
  });

  const [tierRates, setTierRates] = useState<TierRate[]>([
    { tier: 1, rate: 3, minHealthFactor: 3.0 },
    { tier: 2, rate: 5, minHealthFactor: 2.0 },
    { tier: 3, rate: 8, minHealthFactor: 1.5 },
    { tier: 4, rate: 12, minHealthFactor: 1.2 },
    { tier: 5, rate: 0, minHealthFactor: 0 },
  ]);

  const [loading, setLoading] = useState(true);

  // Fetch pool stats from contract
  const { data: poolData, isLoading: statsLoading } = useReadContract({
    address: CONTRACTS.lender,
    abi: LENDER_ABI,
    functionName: "getPoolStats",
    query: {
      refetchInterval: 30000, // Refresh every 30s
    },
  });

  useEffect(() => {
    if (poolData && Array.isArray(poolData)) {
      const [liquidity, borrowed, available] = poolData.map((v: any) =>
        Number(v) / 1e18,
      );
      const eth_usd_price = 3700;

      setPoolStats({
        liquidity: liquidity * eth_usd_price,
        borrowed: borrowed * eth_usd_price,
        available: available * eth_usd_price,
        utilisation: liquidity > 0 ? Math.round((borrowed / liquidity) * 100) : 0,
      });
    }
    setLoading(statsLoading);
  }, [poolData, statsLoading]);

  const formatPrice = (usd: number) =>
    `$${usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

  const getUtilisationColor = (util: number) => {
    if (util < 30) return "#10b981"; // Green
    if (util < 70) return "#f59e0b"; // Amber
    return "#ef4444"; // Red
  };

  return (
    <div style={{ padding: "24px" }}>
      {/* Pool Stats Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "32px" }}>
        {/* Liquidity Card */}
        <div style={{ padding: "20px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.2)", borderRadius: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Total Liquidity
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#10b981", marginBottom: "4px" }}>
            {loading ? "..." : formatPrice(poolStats.liquidity)}
          </div>
          <div style={{ fontSize: "10px", color: "var(--slate2)" }}>
            {loading ? "Loading..." : `${poolStats.liquidity > 0 ? ((1 - poolStats.borrowed / poolStats.liquidity) * 100).toFixed(0) : 100}% unutilised`}
          </div>
        </div>

        {/* Borrowed Card */}
        <div style={{ padding: "20px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Total Borrowed
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "#ef4444", marginBottom: "4px" }}>
            {loading ? "..." : formatPrice(poolStats.borrowed)}
          </div>
          <div style={{ fontSize: "10px", color: "var(--slate2)" }}>
            {loading ? "Loading..." : `${poolStats.liquidity ? ((poolStats.borrowed / poolStats.liquidity) * 100).toFixed(1) : 0}% of liquidity`}
          </div>
        </div>

        {/* Available Card */}
        <div style={{ padding: "20px", background: "rgba(6,182,212,0.08)", border: "1px solid rgba(6,182,212,0.2)", borderRadius: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Available ETH
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--cyan)", marginBottom: "4px" }}>
            {loading ? "..." : `${formatPrice(poolStats.available)}`}
          </div>
          <div style={{ fontSize: "10px", color: "var(--slate2)" }}>
            Ready for borrowing
          </div>
        </div>

        {/* Utilisation Card */}
        <div style={{ padding: "20px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "8px" }}>
          <div style={{ fontSize: "11px", color: "var(--muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Utilisation
          </div>
          <div style={{ fontSize: "20px", fontWeight: 700, color: getUtilisationColor(poolStats.utilisation), marginBottom: "4px" }}>
            {loading ? "..." : `${poolStats.utilisation}%`}
          </div>
          <div style={{ marginTop: "8px", width: "100%", height: "4px", background: "rgba(99,102,241,0.1)", borderRadius: "2px", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.min(poolStats.utilisation, 100)}%`,
                height: "100%",
                background: getUtilisationColor(poolStats.utilisation),
                transition: "width 0.5s ease",
              }}
            />
          </div>
        </div>
      </div>

      {/* Tier Rates Table */}
      <div>
        <h2 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "16px", color: "var(--slate)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Borrowing Rates by Tier
        </h2>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              fontSize: "12px",
              borderCollapse: "collapse",
              background: "rgba(8,145,178,0.03)",
              borderRadius: "6px",
              border: "1px solid rgba(8,145,178,0.15)",
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(8,145,178,0.15)" }}>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.08em" }}>
                  Tier
                </th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.08em" }}>
                  Name
                </th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.08em" }}>
                  APY
                </th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.08em" }}>
                  Min Health Factor
                </th>
                <th style={{ padding: "12px", textAlign: "left", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.08em" }}>
                  Max LTV
                </th>
              </tr>
            </thead>
            <tbody>
              {tierRates.map((rate) => {
                const ltvs: Record<number, number> = { 1: 0.9, 2: 0.8, 3: 0.7, 4: 0.6, 5: 0 };
                const ltv = ltvs[rate.tier];

                return (
                  <tr key={rate.tier} style={{ borderBottom: "1px solid rgba(8,145,178,0.08)" }}>
                    <td style={{ padding: "12px", fontWeight: 700, color: "var(--slate)" }}>
                      <div
                        style={{
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          background: TIER_COLORS[rate.tier],
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "#ffffff",
                          fontWeight: 700,
                        }}
                      >
                        {rate.tier}
                      </div>
                    </td>
                    <td style={{ padding: "12px", color: "var(--slate)" }}>
                      {TIER_NAMES[rate.tier]}
                    </td>
                    <td style={{ padding: "12px", fontWeight: 600, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>
                      {rate.rate}%
                    </td>
                    <td style={{ padding: "12px", color: "var(--slate2)" }}>
                      {rate.minHealthFactor > 0 ? `>${rate.minHealthFactor.toFixed(1)}` : "N/A"}
                    </td>
                    <td style={{ padding: "12px", fontWeight: 600, color: "var(--slate)", fontFamily: "Space Mono,monospace" }}>
                      {ltv > 0 ? `${(ltv * 100).toFixed(0)}%` : "0%"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info Box */}
      <div
        style={{
          marginTop: "24px",
          padding: "16px",
          background: "rgba(6,182,212,0.08)",
          border: "1px solid rgba(6,182,212,0.2)",
          borderRadius: "6px",
          fontSize: "12px",
          color: "var(--slate2)",
          lineHeight: 1.6,
        }}
      >
        <strong>How it works:</strong> Deposit collateral on Aave, Morpho, or Compound. Your credit score determines your borrowing tier and interest rate. Higher health factor = better tier = lower rate.
      </div>
    </div>
  );
}
