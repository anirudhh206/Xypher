import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        void:    "#030308",
        deep:    "#06061a",
        abyss:   "#08081f",
        surface: "#0d0d2a",
        card:    "#111132",
        cyan:    "#00d4f0",
        cyan2:   "#4de3f5",
        "cyan-dim": "#0b4a57",
        indigo:  "#6366f1",
        indigo2: "#818cf8",
        crimson: "#dc2626",
        slate:   "#e2e8f0",
        slate2:  "#94a3b8",
        muted:   "#475569",
      },
      fontFamily: {
        serif: ["Cormorant Garamond", "Georgia", "serif"],
        sans:  ["Space Grotesk", "sans-serif"],
        mono:  ["Space Mono", "monospace"],
      },
      borderColor: {
        cyan:  "rgba(0,212,240,0.15)",
        cyan2: "rgba(0,212,240,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
