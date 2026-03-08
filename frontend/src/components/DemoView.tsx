"use client";

import { useState, useMemo } from "react";
import { getTierLTV } from "@/lib/risk-engine";
import { TIER_NAMES } from "@/lib/contracts";

// Tier colors as hex values (matches contracts.ts)
const TIER_COLORS: Record<number, string> = {
  1: "#0891b2", // cyan
  2: "#10b981", // green
  3: "#6366f1", // indigo
  4: "#f59e0b", // amber
  5: "#ef4444", // red
};

interface PriceSimulation {
  assetName: string;
  currentPrice: number;
  simulatedPrice: number;
  change: number;
  changePercent: number;
}

interface PositionSimulation {
  collateralAsset: string;
  collateralUSD: number;
  debtUSD: number;
  healthFactor: number;
  simulatedHealthFactor: number;
  liquidationRisk: boolean;
  tier: number;
  simulatedTier: number;
}

export function DemoView() {
  const [ethPrice, setEthPrice] = useState(3700);
  const [btcPrice, setBtcPrice] = useState(41500);

  // Demo positions
  const demoPositions = [
    {
      collateralAsset: "WETH",
      collateralAmount: 5,
      debtUSD: 8000,
      tier: 1,
    },
    {
      collateralAsset: "WBTC",
      collateralAmount: 1,
      debtUSD: 3500,
      tier: 1,
    },
  ];

  // Calculate simulated positions
  const simulations = useMemo(() => {
    return demoPositions.map((pos) => {
      const assetPrices: Record<string, number> = {
        WETH: ethPrice,
        WBTC: btcPrice,
      };

      const currentPrice = assetPrices[pos.collateralAsset] || 0;
      const originalPrice = pos.collateralAsset === "WETH" ? 3700 : 41500;

      const currentCollateralUSD = pos.collateralAmount * currentPrice;
      const currentHealthFactor = currentCollateralUSD / pos.debtUSD;

      // Determine tier based on health factor
      const getTier = (hf: number) => {
        if (hf > 3.0) return 1;
        if (hf > 2.0) return 2;
        if (hf > 1.5) return 3;
        if (hf > 1.2) return 4;
        return 5;
      };

      const currentTier = getTier(currentHealthFactor);
      const isLiquidationRisk = currentHealthFactor < 1.0;

      return {
        collateralAsset: pos.collateralAsset,
        collateralUSD: pos.collateralAmount * originalPrice,
        debtUSD: pos.debtUSD,
        healthFactor: pos.collateralAmount * originalPrice / pos.debtUSD,
        simulatedHealthFactor: currentHealthFactor,
        liquidationRisk: isLiquidationRisk,
        tier: pos.tier,
        simulatedTier: currentTier,
      };
    });
  }, [ethPrice, btcPrice]);

  const hfColor = (hf: number) => {
    return hf > 2.0 ? "#10b981" : hf > 1.2 ? "#f59e0b" : hf > 1.0 ? "#ef4444" : "#8b0000";
  };

  return (
    <div style={{ padding: "24px" }}>
      {/* Price Simulator */}
      <div style={{ marginBottom: "32px" }}>
        <h2 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "16px", color: "var(--slate)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Price Simulator
        </h2>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", maxWidth: "600px" }}>
          {/* ETH Price Control */}
          <div style={{ padding: "16px", background: "rgba(8,145,178,0.08)", borderRadius: "6px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "12px", color: "var(--slate)" }}>
              ETH Price
            </div>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "12px", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>
              ${ethPrice.toLocaleString()}
            </div>
            <input
              type="range"
              min="1850"
              max="7400"
              step="100"
              value={ethPrice}
              onChange={(e) => setEthPrice(Number(e.target.value))}
              placeholder="ETH Price"
              title="ETH Price Slider"
              style={{ width: "100%", cursor: "pointer" }}
            />
            <div style={{ fontSize: "10px", color: "var(--slate2)", marginTop: "8px" }}>
              {ethPrice < 3700 ? "📉" : ethPrice > 3700 ? "📈" : "➡️"} {((ethPrice / 3700 - 1) * 100).toFixed(1)}%
            </div>
          </div>

          {/* BTC Price Control */}
          <div style={{ padding: "16px", background: "rgba(8,145,178,0.08)", borderRadius: "6px" }}>
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "12px", color: "var(--slate)" }}>
              BTC Price
            </div>
            <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "12px", color: "var(--cyan)", fontFamily: "Space Mono,monospace" }}>
              ${btcPrice.toLocaleString()}
            </div>
            <input
              type="range"
              min="20750"
              max="83000"
              step="500"
              value={btcPrice}
              onChange={(e) => setBtcPrice(Number(e.target.value))}
              placeholder="BTC Price"
              title="BTC Price Slider"
              style={{ width: "100%", cursor: "pointer" }}
            />
            <div style={{ fontSize: "10px", color: "var(--slate2)", marginTop: "8px" }}>
              {btcPrice < 41500 ? "📉" : btcPrice > 41500 ? "📈" : "➡️"} {((btcPrice / 41500 - 1) * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Preset Buttons */}
        <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
          {[
            { label: "Crash (-30%)", eth: 2590, btc: 29050 },
            { label: "Normal", eth: 3700, btc: 41500 },
            { label: "Rally (+50%)", eth: 5550, btc: 62250 },
          ].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setEthPrice(preset.eth);
                setBtcPrice(preset.btc);
              }}
              style={{
                padding: "8px 16px",
                background: ethPrice === preset.eth ? "linear-gradient(135deg, var(--cyan), #06b6d4)" : "rgba(8,145,178,0.1)",
                border: "1px solid rgba(8,145,178,0.2)",
                color: ethPrice === preset.eth ? "#ffffff" : "var(--slate2)",
                fontWeight: 600,
                fontSize: "11px",
                cursor: "pointer",
                borderRadius: "4px",
                textTransform: "uppercase",
              }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Position Simulations */}
      <div>
        <h2 style={{ fontSize: "14px", fontWeight: 700, marginBottom: "16px", color: "var(--slate)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Portfolio Impact Simulation
        </h2>

        <div style={{ display: "grid", gap: "16px" }}>
          {simulations.map((sim, i) => (
            <div
              key={i}
              style={{
                padding: "16px",
                background: sim.liquidationRisk
                  ? "rgba(239,68,68,0.08)"
                  : "rgba(8,145,178,0.08)",
                border: sim.liquidationRisk
                  ? "1px solid rgba(239,68,68,0.3)"
                  : "1px solid rgba(8,145,178,0.15)",
                borderRadius: "6px",
              }}
            >
              {sim.liquidationRisk && (
                <div style={{ padding: "8px 12px", background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.4)", borderRadius: "4px", marginBottom: "12px", fontSize: "11px", fontWeight: 600, color: "#ef4444" }}>
                  ⚠️ LIQUIDATION RISK
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: "12px" }}>
                {/* Collateral */}
                <div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Collateral {sim.collateralAsset}
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--slate)" }}>
                    ${sim.collateralUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                  </div>
                </div>

                {/* Debt */}
                <div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Debt
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "var(--slate)" }}>
                    ${sim.debtUSD.toLocaleString()}
                  </div>
                </div>

                {/* Current HF */}
                <div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Current HF
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: hfColor(sim.healthFactor) }}>
                    {sim.healthFactor.toFixed(2)}
                  </div>
                </div>

                {/* Simulated HF */}
                <div>
                  <div style={{ fontSize: "10px", color: "var(--muted)", marginBottom: "4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                    Simulated HF
                  </div>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: hfColor(sim.simulatedHealthFactor) }}>
                    {sim.simulatedHealthFactor.toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Tier Change */}
              {sim.simulatedTier !== sim.tier && (
                <div style={{ marginTop: "12px", padding: "8px", background: "rgba(8,145,178,0.1)", borderRadius: "4px", fontSize: "11px", display: "flex", alignItems: "center", gap: "8px" }}>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: TIER_COLORS[sim.tier],
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: "10px",
                    }}
                  >
                    {sim.tier}
                  </div>
                  <span style={{ color: "var(--slate2)" }}>Tier {sim.tier} ({TIER_NAMES[sim.tier]})</span>
                  <span style={{ color: "var(--muted)", marginLeft: "auto" }}>→</span>
                  <div
                    style={{
                      width: "24px",
                      height: "24px",
                      borderRadius: "50%",
                      background: TIER_COLORS[sim.simulatedTier],
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#ffffff",
                      fontWeight: 700,
                      fontSize: "10px",
                    }}
                  >
                    {sim.simulatedTier}
                  </div>
                  <span style={{ color: "var(--slate2)" }}>Tier {sim.simulatedTier} ({TIER_NAMES[sim.simulatedTier]})</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
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
        <strong>Demo Info:</strong> This simulator shows how price changes impact your health factor and credit tier. Use the sliders to explore different market scenarios. Note: This is for demonstration only.
      </div>
    </div>
  );
}
