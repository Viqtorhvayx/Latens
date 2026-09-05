const { ethers } = require("hardhat");

// Deploys the Latens scaffold with `MockVerifier` wired in permissive mode. This is a
// development/testnet deployment path ONLY — see the "Status" section of contracts/README.md
// before pointing this at anything real. A production deploy script needs real verifying-key
// contracts generated from the M1 circuits in place of MockVerifier.
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying Latens scaffold with:", deployer.address);

  const zenStakingPoolAddress = process.env.ZEN_STAKING_POOL_ADDRESS;
  const priceOracleAddress = process.env.PRICE_ORACLE_ADDRESS;
  if (!zenStakingPoolAddress || !priceOracleAddress) {
    throw new Error(
      "Set ZEN_STAKING_POOL_ADDRESS and PRICE_ORACLE_ADDRESS env vars — this script does not deploy mocks for you outside of tests."
    );
  }

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false);
  await verifier.waitForDeployment();
  console.log("MockVerifier (dev-only, permissive):", await verifier.getAddress());

  const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
  const registry = await AssetRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log("AssetRegistry:", await registry.getAddress());

  const ProtocolTreasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await ProtocolTreasury.deploy(deployer.address, zenStakingPoolAddress);
  await treasury.waitForDeployment();
  console.log("ProtocolTreasury:", await treasury.getAddress());

  const LatensPool = await ethers.getContractFactory("LatensPool");
  const pool = await LatensPool.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    priceOracleAddress,
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress()
  );
  await pool.waitForDeployment();
  console.log("LatensPool:", await pool.getAddress());

  const setPoolTx = await registry.setPool(await pool.getAddress());
  await setPoolTx.wait();
  console.log("AssetRegistry.pool wired to LatensPool.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
