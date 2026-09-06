"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId, useReadContract, useWriteContract } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { latensCDP, latensDollar, assetRegistry, priceOracle, erc20Abi, tokens, type TokenSymbol } from "@/lib/contracts";
import { useCDPPositionStore } from "@/lib/cdpPositionStore";
import { TokenIcon } from "./TokenIcon";
import { humanizeError } from "@/lib/errors";
import { explorerTxUrl } from "@/lib/chainExplorer";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";
import { sanitizeAmountInput } from "@/lib/amountInput";
import { usdValueE8 } from "@/lib/valuation";

export type CDPActionMode = "supply" | "withdraw" | "mint" | "burn";

const ACTION_LABEL: Record<CDPActionMode, string> = {
  supply: "supply",
  withdraw: "withdrawal",
  mint: "mint",
  burn: "burn",
};

const STABLECOIN_PRICE_E8 = 100_000_000n;

const APPROVE_GAS = 100_000n;
const CDP_CALL_GAS = 600_000n;

type CDPPositionTuple = readonly [bigint, bigint, bigint, bigint, boolean, boolean];

export function CDPActionModal({ symbol, mode, onClose }: { symbol: TokenSymbol; mode: CDPActionMode; onClose: () => void }) {
  const token = tokens[symbol];
  const [amountInput, setAmountInput] = useState("");
  const { address } = useAccount();
  const chainId = useChainId();
  const { get, prepareSupply, prepareWithdraw, prepareMint, prepareBurn, commit } = useCDPPositionStore();
  const { writeContractAsync, isPending } = useWriteContract();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"idle" | "approving" | "submitting" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const needsApprove = mode === "supply" || mode === "burn";
  const needsSolvencyContext = mode === "withdraw" || mode === "mint";
  const local = get(address, token.assetId);

  const { data: walletBalance } = useReadContract({
    address: mode === "burn" ? latensDollar.address : token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const { data: position } = useReadContract({
    address: latensCDP.address,
    abi: latensCDP.abi,
    functionName: "positions",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address) },
  });

  const positionTuple = position as CDPPositionTuple | undefined;
  const collateralAssetId = positionTuple ? Number(positionTuple[0]) : undefined;

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

  const amount = (() => {
    try {
      return amountInput ? parseUnits(amountInput, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();

  const walletBalanceValue = (walletBalance as bigint | undefined) ?? 0n;

  const mintMax = (() => {
    if (mode !== "mint" || !collateralAsset || !collateralPrice) return undefined;
    const ltvBps = (collateralAsset as { ltvBps: number }).ltvBps;
    const collateralPriceE8 = (collateralPrice as readonly [bigint, bigint])[0];
    const collateralValueE8 = usdValueE8(local.collateral, token.decimals, collateralPriceE8);
    const maxDebtValueE8 = (collateralValueE8 * BigInt(ltvBps)) / 10_000n;
    const currentDebtValueE8 = usdValueE8(local.debt, 18, STABLECOIN_PRICE_E8);
    const headroomValueE8 = maxDebtValueE8 > currentDebtValueE8 ? maxDebtValueE8 - currentDebtValueE8 : 0n;
    return (headroomValueE8 * 10n ** 18n) / STABLECOIN_PRICE_E8;
  })();

  const available = mode === "withdraw" ? local.collateral : mode === "burn" ? (local.debt < walletBalanceValue ? local.debt : walletBalanceValue) : mode === "supply" ? walletBalanceValue : mintMax;
  const exceedsAvailable = available !== undefined && amount > available;
  const canMint = mode !== "mint" || (collateralAssetId !== undefined && Boolean(collateralAsset) && Boolean(collateralPrice));

  async function handleConfirm() {
    if (!address || amount === 0n) return;
    setErrorMessage("");
    try {
      if (needsApprove) {
        setStep("approving");
        await writeContractAsync({
          address: mode === "burn" ? latensDollar.address : token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [latensCDP.address, amount],
          gas: APPROVE_GAS,
        });
      }

      setStep("submitting");

      if (mode === "supply") {
        const { oldCommitment, newCommitment, patch } = await prepareSupply(address, token.assetId, amount);
        const hash = await writeContractAsync({
          address: latensCDP.address,
          abi: latensCDP.abi,
          functionName: "supplyCollateral",
          args: [BigInt(token.assetId), amount, BigInt(newCommitment), "0x", [BigInt(oldCommitment), BigInt(newCommitment), amount, 1n, BigInt(token.assetId)]],
          gas: CDP_CALL_GAS,
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      } else if (mode === "burn") {
        const { oldCommitment, newCommitment, patch } = await prepareBurn(address, token.assetId, amount);
        const hash = await writeContractAsync({
          address: latensCDP.address,
          abi: latensCDP.abi,
          functionName: "burn",
          args: [amount, BigInt(newCommitment), "0x", [BigInt(oldCommitment), BigInt(newCommitment), amount, 0n, BigInt(token.assetId)]],
          gas: CDP_CALL_GAS,
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      } else if (mode === "mint") {
        if (collateralAssetId === undefined || !collateralAsset || !collateralPrice) {
          throw new Error("Supply collateral before minting.");
        }
        const { oldCommitment, newCommitment, patch } = await prepareMint(address, token.assetId, amount);
        const currentCollateralCommitment = positionTuple![1];
        const ltvBps = (collateralAsset as { ltvBps: number }).ltvBps;
        const collateralPriceE8 = (collateralPrice as readonly [bigint, bigint])[0];

        const hash = await writeContractAsync({
          address: latensCDP.address,
          abi: latensCDP.abi,
          functionName: "mint",
          args: [
            amount,
            BigInt(newCommitment),
            "0x",
            [BigInt(oldCommitment), BigInt(newCommitment), amount, 1n, BigInt(token.assetId)],
            "0x",
            [currentCollateralCommitment, BigInt(newCommitment), collateralPriceE8, STABLECOIN_PRICE_E8, BigInt(ltvBps)],
          ],
          gas: CDP_CALL_GAS,
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      } else {
        if (!positionTuple) throw new Error("No position found.");
        const hasDebt = positionTuple[5];
        if (hasDebt && (!collateralAsset || !collateralPrice)) {
          throw new Error("Still loading solvency data — try again in a moment.");
        }
        const { oldCommitment, newCommitment, patch } = await prepareWithdraw(address, token.assetId, amount);
        const debtCommitment = positionTuple[2];
        const ltvBps = collateralAsset ? (collateralAsset as { ltvBps: number }).ltvBps : 0;
        const collateralPriceE8 = collateralPrice ? (collateralPrice as readonly [bigint, bigint])[0] : 0n;

        const hash = await writeContractAsync({
          address: latensCDP.address,
          abi: latensCDP.abi,
          functionName: "withdrawCollateral",
          args: [
            amount,
            BigInt(newCommitment),
            "0x",
            [BigInt(oldCommitment), BigInt(newCommitment), amount, 0n, BigInt(token.assetId)],
            "0x",
            [BigInt(newCommitment), debtCommitment, collateralPriceE8, STABLECOIN_PRICE_E8, BigInt(ltvBps)],
          ],
          gas: CDP_CALL_GAS,
        });
        commit(address, token.assetId, patch);
        setTxHash(hash);
      }
      await queryClient.invalidateQueries();
      setStep("done");
    } catch (err) {
      setStep("error");
      setErrorMessage(humanizeError(err));
    }
  }

  const availableLabel = mode === "withdraw" ? "Supplied" : mode === "burn" ? "Owed" : mode === "mint" ? "Max" : "Balance";
  const displaySymbol = mode === "burn" ? "LATD" : symbol;
  const displayDecimals = mode === "burn" ? 18 : token.decimals;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-28">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-[rgba(10,9,7,0.6)]" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[440px] rounded-[20px] border border-line-strong bg-surface p-7 shadow-[0_32px_80px_rgba(0,0,0,0.55)]"
      >
        <div className="mb-6 flex items-center justify-between">
          <span className="font-display text-xl capitalize">{mode === "mint" || mode === "burn" ? `${mode} LATD against ${symbol}` : `${mode} ${symbol}`}</span>
          <button onClick={onClose} className="text-ink-muted transition-colors hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {!address ? (
          <div className="py-4 text-center">
            <p className="mb-4 text-sm text-ink-muted">Connect your wallet to continue.</p>
            <button onClick={onClose} className="w-full rounded-[10px] border border-line-strong py-3.5 text-[15px] font-semibold">
              Close
            </button>
          </div>
        ) : (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Amount</span>
              {available !== undefined && (
                <span className="text-xs text-ink-faint">
                  {availableLabel}: {formatUnits(available, displayDecimals)}
                  {available > 0n && (
                    <button onClick={() => setAmountInput(formatUnits(available, displayDecimals))} className="ml-1.5 font-semibold text-gold transition-colors hover:text-gold-strong">
                      Max
                    </button>
                  )}
                </span>
              )}
            </div>
            <div className="mb-6 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-4 py-3.5">
              <input
                value={amountInput}
                onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value, displayDecimals))}
                placeholder="0.00"
                className="w-full bg-transparent font-mono text-[22px] text-ink outline-none placeholder:text-ink-faint"
              />
              <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-canvas px-3 py-1.5">
                <TokenIcon symbol={displaySymbol} size={18} />
                <span className="font-mono text-sm text-ink-muted">{displaySymbol}</span>
              </div>
            </div>

            {mode === "mint" && !canMint && <p className="mb-4 text-xs text-warning">Supply {symbol} collateral first — this position has none yet.</p>}
            {exceedsAvailable && (
              <p className="mb-4 text-xs text-warning">
                {mode === "withdraw"
                  ? "You can't withdraw more than you've supplied."
                  : mode === "burn"
                    ? "You can't burn more than you owe (or hold in your wallet)."
                    : mode === "mint"
                      ? "That would push this position past its LTV limit."
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
                        <a href={explorerTxUrl(chainId, txHash)} target="_blank" rel="noopener noreferrer" className="font-mono text-xs text-gold underline decoration-gold/30 underline-offset-2 hover:decoration-gold">
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
                    disabled={!address || amount === 0n || isPending || !canMint || exceedsAvailable}
                    className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {step === "approving" ? "Approving…" : step === "submitting" ? "Confirming…" : `Confirm ${ACTION_LABEL[mode]} — sign a private proof`}
                  </button>
                  {errorMessage && <p className="mt-3 text-center text-xs text-danger">{errorMessage}</p>}
                  <p className="mt-3 text-center text-[11.5px] text-ink-faint">Your position details are never broadcast in the clear.</p>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </motion.div>
    </div>
  );
}
