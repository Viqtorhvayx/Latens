const { expect } = require("chai");
const { ethers } = require("hardhat");
const { anyValue } = require("@nomicfoundation/hardhat-chai-matchers/withArgs");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// These tests exercise LatensPool's state machine (accounting, access control, proof
// binding) against MockVerifier, which accepts any proof. They do NOT test any real
// zero-knowledge circuit — there isn't one yet. What they prove is that the contract
// correctly binds each call's arguments into the public inputs it hands the verifier,
// so a proof generated for one call can't be replayed against another.

const BPS = 10_000n;

async function deployFixture() {
  const [deployer, alice, liquidator] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const collateralToken = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
  const debtToken = await MockERC20.deploy("USD Coin", "USDC", 6);

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.setPrice(await collateralToken.getAddress(), ethers.parseUnits("2", 8)); // $2 / ZEN
  await oracle.setPrice(await debtToken.getAddress(), ethers.parseUnits("1", 8)); // $1 / USDC

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false); // permissive mode

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

  // collateral: 80% LTV, 85% liquidation threshold, 8% bonus, 10% reserve factor
  const collateralAssetId = 0n;
  await registry.listAsset(await collateralToken.getAddress(), 8_000, 8_500, 800, 1_000);
  // debt asset: params only matter for its own reserveFactor / listing; use loose values
  const debtAssetId = 1n;
  await registry.listAsset(await debtToken.getAddress(), 8_000, 8_500, 800, 1_000);

  await collateralToken.mint(alice.address, ethers.parseUnits("1000", 18));
  await debtToken.mint(deployer.address, ethers.parseUnits("1000000", 6));
  await debtToken.mint(liquidator.address, ethers.parseUnits("100000", 6));
  // seed pool liquidity so borrow() has USDC to lend out
  await debtToken.connect(deployer).transfer(await pool.getAddress(), ethers.parseUnits("500000", 6));

  return { deployer, alice, liquidator, collateralToken, debtToken, oracle, verifier, registry, treasury, stakingPool, pool, collateralAssetId, debtAssetId };
}

function commitmentUpdateInputs({ oldCommitment, newCommitment, delta, isIncrease, assetId }) {
  return [oldCommitment, newCommitment, delta, isIncrease ? 1n : 0n, assetId];
}

const RAY = 1_000_000_000_000_000_000n;

function solvencyInputs({ collateralCommitment, debtCommitment, collateralPriceE8, debtPriceE8, collateralIndexRay = RAY, debtIndexRay = RAY, thresholdBps }) {
  return [collateralCommitment, debtCommitment, collateralPriceE8, debtPriceE8, collateralIndexRay, debtIndexRay, BigInt(thresholdBps)];
}

describe("LatensPool", function () {
  it("accepts a collateral deposit and records the public aggregate, not the amount", async function () {
    const { alice, collateralToken, pool, collateralAssetId, registry } = await deployFixture();

    const amount = ethers.parseUnits("100", 18);
    const newCommitment = 12345n;

    await collateralToken.connect(alice).approve(await pool.getAddress(), amount);
    await pool.connect(alice).supplyCollateral(
      collateralAssetId,
      amount,
      newCommitment,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment, delta: amount, isIncrease: true, assetId: collateralAssetId })
    );

    const position = await pool.positions(alice.address);
    expect(position.collateralCommitment).to.equal(newCommitment);
    expect(position.active).to.equal(true);

    const asset = await registry.getAsset(collateralAssetId);
    expect(asset.totalSupplied).to.equal(amount);
  });

  it("CollateralUpdated/DebtUpdated never carry the delta amount, only the new commitment and direction", async function () {
    // `.withArgs` fails if the event carries any argument beyond the four listed here — an
    // `amount` indexed by `user` would let anyone sum one address's own history and recover
    // its running total without ever touching the commitment in storage.
    const { alice, collateralToken, debtToken, pool, collateralAssetId, debtAssetId } = await deployFixture();

    const supplyAmount = ethers.parseUnits("100", 18);
    const supplyCommitment = 111n;
    await collateralToken.connect(alice).approve(await pool.getAddress(), supplyAmount);
    await expect(
      pool
        .connect(alice)
        .supplyCollateral(
          collateralAssetId,
          supplyAmount,
          supplyCommitment,
          "0x",
          commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: supplyCommitment, delta: supplyAmount, isIncrease: true, assetId: collateralAssetId })
        )
    )
      .to.emit(pool, "CollateralUpdated")
      .withArgs(alice.address, collateralAssetId, supplyCommitment, true);

    const collateralPriceE8 = ethers.parseUnits("2", 8);
    const debtPriceE8 = ethers.parseUnits("1", 8);
    const borrowAmount = ethers.parseUnits("50", 6);
    const debtCommitment = 222n;
    await expect(
      pool
        .connect(alice)
        .borrow(
          debtAssetId,
          borrowAmount,
          debtCommitment,
          "0x",
          commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: debtCommitment, delta: borrowAmount, isIncrease: true, assetId: debtAssetId }),
          "0x",
          solvencyInputs({ collateralCommitment: supplyCommitment, debtCommitment, collateralPriceE8, debtPriceE8, thresholdBps: 8_000 })
        )
    )
      .to.emit(pool, "DebtUpdated")
      .withArgs(alice.address, debtAssetId, debtCommitment, true);
  });

  it("rejects a commitment-update proof whose public inputs don't match the call", async function () {
    const { alice, collateralToken, pool, collateralAssetId } = await deployFixture();
    const amount = ethers.parseUnits("100", 18);

    await collateralToken.connect(alice).approve(await pool.getAddress(), amount);
    await expect(
      pool.connect(alice).supplyCollateral(
        collateralAssetId,
        amount,
        999n,
        "0x",
        commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 111n /* mismatched */, delta: amount, isIncrease: true, assetId: collateralAssetId })
      )
    ).to.be.revertedWithCustomError(pool, "InvalidProof");
  });

  it("lets a solvent borrower borrow against deposited collateral", async function () {
    const { alice, collateralToken, debtToken, pool, collateralAssetId, debtAssetId } = await deployFixture();

    const collateralAmount = ethers.parseUnits("1000", 18); // 1000 ZEN @ $2 = $2000
    await collateralToken.connect(alice).approve(await pool.getAddress(), collateralAmount);
    await pool.connect(alice).supplyCollateral(
      collateralAssetId,
      collateralAmount,
      1n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId })
    );

    // borrow $1000 of USDC — 50% of $2000 collateral value, comfortably under 80% LTV
    const borrowAmount = ethers.parseUnits("1000", 6);
    await pool.connect(alice).borrow(
      debtAssetId,
      borrowAmount,
      2n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: borrowAmount, isIncrease: true, assetId: debtAssetId }),
      "0x",
      solvencyInputs({
        collateralCommitment: 1n,
        debtCommitment: 2n,
        collateralPriceE8: ethers.parseUnits("2", 8),
        debtPriceE8: ethers.parseUnits("1", 8),
        thresholdBps: 8_000,
      })
    );

    expect(await debtToken.balanceOf(alice.address)).to.equal(borrowAmount);
    const position = await pool.positions(alice.address);
    expect(position.debtCommitment).to.equal(2n);
    expect(position.hasDebt).to.equal(true);
  });

  it("repay pulls exactly the principal and settles the interest against collateral, whose reserve share flows to the treasury and on to ZEN staking", async function () {
    const { alice, deployer, collateralToken, debtToken, oracle, registry, pool, treasury, stakingPool, collateralAssetId, debtAssetId } = await deployFixture();

    await registry.setInterestRateModel(debtAssetId, 500, 1_000, 10_000, 8_000);

    const collateralAmount = ethers.parseUnits("1000", 18);
    await collateralToken.connect(alice).approve(await pool.getAddress(), collateralAmount);
    await pool.connect(alice).supplyCollateral(collateralAssetId, collateralAmount, 1n, "0x", commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId }));

    const borrowAmount = ethers.parseUnits("1000", 6);
    const borrowReceipt = await (
      await pool.connect(alice).borrow(
        debtAssetId, borrowAmount, 2n, "0x",
        commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: borrowAmount, isIncrease: true, assetId: debtAssetId }),
        "0x",
        solvencyInputs({ collateralCommitment: 1n, debtCommitment: 2n, collateralPriceE8: ethers.parseUnits("2", 8), debtPriceE8: ethers.parseUnits("1", 8), thresholdBps: 8_000 })
      )
    ).wait();
    const borrowBlock = await ethers.provider.getBlock(borrowReceipt.blockNumber);

    const repayAmount = ethers.parseUnits("500", 6);
    await debtToken.connect(alice).approve(await pool.getAddress(), ethers.MaxUint256);
    await time.increase(30 * 24 * 60 * 60);
    // Settling the fee in collateral means repay now converts across two assets, so it
    // reads both prices and rejects a stale feed like every other price-dependent call.
    await oracle.refreshTimestamp(await collateralToken.getAddress());
    await oracle.refreshTimestamp(await debtToken.getAddress());

    const debtBalanceBefore = await debtToken.balanceOf(alice.address);
    const repayReceipt = await (
      await pool.connect(alice).repay(
        repayAmount, 3n, "0x",
        commitmentUpdateInputs({ oldCommitment: 2n, newCommitment: 3n, delta: repayAmount, isIncrease: false, assetId: debtAssetId }),
        // The collateral side: the fee is burned out of the position's collateral shares.
        // A generous burn is allowed (the pool takes it as a floor), so this covers the
        // exact requirement without having to predict the block's own timestamp.
        4n, "0x",
        commitmentUpdateInputs({ oldCommitment: 1n, newCommitment: 4n, delta: ethers.parseUnits("5", 18), isIncrease: false, assetId: collateralAssetId }),
        false
      )
    ).wait();
    const repayBlock = await ethers.provider.getBlock(repayReceipt.blockNumber);

    const elapsed = BigInt(repayBlock.timestamp - borrowBlock.timestamp);
    const expectedFeeInDebt = (repayAmount * 500n * elapsed) / (BPS * 365n * 24n * 60n * 60n);
    expect(expectedFeeInDebt).to.be.greaterThan(0n);

    // Exactly the principal leaves the borrower's wallet — the whole point of settling the
    // fee against collateral is that a borrower can close a loan with what they borrowed.
    expect(debtBalanceBefore - (await debtToken.balanceOf(alice.address))).to.equal(repayAmount);
    expect(await debtToken.balanceOf(await treasury.getAddress())).to.equal(0n);
    expect(await debtToken.balanceOf(await pool.getAddress())).to.equal(ethers.parseUnits("500000", 6) - borrowAmount + repayAmount);

    // USDC at $1 into ZEN at $2, so the fee is worth half as many ZEN as it was USDC, once
    // the two decimal scales (6 and 18) are normalized through USD.
    const feeValueE8 = (expectedFeeInDebt * ethers.parseUnits("1", 8)) / 10n ** 6n;
    const expectedFeeInCollateral = (feeValueE8 * 10n ** 18n) / ethers.parseUnits("2", 8);
    const expectedReserveCut = (expectedFeeInCollateral * 1_000n) / BPS; // collateral asset's reserveFactorBps
    expect(expectedReserveCut).to.be.greaterThan(0n);

    expect(await collateralToken.balanceOf(await treasury.getAddress())).to.equal(expectedReserveCut);

    await treasury.connect(deployer).sweep(await collateralToken.getAddress());
    const expectedToStaking = (expectedReserveCut * 1_750n) / BPS;
    expect(await stakingPool.totalContributed(await collateralToken.getAddress())).to.equal(expectedToStaking);
  });

  it("quotes zero repay interest when no rate model has been configured for the asset", async function () {
    const { registry, debtAssetId } = await deployFixture();
    expect(await registry.quoteRepayInterestFee(debtAssetId, ethers.parseUnits("500", 6), 0n)).to.equal(0n);
    expect(await registry.borrowRateBps(debtAssetId)).to.equal(0n);
  });

  it("lets a keeper liquidate an eligible position and seize collateral plus bonus", async function () {
    const { alice, liquidator, collateralToken, debtToken, pool, registry, collateralAssetId, debtAssetId } = await deployFixture();

    const collateralAmount = ethers.parseUnits("1000", 18);
    await collateralToken.connect(alice).approve(await pool.getAddress(), collateralAmount);
    await pool.connect(alice).supplyCollateral(collateralAssetId, collateralAmount, 1n, "0x", commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId }));

    const borrowAmount = ethers.parseUnits("1500", 6); // 75% of $2000 — under 80% LTV at origination
    await pool.connect(alice).borrow(
      debtAssetId, borrowAmount, 2n, "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: borrowAmount, isIncrease: true, assetId: debtAssetId }),
      "0x",
      solvencyInputs({ collateralCommitment: 1n, debtCommitment: 2n, collateralPriceE8: ethers.parseUnits("2", 8), debtPriceE8: ethers.parseUnits("1", 8), thresholdBps: 8_000 })
    );

    const repayAmount = ethers.parseUnits("500", 6);
    const seizedCollateralAmount = ethers.parseUnits("270", 18); // includes the 8% liquidation bonus, computed off-chain by the (future) circuit
    const asset = await registry.getAsset(collateralAssetId);

    await debtToken.connect(liquidator).approve(await pool.getAddress(), repayAmount);
    await pool.connect(liquidator).liquidate(
      alice.address,
      repayAmount,
      seizedCollateralAmount,
      4n,
      5n,
      "0x",
      [1n, 2n, 4n, 5n, ethers.parseUnits("2", 8), ethers.parseUnits("1", 8), RAY, RAY, BigInt(asset.liquidationThresholdBps), BigInt(asset.liquidationBonusBps), seizedCollateralAmount, repayAmount]
    );

    expect(await collateralToken.balanceOf(liquidator.address)).to.equal(seizedCollateralAmount);
    const position = await pool.positions(alice.address);
    expect(position.collateralCommitment).to.equal(4n);
    expect(position.debtCommitment).to.equal(5n);
  });

  it("blocks all state-changing calls while paused", async function () {
    const { deployer, alice, collateralToken, pool, collateralAssetId } = await deployFixture();
    await pool.connect(deployer).pause();

    const amount = ethers.parseUnits("10", 18);
    await collateralToken.connect(alice).approve(await pool.getAddress(), amount);
    await expect(
      pool.connect(alice).supplyCollateral(collateralAssetId, amount, 1n, "0x", commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: amount, isIncrease: true, assetId: collateralAssetId }))
    ).to.be.revertedWithCustomError(pool, "EnforcedPause");
  });

  it("rejects an invalid proof once the mock verifier is switched to strict mode", async function () {
    const { alice, collateralToken, pool, verifier, collateralAssetId } = await deployFixture();
    await verifier.setStrict(true);

    const amount = ethers.parseUnits("10", 18);
    await collateralToken.connect(alice).approve(await pool.getAddress(), amount);
    await expect(
      pool.connect(alice).supplyCollateral(collateralAssetId, amount, 1n, "0x" /* not keccak256(publicInputs) */, commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: amount, isIncrease: true, assetId: collateralAssetId }))
    ).to.be.revertedWithCustomError(pool, "InvalidProof");
  });

  it("rejects a price oracle reporting a timestamp in the future with a clear error, not a raw underflow panic", async function () {
    const { alice, collateralToken, debtToken, oracle, pool, collateralAssetId, debtAssetId } = await deployFixture();

    const collateralAmount = ethers.parseUnits("1000", 18);
    await collateralToken.connect(alice).approve(await pool.getAddress(), collateralAmount);
    await pool.connect(alice).supplyCollateral(
      collateralAssetId,
      collateralAmount,
      1n,
      "0x",
      commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 1n, delta: collateralAmount, isIncrease: true, assetId: collateralAssetId })
    );

    // A real IPriceOracle implementation is out of LatensPool's control — nothing stops one
    // (clock skew, a buggy or compromised adapter) from reporting updatedAt > block.timestamp.
    // Without the `updatedAt > block.timestamp` guard in `_requireFreshPrice`, this would
    // underflow `block.timestamp - updatedAt` and revert with a generic Panic(0x11) instead.
    const future = (await ethers.provider.getBlock("latest")).timestamp + 3600;
    await oracle.setPriceWithTimestamp(await collateralToken.getAddress(), ethers.parseUnits("2", 8), future);

    const borrowAmount = ethers.parseUnits("100", 6);
    await expect(
      pool.connect(alice).borrow(
        debtAssetId,
        borrowAmount,
        2n,
        "0x",
        commitmentUpdateInputs({ oldCommitment: 0n, newCommitment: 2n, delta: borrowAmount, isIncrease: true, assetId: debtAssetId }),
        "0x",
        solvencyInputs({ collateralCommitment: 1n, debtCommitment: 2n, collateralPriceE8: ethers.parseUnits("2", 8), debtPriceE8: ethers.parseUnits("1", 8), thresholdBps: 8_000 })
      )
    ).to.be.revertedWithCustomError(pool, "StaleOraclePrice");
  });

  it("publishViewingNote emits an opaque ciphertext without touching any state", async function () {
    const { alice, pool, collateralAssetId } = await deployFixture();

    const ciphertext = "0x1234abcd";
    await expect(pool.connect(alice).publishViewingNote(collateralAssetId, false, ciphertext))
      .to.emit(pool, "ViewingNotePublished")
      .withArgs(alice.address, collateralAssetId, false, anyValue, ciphertext);

    // No position needs to exist, and none is created — this is a pure event log entry.
    const position = await pool.positions(alice.address);
    expect(position.active).to.equal(false);
  });
});
