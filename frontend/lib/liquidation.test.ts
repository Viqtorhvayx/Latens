import { describe, expect, it } from "vitest";
import { isInsolvent, maxSeizableCollateral } from "./liquidation";

describe("isInsolvent", () => {
  it("is false for a position within its liquidation threshold", () => {
    // 100 ZEN @ $2 = $200 collateral, 150 USDC @ $1 debt, 85% threshold -> max $170 debt
    const insolvent = isInsolvent(100n * 10n ** 18n, 18, 200_000_000n, 150n * 10n ** 6n, 6, 100_000_000n, 8_500);
    expect(insolvent).toBe(false);
  });

  it("is true once debt exceeds the liquidation threshold", () => {
    // Same position after ZEN crashes to $1.40: $140 collateral, 85% threshold -> max $119 debt, but debt is $160
    const insolvent = isInsolvent(100n * 10n ** 18n, 18, 140_000_000n, 160n * 10n ** 6n, 6, 100_000_000n, 8_500);
    expect(insolvent).toBe(true);
  });

  it("is false exactly at the threshold boundary", () => {
    // $200 collateral * 85% = $170 debt exactly
    const insolvent = isInsolvent(100n * 10n ** 18n, 18, 200_000_000n, 170n * 10n ** 6n, 6, 100_000_000n, 8_500);
    expect(insolvent).toBe(false);
  });
});

describe("maxSeizableCollateral", () => {
  it("caps seizure at repaid value plus bonus", () => {
    // Repay 160 USDC @ $1 with an 8% bonus = $172.80 seizable value, ZEN @ $1.40 -> 123.43 ZEN
    const seized = maxSeizableCollateral(160n * 10n ** 6n, 6, 100_000_000n, 1000n * 10n ** 18n, 18, 140_000_000n, 800);
    // 172.8 / 1.4 = 123.428571... ZEN, in 18-decimal base units
    const expected = (1728n * 10n ** 18n) / 14n;
    expect(seized).toBe(expected);
  });

  it("never seizes more than the position actually holds", () => {
    // Same repay/bonus/price as above, but the position only holds 100 ZEN (< the 123.4 computed above)
    const seized = maxSeizableCollateral(160n * 10n ** 6n, 6, 100_000_000n, 100n * 10n ** 18n, 18, 140_000_000n, 800);
    expect(seized).toBe(100n * 10n ** 18n);
  });

  it("returns zero if the collateral price is zero", () => {
    const seized = maxSeizableCollateral(160n * 10n ** 6n, 6, 100_000_000n, 100n * 10n ** 18n, 18, 0n, 800);
    expect(seized).toBe(0n);
  });
});
