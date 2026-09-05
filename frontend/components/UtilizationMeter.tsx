// A quiet, instrument-style utilization readout — a single position marker on a
// hairline track, not a filled progress bar. Progress bars read as "loading state";
// this reads as a dial, which is the register we want for market-level data.
export function UtilizationMeter({ value }: { value: number }) {
  const pct = Math.min(Math.max(value, 0), 100);
  const tone = pct >= 90 ? "text-danger" : pct >= 75 ? "text-warning" : "text-ink-muted";

  return (
    <div className="flex items-center gap-3">
      <span className={`w-9 font-mono text-[13px] tabular-nums ${tone}`}>{pct.toFixed(0)}%</span>
      <div className="relative h-3 flex-1">
        <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-line-strong" />
        <div className="absolute top-1/2 left-[75%] h-1.5 w-px -translate-x-1/2 -translate-y-1/2 bg-line-strong" />
        <div
          className="absolute top-1/2 h-2.5 w-px -translate-x-1/2 -translate-y-1/2 bg-gold"
          style={{ left: `${pct}%` }}
        />
      </div>
    </div>
  );
}
