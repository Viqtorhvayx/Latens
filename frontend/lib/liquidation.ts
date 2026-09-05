// Pure math backing the liquidation page — mirrors circuits/liquidation_eligibility's
// constraints exactly (insolvency check, and the seize-amount cap at repaid value + bonus),
// but USD-normalized via usdValueE8 rather than the circuit's raw amount*price. Worth
// flagging: the actual Noir circuit does raw `amount * price` with no decimals division,
// the same bug this frontend had in portfolio/page.tsx until it was fixed — a real,
// separate problem in the circuit itself, out of scope to fix here (would mean touching
// the Noir source, regenerating the verifier, and updating its tests). Since MockVerifier
// never actually runs the circuit, this file's job is only to decide what the UI shows and
// what gets submitted — matching the circuit's *intended* correct behavior, not its current
// implementation.
import { usdValueE8 } from "./valuation";

export function isInsolvent(collateralAmount: bigint, collateralDecimals: number, collateralPriceE8: bigint, debtAmount: bigint, debtDecimals: number, debtPriceE8: bigint, liquidationThresholdBps: number): boolean {
  const collateralValueE8 = usdValueE8(collateralAmount, collateralDecimals, collateralPriceE8);
  const debtValueE8 = usdValueE8(debtAmount, debtDecimals, debtPriceE8);
  return debtValueE8 * 10_000n > collateralValueE8 * BigInt(liquidationThresholdBps);
}

// The most collateral a keeper may seize for a given repayAmount: value capped at the
// repaid debt's value plus the configured bonus, and never more than the position holds.
export function maxSeizableCollateral(
  repayAmount: bigint,
  debtDecimals: number,
  debtPriceE8: bigint,
  collateralAmount: bigint,
  collateralDecimals: number,
  collateralPriceE8: bigint,
  liquidationBonusBps: number,
): bigint {
  if (collateralPriceE8 === 0n) return 0n;
  const repaidValueE8 = usdValueE8(repayAmount, debtDecimals, debtPriceE8);
  const maxSeizableValueE8 = (repaidValueE8 * (10_000n + BigInt(liquidationBonusBps))) / 10_000n;
  const maxSeizableUnits = (maxSeizableValueE8 * 10n ** BigInt(collateralDecimals)) / collateralPriceE8;
  return maxSeizableUnits < collateralAmount ? maxSeizableUnits : collateralAmount;
}
