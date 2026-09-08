// Converts a token amount (in its own base units) to a USD value in 8-decimal fixed point
// (matching the oracle's own priceE8 convention: priceE8 is USD per ONE WHOLE token, scaled
// by 1e8 — e.g. ZEN at $2.00 is priceE8 = 200_000_000n).
//
// The bug this exists to prevent: multiplying a raw base-unit amount directly by priceE8
// (no division by the token's own decimals) only produces a comparable value when two
// tokens happen to share the same decimals. ZEN/ZUSD (18), USDC (6), and WBTC (8) don't, so
// comparing collateral and debt "value" that way silently favors whichever side has the
// larger decimals — e.g. it previously made a position holding 18-decimal collateral
// against 6-decimal debt look effectively infinitely safe, regardless of actual amounts.
export function usdValueE8(amountBaseUnits: bigint, decimals: number, priceE8: bigint): bigint {
  return (amountBaseUnits * priceE8) / 10n ** BigInt(decimals);
}

export function formatUsd(valueE8: bigint): string {
  return (Number(valueE8) / 1e8).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export function formatApr(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

// A supply rate is a borrow rate scaled down twice, by utilization and again by the reserve
// factor, so a young market's is routinely a fraction of a basis point. AssetRegistry's own
// `supplyRateBps` floors that to 0 and the UI then reads a flat "0.00%" next to a market
// that is visibly being borrowed from. This recomputes the same formula at 1e18 so the
// small numbers survive; it matches `AssetRegistry.supplyRateRay` exactly.
export function supplyRateRayFrom(borrowRateBps: bigint, utilizationBps: bigint, reserveFactorBps: bigint): bigint {
  const RAY = 10n ** 18n;
  const BPS = 10_000n;
  const borrowRateRay = (borrowRateBps * RAY) / BPS;
  const grossRateRay = (borrowRateRay * utilizationBps) / BPS;
  return (grossRateRay * (BPS - reserveFactorBps)) / BPS;
}

// Percent from a RAY-scaled annual rate (1e18 = 100%). Rates under a basis point are shown
// with enough decimals to be a number rather than a rounded-off zero.
export function formatRateRay(rateRay: bigint): string {
  const pct = Number(rateRay) / 1e16;
  if (pct === 0) return "0.00%";
  if (pct < 0.01) return `${pct.toFixed(4)}%`;
  return `${pct.toFixed(2)}%`;
}

// A unit price, which unlike a portfolio total is often worth less than a dollar (and in
// this market set spans $1 to $60,000). formatUsd rounds to whole dollars, which would show
// every stablecoin as "$1" and anything cheaper as "$0"; this keeps cents, and more than
// cents when the price is small enough to need them.
export function formatUsdPrecise(valueE8: bigint): string {
  const value = Number(valueE8) / 1e8;
  if (value === 0) return "$0.00";
  const maximumFractionDigits = value < 0.01 ? 6 : 2;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits });
}
