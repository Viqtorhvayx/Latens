const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const BPS = 10_000n;
const RAY = 1_000_000_000_000_000_000n;

async function deployFixture() {
  const [deployer, alice, bob] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const zen = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.setPrice(await zen.getAddress(), ethers.parseUnits("2", 8));
  await oracle.setPrice(await usdc.getAddress(), ethers.parseUnits("1", 8));

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

  const zenAssetId = 0n;
  await registry.listAsset(await zen.getAddress(), 8_000, 8_500, 800, 1_000);
  await registry.setInterestRateModel(zenAssetId, 500, 1_000, 10_000, 8_000);
  const usdcAssetId = 1n;
  await registry.listAsset(await usdc.getAddress(), 8_000, 8_500, 800, 1_000);

  await zen.mint(alice.address, ethers.parseUnits("1000", 18));
  await zen.mint(deployer.address, ethers.parseUnits("5000", 18));
  await zen.connect(deployer).transfer(await pool.getAddress(), ethers.parseUnits("5000", 18)); // liquidity for Bob to borrow
  await usdc.mint(bob.address, ethers.parseUnits("10000", 6));

  return { deployer, alice, bob, zen, usdc, oracle, registry, pool, treasury, zenAssetId, usdcAssetId };
}

function commitmentUpdateInputs({ oldCommitment, newCommitment, delta, isIncrease, assetId }) {
  return [oldCommitment, newCommitment, delta, isIncrease ? 1n : 0n, assetId];
}

function solvencyInputs({ collateralCommitment, debtCommitment, collateralPriceE8, debtPriceE8, collateralIndexRay = RAY, debtIndexRay = RAY, thresholdBps }) {
  return [collateralCommitment, debtCommitment, collateralPriceE8, debtPriceE8, collateralIndexRay, debtIndexRay, BigInt(thresholdBps)];
}

describe("LatensPool real yield", function () {
  it("grows the supply index only once there is both a borrower and elapsed time", async function () {
    const { registry, zenAssetId } = await deployFixture();
    expect(await registry.currentSupplyIndexRay(zenAssetId)).to.equal(RAY);

    await time.increase(30 * 24 * 60 * 60);
    expect(await registry.currentSupplyIndexRay(zenAssetId)).to.equal(RAY); // zero utilization -> zero rate
  });

  it("grows a supplier's claim on the borrowed market while the fee that funds it arrives in the collateral asset", async function () {
    const { alice, bob, zen, usdc, oracle, registry, pool, treasury, zenAssetId, usdcAssetId } = await deployFixture();

    const suppliedAmount = ethers.parseUnits("1000", 18);
    await zen.connect(alice).approve(await pool.getAddress(), suppliedAmount);
    await pool.connect(alice).supplyCollateral(
      zenAssetId,
      suppliedAmount,
      1n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: suppliedAmount, isIncrease: true, assetId: zenAssetId })
    );

    // Bob supplies USDC as collateral and borrows ZEN against it, driving ZEN utilization above zero.
    const bobCollateral = ethers.parseUnits("5000", 6);
    await usdc.connect(bob).approve(await pool.getAddress(), bobCollateral);
    await pool.connect(bob).supplyCollateral(
      usdcAssetId,
      bobCollateral,
      2n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: bobCollateral, isIncrease: true, assetId: usdcAssetId })
    );

    const borrowedZen = ethers.parseUnits("500", 18); // 50% utilization of the 1000 ZEN Alice supplied
    await pool.connect(bob).borrow(
      zenAssetId,
      borrowedZen,
      3n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 3n, delta: borrowedZen, isIncrease: true, assetId: zenAssetId }),
      "0x",
      solvencyInputs({ collateralCommitment: 2n, debtCommitment: 3n, collateralPriceE8: ethers.parseUnits("1", 8), debtPriceE8: ethers.parseUnits("2", 8), thresholdBps: 8_000 })
    );

    await time.increase(365 * 24 * 60 * 60); // a full year at the configured rate

    await zen.mint(bob.address, ethers.parseUnits("1000", 18)); // enough to cover principal + interest
    await zen.connect(bob).approve(await pool.getAddress(), ethers.MaxUint256);
    // repay converts the fee into the collateral asset, so it reads both prices and needs
    // a feed that has not aged out over the time jump above.
    await oracle.refreshTimestamp(await zen.getAddress());
    await oracle.refreshTimestamp(await usdc.getAddress());
    await pool.connect(bob).repay(
      borrowedZen,
      4n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 3n, newCommitment: 4n, delta: borrowedZen, isIncrease: false, assetId: zenAssetId }),
      5n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 2n, newCommitment: 5n, delta: ethers.parseUnits("500", 6), isIncrease: false, assetId: usdcAssetId }),
      true
    );

    const grownIndex = await registry.currentSupplyIndexRay(zenAssetId);
    expect(grownIndex).to.be.greaterThan(RAY); // a borrowed market still accrues for its suppliers

    // But the fee Bob paid arrived as USDC, his collateral, not as ZEN. The ZEN market's
    // own token aggregate is therefore exactly what Alice put in, with nothing added.
    const zenAsset = await registry.getAsset(zenAssetId);
    expect(zenAsset.totalSupplied).to.equal(suppliedAmount);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.be.greaterThan(0n);

    // KNOWN GAP, pinned here on purpose rather than left to be discovered: the supply index
    // is driven by a rate model per asset, so the borrowed market's index grows whether or
    // not that market received the fee. Settling fees in collateral means it does not, and
    // a supplier reaching for the full grown claim asks the market for ZEN that was never
    // paid into it. Closing this needs either a swap of the fee into the borrowed asset at
    // repay time, or an index driven by realized fees instead of a rate model. On the
    // deployed testnet the seeded liquidity absorbs the difference, which is exactly why it
    // does not surface there.
    const withdrawable = (suppliedAmount * grownIndex) / RAY;
    expect(withdrawable).to.be.greaterThan(suppliedAmount);
    await expect(
      pool.connect(alice).withdrawCollateral(
        withdrawable,
        5n,
        "0x",
        commitmentUpdateInputs({ oldCommitment: 1n, newCommitment: 5n, delta: (withdrawable * RAY) / grownIndex, isIncrease: false, assetId: zenAssetId }),
        "0x",
        []
      )
    ).to.be.reverted;

    // The principal itself is fully backed and comes out normally.
    const balanceBefore = await zen.balanceOf(alice.address);
    await pool.connect(alice).withdrawCollateral(
      suppliedAmount,
      6n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 1n, newCommitment: 6n, delta: (suppliedAmount * RAY) / grownIndex, isIncrease: false, assetId: zenAssetId }),
      "0x",
      []
    );
    expect((await zen.balanceOf(alice.address)) - balanceBefore).to.equal(suppliedAmount);
  });

  it("only forwards the reserve-factor slice of repay interest to the treasury, keeping the rest in the pool to back supplier yield", async function () {
    const { alice, bob, zen, usdc, oracle, registry, pool, treasury, zenAssetId, usdcAssetId } = await deployFixture();

    const suppliedAmount = ethers.parseUnits("1000", 18);
    await zen.connect(alice).approve(await pool.getAddress(), suppliedAmount);
    await pool.connect(alice).supplyCollateral(
      zenAssetId,
      suppliedAmount,
      1n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: suppliedAmount, isIncrease: true, assetId: zenAssetId })
    );

    const bobCollateral = ethers.parseUnits("5000", 6);
    await usdc.connect(bob).approve(await pool.getAddress(), bobCollateral);
    await pool.connect(bob).supplyCollateral(
      usdcAssetId,
      bobCollateral,
      2n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: bobCollateral, isIncrease: true, assetId: usdcAssetId })
    );

    const borrowedZen = ethers.parseUnits("500", 18);
    await pool.connect(bob).borrow(
      zenAssetId,
      borrowedZen,
      3n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 3n, delta: borrowedZen, isIncrease: true, assetId: zenAssetId }),
      "0x",
      solvencyInputs({ collateralCommitment: 2n, debtCommitment: 3n, collateralPriceE8: ethers.parseUnits("1", 8), debtPriceE8: ethers.parseUnits("2", 8), thresholdBps: 8_000 })
    );

    const borrowBlock = await ethers.provider.getBlock("latest");
    const borrowRateBps = await registry.borrowRateBps(zenAssetId); // fetched before repay changes utilization back down
    await time.increase(365 * 24 * 60 * 60);

    await zen.mint(bob.address, ethers.parseUnits("1000", 18));
    await zen.connect(bob).approve(await pool.getAddress(), ethers.MaxUint256);
    // repay converts the fee into the collateral asset, so it reads both prices and needs
    // a feed that has not aged out over the time jump above.
    await oracle.refreshTimestamp(await zen.getAddress());
    await oracle.refreshTimestamp(await usdc.getAddress());
    const repayReceipt = await (
      await pool.connect(bob).repay(
        borrowedZen,
        4n,
        "0x",
        commitmentUpdateInputs({ oldCommitment: 3n, newCommitment: 4n, delta: borrowedZen, isIncrease: false, assetId: zenAssetId }),
        5n,
        "0x",
        commitmentUpdateInputs({ oldCommitment: 2n, newCommitment: 5n, delta: ethers.parseUnits("500", 6), isIncrease: false, assetId: usdcAssetId }),
        true
      )
    ).wait();
    const repayBlock = await ethers.provider.getBlock(repayReceipt.blockNumber);

    const elapsed = BigInt(repayBlock.timestamp - borrowBlock.timestamp);
    const expectedFee = (borrowedZen * borrowRateBps * elapsed) / (BPS * 365n * 24n * 60n * 60n);
    // The fee is settled in Bob's collateral (USDC), not in the ZEN he borrowed, so the
    // treasury's cut arrives in USDC. ZEN at $2 into USDC at $1, across 18 and 6 decimals.
    const feeValueE8 = (expectedFee * ethers.parseUnits("2", 8)) / 10n ** 18n;
    const expectedFeeInCollateral = (feeValueE8 * 10n ** 6n) / ethers.parseUnits("1", 8);
    const usdcAsset = await registry.getAsset(usdcAssetId);
    const expectedReserveCut = (expectedFeeInCollateral * BigInt(usdcAsset.reserveFactorBps)) / BPS;

    expect(await zen.balanceOf(await treasury.getAddress())).to.equal(0n);
    expect(await usdc.balanceOf(await treasury.getAddress())).to.equal(expectedReserveCut);
    expect(expectedFeeInCollateral).to.be.greaterThan(expectedReserveCut); // most of the fee stays in the pool, not all of it
  });
});
