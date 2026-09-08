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

// The inverse of borrowCapacity: how much of a position's collateral is actually locked
// against its debt, in the collateral's own base units — not the whole supplied balance.
// A position that supplied 1000 USDC and borrowed 4 ZEN doesn't have all 1000 USDC on the
// line, only whatever the debt (principal plus the interest accrued on it since it was last
// touched — pass debtAmount already inclusive of that, see quoteRepayInterestFee) is worth
// at the market's required overcollateralization (1 / LTV). The rest stays free: safe from
// liquidation and, so long as it keeps the position solvent, withdrawable.
//
// Clamp to the actual supplied amount rather than the raw ratio: a position sitting right at
// its LTV limit would otherwise report "locked" fractionally above what it holds, and the
// caller (locked = min(supplied, this)) would need to know that to avoid showing more locked
// than exists.
export function lockedCollateral({
  debtAmount,
  debtDecimals,
  debtPriceE8,
  ltvBps,
  collateralDecimals,
  collateralPriceE8,
}: {
  debtAmount: bigint;
  debtDecimals: number;
  debtPriceE8: bigint;
  ltvBps: number;
  collateralDecimals: number;
  collateralPriceE8: bigint;
}): bigint {
  if (collateralPriceE8 === 0n || ltvBps === 0 || debtAmount === 0n) return 0n;

  const debtValueE8 = usdValueE8(debtAmount, debtDecimals, debtPriceE8);
  const requiredValueE8 = (debtValueE8 * 10_000n) / BigInt(ltvBps);
  return (requiredValueE8 * 10n ** BigInt(collateralDecimals)) / collateralPriceE8;
}
