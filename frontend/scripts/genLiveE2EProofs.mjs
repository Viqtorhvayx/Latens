// Phase A of the live-testnet end-to-end proof-of-real-proving test: computes every
// commitment, salt, and real zk-SNARK proof for a full supply -> borrow -> repay -> withdraw
// cycle on LatensPool, entirely offline except for a handful of live reads (current supply
// index, oracle prices, ltvBps, borrow rate) needed to make the witnesses match on-chain
// state. Writes one JSON file that ../../script/liveE2ETestnet.js (run separately, from the
// repo root via Hardhat, since only the frontend's node_modules carries @noir-lang/noir_js
// and @aztec/bb.js) submits as transactions against Horizen testnet.
//
// Each run computes a fresh, single-use plan against CURRENT on-chain state (index, prices) —
// the output file is not meant to be reused across runs once its proofs have been submitted,
// since submitting them changes the exact on-chain state the next run would need to read.
//
// Run from frontend/: node scripts/genLiveE2EProofs.mjs
// Then from the repo root: DEPLOYER_PRIVATE_KEY=<owner key> npx hardhat run script/liveE2ETestnet.js --network horizenTestnet
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { Noir } from "@noir-lang/noir_js";
import { UltraHonkBackend, Barretenberg } from "@aztec/bb.js";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMMITMENT_DOMAIN = 1;
const RAY = 1000000000000000000n;
const CIRCUITS_DIR = path.join(__dirname, "..", "..", "circuits");
const OUT_PATH = path.join(__dirname, ".e2e-plan.json");

function randomSalt() {
  // Mirrors frontend/lib/positionStore.tsx's randomSalt(): 31 random bytes, safely under
  // the BN254 field size.
  const bytes = new Uint8Array(31);
  crypto.getRandomValues(bytes);
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function toFieldBytes(value) {
  const buf = new Uint8Array(32);
  let v = BigInt(value);
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}
function fromFieldBytes(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}
function commitSync(api, amount, salt) {
  if (amount === 0n && salt === 0n) return 0n;
  const r = api.pedersenHash({ inputs: [toFieldBytes(amount), toFieldBytes(salt)], hashIndex: COMMITMENT_DOMAIN });
  return fromFieldBytes(r.hash);
}

const circuitCache = new Map();
function loadCircuit(name) {
  if (!circuitCache.has(name)) {
    circuitCache.set(name, JSON.parse(readFileSync(`${CIRCUITS_DIR}/${name}/target/${name}.json`, "utf8")));
  }
  return circuitCache.get(name);
}

async function prove(bbApi, circuitName, inputs) {
  const circuit = loadCircuit(circuitName);
  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs);
  const backend = new UltraHonkBackend(circuit.bytecode, bbApi);
  const proofData = await backend.generateProof(witness, { verifierTarget: "evm" });
  const ok = await backend.verifyProof(proofData, { verifierTarget: "evm" });
  if (!ok) throw new Error(`bb.js self-verify failed for ${circuitName}`);
  return {
    proof: "0x" + Buffer.from(proofData.proof).toString("hex"),
    publicInputs: proofData.publicInputs,
  };
}

async function main() {
  const bbSync = await (await import("@aztec/bb.js")).BarretenbergSync.initSingleton();

  // --- Live reads: static config plus the handful of numbers that must match chain state ---
  const provider = new ethers.JsonRpcProvider("https://horizen-testnet.rpc.caldera.xyz/http");
  const deployment = JSON.parse(readFileSync(path.join(__dirname, "..", "lib", "deployment.json"), "utf8"));
  const registry = new ethers.Contract(
    deployment.contracts.AssetRegistry.address,
    [
      "function currentSupplyIndexRay(uint256) view returns (uint256)",
      "function borrowRateBps(uint256) view returns (uint256)",
      "function getAsset(uint256) view returns (tuple(address token,bool isSupported,uint16 ltvBps,uint16 liquidationThresholdBps,uint16 liquidationBonusBps,uint16 reserveFactorBps,uint256 totalSupplied,uint256 totalBorrowed,uint16 baseRateBps,uint16 slope1Bps,uint16 slope2Bps,uint16 kinkBps))",
    ],
    provider
  );
  const oracle = new ethers.Contract(deployment.contracts.MockPriceOracle.address, ["function getPrice(address) view returns (uint256,uint256)"], provider);

  const zenAssetId = BigInt(deployment.tokens.ZEN.assetId);
  const zusdAssetId = BigInt(deployment.tokens.ZUSD.assetId);

  const collateralIndexRay = await registry.currentSupplyIndexRay(zenAssetId);
  const zenAsset = await registry.getAsset(zenAssetId);
  const [zenPriceE8] = await oracle.getPrice(deployment.tokens.ZEN.address);
  const [zusdPriceE8] = await oracle.getPrice(deployment.tokens.ZUSD.address);
  const zusdBorrowRateBps = await registry.borrowRateBps(zusdAssetId);

  console.log("Live config: collateralIndexRay =", collateralIndexRay.toString(), "zenPriceE8 =", zenPriceE8.toString(), "zusdPriceE8 =", zusdPriceE8.toString(), "zenLtvBps =", zenAsset.ltvBps, "zusdBorrowRateBps =", zusdBorrowRateBps.toString());

  const bbApi = await Barretenberg.new();

  const collateralAmountRaw = ethers.parseUnits("10", 18); // 10 ZEN deposited
  const borrowAmountRaw = ethers.parseUnits("3", 18); // 3 ZUSD borrowed — well under LTV
  const withdrawAmountRaw = ethers.parseUnits("1", 18); // 1 ZEN withdrawn after full repay

  // --- Step 1: supplyCollateral (fresh deposit) ---
  const shareDelta1 = (collateralAmountRaw * RAY) / collateralIndexRay;
  const supplySalt = randomSalt();
  const supplyNewCommitment = commitSync(bbSync, shareDelta1, supplySalt);
  const supplyProof = await prove(bbApi, "commitment_update", {
    old_amount: "0",
    old_salt: "0",
    new_salt: supplySalt.toString(),
    old_commitment: "0",
    new_commitment: supplyNewCommitment.toString(),
    delta: shareDelta1.toString(),
    is_increase: true,
    asset_id: zenAssetId.toString(),
  });
  console.log("Step 1 (supply) proved. shares =", shareDelta1.toString());

  // --- Step 2: borrow, with a real solvency proof ---
  const debtSalt1 = randomSalt();
  const debtNewCommitment1 = commitSync(bbSync, borrowAmountRaw, debtSalt1);
  const borrowUpdateProof = await prove(bbApi, "commitment_update", {
    old_amount: "0",
    old_salt: "0",
    new_salt: debtSalt1.toString(),
    old_commitment: "0",
    new_commitment: debtNewCommitment1.toString(),
    delta: borrowAmountRaw.toString(),
    is_increase: true,
    asset_id: zusdAssetId.toString(),
  });
  const solvencyProof = await prove(bbApi, "solvency", {
    collateral_amount: shareDelta1.toString(),
    collateral_salt: supplySalt.toString(),
    debt_amount: borrowAmountRaw.toString(),
    debt_salt: debtSalt1.toString(),
    collateral_commitment: supplyNewCommitment.toString(),
    debt_commitment: debtNewCommitment1.toString(),
    collateral_price_e8: zenPriceE8.toString(),
    debt_price_e8: zusdPriceE8.toString(),
    collateral_index_ray: collateralIndexRay.toString(),
    debt_index_ray: RAY.toString(),
    threshold_bps: zenAsset.ltvBps.toString(),
  });
  console.log("Step 2 (borrow + solvency) proved.");

  // --- Step 3: repay in full, closing the debt, with a generously-buffered collateral fee burn ---
  // Worst-case fee if a full hour somehow elapses before this lands, doubled again for margin.
  const worstCaseElapsedSeconds = 3600n;
  const worstCaseFeeInDebt = (borrowAmountRaw * zusdBorrowRateBps * worstCaseElapsedSeconds * 2n) / (10000n * 31536000n);
  const feeValueE8 = (worstCaseFeeInDebt * zusdPriceE8) / 10n ** 18n;
  const feeInCollateral = (feeValueE8 * 10n ** 18n) / zenPriceE8;
  const burnDelta = feeInCollateral * RAY / collateralIndexRay + 1000000000000n; // + a flat floor in case the above rounds to ~0
  console.log("Repay fee buffer (collateral shares, worst-case 1hr elapsed x2):", burnDelta.toString(), "vs total collateral shares:", shareDelta1.toString());
  if (burnDelta >= shareDelta1) throw new Error("Fee buffer is implausibly large relative to collateral — refusing to proceed.");

  const debtSalt2 = randomSalt();
  const debtCloseCommitment = commitSync(bbSync, 0n, debtSalt2);
  const repayDebtProof = await prove(bbApi, "commitment_update", {
    old_amount: borrowAmountRaw.toString(),
    old_salt: debtSalt1.toString(),
    new_salt: debtSalt2.toString(),
    old_commitment: debtNewCommitment1.toString(),
    new_commitment: debtCloseCommitment.toString(),
    delta: borrowAmountRaw.toString(),
    is_increase: false,
    asset_id: zusdAssetId.toString(),
  });

  const remainingSharesAfterFee = shareDelta1 - burnDelta;
  const collateralSalt2 = randomSalt();
  const collateralFeeCommitment = commitSync(bbSync, remainingSharesAfterFee, collateralSalt2);
  const repayCollateralProof = await prove(bbApi, "commitment_update", {
    old_amount: shareDelta1.toString(),
    old_salt: supplySalt.toString(),
    new_salt: collateralSalt2.toString(),
    old_commitment: supplyNewCommitment.toString(),
    new_commitment: collateralFeeCommitment.toString(),
    delta: burnDelta.toString(),
    is_increase: false,
    asset_id: zenAssetId.toString(),
  });
  console.log("Step 3 (repay) proved. remaining collateral shares =", remainingSharesAfterFee.toString());

  // --- Step 4: partial withdraw of the remaining collateral ---
  // Directionally safe: using the SAME (not-yet-advanced) index as step 1 for this floor
  // check can only overstate the shares a real withdrawal of withdrawAmountRaw would cost,
  // never understate it, so the floor at execution time is guaranteed to be met.
  const withdrawShareDelta = (withdrawAmountRaw * RAY) / collateralIndexRay;
  const remainingSharesAfterWithdraw = remainingSharesAfterFee - withdrawShareDelta;
  const withdrawSalt = randomSalt();
  const withdrawNewCommitment = commitSync(bbSync, remainingSharesAfterWithdraw, withdrawSalt);
  const withdrawProof = await prove(bbApi, "commitment_update", {
    old_amount: remainingSharesAfterFee.toString(),
    old_salt: collateralSalt2.toString(),
    new_salt: withdrawSalt.toString(),
    old_commitment: collateralFeeCommitment.toString(),
    new_commitment: withdrawNewCommitment.toString(),
    delta: withdrawShareDelta.toString(),
    is_increase: false,
    asset_id: zenAssetId.toString(),
  });
  console.log("Step 4 (withdraw) proved. remaining collateral shares =", remainingSharesAfterWithdraw.toString());

  await bbApi.destroy();

  const plan = {
    zenAssetId: zenAssetId.toString(),
    zusdAssetId: zusdAssetId.toString(),
    collateralAmountRaw: collateralAmountRaw.toString(),
    borrowAmountRaw: borrowAmountRaw.toString(),
    withdrawAmountRaw: withdrawAmountRaw.toString(),
    supply: { newCommitment: supplyNewCommitment.toString(), proof: supplyProof.proof, publicInputs: supplyProof.publicInputs },
    borrowUpdate: { newCommitment: debtNewCommitment1.toString(), proof: borrowUpdateProof.proof, publicInputs: borrowUpdateProof.publicInputs },
    solvency: { proof: solvencyProof.proof, publicInputs: solvencyProof.publicInputs },
    repayDebt: { newCommitment: debtCloseCommitment.toString(), proof: repayDebtProof.proof, publicInputs: repayDebtProof.publicInputs },
    repayCollateral: { newCommitment: collateralFeeCommitment.toString(), proof: repayCollateralProof.proof, publicInputs: repayCollateralProof.publicInputs },
    withdraw: { newCommitment: withdrawNewCommitment.toString(), proof: withdrawProof.proof, publicInputs: withdrawProof.publicInputs },
  };
  writeFileSync(OUT_PATH, JSON.stringify(plan, null, 2));
  console.log("\nWrote", OUT_PATH);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
