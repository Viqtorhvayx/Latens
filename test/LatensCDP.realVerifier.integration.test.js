const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier, toHonkPublicInputs } = require("./helpers/honkVerifier");

describe("LatensCDP + CommitmentHonkVerifier (real proof, real verifier)", function () {
  const targetDir = path.join(__dirname, "..", "circuits", "commitment_update", "target");
  const proofPath = path.join(targetDir, "proof");
  const publicInputsPath = path.join(targetDir, "public_inputs");

  it("supplies collateral using a real commitment-update proof", async function () {
    if (!fs.existsSync(proofPath) || !fs.existsSync(publicInputsPath)) {
      this.skip();
    }

    const [deployer, alice] = await ethers.getSigners();

    const bbProof = ethers.hexlify(fs.readFileSync(proofPath));
    const bbPublicInputsBuf = fs.readFileSync(publicInputsPath);
    const words = [];
    for (let i = 0; i < bbPublicInputsBuf.length / 32; i++) {
      words.push(BigInt(ethers.hexlify(bbPublicInputsBuf.subarray(i * 32, (i + 1) * 32))));
    }
    const [oldCommitment, newCommitment, delta, isIncrease, assetId] = words;
    expect(oldCommitment).to.equal(0n);

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const collateralToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await MockPriceOracle.deploy();

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy(false);

    const honkVerifier = await deployHonkVerifier("CommitmentHonkVerifier", "CommitmentHonkVerifier");
    const NoirCommitmentVerifier = await ethers.getContractFactory("NoirCommitmentVerifier");
    const realCommitmentVerifier = await NoirCommitmentVerifier.deploy(await honkVerifier.getAddress());

    const MockZenStakingPool = await ethers.getContractFactory("MockZenStakingPool");
    const stakingPool = await MockZenStakingPool.deploy();

    const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
    const registry = await AssetRegistry.deploy(deployer.address);

    const ProtocolTreasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await ProtocolTreasury.deploy(deployer.address, await stakingPool.getAddress());

    const LatensDollar = await ethers.getContractFactory("LatensDollar");
    const latensDollar = await LatensDollar.deploy(deployer.address);

    const LatensCDP = await ethers.getContractFactory("LatensCDP");
    const cdp = await LatensCDP.deploy(
      deployer.address,
      await registry.getAddress(),
      await treasury.getAddress(),
      await latensDollar.getAddress(),
      await oracle.getAddress(),
      await realCommitmentVerifier.getAddress(),
      await mockVerifier.getAddress(),
      await mockVerifier.getAddress()
    );
    await latensDollar.setCDP(await cdp.getAddress());

    for (let i = 0n; i < assetId; i++) {
      await registry.listAsset(await collateralToken.getAddress(), 8_000, 8_500, 800, 1_000);
    }
    await registry.listAsset(await collateralToken.getAddress(), 8_000, 8_500, 800, 1_000);

    await collateralToken.mint(alice.address, delta);
    await collateralToken.connect(alice).approve(await cdp.getAddress(), delta);
    await cdp.connect(alice).supplyCollateral(
      assetId,
      delta,
      newCommitment,
      bbProof,
      [oldCommitment, newCommitment, delta, isIncrease, assetId]
    );

    const position = await cdp.positions(alice.address);
    expect(position.collateralCommitment).to.equal(newCommitment);
    expect(position.active).to.equal(true);
    expect(await cdp.totalCollateralLocked(assetId)).to.equal(delta);
    expect(await collateralToken.balanceOf(await cdp.getAddress())).to.equal(delta);
  });
});
