const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier } = require("./helpers/honkVerifier");

// The liquidation counterpart to LatensPool.realVerifier.integration.test.js: a real
// LatensPool.liquidate() call gated by a REAL, machine-generated LiquidationHonkVerifier —
// not MockVerifier. commitmentVerifier and solvencyVerifier stay on MockVerifier to reach
// the fixture's exact pre-liquidation position (see the header comment in
// script/deployRealVerifiers.js for why a real solvency proof can't exist for a position
// that's by definition insolvent) — only the liquidation step itself is real.
//
// Requires circuits/liquidation_eligibility/target/{proof,public_inputs} to exist (see
// circuits/README.md to regenerate).
describe("LatensPool + NoirLiquidationVerifier (real proof, no MockVerifier for liquidation)", function () {
  const targetDir = path.join(__dirname, "..", "circuits", "liquidation_eligibility", "target");
  const proofPath = path.join(targetDir, "proof");
  const publicInputsPath = path.join(targetDir, "public_inputs");

  function readWords(filePath) {
    const buf = fs.readFileSync(filePath);
    const words = [];
    for (let i = 0; i < buf.length / 32; i++) {
      words.push(BigInt(ethers.hexlify(buf.subarray(i * 32, (i + 1) * 32))));
    }
    return words;
  }

  it("liquidates an eligible position using a real liquidation-eligibility proof", async function () {
    if (!fs.existsSync(proofPath) || !fs.existsSync(publicInputsPath)) {
      this.skip();
    }

    const [deployer, alice, bob] = await ethers.getSigners();

    // Matches ILiquidationVerifier's layout field for field.
    const [
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
    ] = readWords(publicInputsPath);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const collateralToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
    const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await MockPriceOracle.deploy();
    await oracle.setPrice(await collateralToken.getAddress(), collateralPriceE8);
    await oracle.setPrice(await debtToken.getAddress(), debtPriceE8);

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy(false); // commitment/solvency — not the focus here

    const honkVerifier = await deployHonkVerifier("LiquidationHonkVerifier", "LiquidationHonkVerifier");
    const NoirLiquidationVerifier = await ethers.getContractFactory("NoirLiquidationVerifier");
    const realLiquidationVerifier = await NoirLiquidationVerifier.deploy(await honkVerifier.getAddress());

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
      await mockVerifier.getAddress(), // commitmentVerifier — not the focus of this test
      await mockVerifier.getAddress(), // solvencyVerifier — see header comment
      await realLiquidationVerifier.getAddress() // the real thing
    );
    await registry.setPool(await pool.getAddress());

    // ltvBps below liquidationThresholdBps, matching every real market's shape.
    const collateralAssetId = 0n;
    await registry.listAsset(await collateralToken.getAddress(), Number(liquidationThresholdBps) - 500, Number(liquidationThresholdBps), Number(liquidationBonusBps), 1_000);
    const debtAssetId = 1n;
    await registry.listAsset(await debtToken.getAddress(), 8_000, 8_500, 800, 1_000);

    // Reach the fixture's exact pre-liquidation position via MockVerifier's permissive
    // commitment/solvency checks (see header comment for why a real solvency proof can't
    // exist for an intentionally-insolvent intermediate state).
    const collateralAmount = 1_000n;
    await collateralToken.mint(alice.address, collateralAmount);
    await collateralToken.connect(alice).approve(await pool.getAddress(), collateralAmount);
    await pool.connect(alice).supplyCollateral(collateralAssetId, collateralAmount, collateralCommitment, "0x", [0n, collateralCommitment, collateralAmount, 1n, collateralAssetId]);

    await debtToken.mint(deployer.address, repayAmount);
    await debtToken.connect(deployer).transfer(await pool.getAddress(), repayAmount);
    const ltvBps = BigInt(liquidationThresholdBps) - 500n;
    await pool
      .connect(alice)
      .borrow(debtAssetId, repayAmount, debtCommitment, "0x", [0n, debtCommitment, repayAmount, 1n, debtAssetId], "0x", [
        collateralCommitment,
        debtCommitment,
        collateralPriceE8,
        debtPriceE8,
        ltvBps,
      ]);

    // --- The real call: liquidate(), gated by the REAL LiquidationHonkVerifier ---
    await debtToken.mint(bob.address, repayAmount);
    await debtToken.connect(bob).approve(await pool.getAddress(), repayAmount);

    const liquidationProof = ethers.hexlify(fs.readFileSync(proofPath));
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
    expect(position.collateralCommitment).to.equal(newCollateralCommitment);
    expect(position.debtCommitment).to.equal(newDebtCommitment);
    expect(await collateralToken.balanceOf(bob.address)).to.equal(seizedCollateralAmount);
  });
});
