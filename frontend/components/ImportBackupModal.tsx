"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useReadContract } from "wagmi";
import { recoverMessageAddress } from "viem";
import { latensPool } from "@/lib/contracts";
import { buildDisclosureMessage, recomputeCommitment, type Disclosure } from "@/lib/disclosure";
import { usePositionStore } from "@/lib/positionStore";
import { humanizeError } from "@/lib/errors";

// The same signed-disclosure file built for auditors doubles as a personal backup: the
// localStorage (amount, salt) cache is the ONLY place a position's real values live (that's
// the whole point of not putting them on-chain), so clearing it otherwise means permanently
// losing the ability to open your own commitment — functionally locking your own funds.
// Restoring only accepts entries that (a) were signed by the connected wallet itself and
// (b) still match LatensPool's live on-chain commitment for that asset, so a stale or
// forged file can't quietly corrupt local state.
type PositionTuple = readonly [bigint, bigint, bigint, bigint, number, boolean, boolean];

export function ImportBackupModal({ address, onClose }: { address: `0x${string}`; onClose: () => void }) {
  const [rawInput, setRawInput] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const [restoredCount, setRestoredCount] = useState(0);
  const { commit } = usePositionStore();

  const { data: position } = useReadContract({
    address: latensPool.address,
    abi: latensPool.abi,
    functionName: "positions",
    args: [address],
  });
  const positionTuple = position as PositionTuple | undefined;

  async function handleImport() {
    setStatus("checking");
    setMessage("");
    try {
      const parsed: Disclosure = JSON.parse(rawInput);
      if (!parsed.address || !parsed.signature || !Array.isArray(parsed.entries)) {
        throw new Error("That doesn't look like a Latens disclosure/backup file.");
      }
      if (parsed.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error("This file was signed by a different address than the one connected.");
      }

      const { version, chainId, pool, address: addr, issuedAt, entries } = parsed;
      const recovered = await recoverMessageAddress({
        message: buildDisclosureMessage({ version, chainId, pool, address: addr, issuedAt, entries }),
        signature: parsed.signature,
      });
      if (recovered.toLowerCase() !== address.toLowerCase()) {
        throw new Error("Signature doesn't match — this file may have been tampered with.");
      }

      if (!positionTuple) throw new Error("Couldn't read your live position — try again in a moment.");

      let restored = 0;
      for (const entry of parsed.entries) {
        if (recomputeCommitment(entry) !== entry.commitment) continue; // internally inconsistent, skip
        const amount = BigInt(entry.amount);
        const salt = BigInt(entry.salt);
        if (entry.kind === "collateral") {
          if (Number(positionTuple[0]) !== entry.assetId || positionTuple[2] !== BigInt(entry.commitment)) continue;
          commit(address, entry.assetId, { supplied: amount, suppliedSalt: salt });
          restored++;
        } else {
          if (!positionTuple[6] || Number(positionTuple[1]) !== entry.assetId || positionTuple[3] !== BigInt(entry.commitment)) continue;
          commit(address, entry.assetId, { borrowed: amount, borrowedSalt: salt });
          restored++;
        }
      }

      if (restored === 0) {
        throw new Error("None of this file's entries match your current on-chain position.");
      }
      setRestoredCount(restored);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setMessage(humanizeError(err));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-28">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-[rgba(10,9,7,0.6)]" />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[460px] rounded-[20px] border border-line-strong bg-surface p-7 shadow-[0_32px_80px_rgba(0,0,0,0.55)]"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="font-display text-xl">Import backup</span>
          <button onClick={onClose} className="text-ink-muted transition-colors hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <AnimatePresence mode="wait">
          {status === "done" ? (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-4 text-center">
              <p className="mb-4 text-sm text-success">
                Restored {restoredCount} {restoredCount === 1 ? "entry" : "entries"}.
              </p>
              <button onClick={onClose} className="w-full rounded-[10px] border border-line-strong py-3.5 text-[15px] font-semibold">
                Close
              </button>
            </motion.div>
          ) : (
            <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="mt-1 mb-4 text-[13.5px] leading-relaxed text-ink-muted">
                Paste one of your own previously-exported disclosure files to restore your local position — useful if you&apos;ve cleared browser storage or switched devices. Only entries that still match your live
                on-chain position are restored.
              </p>
              <textarea
                value={rawInput}
                onChange={(e) => setRawInput(e.target.value)}
                placeholder="Paste your exported disclosure JSON here…"
                rows={8}
                className="mb-4 w-full rounded-xl border border-line bg-canvas-raised p-4 font-mono text-xs text-ink outline-none placeholder:text-ink-faint"
              />
              <button
                onClick={handleImport}
                disabled={!rawInput.trim() || status === "checking"}
                className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {status === "checking" ? "Checking…" : "Restore from file"}
              </button>
              {message && <p className="mt-3 text-center text-xs text-danger">{message}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
