import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";
import { baseSepolia } from "viem/chains";
import deployment from "./deployment.json";

// Local Hardhat node — see script/deployLocal.js. Not reachable from outside this machine,
// which is why deployment.json's chainId decides which chain the app actually targets (see
// activeChain below) — Base Sepolia (script/deployTestnet.js) is the real, publicly
// reachable deployment; eventually Horizen's own L3 RPC, once public — see
// contracts/README.md and hardhat.config.js's horizenTestnet placeholder.
export const hardhatLocal = defineChain({
  id: 31337,
  name: "Hardhat Local",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
  },
});

const SUPPORTED_CHAINS = [baseSepolia, hardhatLocal] as const;

// Whichever chain frontend/lib/deployment.json was actually generated against — falls back
// to Hardhat Local only if that chainId isn't one of the chains this app knows how to talk
// to, which would mean deployment.json is stale.
export const activeChain = SUPPORTED_CHAINS.find((c) => c.id === deployment.chainId) ?? hardhatLocal;

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
  chains: [baseSepolia, hardhatLocal],
  connectors: [injected(), ...(walletConnectProjectId ? [walletConnect({ projectId: walletConnectProjectId })] : [])],
  transports: {
    [baseSepolia.id]: http(),
    [hardhatLocal.id]: http(),
  },
  ssr: true,
});
