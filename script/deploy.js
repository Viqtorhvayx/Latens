const { ethers } = require("hardhat");

// Deploys the Latens scaffold — LatensPool AND LatensCDP — wired to the REAL, machine-
// generated Barretenberg verifiers (contracts/verifiers/generated/*HonkVerifier.sol, via
// their Noir*Verifier.sol adapters) — not MockVerifier. This is the actual testnet/
// production deployment path; see the "Status" section of contracts/README.md for what
// still needs to be true before pointing it at mainnet (there is no real client-side proof
// generation yet — see lib/positionStore.tsx in the frontend — so nothing can actually call
// this deployment's supply/borrow/repay/liquidate/mint/burn successfully until that exists;
// this script deploys the verifying side correctly regardless of that gap). Set
// MOCK_VERIFIERS=1 to fall back to MockVerifier instead, strictly for environments that
// intentionally need the old permissive behavior — never mainnet.
async function deployHonkVerifier(fileName, contractName) {
  const sourceName = `contracts/verifiers/generated/${fileName}.sol`;
  // All three generated files declare identically-named shared libraries (RelationsLib,
  // ZKTranscriptLib) on purpose (see each file's header) — fully-qualified names avoid the
  // ambiguous bare-name lookup that would otherwise cause once more than one is loaded.
  const relationsLib = await (await ethers.getContractFactory(`${sourceName}:RelationsLib`)).deploy();
  const zkTranscriptLib = await (await ethers.getContractFactory(`${sourceName}:ZKTranscriptLib`)).deploy();
  const Verifier = await ethers.getContractFactory(`${sourceName}:${contractName}`, {
    libraries: { RelationsLib: await relationsLib.getAddress(), ZKTranscriptLib: await zkTranscriptLib.getAddress() },
  });
  return Verifier.deploy();
}

async function deployRealVerifiers() {
  const commitmentHonk = await deployHonkVerifier("CommitmentHonkVerifier", "CommitmentHonkVerifier");
  const commitmentVerifier = await (await ethers.getContractFactory("NoirCommitmentVerifier")).deploy(await commitmentHonk.getAddress());
  console.log("Real CommitmentHonkVerifier + NoirCommitmentVerifier:", await commitmentVerifier.getAddress());

  const solvencyHonk = await deployHonkVerifier("SolvencyHonkVerifier", "SolvencyHonkVerifier");
  const solvencyVerifier = await (await ethers.getContractFactory("NoirSolvencyVerifier")).deploy(await solvencyHonk.getAddress());
  console.log("Real SolvencyHonkVerifier + NoirSolvencyVerifier:  ", await solvencyVerifier.getAddress());

  const liquidationHonk = await deployHonkVerifier("LiquidationHonkVerifier", "LiquidationHonkVerifier");
  const liquidationVerifier = await (await ethers.getContractFactory("NoirLiquidationVerifier")).deploy(await liquidationHonk.getAddress());
  console.log("Real LiquidationHonkVerifier + NoirLiquidationVerifier:", await liquidationVerifier.getAddress());

  return { commitmentVerifier, solvencyVerifier, liquidationVerifier };
}

async function deployMockVerifiers() {
  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false);
  await verifier.waitForDeployment();
  console.log("MockVerifier (MOCK_VERIFIERS=1, permissive — never use on mainnet):", await verifier.getAddress());
  return { commitmentVerifier: verifier, solvencyVerifier: verifier, liquidationVerifier: verifier };
}

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

  const { commitmentVerifier, solvencyVerifier, liquidationVerifier } = process.env.MOCK_VERIFIERS ? await deployMockVerifiers() : await deployRealVerifiers();

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
    await commitmentVerifier.getAddress(),
    await solvencyVerifier.getAddress(),
    await liquidationVerifier.getAddress()
  );
  await pool.waitForDeployment();
  console.log("LatensPool:", await pool.getAddress());

  const setPoolTx = await registry.setPool(await pool.getAddress());
  await setPoolTx.wait();
  console.log("AssetRegistry.pool wired to LatensPool.");

  const LatensDollar = await ethers.getContractFactory("LatensDollar");
  const latensDollar = await LatensDollar.deploy(deployer.address);
  await latensDollar.waitForDeployment();
  console.log("LatensDollar:", await latensDollar.getAddress());

  const LatensCDP = await ethers.getContractFactory("LatensCDP");
  const cdp = await LatensCDP.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    await latensDollar.getAddress(),
    priceOracleAddress,
    await commitmentVerifier.getAddress(),
    await solvencyVerifier.getAddress(),
    await liquidationVerifier.getAddress()
  );
  await cdp.waitForDeployment();
  console.log("LatensCDP:", await cdp.getAddress());

  const setCDPTx = await latensDollar.setCDP(await cdp.getAddress());
  await setCDPTx.wait();
  console.log("LatensDollar.cdp wired to LatensCDP.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
