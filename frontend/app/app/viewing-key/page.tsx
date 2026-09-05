"use client";

import { useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { formatUnits, isAddress, type Hex } from "viem";
import { tokenList } from "@/lib/contracts";
import { useViewingKey } from "@/lib/viewingKeyContext";
import { fetchAndDecodeViewingNotes, type DecodedViewingNote } from "@/lib/viewingNotes";
import { humanizeError } from "@/lib/errors";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

// The standing-viewing-key upgrade lib/disclosure.ts's own header comment named as a
// deliberate follow-up: a one-time signed disclosure export needs the owner to act again
// after every change, while sharing this page's PRIVATE key once gives an auditor passive,
// ongoing access to every note published from here on — see LatensPool.publishViewingNote's
// NatSpec for exactly what is and isn't guaranteed by that.
export default function ViewingKeyPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { enabled, setEnabled, ensure } = useViewingKey();
  const { copied: copiedPublic, copy: copyPublic } = useCopyToClipboard();
  const { copied: copiedSecret, copy: copySecret } = useCopyToClipboard();

  const [revealed, setRevealed] = useState<{ publicKey: Hex; secretKey: Hex } | null>(null);
  const [revealError, setRevealError] = useState("");
  const [revealing, setRevealing] = useState(false);

  async function handleReveal() {
    setRevealError("");
    setRevealing(true);
    try {
      const keyPair = await ensure();
      setRevealed(keyPair);
    } catch (err) {
      setRevealError(humanizeError(err));
    } finally {
      setRevealing(false);
    }
  }

  const [decodeAddress, setDecodeAddress] = useState("");
  const [decodeSecretKey, setDecodeSecretKey] = useState("");
  const [decodeError, setDecodeError] = useState("");
  const [decoding, setDecoding] = useState(false);
  const [notes, setNotes] = useState<DecodedViewingNote[] | null>(null);

  async function handleDecode() {
    setDecodeError("");
    setNotes(null);
    if (!isAddress(decodeAddress)) {
      setDecodeError("That doesn't look like a valid address.");
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(decodeSecretKey)) {
      setDecodeError("A viewing private key is a 32-byte hex value (0x + 64 hex characters).");
      return;
    }
    if (!publicClient) {
      setDecodeError("Not connected to a network yet — try again in a moment.");
      return;
    }
    setDecoding(true);
    try {
      const result = await fetchAndDecodeViewingNotes(publicClient, decodeAddress, decodeSecretKey as Hex);
      setNotes(result);
    } catch (err) {
      setDecodeError(humanizeError(err));
    } finally {
      setDecoding(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-12 sm:py-10">
      <div className="mb-8 max-w-[640px]">
        <span className="font-display text-[28px]">Viewing key</span>
        <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-muted">
          A standing alternative to exporting a fresh disclosure file after every change. Turn this on and every future action also publishes a self-encrypted note on-chain — share the private key below with an auditor
          once, and they get passive, ongoing access to every note from then on, the same shape as a Zcash viewing key.
        </p>
      </div>

      {address ? (
        <div className="mb-10 max-w-[640px] rounded-2xl border border-line bg-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <span className="font-display text-lg">Your viewing key</span>
            <button
              onClick={() => setEnabled(!enabled)}
              className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${enabled ? "border-gold bg-gold/15 text-gold" : "border-line-strong text-ink-muted hover:bg-surface-hover"}`}
            >
              {enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          <p className="mb-4 text-[13px] leading-relaxed text-ink-faint">
            {enabled
              ? "Every supply, withdrawal, borrow, and repayment from here on also publishes an encrypted note — this doesn't change what LatensPool verifies or requires, it's purely additional information for whoever you choose to share the key below with."
              : "Off by default. Turning this on will ask you to sign once (to derive your viewing key) and will publish one extra on-chain note alongside each future action."}
          </p>

          {revealed ? (
            <div className="flex flex-col gap-3">
              <div>
                <span className="text-xs font-semibold tracking-wide text-ink-faint uppercase">Public key</span>
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-canvas-raised px-3 py-2">
                  <span className="flex-1 truncate font-mono text-xs text-ink-muted">{revealed.publicKey}</span>
                  <button onClick={() => copyPublic(revealed.publicKey)} className="shrink-0 text-xs text-ink-faint transition-colors hover:text-ink">
                    {copiedPublic ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div>
                <span className="text-xs font-semibold tracking-wide text-warning uppercase">Private key — hand this to your auditor, nobody else</span>
                <div className="mt-1 flex items-center gap-2 rounded-lg border border-line bg-canvas-raised px-3 py-2">
                  <span className="flex-1 truncate font-mono text-xs text-ink">{revealed.secretKey}</span>
                  <button onClick={() => copySecret(revealed.secretKey)} className="shrink-0 text-xs text-ink-faint transition-colors hover:text-ink">
                    {copiedSecret ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <p className="text-[11.5px] text-ink-faint">
                Deterministic from a signature — you can always recover this by clicking below again, so there&apos;s nothing you need to back up. Treat it exactly like the disclosure file&apos;s export: anyone holding
                it can read every note you publish from now on.
              </p>
            </div>
          ) : (
            <button
              onClick={handleReveal}
              disabled={revealing}
              className="rounded-[10px] border border-line-strong px-4 py-2 text-sm font-semibold transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {revealing ? "Signing…" : "Reveal my viewing key"}
            </button>
          )}
          {revealError && <p className="mt-3 text-xs text-danger">{revealError}</p>}
        </div>
      ) : (
        <p className="mb-10 text-sm text-ink-muted">Connect a wallet to set up your own viewing key.</p>
      )}

      <div className="max-w-[640px]">
        <span className="font-display text-lg">Decode a viewing key</span>
        <p className="mt-1.5 mb-4 text-[13.5px] leading-relaxed text-ink-muted">
          For auditors handed a viewing private key. Reconstructs a position&apos;s full note history directly from on-chain events — no fresh export needed from the owner.
        </p>

        <div className="flex flex-col gap-3">
          <input
            value={decodeAddress}
            onChange={(e) => setDecodeAddress(e.target.value)}
            placeholder="Position owner's address (0x…)"
            className="w-full rounded-xl border border-line bg-canvas-raised px-4 py-3 font-mono text-sm text-ink outline-none placeholder:text-ink-faint"
          />
          <textarea
            value={decodeSecretKey}
            onChange={(e) => setDecodeSecretKey(e.target.value.trim())}
            placeholder="Viewing private key (0x…)"
            rows={2}
            className="w-full rounded-xl border border-line bg-canvas-raised p-4 font-mono text-xs text-ink outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={handleDecode}
            disabled={!decodeAddress.trim() || !decodeSecretKey.trim() || decoding}
            className="rounded-[10px] bg-gold px-6 py-3 text-sm font-semibold text-canvas transition-colors hover:bg-gold-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            {decoding ? "Loading…" : "Load history"}
          </button>
          {decodeError && <p className="text-xs text-danger">{decodeError}</p>}
        </div>

        {notes && (
          <div className="mt-6 flex flex-col gap-2">
            {notes.length === 0 ? (
              <p className="text-sm text-ink-faint">No viewing notes have been published for this address yet.</p>
            ) : (
              notes.map((note) => {
                const token = tokenList.find((t) => t.assetId === note.assetId);
                return (
                  <div key={note.transactionHash + note.assetId} className="flex items-center justify-between border-b border-line py-3 text-sm">
                    <div className="flex flex-col gap-0.5">
                      <span className="font-medium">
                        {note.isDebt ? "Debt" : "Collateral"} — {note.symbol}
                      </span>
                      <span className="text-xs text-ink-faint">{new Date(Number(note.timestamp) * 1000).toLocaleString()}</span>
                    </div>
                    <span className="font-mono">{note.decodeFailed ? <span className="text-danger">Couldn&#39;t decrypt — wrong key?</span> : `${formatUnits(note.amount, token?.decimals ?? 18)} ${note.symbol}`}</span>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
