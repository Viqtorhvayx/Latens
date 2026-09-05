"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

export function MaskedValue({ value, fontSize = 20, className = "" }: { value: string; fontSize?: number; className?: string }) {
  const [revealed, setRevealed] = useState(false);
  const masked = value.replace(/[0-9]/g, "•");

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="relative inline-grid font-mono text-ink" style={{ fontSize }}>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={revealed ? "revealed" : "masked"}
            initial={{ opacity: 0, filter: "blur(4px)" }}
            animate={{ opacity: 1, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(4px)" }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="col-start-1 row-start-1 whitespace-nowrap"
          >
            {revealed ? value : masked}
          </motion.span>
        </AnimatePresence>
      </span>
      <button
        onClick={() => setRevealed((r) => !r)}
        className="rounded-full border border-line-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
      >
        {revealed ? "Hide" : "Reveal"}
      </button>
    </div>
  );
}
