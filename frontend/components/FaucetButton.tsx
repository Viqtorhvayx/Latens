"use client";

import { useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { parseUnits } from "viem";
import { erc20Abi, type TokenSymbol } from "@/lib/contracts";
import { humanizeError } from "@/lib/errors";

// MockERC20.mint is permissionless — there's no live public Horizen testnet yet to point a
// real faucet at, so this calls the token contract directly from the connected wallet.
const FAUCET_AMOUNTS: Record<TokenSymbol, string> = {
  ZEN: "1000",
  ZUSD: "5000",
  WBTC: "0.5",
  USDC: "5000",
};

// Explicit gas limit, not left to wallet estimation — see PositionActionModal.tsx's
// identical constants for why. A plain ERC20 mint never needs anywhere near this.
const MINT_GAS = 150_000n;

export function FaucetButton({ address, symbol, decimals }: { address: `0x${string}`; symbol: string; decimals: number }) {
  const { address: account } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
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
      setStatus("done");
    } catch (err) {
      console.error(humanizeError(err));
      setStatus("error");
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      title={`Mint test ${symbol} to your wallet`}
      className="rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover disabled:opacity-50"
    >
      {isPending ? "Minting…" : status === "done" ? "Minted" : status === "error" ? "Failed" : "Get test tokens"}
    </button>
  );
}
