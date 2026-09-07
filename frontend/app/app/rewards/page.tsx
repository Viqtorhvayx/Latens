"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatUnits } from "viem";
import { latensPool, supplyRewards, tokenList } from "@/lib/contracts";
import { humanizeError } from "@/lib/errors";
import { waitForConfirmation } from "@/lib/waitForTx";
import { Skeleton } from "@/components/Skeleton";

type PositionTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];
type CheckpointTuple = readonly [bigint, boolean, bigint];

const CHECKPOINT_GAS = 120_000n;
const CLAIM_GAS = 120_000n;

export default function RewardsPage() {
  const { address } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState("");

  const { data: position, isLoading: positionLoading } = useReadContract({
    address: latensPool.address,
    abi: latensPool.abi,
    functionName: "positions",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });
  const positionTuple = position as PositionTuple | undefined;
  const hasActivePosition = Boolean(positionTuple?.[6]);

  const { data: reads, refetch } = useReadContracts({
    contracts: [
      { address: supplyRewards.address, abi: supplyRewards.abi, functionName: "currentEpoch" },
      { address: supplyRewards.address, abi: supplyRewards.abi, functionName: "rewardPerEpoch" },
      { address: supplyRewards.address, abi: supplyRewards.abi, functionName: "rewardToken" },
      { address: supplyRewards.address, abi: supplyRewards.abi, functionName: "checkpoints", args: address ? [address] : undefined },
    ],
  });

  const currentEpoch = reads?.[0]?.result as bigint | undefined;
  const rewardPerEpoch = reads?.[1]?.result as bigint | undefined;
  const rewardTokenAddress = reads?.[2]?.result as `0x${string}` | undefined;
  const checkpoint = reads?.[3]?.result as CheckpointTuple | undefined;

  const rewardToken = rewardTokenAddress ? tokenList.find((t) => t.address.toLowerCase() === rewardTokenAddress.toLowerCase()) : undefined;
  const decimals = rewardToken?.decimals ?? 18;
  const symbol = rewardToken?.symbol ?? "reward tokens";

  const lastEpoch = checkpoint?.[0];
  const hasCheckpoint = checkpoint?.[1] ?? false;
  const pendingReward = checkpoint?.[2] ?? 0n;
  const streakActive = hasCheckpoint && currentEpoch !== undefined && lastEpoch === currentEpoch;

  async function handleCheckpoint() {
    if (!address || !publicClient) return;
    setErrorMessage("");
    try {
      const hash = await writeContractAsync({ address: supplyRewards.address, abi: supplyRewards.abi, functionName: "checkpoint", gas: CHECKPOINT_GAS });
      await waitForConfirmation(publicClient, hash);
      await queryClient.invalidateQueries();
      await refetch();
    } catch (err) {
      setErrorMessage(humanizeError(err));
    }
  }

  async function handleClaim() {
    if (!address || !publicClient) return;
    setErrorMessage("");
    try {
      const hash = await writeContractAsync({ address: supplyRewards.address, abi: supplyRewards.abi, functionName: "claim", gas: CLAIM_GAS });
      await waitForConfirmation(publicClient, hash);
      await queryClient.invalidateQueries();
      await refetch();
    } catch (err) {
      setErrorMessage(humanizeError(err));
    }
  }

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-8">
        <span className="font-display text-[28px]">Rewards</span>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          A flat, per-epoch {symbol} reward for keeping an active supply position — check in once every epoch to keep your streak alive.
        </p>
      </div>

      {address && !positionLoading && !hasActivePosition && (
        <p className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-muted">
          Supply collateral in any market first — checking in requires an active position.
        </p>
      )}

      {!address ? (
        <p className="mt-8 text-sm text-ink-muted">Connect a wallet to see your rewards.</p>
      ) : (
        <>
          <div className="mb-10 flex flex-col gap-5 sm:flex-row">
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Current epoch</span>
              {currentEpoch === undefined ? <Skeleton width={80} height={22} /> : <span className="font-mono text-[22px] tabular-nums">{currentEpoch.toString()}</span>}
            </div>
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Reward per epoch</span>
              {rewardPerEpoch === undefined ? (
                <Skeleton width={80} height={22} />
              ) : (
                <span className="font-mono text-[22px] tabular-nums">
                  {formatUnits(rewardPerEpoch, decimals)} {symbol}
                </span>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Pending reward</span>
              <span className="font-mono text-[22px] tabular-nums">
                {formatUnits(pendingReward, decimals)} {symbol}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-5 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-[13px] text-ink-muted">
              {streakActive ? "You've checked in for this epoch — come back next epoch to keep the streak going." : "Check in this epoch to keep your streak alive and start earning next epoch."}
            </span>
            <div className="flex gap-2">
              <button
                onClick={handleCheckpoint}
                disabled={!hasActivePosition || isPending || streakActive}
                className="rounded-lg border border-line-strong px-4 py-2 text-xs font-semibold transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? "Checking in…" : "Check in"}
              </button>
              <button
                onClick={handleClaim}
                disabled={pendingReward === 0n || isPending}
                className="rounded-lg bg-gold px-4 py-2 text-xs font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                Claim
              </button>
            </div>
          </div>

          {errorMessage && <p className="mt-4 text-[13px] text-red-500">{errorMessage}</p>}
        </>
      )}
    </div>
  );
}
