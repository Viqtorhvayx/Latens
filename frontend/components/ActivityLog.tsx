"use client";

import { useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { tokenList } from "@/lib/contracts";
import { fetchActivity, activityLabel, type ActivityEntry } from "@/lib/activity";
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
  const publicClient = usePublicClient();
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!publicClient) return;
    // Deliberately doesn't reset entries to null before fetching (that setState-in-effect
    // pattern trips react-hooks/set-state-in-effect) — the previous list stays visible
    // until the new one resolves, which is a perfectly fine stale-while-revalidating look
    // for a list that's cheap to refetch.
    fetchActivity(publicClient, address).then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [publicClient, address, refreshKey]);

  return (
    <div className="mt-12">
      <div className="mb-3.5 text-xs font-semibold tracking-wide text-ink-faint uppercase">Recent activity</div>
      {entries === null ? (
        <p className="text-sm text-ink-faint">Loading…</p>
      ) : entries.length === 0 ? (
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
