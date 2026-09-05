const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier } = require("./helpers/honkVerifier");

// The capstone integration test: a real LatensPool.borrow() call, gated by a REAL Noir
// zk-SNARK proof verified by REAL, machine-generated Barretenberg Solidity bytecode —
// commitmentVerifier and liquidationVerifier stay on MockVerifier (no real circuits wired
// for those yet), but solvencyVerifier is genuinely `NoirSolvencyVerifier`, wrapping the
// compiled `circuits/solvency` verifier. Nothing about the solvency check in this test is
// mocked.
//
// Requires circuits/solvency/target/{proof,public_inputs} to exist (see circuits/README.md
// to regenerate) and to match the fixed values baked into circuits/solvency's own
// `accepts_a_healthy_position` test: collateral 1000 @ price 2, debt 1000 @ price 1,
// threshold 8000 bps. This test's on-chain setup mirrors those exact numbers so the real
// proof's public inputs line up with what LatensPool actually computes and binds.
describe("LatensPool + NoirSolvencyVerifier (real proof, no MockVerifier for solvency)", function () {
  const targetDir = path.join(__dirname, "..", "circuits", "solvency", "target");
  const proofPath = path.join(targetDir, "proof");
  const publicInputsPath = path.join(targetDir, "public_inputs");

  it("borrows against real collateral using a real solvency proof", async function () {
    if (!fs.existsSync(proofPath) || !fs.existsSync(publicInputsPath)) {
      this.skip();
    }

    const [deployer, alice] = await ethers.getSigners();

    const bbProof = ethers.hexlify(fs.readFileSync(proofPath));
    const bbPublicInputsBuf = fs.readFileSync(publicInputsPath);
    const publicInputWords = [];
    for (let i = 0; i < bbPublicInputsBuf.length / 32; i++) {
      publicInputWords.push(BigInt(ethers.hexlify(bbPublicInputsBuf.subarray(i * 32, (i + 1) * 32))));
    }
    // Matches circuits/solvency/src/main.nr's public input order exactly.
    const [collateralCommitment, debtCommitment, collateralPriceE8, debtPriceE8, thresholdBps] = publicInputWords;

    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const collateralToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
    const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);

    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await MockPriceOracle.deploy();
    // These must equal the exact priceE8 values the real proof was generated against.
    await oracle.setPrice(await collateralToken.getAddress(), collateralPriceE8);
    await oracle.setPrice(await debtToken.getAddress(), debtPriceE8);

    const MockVerifier = await ethers.getContractFactory("MockVerifier");
    const mockVerifier = await MockVerifier.deploy(false); // permissive — only for commitment updates here

    const honkVerifier = await deployHonkVerifier("SolvencyHonkVerifier", "SolvencyHonkVerifier");
    const NoirSolvencyVerifier = await ethers.getContractFactory("NoirSolvencyVerifier");
    const realSolvencyVerifier = await NoirSolvencyVerifier.deploy(await honkVerifier.getAddress());

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
      await realSolvencyVerifier.getAddress(), // the real thing
      await mockVerifier.getAddress() // liquidationVerifier — not the focus of this test
    );
    await registry.setPool(await pool.getAddress());

    // thresholdBps from the proof is the LTV LatensPool.borrow() will check against.
    const collateralAssetId = 0n;
    await registry.listAsset(await collateralToken.getAddress(), Number(thresholdBps), 8_500, 800, 1_000);
    const debtAssetId = 1n;
    await registry.listAsset(await debtToken.getAddress(), 8_000, 8_500, 800, 1_000);

    const collateralAmount = 1_000n; // arbitrary — MockVerifier accepts any commitment update
    await collateralToken.mint(alice.address, collateralAmount);
    await collateralToken.connect(alice).approve(await pool.getAddress(), collateralAmount);
    await pool.connect(alice).supplyCollateral(
      collateralAssetId,
      collateralAmount,
      collateralCommitment, // the real circuit's collateral commitment
      "0x",
      [0n, collateralCommitment, collateralAmount, 1n, collateralAssetId]
    );

    await debtToken.mint(deployer.address, 10_000n);
    await debtToken.connect(deployer).transfer(await pool.getAddress(), 10_000n);

    const borrowAmount = 1_000n; // arbitrary — MockVerifier accepts any commitment update
    await pool.connect(alice).borrow(
      debtAssetId,
      borrowAmount,
      debtCommitment, // the real circuit's debt commitment
      "0x",
      [0n, debtCommitment, borrowAmount, 1n, debtAssetId],
      bbProof, // the REAL zk-SNARK proof
      [collateralCommitment, debtCommitment, collateralPriceE8, debtPriceE8, thresholdBps]
    );

    expect(await debtToken.balanceOf(alice.address)).to.equal(borrowAmount);
    const position = await pool.positions(alice.address);
    expect(position.debtCommitment).to.equal(debtCommitment);
    expect(position.hasDebt).to.equal(true);
  });
});
