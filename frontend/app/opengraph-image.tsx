import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ImageResponse } from "next/og";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Satori has no access to the public/ URL space while this renders at build time, so the
// mark is inlined from disk rather than fetched.
const markDataUri = `data:image/png;base64,${readFileSync(join(process.cwd(), "public", "logo-mark.png")).toString("base64")}`;

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
        <img src={markDataUri} alt="" style={{ width: 72, height: 72 }} />
        <span style={{ fontSize: 34, fontWeight: 600 }}>Latens</span>
      </div>
      <div style={{ display: "flex", fontSize: 60, fontWeight: 600, lineHeight: 1.15, maxWidth: 980 }}>Lending, kept between you and the chain.</div>
      <div style={{ display: "flex", marginTop: 28, fontSize: 26, color: "#A99C87", maxWidth: 880 }}>A confidential borrow-lend market for Horizen, verified by zero-knowledge proofs instead of a public ledger.</div>
    </div>,
    { ...size },
  );
}
