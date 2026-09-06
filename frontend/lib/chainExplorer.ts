// No known explorer for local Hardhat (31337) — there's nothing real to link to, so we
// degrade to just showing a copyable hash there. Base entries are here because the
// homepage already states "Built for Horizen · Base L3"; wire in the real destination
// chain's explorer once this deploys somewhere other than local dev.
const EXPLORERS: Record<number, string> = {
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
  11155111: "https://sepolia.etherscan.io",
};

export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  const base = EXPLORERS[chainId];
  return base ? `${base}/tx/${hash}` : undefined;
}
