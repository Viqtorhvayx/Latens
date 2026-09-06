"use client";

import { useMemo } from "react";
import { formatUnits } from "viem";
import { tokenList } from "@/lib/contracts";
import { getActivity, activityLabel, type ActivityEntry } from "@/lib/activityStore";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

function shortHash(hash: string) {
  return `${hash.slice(0, 8)}···${hash.slice(-6)}`;
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const { copied, copy } = useCopyToClipboard();
  const token = tokenList.find((t) => t.assetId === entry.assetId);

  return (
    <div className="flex items-center justify-between border-b border-line py-3 text-sm">
      <div className="flex items-center gap-3">
        <span className={entry.isIncrease ? "text-success" : "text-ink-muted"}>{activityLabel(entry)}</span>
        <span className="font-mono text-ink-muted">
          {token ? formatUnits(entry.amount, token.decimals) : entry.amount.toString()} {token?.symbol ?? `#${entry.assetId}`}
        </span>
      </div>
      <button onClick={() => copy(entry.transactionHash)} className="font-mono text-xs text-ink-faint transition-colors hover:text-ink" title="Copy transaction hash">
        {copied ? "Copied" : shortHash(entry.transactionHash)}
      </button>
    </div>
  );
}

export function ActivityLog({ address, refreshKey }: { address: `0x${string}`; refreshKey?: number }) {
  // refreshKey isn't read inside the callback — bumping it just forces a re-read after
  // PositionActionModal appends a new entry, since getActivity() has nothing to subscribe to.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entries = useMemo(() => getActivity(address), [address, refreshKey]);

  return (
    <div className="mt-12">
      <div className="mb-3.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">Recent activity</div>
      {entries.length === 0 ? (
        <p className="text-sm text-ink-faint">No activity yet.</p>
      ) : (
        <div className="flex flex-col">
          {entries.map((entry) => (
            <ActivityRow key={entry.transactionHash + entry.kind + entry.isIncrease} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}
