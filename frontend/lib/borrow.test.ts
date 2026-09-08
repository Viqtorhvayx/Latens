import { describe, expect, it } from "vitest";
import { borrowCapacity, lockedCollateral } from "./borrow";

const ZEN = { decimals: 18, priceE8: 200_000_000n }; // $2
const USDC = { decimals: 6, priceE8: 100_000_000n }; // $1

describe("borrowCapacity", () => {
  it("allows LTV of the collateral's value when there is no debt yet", () => {
    // 1000 USDC collateral at $1, 80% LTV -> $800 of borrowing power -> 400 ZEN at $2.
    const capacity = borrowCapacity({
      collateralAmount: 1000n * 10n ** 6n,
      collateralDecimals: USDC.decimals,
      collateralPriceE8: USDC.priceE8,
      ltvBps: 8_000,
      existingDebt: 0n,
      debtDecimals: ZEN.decimals,
      debtPriceE8: ZEN.priceE8,
    });
    expect(capacity).toBe(400n * 10n ** 18n);
  });

  it("subtracts debt already drawn", () => {
    // Same position, but 100 ZEN ($200) already borrowed -> $600 left -> 300 ZEN.
    const capacity = borrowCapacity({
      collateralAmount: 1000n * 10n ** 6n,
      collateralDecimals: USDC.decimals,
      collateralPriceE8: USDC.priceE8,
      ltvBps: 8_000,
      existingDebt: 100n * 10n ** 18n,
      debtDecimals: ZEN.decimals,
      debtPriceE8: ZEN.priceE8,
    });
    expect(capacity).toBe(300n * 10n ** 18n);
  });

  it("returns zero with no collateral — this is what sends the borrow flow to its collateral step", () => {
    expect(
      borrowCapacity({
        collateralAmount: 0n,
        collateralDecimals: USDC.decimals,
        collateralPriceE8: USDC.priceE8,
        ltvBps: 8_000,
        existingDebt: 0n,
        debtDecimals: ZEN.decimals,
        debtPriceE8: ZEN.priceE8,
      }),
    ).toBe(0n);
  });

  it("returns zero rather than going negative when debt already exceeds the limit", () => {
    const capacity = borrowCapacity({
      collateralAmount: 100n * 10n ** 6n, // $100 -> $80 limit
      collateralDecimals: USDC.decimals,
      collateralPriceE8: USDC.priceE8,
      ltvBps: 8_000,
      existingDebt: 100n * 10n ** 18n, // 100 ZEN = $200, well past it
      debtDecimals: ZEN.decimals,
      debtPriceE8: ZEN.priceE8,
    });
    expect(capacity).toBe(0n);
  });

  it("normalizes across decimals — 18-decimal collateral against 6-decimal debt", () => {
    // 10 ZEN ($20) at 80% -> $16 -> 16 USDC.
    const capacity = borrowCapacity({
      collateralAmount: 10n * 10n ** 18n,
      collateralDecimals: ZEN.decimals,
      collateralPriceE8: ZEN.priceE8,
      ltvBps: 8_000,
      existingDebt: 0n,
      debtDecimals: USDC.decimals,
      debtPriceE8: USDC.priceE8,
    });
    expect(capacity).toBe(16n * 10n ** 6n);
  });

  it("refuses to divide by an unanswered oracle price", () => {
    expect(
      borrowCapacity({
        collateralAmount: 1000n * 10n ** 6n,
        collateralDecimals: USDC.decimals,
        collateralPriceE8: USDC.priceE8,
        ltvBps: 8_000,
        existingDebt: 0n,
        debtDecimals: ZEN.decimals,
        debtPriceE8: 0n,
      }),
    ).toBe(0n);
  });
});

describe("lockedCollateral", () => {
  it("locks only what the debt is worth at the required overcollateralization, not the whole supply", () => {
    // 4 ZEN at $2 = $8 of debt. 80% LTV means 1/0.8 = 125% overcollateralization -> $10
    // required -> 10 USDC locked, out of a 1000 USDC supply.
    const locked = lockedCollateral({
      debtAmount: 4n * 10n ** 18n,
      debtDecimals: ZEN.decimals,
      debtPriceE8: ZEN.priceE8,
      ltvBps: 8_000,
      collateralDecimals: USDC.decimals,
      collateralPriceE8: USDC.priceE8,
    });
    expect(locked).toBe(10n * 10n ** 6n);
  });

  it("grows when the debt amount passed in already includes accrued interest", () => {
    // Same position, but debtAmount now includes a 0.5 ZEN interest accrual: 4.5 ZEN = $9 ->
    // $11.25 required -> 11.25 USDC.
    const locked = lockedCollateral({
      debtAmount: 45n * 10n ** 17n,
      debtDecimals: ZEN.decimals,
      debtPriceE8: ZEN.priceE8,
      ltvBps: 8_000,
      collateralDecimals: USDC.decimals,
      collateralPriceE8: USDC.priceE8,
    });
    expect(locked).toBe(11_250_000n);
  });

  it("is zero with no debt", () => {
    expect(
      lockedCollateral({
        debtAmount: 0n,
        debtDecimals: ZEN.decimals,
        debtPriceE8: ZEN.priceE8,
        ltvBps: 8_000,
        collateralDecimals: USDC.decimals,
        collateralPriceE8: USDC.priceE8,
      }),
    ).toBe(0n);
  });

  it("refuses to divide by an unanswered oracle price", () => {
    expect(
      lockedCollateral({
        debtAmount: 4n * 10n ** 18n,
        debtDecimals: ZEN.decimals,
        debtPriceE8: ZEN.priceE8,
        ltvBps: 8_000,
        collateralDecimals: USDC.decimals,
        collateralPriceE8: 0n,
      }),
    ).toBe(0n);
  });
});
