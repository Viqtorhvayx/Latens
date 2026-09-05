"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { PositionStoreProvider } from "@/lib/positionStore";
import { ViewingKeyProvider } from "@/lib/viewingKeyContext";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <PositionStoreProvider>
          <ViewingKeyProvider>{children}</ViewingKeyProvider>
        </PositionStoreProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
