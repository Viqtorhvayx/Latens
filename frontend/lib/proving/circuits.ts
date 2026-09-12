// The three circuit names Latens proves against, and the exact public-input layout each
// one's Solidity verifier expects — see contracts/interfaces/I*Verifier.sol, which this
// mirrors field-for-field. Getting this order wrong doesn't fail loudly with a type error;
// it fails on-chain as InvalidProof, since the verifier binds each position positionally.
export type CircuitName = "commitment_update" | "solvency" | "liquidation_eligibility";

export const CIRCUIT_PATH: Record<CircuitName, string> = {
  commitment_update: "/circuits/commitment_update.json",
  solvency: "/circuits/solvency.json",
  liquidation_eligibility: "/circuits/liquidation_eligibility.json",
};

// Every value crosses a worker boundary (structured clone) and is fed to a Noir circuit's
// InputMap, which wants decimal/hex strings for Field and u128 — never a bigint (not
// structured-cloneable in every environment) and never a JS number (u128/Field exceed
// Number.MAX_SAFE_INTEGER). Callers pass bigints; the client layer stringifies them.
export type CommitmentUpdateInputs = {
  oldAmount: bigint;
  oldSalt: bigint;
  newSalt: bigint;
  oldCommitment: bigint;
  newCommitment: bigint;
  delta: bigint;
  isIncrease: boolean;
  assetId: bigint;
};

export type SolvencyInputs = {
  collateralAmount: bigint;
  collateralSalt: bigint;
  debtAmount: bigint;
  debtSalt: bigint;
  collateralCommitment: bigint;
  debtCommitment: bigint;
  collateralPriceE8: bigint;
  debtPriceE8: bigint;
  collateralIndexRay: bigint;
  debtIndexRay: bigint;
  thresholdBps: bigint;
};

export type LiquidationEligibilityInputs = {
  collateralAmount: bigint;
  collateralSalt: bigint;
  debtAmount: bigint;
  debtSalt: bigint;
  newCollateralSalt: bigint;
  newDebtSalt: bigint;
  collateralCommitment: bigint;
  debtCommitment: bigint;
  newCollateralCommitment: bigint;
  newDebtCommitment: bigint;
  collateralPriceE8: bigint;
  debtPriceE8: bigint;
  collateralIndexRay: bigint;
  debtIndexRay: bigint;
  liquidationThresholdBps: bigint;
  liquidationBonusBps: bigint;
  seizedCollateralAmount: bigint;
  repayAmount: bigint;
};

// Converts each typed input struct into the plain string-keyed InputMap `Noir.execute()`
// wants, in the exact parameter order circuits/*/src/main.nr declares — noir_js matches by
// name, not position, so the object KEYS below are what actually has to line up, not the
// order they're written in.
export function commitmentUpdateInputMap(i: CommitmentUpdateInputs): Record<string, string | boolean> {
  return {
    old_amount: i.oldAmount.toString(),
    old_salt: i.oldSalt.toString(),
    new_salt: i.newSalt.toString(),
    old_commitment: i.oldCommitment.toString(),
    new_commitment: i.newCommitment.toString(),
    delta: i.delta.toString(),
    is_increase: i.isIncrease,
    asset_id: i.assetId.toString(),
  };
}

export function solvencyInputMap(i: SolvencyInputs): Record<string, string> {
  return {
    collateral_amount: i.collateralAmount.toString(),
    collateral_salt: i.collateralSalt.toString(),
    debt_amount: i.debtAmount.toString(),
    debt_salt: i.debtSalt.toString(),
    collateral_commitment: i.collateralCommitment.toString(),
    debt_commitment: i.debtCommitment.toString(),
    collateral_price_e8: i.collateralPriceE8.toString(),
    debt_price_e8: i.debtPriceE8.toString(),
    collateral_index_ray: i.collateralIndexRay.toString(),
    debt_index_ray: i.debtIndexRay.toString(),
    threshold_bps: i.thresholdBps.toString(),
  };
}

export function liquidationEligibilityInputMap(i: LiquidationEligibilityInputs): Record<string, string> {
  return {
    collateral_amount: i.collateralAmount.toString(),
    collateral_salt: i.collateralSalt.toString(),
    debt_amount: i.debtAmount.toString(),
    debt_salt: i.debtSalt.toString(),
    new_collateral_salt: i.newCollateralSalt.toString(),
    new_debt_salt: i.newDebtSalt.toString(),
    collateral_commitment: i.collateralCommitment.toString(),
    debt_commitment: i.debtCommitment.toString(),
    new_collateral_commitment: i.newCollateralCommitment.toString(),
    new_debt_commitment: i.newDebtCommitment.toString(),
    collateral_price_e8: i.collateralPriceE8.toString(),
    debt_price_e8: i.debtPriceE8.toString(),
    collateral_index_ray: i.collateralIndexRay.toString(),
    debt_index_ray: i.debtIndexRay.toString(),
    liquidation_threshold_bps: i.liquidationThresholdBps.toString(),
    liquidation_bonus_bps: i.liquidationBonusBps.toString(),
    seized_collateral_amount: i.seizedCollateralAmount.toString(),
    repay_amount: i.repayAmount.toString(),
  };
}

// What every call site actually needs to hand `writeContractAsync`: the proof as calldata
// bytes, and public inputs as the uint256[] the verifier binds against — bb.js hands back
// each public input as a 0x-prefixed 32-byte hex string; BigInt() reads that natively.
export type ProofResult = {
  proof: `0x${string}`;
  publicInputs: bigint[];
};
