"use client";

import { useReadContracts } from "wagmi";
import { assetRegistry } from "./contracts";
import { supplyRateRayFrom } from "./valuation";

type AssetStruct = { reserveFactorBps: number };

// The RAY-scaled supply rate for one asset, recomputed from the registry's own inputs
// rather than read from `supplyRateBps` — that view floors any rate under a basis point to
// zero, and both callers of this need the real number: one to show an APY that isn't a
// misleading "0.00%", the other to project the supply index forward far enough that a
// deposit doesn't race it (see supplyIndex.ts).
export function useSupplyRateRay(assetId: number, enabled = true): bigint {
  const { data } = useReadContracts({
    contracts: [
      { address: assetRegistry.address, abi: assetRegistry.abi, functionName: "borrowRateBps", args: [BigInt(assetId)] },
      { address: assetRegistry.address, abi: assetRegistry.abi, functionName: "utilizationBps", args: [BigInt(assetId)] },
      { address: assetRegistry.address, abi: assetRegistry.abi, functionName: "getAsset", args: [BigInt(assetId)] },
    ],
    query: { enabled },
  });

  const borrowRateBps = data?.[0]?.result as bigint | undefined;
  const utilizationBps = data?.[1]?.result as bigint | undefined;
  const asset = data?.[2]?.result as AssetStruct | undefined;
  if (borrowRateBps === undefined || utilizationBps === undefined || asset === undefined) return 0n;
  return supplyRateRayFrom(borrowRateBps, utilizationBps, BigInt(asset.reserveFactorBps));
}
