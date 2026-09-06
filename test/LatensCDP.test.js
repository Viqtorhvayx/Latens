const { expect } = require("chai");
const { ethers } = require("hardhat");

const BPS = 10_000n;

async function deployFixture() {
  const [deployer, alice, liquidator] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const collateralToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.setPrice(await collateralToken.getAddress(), ethers.parseUnits("2", 8));

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false);

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
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress()
  );
  await latensDollar.setCDP(await cdp.getAddress());

  const collateralAssetId = 0n;
  await registry.listAsset(await collateralToken.getAddress(), 8_000, 8_500, 800, 1_000);

  await collateralToken.mint(alice.address, ethers.parseUnits("1000", 18));
  await collateralToken.mint(liquidator.address, ethers.parseUnits("1000", 18));

  return { deployer, alice, liquidator, collateralToken, oracle, verifier, registry, treasury, stakingPool, latensDollar, cdp, collateralAssetId };
}

function commitmentUpdateInputs({ oldCommitment, newCommitment, delta, isIncrease, assetId }) {
  return [oldCommitment, newCommitment, delta, isIncrease ? 1n : 0n, assetId];
}

const RAY = 1_000_000_000_000_000_000n;

function solvencyInputs({ collateralCommitment, debtCommitment, collateralPriceE8, thresholdBps }) {
  return [collateralCommitment, debtCommitment, collateralPriceE8, 100_000_000n, RAY, RAY, BigInt(thresholdBps)];
}

describe("LatensCDP", function () {
  it("locks collateral without minting anything or touching LatensDollar's supply", async function () {
    const { alice, collateralToken, cdp, collateralAssetId } = await deployFixture();

    const amount = ethers.parseUnits("100", 18);
    await collateralToken.connect(alice).approve(await cdp.getAddress(), amount);
    await expect(
      cdp.connect(alice).supplyCollateral(
        collateralAssetId, amount, 111n, "0x",
        commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 111n, delta: amount, isIncrease: true, assetId: collateralAssetId })
      )
    )
      .to.emit(cdp, "CDPCollateralUpdated")
      .withArgs(alice.address, collateralAssetId, 111n, true);

    expect(await cdp.totalCollateralLocked(collateralAssetId)).to.equal(amount);
    expect(await collateralToken.balanceOf(await cdp.getAddress())).to.equal(amount);
  });

  it("mints LatensDollar against collateral, net of the mint fee, and sends the fee to the treasury", async function () {
    const { deployer, alice, collateralToken, treasury, latensDollar, cdp, collateralAssetId } = await deployFixture();
    await cdp.connect(deployer).setMintFee(200);

    const collateralAmount = ethers.parseUnits("1000", 18);
    await collateralToken.connect(alice).approve(await cdp.getAddress(), collateralAmount);
    await cdp.connect(alice).supplyCollateral(
      collateralAssetId, collateralAmount, 1n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId })
    );

    const mintAmount = ethers.parseUnits("1000", 18);
    await cdp.connect(alice).mint(
      mintAmount, 2n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: mintAmount, isIncrease: true, assetId: collateralAssetId }),
      "0x",
      solvencyInputs({ collateralCommitment: 1n, debtCommitment: 2n, collateralPriceE8: ethers.parseUnits("2", 8), thresholdBps: 8_000 })
    );

    const expectedFee = (mintAmount * 200n) / BPS;
    expect(await latensDollar.balanceOf(alice.address)).to.equal(mintAmount - expectedFee);
    expect(await latensDollar.balanceOf(await treasury.getAddress())).to.equal(expectedFee);
    expect(await latensDollar.totalSupply()).to.equal(mintAmount);
    expect(await cdp.totalDebtMinted()).to.equal(mintAmount);
  });

  it("rejects minting past the collateral's LTV", async function () {
    const { alice, collateralToken, cdp, collateralAssetId } = await deployFixture();

    const collateralAmount = ethers.parseUnits("1000", 18);
    await collateralToken.connect(alice).approve(await cdp.getAddress(), collateralAmount);
    await cdp.connect(alice).supplyCollateral(
      collateralAssetId, collateralAmount, 1n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId })
    );

    const mintAmount = ethers.parseUnits("1700", 18);
    await expect(
      cdp.connect(alice).mint(
        mintAmount, 2n, "0x",
        commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: mintAmount, isIncrease: true, assetId: collateralAssetId }),
        "0x",
        solvencyInputs({ collateralCommitment: 1n, debtCommitment: 2n, collateralPriceE8: ethers.parseUnits("2", 8), thresholdBps: 9_000 })
      )
    ).to.be.revertedWithCustomError(cdp, "InvalidProof");
  });

  it("burns LatensDollar to reduce debt, and only ever the caller's own balance", async function () {
    const { alice, collateralToken, latensDollar, cdp, collateralAssetId } = await deployFixture();

    const collateralAmount = ethers.parseUnits("1000", 18);
    await collateralToken.connect(alice).approve(await cdp.getAddress(), collateralAmount);
    await cdp.connect(alice).supplyCollateral(
      collateralAssetId, collateralAmount, 1n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId })
    );
    const mintAmount = ethers.parseUnits("1000", 18);
    await cdp.connect(alice).mint(
      mintAmount, 2n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: mintAmount, isIncrease: true, assetId: collateralAssetId }),
      "0x",
      solvencyInputs({ collateralCommitment: 1n, debtCommitment: 2n, collateralPriceE8: ethers.parseUnits("2", 8), thresholdBps: 8_000 })
    );

    const aliceBalance = await latensDollar.balanceOf(alice.address);
    await expect(
      cdp.connect(alice).burn(
        aliceBalance, 3n, "0x",
        commitmentUpdateInputs({ oldCommitment: 2n, newCommitment: 3n, delta: aliceBalance, isIncrease: false, assetId: collateralAssetId })
      )
    )
      .to.emit(cdp, "CDPDebtUpdated")
      .withArgs(alice.address, 3n, false);

    expect(await latensDollar.balanceOf(alice.address)).to.equal(0n);
    expect(await cdp.totalDebtMinted()).to.equal(mintAmount - aliceBalance);
  });

  it("lets a keeper liquidate an eligible position, burning their own LatensDollar and seizing collateral plus bonus", async function () {
    const { alice, liquidator, collateralToken, latensDollar, cdp, registry, collateralAssetId } = await deployFixture();

    const collateralAmount = ethers.parseUnits("1000", 18);
    await collateralToken.connect(alice).approve(await cdp.getAddress(), collateralAmount);
    await cdp.connect(alice).supplyCollateral(
      collateralAssetId, collateralAmount, 1n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId })
    );
    const mintAmount = ethers.parseUnits("1000", 18);
    await cdp.connect(alice).mint(
      mintAmount, 2n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: mintAmount, isIncrease: true, assetId: collateralAssetId }),
      "0x",
      solvencyInputs({ collateralCommitment: 1n, debtCommitment: 2n, collateralPriceE8: ethers.parseUnits("2", 8), thresholdBps: 8_000 })
    );

    await collateralToken.connect(liquidator).approve(await cdp.getAddress(), collateralAmount);
    await cdp.connect(liquidator).supplyCollateral(
      collateralAssetId, collateralAmount, 10n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 10n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId })
    );
    await cdp.connect(liquidator).mint(
      mintAmount, 11n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 11n, delta: mintAmount, isIncrease: true, assetId: collateralAssetId }),
      "0x",
      solvencyInputs({ collateralCommitment: 10n, debtCommitment: 11n, collateralPriceE8: ethers.parseUnits("2", 8), thresholdBps: 8_000 })
    );

    const { liquidationBonusBps, liquidationThresholdBps } = await registry.getAsset(collateralAssetId);
    const repayAmount = ethers.parseUnits("500", 18);
    const seizedCollateralAmount = (repayAmount * (BPS + liquidationBonusBps)) / (BPS * 2n);

    const eligibilityInputs = [
      1n, 2n, 3n, 4n,
      ethers.parseUnits("2", 8),
      100_000_000n,
      RAY,
      RAY,
      liquidationThresholdBps,
      liquidationBonusBps,
      seizedCollateralAmount,
      repayAmount,
    ];

    const liquidatorLatdBefore = await latensDollar.balanceOf(liquidator.address);
    const liquidatorCollateralBefore = await collateralToken.balanceOf(liquidator.address);

    await expect(cdp.connect(liquidator).liquidate(alice.address, repayAmount, seizedCollateralAmount, 3n, 4n, "0x", eligibilityInputs))
      .to.emit(cdp, "CDPLiquidated")
      .withArgs(alice.address, liquidator.address, collateralAssetId, seizedCollateralAmount, repayAmount);

    expect(await latensDollar.balanceOf(liquidator.address)).to.equal(liquidatorLatdBefore - repayAmount);
    expect(await collateralToken.balanceOf(liquidator.address)).to.equal(liquidatorCollateralBefore + seizedCollateralAmount);
  });

  it("rejects a mint fee above the 5% ceiling", async function () {
    const { deployer, cdp } = await deployFixture();
    await expect(cdp.connect(deployer).setMintFee(501)).to.be.revertedWithCustomError(cdp, "ExceedsMaxFee");
  });

  it("only the CDP can mint or burn LatensDollar", async function () {
    const { alice, latensDollar } = await deployFixture();
    await expect(latensDollar.connect(alice).mint(alice.address, 1n)).to.be.revertedWithCustomError(latensDollar, "NotPool");
    await expect(latensDollar.connect(alice).burn(alice.address, 1n)).to.be.revertedWithCustomError(latensDollar, "NotPool");
  });
});
