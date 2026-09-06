"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { assetRegistry, latensCDP, latensDollar, erc20Abi, tokenList, type TokenSymbol } from "@/lib/contracts";
import { useCDPPositionStore } from "@/lib/cdpPositionStore";
import { MaskedValue } from "@/components/MaskedValue";
import { CDPActionModal, type CDPActionMode } from "@/components/CDPActionModal";
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
};
// LatensCDP.positions() flattens DataTypes.CDPPosition:
// [collateralAssetId, collateralCommitment, debtCommitment, lastUpdated, active, hasDebt]
type CDPPositionTuple = readonly [bigint, bigint, bigint, bigint, boolean, boolean];

export default function MintPage() {
  const { address } = useAccount();
  const { get } = useCDPPositionStore();
  const [modal, setModal] = useState<{ symbol: TokenSymbol; mode: CDPActionMode } | null>(null);

  const { data: assets, isLoading: assetsLoading } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: assetRegistry.address,
      abi: assetRegistry.abi,
      functionName: "getAsset",
      args: [BigInt(t.assetId)],
    })),
  });

  const { data: totalLocked } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: latensCDP.address,
      abi: latensCDP.abi,
      functionName: "totalCollateralLocked",
      args: [BigInt(t.assetId)],
    })),
  });

  const { data: position, isLoading: positionLoading } = useReadContract({
    address: latensCDP.address,
    abi: latensCDP.abi,
    functionName: "positions",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: totalDebtMinted } = useReadContract({
    address: latensCDP.address,
    abi: latensCDP.abi,
    functionName: "totalDebtMinted",
  });

  const { data: latdBalance } = useReadContract({
    address: latensDollar.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const positionTuple = position as CDPPositionTuple | undefined;
  const collateralAssetId = positionTuple ? Number(positionTuple[0]) : undefined;
  const collateralToken = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;
  const collateralAmount = collateralToken ? get(address, collateralToken.assetId).collateral : 0n;
  const debtAmount = collateralToken ? get(address, collateralToken.assetId).debt : 0n;

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-8">
        <span className="font-display text-[28px]">Mint</span>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">Mint Latens Dollar (LATD) against confidential collateral — a private CDP.</p>
      </div>

      <div className="mb-10 flex flex-col gap-5 sm:flex-row">
        <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
          <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">LATD in circulation</span>
          <span className="font-mono text-[22px] tabular-nums">{formatUnits((totalDebtMinted as bigint | undefined) ?? 0n, 18)}</span>
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
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Your LATD debt</span>
              {positionLoading ? <Skeleton width={120} height={22} /> : <MaskedValue value={`${formatUnits(debtAmount, 18)} LATD`} fontSize={22} />}
            </div>
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Your LATD balance</span>
              <span className="font-mono text-[22px] tabular-nums">{formatUnits((latdBalance as bigint | undefined) ?? 0n, 18)}</span>
            </div>
          </>
        )}
      </div>

      <div className="overflow-x-auto">
        <div className="grid min-w-[640px] grid-cols-[1.4fr_1.1fr_1fr_auto] items-stretch gap-4">
          <span className="border-b border-line-strong pb-4 text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Collateral</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Total locked</span>
          <span className="border-b border-line-strong pb-4 text-center text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Max LTV</span>
          <span className="border-b border-line-strong pb-4"></span>

          {tokenList.map((t, i) => {
            const asset = assets?.[i]?.result as AssetStruct | undefined;
            const locked = (totalLocked?.[i]?.result as bigint | undefined) ?? 0n;

            return (
              <div key={t.symbol} className="contents">
                <div className="flex items-center gap-3 border-b border-line py-4.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-canvas-raised font-mono text-xs text-gold">{t.symbol[0]}</div>
                  <span className="font-medium">{t.symbol}</span>
                </div>
                <div className="flex items-center justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={70} /> : <span className="font-mono text-sm tabular-nums">{formatUnits(locked, t.decimals)}</span>}
                </div>
                <div className="flex items-center justify-center border-b border-line py-4.5">
                  {assetsLoading ? <Skeleton width={50} /> : <span className="font-mono text-sm tabular-nums">{asset ? `${asset.ltvBps / 100}%` : "—"}</span>}
                </div>
                <div className="flex items-center gap-2 border-b border-line py-4.5">
                  <button
                    onClick={() => setModal({ symbol: t.symbol as TokenSymbol, mode: "supply" })}
                    className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                  >
                    Supply
                  </button>
                  <button
                    onClick={() => setModal({ symbol: t.symbol as TokenSymbol, mode: "mint" })}
                    className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                  >
                    Mint
                  </button>
                  <button
                    onClick={() => setModal({ symbol: t.symbol as TokenSymbol, mode: "burn" })}
                    className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                  >
                    Burn
                  </button>
                  <button
                    onClick={() => setModal({ symbol: t.symbol as TokenSymbol, mode: "withdraw" })}
                    className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                  >
                    Withdraw
                  </button>
                  <FaucetButton address={t.address} symbol={t.symbol} decimals={t.decimals} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-4 text-[11.5px] text-ink-faint">
        A one-time origination fee is taken in LATD at mint time — the entire revenue mechanism, since (like LatensPool) individual position sizes are never disclosed. LatensDollar is pegged to $1 by construction, not by
        an external oracle.
      </p>

      {modal && <CDPActionModal symbol={modal.symbol} mode={modal.mode} onClose={() => setModal(null)} />}
    </div>
  );
}
