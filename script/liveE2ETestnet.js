// Phase B of the live-testnet end-to-end proof-of-real-proving test — see the sibling
// frontend/scripts/genLiveE2EProofs.mjs for Phase A, which must be run first. This drives a
// full supply -> borrow -> repay -> withdraw cycle through the ALREADY-LIVE LatensPool on
// Horizen testnet, submitting REAL UltraHonk proofs (generated offline by the noir_js + bb.js
// pipeline, the same one frontend/lib/proving/ runs in the browser) through the real Honk
// verifiers wired in by script/deployRealVerifiersTestnet.js. This is the thing the whole
// client-side-proving effort was building toward: proof that a real user flow works end to
// end against real on-chain verification, not just that proofs verify in isolation.
//
// Uses a brand-new, randomly generated wallet rather than the deployer account, because a
// fresh wallet is GUARANTEED to have collateralCommitment == 0 / debtCommitment == 0 (the
// commitment_update circuit's sentinel for "no position yet"), which is what every proof in
// the plan file was computed against. Funded with a small amount of native gas from the
// deployer (Horizen testnet gas is a small fraction of a cent) and mints its own test tokens
// (MockERC20.mint() is deliberately unrestricted).
//
// Run:
//   cd frontend && node scripts/genLiveE2EProofs.mjs && cd ..
//   DEPLOYER_PRIVATE_KEY=<owner key> npx hardhat run script/liveE2ETestnet.js --network horizenTestnet
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const PLAN_PATH = path.join(__dirname, "..", "frontend", "scripts", ".e2e-plan.json");

const POOL_ABI = [
  "function supplyCollateral(uint256 assetId, uint256 amount, uint256 newCommitment, bytes calldata proof, uint256[] calldata publicInputs)",
  "function borrow(uint256 debtAssetId, uint256 amount, uint256 newCommitment, bytes calldata updateProof, uint256[] calldata updatePublicInputs, bytes calldata solvencyProof, uint256[] calldata solvencyPublicInputs)",
  "function repay(uint256 amount, uint256 newDebtCommitment, bytes calldata debtProof, uint256[] calldata debtPublicInputs, uint256 newCollateralCommitment, bytes calldata collateralProof, uint256[] calldata collateralPublicInputs, bool closesDebt)",
  "function withdrawCollateral(uint256 amount, uint256 newCommitment, bytes calldata updateProof, uint256[] calldata updatePublicInputs, bytes calldata solvencyProof, uint256[] calldata solvencyPublicInputs)",
  "function positions(address) view returns (uint256 collateralAssetId,uint256 debtAssetId,uint256 collateralCommitment,uint256 debtCommitment,uint64 lastUpdated,uint64 debtLastUpdated,bool active,bool hasDebt)",
];
const ERC20_ABI = ["function mint(address to, uint256 amount)", "function approve(address spender, uint256 amount) returns (bool)", "function balanceOf(address) view returns (uint256)"];
const ORACLE_ABI = ["function refreshTimestamp(address asset)"];

function requireEq(label, actual, expected) {
  if (actual.toString() !== expected.toString()) {
    throw new Error(`${label} mismatch: on-chain ${actual.toString()} != expected ${expected.toString()}`);
  }
  console.log(`  ✓ ${label} matches:`, actual.toString());
}

async function main() {
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const deployment = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "frontend", "lib", "deployment.json"), "utf8"));

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Live E2E on ${network.name} (chainId ${net.chainId}), deployer:`, deployer.address);

  const pool = new ethers.Contract(deployment.contracts.LatensPool.address, POOL_ABI, deployer);
  const zen = new ethers.Contract(deployment.tokens.ZEN.address, ERC20_ABI, deployer);
  const zusd = new ethers.Contract(deployment.tokens.ZUSD.address, ERC20_ABI, deployer);
  const oracle = new ethers.Contract(deployment.contracts.MockPriceOracle.address, ORACLE_ABI, deployer);

  // --- Fresh wallet, funded for gas only (Horizen testnet gas is negligible) ---
  const freshUser = ethers.Wallet.createRandom().connect(ethers.provider);
  console.log("Fresh test user:", freshUser.address);
  await (await deployer.sendTransaction({ to: freshUser.address, value: ethers.parseEther("0.005") })).wait();
  console.log("Funded fresh user with 0.005 native for gas.");

  const poolAsUser = pool.connect(freshUser);
  const zenAsUser = zen.connect(freshUser);
  const zusdAsUser = zusd.connect(freshUser);

  // --- Mint collateral to self (MockERC20.mint is unrestricted) and refresh prices ---
  await (await zenAsUser.mint(freshUser.address, plan.collateralAmountRaw)).wait();
  console.log("Fresh user minted", ethers.formatUnits(plan.collateralAmountRaw, 18), "ZEN to self.");
  await (await oracle.refreshTimestamp(deployment.tokens.ZEN.address)).wait();
  await (await oracle.refreshTimestamp(deployment.tokens.ZUSD.address)).wait();
  console.log("Refreshed ZEN/ZUSD price timestamps.");

  await (await zenAsUser.approve(deployment.contracts.LatensPool.address, plan.collateralAmountRaw)).wait();

  // --- Step 1: supplyCollateral ---
  console.log("\nStep 1: supplyCollateral (real commitment_update proof)...");
  let tx = await poolAsUser.supplyCollateral(plan.zenAssetId, plan.collateralAmountRaw, plan.supply.newCommitment, plan.supply.proof, plan.supply.publicInputs);
  await tx.wait();
  console.log("  tx:", tx.hash);
  let position = await pool.positions(freshUser.address);
  requireEq("collateralCommitment after supply", position.collateralCommitment, plan.supply.newCommitment);

  // --- Step 2: borrow, gated by a real solvency proof ---
  console.log("\nStep 2: borrow (real commitment_update + solvency proofs)...");
  tx = await poolAsUser.borrow(
    plan.zusdAssetId,
    plan.borrowAmountRaw,
    plan.borrowUpdate.newCommitment,
    plan.borrowUpdate.proof,
    plan.borrowUpdate.publicInputs,
    plan.solvency.proof,
    plan.solvency.publicInputs
  );
  await tx.wait();
  console.log("  tx:", tx.hash);
  position = await pool.positions(freshUser.address);
  requireEq("debtCommitment after borrow", position.debtCommitment, plan.borrowUpdate.newCommitment);
  const zusdBalance = await zusd.balanceOf(freshUser.address);
  requireEq("ZUSD received", zusdBalance, plan.borrowAmountRaw);

  // --- Step 3: repay in full, closing the debt ---
  console.log("\nStep 3: repay (two real commitment_update proofs: debt + collateral fee)...");
  await (await zusdAsUser.approve(deployment.contracts.LatensPool.address, plan.borrowAmountRaw)).wait();
  tx = await poolAsUser.repay(
    plan.borrowAmountRaw,
    plan.repayDebt.newCommitment,
    plan.repayDebt.proof,
    plan.repayDebt.publicInputs,
    plan.repayCollateral.newCommitment,
    plan.repayCollateral.proof,
    plan.repayCollateral.publicInputs,
    true
  );
  await tx.wait();
  console.log("  tx:", tx.hash);
  position = await pool.positions(freshUser.address);
  requireEq("debtCommitment after repay", position.debtCommitment, plan.repayDebt.newCommitment);
  requireEq("collateralCommitment after repay fee", position.collateralCommitment, plan.repayCollateral.newCommitment);
  if (position.hasDebt) throw new Error("hasDebt still true after a closesDebt repay.");
  console.log("  ✓ hasDebt cleared");

  // --- Step 4: partial withdrawal of the remaining collateral ---
  console.log("\nStep 4: withdrawCollateral (real commitment_update proof, no solvency proof needed once debt-free)...");
  const zenBalanceBefore = await zen.balanceOf(freshUser.address);
  tx = await poolAsUser.withdrawCollateral(plan.withdrawAmountRaw, plan.withdraw.newCommitment, plan.withdraw.proof, plan.withdraw.publicInputs, "0x", []);
  await tx.wait();
  console.log("  tx:", tx.hash);
  position = await pool.positions(freshUser.address);
  requireEq("collateralCommitment after withdraw", position.collateralCommitment, plan.withdraw.newCommitment);
  const zenBalanceAfter = await zen.balanceOf(freshUser.address);
  requireEq("ZEN received back", zenBalanceAfter - zenBalanceBefore, plan.withdrawAmountRaw);

  console.log("\n✅ Full live cycle (supply → borrow → repay → withdraw) succeeded on Horizen testnet, entirely through the real UltraHonk verifiers.");
  console.log("Fresh test user address (for reference):", freshUser.address);
}

main().catch((error) => {
  console.error("FAILED:", error);
  process.exitCode = 1;
});
