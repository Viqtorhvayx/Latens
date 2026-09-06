require("@nomicfoundation/hardhat-toolbox");

// Matches the settings Aztec's own barretenberg/sol foundry.toml uses to compile its
// generated Honk Solidity verifiers (solc 0.8.30, evmVersion cancun, optimizer_runs 1, no
// viaIR) — the generated verifiers fail Solidity's Yul optimizer under this project's
// default settings (viaIR, solc 0.8.24, default evm target) with a stack-too-deep error
// that this exact combination avoids. See circuits/README.md for how this was found. Base
// supports Cancun, so this is deployable there as-is.
const HONK_VERIFIER_SETTINGS = {
  version: "0.8.30",
  settings: {
    optimizer: { enabled: true, runs: 1 },
    evmVersion: "cancun",
  },
};

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
      HONK_VERIFIER_SETTINGS,
    ],
    overrides: {
      // The three machine-generated verifiers, and the adapters that import them (which
      // must therefore compile in the same solc run).
      "contracts/verifiers/generated/SolvencyHonkVerifier.sol": HONK_VERIFIER_SETTINGS,
      "contracts/verifiers/generated/CommitmentHonkVerifier.sol": HONK_VERIFIER_SETTINGS,
      "contracts/verifiers/generated/LiquidationHonkVerifier.sol": HONK_VERIFIER_SETTINGS,
      "contracts/verifiers/NoirSolvencyVerifier.sol": HONK_VERIFIER_SETTINGS,
      "contracts/verifiers/NoirCommitmentVerifier.sol": HONK_VERIFIER_SETTINGS,
      "contracts/verifiers/NoirLiquidationVerifier.sol": HONK_VERIFIER_SETTINGS,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
  },
  networks: {
    // Horizen is an EVM-native L3 settling on Base. RPC endpoints are placeholders
    // until Horizen publishes its public testnet/mainnet RPC for this deployment.
    horizenTestnet: {
      url: process.env.HORIZEN_TESTNET_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    // Real, public, reachable testnets in the meantime — see script/deployTestnet.js.
    // sepolia.base.org is Base's own free public RPC (no API key required).
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
