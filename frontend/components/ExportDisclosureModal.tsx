"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSignMessage } from "wagmi";
import { formatUnits } from "viem";
import { latensPool } from "@/lib/contracts";
import { buildDisclosureMessage, type Disclosure, type DisclosureEntry } from "@/lib/disclosure";
import { humanizeError } from "@/lib/errors";

function download(filename: string, content: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportDisclosureModal({
  address,
  chainId,
  entries,
  decimalsFor,
  onClose,
}: {
  address: `0x${string}`;
  chainId: number;
  entries: DisclosureEntry[];
  decimalsFor: (assetId: number) => number;
  onClose: () => void;
}) {
  const { signMessageAsync, isPending } = useSignMessage();
  const [step, setStep] = useState<"review" | "done" | "error">("review");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSign() {
    setErrorMessage("");
    try {
      const payload = {
        version: 1 as const,
        chainId,
        pool: latensPool.address,
        address,
        issuedAt: new Date().toISOString(),
        entries,
      };
      const message = buildDisclosureMessage(payload);
      const signature = await signMessageAsync({ message });
      const disclosure: Disclosure = { ...payload, signature };
      download(`latens-disclosure-${address.slice(0, 8)}.json`, JSON.stringify(disclosure, null, 2));
      setStep("done");
    } catch (err) {
      setStep("error");
      setErrorMessage(humanizeError(err));
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
          <span className="font-display text-xl">Export for auditor</span>
          <button onClick={onClose} className="text-ink-muted transition-colors hover:text-ink">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3 L13 13 M13 3 L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <AnimatePresence mode="wait">
          {step === "done" ? (
            <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="pt-4 text-center">
              <p className="mb-4 text-sm text-success">Signed and downloaded.</p>
              <p className="mb-5 text-xs leading-relaxed text-ink-faint">
                Hand this file to your auditor along with the link to Latens&apos;s verify page. Anyone holding it can see the amounts below in the clear — treat it like a bank statement, not a password.
              </p>
              <button onClick={onClose} className="w-full rounded-[10px] border border-line-strong py-3.5 text-[15px] font-semibold">
                Close
              </button>
            </motion.div>
          ) : (
            <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <p className="mt-1 mb-5 text-[13.5px] leading-relaxed text-ink-muted">You&apos;re about to sign a disclosure revealing these amounts to whoever holds this file:</p>

              <div className="mb-5 flex flex-col gap-2.5 rounded-xl border border-line bg-canvas-raised p-4">
                {entries.map((e) => (
                  <div key={`${e.assetId}-${e.kind}`} className="flex items-center justify-between text-sm">
                    <span className="text-ink-muted capitalize">
                      {e.kind} — {e.symbol}
                    </span>
                    <span className="font-mono">{formatUnits(BigInt(e.amount), decimalsFor(e.assetId))}</span>
                  </div>
                ))}
              </div>

              <p className="mb-5 text-[11.5px] text-ink-faint">
                This is a one-time snapshot signed by your wallet — it isn&apos;t a standing key, and re-exporting after your position changes is on you. Nothing is sent anywhere; the file only leaves your device when
                you share it.
              </p>

              <button
                onClick={handleSign}
                disabled={isPending || entries.length === 0}
                className="w-full rounded-[10px] bg-gold py-3.5 text-[15px] font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isPending ? "Signing…" : "Sign & download disclosure"}
              </button>
              {errorMessage && <p className="mt-3 text-center text-xs text-danger">{errorMessage}</p>}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
