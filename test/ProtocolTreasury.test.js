const { expect } = require("chai");
const { ethers } = require("hardhat");

const BPS = 10_000n;

async function deployFixture() {
  const [deployer, alice] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const zusd = await MockERC20.deploy("Horizen USD", "ZUSD", 18);
  const otherToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);

  const MockZenStakingPool = await ethers.getContractFactory("MockZenStakingPool");
  const stakingPool = await MockZenStakingPool.deploy();

  const ProtocolTreasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await ProtocolTreasury.deploy(deployer.address, await stakingPool.getAddress());

  // SupplyRewards needs a LatensPool reference, but nothing in these tests calls
  // checkpoint(), so a minimally-wired one is enough — it never has to actually function.
  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false);
  const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
  const registry = await AssetRegistry.deploy(deployer.address);
  const LatensPool = await ethers.getContractFactory("LatensPool");
  const pool = await LatensPool.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    await oracle.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
  );

  const SupplyRewards = await ethers.getContractFactory("SupplyRewards");
  const rewards = await SupplyRewards.deploy(deployer.address, await pool.getAddress(), await zusd.getAddress(), 24n * 60n * 60n, ethers.parseUnits("10", 18));

  return { deployer, alice, zusd, otherToken, stakingPool, treasury, rewards };
}

describe("ProtocolTreasury", function () {
  it("with no SupplyRewards wired, sweeps split only between staking and runway — unchanged from before this existed", async function () {
    const { zusd, stakingPool, treasury } = await deployFixture();
    await zusd.mint(await treasury.getAddress(), ethers.parseUnits("1000", 18));

    await treasury.sweep(await zusd.getAddress());

    const expectedToStaking = (ethers.parseUnits("1000", 18) * 1_750n) / BPS;
    expect(await stakingPool.totalContributed(await zusd.getAddress())).to.equal(expectedToStaking);
    expect(await zusd.balanceOf(await treasury.getAddress())).to.equal(ethers.parseUnits("1000", 18) - expectedToStaking);
  });

  it("once wired, tops SupplyRewards up out of its own reward token on every sweep", async function () {
    const { zusd, stakingPool, treasury, rewards } = await deployFixture();
    await treasury.setSupplyRewards(await rewards.getAddress());
    await treasury.setRewardsContributionRate(1_500); // 15%

    const amount = ethers.parseUnits("1000", 18);
    await zusd.mint(await treasury.getAddress(), amount);
    await treasury.sweep(await zusd.getAddress());

    const expectedToStaking = (amount * 1_750n) / BPS;
    const expectedToRewards = (amount * 1_500n) / BPS;
    const expectedToRunway = amount - expectedToStaking - expectedToRewards;

    expect(await stakingPool.totalContributed(await zusd.getAddress())).to.equal(expectedToStaking);
    expect(await zusd.balanceOf(await rewards.getAddress())).to.equal(expectedToRewards);
    expect(await zusd.balanceOf(await treasury.getAddress())).to.equal(expectedToRunway);
  });

  it("never routes a different token into SupplyRewards, even when wired and rated — fund() only accepts its own reward token", async function () {
    const { otherToken, treasury, rewards } = await deployFixture();
    await treasury.setSupplyRewards(await rewards.getAddress());
    await treasury.setRewardsContributionRate(1_500);

    const amount = ethers.parseUnits("1000", 18);
    await otherToken.mint(await treasury.getAddress(), amount);
    await treasury.sweep(await otherToken.getAddress());

    expect(await otherToken.balanceOf(await rewards.getAddress())).to.equal(0n);
    // The 15% that would have gone to rewards stays in runway instead of vanishing.
    const expectedToStaking = (amount * 1_750n) / BPS;
    expect(await otherToken.balanceOf(await treasury.getAddress())).to.equal(amount - expectedToStaking);
  });

  it("rejects a rewards contribution rate above its own 30% cap", async function () {
    const { treasury } = await deployFixture();
    await expect(treasury.setRewardsContributionRate(3_001)).to.be.revertedWithCustomError(treasury, "ExceedsGrantIndicativeRange");
    await expect(treasury.setRewardsContributionRate(3_000)).to.not.be.reverted;
  });

  it("only the owner can wire SupplyRewards or change its contribution rate", async function () {
    const { alice, treasury, rewards } = await deployFixture();
    await expect(treasury.connect(alice).setSupplyRewards(await rewards.getAddress())).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
    await expect(treasury.connect(alice).setRewardsContributionRate(1_000)).to.be.revertedWithCustomError(treasury, "OwnableUnauthorizedAccount");
  });

  it("sweep stays permissionless — a keeper who isn't the owner can still trigger it", async function () {
    const { alice, zusd, treasury, rewards } = await deployFixture();
    await treasury.setSupplyRewards(await rewards.getAddress());
    await treasury.setRewardsContributionRate(1_500);
    await zusd.mint(await treasury.getAddress(), ethers.parseUnits("100", 18));

    await expect(treasury.connect(alice).sweep(await zusd.getAddress())).to.not.be.reverted;
  });
});
