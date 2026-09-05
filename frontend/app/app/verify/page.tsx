"use client";

import { useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import { recoverMessageAddress, formatUnits, isAddress } from "viem";
import { latensPool, tokenList } from "@/lib/contracts";
import { hardhatLocal } from "@/lib/wagmi";
import { buildDisclosureMessage, recomputeCommitment, type Disclosure } from "@/lib/disclosure";

// LatensPool.positions() is Solidity's auto-generated struct-mapping getter, which
// flattens Position into 7 separate top-level outputs — viem decodes this as a
// positional array, not a named object (see markets/page.tsx for the full explanation).
// [collateralAssetId, debtAssetId, collateralCommitment, debtCommitment, lastUpdated, active, hasDebt]
type PositionTuple = readonly [bigint, bigint, bigint, bigint, number, boolean, boolean];

type EntryResult = {
  label: string;
  amountDisplay: string;
  selfConsistent: boolean;
  onChainMatch: boolean;
  reason?: string;
};

export default function VerifyPage() {
  const [rawInput, setRawInput] = useState("");
  const [parseError, setParseError] = useState("");
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null);
  const [signatureValid, setSignatureValid] = useState<boolean | null>(null);

  const { data: position } = useReadContract({
    address: latensPool.address,
    abi: latensPool.abi,
    functionName: "positions",
    args: disclosure && isAddress(disclosure.address) ? [disclosure.address] : undefined,
    query: { enabled: Boolean(disclosure && isAddress(disclosure.address)) },
  });
  const positionTuple = position as PositionTuple | undefined;

  async function handleVerify() {
    setParseError("");
    setDisclosure(null);
    setSignatureValid(null);
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
      const { version, chainId, pool, address, issuedAt, entries } = parsed;
      const message = buildDisclosureMessage({ version, chainId, pool, address, issuedAt, entries });
      const recovered = await recoverMessageAddress({ message, signature: parsed.signature });
      setSignatureValid(recovered.toLowerCase() === parsed.address.toLowerCase());
    } catch {
      setSignatureValid(false);
    }
    setDisclosure(parsed);
  }

  const networkWarning = useMemo(() => {
    if (!disclosure) return null;
    if (disclosure.chainId !== hardhatLocal.id) return `Disclosure was issued for chain ${disclosure.chainId}, not the network this page is checking against.`;
    if (disclosure.pool.toLowerCase() !== latensPool.address.toLowerCase()) return "Disclosure names a different LatensPool deployment than this page is checking against.";
    return null;
  }, [disclosure]);

  const entryResults: EntryResult[] = useMemo(() => {
    if (!disclosure) return [];
    return disclosure.entries.map((entry) => {
      const token = tokenList.find((t) => t.assetId === entry.assetId);
      const label = `${entry.kind} — ${entry.symbol}`;
      const amountDisplay = token ? formatUnits(BigInt(entry.amount), token.decimals) : entry.amount;
      const selfConsistent = recomputeCommitment(entry) === entry.commitment;

      if (!positionTuple) return { label, amountDisplay, selfConsistent, onChainMatch: false, reason: "Reading live position…" };

      const claimed = BigInt(entry.commitment);
      let onChainMatch = false;
      let reason: string | undefined;
      if (entry.kind === "collateral") {
        onChainMatch = Number(positionTuple[0]) === entry.assetId && positionTuple[2] === claimed;
        if (!onChainMatch) reason = "Doesn't match this address's live collateral commitment.";
      } else {
        onChainMatch = positionTuple[6] && Number(positionTuple[1]) === entry.assetId && positionTuple[3] === claimed;
        if (!onChainMatch) reason = "Doesn't match this address's live debt commitment.";
      }
      return { label, amountDisplay, selfConsistent, onChainMatch, reason };
    });
  }, [disclosure, positionTuple]);

  const allVerified = signatureValid === true && entryResults.length > 0 && entryResults.every((r) => r.selfConsistent && r.onChainMatch);

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-8">
        <span className="font-display text-[28px]">Verify a disclosure</span>
        <p className="mt-1.5 max-w-[560px] text-[13.5px] text-ink-muted">
          For auditors, accountants, or regulators handed a Latens disclosure file. This checks it against live on-chain state — it doesn&apos;t just trust the numbers in the file.
        </p>
      </div>

      <div className="flex flex-col gap-5 md:flex-row">
        <div className="flex-1">
          <textarea
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            placeholder="Paste the disclosure JSON here…"
            rows={12}
            className="w-full rounded-xl border border-line bg-canvas-raised p-4 font-mono text-xs text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={handleVerify}
            disabled={!rawInput.trim()}
            className="mt-4 rounded-[10px] bg-gold px-6 py-3 text-sm font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            Verify
          </button>
          {parseError && <p className="mt-3 text-xs text-danger">{parseError}</p>}
        </div>

        {disclosure && (
          <div className="flex-1 rounded-2xl border border-line bg-surface p-6">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-mono text-xs text-ink-faint">{disclosure.address}</span>
              <span className={`text-xs font-semibold ${allVerified ? "text-success" : "text-warning"}`}>{allVerified ? "Verified" : "Not fully verified"}</span>
            </div>

            <div className="mb-4 flex items-center gap-2 text-sm">
              <span>{signatureValid ? "✓" : "✗"}</span>
              <span className={signatureValid ? "text-ink" : "text-danger"}>Signature matches claimed address</span>
            </div>

            {networkWarning && <p className="mb-4 text-xs text-warning">{networkWarning}</p>}

            <div className="flex flex-col gap-3">
              {entryResults.map((r) => (
                <div key={r.label} className="border-t border-line pt-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize">{r.label}</span>
                    <span className="font-mono">{r.selfConsistent && r.onChainMatch ? r.amountDisplay : "—"}</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    <span>{r.selfConsistent && r.onChainMatch ? "✓" : "✗"}</span>
                    <span className={r.selfConsistent && r.onChainMatch ? "text-ink-faint" : "text-danger"}>
                      {!r.selfConsistent ? "Amount/salt don't hash to the claimed commitment." : r.onChainMatch ? "Matches live on-chain state." : (r.reason ?? "Doesn't match live on-chain state.")}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
