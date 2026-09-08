"use client";

import { formatUnits } from "viem";
import { MaskedValue } from "./MaskedValue";

// Collateral behind a live loan is two things at once, and running them together as one
// line ("50 locked against debt · 0 free to withdraw") reads as a riddle rather than a
// position. The proportion is the part worth seeing at a glance, because how close the
// locked slice is to swallowing the whole bar is exactly how close the position is to its
// borrowing limit — so the bar carries that, and the amounts sit underneath it labelled.
export function CollateralSplit({
  locked,
  free,
  decimals,
  symbol,
  revealed,
}: {
  locked: bigint;
  free: bigint;
  decimals: number;
  symbol: string;
  revealed?: boolean;
}) {
  const total = locked + free;
  const lockedPct = total > 0n ? Number((locked * 10_000n) / total) / 100 : 0;
  const atLimit = lockedPct >= 99.5;

  return (
    <div className="mt-1 flex flex-col gap-2">
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-canvas-raised" title={`${lockedPct.toFixed(1)}% of this collateral is backing the loan`}>
        <div className={`h-full ${atLimit ? "bg-warning" : "bg-gold"}`} style={{ width: `${Math.min(lockedPct, 100)}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${atLimit ? "bg-warning" : "bg-gold"}`} />
          <span className="text-[11px] text-ink-faint">Backing the loan</span>
          <MaskedValue value={`${formatUnits(locked, decimals)} ${symbol}`} fontSize={11} revealed={revealed} />
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-line-strong" />
          <span className="text-[11px] text-ink-faint">Free to withdraw</span>
          <MaskedValue value={`${formatUnits(free, decimals)} ${symbol}`} fontSize={11} revealed={revealed} />
        </span>
      </div>
      {atLimit && <span className="text-[11px] text-warning">This position is at its borrowing limit. Repay to release collateral.</span>}
    </div>
  );
}
