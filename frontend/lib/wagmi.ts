import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { baseSepolia, sepolia } from "viem/chains";
import deployment from "./deployment.json";

// Real, publicly reachable chains only — no local Hardhat node. A user's own wallet has no
// way to reach http://127.0.0.1:8545 (that's this machine's dev loop, see
// script/deployLocal.js), so it must never appear as a connectable/switchable option here;
// eventually Horizen's own L3 RPC, once public — see contracts/README.md and
// hardhat.config.js's horizenTestnet placeholder.
const SUPPORTED_CHAINS = [sepolia, baseSepolia] as const;

// Whichever chain frontend/lib/deployment.json was actually generated against.
export const activeChain = SUPPORTED_CHAINS.find((c) => c.id === deployment.chainId) ?? sepolia;

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
  chains: [sepolia, baseSepolia],
  connectors: [injected(), ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : [])],
  transports: {
    [sepolia.id]: http(),
    [baseSepolia.id]: http(),
  },
  ssr: true,
});
