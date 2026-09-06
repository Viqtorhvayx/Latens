const { expect } = require("chai");
const { ethers } = require("hardhat");

// AssetRegistry's interest-rate model math, isolated from LatensPool's proof plumbing —
// see LatensPool.test.js for the end-to-end repay-fee test.

async function deployRegistry() {
  const [deployer] = await ethers.getSigners();
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);

  const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
  const registry = await AssetRegistry.deploy(deployer.address);
  await registry.setPool(deployer.address); // deployer acts as "the pool" for recordSupply/recordBorrow

  const assetId = 0n;
  await registry.listAsset(await token.getAddress(), 8_000, 8_500, 800, 1_000); // 10% reserve factor

  return { registry, assetId };
}

describe("AssetRegistry interest rate model", function () {
  it("returns zero utilization and zero rate before any model is configured", async function () {
    const { registry, assetId } = await deployRegistry();
    expect(await registry.utilizationBps(assetId)).to.equal(0n);
    expect(await registry.borrowRateBps(assetId)).to.equal(0n);
    expect(await registry.supplyRateBps(assetId)).to.equal(0n);
  });

  it("computes utilization as totalBorrowed / totalSupplied in bps", async function () {
    const { registry, assetId } = await deployRegistry();
    await registry.recordSupply(assetId, 1_000n, true);
    await registry.recordBorrow(assetId, 400n, true);
    expect(await registry.utilizationBps(assetId)).to.equal(4_000n); // 40%
  });

  it("charges only the base rate below the kink", async function () {
    const { registry, assetId } = await deployRegistry();
    await registry.setInterestRateModel(assetId, 200, 1_000, 30_000, 8_000); // 2% base, kink at 80%
    await registry.recordSupply(assetId, 1_000n, true);
    await registry.recordBorrow(assetId, 400n, true); // 40% utilization, below the 80% kink

    // 200 + (4000 * 1000) / 8000 = 200 + 500 = 700 bps
    expect(await registry.borrowRateBps(assetId)).to.equal(700n);
  });

  it("charges base + full slope1 exactly at the kink", async function () {
    const { registry, assetId } = await deployRegistry();
    await registry.setInterestRateModel(assetId, 200, 1_000, 30_000, 8_000);
    await registry.recordSupply(assetId, 1_000n, true);
    await registry.recordBorrow(assetId, 800n, true); // exactly 80% utilization

    expect(await registry.borrowRateBps(assetId)).to.equal(1_200n); // 200 + 1000
  });

  it("switches to the steeper slope2 above the kink", async function () {
    const { registry, assetId } = await deployRegistry();
    await registry.setInterestRateModel(assetId, 200, 1_000, 30_000, 8_000);
    await registry.recordSupply(assetId, 1_000n, true);
    await registry.recordBorrow(assetId, 900n, true); // 90% utilization, 10% above the kink

    // 200 + 1000 + (1000 * 30000) / 2000 = 200 + 1000 + 15000 = 16200 bps
    expect(await registry.borrowRateBps(assetId)).to.equal(16_200n);
  });

  it("derives supplyRateBps from borrowRateBps, utilization, and the reserve factor", async function () {
    const { registry, assetId } = await deployRegistry();
    await registry.setInterestRateModel(assetId, 200, 1_000, 30_000, 8_000);
    await registry.recordSupply(assetId, 1_000n, true);
    await registry.recordBorrow(assetId, 400n, true); // borrowRateBps = 700, utilization = 4000

    // gross = 700 * 4000 / 10000 = 280; net of 10% reserve factor = 280 * 9000 / 10000 = 252
    expect(await registry.supplyRateBps(assetId)).to.equal(252n);
  });

  it("rejects a kink of 0 or >= 100%", async function () {
    const { registry, assetId } = await deployRegistry();
    await expect(registry.setInterestRateModel(assetId, 0, 0, 0, 0)).to.be.revertedWithCustomError(registry, "InvalidRiskParams");
    await expect(registry.setInterestRateModel(assetId, 0, 0, 0, 10_000)).to.be.revertedWithCustomError(registry, "InvalidRiskParams");
  });

  it("quotes a repay interest fee proportional to amount, rate, and elapsed time", async function () {
    const { registry, assetId } = await deployRegistry();
    await registry.setInterestRateModel(assetId, 500, 0, 0, 8_000); // flat 5% APR, no utilization dependence needed here
    const now = await ethers.provider.getBlock("latest").then((b) => b.timestamp);
    const oneYearAgo = now - 365 * 24 * 60 * 60;

    const fee = await registry.quoteRepayInterestFee(assetId, ethers.parseUnits("1000", 6), oneYearAgo);
    // ~5% of 1000 USDC over ~1 year — allow a small tolerance for block timestamp drift.
    expect(fee).to.be.closeTo(ethers.parseUnits("50", 6), ethers.parseUnits("1", 6));
  });

  it("quotes zero fee when called at or before the checkpoint timestamp", async function () {
    const { registry, assetId } = await deployRegistry();
    await registry.setInterestRateModel(assetId, 500, 0, 0, 8_000);
    const future = (await ethers.provider.getBlock("latest").then((b) => b.timestamp)) + 1_000_000;
    expect(await registry.quoteRepayInterestFee(assetId, 1_000n, future)).to.equal(0n);
  });
});
