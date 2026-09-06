"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts } from "wagmi";
import { formatUnits } from "viem";
import { assetRegistry, latensPool, priceOracle, tokenList } from "@/lib/contracts";
import { usePositionStore, sharesToReal, RAY } from "@/lib/positionStore";
import { MaskedValue } from "@/components/MaskedValue";
import { HealthGauge } from "@/components/HealthGauge";
import { ExportDisclosureModal } from "@/components/ExportDisclosureModal";
import { ImportBackupModal } from "@/components/ImportBackupModal";
import { PositionActionModal, type ActionMode } from "@/components/PositionActionModal";
import { ActivityLog } from "@/components/ActivityLog";
import { TokenIcon } from "@/components/TokenIcon";
import { Skeleton } from "@/components/Skeleton";
import { usdValueE8 } from "@/lib/valuation";
import { makeEntry, type DisclosureEntry } from "@/lib/disclosure";
import type { TokenSymbol } from "@/lib/contracts";

// LatensPool.positions() is Solidity's auto-generated struct-mapping getter — unlike
// AssetRegistry.getAsset() (a hand-written function returning one real `tuple`-typed
// struct, decoded as a named object below), the auto getter flattens Position into 7
// separate top-level outputs, which viem decodes as a positional array instead.
// [collateralAssetId, debtAssetId, collateralCommitment, debtCommitment, lastUpdated, debtLastUpdated, active, hasDebt]
type PositionTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];
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
  const chainId = useChainId();
  const { get } = usePositionStore();
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [actionModal, setActionModal] = useState<{ symbol: TokenSymbol; mode: ActionMode } | null>(null);
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

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
  const debtToken = debtAssetId !== undefined ? tokenList.find((t) => t.assetId === debtAssetId) : undefined;

  const collateralPosition = collateralToken ? get(address, collateralToken.assetId) : undefined;
  const debtPosition = debtToken ? get(address, debtToken.assetId) : undefined;
  const collateralShares = collateralPosition?.supplied ?? 0n;
  const debtAmount = debtPosition?.borrowed ?? 0n;

  const { data: collateralIndexRayRaw } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "currentSupplyIndexRay",
    args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined,
    query: { enabled: collateralAssetId !== undefined },
  });
  const collateralIndexRay = (collateralIndexRayRaw as bigint | undefined) ?? RAY;
  const collateralAmount = sharesToReal(collateralShares, collateralIndexRay);

  // makeEntry() now calls a real (WASM-backed) Pedersen hash, so it's async — can't live in
  // a useMemo. Recomputed whenever the underlying position data changes; `cancelled` guards
  // against a stale async result landing after a newer one was already kicked off.
  const [disclosureEntries, setDisclosureEntries] = useState<DisclosureEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    async function compute() {
      const out: DisclosureEntry[] = [];
      if (collateralToken && collateralPosition && collateralShares > 0n) {
        out.push(await makeEntry(collateralToken.assetId, collateralToken.symbol, "collateral", collateralShares, collateralPosition.suppliedSalt));
      }
      if (debtToken && debtPosition && debtAmount > 0n) {
        out.push(await makeEntry(debtToken.assetId, debtToken.symbol, "debt", debtAmount, debtPosition.borrowedSalt));
      }
      if (!cancelled) setDisclosureEntries(out);
    }
    compute();
    return () => {
      cancelled = true;
    };
  }, [collateralToken, collateralPosition, collateralShares, debtToken, debtPosition, debtAmount]);

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
    if (!collateralToken || !debtToken || debtAmount === 0n || !collateralAsset || !collateralPrice || !debtPrice) return "safe" as const;
    const { ltvBps, liquidationThresholdBps } = collateralAsset;
    // USD-normalized via usdValueE8 — collateral and debt tokens don't share decimals
    // (ZEN/ZUSD=18, WBTC=8, USDC=6), so comparing raw base-unit amounts times priceE8
    // directly (the previous approach) isn't dimensionally valid; see lib/valuation.ts.
    const collateralValueE8 = usdValueE8(collateralAmount, collateralToken.decimals, collateralPrice[0]);
    const debtValueE8 = usdValueE8(debtAmount, debtToken.decimals, debtPrice[0]);
    const scaledDebt = debtValueE8 * 10_000n;
    if (scaledDebt <= collateralValueE8 * BigInt(ltvBps)) return "safe" as const;
    if (scaledDebt <= collateralValueE8 * BigInt(liquidationThresholdBps)) return "moderate" as const;
    return "risk" as const;
  })();

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <span className="font-display text-[28px]">Portfolio</span>
        {address && (
          <div className="flex gap-2">
            <button onClick={() => setShowImport(true)} className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover">
              Import backup
            </button>
            {disclosureEntries.length > 0 && (
              <button onClick={() => setShowExport(true)} className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover">
                Export for auditor
              </button>
            )}
          </div>
        )}
      </div>

      {!address ? (
        <p className="mt-8 text-sm text-ink-muted">Connect a wallet to see your positions.</p>
      ) : (
        <>
          <div className="mt-8 mb-12 flex flex-col gap-5 sm:flex-row">
            <div className="flex flex-1 flex-col gap-3 rounded-2xl border border-line bg-surface p-5">
              <span className="text-[11.5px] font-semibold tracking-wide text-ink-faint uppercase">Net worth</span>
              {positionLoading ? (
                <Skeleton width={120} height={22} />
              ) : (
                <MaskedValue value={`${collateralToken ? formatUnits(collateralAmount, collateralToken.decimals) : "0"} ${collateralToken?.symbol ?? ""}`.trim()} fontSize={22} />
              )}
            </div>
            <div className="flex flex-1 rounded-2xl border border-line bg-surface p-5">{positionLoading ? <Skeleton width={200} height={22} /> : <HealthGauge zone={zone} width={240} />}</div>
          </div>

          <div className="flex flex-col gap-8 md:flex-row md:gap-12">
            <div className="flex-1">
              <div className="mb-3.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">Supplying</div>
              {positionLoading ? (
                <p className="text-sm text-ink-faint">Loading…</p>
              ) : collateralToken && collateralAmount > 0n ? (
                <div className="flex items-center justify-between border-b border-line py-4.5">
                  <div className="flex items-center gap-3">
                    <TokenIcon symbol={collateralToken.symbol} size={30} />
                    <span className="font-medium">{collateralToken.symbol}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <MaskedValue value={formatUnits(collateralAmount, collateralToken.decimals)} fontSize={14} />
                    <button
                      onClick={() => setActionModal({ symbol: collateralToken.symbol as TokenSymbol, mode: "withdraw" })}
                      className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                    >
                      Withdraw
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-faint">Nothing supplied yet.</p>
              )}
            </div>
            <div className="w-px bg-line" />
            <div className="flex-1">
              <div className="mb-3.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">Borrowing</div>
              {positionLoading ? (
                <p className="text-sm text-ink-faint">Loading…</p>
              ) : debtToken && debtAmount > 0n ? (
                <div className="flex items-center justify-between border-b border-line py-4.5">
                  <div className="flex items-center gap-3">
                    <TokenIcon symbol={debtToken.symbol} size={30} />
                    <span className="font-medium">{debtToken.symbol}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <MaskedValue value={formatUnits(debtAmount, debtToken.decimals)} fontSize={14} />
                    <button
                      onClick={() => setActionModal({ symbol: debtToken.symbol as TokenSymbol, mode: "repay" })}
                      className="rounded-lg border border-line-strong px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
                    >
                      Repay
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-faint">Nothing borrowed yet.</p>
              )}
            </div>
          </div>

          <ActivityLog address={address} refreshKey={activityRefreshKey} />
        </>
      )}

      {showExport && address && (
        <ExportDisclosureModal
          address={address}
          chainId={chainId}
          entries={disclosureEntries}
          decimalsFor={(assetId) => tokenList.find((t) => t.assetId === assetId)?.decimals ?? 18}
          onClose={() => setShowExport(false)}
        />
      )}

      {actionModal && (
        <PositionActionModal
          symbol={actionModal.symbol}
          mode={actionModal.mode}
          onClose={() => {
            setActionModal(null);
            setActivityRefreshKey((k) => k + 1);
          }}
        />
      )}

      {showImport && address && <ImportBackupModal address={address} onClose={() => setShowImport(false)} />}
    </div>
  );
}
