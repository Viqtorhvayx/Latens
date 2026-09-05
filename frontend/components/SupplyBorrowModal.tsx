"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { latensPool, assetRegistry, priceOracle, erc20Abi, tokens, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore } from "@/lib/positionStore";

type Mode = "supply" | "borrow";

// viem decodes a named-struct return (DataTypes.Position) as an object keyed
// by field name, not a positional tuple/array.
type PositionStruct = {
  collateralAssetId: bigint;
  debtAssetId: bigint;
  collateralCommitment: bigint;
  debtCommitment: bigint;
  lastUpdated: number;
  active: boolean;
  hasDebt: boolean;
};

export function SupplyBorrowModal({
  symbol,
  mode,
  onClose,
}: {
  symbol: TokenSymbol;
  mode: Mode;
  onClose: () => void;
}) {
  const token = tokens[symbol];
  const [amountInput, setAmountInput] = useState("");
  const { address } = useAccount();
  const { applySupply, applyBorrow } = usePositionStore();
  const { writeContractAsync, isPending } = useWriteContract();
  const [step, setStep] = useState<"idle" | "approving" | "submitting" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

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
    query: { enabled: Boolean(address) && mode === "borrow" },
  });

  const collateralAssetId = position ? Number((position as PositionStruct).collateralAssetId) : undefined;
  const collateralToken = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;

  const { data: collateralAsset } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "getAsset",
    args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined,
    query: { enabled: mode === "borrow" && collateralAssetId !== undefined },
  });

  const { data: collateralPrice } = useReadContract({
    address: priceOracle.address,
    abi: priceOracle.abi,
    functionName: "getPrice",
    args: collateralToken ? [collateralToken.address] : undefined,
    query: { enabled: mode === "borrow" && Boolean(collateralToken) },
  });

  const { data: debtPrice } = useReadContract({
    address: priceOracle.address,
    abi: priceOracle.abi,
    functionName: "getPrice",
    args: [token.address],
    query: { enabled: mode === "borrow" },
  });

  const amount = (() => {
    try {
      return amountInput ? parseUnits(amountInput, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();

  async function handleConfirm() {
    if (!address || amount === 0n) return;
    setErrorMessage("");
    try {
      setStep("approving");
      await writeContractAsync({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [latensPool.address, amount],
      });

      setStep("submitting");
      if (mode === "supply") {
        const { oldCommitment, newCommitment } = applySupply(address, token.assetId, amount);
        await writeContractAsync({
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
      } else {
        if (collateralAssetId === undefined || !collateralAsset || !collateralPrice || !debtPrice) {
          throw new Error("Supply collateral before borrowing.");
        }
        const { oldCommitment, newCommitment } = applyBorrow(address, token.assetId, amount);
        const positionStruct = position as PositionStruct;
        const currentCollateralCommitment = positionStruct.collateralCommitment;
        const ltvBps = (collateralAsset as { ltvBps: number }).ltvBps;
        const collateralPriceE8 = (collateralPrice as readonly [bigint, bigint])[0];
        const debtPriceE8 = (debtPrice as readonly [bigint, bigint])[0];

        // Dev-only note: this deployment wires MockVerifier (script/deployLocal.js), which
        // accepts any proof — but LatensPool's OWN binding checks are real and still
        // enforced, which is why the values below must genuinely match on-chain state
        // rather than being placeholders. There is no real zk solvency proof behind this
        // "0x" — see contracts/README.md for what a real deployment needs instead.
        await writeContractAsync({
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
      }
      setStep("done");
    } catch (err) {
      setStep("error");
      setErrorMessage(err instanceof Error ? err.message : "Transaction failed");
    }
  }

  const canBorrow =
    mode === "supply" ||
    (collateralAssetId !== undefined && Boolean(collateralAsset) && Boolean(collateralPrice) && Boolean(debtPrice));

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
          {balance !== undefined && (
            <span className="text-xs text-ink-faint">Balance: {formatUnits(balance as bigint, token.decimals)}</span>
          )}
        </div>
        <div className="mb-6 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-4 py-3.5">
          <input
            value={amountInput}
            onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder="0.00"
            className="w-full bg-transparent font-mono text-[22px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="font-mono text-sm text-ink-muted">{symbol}</span>
        </div>

        {mode === "borrow" && !canBorrow && (
          <p className="mb-4 text-xs text-warning">Supply collateral in another asset first — this position has none yet.</p>
        )}

        <AnimatePresence mode="wait">
          {step === "done" ? (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center">
              <p className="mb-4 text-sm text-success">Confirmed on-chain.</p>
              <button onClick={onClose} className="w-full rounded-[10px] border border-line-strong py-3.5 text-[15px] font-semibold">
                Close
              </button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <button
                onClick={handleConfirm}
                disabled={!address || amount === 0n || isPending || !canBorrow}
                className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {step === "approving"
                  ? "Approving…"
                  : step === "submitting"
                    ? "Confirming…"
                    : `Confirm ${mode} — sign a private proof`}
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
