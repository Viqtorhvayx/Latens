import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS's home-screen icon convention doesn't render an SVG's own rounded-rect mask reliably,
// so this mirrors components/Logo.tsx's mark as a PNG at the exact size Apple expects,
// letting the OS apply its own corner-rounding on top.
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#1C1A17" }}>
      <svg width="180" height="180" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" fill="#1C1A17" />
        <path d="M46 2 L46 20 L28 2 Z" fill="#2B2620" />
        <path d="M2 46 L2 33 L15 46 Z" fill="#100E0C" />
        <line x1="46" y1="20" x2="28" y2="2" stroke="#C9A75C" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>,
    { ...size },
  );
}
