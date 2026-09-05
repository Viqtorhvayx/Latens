// A segmented tick row (like a bond-rating scale or a VU meter), read
// left-to-right. Each tick lights up as filled once utilization passes its
// threshold — no continuous fill, no rounded pill. Reads as a discrete,
// deliberate instrument rather than a smooth "percent loaded" bar.
const SEGMENTS = 10;

export function UtilizationMeter({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const filled = Math.round((pct / 100) * SEGMENTS);
  const tone = pct >= 90 ? "bg-danger" : pct >= 75 ? "bg-warning" : "bg-gold";

  return (
    <div className="flex items-center gap-3">
      <div className="flex gap-[3px]">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <div key={i} className={`h-3 w-[3px] rounded-[1px] ${i < filled ? tone : "bg-line-strong"}`} />
        ))}
      </div>
      <span className="font-mono text-[13px] tabular-nums text-ink-muted">{pct.toFixed(0)}%</span>
    </div>
  );
}
