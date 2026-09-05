import { describe, expect, it } from "vitest";
import { sanitizeAmountInput } from "./amountInput";

describe("sanitizeAmountInput", () => {
  it("strips non-numeric characters", () => {
    expect(sanitizeAmountInput("1a2b.3c", 18)).toBe("12.3");
  });

  it("passes through a plain valid number", () => {
    expect(sanitizeAmountInput("123.45", 18)).toBe("123.45");
  });

  it("collapses extra decimal points to the first one", () => {
    expect(sanitizeAmountInput("1.2.3", 18)).toBe("1.23");
  });

  it("truncates decimal digits to the token's precision", () => {
    expect(sanitizeAmountInput("1.1234567", 6)).toBe("1.123456");
  });

  it("allows typing a bare trailing decimal point", () => {
    expect(sanitizeAmountInput("1.", 18)).toBe("1.");
  });

  it("drops the decimal point entirely for a zero-decimals token", () => {
    expect(sanitizeAmountInput("1.5", 0)).toBe("1");
  });

  it("handles an empty string", () => {
    expect(sanitizeAmountInput("", 18)).toBe("");
  });
});
