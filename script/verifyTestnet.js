// Source-verifies every contract of a testnet deployment on the network's block explorer.
//
// Horizen's explorer is Blockscout, which ignores the API key entirely (hardhat.config.js
// passes a placeholder) but otherwise speaks the same interface hardhat-verify already
// targets. Run after script/deployTestnet.js:
//
//   npx hardhat run script/verifyTestnet.js --network horizenTestnet
//
// Constructor arguments are reconstructed here rather than recorded at deploy time. The
// treasury address (which the frontend never needs) is read back off the pool itself, since
// that never changes. MockVerifier's address is NOT read back the same way — once
// setVerifiers() has pointed the pools at real verifiers, pool.commitmentVerifier() returns
// the new verifier, not MockVerifier, and MockVerifier's original address becomes otherwise
// unrecoverable except by decoding the pool's own creation-transaction calldata. So it's
// deployment.json's contracts.MockVerifier.address, recorded by deployTestnet.js at deploy
// time, that's authoritative here — never a live contract read.
//
// "Already verified" is a success, not a failure: Blockscout matches by bytecode, so
// contracts that share it (the four MockERC20s) get picked up the moment the first one
// lands.
const hre = require("hardhat");
const { ethers } = require("hardhat");
const deployment = require("../frontend/lib/deployment.json");

const TOKEN_ARGS = {
  ZEN: ["Wrapped ZEN", "ZEN", 18],
  ZUSD: ["Horizen USD", "ZUSD", 18],
  WBTC: ["Wrapped Bitcoin", "WBTC", 8],
  USDC: ["USD Coin", "USDC", 6],
};

async function verify(label, address, constructorArguments) {
  process.stdout.write(`${label.padEnd(20)} ${address} ... `);
  try {
    await hre.run("verify:verify", { address, constructorArguments });
    console.log("verified");
    return true;
  } catch (err) {
    const message = String(err.message || err);
    if (/already verified|already been verified|Smart-contract already verified/i.test(message)) {
      console.log("already verified");
      return true;
    }
    console.log(`FAILED: ${message.split("\n")[0]}`);
    return false;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const c = deployment.contracts;

  const pool = await ethers.getContractAt("LatensPool", c.LatensPool.address);
  if (!c.MockVerifier?.address) {
    throw new Error(
      "deployment.json has no contracts.MockVerifier.address — this deployment predates that field. " +
        "Recover it by decoding LatensPool's creation-transaction calldata (see this file's header comment) " +
        "and add it to deployment.json by hand before running this script."
    );
  }
  const verifierAddress = c.MockVerifier.address;
  const treasuryAddress = await pool.treasury();
  const treasury = await ethers.getContractAt("ProtocolTreasury", treasuryAddress);
  const stakingPoolAddress = await treasury.zenStakingPool();
  const oracleAddress = c.MockPriceOracle.address;

  const results = [];
  for (const [symbol, token] of Object.entries(deployment.tokens)) {
    results.push(await verify(`MockERC20 ${symbol}`, token.address, TOKEN_ARGS[symbol]));
  }
  results.push(await verify("MockPriceOracle", oracleAddress, []));
  results.push(await verify("MockVerifier", verifierAddress, [false]));
  results.push(await verify("MockZenStakingPool", stakingPoolAddress, []));
  results.push(await verify("AssetRegistry", c.AssetRegistry.address, [deployer.address]));
  results.push(await verify("ProtocolTreasury", treasuryAddress, [deployer.address, stakingPoolAddress]));
  results.push(
    await verify("LatensPool", c.LatensPool.address, [
      deployer.address,
      c.AssetRegistry.address,
      treasuryAddress,
      oracleAddress,
      verifierAddress,
      verifierAddress,
      verifierAddress,
    ])
  );
  results.push(await verify("LatensDollar", c.LatensDollar.address, [deployer.address]));
  results.push(
    await verify("LatensCDP", c.LatensCDP.address, [
      deployer.address,
      c.AssetRegistry.address,
      treasuryAddress,
      c.LatensDollar.address,
      oracleAddress,
      verifierAddress,
      verifierAddress,
      verifierAddress,
    ])
  );
  results.push(
    await verify("SupplyRewards", c.SupplyRewards.address, [
      deployer.address,
      c.LatensPool.address,
      deployment.tokens.ZUSD.address,
      24n * 60n * 60n,
      ethers.parseUnits("10", 18),
    ])
  );

  // Real Honk verifiers + Noir*Verifier adapters only exist once
  // script/deployRealVerifiersTestnet.js has been run (it records their addresses under
  // deployment.verifiers) — skip silently otherwise so this script keeps working before that
  // migration and after it without needing two separate entry points.
  if (deployment.verifiers) {
    const v = deployment.verifiers;
    results.push(await verify("CommitmentHonkVerifier", v.CommitmentHonkVerifier.address, []));
    results.push(await verify("NoirCommitmentVerifier", v.NoirCommitmentVerifier.address, [v.CommitmentHonkVerifier.address]));
    results.push(await verify("SolvencyHonkVerifier", v.SolvencyHonkVerifier.address, []));
    results.push(await verify("NoirSolvencyVerifier", v.NoirSolvencyVerifier.address, [v.SolvencyHonkVerifier.address]));
    results.push(await verify("LiquidationHonkVerifier", v.LiquidationHonkVerifier.address, []));
    results.push(await verify("NoirLiquidationVerifier", v.NoirLiquidationVerifier.address, [v.LiquidationHonkVerifier.address]));
  }

  const ok = results.filter(Boolean).length;
  console.log(`\n${ok}/${results.length} verified.`);
  if (ok !== results.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
