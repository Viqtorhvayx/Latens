import { describe, expect, it } from "vitest";
import { usdValueE8 } from "./valuation";

describe("usdValueE8", () => {
  it("values a whole token at its price", () => {
    // 1 ZEN (18 decimals) at $2.00 (priceE8 = 200_000_000)
    expect(usdValueE8(10n ** 18n, 18, 200_000_000n)).toBe(200_000_000n);
  });

  it("normalizes across differing decimals so equal USD value compares equal", () => {
    // 100 USDC (6 decimals) at $1 vs 100 DAI (18 decimals) at $1 — same USD value.
    const usdcValue = usdValueE8(100n * 10n ** 6n, 6, 100_000_000n);
    const daiValue = usdValueE8(100n * 10n ** 18n, 18, 100_000_000n);
    expect(usdcValue).toBe(daiValue);
  });

  it("catches the bug this module was written to fix: raw amount*price is not comparable across decimals", () => {
    // $2 of 18-decimal collateral vs $100 of 6-decimal debt — the naive (unnormalized)
    // comparison amount*priceE8 makes the tiny 18-decimal collateral look astronomically
    // larger than it is. The normalized value must correctly show collateral < debt.
    const collateralValueE8 = usdValueE8(1n * 10n ** 18n, 18, 200_000_000n); // 1 ZEN @ $2
    const debtValueE8 = usdValueE8(100n * 10n ** 6n, 6, 100_000_000n); // 100 USDC @ $1
    expect(collateralValueE8).toBeLessThan(debtValueE8);
  });

  it("returns zero for a zero amount", () => {
    expect(usdValueE8(0n, 18, 200_000_000n)).toBe(0n);
  });
});
