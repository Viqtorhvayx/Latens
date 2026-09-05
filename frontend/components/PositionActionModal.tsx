"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { latensPool, assetRegistry, priceOracle, erc20Abi, tokens, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore } from "@/lib/positionStore";
import { humanizeError } from "@/lib/errors";
import { explorerTxUrl } from "@/lib/chainExplorer";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";
import { sanitizeAmountInput } from "@/lib/amountInput";

export type ActionMode = "supply" | "withdraw" | "borrow" | "repay";

const ACTION_LABEL: Record<ActionMode, string> = {
  supply: "supply",
  withdraw: "withdrawal",
  borrow: "borrow",
  repay: "repayment",
};

// LatensPool.positions() is Solidity's auto-generated struct-mapping getter — unlike a
// hand-written function returning a single `tuple`-typed DataTypes.Position, the auto
// getter flattens the struct into 7 separate top-level outputs, which viem decodes as a
// positional array, not a named object. (AssetRegistry.getAsset() below IS hand-written
// and returns one real tuple, so it decodes as an object — don't conflate the two.)
// [collateralAssetId, debtAssetId, collateralCommitment, debtCommitment, lastUpdated, active, hasDebt]
type PositionTuple = readonly [bigint, bigint, bigint, bigint, number, boolean, boolean];

export function PositionActionModal({
  symbol,
  mode,
  onClose,
}: {
  symbol: TokenSymbol;
  mode: ActionMode;
  onClose: () => void;
}) {
  const token = tokens[symbol];
  const [amountInput, setAmountInput] = useState("");
  const { address } = useAccount();
  const chainId = useChainId();
  const { get, prepareSupply, prepareWithdraw, prepareBorrow, prepareRepay, commit } = usePositionStore();
  const { writeContractAsync, isPending } = useWriteContract();
  const [step, setStep] = useState<"idle" | "approving" | "submitting" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const needsApprove = mode === "supply" || mode === "repay";
  const needsSolvencyContext = mode === "borrow" || mode === "withdraw";
  const local = get(address, token.assetId);

  const { data: balance } = useReadContract({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: position } = useReadContract({
    address: latensPool.address,
    abi: latensPool.abi,
    functionName: "positions",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) && needsSolvencyContext },
  });

  const positionTuple = position as PositionTuple | undefined;
  const collateralAssetId = positionTuple ? Number(positionTuple[0]) : undefined;
  // `token` is the asset being acted on, which means different things per mode: the debt
  // asset for borrow (the user is choosing what to borrow), but the collateral asset for
  // withdraw. Solvency always needs the DEBT asset's price specifically, so for withdraw we
  // must resolve it from the position's existing debtAssetId, not from `token`.
  const debtTokenForSolvency =
    mode === "borrow" ? token : positionTuple?.[6] ? tokenList.find((t) => t.assetId === Number(positionTuple[1])) : undefined;

  const { data: collateralAsset } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "getAsset",
    args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined,
    query: { enabled: needsSolvencyContext && collateralAssetId !== undefined },
  });

  const { data: collateralPrice } = useReadContract({
    address: priceOracle.address,
    abi: priceOracle.abi,
    functionName: "getPrice",
    args: collateralAsset ? [(collateralAsset as { token: `0x${string}` }).token] : undefined,
    query: { enabled: needsSolvencyContext && Boolean(collateralAsset) },
  });

  const { data: debtPrice } = useReadContract({
    address: priceOracle.address,
    abi: priceOracle.abi,
    functionName: "getPrice",
    args: debtTokenForSolvency ? [debtTokenForSolvency.address] : undefined,
    query: { enabled: needsSolvencyContext && Boolean(debtTokenForSolvency) },
  });

  const amount = (() => {
    try {
      return amountInput ? parseUnits(amountInput, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();

  const walletBalance = (balance as bigint | undefined) ?? 0n;
  // Borrow has no hard cap here: a real max would need the position's LTV headroom, which
  // this scaffold's health-factor math (portfolio/page.tsx) doesn't correctly normalize
  // across different collateral/debt token decimals yet — a deeper fix, not this one.
  const available =
    mode === "withdraw" ? local.supplied
    : mode === "repay" ? (local.borrowed < walletBalance ? local.borrowed : walletBalance)
    : mode === "supply" ? walletBalance
    : undefined;
  const exceedsAvailable = available !== undefined && amount > available;

  async function handleConfirm() {
    if (!address || amount === 0n) return;
    setErrorMessage("");
    try {
      if (needsApprove) {
        setStep("approving");
        await writeContractAsync({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [latensPool.address, amount],
        });
      }

      setStep("submitting");

      if (mode === "supply") {
        const { oldCommitment, newCommitment, patch } = prepareSupply(address, token.assetId, amount);
        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "supplyCollateral",
          args: [
            BigInt(token.assetId),
            amount,
            BigInt(newCommitment),
            "0x",
            [BigInt(oldCommitment), BigInt(newCommitment), amount, 1n, BigInt(token.assetId)],
          ],
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      } else if (mode === "repay") {
        const { oldCommitment, newCommitment, patch } = prepareRepay(address, token.assetId, amount);
        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "repay",
          args: [
            amount,
            BigInt(newCommitment),
            "0x",
            [BigInt(oldCommitment), BigInt(newCommitment), amount, 0n, BigInt(token.assetId)],
          ],
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      } else if (mode === "borrow") {
        if (collateralAssetId === undefined || !collateralAsset || !collateralPrice || !debtPrice) {
          throw new Error("Supply collateral before borrowing.");
        }
        const { oldCommitment, newCommitment, patch } = prepareBorrow(address, token.assetId, amount);
        const currentCollateralCommitment = positionTuple![2];
        const ltvBps = (collateralAsset as { ltvBps: number }).ltvBps;
        const collateralPriceE8 = (collateralPrice as readonly [bigint, bigint])[0];
        const debtPriceE8 = (debtPrice as readonly [bigint, bigint])[0];

        // Dev-only note: this deployment wires MockVerifier (script/deployLocal.js), which
        // accepts any proof — but LatensPool's OWN binding checks are real and still
        // enforced, which is why the values below must genuinely match on-chain state
        // rather than being placeholders. There is no real zk solvency proof behind this
        // "0x" — see contracts/README.md for what a real deployment needs instead.
        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "borrow",
          args: [
            BigInt(token.assetId),
            amount,
            BigInt(newCommitment),
            "0x",
            [BigInt(oldCommitment), BigInt(newCommitment), amount, 1n, BigInt(token.assetId)],
            "0x",
            [currentCollateralCommitment, BigInt(newCommitment), collateralPriceE8, debtPriceE8, BigInt(ltvBps)],
          ],
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      } else {
        // withdraw
        if (!positionTuple) throw new Error("No position found.");
        const hasDebt = positionTuple[6];
        if (hasDebt && (!collateralAsset || !collateralPrice || !debtPrice)) {
          throw new Error("Still loading solvency data — try again in a moment.");
        }
        const { oldCommitment, newCommitment, patch } = prepareWithdraw(address, token.assetId, amount);
        const debtCommitment = positionTuple[3];
        const ltvBps = collateralAsset ? (collateralAsset as { ltvBps: number }).ltvBps : 0;
        const collateralPriceE8 = collateralPrice ? (collateralPrice as readonly [bigint, bigint])[0] : 0n;
        const debtPriceE8 = debtPrice ? (debtPrice as readonly [bigint, bigint])[0] : 0n;

        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "withdrawCollateral",
          args: [
            amount,
            BigInt(newCommitment),
            "0x",
            [BigInt(oldCommitment), BigInt(newCommitment), amount, 0n, BigInt(token.assetId)],
            "0x",
            [BigInt(newCommitment), debtCommitment, collateralPriceE8, debtPriceE8, BigInt(ltvBps)],
          ],
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      }
      setStep("done");
    } catch (err) {
      setStep("error");
      setErrorMessage(humanizeError(err));
    }
  }

  const canBorrow =
    mode !== "borrow" ||
    (collateralAssetId !== undefined && Boolean(collateralAsset) && Boolean(collateralPrice) && Boolean(debtPrice));

  const availableLabel = mode === "withdraw" ? "Supplied" : mode === "repay" ? "Owed" : "Balance";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-28">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(10,9,7,0.6)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[440px] rounded-[20px] border border-line-strong bg-surface p-7 shadow-[0_32px_80px_rgba(0,0,0,0.55)]"
      >
        <div className="mb-6 flex items-center justify-between">
          <span className="font-display text-xl capitalize">
            {mode} {symbol}
          </span>
          <button onClick={onClose} className="text-ink-muted transition-colors hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Amount</span>
          {available !== undefined && (
            <span className="text-xs text-ink-faint">
              {availableLabel}: {formatUnits(available, token.decimals)}
            </span>
          )}
        </div>
        <div className="mb-6 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-4 py-3.5">
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value, token.decimals))}
            placeholder="0.00"
            className="w-full bg-transparent font-mono text-[22px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="font-mono text-sm text-ink-muted">{symbol}</span>
          {available !== undefined && available > 0n && (
            <button
              onClick={() => setAmountInput(formatUnits(available, token.decimals))}
              className="ml-2 rounded-md border border-line-strong px-2 py-1 text-[11px] font-semibold text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
            >
              Max
            </button>
          )}
        </div>

        {mode === "borrow" && !canBorrow && (
          <p className="mb-4 text-xs text-warning">Supply collateral in another asset first — this position has none yet.</p>
        )}
        {exceedsAvailable && (
          <p className="mb-4 text-xs text-warning">
            {mode === "withdraw"
              ? "You can't withdraw more than you've supplied."
              : mode === "repay"
                ? "You can't repay more than you owe (or hold in your wallet)."
                : "You don't have that much in your wallet."}
          </p>
        )}

        <AnimatePresence mode="wait">
          {step === "done" ? (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
              <p className="mb-3 text-sm text-success">Confirmed on-chain.</p>
              {txHash && (
                <div className="mb-4 flex items-center justify-center gap-2">
                  {explorerTxUrl(chainId, txHash) ? (
                    <a
                      href={explorerTxUrl(chainId, txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-xs text-gold underline decoration-gold/30 underline-offset-2 hover:decoration-gold"
                    >
                      {txHash.slice(0, 10)}···{txHash.slice(-8)}
                    </a>
                  ) : (
                    <span className="font-mono text-xs text-ink-faint">
                      {txHash.slice(0, 10)}···{txHash.slice(-8)}
                    </span>
                  )}
                  <button onClick={() => copy(txHash)} className="text-xs text-ink-faint transition-colors hover:text-ink">
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
              <button onClick={onClose} className="w-full rounded-[10px] border border-line-strong py-3.5 text-[15px] font-semibold">
                Close
              </button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <button
                onClick={handleConfirm}
                disabled={!address || amount === 0n || isPending || !canBorrow || exceedsAvailable}
                className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === "approving"
                  ? "Approving…"
                  : step === "submitting"
                    ? "Confirming…"
                    : `Confirm ${ACTION_LABEL[mode]} — sign a private proof`}
              </button>
              {errorMessage && <p className="mt-3 text-center text-xs text-danger">{errorMessage}</p>}
              <p className="mt-3 text-center text-[11.5px] text-ink-faint">
                Your position details are never broadcast in the clear.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
