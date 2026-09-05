"use client";

import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { assetRegistry, latensPool, priceOracle, tokenList } from "@/lib/contracts";
import { usePositionStore } from "@/lib/positionStore";
import { MaskedValue } from "@/components/MaskedValue";
import { HealthGauge } from "@/components/HealthGauge";

type PositionStruct = {
  collateralAssetId: bigint;
  debtAssetId: bigint;
  collateralCommitment: bigint;
  debtCommitment: bigint;
  lastUpdated: number;
  active: boolean;
  hasDebt: boolean;
};
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
type PriceTuple = readonly [bigint, bigint];

export default function PortfolioPage() {
  const { address } = useAccount();
  const { get } = usePositionStore();

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
  const debtToken = debtAssetId !== undefined ? tokenList.find((t) => t.assetId === debtAssetId) : undefined;

  const collateralAmount = collateralToken ? get(address, collateralToken.assetId).supplied : 0n;
  const debtAmount = debtToken ? get(address, debtToken.assetId).borrowed : 0n;

  const { data: reads } = useReadContracts({
    contracts: [
      {
        address: assetRegistry.address,
        abi: assetRegistry.abi,
        functionName: "getAsset",
        args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined,
      },
      {
        address: priceOracle.address,
        abi: priceOracle.abi,
        functionName: "getPrice",
        args: collateralToken ? [collateralToken.address] : undefined,
      },
      {
        address: priceOracle.address,
        abi: priceOracle.abi,
        functionName: "getPrice",
        args: debtToken ? [debtToken.address] : undefined,
      },
    ],
    query: { enabled: collateralAssetId !== undefined },
  });

  const collateralAsset = reads?.[0]?.result as AssetStruct | undefined;
  const collateralPrice = reads?.[1]?.result as PriceTuple | undefined;
  const debtPrice = reads?.[2]?.result as PriceTuple | undefined;

  const zone = (() => {
    if (!debtToken || debtAmount === 0n || !collateralAsset || !collateralPrice || !debtPrice) return "safe" as const;
    const { ltvBps, liquidationThresholdBps } = collateralAsset;
    const collateralValue = collateralAmount * collateralPrice[0];
    const debtValue = debtAmount * debtPrice[0];
    const scaledDebt = debtValue * 10_000n;
    if (scaledDebt <= collateralValue * BigInt(ltvBps)) return "safe" as const;
    if (scaledDebt <= collateralValue * BigInt(liquidationThresholdBps)) return "moderate" as const;
    return "risk" as const;
  })();

  return (
    <div className="px-12 py-10">
      <span className="font-display text-[28px]">Portfolio</span>

      {!address ? (
        <p className="mt-8 text-sm text-ink-muted">Connect a wallet to see your positions.</p>
      ) : (
        <>
          <div className="mt-8 mb-12 flex gap-5">
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Net worth</span>
              <MaskedValue
                value={`${collateralToken ? formatUnits(collateralAmount, collateralToken.decimals) : "0"} ${collateralToken?.symbol ?? ""}`.trim()}
                fontSize={22}
              />
            </div>
            <div className="flex flex-1 rounded-2xl border border-line bg-surface p-5">
              <HealthGauge zone={zone} width={240} />
            </div>
          </div>

          <div className="flex gap-12">
            <div className="flex-1">
              <div className="mb-3.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">Supplying</div>
              {collateralToken && collateralAmount > 0n ? (
                <div className="flex items-center justify-between border-b border-line py-4.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-line-strong bg-canvas-raised font-mono text-[11px] text-gold">
                      {collateralToken.symbol[0]}
                    </div>
                    <span className="font-medium">{collateralToken.symbol}</span>
                  </div>
                  <MaskedValue value={formatUnits(collateralAmount, collateralToken.decimals)} fontSize={14} />
                </div>
              ) : (
                <p className="text-sm text-ink-faint">Nothing supplied yet.</p>
              )}
            </div>
            <div className="w-px bg-line" />
            <div className="flex-1">
              <div className="mb-3.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">Borrowing</div>
              {debtToken && debtAmount > 0n ? (
                <div className="flex items-center justify-between border-b border-line py-4.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-line-strong bg-canvas-raised font-mono text-[11px] text-gold">
                      {debtToken.symbol[0]}
                    </div>
                    <span className="font-medium">{debtToken.symbol}</span>
                  </div>
                  <MaskedValue value={formatUnits(debtAmount, debtToken.decimals)} fontSize={14} />
                </div>
              ) : (
                <p className="text-sm text-ink-faint">Nothing borrowed yet.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
