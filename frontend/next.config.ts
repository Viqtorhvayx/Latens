import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo root (../) also has a package-lock.json (the Hardhat/contracts project) —
  // pin Turbopack's root to this app so it doesn't guess wrong.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
