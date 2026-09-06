"use client";

import { useEffect, useState } from "react";
import { useAccount, useChainId, useReadContract, useReadContracts, useWriteContract } from "wagmi";
import { formatUnits, recoverMessageAddress, isAddress } from "viem";
import { latensPool, assetRegistry, priceOracle, erc20Abi, tokenList } from "@/lib/contracts";
import { buildDisclosureMessage, recomputeCommitment, type Disclosure, type DisclosureEntry } from "@/lib/disclosure";
import { commitment, randomSalt, sharesToReal, RAY } from "@/lib/positionStore";
import { isInsolvent, maxSeizableCollateral } from "@/lib/liquidation";
import { humanizeError } from "@/lib/errors";
import { explorerTxUrl } from "@/lib/chainExplorer";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

const APPROVE_GAS = 100_000n;
const LIQUIDATE_GAS = 700_000n;

// Why this page needs a pasted disclosure file, not just a target address: liquidation is
// the one place a confidential position's privacy genuinely has to give way (see
// ILiquidationVerifier's own NatSpec — "the hardest of the three [proofs]"). An independent
// keeper who has never seen a position's real amounts has no way to construct a valid
// post-liquidation commitment for it; there is no public data that reveals collateral/debt
// amounts. In this scaffold, the only honest way to demo the mechanism is with the exact
// artifact already built for viewing keys — a signed disclosure the position owner (or an
// insolvency-monitoring service they've shared one with) exported. That's not a shortcut;
// it's the actual shape of the open problem this interface's own docs name.
// [collateralAssetId, debtAssetId, collateralCommitment, debtCommitment, lastUpdated, debtLastUpdated, active, hasDebt]
type PositionTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];
type AssetStruct = {
  token: `0x${string}`;
  isSupported: boolean;
  ltvBps: number;
  liquidationThresholdBps: number;
  liquidationBonusBps: number;
  reserveFactorBps: number;
  totalSupplied: bigint;
  totalBorrowed: bigint;
};
type PriceTuple = readonly [bigint, bigint];

export default function LiquidatePage() {
  const { address } = useAccount();
  const chainId = useChainId();
  const { writeContractAsync, isPending } = useWriteContract();
  const { copied, copy } = useCopyToClipboard();

  const [rawInput, setRawInput] = useState("");
  const [parseError, setParseError] = useState("");
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [signatureValid, setSignatureValid] = useState<boolean | null>(null);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const target = disclosure && isAddress(disclosure.address) ? disclosure.address : undefined;

  const { data: position } = useReadContract({
    address: latensPool.address,
    abi: latensPool.abi,
    functionName: "positions",
    args: target ? [target] : undefined,
    query: { enabled: Boolean(target) },
  });
  const positionTuple = position as PositionTuple | undefined;
  const collateralAssetId = positionTuple ? Number(positionTuple[0]) : undefined;
  const debtAssetId = positionTuple?.[7] ? Number(positionTuple[1]) : undefined;
  const collateralToken = collateralAssetId !== undefined ? tokenList.find((t) => t.assetId === collateralAssetId) : undefined;
  const debtToken = debtAssetId !== undefined ? tokenList.find((t) => t.assetId === debtAssetId) : undefined;

  const { data: reads } = useReadContracts({
    contracts: [
      { address: assetRegistry.address, abi: assetRegistry.abi, functionName: "getAsset", args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined },
      { address: priceOracle.address, abi: priceOracle.abi, functionName: "getPrice", args: collateralToken ? [collateralToken.address] : undefined },
      { address: priceOracle.address, abi: priceOracle.abi, functionName: "getPrice", args: debtToken ? [debtToken.address] : undefined },
      { address: assetRegistry.address, abi: assetRegistry.abi, functionName: "currentSupplyIndexRay", args: collateralAssetId !== undefined ? [BigInt(collateralAssetId)] : undefined },
    ],
    query: { enabled: collateralAssetId !== undefined && debtAssetId !== undefined },
  });
  const collateralAsset = reads?.[0]?.result as AssetStruct | undefined;
  const collateralPrice = reads?.[1]?.result as PriceTuple | undefined;
  const debtPrice = reads?.[2]?.result as PriceTuple | undefined;
  const collateralIndexRay = (reads?.[3]?.result as bigint | undefined) ?? RAY;

  async function handleCheck() {
    setParseError("");
    setDisclosure(null);
    setSignatureValid(null);
    setTxHash(null);
    setErrorMessage("");
    let parsed: Disclosure;
    try {
      parsed = JSON.parse(rawInput);
    } catch {
      setParseError("That isn't valid JSON.");
      return;
    }
    if (!parsed.address || !parsed.signature || !Array.isArray(parsed.entries)) {
      setParseError("Missing address, signature, or entries — this doesn't look like a Latens disclosure file.");
      return;
    }
    try {
      const { version, chainId: dChainId, pool, address: addr, issuedAt, entries } = parsed;
      const recovered = await recoverMessageAddress({
        message: buildDisclosureMessage({ version, chainId: dChainId, pool, address: addr, issuedAt, entries }),
        signature: parsed.signature,
      });
      setSignatureValid(recovered.toLowerCase() === parsed.address.toLowerCase());
    } catch {
      setSignatureValid(false);
    }
    setDisclosure(parsed);
  }

  const collateralEntry: DisclosureEntry | undefined = disclosure?.entries.find((e) => e.kind === "collateral");
  const debtEntry: DisclosureEntry | undefined = disclosure?.entries.find((e) => e.kind === "debt");

  // recomputeCommitment() now calls a real (WASM-backed) Pedersen hash, so the
  // self-consistency half of this check can't be a plain synchronous expression anymore —
  // computed once per (collateralEntry, debtEntry) pair and cached, rather than re-hashing
  // on every render the way the old synchronous keccak256 placeholder implicitly did.
  const [entriesSelfConsistent, setEntriesSelfConsistent] = useState(false);
  useEffect(() => {
    let cancelled = false;
    async function compute() {
      if (!collateralEntry || !debtEntry) {
        if (!cancelled) setEntriesSelfConsistent(false);
        return;
      }
      const [collateralOk, debtOk] = await Promise.all([recomputeCommitment(collateralEntry), recomputeCommitment(debtEntry)]);
      if (!cancelled) setEntriesSelfConsistent(collateralOk === collateralEntry.commitment && debtOk === debtEntry.commitment);
    }
    compute();
    return () => {
      cancelled = true;
    };
  }, [collateralEntry, debtEntry]);

  const entriesMatchChain =
    Boolean(positionTuple) &&
    Boolean(collateralEntry) &&
    Boolean(debtEntry) &&
    positionTuple![7] && // hasDebt
    Number(positionTuple![0]) === collateralEntry!.assetId &&
    Number(positionTuple![1]) === debtEntry!.assetId &&
    positionTuple![2] === BigInt(collateralEntry!.commitment) &&
    positionTuple![3] === BigInt(debtEntry!.commitment) &&
    entriesSelfConsistent;

  const collateralRealAmount = collateralEntry ? sharesToReal(BigInt(collateralEntry.amount), collateralIndexRay) : 0n;

  const eligible =
    entriesMatchChain && collateralAsset && collateralPrice && debtPrice && collateralToken && debtToken
      ? isInsolvent(collateralRealAmount, collateralToken.decimals, collateralPrice[0], BigInt(debtEntry!.amount), debtToken.decimals, debtPrice[0], collateralAsset.liquidationThresholdBps)
      : undefined;

  const repayAmount = debtEntry ? BigInt(debtEntry.amount) : 0n; // full liquidation only, in this pass
  const seizeAmount =
    eligible && collateralAsset && collateralPrice && debtPrice && collateralToken && debtToken
      ? maxSeizableCollateral(repayAmount, debtToken.decimals, debtPrice[0], collateralRealAmount, collateralToken.decimals, collateralPrice[0], collateralAsset.liquidationBonusBps)
      : 0n;

  async function handleLiquidate() {
    if (!target || !collateralEntry || !debtEntry || !collateralToken || !debtToken || !collateralAsset || !collateralPrice || !debtPrice) return;
    setSubmitting(true);
    setErrorMessage("");
    try {
      const seizedShares = (seizeAmount * RAY) / collateralIndexRay;
      const newCollateralShares = BigInt(collateralEntry.amount) - seizedShares;
      const newDebtAmount = BigInt(debtEntry.amount) - repayAmount;
      const newCollateralCommitment = await commitment(newCollateralShares, randomSalt());
      const newDebtCommitment = await commitment(newDebtAmount, randomSalt());

      await writeContractAsync({
        address: debtToken.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [latensPool.address, repayAmount],
        gas: APPROVE_GAS,
      });

      const hash = await writeContractAsync({
        address: latensPool.address,
        abi: latensPool.abi,
        functionName: "liquidate",
        args: [
          target,
          repayAmount,
          seizeAmount,
          BigInt(newCollateralCommitment),
          BigInt(newDebtCommitment),
          "0x",
          [
            BigInt(collateralEntry.commitment),
            BigInt(debtEntry.commitment),
            BigInt(newCollateralCommitment),
            BigInt(newDebtCommitment),
            collateralPrice[0],
            debtPrice[0],
            collateralIndexRay,
            RAY,
            BigInt(collateralAsset.liquidationThresholdBps),
            BigInt(collateralAsset.liquidationBonusBps),
            seizeAmount,
            repayAmount,
          ],
        ],
        gas: LIQUIDATE_GAS,
      });
      setTxHash(hash);
    } catch (err) {
      setErrorMessage(humanizeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-8 max-w-[640px]">
        <span className="font-display text-[28px]">Liquidate</span>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
          Paste a position&apos;s disclosure file to check eligibility and liquidate it if it&apos;s genuinely insolvent. This isn&apos;t a shortcut — an independent keeper has no way to see a confidential
          position&apos;s real amounts otherwise, which is exactly why this is the one place privacy has to give way.
        </p>
      </div>

      <div className="flex flex-col gap-5 md:flex-row">
        <div className="flex-1">
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="Paste the target position's disclosure JSON here…"
            rows={12}
            className="w-full rounded-xl border border-line bg-canvas-raised p-4 font-mono text-xs text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={handleCheck}
            disabled={!rawInput.trim()}
            className="mt-4 rounded-[10px] bg-gold px-6 py-3 text-sm font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Check eligibility
          </button>
          {parseError && <p className="mt-3 text-xs text-danger">{parseError}</p>}
        </div>

        {disclosure && (
          <div className="flex-1 rounded-2xl border border-line bg-surface p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-xs text-ink-faint">{disclosure.address}</span>
              <span className={`text-xs font-semibold ${signatureValid ? "text-ink-muted" : "text-danger"}`}>{signatureValid ? "Signature valid" : "Signature invalid"}</span>
            </div>

            {!entriesMatchChain ? (
              <p className="text-sm text-warning">
                This file doesn&apos;t match the target&apos;s live on-chain position — it may be stale, incomplete (needs both a collateral and a debt entry), or for a different deployment.
              </p>
            ) : eligible === undefined ? (
              <p className="text-sm text-ink-faint">Reading live prices…</p>
            ) : !eligible ? (
              <p className="text-sm text-success">This position is currently healthy — not eligible for liquidation.</p>
            ) : (
              <>
                <p className="mb-4 text-sm text-danger">Insolvent. Eligible for liquidation.</p>
                <div className="mb-4 flex flex-col gap-2.5 rounded-xl border border-line bg-canvas-raised p-4 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Repay</span>
                    <span className="font-mono">
                      {formatUnits(repayAmount, debtToken!.decimals)} {debtToken!.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-muted">Seize</span>
                    <span className="font-mono">
                      {formatUnits(seizeAmount, collateralToken!.decimals)} {collateralToken!.symbol}
                    </span>
                  </div>
                </div>

                {txHash ? (
                  <div className="text-center">
                    <p className="mb-3 text-sm text-success">Liquidated on-chain.</p>
                    <div className="mb-2 flex items-center justify-center gap-2">
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
                  </div>
                ) : (
                  <button
                    onClick={handleLiquidate}
                    disabled={!address || submitting || isPending}
                    className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {!address ? "Connect your wallet to continue" : submitting || isPending ? "Confirming…" : "Liquidate"}
                  </button>
                )}
                {errorMessage && <p className="mt-3 text-center text-xs text-danger">{errorMessage}</p>}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
