"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { assetRegistry, latensPool, priceOracle, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore } from "@/lib/positionStore";
import { usdValueE8 } from "@/lib/valuation";
import { MaskedValue } from "@/components/MaskedValue";
import { PositionActionModal } from "@/components/PositionActionModal";
import { UtilizationMeter } from "@/components/UtilizationMeter";
import { FaucetButton } from "@/components/FaucetButton";
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
  baseRateBps: number;
  slope1Bps: number;
  slope2Bps: number;
  kinkBps: number;
};
type PriceTuple = readonly [bigint, bigint]; // [priceE8, updatedAt]
// LatensPool.positions() is Solidity's auto-generated struct-mapping getter — unlike
// AssetRegistry.getAsset() (a hand-written function returning one real `tuple`-typed
// struct, decoded as a named object above), the auto getter flattens Position into 7
// separate top-level outputs, which viem decodes as a positional array instead.
// [collateralAssetId, debtAssetId, collateralCommitment, debtCommitment, lastUpdated, debtLastUpdated, active, hasDebt]
type PositionTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];

function formatUsd(valueE8: bigint): string {
  return (Number(valueE8) / 1e8).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function formatApr(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

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

  const { data: prices } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: priceOracle.address,
      abi: priceOracle.abi,
      functionName: "getPrice",
      args: [t.address],
    })),
  });

  const { data: borrowRates } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: assetRegistry.address,
      abi: assetRegistry.abi,
      functionName: "borrowRateBps",
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
  const debtAssetId = positionTuple?.[7] ? Number(positionTuple[1]) : undefined;
  const collateralToken = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;
  const collateralAmount = collateralToken ? get(address, collateralToken.assetId).supplied : 0n;
  const debtToken = debtAssetId !== undefined ? tokenList.find((t) => t.assetId === debtAssetId) : undefined;
  const debtAmount = debtToken ? get(address, debtToken.assetId).borrowed : 0n;

  const tvlE8 = tokenList.reduce((sum, t, i) => {
    const asset = assets?.[i]?.result as AssetStruct | undefined;
    const price = prices?.[i]?.result as PriceTuple | undefined;
    if (!asset || !price) return sum;
    return sum + usdValueE8(asset.totalSupplied, t.decimals, price[0]);
  }, 0n);

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-8">
        <span className="font-display text-[28px]">Markets</span>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">Confidential supply and borrow markets on Horizen.</p>
      </div>

      <div className="mb-10 flex flex-col gap-5 sm:flex-row">
        <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total value locked</span>
          {assetsLoading ? <Skeleton width={120} height={22} /> : <span className="font-mono text-[22px] tabular-nums">{formatUsd(tvlE8)}</span>}
        </div>
        {address && (
          <>
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
          </>
        )}
      </div>

      {/* One shared grid for the header AND every row (via `contents` wrappers below) —
          not five separate per-row grids. Each row's last column has different content
          width (empty in the header, buttons in a data row), and `auto` track sizing
          is computed per-grid: independent grids would each hand the fractional columns
          a different amount of remaining space, so headers and data would never land in
          the same place. One grid means the columns are sized once. */}
      {/* Wrapped in its own horizontal scroll container so a narrow viewport scrolls the
          table instead of blowing out the whole page — the columns need real minimum
          widths to stay legible and don't have room to shrink further on mobile. */}
      <div className="overflow-x-auto">
        <div className="grid min-w-[760px] grid-cols-[1.2fr_1fr_1fr_0.9fr_0.8fr_auto] items-stretch gap-4">
          <span className="border-b border-line-strong pb-4 text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Market</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total supplied</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total borrowed</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Utilization</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Borrow APR</span>
          <span className="border-b border-line-strong pb-4"></span>

          {tokenList.map((t, i) => {
            const asset = assets?.[i]?.result as AssetStruct | undefined;
            const totalSupplied = asset ? asset.totalSupplied : 0n;
            const totalBorrowed = asset ? asset.totalBorrowed : 0n;
            const utilization = totalSupplied > 0n ? Number((totalBorrowed * 10000n) / totalSupplied) / 100 : 0;
            const borrowApr = Number((borrowRates?.[i]?.result as bigint | undefined) ?? 0n);

            return (
              <div key={t.symbol} className="contents">
                <div className="flex items-center gap-3 border-b border-line py-4.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-canvas-raised font-mono text-xs text-gold">{t.symbol[0]}</div>
                  <span className="font-medium">{t.symbol}</span>
                </div>
                <div className="flex items-center justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={70} /> : <span className="font-mono text-sm tabular-nums">{formatUnits(totalSupplied, t.decimals)}</span>}
                </div>
                <div className="flex items-center justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={70} /> : <span className="font-mono text-sm tabular-nums">{formatUnits(totalBorrowed, t.decimals)}</span>}
                </div>
                <div className="flex items-center justify-center border-b border-line py-4.5">{assetsLoading ? <Skeleton width={110} /> : <UtilizationMeter value={utilization} />}</div>
                <div className="flex items-center justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={50} /> : <span className="font-mono text-sm tabular-nums text-gold">{formatApr(borrowApr)}</span>}
                </div>
                <div className="flex items-center gap-2 border-b border-line py-4.5">
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
                  <FaucetButton address={t.address} symbol={t.symbol} decimals={t.decimals} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[11.5px] text-ink-faint">
        TVL and Borrow APR are real, live figures computed from each market&apos;s utilization — not placeholders. Individual position sizes are never disclosed. Borrowers pay this rate as an interest fee charged at
        repay time; suppliers don&apos;t yet earn a matching pass-through yield, since their committed amounts can&apos;t grow without revealing them — interest collected funds the protocol treasury and ZEN staking pool
        instead (see contracts/README.md for what a future circuit upgrade would change).
      </p>

      {modal && <PositionActionModal symbol={modal.symbol} mode={modal.mode} onClose={() => setModal(null)} />}
    </div>
  );
}
