"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useCopyToClipboard } from "@/lib/useCopyToClipboard";

function shortenAddress(address: string) {
  return `${address.slice(0, 6)}···${address.slice(-4)}`;
}

export function ConnectWallet() {
  const { address, isConnected, chain } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  if (isConnected && address) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-2 rounded-full border border-line-strong bg-surface px-4 py-2 font-mono text-xs text-ink transition-colors hover:bg-surface-hover"
        >
          {chain?.name && <span className="hidden text-ink-faint sm:inline">{chain.name}</span>}
          {shortenAddress(address)}
        </button>
        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full right-0 z-10 mt-2 w-40 rounded-xl border border-line-strong bg-surface p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
            >
              <button
                onClick={() => copy(address)}
                className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                {copied ? "Copied" : "Copy address"}
              </button>
              <button
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
              >
                Disconnect
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="rounded-[10px] bg-gold px-5 py-2.5 text-sm font-semibold text-canvas transition-colors hover:bg-gold-strong"
      >
        Connect Wallet
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 z-10 mt-2 w-52 rounded-xl border border-line-strong bg-surface p-1.5 shadow-[0_16px_40px_rgba(0,0,0,0.4)]"
          >
            {connectors.map((connector) => (
              <button
                key={connector.uid}
                disabled={isPending}
                onClick={() => {
                  connect({ connector });
                  setOpen(false);
                }}
                className="w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium text-ink transition-colors hover:bg-surface-hover disabled:opacity-50"
              >
                {connector.name}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
