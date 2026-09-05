import { parseAbiItem, type PublicClient } from "viem";
import { latensPool } from "./contracts";

const COLLATERAL_UPDATED = parseAbiItem(
  "event CollateralUpdated(address indexed user, uint256 indexed assetId, uint256 newCommitment, uint256 amount, bool isIncrease)"
);
const DEBT_UPDATED = parseAbiItem(
  "event DebtUpdated(address indexed user, uint256 indexed assetId, uint256 newCommitment, uint256 amount, bool isIncrease)"
);

export type ActivityEntry = {
  kind: "collateral" | "debt";
  isIncrease: boolean;
  assetId: number;
  amount: bigint;
  blockNumber: bigint;
  transactionHash: `0x${string}`;
};

// LatensPool already emits CollateralUpdated/DebtUpdated on every supply/withdraw/borrow/
// repay — reading them back for the connected address is the entire "transaction history"
// feature; nothing new needed on the contract side. `fromBlock: 0n` is fine for this local
// dev chain's short history; a real deployment would want a bounded window or an indexer.
export async function fetchActivity(publicClient: PublicClient, address: `0x${string}`): Promise<ActivityEntry[]> {
  const [collateralLogs, debtLogs] = await Promise.all([
    publicClient.getLogs({
      address: latensPool.address,
      event: COLLATERAL_UPDATED,
      args: { user: address },
      fromBlock: 0n,
      toBlock: "latest",
    }),
    publicClient.getLogs({
      address: latensPool.address,
      event: DEBT_UPDATED,
      args: { user: address },
      fromBlock: 0n,
      toBlock: "latest",
    }),
  ]);

  const entries: ActivityEntry[] = [
    ...collateralLogs.map((log) => ({
      kind: "collateral" as const,
      isIncrease: log.args.isIncrease!,
      assetId: Number(log.args.assetId!),
      amount: log.args.amount!,
      blockNumber: log.blockNumber!,
      transactionHash: log.transactionHash!,
    })),
    ...debtLogs.map((log) => ({
      kind: "debt" as const,
      isIncrease: log.args.isIncrease!,
      assetId: Number(log.args.assetId!),
      amount: log.args.amount!,
      blockNumber: log.blockNumber!,
      transactionHash: log.transactionHash!,
    })),
  ];

  entries.sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : b.blockNumber < a.blockNumber ? -1 : 0));
  return entries.slice(0, 25);
}

export function activityLabel(entry: Pick<ActivityEntry, "kind" | "isIncrease">): string {
  if (entry.kind === "collateral") return entry.isIncrease ? "Supplied" : "Withdrew";
  return entry.isIncrease ? "Borrowed" : "Repaid";
}
