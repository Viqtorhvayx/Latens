"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { AnimatePresence, motion } from "framer-motion";
import { FaucetButton } from "./FaucetButton";
import type { ActionMode } from "./PositionActionModal";

export function MarketRowActions({
  tokenAddress,
  symbol,
  decimals,
  hasActivePosition,
  canWithdraw,
  canRepay,
  activeMode,
  onAction,
}: {
  tokenAddress: `0x${string}`;
  symbol: string;
  decimals: number;
  hasActivePosition: boolean;
  canWithdraw: boolean;
  canRepay: boolean;
  activeMode: ActionMode | null;
  onAction: (mode: ActionMode) => void;
}) {
  const { address: account } = useAccount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onAction("supply")}
        className={
          activeMode === "supply"
            ? "rounded-[10px] bg-gold px-4 py-1.5 text-xs font-semibold text-canvas transition-colors hover:bg-gold-strong"
            : "rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
        }
      >
        Supply
      </button>
      <button
        onClick={() => onAction("borrow")}
        title={hasActivePosition ? undefined : "Borrow. You'll deposit collateral first"}
        className={
          activeMode === "borrow"
            ? "rounded-[10px] bg-gold px-4 py-1.5 text-xs font-semibold text-canvas transition-colors hover:bg-gold-strong"
            : "rounded-lg border border-line-strong px-4 py-1.5 text-xs font-semibold transition-colors hover:bg-surface-hover"
        }
      >
        Borrow
      </button>
      {account && (
        <div ref={ref} className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            title="More actions"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line-strong text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <circle cx="3" cy="8" r="1.4" fill="currentColor" />
              <circle cx="8" cy="8" r="1.4" fill="currentColor" />
              <circle cx="13" cy="8" r="1.4" fill="currentColor" />
            </svg>
          </button>
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full right-0 z-10 mt-2 w-44 rounded-xl border border-line-strong bg-surface p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
              >
                {canWithdraw && (
                  <button
                    onClick={() => {
                      onAction("withdraw");
                      setOpen(false);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                  >
                    Withdraw
                  </button>
                )}
                {canRepay && (
                  <button
                    onClick={() => {
                      onAction("repay");
                      setOpen(false);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
                  >
                    Repay
                  </button>
                )}
                <FaucetButton address={tokenAddress} symbol={symbol} decimals={decimals} variant="menuItem" />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
