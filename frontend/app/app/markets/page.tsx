"use client";

import { useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { assetRegistry, latensPool, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore } from "@/lib/positionStore";
import { MaskedValue } from "@/components/MaskedValue";
import { SupplyBorrowModal } from "@/components/SupplyBorrowModal";

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
type PositionStruct = {
  collateralAssetId: bigint;
  debtAssetId: bigint;
  collateralCommitment: bigint;
  debtCommitment: bigint;
  lastUpdated: number;
  active: boolean;
  hasDebt: boolean;
};

export default function MarketsPage() {
  const { address } = useAccount();
  const { get } = usePositionStore();
  const [modal, setModal] = useState<{ symbol: TokenSymbol; mode: "supply" | "borrow" } | null>(null);

  const { data: assets } = useReadContracts({
    contracts: tokenList.map((t) => ({
      address: assetRegistry.address,
      abi: assetRegistry.abi,
      functionName: "getAsset",
      args: [BigInt(t.assetId)],
    })),
  });

  const { data: position } = useReadContract({
    address: latensPool.address,
    abi: latensPool.abi,
    functionName: "positions",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const positionStruct = position as PositionStruct | undefined;
  const collateralAssetId = positionStruct ? Number(positionStruct.collateralAssetId) : undefined;
  const debtAssetId = positionStruct?.hasDebt ? Number(positionStruct.debtAssetId) : undefined;
  const collateralToken = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;
  const collateralAmount = collateralToken ? get(address, collateralToken.assetId).supplied : 0n;
  const debtToken = debtAssetId !== undefined ? tokenList.find((t) => t.assetId === debtAssetId) : undefined;
  const debtAmount = debtToken ? get(address, debtToken.assetId).borrowed : 0n;

  return (
    <div className="px-12 py-10">
      <div className="mb-8">
        <span className="font-display text-[28px]">Markets</span>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">Confidential supply and borrow markets on Horizen.</p>
      </div>

      {address && (
        <div className="mb-10 flex gap-5">
          <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Your collateral</span>
            <MaskedValue value={collateralToken ? `${formatUnits(collateralAmount, collateralToken.decimals)} ${collateralToken.symbol}` : "0.00"} fontSize={22} />
          </div>
          <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
            <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Your debt</span>
            <MaskedValue value={debtToken ? `${formatUnits(debtAmount, debtToken.decimals)} ${debtToken.symbol}` : "0.00"} fontSize={22} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-[1.4fr_1.1fr_1.1fr_1fr_auto] gap-4 border-b border-line-strong pb-4 text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">
        <span>Market</span>
        <span>Total supplied</span>
        <span>Total borrowed</span>
        <span>Utilization</span>
        <span></span>
      </div>

      {tokenList.map((t, i) => {
        const asset = assets?.[i]?.result as AssetStruct | undefined;
        const totalSupplied = asset ? asset.totalSupplied : 0n;
        const totalBorrowed = asset ? asset.totalBorrowed : 0n;
        const utilization = totalSupplied > 0n ? Number((totalBorrowed * 10000n) / totalSupplied) / 100 : 0;

        return (
          <div key={t.symbol} className="grid grid-cols-[1.4fr_1.1fr_1.1fr_1fr_auto] items-center gap-4 border-b border-line py-4.5">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-line-strong bg-canvas-raised font-mono text-xs text-gold">
                {t.symbol[0]}
              </div>
              <span className="font-medium">{t.symbol}</span>
            </div>
            <span className="font-mono text-sm">{formatUnits(totalSupplied, t.decimals)}</span>
            <span className="font-mono text-sm">{formatUnits(totalBorrowed, t.decimals)}</span>
            <div className="flex flex-col gap-1.5">
              <div className="h-[5px] rounded-full bg-white/8">
                <div className="h-full rounded-full bg-gold" style={{ width: `${Math.min(utilization, 100)}%` }} />
              </div>
              <span className="font-mono text-[11.5px] text-ink-faint">{utilization.toFixed(0)}%</span>
            </div>
            <div className="flex gap-2">
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

      <p className="mt-4 text-[11.5px] text-ink-faint">
        Market totals are protocol-level aggregates and are public. Individual position sizes are never disclosed —
        interest/APY isn&apos;t shown because there&apos;s no accrual model in this build yet.
      </p>

      {modal && <SupplyBorrowModal symbol={modal.symbol} mode={modal.mode} onClose={() => setModal(null)} />}
    </div>
  );
}
