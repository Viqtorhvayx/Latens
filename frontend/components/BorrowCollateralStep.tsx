"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { assetRegistry, erc20Abi, latensPool, tokens, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore, RAY } from "@/lib/positionStore";
import { appendActivity } from "@/lib/activityStore";
import { sanitizeAmountInput } from "@/lib/amountInput";
import { humanizeError } from "@/lib/errors";
import { waitForConfirmation } from "@/lib/waitForTx";
import { useViewingKey } from "@/lib/viewingKeyContext";
import { encryptNote } from "@/lib/viewingKey";
import { TokenIcon } from "./TokenIcon";

const APPROVE_GAS = 100_000n;
const POOL_CALL_GAS = 600_000n;

// The first half of "borrow when you have nothing supplied yet". Borrowing draws against
// collateral, so with none there is nothing to draw against — but that shouldn't be a dead
// end that sends you off to another screen. This deposits collateral in place, then hands
// control back so the borrow can continue in the same modal.
//
// `fixedSymbol` is set once a position exists: LatensPool pins collateralAssetId on the
// first supply and never changes it, so topping up an existing position can only ever go
// into that same asset. Only a brand-new position gets to choose.
export function BorrowCollateralStep({
  fixedSymbol,
  excludeSymbol,
  onDeposited,
}: {
  fixedSymbol?: TokenSymbol;
  excludeSymbol: TokenSymbol;
  onDeposited: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const { prepareSupply, commit } = usePositionStore();
  const { enabled: viewingKeyEnabled, ensure: ensureViewingKey } = useViewingKey();

  const [chosen, setChosen] = useState<TokenSymbol>(fixedSymbol ?? (tokenList.find((t) => t.symbol !== excludeSymbol)?.symbol as TokenSymbol) ?? excludeSymbol);
  const [amountInput, setAmountInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "approving" | "submitting">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const token = tokens[chosen];

  const { data: balances } = useReadContracts({
    contracts: tokenList.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined })),
    query: { enabled: Boolean(address) && !fixedSymbol },
  });

  const { data: balance } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: indexRayRaw } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "currentSupplyIndexRay",
    args: [BigInt(token.assetId)],
  });
  const indexRay = (indexRayRaw as bigint | undefined) ?? RAY;

  const walletBalance = (balance as bigint | undefined) ?? 0n;
  const amount = (() => {
    try {
      return amountInput ? parseUnits(amountInput, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const exceeds = amount > walletBalance;

  async function handleDeposit() {
    if (!address || amount === 0n || !publicClient) return;
    setErrorMessage("");
    try {
      setPhase("approving");
      const approveHash = await writeContractAsync({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [latensPool.address, amount],
        gas: APPROVE_GAS,
      });
      await waitForConfirmation(publicClient, approveHash);

      setPhase("submitting");
      const { oldCommitment, newCommitment, shareDelta, patch } = await prepareSupply(address, token.assetId, amount, indexRay);
      const hash = await writeContractAsync({
        address: latensPool.address,
        abi: latensPool.abi,
        functionName: "supplyCollateral",
        args: [BigInt(token.assetId), amount, BigInt(newCommitment), "0x", [BigInt(oldCommitment), BigInt(newCommitment), shareDelta, 1n, BigInt(token.assetId)]],
        gas: POOL_CALL_GAS,
      });
      await waitForConfirmation(publicClient, hash);
      commit(address, token.assetId, patch);
      appendActivity(address, { kind: "collateral", isIncrease: true, assetId: token.assetId, amount, transactionHash: hash });

      if (viewingKeyEnabled) {
        (async () => {
          const keyPair = await ensureViewingKey();
          const ciphertext = encryptNote(keyPair, { amount: patch.supplied!.toString(), salt: patch.suppliedSalt!.toString() });
          await writeContractAsync({
            address: latensPool.address,
            abi: latensPool.abi,
            functionName: "publishViewingNote",
            args: [BigInt(token.assetId), false, ciphertext],
            gas: POOL_CALL_GAS,
          });
        })().catch((err) => console.warn("Failed to publish viewing key note (non-fatal):", err));
      }

      await queryClient.invalidateQueries();
      setPhase("idle");
      onDeposited();
    } catch (err) {
      setPhase("idle");
      setErrorMessage(humanizeError(err));
    }
  }

  const busy = phase !== "idle" || isPending;

  return (
    <>
      <p className="mb-4 text-[13px] leading-relaxed text-ink-muted">
        {fixedSymbol
          ? `Borrowing draws against collateral, and this position doesn't have enough yet. Add ${fixedSymbol} to raise your limit — this position is set to ${fixedSymbol} collateral and can't be changed.`
          : "Borrowing draws against collateral, and you haven't supplied any yet. Choose what to put up — this becomes your collateral for this position and can't be swapped later. It earns Supply APY the whole time."}
      </p>

      {!fixedSymbol && (
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Collateral asset</div>
          <div className="grid grid-cols-2 gap-2">
            {tokenList.map((t, i) => {
              const bal = (balances?.[i]?.result as bigint | undefined) ?? 0n;
              const active = t.symbol === chosen;
              return (
                <button
                  key={t.symbol}
                  onClick={() => {
                    setChosen(t.symbol as TokenSymbol);
                    setAmountInput("");
                  }}
                  className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                    active ? "border-gold bg-gold/10" : "border-line hover:bg-surface-hover"
                  }`}
                >
                  <TokenIcon symbol={t.symbol} size={24} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium">{t.symbol}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-faint">{formatUnits(bal, t.decimals)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Collateral amount</span>
        <span className="text-xs text-ink-faint">
          Balance: {formatUnits(walletBalance, token.decimals)}
          {walletBalance > 0n && (
            <button onClick={() => setAmountInput(formatUnits(walletBalance, token.decimals))} className="ml-1.5 font-semibold text-gold transition-colors hover:text-gold-strong">
              Max
            </button>
          )}
        </span>
      </div>
      <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-5 py-5">
        <input
          value={amountInput}
          onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value, token.decimals))}
          placeholder="0.00"
          className="w-full bg-transparent font-mono text-[28px] text-ink outline-none placeholder:text-ink-faint"
        />
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-canvas px-4 py-2">
          <TokenIcon symbol={chosen} size={22} />
          <span className="font-mono text-base text-ink-muted">{chosen}</span>
        </div>
      </div>

      {exceeds && <p className="mb-4 text-xs text-warning">You don&apos;t have that much in your wallet.</p>}

      <button
        onClick={handleDeposit}
        disabled={amount === 0n || busy || exceeds}
        className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        {phase === "approving" ? "Approving…" : phase === "submitting" ? "Depositing…" : "Deposit collateral — continue to borrow"}
      </button>
      {errorMessage && <p className="mt-3 text-center text-xs text-danger">{errorMessage}</p>}
      <p className="mt-3 text-center text-[11.5px] text-ink-faint">Step 1 of 2 · your position details are never broadcast in the clear.</p>
    </>
  );
}
