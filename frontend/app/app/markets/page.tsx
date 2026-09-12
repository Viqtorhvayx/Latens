"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { assetRegistry, latensPool, priceOracle, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore, sharesToReal, RAY } from "@/lib/positionStore";
import { usePositionRole } from "@/lib/positionRole";
import { usdValueE8, formatUsd, formatApr, supplyRateRayFrom, formatRateRay } from "@/lib/valuation";
import { MaskedValue } from "@/components/MaskedValue";
import { PositionActionModal, type ActionMode } from "@/components/PositionActionModal";
import { UtilizationMeter } from "@/components/UtilizationMeter";
import { MarketRowActions } from "@/components/MarketRowActions";
import { TokenIcon } from "@/components/TokenIcon";
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
type PriceTuple = readonly [bigint, bigint];
type PositionTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];

export default function MarketsPage() {
  const { address } = useAccount();
  const { get } = usePositionStore();
  const [modal, setModal] = useState<{ symbol: TokenSymbol; mode: ActionMode } | null>(null);

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

  const { data: utilizations } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: assetRegistry.address,
      abi: assetRegistry.abi,
      functionName: "utilizationBps",
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
  const collateralAssetId = positionTuple?.[6] ? Number(positionTuple[0]) : undefined;
  const debtAssetId = positionTuple?.[7] ? Number(positionTuple[1]) : undefined;
  const collateralToken = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;
  const collateralShares = collateralToken ? get(address, collateralToken.assetId).supplied : 0n;

  const { data: collateralIndexRayRaw } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "currentSupplyIndexRay",
    args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined,
    query: { enabled: collateralAssetId !== undefined },
  });
  const collateralAmount = sharesToReal(collateralShares, (collateralIndexRayRaw as bigint | undefined) ?? RAY);

  const debtToken = debtAssetId !== undefined ? tokenList.find((t) => t.assetId === debtAssetId) : undefined;
  const debtAmount = debtToken ? get(address, debtToken.assetId).borrowed : 0n;
  const hasActivePosition = Boolean(positionTuple?.[6]);
  const hasDebt = Boolean(positionTuple?.[7]);
  const role = usePositionRole(address, collateralAssetId);

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

      {address && !positionLoading && !hasActivePosition && (
        <p className="mb-6 rounded-xl border border-line bg-surface px-4 py-3 text-[13px] text-ink-muted">
          Two ways in. <strong className="font-semibold text-ink">Supply</strong> to lend: you earn Supply APY, and what you lend doubles as collateral if you later want to borrow against it.
          <strong className="font-semibold text-ink"> Borrow</strong> to take a loan: it deposits collateral first, in one of the other assets, and hands you the loan against it. Either way the deposit has to
          be worth more than the loan drawn against it, which is what the LTV column caps.
        </p>
      )}

      <div className="mb-10 flex flex-col gap-5 sm:flex-row">
        <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total value locked</span>
          {assetsLoading ? <Skeleton width={120} height={22} /> : <span className="font-mono text-[22px] tabular-nums">{formatUsd(tvlE8)}</span>}
        </div>
        {address && (
          <>
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">{role === "borrower" ? "Collateral deposited" : "You're lending"}</span>
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

      <div className="overflow-x-auto">
        <div className="grid min-w-[960px] grid-cols-[1.1fr_0.9fr_0.9fr_0.8fr_0.7fr_0.7fr_0.6fr_auto] items-stretch gap-4">
          <span className="border-b border-line-strong pb-4 text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Market</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total supplied</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total borrowed</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Utilization</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Supply APY</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Borrow APR</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">LTV</span>
          <span className="border-b border-line-strong pb-4"></span>

          {tokenList.map((t, i) => {
            const asset = assets?.[i]?.result as AssetStruct | undefined;
            const totalSupplied = asset ? asset.totalSupplied : 0n;
            const totalBorrowed = asset ? asset.totalBorrowed : 0n;
            const utilization = totalSupplied > 0n ? Number((totalBorrowed * 10000n) / totalSupplied) / 100 : 0;
            const borrowApr = Number((borrowRates?.[i]?.result as bigint | undefined) ?? 0n);
            // Recomputed rather than read straight from supplyRateBps: that view floors a
            // sub-basis-point rate to zero, which is most of a young market's life.
            const utilizationBps = (utilizations?.[i]?.result as bigint | undefined) ?? 0n;
            const supplyRateRay = asset ? supplyRateRayFrom(BigInt(borrowApr), utilizationBps, BigInt(asset.reserveFactorBps)) : 0n;

            return (
              <div key={t.symbol} className="contents">
                <div className="flex items-center gap-3 border-b border-line py-4.5">
                  <TokenIcon symbol={t.symbol} size={32} />
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
                  {assetsLoading ? <Skeleton width={50} /> : <span className="font-mono text-sm tabular-nums text-success">{formatRateRay(supplyRateRay)}</span>}
                </div>
                <div className="flex items-center justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={50} /> : <span className="font-mono text-sm tabular-nums text-gold">{formatApr(borrowApr)}</span>}
                </div>
                <div className="flex items-center justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={40} /> : <span className="font-mono text-sm tabular-nums text-ink-muted">{asset ? `${asset.ltvBps / 100}%` : "—"}</span>}
                </div>
                <div className="flex items-center border-b border-line py-4.5">
                  <MarketRowActions
                    tokenAddress={t.address}
                    symbol={t.symbol}
                    decimals={t.decimals}
                    hasActivePosition={hasActivePosition}
                    canSupply={!hasActivePosition || t.assetId === collateralAssetId}
                    canBorrow={!hasDebt || t.assetId === debtAssetId}
                    canWithdraw={t.assetId === collateralAssetId && collateralAmount > 0n && !hasDebt}
                    canRepay={t.assetId === debtAssetId && debtAmount > 0n}
                    activeMode={modal?.symbol === t.symbol ? modal.mode : null}
                    onAction={(mode) => setModal({ symbol: t.symbol as TokenSymbol, mode })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[11.5px] text-ink-faint">
        TVL, Supply APY and Borrow APR are real, live figures computed from each market&apos;s utilization, not placeholders. Individual position sizes are never disclosed. Borrowers pay Borrow APR as an interest fee
        charged at repay time; most of it stays in the pool and compounds into supplied collateral automatically at Supply APY, so withdrawing later returns more than was deposited, with no separate claim step. Once
        you&apos;ve borrowed, only enough of your supply to cover the debt plus its accrued interest sits locked and exposed to liquidation on an adverse price move. The rest stays free to withdraw. Repaying releases
        the locked portion.
      </p>

      {modal && <PositionActionModal symbol={modal.symbol} mode={modal.mode} onClose={() => setModal(null)} />}
    </div>
  );
}
