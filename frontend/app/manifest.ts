import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Latens — Private lending on Horizen",
    short_name: "Latens",
    description: "Confidential borrow-lend market for Horizen, verified by zero-knowledge proofs instead of a public ledger.",
    start_url: "/app/markets",
    display: "standalone",
    background_color: "#12100D",
    theme_color: "#1C1A17",
    // Served straight from public/ rather than the app/icon.png route, so the URL stays
    // stable and the entry is the 512×512 size PWA installers actually want.
    icons: [{ src: "/logo-mark.png", sizes: "512x512", type: "image/png" }],
  };
}
