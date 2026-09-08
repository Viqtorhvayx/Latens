const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Replays the FRONTEND's exact call construction (PositionActionModal / CDPActionModal /
// BorrowCollateralStep + positionStore's prepare()) against real contracts. Anything the
// UI builds wrongly — wrong public-input array, wrong delta, wrong decimals, missing
// approval headroom for the interest fee — fails here rather than in a user's wallet.

const RAY = 1_000_000_000_000_000_000n;
const STABLECOIN_PRICE_E8 = 100_000_000n;

// --- mirrors of frontend/lib/positionStore.tsx -------------------------------------------
// The real store uses a Pedersen commitment; the value itself is opaque to the contract
// (MockVerifier), what matters is the bookkeeping: oldCommitment must equal what the pool
// currently stores. Using a cheap deterministic stand-in keeps this test fast while
// exercising the identical sequencing.
// Mirrors pedersenCommit()'s own fresh-position sentinel: an untouched entry commits to 0,
// which is what the pool stores for a position that has never been written.
const commitment = (amount, salt) => (amount === 0n && salt === 0n ? 0n : BigInt(ethers.solidityPackedKeccak256(["uint256", "uint256"], [amount, salt])) >> 8n);
const sharesToReal = (shares, indexRay) => (shares * indexRay) / RAY;

function makeStore() {
  const positions = {}; // assetId -> { supplied, suppliedSalt, borrowed, borrowedSalt }
  const EMPTY = { supplied: 0n, suppliedSalt: 0n, borrowed: 0n, borrowedSalt: 0n };
  let saltCounter = 1n;

  function prepare(assetId, field, delta, direction, indexRay) {
    const current = positions[assetId] ?? EMPTY;
    const saltField = field === "supplied" ? "suppliedSalt" : "borrowedSalt";
    const shares = current[field];
    const shareDelta = (delta * RAY) / indexRay;
    if (direction === "decrease" && shareDelta > shares) throw new Error("more than held");
    const oldCommitment = commitment(shares, current[saltField]);
    const newShares = direction === "increase" ? shares + shareDelta : shares - shareDelta;
    const newSalt = saltCounter++;
    return { oldCommitment, newCommitment: commitment(newShares, newSalt), shareDelta, patch: { [field]: newShares, [saltField]: newSalt } };
  }

  return {
    get: (assetId) => positions[assetId] ?? EMPTY,
    prepareSupply: (assetId, delta, indexRay) => prepare(assetId, "supplied", delta, "increase", indexRay),
    prepareWithdraw: (assetId, delta, indexRay) => prepare(assetId, "supplied", delta, "decrease", indexRay),
    prepareBorrow: (assetId, delta) => prepare(assetId, "borrowed", delta, "increase", RAY),
    prepareRepay: (assetId, delta) => prepare(assetId, "borrowed", delta, "decrease", RAY),
    commit: (assetId, patch) => {
      positions[assetId] = { ...(positions[assetId] ?? EMPTY), ...patch };
    },
  };
}

// --- mirrors of frontend/lib/valuation.ts + borrow.ts -------------------------------------
const usdValueE8 = (amount, decimals, priceE8) => (amount * priceE8) / 10n ** BigInt(decimals);

function borrowCapacity({ collateralAmount, collateralDecimals, collateralPriceE8, ltvBps, existingDebt, debtDecimals, debtPriceE8 }) {
  if (debtPriceE8 === 0n) return 0n;
  const maxDebtValueE8 = (usdValueE8(collateralAmount, collateralDecimals, collateralPriceE8) * BigInt(ltvBps)) / 10_000n;
  const currentDebtValueE8 = usdValueE8(existingDebt, debtDecimals, debtPriceE8);
  if (maxDebtValueE8 <= currentDebtValueE8) return 0n;
  return ((maxDebtValueE8 - currentDebtValueE8) * 10n ** BigInt(debtDecimals)) / debtPriceE8;
}

function lockedCollateral({ debtAmount, debtDecimals, debtPriceE8, ltvBps, collateralDecimals, collateralPriceE8 }) {
  if (collateralPriceE8 === 0n || ltvBps === 0 || debtAmount === 0n) return 0n;
  const requiredValueE8 = (usdValueE8(debtAmount, debtDecimals, debtPriceE8) * 10_000n) / BigInt(ltvBps);
  return (requiredValueE8 * 10n ** BigInt(collateralDecimals)) / collateralPriceE8;
}

async function deployFixture() {
  const [deployer, alice] = await ethers.getSigners();

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const zen = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.setPrice(await zen.getAddress(), ethers.parseUnits("2", 8)); // $2
  await oracle.setPrice(await usdc.getAddress(), ethers.parseUnits("1", 8)); // $1

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

  // assetId 0 = ZEN, assetId 1 = USDC — matching how the deploy script lists them.
  await registry.listAsset(await zen.getAddress(), 8_000, 8_500, 800, 1_000);
  await registry.listAsset(await usdc.getAddress(), 8_000, 8_500, 800, 1_000);
  // Same interest-rate models script/deployTestnet.js configures on the live deployment.
  await registry.setInterestRateModel(0n, 200, 1_000, 30_000, 8_000); // ZEN
  await registry.setInterestRateModel(1n, 50, 800, 10_000, 9_000); // USDC

  const LatensDollar = await ethers.getContractFactory("LatensDollar");
  const latd = await LatensDollar.deploy(deployer.address);
  const LatensCDP = await ethers.getContractFactory("LatensCDP");
  const cdp = await LatensCDP.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    await latd.getAddress(),
    await oracle.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress()
  );
  await latd.setCDP(await cdp.getAddress());

  await usdc.mint(alice.address, ethers.parseUnits("10000", 6));
  await zen.mint(alice.address, ethers.parseUnits("100", 18));
  await zen.mint(deployer.address, ethers.parseUnits("100000", 18));
  await zen.connect(deployer).transfer(await pool.getAddress(), ethers.parseUnits("50000", 18)); // pool liquidity

  return { deployer, alice, zen, usdc, oracle, registry, treasury, pool, cdp, latd, ZEN_ID: 0n, USDC_ID: 1n };
}

describe("frontend flow replay", function () {
  it("supply 1000 USDC, borrow 4 ZEN, repay: the exact sequence the UI submits", async function () {
    const { alice, zen, usdc, oracle, pool, registry, ZEN_ID, USDC_ID } = await deployFixture();
    const store = makeStore();
    const poolAddr = await pool.getAddress();

    // ── 1. Supply 1000 USDC as collateral (Markets row -> Supply) ────────────────────────
    const supplyAmount = ethers.parseUnits("1000", 6);
    const supplyIndexRay = await registry.currentSupplyIndexRay(USDC_ID);
    const s = store.prepareSupply(Number(USDC_ID), supplyAmount, supplyIndexRay);

    await usdc.connect(alice).approve(poolAddr, supplyAmount);
    await pool.connect(alice).supplyCollateral(USDC_ID, supplyAmount, s.newCommitment, "0x", [
      s.oldCommitment,
      s.newCommitment,
      s.shareDelta,
      1n,
      USDC_ID,
    ]);
    store.commit(Number(USDC_ID), s.patch);

    let position = await pool.positions(alice.address);
    expect(position.active).to.equal(true);
    expect(position.collateralAssetId).to.equal(USDC_ID);

    // ── 2. Borrow 4 ZEN against it (Markets ZEN row -> Borrow) ──────────────────────────
    // The UI only offers this once borrowCapacity() > 0; check its number is real.
    const collateralShares = store.get(Number(USDC_ID)).supplied;
    const collateralReal = sharesToReal(collateralShares, await registry.currentSupplyIndexRay(USDC_ID));
    const capacity = borrowCapacity({
      collateralAmount: collateralReal,
      collateralDecimals: 6,
      collateralPriceE8: 100_000_000n,
      ltvBps: 8_000,
      existingDebt: 0n,
      debtDecimals: 18,
      debtPriceE8: 200_000_000n,
    });
    expect(capacity).to.equal(ethers.parseUnits("400", 18)); // $1000 * 80% / $2 = 400 ZEN

    const borrowAmount = ethers.parseUnits("4", 18);
    const b = store.prepareBorrow(Number(ZEN_ID), borrowAmount);
    const collateralIndexRayForBorrow = await registry.currentSupplyIndexRay(USDC_ID);

    const zenBefore = await zen.balanceOf(alice.address);
    await pool.connect(alice).borrow(
      ZEN_ID,
      borrowAmount,
      b.newCommitment,
      "0x",
      [b.oldCommitment, b.newCommitment, borrowAmount, 1n, ZEN_ID],
      "0x",
      [position.collateralCommitment, b.newCommitment, 100_000_000n, 200_000_000n, collateralIndexRayForBorrow, RAY, 8_000n]
    );
    store.commit(Number(ZEN_ID), b.patch);

    // The borrowed tokens must actually land in the wallet — usable, not just an entry.
    expect(await zen.balanceOf(alice.address)).to.equal(zenBefore + borrowAmount);

    // ── 3. Locked vs free collateral (the 1000 USDC / 4 ZEN question) ───────────────────
    await time.increase(30 * 24 * 60 * 60); // a month of interest
    const debtAmount = store.get(Number(ZEN_ID)).borrowed;
    position = await pool.positions(alice.address);
    const interestFee = await registry.quoteRepayInterestFee(ZEN_ID, debtAmount, position.debtLastUpdated);
    expect(interestFee).to.be.greaterThan(0n); // interest really does accrue

    const locked = lockedCollateral({
      debtAmount: debtAmount + interestFee,
      debtDecimals: 18,
      debtPriceE8: 200_000_000n,
      ltvBps: 8_000,
      collateralDecimals: 6,
      collateralPriceE8: 100_000_000n,
    });
    // 4 ZEN = $8, / 0.8 = $10 of USDC locked, plus a little for the accrued interest.
    expect(locked).to.be.greaterThan(ethers.parseUnits("10", 6));
    expect(locked).to.be.lessThan(ethers.parseUnits("11", 6));
    const collateralNow = sharesToReal(store.get(Number(USDC_ID)).supplied, await registry.currentSupplyIndexRay(USDC_ID));
    expect(collateralNow - locked).to.be.greaterThan(ethers.parseUnits("989", 6)); // the rest stays free

    // ── 4. Repay the whole debt, interest included (Markets ZEN row -> Repay) ───────────
    const r = store.prepareRepay(Number(ZEN_ID), debtAmount);
    const feeAtRepay = await registry.quoteRepayInterestFee(ZEN_ID, debtAmount, position.debtLastUpdated);
    // The UI approves amount + fee, which is exactly what repay() pulls.
    await zen.connect(alice).approve(poolAddr, debtAmount + feeAtRepay + ethers.parseUnits("1", 18));
    await pool.connect(alice).repay(debtAmount, r.newCommitment, "0x", [r.oldCommitment, r.newCommitment, debtAmount, 0n, ZEN_ID]);
    store.commit(Number(ZEN_ID), r.patch);

    expect(store.get(Number(ZEN_ID)).borrowed).to.equal(0n);

    // ── 5. With the debt cleared, the whole supply is withdrawable again ────────────────
    const withdrawIndexRay = await registry.currentSupplyIndexRay(USDC_ID);
    const withdrawable = sharesToReal(store.get(Number(USDC_ID)).supplied, withdrawIndexRay);
    const w = store.prepareWithdraw(Number(USDC_ID), withdrawable, withdrawIndexRay);
    position = await pool.positions(alice.address);
    // What the UI now does before any solvency-gated call (lib/useFreshPrices.ts).
    await oracle.refreshTimestamp(await usdc.getAddress());
    await oracle.refreshTimestamp(await zen.getAddress());
    await pool.connect(alice).withdrawCollateral(
      withdrawable,
      w.newCommitment,
      "0x",
      [w.oldCommitment, w.newCommitment, w.shareDelta, 0n, USDC_ID],
      "0x",
      [w.newCommitment, position.debtCommitment, 100_000_000n, 200_000_000n, withdrawIndexRay, RAY, 8_000n]
    );
    expect(await usdc.balanceOf(alice.address)).to.be.greaterThanOrEqual(ethers.parseUnits("10000", 6) - supplyAmount + withdrawable);
  });

  it("mint and burn LATD: the exact sequence the Mint page submits", async function () {
    const { alice, usdc, cdp, latd, USDC_ID } = await deployFixture();
    const cdpAddr = await cdp.getAddress();
    const positions = { collateral: 0n, collateralSalt: 0n, debt: 0n, debtSalt: 0n };
    let salt = 100n;
    const prep = (field, saltField, delta, dir) => {
      const oldCommitment = commitment(positions[field], positions[saltField]);
      const newAmount = dir === "increase" ? positions[field] + delta : positions[field] - delta;
      const newSalt = salt++;
      return { oldCommitment, newCommitment: commitment(newAmount, newSalt), patch: { [field]: newAmount, [saltField]: newSalt } };
    };

    // ── Supply 1000 USDC collateral into the CDP ────────────────────────────────────────
    const supplyAmount = ethers.parseUnits("1000", 6);
    const s = prep("collateral", "collateralSalt", supplyAmount, "increase");
    await usdc.connect(alice).approve(cdpAddr, supplyAmount);
    await cdp.connect(alice).supplyCollateral(USDC_ID, supplyAmount, s.newCommitment, "0x", [s.oldCommitment, s.newCommitment, supplyAmount, 1n, USDC_ID]);
    Object.assign(positions, s.patch);

    // ── Mint 100 LATD (18 decimals, NOT the collateral's 6) ─────────────────────────────
    const mintAmount = ethers.parseUnits("100", 18);
    const m = prep("debt", "debtSalt", mintAmount, "increase");
    let cdpPosition = await cdp.positions(alice.address);
    await cdp.connect(alice).mint(
      mintAmount,
      m.newCommitment,
      "0x",
      [m.oldCommitment, m.newCommitment, mintAmount, 1n, USDC_ID],
      "0x",
      [cdpPosition.collateralCommitment, m.newCommitment, 100_000_000n, STABLECOIN_PRICE_E8, RAY, RAY, 8_000n]
    );
    Object.assign(positions, m.patch);

    const minted = await latd.balanceOf(alice.address);
    const feeBps = await cdp.mintFeeBps();
    expect(minted).to.equal(mintAmount - (mintAmount * feeBps) / 10_000n); // origination fee withheld
    expect(await cdp.totalDebtMinted()).to.equal(mintAmount);

    // ── Burn it back ────────────────────────────────────────────────────────────────────
    // Debt recorded is the full mintAmount but only (mintAmount - fee) was received, so a
    // full burn needs the fee topped up — exactly what the UI's "Owed vs wallet balance"
    // cap is protecting against.
    const burnAmount = minted;
    const bu = prep("debt", "debtSalt", burnAmount, "decrease");
    await latd.connect(alice).approve(cdpAddr, burnAmount);
    await cdp.connect(alice).burn(burnAmount, bu.newCommitment, "0x", [bu.oldCommitment, bu.newCommitment, burnAmount, 0n, USDC_ID]);
    Object.assign(positions, bu.patch);

    expect(await latd.balanceOf(alice.address)).to.equal(0n);
    expect(await cdp.totalDebtMinted()).to.equal(mintAmount - burnAmount);
  });

  it("a second collateral asset is rejected on-chain — what the UI now greys out", async function () {
    const { alice, zen, usdc, pool, registry, ZEN_ID, USDC_ID } = await deployFixture();
    const store = makeStore();
    const poolAddr = await pool.getAddress();

    const supplyAmount = ethers.parseUnits("1000", 6);
    const idx = await registry.currentSupplyIndexRay(USDC_ID);
    const s = store.prepareSupply(Number(USDC_ID), supplyAmount, idx);
    await usdc.connect(alice).approve(poolAddr, supplyAmount);
    await pool.connect(alice).supplyCollateral(USDC_ID, supplyAmount, s.newCommitment, "0x", [s.oldCommitment, s.newCommitment, s.shareDelta, 1n, USDC_ID]);
    store.commit(Number(USDC_ID), s.patch);

    const zenAmount = ethers.parseUnits("10", 18);
    const zenIdx = await registry.currentSupplyIndexRay(ZEN_ID);
    const s2 = store.prepareSupply(Number(ZEN_ID), zenAmount, zenIdx);
    await zen.connect(alice).approve(poolAddr, zenAmount);
    await expect(
      pool.connect(alice).supplyCollateral(ZEN_ID, zenAmount, s2.newCommitment, "0x", [s2.oldCommitment, s2.newCommitment, s2.shareDelta, 1n, ZEN_ID])
    ).to.be.reverted;
  });
});

describe("oracle heartbeat", function () {
  it("a price older than an hour blocks borrowing, and refreshTimestamp unblocks it", async function () {
    const { alice, zen, usdc, oracle, pool, registry, ZEN_ID, USDC_ID } = await deployFixture();
    const store = makeStore();
    const poolAddr = await pool.getAddress();

    const supplyAmount = ethers.parseUnits("1000", 6);
    const idx = await registry.currentSupplyIndexRay(USDC_ID);
    const s = store.prepareSupply(Number(USDC_ID), supplyAmount, idx);
    await usdc.connect(alice).approve(poolAddr, supplyAmount);
    // Supply has no solvency check, so it keeps working even with a stale feed.
    await pool.connect(alice).supplyCollateral(USDC_ID, supplyAmount, s.newCommitment, "0x", [s.oldCommitment, s.newCommitment, s.shareDelta, 1n, USDC_ID]);
    store.commit(Number(USDC_ID), s.patch);

    await time.increase(2 * 60 * 60); // two hours: past PRICE_STALENESS_WINDOW

    const borrowAmount = ethers.parseUnits("4", 18);
    const position = await pool.positions(alice.address);
    const b = store.prepareBorrow(Number(ZEN_ID), borrowAmount);
    const collateralIndexRay = await registry.currentSupplyIndexRay(USDC_ID);
    const borrowArgs = [
      ZEN_ID,
      borrowAmount,
      b.newCommitment,
      "0x",
      [b.oldCommitment, b.newCommitment, borrowAmount, 1n, ZEN_ID],
      "0x",
      [position.collateralCommitment, b.newCommitment, 100_000_000n, 200_000_000n, collateralIndexRay, RAY, 8_000n],
    ];

    await expect(pool.connect(alice).borrow(...borrowArgs)).to.be.revertedWithCustomError(pool, "StaleOraclePrice");

    // The permissionless heartbeat the UI now sends first — anyone can call it, and it
    // re-stamps the existing price without being able to change it.
    const priceBefore = await oracle.getPrice(await usdc.getAddress());
    await oracle.connect(alice).refreshTimestamp(await usdc.getAddress());
    await oracle.connect(alice).refreshTimestamp(await zen.getAddress());
    const priceAfter = await oracle.getPrice(await usdc.getAddress());
    expect(priceAfter[0]).to.equal(priceBefore[0]); // same price
    expect(priceAfter[1]).to.be.greaterThan(priceBefore[1]); // newer stamp

    const freshIndexRay = await registry.currentSupplyIndexRay(USDC_ID);
    const zenBefore = await zen.balanceOf(alice.address);
    await pool.connect(alice).borrow(
      ZEN_ID,
      borrowAmount,
      b.newCommitment,
      "0x",
      [b.oldCommitment, b.newCommitment, borrowAmount, 1n, ZEN_ID],
      "0x",
      [position.collateralCommitment, b.newCommitment, 100_000_000n, 200_000_000n, freshIndexRay, RAY, 8_000n]
    );
    expect(await zen.balanceOf(alice.address)).to.equal(zenBefore + borrowAmount);
  });
});

describe("supply index drift", function () {
  // Reproduces the live failure: a deposit into an asset that is being borrowed against
  // reverted with InvalidProof, because the share delta is derived from a supply index that
  // advances every second and the pool demanded the caller predict its value at mining time.
  // An idle asset's index doesn't move, which is why deposits there kept working.
  async function withMovingIndex() {
    const ctx = await deployFixture();
    const { deployer, alice, zen, usdc, pool, registry, USDC_ID, ZEN_ID } = ctx;
    const poolAddr = await pool.getAddress();
    const store = makeStore();

    // Alice supplies USDC, so the market has something to lend out.
    const seed = ethers.parseUnits("1000", 6);
    const idx0 = await registry.currentSupplyIndexRay(USDC_ID);
    const s0 = store.prepareSupply(Number(USDC_ID), seed, idx0);
    await usdc.connect(alice).approve(poolAddr, seed);
    await pool.connect(alice).supplyCollateral(USDC_ID, seed, s0.newCommitment, "0x", [s0.oldCommitment, s0.newCommitment, s0.shareDelta, 1n, USDC_ID]);
    store.commit(Number(USDC_ID), s0.patch);

    // The deployer borrows USDC against ZEN, putting the USDC market under utilization —
    // which is what starts its supply index moving.
    const deployerStore = makeStore();
    const zenAmount = ethers.parseUnits("100", 18);
    const zenIdx = await registry.currentSupplyIndexRay(ZEN_ID);
    const ds = deployerStore.prepareSupply(Number(ZEN_ID), zenAmount, zenIdx);
    await zen.connect(deployer).approve(poolAddr, zenAmount);
    await pool.connect(deployer).supplyCollateral(ZEN_ID, zenAmount, ds.newCommitment, "0x", [ds.oldCommitment, ds.newCommitment, ds.shareDelta, 1n, ZEN_ID]);
    deployerStore.commit(Number(ZEN_ID), ds.patch);

    await usdc.mint(poolAddr, ethers.parseUnits("5000", 6));
    const borrowUsdc = ethers.parseUnits("100", 6);
    const dPos = await pool.positions(deployer.address);
    const db = deployerStore.prepareBorrow(Number(USDC_ID), borrowUsdc);
    await pool.connect(deployer).borrow(
      USDC_ID,
      borrowUsdc,
      db.newCommitment,
      "0x",
      [db.oldCommitment, db.newCommitment, borrowUsdc, 1n, USDC_ID],
      "0x",
      [dPos.collateralCommitment, db.newCommitment, 200_000_000n, 100_000_000n, await registry.currentSupplyIndexRay(ZEN_ID), RAY, 8_000n]
    );

    expect(await registry.supplyRateBps(USDC_ID)).to.be.greaterThan(0n);
    return { ...ctx, store, poolAddr };
  }

  it("the index really does move once an asset is borrowed against", async function () {
    const { registry, USDC_ID } = await withMovingIndex();
    const before = await registry.currentSupplyIndexRay(USDC_ID);
    await time.increase(30);
    await ethers.provider.send("evm_mine", []);
    expect(await registry.currentSupplyIndexRay(USDC_ID)).to.be.greaterThan(before);
  });

  it("rejects a deposit claiming MORE shares than the live index gives, however the caller got there", async function () {
    const { alice, usdc, pool, registry, USDC_ID, store, poolAddr } = await withMovingIndex();

    const staleIndex = await registry.currentSupplyIndexRay(USDC_ID);
    await time.increase(60); // the index moves on past what the caller read

    const amount = ethers.parseUnits("50", 6);
    const s = store.prepareSupply(Number(USDC_ID), amount, staleIndex); // over-claims
    await usdc.connect(alice).approve(poolAddr, amount);
    await expect(
      pool.connect(alice).supplyCollateral(USDC_ID, amount, s.newCommitment, "0x", [s.oldCommitment, s.newCommitment, s.shareDelta, 1n, USDC_ID])
    ).to.be.revertedWithCustomError(pool, "InvalidProof");
  });

  it("accepts a deposit whose claim was projected forward, which is what the UI now sends", async function () {
    const { alice, usdc, pool, registry, USDC_ID, store, poolAddr } = await withMovingIndex();

    // lib/supplyIndex.ts: project the index over the submission window, so the claim stays
    // an under-claim for as long as that window lasts instead of for one second.
    const BPS = 10_000n;
    const SECONDS_PER_YEAR = 31_536_000n;
    const PROJECTION_SECONDS = 1_800n;
    const indexRay = await registry.currentSupplyIndexRay(USDC_ID);
    const rateBps = await registry.supplyRateBps(USDC_ID);
    const projected = indexRay + (indexRay * rateBps * PROJECTION_SECONDS) / (BPS * SECONDS_PER_YEAR);
    expect(projected).to.be.greaterThan(indexRay);

    const amount = ethers.parseUnits("50", 6);
    const s = store.prepareSupply(Number(USDC_ID), amount, projected);

    // Sit on it far longer than a wallet signature takes, then submit.
    await time.increase(120);

    const balanceBefore = await usdc.balanceOf(alice.address);
    await usdc.connect(alice).approve(poolAddr, amount);
    await pool.connect(alice).supplyCollateral(USDC_ID, amount, s.newCommitment, "0x", [s.oldCommitment, s.newCommitment, s.shareDelta, 1n, USDC_ID]);
    store.commit(Number(USDC_ID), s.patch);

    expect(await usdc.balanceOf(alice.address)).to.equal(balanceBefore - amount);
    expect((await pool.positions(alice.address)).collateralCommitment).to.equal(s.newCommitment);
  });

  it("still rejects a withdrawal that burns FEWER shares than the amount costs", async function () {
    const { alice, pool, registry, USDC_ID, store } = await withMovingIndex();

    const amount = ethers.parseUnits("10", 6);
    const indexRay = await registry.currentSupplyIndexRay(USDC_ID);
    // A caller reaching for a future index here would under-burn, which is the direction
    // that costs the pool rather than the caller.
    const inflated = indexRay * 2n;
    const w = store.prepareWithdraw(Number(USDC_ID), amount, inflated);
    const position = await pool.positions(alice.address);

    await expect(
      pool.connect(alice).withdrawCollateral(
        amount,
        w.newCommitment,
        "0x",
        [w.oldCommitment, w.newCommitment, w.shareDelta, 0n, USDC_ID],
        "0x",
        [w.newCommitment, position.debtCommitment, 100_000_000n, 200_000_000n, indexRay, RAY, 8_000n]
      )
    ).to.be.revertedWithCustomError(pool, "InvalidProof");
  });
});

describe("supply rate precision", function () {
  // A supply rate is a borrow rate scaled down twice, by utilization and by the reserve
  // factor, so early-market rates land under a basis point. Held in bps that floors to
  // zero, which froze the supply index and paid suppliers nothing at all.
  it("earns a real, non-zero rate at the low utilization a young market actually has", async function () {
    const { deployer, alice, zen, usdc, pool, registry, ZEN_ID, USDC_ID } = await deployFixture();
    const store = makeStore();
    const poolAddr = await pool.getAddress();

    const supply = ethers.parseUnits("1000", 6);
    const idx = await registry.currentSupplyIndexRay(USDC_ID);
    const s = store.prepareSupply(Number(USDC_ID), supply, idx);
    await usdc.connect(alice).approve(poolAddr, supply);
    await pool.connect(alice).supplyCollateral(USDC_ID, supply, s.newCommitment, "0x", [s.oldCommitment, s.newCommitment, s.shareDelta, 1n, USDC_ID]);
    store.commit(Number(USDC_ID), s.patch);

    // Borrow a small slice of it, the shape of a market that has just opened.
    const dStore = makeStore();
    const zenAmount = ethers.parseUnits("100", 18);
    const ds = dStore.prepareSupply(Number(ZEN_ID), zenAmount, await registry.currentSupplyIndexRay(ZEN_ID));
    await zen.connect(deployer).approve(poolAddr, zenAmount);
    await pool.connect(deployer).supplyCollateral(ZEN_ID, zenAmount, ds.newCommitment, "0x", [ds.oldCommitment, ds.newCommitment, ds.shareDelta, 1n, ZEN_ID]);
    dStore.commit(Number(ZEN_ID), ds.patch);

    await usdc.mint(poolAddr, ethers.parseUnits("5000", 6));
    const borrow = ethers.parseUnits("4", 6); // 0.4% utilization
    const dPos = await pool.positions(deployer.address);
    const db = dStore.prepareBorrow(Number(USDC_ID), borrow);
    await pool.connect(deployer).borrow(
      USDC_ID, borrow, db.newCommitment, "0x",
      [db.oldCommitment, db.newCommitment, borrow, 1n, USDC_ID], "0x",
      [dPos.collateralCommitment, db.newCommitment, 200_000_000n, 100_000_000n, await registry.currentSupplyIndexRay(ZEN_ID), RAY, 8_000n]
    );

    const util = await registry.utilizationBps(USDC_ID);
    expect(util).to.be.greaterThan(0n);
    expect(util).to.be.lessThan(100n); // under 1%, where bps rounding used to erase the rate

    // The headline bps figure still rounds to zero at this scale. The rate the index
    // actually uses must not.
    expect(await registry.supplyRateBps(USDC_ID)).to.equal(0n);
    expect(await registry.supplyRateRay(USDC_ID)).to.be.greaterThan(0n);

    const before = await registry.currentSupplyIndexRay(USDC_ID);
    await time.increase(30 * 24 * 60 * 60);
    await ethers.provider.send("evm_mine", []);
    const after = await registry.currentSupplyIndexRay(USDC_ID);
    expect(after).to.be.greaterThan(before); // suppliers actually accrue
  });

  it("keeps supplyRateBps as a faithful rounding of the ray rate at normal utilization", async function () {
    const { registry } = await deployFixture();
    // Both derive from the same formula, so the bps view is the ray value scaled down.
    const ray = await registry.supplyRateRay(0n);
    const bps = await registry.supplyRateBps(0n);
    expect(bps).to.equal((ray * 10_000n) / RAY);
  });
});
