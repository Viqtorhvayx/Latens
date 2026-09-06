"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import { erc20Abi, type TokenSymbol } from "@/lib/contracts";
import { humanizeError } from "@/lib/errors";

const FAUCET_AMOUNTS: Record<TokenSymbol, string> = {
  ZEN: "1000",
  ZUSD: "5000",
  WBTC: "0.5",
  USDC: "5000",
};

const MINT_GAS = 150_000n;

export function FaucetButton({
  address,
  symbol,
  decimals,
  variant = "button",
}: {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  variant?: "button" | "menuItem";
}) {
  const { address: account } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");

  if (!account) return null;

  async function handleClick() {
    if (!account) return;
    setStatus("idle");
    try {
      const amount = FAUCET_AMOUNTS[symbol as TokenSymbol] ?? "1000";
      await writeContractAsync({
        address,
        abi: erc20Abi,
        functionName: "mint",
        args: [account, parseUnits(amount, decimals)],
        gas: MINT_GAS,
      });
      await queryClient.invalidateQueries();
      setStatus("done");
    } catch (err) {
      console.error(humanizeError(err));
      setStatus("error");
    }
  }

  const label = isPending ? "Minting…" : status === "done" ? "Minted" : status === "error" ? "Failed" : "Get test tokens";

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      title={`Mint test ${symbol} to your wallet`}
      className={
        variant === "menuItem"
          ? "w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-50"
          : "rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover disabled:opacity-50"
      }
    >
      {label}
    </button>
  );
}
