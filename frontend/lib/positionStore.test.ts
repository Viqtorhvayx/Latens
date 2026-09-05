import { describe, expect, it } from "vitest";
import { commitment, randomSalt } from "./positionStore";

describe("commitment", () => {
  it("is deterministic for the same amount and salt", () => {
    expect(commitment(100n, 42n)).toBe(commitment(100n, 42n));
  });

  it("differs when the amount changes", () => {
    expect(commitment(100n, 42n)).not.toBe(commitment(101n, 42n));
  });

  it("differs when the salt changes", () => {
    expect(commitment(100n, 42n)).not.toBe(commitment(100n, 43n));
  });

  it("is the zero hash only for amount=0, salt=0 (an empty position)", () => {
    expect(commitment(0n, 0n)).toBe(`0x${"0".repeat(64)}`);
    expect(commitment(0n, 1n)).not.toBe(`0x${"0".repeat(64)}`);
  });
});

describe("randomSalt", () => {
  it("produces different values across calls", () => {
    const salts = new Set(Array.from({ length: 20 }, () => randomSalt()));
    expect(salts.size).toBe(20);
  });

  it("stays under the BN254 field size (well under 2^248)", () => {
    for (let i = 0; i < 20; i++) {
      expect(randomSalt()).toBeLessThan(2n ** 248n);
    }
  });
});
