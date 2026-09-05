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
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
