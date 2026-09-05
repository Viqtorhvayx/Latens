// Converts a token amount (in its own base units) to a USD value in 8-decimal fixed point
// (matching the oracle's own priceE8 convention: priceE8 is USD per ONE WHOLE token, scaled
// by 1e8 — e.g. ZEN at $2.00 is priceE8 = 200_000_000n).
//
// The bug this exists to prevent: multiplying a raw base-unit amount directly by priceE8
// (no division by the token's own decimals) only produces a comparable value when two
// tokens happen to share the same decimals. ZEN/DAI (18), USDC (6), and WBTC (8) don't, so
// comparing collateral and debt "value" that way silently favors whichever side has the
// larger decimals — e.g. it previously made a position holding 18-decimal collateral
// against 6-decimal debt look effectively infinitely safe, regardless of actual amounts.
export function usdValueE8(amountBaseUnits: bigint, decimals: number, priceE8: bigint): bigint {
  return (amountBaseUnits * priceE8) / 10n ** BigInt(decimals);
}
