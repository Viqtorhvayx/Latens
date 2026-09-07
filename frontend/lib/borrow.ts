import { usdValueE8 } from "./valuation";

// How much more of a given asset a position can borrow, in that asset's base units.
//
// Kept here rather than inline in the modal because it decides both the number shown to the
// borrower AND whether the borrow flow asks for collateral first — if this is wrong in the
// permissive direction the pool takes on an undercollateralised loan, and if it's wrong in
// the restrictive direction the borrow flow dead-ends someone who is actually solvent.
//
// Both sides are converted to USD first (see valuation.ts): collateral and debt rarely share
// decimals, so comparing raw base units silently favours whichever side has more of them.
export function borrowCapacity({
  collateralAmount,
  collateralDecimals,
  collateralPriceE8,
  ltvBps,
  existingDebt,
  debtDecimals,
  debtPriceE8,
}: {
  collateralAmount: bigint;
  collateralDecimals: number;
  collateralPriceE8: bigint;
  ltvBps: number;
  existingDebt: bigint;
  debtDecimals: number;
  debtPriceE8: bigint;
}): bigint {
  // A zero price means the oracle hasn't answered yet; dividing by it would throw, and
  // treating it as free collateral would be worse.
  if (debtPriceE8 === 0n) return 0n;

  const collateralValueE8 = usdValueE8(collateralAmount, collateralDecimals, collateralPriceE8);
  const maxDebtValueE8 = (collateralValueE8 * BigInt(ltvBps)) / 10_000n;
  const currentDebtValueE8 = usdValueE8(existingDebt, debtDecimals, debtPriceE8);
  if (maxDebtValueE8 <= currentDebtValueE8) return 0n;

  const headroomValueE8 = maxDebtValueE8 - currentDebtValueE8;
  return (headroomValueE8 * 10n ** BigInt(debtDecimals)) / debtPriceE8;
}
