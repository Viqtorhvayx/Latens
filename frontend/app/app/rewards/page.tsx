"use client";

import { useEffect, useState } from "react";
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
  // Ticked in an effect rather than read during render: the wall clock is impure, and this
  // way the countdown actually counts down instead of freezing at first paint.
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  useEffect(() => {
    const tick = () => setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

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
      { address: supplyRewards.address, abi: supplyRewards.abi, functionName: "epochDuration" },
      { address: supplyRewards.address, abi: supplyRewards.abi, functionName: "startTime" },
    ],
  });

  const currentEpoch = reads?.[0]?.result as bigint | undefined;
  const rewardPerEpoch = reads?.[1]?.result as bigint | undefined;
  const rewardTokenAddress = reads?.[2]?.result as `0x${string}` | undefined;
  const checkpoint = reads?.[3]?.result as CheckpointTuple | undefined;

  const rewardToken = rewardTokenAddress ? tokenList.find((t) => t.address.toLowerCase() === rewardTokenAddress.toLowerCase()) : undefined;
  const decimals = rewardToken?.decimals ?? 18;
  const symbol = rewardToken?.symbol ?? "reward tokens";

  const epochDuration = reads?.[4]?.result as bigint | undefined;
  const startTime = reads?.[5]?.result as bigint | undefined;

  const lastEpoch = checkpoint?.[0];
  const hasCheckpoint = checkpoint?.[1] ?? false;
  const pendingReward = checkpoint?.[2] ?? 0n;
  const streakActive = hasCheckpoint && currentEpoch !== undefined && lastEpoch === currentEpoch;

  // A reward is credited only when a check-in lands in the epoch immediately after the last
  // one, so the very first check-in always credits nothing and there is nothing on screen
  // saying so — which reads as the button being broken. These make the rule visible: how
  // long an epoch is, when this one ends, and what the next check-in will actually do.
  function formatDuration(seconds: bigint): string {
    const s = Number(seconds);
    if (s % 86_400 === 0) return `${s / 86_400} day${s / 86_400 === 1 ? "" : "s"}`;
    if (s % 3_600 === 0) return `${s / 3_600} hour${s / 3_600 === 1 ? "" : "s"}`;
    return `${Math.round(s / 60)} minutes`;
  }

  const epochEndsIn = (() => {
    if (epochDuration === undefined || startTime === undefined || currentEpoch === undefined || nowSeconds === null) return undefined;
    const endsAt = startTime + (currentEpoch + 1n) * epochDuration;
    const remaining = endsAt - nowSeconds;
    return remaining > 0n ? remaining : 0n;
  })();

  const streakBroken = hasCheckpoint && currentEpoch !== undefined && lastEpoch !== undefined && currentEpoch > lastEpoch + 1n;
  const nextCheckInEarns = hasCheckpoint && currentEpoch !== undefined && lastEpoch !== undefined && currentEpoch === lastEpoch + 1n;

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
          A flat, per-epoch {symbol} reward for keeping an active supply position. A reward is credited for each pair of consecutive check-ins, so the first one only starts the streak
          {epochDuration !== undefined ? ` and an epoch runs ${formatDuration(epochDuration)}` : ""}. Miss an epoch and the streak restarts.
        </p>
      </div>

      {address && !positionLoading && !hasActivePosition && (
        <p className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-muted">
          Supply collateral in any market first, since checking in requires an active position.
        </p>
      )}

      {!address ? (
        <p className="mt-8 text-sm text-ink-muted">Connect a wallet to see your rewards.</p>
      ) : (
        <>
          <div className="mb-10 flex flex-col gap-5 sm:flex-row">
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Current epoch</span>
              {currentEpoch === undefined ? (
                <Skeleton width={80} height={22} />
              ) : (
                <>
                  <span className="font-mono text-[22px] tabular-nums">{currentEpoch.toString()}</span>
                  {epochEndsIn !== undefined && <span className="text-[11px] text-ink-faint">Ends in {formatDuration(epochEndsIn)}</span>}
                </>
              )}
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
              {streakActive
                ? `Checked in for this epoch. Come back after it ends${epochEndsIn !== undefined ? ` (in ${formatDuration(epochEndsIn)})` : ""} and check in again to be credited.`
                : nextCheckInEarns
                  ? `Checking in now credits ${rewardPerEpoch !== undefined ? formatUnits(rewardPerEpoch, decimals) : ""} ${symbol}, because it continues last epoch's streak.`
                  : streakBroken
                    ? "The streak lapsed, so this check-in starts a new one and credits nothing. The one after it, next epoch, is what pays."
                    : "The first check-in starts a streak and credits nothing on its own. Check in again next epoch and that one pays."}
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
