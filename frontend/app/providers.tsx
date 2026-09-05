"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { PositionStoreProvider } from "@/lib/positionStore";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <PositionStoreProvider>{children}</PositionStoreProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
