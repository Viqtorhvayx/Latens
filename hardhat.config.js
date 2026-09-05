require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
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
  },
};
