// Both LatensPool and LatensCDP reject any solvency-gated call whose oracle price is older
// than an hour (their shared PRICE_STALENESS_WINDOW). That's the right check against a real
// oracle, but this deployment's oracle is MockPriceOracle, which only advances when someone
// calls it — so a price set once at deploy time ages out after an hour and every borrow,
// withdraw-against-debt, mint and liquidate starts reverting with StaleOraclePrice, no
// matter how correct the rest of the call is. Nothing about the position is wrong; the feed
// just hasn't been touched.
//
// MockPriceOracle.refreshTimestamp() exists for exactly this and is deliberately
// permissionless — it re-stamps a price that's already set without being able to change it,
// so any caller can act as the heartbeat. These helpers decide when that's needed; the
// action flows call it right before the tx that would otherwise revert.
export const PRICE_STALENESS_WINDOW_SECONDS = 3600n;

export function nowSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

// Mirrors _requireFreshPrice() in both contracts, including its guard against a timestamp
// ahead of the current block — that reverts there too, so it counts as needing a refresh.
export function isPriceStale(updatedAt: bigint, now: bigint): boolean {
  if (updatedAt === 0n) return false; // never priced: refreshTimestamp would revert, and the real error is a missing price
  if (updatedAt > now) return true;
  return now - updatedAt > PRICE_STALENESS_WINDOW_SECONDS;
}

// The wallet's clock is not the chain's. Judging staleness a little early is harmless (an
// unnecessary refresh costs gas but always succeeds); judging it late means submitting a tx
// that reverts. So treat anything inside the last few minutes of the window as already
// stale rather than racing the boundary.
const SAFETY_MARGIN_SECONDS = 300n;

export function needsRefresh(updatedAt: bigint, now: bigint): boolean {
  if (updatedAt === 0n) return false;
  if (updatedAt > now) return true;
  return now - updatedAt > PRICE_STALENESS_WINDOW_SECONDS - SAFETY_MARGIN_SECONDS;
}
