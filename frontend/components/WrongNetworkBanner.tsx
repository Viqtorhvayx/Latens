"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { activeChain } from "@/lib/wagmi";

export function WrongNetworkBanner() {
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chain?.id === activeChain.id) return null;

  return (
    <div className="flex items-center justify-center gap-3 border-b border-warning/30 bg-warning/10 px-6 py-2.5 text-[13px]">
      <span className="text-warning">
        {chain ? `Connected to ${chain.name}` : "Connected to an unsupported network"}. Latens only works on {activeChain.name} right now.
      </span>
      <button
        onClick={() => switchChain({ chainId: activeChain.id })}
        disabled={isPending}
        className="rounded-md border border-warning/40 px-3 py-1 text-xs font-semibold text-warning transition-colors hover:bg-warning/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPending ? "Switching…" : "Switch network"}
      </button>
    </div>
  );
}
