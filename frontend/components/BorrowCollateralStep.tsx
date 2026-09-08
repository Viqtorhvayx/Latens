"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatUnits, parseUnits } from "viem";
import { assetRegistry, erc20Abi, latensPool, priceOracle, tokens, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore, RAY } from "@/lib/positionStore";
import { appendActivity } from "@/lib/activityStore";
import { sanitizeAmountInput } from "@/lib/amountInput";
import { humanizeError } from "@/lib/errors";
import { waitForConfirmation } from "@/lib/waitForTx";
import { useViewingKey } from "@/lib/viewingKeyContext";
import { encryptNote } from "@/lib/viewingKey";
import { borrowCapacity } from "@/lib/borrow";
import { projectSupplyIndexRay } from "@/lib/supplyIndex";
import { formatUsd } from "@/lib/valuation";
import { TokenIcon } from "./TokenIcon";

const APPROVE_GAS = 100_000n;
const POOL_CALL_GAS = 600_000n;

type AssetStruct = { ltvBps: number };
type PriceTuple = readonly [bigint, bigint];

// The first half of "borrow when you have nothing supplied yet". Borrowing draws against
// collateral, so with none there is nothing to draw against — but that shouldn't be a dead
// end that sends you off to another screen. This deposits collateral in place, then hands
// control back so the borrow can continue in the same modal.
//
// `fixedSymbol` is set once a position exists: LatensPool pins collateralAssetId on the
// first supply and never changes it, so topping up an existing position can only ever go
// into that same asset. Only a brand-new position gets to choose — and the choice can never
// include the asset being borrowed itself (collateralTokens filters it out below): a
// position can't be its own collateral and LTV is bounded well under 100% specifically so
// collateral value always sits above debt value even before the liquidation buffer, which is
// what keeps a bearish move liquidatable instead of the pool taking a loss.
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

  const collateralTokens = tokenList.filter((t) => t.symbol !== excludeSymbol);
  const [chosen, setChosen] = useState<TokenSymbol>(fixedSymbol ?? (collateralTokens[0]?.symbol as TokenSymbol));
  const [amountInput, setAmountInput] = useState("");
  const [phase, setPhase] = useState<"idle" | "approving" | "submitting">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const token = tokens[chosen];
  const debtToken = tokens[excludeSymbol];

  const { data: balances } = useReadContracts({
    contracts: collateralTokens.map((t) => ({ address: t.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined })),
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
  const { data: supplyRateBpsRaw } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "supplyRateBps",
    args: [BigInt(token.assetId)],
  });
  // Projected forward, not used as read: see lib/supplyIndex.ts. A deposit into an asset
  // with live utilization is otherwise racing an index that moves every second.
  const indexRay = projectSupplyIndexRay((indexRayRaw as bigint | undefined) ?? RAY, (supplyRateBpsRaw as bigint | undefined) ?? 0n);

  // Live LTV/price context, so the amount you type shows exactly what it would let you
  // borrow before you ever sign anything — real registry and oracle reads, not an estimate.
  const { data: capacityReads } = useReadContracts({
    contracts: [
      { address: assetRegistry.address, abi: assetRegistry.abi, functionName: "getAsset", args: [BigInt(token.assetId)] },
      { address: priceOracle.address, abi: priceOracle.abi, functionName: "getPrice", args: [token.address] },
      { address: priceOracle.address, abi: priceOracle.abi, functionName: "getPrice", args: [debtToken.address] },
    ],
  });
  const collateralAsset = capacityReads?.[0]?.result as AssetStruct | undefined;
  const collateralPrice = capacityReads?.[1]?.result as PriceTuple | undefined;
  const debtPrice = capacityReads?.[2]?.result as PriceTuple | undefined;

  const walletBalance = (balance as bigint | undefined) ?? 0n;
  const amount = (() => {
    try {
      return amountInput ? parseUnits(amountInput, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();
  const exceeds = amount > walletBalance;

  const projectedCapacity =
    amount > 0n && collateralAsset && collateralPrice && debtPrice
      ? borrowCapacity({
          collateralAmount: amount,
          collateralDecimals: token.decimals,
          collateralPriceE8: collateralPrice[0],
          ltvBps: collateralAsset.ltvBps,
          existingDebt: 0n,
          debtDecimals: debtToken.decimals,
          debtPriceE8: debtPrice[0],
        })
      : undefined;
  const collateralValueE8 = amount > 0n && collateralPrice ? (amount * collateralPrice[0]) / 10n ** BigInt(token.decimals) : undefined;

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
          ? `Borrowing draws against collateral and this position doesn't have enough yet. Add ${fixedSymbol} to raise your limit. This position is set to ${fixedSymbol} collateral and can't be changed.`
          : `Borrowing draws against collateral and you haven't supplied any yet. Choose a different asset to put up as collateral for this ${excludeSymbol} loan. It can't be ${excludeSymbol} itself and it can't be swapped later. It earns Supply APY the whole time.`}
      </p>

      {!fixedSymbol && (
        <div className="mb-5">
          <div className="mb-2 text-xs font-semibold tracking-wide text-ink-faint uppercase">Collateral asset</div>
          <div className="grid grid-cols-2 gap-2">
            {collateralTokens.map((t, i) => {
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

      {amount > 0n && collateralAsset && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-4 py-3">
          <div>
            <div className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Would unlock</div>
            <div className="text-sm text-ink">
              {projectedCapacity !== undefined ? (
                <>
                  up to {formatUnits(projectedCapacity, debtToken.decimals)} {excludeSymbol}
                </>
              ) : (
                "reading live prices…"
              )}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Collateral worth</div>
            <div className="font-mono text-sm text-gold">{collateralValueE8 !== undefined ? formatUsd(collateralValueE8) : "—"}</div>
          </div>
        </div>
      )}

      {exceeds && <p className="mb-4 text-xs text-warning">You don&apos;t have that much in your wallet.</p>}

      <button
        onClick={handleDeposit}
        disabled={amount === 0n || busy || exceeds}
        className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        {phase === "approving" ? "Approving…" : phase === "submitting" ? "Depositing…" : "Deposit collateral, then borrow"}
      </button>
      {errorMessage && <p className="mt-3 text-center text-xs text-danger">{errorMessage}</p>}
      <p className="mt-3 text-center text-[11.5px] text-ink-faint">
        Step 1 of 2 · always worth more than what it backs, so the position stays liquidatable if the market turns · your position details are never broadcast in the clear.
      </p>
    </>
  );
}
