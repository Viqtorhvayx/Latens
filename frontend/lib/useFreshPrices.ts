"use client";

import { useCallback } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { priceOracle } from "./contracts";
import { waitForConfirmation } from "./waitForTx";
import { needsRefresh } from "./priceFreshness";

const REFRESH_GAS = 80_000n;

// Re-stamps any oracle price that's about to age out of PRICE_STALENESS_WINDOW, so the
// solvency-gated call that follows doesn't revert with StaleOraclePrice. See
// priceFreshness.ts for why this is needed at all and why it's safe for anyone to call.
//
// Reads the timestamps from the chain rather than from a cached wagmi query: this decides
// whether to spend a transaction, and a stale cache would either skip a refresh that was
// needed (the tx then reverts) or spend one that wasn't.
export function useFreshPrices() {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  return useCallback(
    async (tokenAddresses: (`0x${string}` | undefined)[]) => {
      if (!publicClient) return;
      const unique = [...new Set(tokenAddresses.filter((a): a is `0x${string}` => Boolean(a)))];
      if (unique.length === 0) return;

      const block = await publicClient.getBlock();
      const stale: `0x${string}`[] = [];
      for (const token of unique) {
        const [, updatedAt] = (await publicClient.readContract({
          address: priceOracle.address,
          abi: priceOracle.abi,
          functionName: "getPrice",
          args: [token],
        })) as readonly [bigint, bigint];
        if (needsRefresh(updatedAt, block.timestamp)) stale.push(token);
      }

      // Sequential, not Promise.all: these are wallet transactions from one account, so
      // they'd contend for the same nonce and the wallet would prompt for all of them at
      // once. In practice at most two are ever stale for a single action.
      for (const token of stale) {
        const hash = await writeContractAsync({
          address: priceOracle.address,
          abi: priceOracle.abi,
          functionName: "refreshTimestamp",
          args: [token],
          gas: REFRESH_GAS,
        });
        await waitForConfirmation(publicClient, hash);
      }
    },
    [publicClient, writeContractAsync],
  );
}
