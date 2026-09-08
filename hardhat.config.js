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
  sourcify: {
    enabled: false,
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY || "",
      // Horizen's explorer is Blockscout, not Etherscan — hardhat-verify still uses this
      // same `apiKey` map to pick a key per network name, but Blockscout's verification
      // API doesn't check the key's value, only that one is present. See customChains
      // below for where the actual verifier URLs are configured.
      horizenTestnet: "not-required-by-blockscout",
    },
    customChains: [
      {
        network: "horizenTestnet",
        chainId: 2651420,
        urls: {
          apiURL: "https://explorer-testnet.horizen.io/api",
          browserURL: "https://explorer-testnet.horizen.io",
        },
      },
    ],
  },
  networks: {
    // Confirmed live: docs.horizen.io/horizen-chain/network/testnet, and this project's
    // own eth_chainId probe against the RPC below returned 2651420 directly.
    horizenTestnet: {
      url: process.env.HORIZEN_TESTNET_RPC_URL || "https://horizen-testnet.rpc.caldera.xyz/http",
      chainId: 2651420,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
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
