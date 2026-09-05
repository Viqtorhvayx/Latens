import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";

// Local Hardhat node — see script/deployLocal.js. Swap in Base / Base Sepolia (and
// eventually Horizen's own L3 RPC, once public) once contracts are deployed there; see
// contracts/README.md and hardhat.config.js's horizenTestnet placeholder.
export const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

// A minimal, hand-built wallet connection stack (see components/ConnectWallet.tsx) instead
// of RainbowKit: RainbowKit's package entry — regardless of which named export is actually
// used — eagerly pulls in every bundled wallet connector, including Coinbase's "Base
// Account" wallet. That wallet's SDK (@coinbase/cdp-sdk, via @base-org/account) ships
// dynamic imports to unpublished @x402/* packages that crash Next.js's SSR bundling
// entirely. There's no way to exclude just that one wallet from RainbowKit's default
// export surface, so this scaffold drops RainbowKit rather than try to patch around a
// third-party SDK bug — a custom connect button is a small amount of code either way, and
// it means the UI matches Latens's own design system without fighting RainbowKit's.
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = createConfig({
  chains: [hardhatLocal],
  connectors: [
    injected(),
    ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : []),
  ],
  transports: {
    [hardhatLocal.id]: http(),
  },
  ssr: true,
});
