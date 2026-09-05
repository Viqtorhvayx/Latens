const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier, toHonkPublicInputs } = require("../test/helpers/honkVerifier");

// Demonstrates the actual "swap in a real verifier" deployment path that contracts/README.md
// describes (see its "Status" section) — a real, machine-generated LiquidationHonkVerifier
// gating a real LatensPool.liquidate() call, with a genuine Barretenberg zk-SNARK proof, not
// MockVerifier. script/deployLocal.js (which the frontend actually runs against) stays on
// MockVerifier for all three proof types on purpose: the frontend has no client-side proving
// yet (see lib/positionStore.tsx's own header comment — that's a separate, larger task), so
// wiring its live deployment to a real verifier would just make every button in the UI
// revert. This script instead proves the OTHER half of "real verifiers exist and work":
// that they deploy correctly, link their generated libraries correctly, and accept a genuine
// proof through the pool's actual binding checks — exactly what a testnet deployment would
// need, without needing real client-side proving to demonstrate it.
//
// commitmentVerifier and solvencyVerifier stay on MockVerifier here too, and that's not a
// shortcut around the hard part — it's a real constraint. The liquidation_eligibility fixture
// proof (circuits/liquidation_eligibility/target/) was generated for one exact position: a
// specific collateralCommitment/debtCommitment pair, at specific prices and thresholds. To
// reach that exact starting position through supplyCollateral()/borrow() with a REAL
// solvency proof, we'd need a solvency proof for the intermediate (pre-liquidation) debt
// level — and no valid one can exist, because that intermediate state is BY DEFINITION
// insolvent (that's the whole premise of the liquidation fixture). A real solvency circuit
// correctly refuses to prove an insolvent position solvent. So reaching this fixture's exact
// starting commitments has to go through MockVerifier's permissive commitment/solvency
// checks — only the liquidation step itself is real. The commitment_update and solvency
// verifiers are still deployed and checked here, just directly against their own fixture
// proofs (mirroring test/CommitmentHonkVerifier.integration.test.js and
// test/SolvencyHonkVerifier.integration.test.js) rather than threaded through this one
// pool's call sequence.
function readWords(filePath) {
  const buf = fs.readFileSync(filePath);
  const words = [];
  for (let i = 0; i < buf.length / 32; i++) {
    words.push(BigInt(ethers.hexlify(buf.subarray(i * 32, (i + 1) * 32))));
  }
  return words;
}

async function main() {
  const circuitsDir = path.join(__dirname, "..", "circuits");
  const liquidationDir = path.join(circuitsDir, "liquidation_eligibility", "target");
  const solvencyDir = path.join(circuitsDir, "solvency", "target");
  const commitmentDir = path.join(circuitsDir, "commitment_update", "target");

  for (const dir of [liquidationDir, solvencyDir, commitmentDir]) {
    if (!fs.existsSync(path.join(dir, "proof")) || !fs.existsSync(path.join(dir, "public_inputs"))) {
      console.error(`Missing proof fixtures in ${dir} — see circuits/README.md to regenerate them, then re-run this script.`);
      process.exitCode = 1;
      return;
    }
  }

  const [deployer, alice, bob] = await ethers.getSigners();
  console.log("Deploying with real verifiers, using:", deployer.address);

  // --- Deploy all three real Honk verifiers + their Noir*Verifier adapters ---
  const commitmentHonk = await deployHonkVerifier("CommitmentHonkVerifier", "CommitmentHonkVerifier");
  const NoirCommitmentVerifier = await ethers.getContractFactory("NoirCommitmentVerifier");
  const realCommitmentVerifier = await NoirCommitmentVerifier.deploy(await commitmentHonk.getAddress());

  const solvencyHonk = await deployHonkVerifier("SolvencyHonkVerifier", "SolvencyHonkVerifier");
  const NoirSolvencyVerifier = await ethers.getContractFactory("NoirSolvencyVerifier");
  const realSolvencyVerifier = await NoirSolvencyVerifier.deploy(await solvencyHonk.getAddress());

  const liquidationHonk = await deployHonkVerifier("LiquidationHonkVerifier", "LiquidationHonkVerifier");
  const NoirLiquidationVerifier = await ethers.getContractFactory("NoirLiquidationVerifier");
  const realLiquidationVerifier = await NoirLiquidationVerifier.deploy(await liquidationHonk.getAddress());

  console.log("Real CommitmentHonkVerifier + adapter:", await realCommitmentVerifier.getAddress());
  console.log("Real SolvencyHonkVerifier + adapter:  ", await realSolvencyVerifier.getAddress());
  console.log("Real LiquidationHonkVerifier + adapter:", await realLiquidationVerifier.getAddress());

  // --- Sanity-check the commitment and solvency verifiers directly against their own
  // fixtures (see the header comment for why they aren't threaded through the pool call
  // sequence below) ---
  const commitmentProof = fs.readFileSync(path.join(commitmentDir, "proof"));
  const commitmentPublicInputs = fs.readFileSync(path.join(commitmentDir, "public_inputs"));
  const commitmentOk = await commitmentHonk.verify(ethers.hexlify(commitmentProof), toHonkPublicInputs(commitmentPublicInputs));
  console.log(commitmentOk ? "✓ Real CommitmentHonkVerifier verified its fixture proof directly." : "✗ CommitmentHonkVerifier rejected its own fixture proof — something regenerated out of sync.");

  const solvencyProof = fs.readFileSync(path.join(solvencyDir, "proof"));
  const solvencyPublicInputs = fs.readFileSync(path.join(solvencyDir, "public_inputs"));
  const solvencyOk = await solvencyHonk.verify(ethers.hexlify(solvencyProof), toHonkPublicInputs(solvencyPublicInputs));
  console.log(solvencyOk ? "✓ Real SolvencyHonkVerifier verified its fixture proof directly." : "✗ SolvencyHonkVerifier rejected its own fixture proof — something regenerated out of sync.");

  if (!commitmentOk || !solvencyOk) {
    process.exitCode = 1;
    return;
  }

  // --- Deploy the pool, wired with the two mocks (see header comment) plus the ONE real
  // verifier this script actually drives a live call through ---
  const mockVerifier = await (await ethers.getContractFactory("MockVerifier")).deploy(false);

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();

  const MockZenStakingPool = await ethers.getContractFactory("MockZenStakingPool");
  const stakingPool = await MockZenStakingPool.deploy();

  const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
  const registry = await AssetRegistry.deploy(deployer.address);

  const ProtocolTreasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await ProtocolTreasury.deploy(deployer.address, await stakingPool.getAddress());

  const LatensPool = await ethers.getContractFactory("LatensPool");
  const pool = await LatensPool.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    await oracle.getAddress(),
    await mockVerifier.getAddress(), // commitmentVerifier — see header comment
    await mockVerifier.getAddress(), // solvencyVerifier — see header comment
    await realLiquidationVerifier.getAddress(), // the real thing this script actually drives
  );
  await registry.setPool(await pool.getAddress());

  // --- Reach the liquidation fixture's exact starting position ---
  // liquidation_eligibility's public inputs, in the order LatensPool.liquidate() checks them.
  const [collateralCommitment, debtCommitment, newCollateralCommitment, newDebtCommitment, collateralPriceE8, debtPriceE8, liquidationThresholdBps, liquidationBonusBps, seizedCollateralAmount, repayAmount] = readWords(
    path.join(liquidationDir, "public_inputs"),
  );

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const collateralToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
  const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);
  await oracle.setPrice(await collateralToken.getAddress(), collateralPriceE8);
  await oracle.setPrice(await debtToken.getAddress(), debtPriceE8);

  const collateralAssetId = 0n;
  // ltvBps is set below the fixture's liquidationThresholdBps, matching every real market's
  // shape (you can borrow up to LTV, get liquidated only once you cross the higher threshold).
  await registry.listAsset(await collateralToken.getAddress(), Number(liquidationThresholdBps) - 500, Number(liquidationThresholdBps), Number(liquidationBonusBps), 1_000);
  const debtAssetId = 1n;
  await registry.listAsset(await debtToken.getAddress(), 8_000, 8_500, 800, 1_000);

  const collateralAmount = 1_000n; // arbitrary — MockVerifier accepts any commitment update
  await collateralToken.mint(alice.address, collateralAmount);
  await collateralToken.connect(alice).approve(await pool.getAddress(), collateralAmount);
  await pool.connect(alice).supplyCollateral(collateralAssetId, collateralAmount, collateralCommitment, "0x", [0n, collateralCommitment, collateralAmount, 1n, collateralAssetId]);

  const debtAmount = repayAmount; // whatever's borrowed, only the pool's own ERC20 balance matters
  await debtToken.mint(deployer.address, debtAmount);
  await debtToken.connect(deployer).transfer(await pool.getAddress(), debtAmount);
  const ltvBps = BigInt(liquidationThresholdBps) - 500n;
  await pool
    .connect(alice)
    .borrow(debtAssetId, debtAmount, debtCommitment, "0x", [0n, debtCommitment, debtAmount, 1n, debtAssetId], "0x", [
      collateralCommitment,
      debtCommitment,
      collateralPriceE8,
      debtPriceE8,
      ltvBps,
    ]);

  console.log("Reached the fixture's exact pre-liquidation position (collateral/debt commitments match the real proof's public inputs).");

  // --- The real call: liquidate(), gated by the REAL LiquidationHonkVerifier ---
  await debtToken.mint(bob.address, repayAmount);
  await debtToken.connect(bob).approve(await pool.getAddress(), repayAmount);

  const liquidationProof = ethers.hexlify(fs.readFileSync(path.join(liquidationDir, "proof")));
  await pool
    .connect(bob)
    .liquidate(alice.address, repayAmount, seizedCollateralAmount, newCollateralCommitment, newDebtCommitment, liquidationProof, [
      collateralCommitment,
      debtCommitment,
      newCollateralCommitment,
      newDebtCommitment,
      collateralPriceE8,
      debtPriceE8,
      liquidationThresholdBps,
      liquidationBonusBps,
      seizedCollateralAmount,
      repayAmount,
    ]);

  const position = await pool.positions(alice.address);
  const seized = await collateralToken.balanceOf(bob.address);
  console.log("✓ pool.liquidate() succeeded against a REAL zk-SNARK proof, verified by REAL on-chain LiquidationHonkVerifier bytecode.");
  console.log("  Position collateralCommitment updated to:", position.collateralCommitment.toString());
  console.log("  Position debtCommitment updated to:      ", position.debtCommitment.toString());
  console.log("  Bob (the liquidator) received seized collateral:", seized.toString(), "base units");

  if (position.collateralCommitment !== newCollateralCommitment || position.debtCommitment !== newDebtCommitment || seized !== seizedCollateralAmount) {
    console.error("FAIL: on-chain state doesn't match the proof's declared post-liquidation values.");
    process.exitCode = 1;
    return;
  }

  console.log("\nAll real-verifier checks passed. See contracts/README.md's Status section for what a testnet deployment still needs beyond this (real client-side proving — see lib/positionStore.tsx — is item 11, not this script).");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
