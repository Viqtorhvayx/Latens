"use client";

import { motion } from "framer-motion";

type Zone = "safe" | "moderate" | "risk";

const ZONE_COLOR: Record<Zone, string> = {
  safe: "#7FAE86",
  moderate: "#C98A4B",
  risk: "#C06456",
};

const ZONE_LABEL: Record<Zone, string> = {
  safe: "Safe",
  moderate: "Moderate",
  risk: "At risk",
};

export function HealthGauge({ zone, width = 280 }: { zone: Zone; width?: number }) {
  const dim = "rgba(255,255,255,0.10)";
  const segments: Zone[] = ["safe", "moderate", "risk"];

  return (
    <div className="flex flex-col gap-2" style={{ width, maxWidth: "100%" }}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-ink-muted uppercase">Position health</span>
        <motion.span key={zone} initial={{ opacity: 0, y: -2 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="font-mono text-[13px] font-medium" style={{ color: ZONE_COLOR[zone] }}>
          {ZONE_LABEL[zone]}
        </motion.span>
      </div>
      <div className="flex h-[7px] gap-[3px]">
        {segments.map((s) => (
          <motion.div key={s} className="flex-1 rounded-full" animate={{ backgroundColor: s === zone ? ZONE_COLOR[zone] : dim }} transition={{ duration: 0.3 }} />
        ))}
      </div>
      <span className="text-[11.5px] leading-relaxed text-ink-faint">Exact value verified locally via zero-knowledge proof, never sent to the network.</span>
    </div>
  );
}
