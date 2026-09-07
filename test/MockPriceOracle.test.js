const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("MockPriceOracle", function () {
  async function deployFixture() {
    const [owner, stranger] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    const token = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
    const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
    const oracle = await MockPriceOracle.deploy();
    return { owner, stranger, token, oracle };
  }

  it("refreshTimestamp lets anyone bump updatedAt to now without changing the price", async function () {
    const { stranger, token, oracle } = await deployFixture();
    await oracle.setPrice(await token.getAddress(), 200_000_000n);

    await time.increase(2 * 60 * 60); // well past any real staleness window
    await oracle.connect(stranger).refreshTimestamp(await token.getAddress());

    const [price, updatedAt] = await oracle.getPrice(await token.getAddress());
    const now = await time.latest();
    expect(price).to.equal(200_000_000n);
    expect(updatedAt).to.equal(BigInt(now));
  });

  it("refreshTimestamp rejects an asset that was never priced — it can't manufacture a price, only extend one that already exists", async function () {
    const { stranger, oracle } = await deployFixture();
    const neverPriced = ethers.Wallet.createRandom().address;
    await expect(oracle.connect(stranger).refreshTimestamp(neverPriced)).to.be.revertedWith("MockPriceOracle: no price set");
  });

  it("setPrice and setPriceWithTimestamp stay owner-only — refreshTimestamp is the only permissionless path, and it can't touch the price value", async function () {
    const { stranger, token, oracle } = await deployFixture();
    await expect(oracle.connect(stranger).setPrice(await token.getAddress(), 1n)).to.be.revertedWith("MockPriceOracle: not owner");
    await expect(oracle.connect(stranger).setPriceWithTimestamp(await token.getAddress(), 1n, 0n)).to.be.revertedWith("MockPriceOracle: not owner");
  });
});
