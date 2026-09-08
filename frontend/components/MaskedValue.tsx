"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

// `revealed`/`onToggle` let a caller with several related figures (e.g. a collateral total
// plus its locked/free breakdown) drive them off one shared reveal state with a single
// button, instead of each figure showing its own "Reveal" control. Omit both for the
// original standalone behavior: its own state, its own button.
export function MaskedValue({
  value,
  fontSize = 20,
  className = "",
  revealed: revealedProp,
  onToggle,
}: {
  value: string;
  fontSize?: number;
  className?: string;
  revealed?: boolean;
  onToggle?: () => void;
}) {
  const [internalRevealed, setInternalRevealed] = useState(false);
  const isControlled = revealedProp !== undefined;
  const revealed = isControlled ? revealedProp : internalRevealed;
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
      {(!isControlled || onToggle) && (
        <button
          onClick={onToggle ?? (() => setInternalRevealed((r) => !r))}
          className="rounded-full border border-line-strong px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          {revealed ? "Hide" : "Reveal"}
        </button>
      )}
    </div>
  );
}
