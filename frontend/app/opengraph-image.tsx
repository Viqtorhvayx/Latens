import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "80px",
        background: "#12100D",
        color: "#F4EFE7",
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 48 }}>
        <svg width="56" height="56" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1.5" y="1.5" width="45" height="45" rx="11" fill="#1C1A17" stroke="rgba(255,255,255,0.09)" />
          <path d="M46 2 L46 20 L28 2 Z" fill="#2B2620" />
          <path d="M2 46 L2 33 L15 46 Z" fill="#100E0C" />
          <line x1="46" y1="20" x2="28" y2="2" stroke="#C9A75C" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 34, fontWeight: 600 }}>Latens</span>
      </div>
      <div style={{ display: "flex", fontSize: 60, fontWeight: 600, lineHeight: 1.15, maxWidth: 980 }}>Lending, kept between you and the chain.</div>
      <div style={{ display: "flex", marginTop: 28, fontSize: 26, color: "#A99C87", maxWidth: 880 }}>A confidential borrow-lend market for Horizen, verified by zero-knowledge proofs instead of a public ledger.</div>
    </div>,
    { ...size },
  );
}
