import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS's home-screen icon convention doesn't render an SVG's own rounded-rect mask reliably,
// so this mirrors app/icon.svg's tiled mark as a PNG at the exact size Apple expects, letting
// the OS apply its own corner-rounding on top.
export default function AppleIcon() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#1C1A17" }}>
      <svg width="180" height="180" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" fill="#1C1A17" />
        <svg x="7" y="11.1613" width="34" height="25.6774" viewBox="0 0 333.534368 251.890812">
          <g transform="translate(-105.465632,383.000000) scale(0.1,-0.1)" fill="#C9A75C" stroke="none">
            <path d="M2519 3632 c-145 -109 -311 -234 -369 -278 l-105 -80 -2 -275 c-2 -242 -5 -282 -23 -339 -95 -310 -426 -489 -909 -490 -43 0 -62 -3 -55 -10 6 -6 227 -12 594 -17 645 -7 671 -5 780 51 183 93 300 267 340 506 11 66 28 1130 18 1130 -3 0 -124 -89 -269 -198z" />
            <path d="M3374 3707 l-151 -112 -5 -50 c-3 -27 -6 -357 -7 -732 l-2 -681 63 -4 c35 -3 257 -5 493 -7 237 -1 474 -4 528 -7 53 -2 97 0 97 5 0 11 -25 21 -53 21 -38 0 -179 39 -272 75 -207 80 -388 230 -464 385 -69 142 -71 160 -70 718 0 272 -1 495 -3 497 -1 2 -71 -47 -154 -108z" />
            <path d="M2993 3704 l-143 -105 0 -382 c0 -415 -9 -559 -41 -664 -62 -201 -208 -365 -380 -428 l-64 -23 -3 -173 -3 -174 73 -42 c40 -22 213 -122 383 -221 l310 -181 6 82 c10 124 20 2417 12 2416 -5 0 -72 -48 -150 -105z" />
          </g>
        </svg>
      </svg>
    </div>,
    { ...size },
  );
}
