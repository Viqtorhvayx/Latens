// A segmented tick row (like a bond-rating scale or a VU meter), read
// left-to-right. Each tick lights up as filled once utilization passes its
// threshold — no continuous fill, no rounded pill. Reads as a discrete,
// deliberate instrument rather than a smooth "percent loaded" bar.
const SEGMENTS = 10;

// One segment is worth ten percentage points, so rounding to the nearest segment left a
// market that is genuinely being borrowed from looking completely idle: at 0.4% utilization
// nothing lit and the label rounded to "0%", which is indistinguishable from no borrows at
// all. Any non-zero utilization now lights the first tick, and the label keeps enough
// precision to be a number rather than a rounded-off zero.
export function UtilizationMeter({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const filled = pct > 0 ? Math.max(1, Math.round((pct / 100) * SEGMENTS)) : 0;
  const tone = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-gold";
  const label = pct === 0 ? "0%" : pct < 1 ? `${pct.toFixed(2)}%` : `${pct.toFixed(0)}%`;

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-[3px]">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <div key={i} className={`h-3 w-[3px] rounded-[1px] ${i < filled ? tone : "bg-line-strong"}`} />
        ))}
      </div>
      <span className="font-mono text-[13px] tabular-nums text-ink-muted">{label}</span>
    </div>
  );
}
