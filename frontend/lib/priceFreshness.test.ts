import { describe, expect, it } from "vitest";
import { isPriceStale, needsRefresh, PRICE_STALENESS_WINDOW_SECONDS } from "./priceFreshness";

const NOW = 1_700_000_000n;

describe("isPriceStale", () => {
  it("accepts a price set just now", () => {
    expect(isPriceStale(NOW, NOW)).toBe(false);
  });

  it("accepts a price right at the window boundary, matching the contract's strict >", () => {
    expect(isPriceStale(NOW - PRICE_STALENESS_WINDOW_SECONDS, NOW)).toBe(false);
  });

  it("rejects a price one second past the window", () => {
    expect(isPriceStale(NOW - PRICE_STALENESS_WINDOW_SECONDS - 1n, NOW)).toBe(true);
  });

  it("rejects a timestamp ahead of now, which the contract also rejects", () => {
    expect(isPriceStale(NOW + 1n, NOW)).toBe(true);
  });

  it("does not call an unpriced asset stale — refreshTimestamp would revert on it", () => {
    expect(isPriceStale(0n, NOW)).toBe(false);
  });
});

describe("needsRefresh", () => {
  it("refreshes early, inside the safety margin, rather than racing the boundary", () => {
    // 58 minutes old: still valid on-chain, but close enough that clock skew could flip it.
    expect(isPriceStale(NOW - 3_480n, NOW)).toBe(false);
    expect(needsRefresh(NOW - 3_480n, NOW)).toBe(true);
  });

  it("leaves a genuinely fresh price alone", () => {
    expect(needsRefresh(NOW - 60n, NOW)).toBe(false);
  });

  it("does not try to refresh an unpriced asset", () => {
    expect(needsRefresh(0n, NOW)).toBe(false);
  });
});
