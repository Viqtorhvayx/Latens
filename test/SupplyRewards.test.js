const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const EPOCH_DURATION = 7n * 24n * 60n * 60n;
const REWARD_PER_EPOCH = ethers.parseUnits("10", 18);

async function deployFixture() {
  const [deployer, alice, bob] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const collateralToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
  const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);
  const rewardToken = await MockERC20.deploy("Latens Reward", "LR", 18);

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.setPrice(await collateralToken.getAddress(), ethers.parseUnits("2", 8));
  await oracle.setPrice(await debtToken.getAddress(), ethers.parseUnits("1", 8));

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false);

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
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress()
  );
  await registry.setPool(await pool.getAddress());

  const collateralAssetId = 0n;
  await registry.listAsset(await collateralToken.getAddress(), 8_000, 8_500, 800, 1_000);

  const SupplyRewards = await ethers.getContractFactory("SupplyRewards");
  const rewards = await SupplyRewards.deploy(
    deployer.address,
    await pool.getAddress(),
    await rewardToken.getAddress(),
    EPOCH_DURATION,
    REWARD_PER_EPOCH
  );

  await rewardToken.mint(deployer.address, ethers.parseUnits("1000000", 18));
  await rewardToken.connect(deployer).approve(await rewards.getAddress(), ethers.parseUnits("1000000", 18));
  await rewards.connect(deployer).fund(ethers.parseUnits("1000000", 18));

  await collateralToken.mint(alice.address, ethers.parseUnits("1000", 18));
  await collateralToken.mint(bob.address, ethers.parseUnits("1000", 18));

  return { deployer, alice, bob, collateralToken, pool, rewards, rewardToken, collateralAssetId };
}

function commitmentUpdateInputs({ oldCommitment, newCommitment, delta, isIncrease, assetId }) {
  return [oldCommitment, newCommitment, delta, isIncrease ? 1n : 0n, assetId];
}

async function openPosition(pool, collateralToken, user, collateralAssetId, amount, newCommitment) {
  await collateralToken.connect(user).approve(await pool.getAddress(), amount);
  await pool
    .connect(user)
    .supplyCollateral(
      collateralAssetId,
      amount,
      newCommitment,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment, delta: amount, isIncrease: true, assetId: collateralAssetId })
    );
}

describe("SupplyRewards", function () {
  it("rejects checkpointing without an active position", async function () {
    const { alice, rewards } = await deployFixture();
    await expect(rewards.connect(alice).checkpoint()).to.be.revertedWithCustomError(rewards, "NoActivePosition");
  });

  it("credits no reward on the first checkpoint, only once a second consecutive epoch is checkpointed", async function () {
    const { alice, collateralToken, pool, rewards, collateralAssetId } = await deployFixture();
    await openPosition(pool, collateralToken, alice, collateralAssetId, ethers.parseUnits("100", 18), 111n);

    await rewards.connect(alice).checkpoint();
    expect((await rewards.checkpoints(alice.address)).pendingReward).to.equal(0n);

    await time.increase(EPOCH_DURATION);
    await rewards.connect(alice).checkpoint();
    expect((await rewards.checkpoints(alice.address)).pendingReward).to.equal(REWARD_PER_EPOCH);
  });

  it("does not credit a reward across a skipped epoch", async function () {
    const { alice, collateralToken, pool, rewards, collateralAssetId } = await deployFixture();
    await openPosition(pool, collateralToken, alice, collateralAssetId, ethers.parseUnits("100", 18), 111n);

    await rewards.connect(alice).checkpoint();
    await time.increase(2n * EPOCH_DURATION);
    await rewards.connect(alice).checkpoint();
    expect((await rewards.checkpoints(alice.address)).pendingReward).to.equal(0n);

    await time.increase(EPOCH_DURATION);
    await rewards.connect(alice).checkpoint();
    expect((await rewards.checkpoints(alice.address)).pendingReward).to.equal(REWARD_PER_EPOCH);
  });

  it("does not double-credit for multiple checkpoints inside the same epoch", async function () {
    const { alice, collateralToken, pool, rewards, collateralAssetId } = await deployFixture();
    await openPosition(pool, collateralToken, alice, collateralAssetId, ethers.parseUnits("100", 18), 111n);

    await rewards.connect(alice).checkpoint();
    await time.increase(EPOCH_DURATION);
    await rewards.connect(alice).checkpoint();
    await rewards.connect(alice).checkpoint();
    expect((await rewards.checkpoints(alice.address)).pendingReward).to.equal(REWARD_PER_EPOCH);
  });

  it("lets a user claim their accrued reward and resets it to zero", async function () {
    const { alice, collateralToken, pool, rewards, rewardToken, collateralAssetId } = await deployFixture();
    await openPosition(pool, collateralToken, alice, collateralAssetId, ethers.parseUnits("100", 18), 111n);

    await rewards.connect(alice).checkpoint();
    await time.increase(EPOCH_DURATION);
    await rewards.connect(alice).checkpoint();

    await expect(rewards.connect(alice).claim()).to.changeTokenBalance(rewardToken, alice, REWARD_PER_EPOCH);
    expect((await rewards.checkpoints(alice.address)).pendingReward).to.equal(0n);
    await expect(rewards.connect(alice).claim()).to.be.revertedWithCustomError(rewards, "ZeroAmount");
  });

  it("accrues rewards independently across multiple users", async function () {
    const { alice, bob, collateralToken, pool, rewards, collateralAssetId } = await deployFixture();
    await openPosition(pool, collateralToken, alice, collateralAssetId, ethers.parseUnits("100", 18), 111n);
    await openPosition(pool, collateralToken, bob, collateralAssetId, ethers.parseUnits("50", 18), 222n);

    await rewards.connect(alice).checkpoint();
    await time.increase(EPOCH_DURATION);
    await rewards.connect(alice).checkpoint();
    await rewards.connect(bob).checkpoint();

    expect((await rewards.checkpoints(alice.address)).pendingReward).to.equal(REWARD_PER_EPOCH);
    expect((await rewards.checkpoints(bob.address)).pendingReward).to.equal(0n);
  });

  it("only the owner can change the epoch duration and reward rate", async function () {
    const { alice, rewards } = await deployFixture();
    await expect(rewards.connect(alice).setRewardPerEpoch(0)).to.be.revertedWithCustomError(rewards, "OwnableUnauthorizedAccount");
    await expect(rewards.connect(alice).setEpochDuration(1)).to.be.revertedWithCustomError(rewards, "OwnableUnauthorizedAccount");
  });

  it("lets anyone fund the pool, not just the owner — ProtocolTreasury relies on this to top it up from swept interest", async function () {
    const { alice, rewards, rewardToken } = await deployFixture();
    await rewardToken.mint(alice.address, ethers.parseUnits("100", 18));
    await rewardToken.connect(alice).approve(await rewards.getAddress(), ethers.parseUnits("100", 18));
    await expect(rewards.connect(alice).fund(ethers.parseUnits("100", 18))).to.emit(rewards, "Funded").withArgs(ethers.parseUnits("100", 18));
  });
});
