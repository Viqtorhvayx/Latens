"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useChainId, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { waitForConfirmation } from "@/lib/waitForTx";
import { parseUnits, formatUnits } from "viem";
import { latensPool, assetRegistry, priceOracle, erc20Abi, tokens, tokenList, type TokenSymbol } from "@/lib/contracts";
import { usePositionStore, sharesToReal, RAY } from "@/lib/positionStore";
import { TokenIcon } from "./TokenIcon";
import { BorrowCollateralStep } from "./BorrowCollateralStep";
import { appendActivity } from "@/lib/activityStore";
import { humanizeError } from "@/lib/errors";
import { explorerTxUrl } from "@/lib/chainExplorer";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";
import { sanitizeAmountInput } from "@/lib/amountInput";
import { usdValueE8, formatUsd, formatRateRay } from "@/lib/valuation";
import { borrowCapacity } from "@/lib/borrow";
import { projectSupplyIndexRay } from "@/lib/supplyIndex";
import { recordPositionRole } from "@/lib/positionRole";
import { projectedRepayFee } from "@/lib/repayFee";
import { useSupplyRateRay } from "@/lib/useSupplyRateRay";
import { useViewingKey } from "@/lib/viewingKeyContext";
import { encryptNote } from "@/lib/viewingKey";
import { useFreshPrices } from "@/lib/useFreshPrices";
import { proveCommitmentUpdate, proveSolvency } from "@/lib/proving/client";

export type ActionMode = "supply" | "withdraw" | "borrow" | "repay";

const APPROVE_GAS = 100_000n;
const POOL_CALL_GAS = 600_000n;

const ACTION_LABEL: Record<ActionMode, string> = {
  supply: "supply",
  withdraw: "withdrawal",
  borrow: "borrow",
  repay: "repayment",
};

type PositionTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];

export function PositionActionModal({ symbol, mode, onClose }: { symbol: TokenSymbol; mode: ActionMode; onClose: () => void }) {
  const token = tokens[symbol];
  const [amountInput, setAmountInput] = useState("");
  const { address } = useAccount();
  const chainId = useChainId();
  const { get, prepareSupply, prepareWithdraw, prepareBorrow, prepareRepay, commit } = usePositionStore();
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const queryClient = useQueryClient();
  const { enabled: viewingKeyEnabled, ensure: ensureViewingKey } = useViewingKey();
  const ensureFreshPrices = useFreshPrices();
  const [step, setStep] = useState<"idle" | "approving" | "refreshingPrices" | "proving" | "submitting" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  // Ticked in an effect: the interest fee is a function of elapsed time, and reading the
  // wall clock during render is impure.
  const [nowSeconds, setNowSeconds] = useState<bigint | null>(null);
  useEffect(() => {
    const tick = () => setNowSeconds(BigInt(Math.floor(Date.now() / 1000)));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);
  const { copied, copy } = useCopyToClipboard();

  const needsApprove = mode === "supply" || mode === "repay";
  // repay now converts the fee across assets, so it needs the same collateral, price and
  // freshness context that the solvency-checked actions do.
  const needsSolvencyContext = mode === "borrow" || mode === "withdraw" || mode === "repay";
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
  const collateralAssetId = positionTuple?.[6] ? Number(positionTuple[0]) : undefined;
  const debtLastUpdated = positionTuple?.[5] ?? 0n;
  const debtTokenForSolvency = mode === "borrow" ? token : positionTuple?.[7] ? tokenList.find((t) => t.assetId === Number(positionTuple[1])) : undefined;

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

  const { data: tokenIndexRayRaw } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "currentSupplyIndexRay",
    args: [BigInt(token.assetId)],
    query: { enabled: mode === "supply" || mode === "withdraw" },
  });
  const tokenIndexRay = (tokenIndexRayRaw as bigint | undefined) ?? RAY;

  const { data: collateralIndexRayRaw } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "currentSupplyIndexRay",
    args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined,
    query: { enabled: (mode === "borrow" || mode === "repay") && collateralAssetId !== undefined },
  });
  const collateralIndexRayForBorrow = (collateralIndexRayRaw as bigint | undefined) ?? RAY;
  const collateralIndexRayForRepay = collateralIndexRayForBorrow;

  const supplyRateRay = useSupplyRateRay(token.assetId, mode === "supply");

  // A deposit claims shares against an index projected forward (lib/supplyIndex.ts), so it
  // stays valid while the real index keeps moving. A withdrawal deliberately uses the index
  // as read: the pool wants a burn to cover at least what the amount costs, and an index
  // that only grows means a value read now always does.
  const depositIndexRay = projectSupplyIndexRay(tokenIndexRay, supplyRateRay);

  const amount = (() => {
    try {
      return amountInput ? parseUnits(amountInput, token.decimals) : 0n;
    } catch {
      return 0n;
    }
  })();

  const { data: repayInterestFee } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "quoteRepayInterestFee",
    args: [BigInt(token.assetId), amount, debtLastUpdated],
    query: { enabled: mode === "repay" && Boolean(positionTuple) && amount > 0n },
  });
  const interestFee = mode === "repay" ? ((repayInterestFee as bigint | undefined) ?? 0n) : 0n;

  const walletBalance = (balance as bigint | undefined) ?? 0n;

  // The fee comes out of collateral now, so the wallet only ever has to cover the principal
  // and a borrower holding exactly what they drew can close the loan in one call. The fee is
  // still quoted a projection window ahead (lib/repayFee.ts), because the pool recomputes it
  // at mining time and takes the collateral burn as a floor.
  const { data: borrowRateBpsRaw } = useReadContract({
    address: assetRegistry.address,
    abi: assetRegistry.abi,
    functionName: "borrowRateBps",
    args: [BigInt(token.assetId)],
    query: { enabled: mode === "repay" },
  });
  const borrowRateBps = (borrowRateBpsRaw as bigint | undefined) ?? 0n;
  const debtElapsed = debtLastUpdated > 0n && nowSeconds !== null && nowSeconds > debtLastUpdated ? nowSeconds - debtLastUpdated : 0n;
  const projectedFee = mode === "repay" && amount > 0n ? projectedRepayFee(amount, borrowRateBps, debtElapsed) : 0n;
  const maxRepayable = mode === "repay" ? (local.borrowed < walletBalance ? local.borrowed : walletBalance) : 0n;
  const shortfallToClear = mode === "repay" && local.borrowed > walletBalance ? local.borrowed - walletBalance : 0n;

  const collateralLocal = collateralAssetId !== undefined ? get(address, collateralAssetId) : undefined;
  const collateralTokenForCap = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;
  const ltvBps = mode === "borrow" && collateralAsset ? (collateralAsset as { ltvBps: number }).ltvBps : undefined;
  const collateralRealAmountForBorrow = collateralLocal ? sharesToReal(collateralLocal.supplied, collateralIndexRayForBorrow) : undefined;
  const collateralValueE8 =
    mode === "borrow" && collateralRealAmountForBorrow !== undefined && collateralTokenForCap && collateralPrice
      ? usdValueE8(collateralRealAmountForBorrow, collateralTokenForCap.decimals, (collateralPrice as readonly [bigint, bigint])[0])
      : undefined;
  const borrowMax = (() => {
    if (mode !== "borrow" || collateralRealAmountForBorrow === undefined || collateralTokenForCap === undefined || ltvBps === undefined || !collateralPrice || !debtPrice) return undefined;
    return borrowCapacity({
      collateralAmount: collateralRealAmountForBorrow,
      collateralDecimals: collateralTokenForCap.decimals,
      collateralPriceE8: (collateralPrice as readonly [bigint, bigint])[0],
      ltvBps,
      existingDebt: local.borrowed,
      debtDecimals: token.decimals,
      debtPriceE8: (debtPrice as readonly [bigint, bigint])[0],
    });
  })();

  const available =
    mode === "withdraw"
      ? sharesToReal(local.supplied, tokenIndexRay)
      : mode === "repay"
        ? maxRepayable
        : mode === "supply"
          ? walletBalance
          : mode === "borrow"
            ? borrowMax
            : undefined;
  const exceedsAvailable = (available !== undefined && amount > available) || (mode === "repay" && amount + projectedFee > walletBalance);

  // Borrow has two ways in. If this position already has collateral with headroom — which
  // is what supplying gets you, since a supply IS the collateral — borrowing proceeds
  // directly. If it doesn't, borrowing isn't refused; it just gains a collateral step in
  // front of it, in this same modal. `collateralOverride` lets someone with headroom open
  // that step deliberately (to borrow more than their current limit allows).
  const hasActivePosition = Boolean(positionTuple?.[6]);
  const solvencyContextLoaded = hasActivePosition ? Boolean(collateralAsset) && Boolean(collateralPrice) && Boolean(debtPrice) : true;
  const borrowContextLoaded = mode === "borrow" && positionTuple !== undefined && solvencyContextLoaded;
  const [collateralOverride, setCollateralOverride] = useState(false);
  const showCollateralStep = mode === "borrow" && (collateralOverride || (borrowContextLoaded && (borrowMax === undefined || borrowMax === 0n)));

  function publishViewingNoteInBackground(assetId: number, isDebt: boolean, newAmount: bigint, newSalt: bigint) {
    if (!viewingKeyEnabled) return;
    (async () => {
      const keyPair = await ensureViewingKey();
      const ciphertext = encryptNote(keyPair, { amount: newAmount.toString(), salt: newSalt.toString() });
      await writeContractAsync({
        address: latensPool.address,
        abi: latensPool.abi,
        functionName: "publishViewingNote",
        args: [BigInt(assetId), isDebt, ciphertext],
        gas: POOL_CALL_GAS,
      });
    })().catch((err) => console.warn("Failed to publish viewing key note (non-fatal):", err));
  }

  async function handleConfirm() {
    if (!address || amount === 0n || !publicClient) return;
    setErrorMessage("");
    try {
      if (needsApprove) {
        setStep("approving");
        const approveHash = await writeContractAsync({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [latensPool.address, amount],
          gas: APPROVE_GAS,
        });
        await waitForConfirmation(publicClient, approveHash);
      }

      // borrow and withdraw are the two calls the pool checks solvency on, and solvency
      // reads the oracle — so both revert outright if the feed has aged past the staleness
      // window, whatever the position itself looks like. Re-stamp it first.
      if (needsSolvencyContext) {
        setStep("refreshingPrices");
        const collateralTokenAddress = collateralAsset ? (collateralAsset as { token: `0x${string}` }).token : undefined;
        await ensureFreshPrices([collateralTokenAddress, debtTokenForSolvency?.address]);
      }

      setStep("submitting");

      if (mode === "supply") {
        const supplyBefore = local;
        const { oldCommitment, newCommitment, shareDelta, patch } = await prepareSupply(address, token.assetId, amount, depositIndexRay);
        setStep("proving");
        const supplyProof = await proveCommitmentUpdate({
          oldAmount: supplyBefore.supplied,
          oldSalt: supplyBefore.suppliedSalt,
          newSalt: patch.suppliedSalt!,
          oldCommitment: BigInt(oldCommitment),
          newCommitment: BigInt(newCommitment),
          delta: shareDelta,
          isIncrease: true,
          assetId: BigInt(token.assetId),
        });
        setStep("submitting");
        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "supplyCollateral",
          args: [BigInt(token.assetId), amount, BigInt(newCommitment), supplyProof.proof, supplyProof.publicInputs],
          gas: POOL_CALL_GAS,
        });
        await waitForConfirmation(publicClient, hash);
        commit(address, token.assetId, patch);
        // Came in through Supply, so this is a lender. The balance is identical either way;
        // the role is only about how the position was opened. See lib/positionRole.ts.
        recordPositionRole(address, token.assetId, "lender");
        appendActivity(address, { kind: "collateral", isIncrease: true, assetId: token.assetId, amount, transactionHash: hash });
        publishViewingNoteInBackground(token.assetId, false, patch.supplied!, patch.suppliedSalt!);
        setTxHash(hash);
      } else if (mode === "repay") {
        if (collateralAssetId === undefined || !collateralAsset || !collateralPrice || !debtPrice || !collateralTokenForCap) {
          throw new Error("Still loading this position's collateral. Try again in a moment.");
        }
        const { oldCommitment, newCommitment, patch } = await prepareRepay(address, token.assetId, amount);

        // The pool takes the interest out of collateral now, not out of the borrowed asset,
        // so a repayment carries a second commitment update burning that much collateral.
        // Quoted a window ahead and converted at current prices: the pool takes the burn as
        // a floor, so erring high costs the borrower dust while erring low reverts.
        const feeInDebt = projectedRepayFee(amount, borrowRateBps, debtElapsed);
        const feeValueE8 = usdValueE8(feeInDebt, token.decimals, (debtPrice as readonly [bigint, bigint])[0]);
        const feeInCollateral =
          (feeValueE8 * 10n ** BigInt(collateralTokenForCap.decimals)) / (collateralPrice as readonly [bigint, bigint])[0];

        // Clamped to what this position's collateral actually holds. prepareWithdraw throws
        // rather than returns when asked to burn more shares than exist, and an uncaught
        // throw here means the repay transaction is never even offered to the wallet — the
        // failure looks like the button doing nothing at all. The pool locks collateral
        // while a debt is open precisely so this clamp is never the binding constraint, but
        // a position left over from before that rule can still be short.
        const debtBefore = local;
        const collateralBefore = get(address, collateralAssetId);
        const feeShares = (feeInCollateral * RAY) / collateralIndexRayForRepay;
        const burnShares = feeShares < collateralBefore.supplied ? feeShares : collateralBefore.supplied;
        const burnAmount = (burnShares * collateralIndexRayForRepay) / RAY;
        const collateralUpdate = await prepareWithdraw(address, collateralAssetId, burnAmount, collateralIndexRayForRepay);

        setStep("proving");
        const debtProof = await proveCommitmentUpdate({
          oldAmount: debtBefore.borrowed,
          oldSalt: debtBefore.borrowedSalt,
          newSalt: patch.borrowedSalt!,
          oldCommitment: BigInt(oldCommitment),
          newCommitment: BigInt(newCommitment),
          delta: amount,
          isIncrease: false,
          assetId: BigInt(token.assetId),
        });
        const collateralProof = await proveCommitmentUpdate({
          oldAmount: collateralBefore.supplied,
          oldSalt: collateralBefore.suppliedSalt,
          newSalt: collateralUpdate.patch.suppliedSalt!,
          oldCommitment: BigInt(collateralUpdate.oldCommitment),
          newCommitment: BigInt(collateralUpdate.newCommitment),
          delta: collateralUpdate.shareDelta,
          isIncrease: false,
          assetId: BigInt(collateralAssetId),
        });
        setStep("submitting");

        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "repay",
          args: [
            amount,
            BigInt(newCommitment),
            debtProof.proof,
            debtProof.publicInputs,
            BigInt(collateralUpdate.newCommitment),
            collateralProof.proof,
            collateralProof.publicInputs,
            // Clearing the flag is what unlocks the collateral again, so it has to be set
            // exactly when this repayment leaves nothing owed.
            amount >= local.borrowed,
          ],
          gas: POOL_CALL_GAS,
        });
        await waitForConfirmation(publicClient, hash);
        commit(address, token.assetId, patch);
        commit(address, collateralAssetId, collateralUpdate.patch);
        appendActivity(address, { kind: "debt", isIncrease: false, assetId: token.assetId, amount, transactionHash: hash });
        publishViewingNoteInBackground(token.assetId, true, patch.borrowed!, patch.borrowedSalt!);
        setTxHash(hash);
      } else if (mode === "borrow") {
        if (collateralAssetId === undefined || !collateralAsset || !collateralPrice || !debtPrice || !collateralLocal) {
          throw new Error("Supply collateral before borrowing.");
        }
        const debtBefore = local;
        const { oldCommitment, newCommitment, shareDelta, patch } = await prepareBorrow(address, token.assetId, amount);
        const currentCollateralCommitment = positionTuple![2];
        const ltvBps = (collateralAsset as { ltvBps: number }).ltvBps;
        const collateralPriceE8 = (collateralPrice as readonly [bigint, bigint])[0];
        const debtPriceE8 = (debtPrice as readonly [bigint, bigint])[0];

        setStep("proving");
        const debtProof = await proveCommitmentUpdate({
          oldAmount: debtBefore.borrowed,
          oldSalt: debtBefore.borrowedSalt,
          newSalt: patch.borrowedSalt!,
          oldCommitment: BigInt(oldCommitment),
          newCommitment: BigInt(newCommitment),
          delta: shareDelta,
          isIncrease: true,
          assetId: BigInt(token.assetId),
        });
        const solvencyProof = await proveSolvency({
          collateralAmount: collateralLocal.supplied,
          collateralSalt: collateralLocal.suppliedSalt,
          debtAmount: patch.borrowed!,
          debtSalt: patch.borrowedSalt!,
          collateralCommitment: BigInt(currentCollateralCommitment),
          debtCommitment: BigInt(newCommitment),
          collateralPriceE8,
          debtPriceE8,
          collateralIndexRay: collateralIndexRayForBorrow,
          debtIndexRay: RAY,
          thresholdBps: BigInt(ltvBps),
        });
        setStep("submitting");

        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "borrow",
          args: [
            BigInt(token.assetId),
            amount,
            BigInt(newCommitment),
            debtProof.proof,
            debtProof.publicInputs,
            solvencyProof.proof,
            solvencyProof.publicInputs,
          ],
          gas: POOL_CALL_GAS,
        });
        await waitForConfirmation(publicClient, hash);
        commit(address, token.assetId, patch);
        appendActivity(address, { kind: "debt", isIncrease: true, assetId: token.assetId, amount, transactionHash: hash });
        publishViewingNoteInBackground(token.assetId, true, patch.borrowed!, patch.borrowedSalt!);
        setTxHash(hash);
      } else {
        if (!positionTuple) throw new Error("No position found.");
        // LatensPool refuses any withdrawal outright while hasDebt is set (repay first) — by
        // the time a withdrawal could reach the pool's own solvency check, hasDebt is
        // guaranteed false, which makes that check permanently unreachable. So this only
        // ever proves the collateral commitment update; the solvency proof arg is vestigial
        // and passed empty, matching what the pool actually verifies.
        const withdrawBefore = local;
        const { oldCommitment, newCommitment, shareDelta, patch } = await prepareWithdraw(address, token.assetId, amount, tokenIndexRay);

        setStep("proving");
        const withdrawProof = await proveCommitmentUpdate({
          oldAmount: withdrawBefore.supplied,
          oldSalt: withdrawBefore.suppliedSalt,
          newSalt: patch.suppliedSalt!,
          oldCommitment: BigInt(oldCommitment),
          newCommitment: BigInt(newCommitment),
          delta: shareDelta,
          isIncrease: false,
          assetId: BigInt(token.assetId),
        });
        setStep("submitting");

        const hash = await writeContractAsync({
          address: latensPool.address,
          abi: latensPool.abi,
          functionName: "withdrawCollateral",
          args: [amount, BigInt(newCommitment), withdrawProof.proof, withdrawProof.publicInputs, "0x", []],
          gas: POOL_CALL_GAS,
        });
        await waitForConfirmation(publicClient, hash);
        commit(address, token.assetId, patch);
        appendActivity(address, { kind: "collateral", isIncrease: false, assetId: token.assetId, amount, transactionHash: hash });
        publishViewingNoteInBackground(token.assetId, false, patch.supplied!, patch.suppliedSalt!);
        setTxHash(hash);
      }
      await queryClient.invalidateQueries();
      setStep("done");
    } catch (err) {
      setStep("error");
      setErrorMessage(humanizeError(err));
    }
  }

  const canBorrow = mode !== "borrow" || (collateralAssetId !== undefined && Boolean(collateralAsset) && Boolean(collateralPrice) && Boolean(debtPrice));

  const availableLabel = mode === "withdraw" ? "Supplied" : mode === "repay" ? "Owed" : mode === "borrow" ? "Available to borrow" : "Balance";

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
          <span className="font-display text-xl capitalize">
            {showCollateralStep ? "Add collateral" : `${mode} ${symbol}`}
          </span>
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
        ) : showCollateralStep ? (
          <BorrowCollateralStep
            fixedSymbol={hasActivePosition ? (collateralTokenForCap?.symbol as TokenSymbol | undefined) : undefined}
            excludeSymbol={symbol}
            onDeposited={() => setCollateralOverride(false)}
          />
        ) : (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Amount</span>
              {available !== undefined && (
                <span className="text-xs text-ink-faint">
                  {availableLabel}: {formatUnits(available, token.decimals)}
                  {available > 0n && (
                    <button onClick={() => setAmountInput(formatUnits(available, token.decimals))} className="ml-1.5 font-semibold text-gold transition-colors hover:text-gold-strong">
                      Max
                    </button>
                  )}
                </span>
              )}
            </div>
            <div className="mb-6 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-5 py-5">
              <input
                value={amountInput}
                onChange={(e) => setAmountInput(sanitizeAmountInput(e.target.value, token.decimals))}
                placeholder="0.00"
                className="w-full bg-transparent font-mono text-[28px] text-ink outline-none placeholder:text-ink-faint"
              />
              <div className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-canvas px-4 py-2">
                <TokenIcon symbol={symbol} size={22} />
                <span className="font-mono text-base text-ink-muted">{symbol}</span>
              </div>
            </div>

            {mode === "supply" && (
              <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-4 py-3">
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Supply APY</div>
                  <div className="font-mono text-sm text-success">{formatRateRay(supplyRateRay)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Also becomes</div>
                  <div className="text-sm text-ink">Your collateral</div>
                </div>
              </div>
            )}
            {mode === "borrow" && canBorrow && collateralTokenForCap && ltvBps !== undefined && collateralRealAmountForBorrow !== undefined && (
              <div className="mb-4 flex items-center justify-between rounded-xl border border-line bg-canvas-raised px-4 py-3">
                <div>
                  <div className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Backed by</div>
                  <div className="text-sm text-ink">
                    {formatUnits(collateralRealAmountForBorrow, collateralTokenForCap.decimals)} {collateralTokenForCap.symbol}
                    {collateralValueE8 !== undefined && <span className="text-ink-faint"> ({formatUsd(collateralValueE8)})</span>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-semibold tracking-wide text-ink-faint uppercase">Max LTV</div>
                  <div className="font-mono text-sm text-gold">{(ltvBps / 100).toFixed(0)}%</div>
                </div>
              </div>
            )}

            {mode === "repay" && interestFee > 0n && (
              <p className="mb-4 text-xs text-ink-faint">
                Only the {symbol} above leaves your wallet. The {formatUnits(interestFee, token.decimals)} {symbol} of interest owed on it comes out of your
                {collateralTokenForCap ? ` ${collateralTokenForCap.symbol}` : ""} collateral instead, so repaying what you borrowed clears the loan.
              </p>
            )}
            {mode === "repay" && shortfallToClear > 0n && (
              <p className="mb-4 text-xs text-ink-faint">
                You hold {formatUnits(shortfallToClear, token.decimals)} {symbol} less than you owe. Max repays what your balance covers; top up from the {symbol} faucet in the Markets row to clear the rest.
              </p>
            )}
            {exceedsAvailable && (
              <p className="mb-4 text-xs text-warning">
                {mode === "withdraw"
                  ? "You can't withdraw more than you've supplied."
                  : mode === "repay"
                    ? "You can't repay more than you owe (or hold in your wallet)."
                    : mode === "borrow"
                      ? "That would push this position past its LTV limit."
                      : "You don't have that much in your wallet."}
              </p>
            )}
            {mode === "borrow" && exceedsAvailable && (
              <button onClick={() => setCollateralOverride(true)} className="mb-4 w-full rounded-[10px] border border-line-strong py-2.5 text-[13px] font-semibold transition-colors hover:bg-surface-hover">
                Add collateral to raise the limit
              </button>
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
                    disabled={!address || amount === 0n || isPending || !canBorrow || exceedsAvailable}
                    className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {step === "approving"
                      ? "Approving…"
                      : step === "refreshingPrices"
                        ? "Refreshing price feed…"
                        : step === "proving"
                          ? "Generating proof…"
                          : step === "submitting"
                            ? "Confirming…"
                            : `Confirm ${ACTION_LABEL[mode]}, sign a private proof`}
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
