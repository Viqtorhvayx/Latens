"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { assetRegistry, latensPool, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore } from "@/lib/positionStore";
import { MaskedValue } from "@/components/MaskedValue";
import { PositionActionModal } from "@/components/PositionActionModal";
import { UtilizationMeter } from "@/components/UtilizationMeter";
import { Skeleton } from "@/components/Skeleton";

type AssetStruct = {
  token: `0x${string}`;
  isSupported: boolean;
  ltvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  reserveFactorBps: number;
  totalSupplied: bigint;
  totalBorrowed: bigint;
};
// LatensPool.positions() is Solidity's auto-generated struct-mapping getter — unlike
// AssetRegistry.getAsset() (a hand-written function returning one real `tuple`-typed
// struct, decoded as a named object above), the auto getter flattens Position into 7
// separate top-level outputs, which viem decodes as a positional array instead.
// [collateralAssetId, debtAssetId, collateralCommitment, debtCommitment, lastUpdated, active, hasDebt]
type PositionTuple = readonly [bigint, bigint, bigint, bigint, number, boolean, boolean];

export default function MarketsPage() {
  const { address } = useAccount();
  const { get } = usePositionStore();
  const [modal, setModal] = useState<{ symbol: TokenSymbol; mode: "supply" | "borrow" } | null>(null);

  const { data: assets, isLoading: assetsLoading } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: assetRegistry.address,
      abi: assetRegistry.abi,
      functionName: "getAsset",
      args: [BigInt(t.assetId)],
    })),
  });

  const { data: position, isLoading: positionLoading } = useReadContract({
    address: latensPool.address,
    abi: latensPool.abi,
    functionName: "positions",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const positionTuple = position as PositionTuple | undefined;
  const collateralAssetId = positionTuple ? Number(positionTuple[0]) : undefined;
  const debtAssetId = positionTuple?.[6] ? Number(positionTuple[1]) : undefined;
  const collateralToken = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;
  const collateralAmount = collateralToken ? get(address, collateralToken.assetId).supplied : 0n;
  const debtToken = debtAssetId !== undefined ? tokenList.find((t) => t.assetId === debtAssetId) : undefined;
  const debtAmount = debtToken ? get(address, debtToken.assetId).borrowed : 0n;

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-8">
        <span className="font-display text-[28px]">Markets</span>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">Confidential supply and borrow markets on Horizen.</p>
      </div>

      {address && (
        <div className="mb-10 flex flex-col gap-5 sm:flex-row">
          <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Your collateral</span>
            {positionLoading ? (
              <Skeleton width={120} height={22} />
            ) : (
              <MaskedValue value={collateralToken ? `${formatUnits(collateralAmount, collateralToken.decimals)} ${collateralToken.symbol}` : "0.00"} fontSize={22} />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Your debt</span>
            {positionLoading ? <Skeleton width={120} height={22} /> : <MaskedValue value={debtToken ? `${formatUnits(debtAmount, debtToken.decimals)} ${debtToken.symbol}` : "0.00"} fontSize={22} />}
          </div>
        </div>
      )}

      {/* One shared grid for the header AND every row (via `contents` wrappers below) —
          not five separate per-row grids. Each row's last column has different content
          width (empty in the header, two buttons in a data row), and `auto` track sizing
          is computed per-grid: five independent grids would each hand the `1.4fr`/`1.1fr`/
          `1fr` columns a different amount of remaining space, so headers and data would
          never land in the same place. One grid means the columns are sized once. */}
      {/* Wrapped in its own horizontal scroll container so a narrow viewport scrolls the
          table instead of blowing out the whole page — the five columns need real minimum
          widths to stay legible and don't have room to shrink further on mobile. */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[1.4fr_1.1fr_1.1fr_1fr_auto] items-center gap-4">
          <span className="border-b border-line-strong pb-4 text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Market</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total supplied</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total borrowed</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Utilization</span>
          <span className="border-b border-line-strong pb-4"></span>

          {tokenList.map((t, i) => {
            const asset = assets?.[i]?.result as AssetStruct | undefined;
            const totalSupplied = asset ? asset.totalSupplied : 0n;
            const totalBorrowed = asset ? asset.totalBorrowed : 0n;
            const utilization = totalSupplied > 0n ? Number((totalBorrowed * 10000n) / totalSupplied) / 100 : 0;

            return (
              <div key={t.symbol} className="contents">
                <div className="flex items-center gap-3 border-b border-line py-4.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-canvas-raised font-mono text-xs text-gold">{t.symbol[0]}</div>
                  <span className="font-medium">{t.symbol}</span>
                </div>
                <div className="flex justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={70} /> : <span className="font-mono text-sm tabular-nums">{formatUnits(totalSupplied, t.decimals)}</span>}
                </div>
                <div className="flex justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={70} /> : <span className="font-mono text-sm tabular-nums">{formatUnits(totalBorrowed, t.decimals)}</span>}
                </div>
                <div className="flex justify-center border-b border-line py-4.5">{assetsLoading ? <Skeleton width={110} /> : <UtilizationMeter value={utilization} />}</div>
                <div className="flex gap-2 border-b border-line py-4.5">
                  <button
                    onClick={() => setModal({ symbol: t.symbol as TokenSymbol, mode: "supply" })}
                    className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                  >
                    Supply
                  </button>
                  <button
                    onClick={() => setModal({ symbol: t.symbol as TokenSymbol, mode: "borrow" })}
                    className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                  >
                    Borrow
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[11.5px] text-ink-faint">
        Market totals are protocol-level aggregates and are public. Individual position sizes are never disclosed — interest/APY isn&apos;t shown because there&apos;s no accrual model in this build yet.
      </p>

      {modal && <PositionActionModal symbol={modal.symbol} mode={modal.mode} onClose={() => setModal(null)} />}
    </div>
  );
}
