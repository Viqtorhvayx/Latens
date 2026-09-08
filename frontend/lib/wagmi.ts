import { createConfig, http } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { baseSepolia, sepolia, horizenTestnet as horizenTestnetBase } from "viem/chains";
import deployment from "./deployment.json";

// viem ships this chain with the right id/RPC (confirmed against a live eth_chainId call)
// but a generic "Sepolia Ether" currency name and a bare Caldera explorer domain — both
// clearly copy-paste leftovers in viem's own definition, not this project's. Overridden to
// match the currency name/symbol and the horizen.io explorer alias used everywhere else in
// this repo (hardhat.config.js, the docs site) — same backend, confirmed by fetching the
// same verified-contract data from both domains, just the friendlier of the two names.
const horizenTestnet = {
  ...horizenTestnetBase,
  nativeCurrency: { name: "Horizen Testnet ETH", symbol: "ETH", decimals: 18 },
  blockExplorers: {
    default: { name: "Horizen Testnet Explorer", url: "https://explorer-testnet.horizen.io" },
  },
} as const;

const SUPPORTED_CHAINS = [horizenTestnet, sepolia, baseSepolia] as const;

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

// Without an explicit `metadata`, WalletConnect falls back to a generic letter-avatar (the
// app name's first initial) instead of Latens's own mark, in both its own modal and on the
// connecting wallet's side (MetaMask's connection prompt, a mobile wallet's WC screen) —
// this is the one place that icon is actually sourced from for the WalletConnect connector.
// `url` doubles as the base the wallet resolves `icons` against, so it needs to be the same
// placeholder as layout.tsx's `metadataBase` until there's a real domain — update both
// together once one exists.
const appUrl = "https://latens.example";

export const wagmiConfig = createConfig({
  chains: [horizenTestnet, sepolia, baseSepolia],
  connectors: [
    injected(),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            metadata: {
              name: "Latens",
              description: "Confidential borrow-lend market for Horizen. Collateral, borrow size, and health factor stay provably hidden, verified by zero-knowledge proofs.",
              url: appUrl,
              icons: [`${appUrl}/logo-mark.png`],
            },
          }),
        ]
      : []),
  ],
  transports: {
    [horizenTestnet.id]: http(process.env.NEXT_PUBLIC_HORIZEN_TESTNET_RPC_URL || "https://horizen-testnet.rpc.caldera.xyz/http"),
    [sepolia.id]: http(process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
    [baseSepolia.id]: http(process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
  },
  ssr: true,
});
