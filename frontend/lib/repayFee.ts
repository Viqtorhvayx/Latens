// The interest fee owed on a repayment is time-weighted, so it grows every second the debt
// sits there:
//
//   fee = amount * borrowRateBps * (now - debtLastUpdated) / (10_000 * SECONDS_PER_YEAR)
//
// Quoting it once and approving exactly `amount + fee` therefore approves a number that is
// already stale by the time a wallet finishes signing, and `repay` pulls the fee it
// recomputes at mining time — a few hundred femto-tokens more. The ERC20 allowance is short
// by that sliver and the whole repayment reverts with ERC20InsufficientAllowance, which is
// what made repaying look permanently broken while every other action worked.
//
// Same shape of bug as the supply-index drift (see supplyIndex.ts): a continuously-moving
// quantity read on the client and recomputed on-chain. Here it is simpler to absorb, since
// an allowance is a ceiling rather than a transfer — approving for a fee a while into the
// future costs nothing and nothing extra is pulled.
const BPS_DENOMINATOR = 10_000n;
const SECONDS_PER_YEAR = 31_536_000n;

// How far ahead to quote the fee when approving. Comfortably longer than signing takes; the
// only cost of overshooting is a slightly larger allowance that goes unused.
export const REPAY_FEE_PROJECTION_SECONDS = 1_800n;

// Mirrors AssetRegistry.quoteRepayInterestFee exactly.
export function repayInterestFee(amount: bigint, borrowRateBps: bigint, elapsedSeconds: bigint): bigint {
  if (elapsedSeconds <= 0n) return 0n;
  return (amount * borrowRateBps * elapsedSeconds) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
}

// The fee to approve for: what is owed now, plus what will accrue while the transaction is
// being signed and mined.
export function projectedRepayFee(
  amount: bigint,
  borrowRateBps: bigint,
  elapsedSeconds: bigint,
  projectionSeconds = REPAY_FEE_PROJECTION_SECONDS,
): bigint {
  return repayInterestFee(amount, borrowRateBps, (elapsedSeconds > 0n ? elapsedSeconds : 0n) + projectionSeconds);
}

// The largest repayment whose amount AND its projected fee the wallet balance still covers.
// The fee is linear in the amount, so this inverts amount + fee(amount) <= balance directly
// rather than guessing and retrying.
export function maxRepayableAmount(debt: bigint, balance: bigint, borrowRateBps: bigint, elapsedSeconds: bigint, projectionSeconds = REPAY_FEE_PROJECTION_SECONDS): bigint {
  if (debt === 0n || balance === 0n) return 0n;
  if (debt + projectedRepayFee(debt, borrowRateBps, elapsedSeconds, projectionSeconds) <= balance) return debt;

  // fee(A) = A * k where k = rate * elapsed / (BPS * YEAR), so A * (1 + k) <= balance.
  // Working in the same integer terms: A <= balance * (BPS * YEAR) / (BPS * YEAR + rate * elapsed).
  const totalElapsed = (elapsedSeconds > 0n ? elapsedSeconds : 0n) + projectionSeconds;
  const denominatorTerm = BPS_DENOMINATOR * SECONDS_PER_YEAR + borrowRateBps * totalElapsed;
  const affordable = (balance * BPS_DENOMINATOR * SECONDS_PER_YEAR) / denominatorTerm;
  return affordable < debt ? affordable : debt;
}
