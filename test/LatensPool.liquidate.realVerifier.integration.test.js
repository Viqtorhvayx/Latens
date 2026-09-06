const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier } = require("./helpers/honkVerifier");

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

    const [
      collateralCommitment,
      debtCommitment,
      newCollateralCommitment,
      newDebtCommitment,
      collateralPriceE8,
      debtPriceE8,
      collateralIndexRay,
      debtIndexRay,
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
    const mockVerifier = await MockVerifier.deploy(false);

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
      await mockVerifier.getAddress(),
      await mockVerifier.getAddress(),
      await realLiquidationVerifier.getAddress()
    );
    await registry.setPool(await pool.getAddress());

    const collateralAssetId = 0n;
    await registry.listAsset(await collateralToken.getAddress(), Number(liquidationThresholdBps) - 500, Number(liquidationThresholdBps), Number(liquidationBonusBps), 1_000);
    const debtAssetId = 1n;
    await registry.listAsset(await debtToken.getAddress(), 8_000, 8_500, 800, 1_000);

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
        collateralIndexRay,
        debtIndexRay,
        ltvBps,
      ]);

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
        collateralIndexRay,
        debtIndexRay,
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
