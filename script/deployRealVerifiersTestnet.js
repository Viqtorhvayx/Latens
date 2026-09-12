// Deploys the real, machine-generated Honk verifiers (+ their Noir*Verifier adapters) to
// Horizen testnet and points the ALREADY-LIVE LatensPool/LatensCDP at them via
// setVerifiers() — no redeployment of the pools themselves, so every existing position and
// its commitments stay exactly where they are. This is the swap from MockVerifier (which
// accepted any proof) to the real UltraHonk verifiers that frontend/lib/proving now
// generates genuine client-side proofs for.
//
// Run after confirming frontend/lib/deployment.json points at the live pool/CDP:
//
//   DEPLOYER_PRIVATE_KEY=<owner key> npx hardhat run script/deployRealVerifiersTestnet.js --network horizenTestnet
//
// The signer MUST be the current owner of both LatensPool and LatensCDP (setVerifiers is
// onlyOwner) — the script checks this up front and refuses to proceed otherwise, since a
// failed setVerifiers call after the honk verifiers are already deployed would just leave
// dangling (harmless, but confusing) contracts on-chain.
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier } = require("../test/helpers/honkVerifier");

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Wiring real verifiers on ${network.name} (chainId ${net.chainId}) with:`, deployer.address);

  const deploymentPath = path.join(__dirname, "..", "frontend", "lib", "deployment.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  if (BigInt(deployment.chainId) !== net.chainId) {
    throw new Error(`deployment.json is for chainId ${deployment.chainId}, but connected network is ${net.chainId}`);
  }

  const pool = await ethers.getContractAt("LatensPool", deployment.contracts.LatensPool.address);
  const cdp = await ethers.getContractAt("LatensCDP", deployment.contracts.LatensCDP.address);

  const [poolOwner, cdpOwner] = await Promise.all([pool.owner(), cdp.owner()]);
  if (poolOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Signer ${deployer.address} is not LatensPool's owner (${poolOwner}) — refusing to deploy verifiers that couldn't be wired.`);
  }
  if (cdpOwner.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`Signer ${deployer.address} is not LatensCDP's owner (${cdpOwner}) — refusing to deploy verifiers that couldn't be wired.`);
  }

  // No manual nonce tracking here: deployHonkVerifier() below sends multiple transactions
  // per verifier (two libraries, then the verifier itself) without taking a nonce override,
  // so a locally-incremented counter drifts out of sync with the provider's real pending
  // count the moment those calls run — confirmed the hard way (a live "nonce too low" on
  // Horizen testnet) before this comment was written. Let ethers manage nonces automatically
  // for every transaction in this script instead.
  console.log("Deploying CommitmentHonkVerifier + libraries...");
  const commitmentHonk = await deployHonkVerifier("CommitmentHonkVerifier", "CommitmentHonkVerifier");
  await commitmentHonk.waitForDeployment();
  const NoirCommitmentVerifier = await ethers.getContractFactory("NoirCommitmentVerifier");
  const commitmentVerifier = await NoirCommitmentVerifier.deploy(await commitmentHonk.getAddress());
  await commitmentVerifier.waitForDeployment();

  console.log("Deploying SolvencyHonkVerifier + libraries...");
  const solvencyHonk = await deployHonkVerifier("SolvencyHonkVerifier", "SolvencyHonkVerifier");
  await solvencyHonk.waitForDeployment();
  const NoirSolvencyVerifier = await ethers.getContractFactory("NoirSolvencyVerifier");
  const solvencyVerifier = await NoirSolvencyVerifier.deploy(await solvencyHonk.getAddress());
  await solvencyVerifier.waitForDeployment();

  console.log("Deploying LiquidationHonkVerifier + libraries...");
  const liquidationHonk = await deployHonkVerifier("LiquidationHonkVerifier", "LiquidationHonkVerifier");
  await liquidationHonk.waitForDeployment();
  const NoirLiquidationVerifier = await ethers.getContractFactory("NoirLiquidationVerifier");
  const liquidationVerifier = await NoirLiquidationVerifier.deploy(await liquidationHonk.getAddress());
  await liquidationVerifier.waitForDeployment();

  const commitmentVerifierAddr = await commitmentVerifier.getAddress();
  const solvencyVerifierAddr = await solvencyVerifier.getAddress();
  const liquidationVerifierAddr = await liquidationVerifier.getAddress();

  console.log("\nReal verifiers deployed:");
  console.log("  NoirCommitmentVerifier: ", commitmentVerifierAddr, "(wraps", await commitmentHonk.getAddress(), ")");
  console.log("  NoirSolvencyVerifier:   ", solvencyVerifierAddr, "(wraps", await solvencyHonk.getAddress(), ")");
  console.log("  NoirLiquidationVerifier:", liquidationVerifierAddr, "(wraps", await liquidationHonk.getAddress(), ")");

  console.log("\nWiring LatensPool.setVerifiers()...");
  await (await pool.connect(deployer).setVerifiers(commitmentVerifierAddr, solvencyVerifierAddr, liquidationVerifierAddr)).wait();
  console.log("Wiring LatensCDP.setVerifiers()...");
  await (await cdp.connect(deployer).setVerifiers(commitmentVerifierAddr, solvencyVerifierAddr, liquidationVerifierAddr)).wait();

  const poolNowCommitment = await pool.commitmentVerifier();
  const cdpNowCommitment = await cdp.commitmentVerifier();
  if (poolNowCommitment.toLowerCase() !== commitmentVerifierAddr.toLowerCase() || cdpNowCommitment.toLowerCase() !== commitmentVerifierAddr.toLowerCase()) {
    throw new Error("setVerifiers() succeeded on-chain but read-back doesn't match — investigate before trusting this deployment.");
  }
  console.log("Confirmed: both LatensPool and LatensCDP now read back the new real verifiers.");

  deployment.verifiers = {
    CommitmentHonkVerifier: { address: await commitmentHonk.getAddress() },
    NoirCommitmentVerifier: { address: commitmentVerifierAddr },
    SolvencyHonkVerifier: { address: await solvencyHonk.getAddress() },
    NoirSolvencyVerifier: { address: solvencyVerifierAddr },
    LiquidationHonkVerifier: { address: await liquidationHonk.getAddress() },
    NoirLiquidationVerifier: { address: liquidationVerifierAddr },
  };
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("\nWrote real verifier addresses into frontend/lib/deployment.json under \"verifiers\".");
  console.log("MockVerifier is no longer the live verifier for either contract — the deployed MockVerifier instance itself is untouched and can be left in place or ignored.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
