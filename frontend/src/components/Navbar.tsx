"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 60);
    window.addEventListener("scroll", fn);
    return () => window.removeEventListener("scroll", fn);
  }, []);

  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 500,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: scrolled ? "14px 64px" : "22px 64px",
      background: scrolled ? "rgba(248,248,252,0.94)" : "transparent",
      borderBottom: scrolled ? "1px solid rgba(0,0,0,0.09)" : "1px solid transparent",
      backdropFilter: scrolled ? "blur(16px)" : "none",
      transition: "all .35s",
    }}>
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: "12px", textDecoration: "none" }}>
        <div className="guard-emblem" />
        <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: "20px", fontWeight: 600, letterSpacing: "0.2em", color: "var(--slate)", textTransform: "uppercase" }}>
          Confidential<span style={{ color: "var(--cyan)" }}>Guard</span>
        </span>
      </Link>

      <ul style={{ display: "flex", gap: "40px", listStyle: "none", position: "absolute", left: "50%", transform: "translateX(-50%)" }}>
        {[["#how", "How It Works"], ["#tiers", "Credit Tiers"], ["#security", "Security"]].map(([href, label]) => (
          <li key={href}>
            <a href={href} style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--slate2)", textDecoration: "none", transition: "color .2s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "var(--cyan)")}
              onMouseLeave={e => (e.currentTarget.style.color = "var(--slate2)")}
            >{label}</a>
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Link href="/getstarted" className="btn-ghost" style={{ padding: "8px 22px", fontSize: "10px" }}>
          Sign In
        </Link>
        <Link href="/getstarted" className="btn-cyan" style={{ padding: "9px 22px", fontSize: "10px" }}>
          Get Started
        </Link>
      </div>
    </nav>
  );
}
