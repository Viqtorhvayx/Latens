import { describe, expect, it } from "vitest";
import { commitment, randomSalt, sharesToReal, RAY } from "./positionStore";
import { pedersenCommit } from "./pedersen";

describe("commitment", () => {
  // The actual hash behavior (determinism, ground-truth match against the real circuit's
  // fixture, etc.) is covered in pedersen.test.ts — this just confirms positionStore hasn't
  // drifted from re-exporting that same real implementation.
  it("is the same function as pedersenCommit — must never diverge from it", () => {
    expect(commitment).toBe(pedersenCommit);
  });
});

describe("sharesToReal", () => {
  it("is the identity at unit index", () => {
    expect(sharesToReal(1000n, RAY)).toBe(1000n);
  });

  it("scales up as the index grows past RAY", () => {
    expect(sharesToReal(1000n, RAY + RAY / 2n)).toBe(1500n);
  });

  it("floors instead of rounding", () => {
    expect(sharesToReal(3n, RAY + RAY / 2n)).toBe(4n); // 4.5 -> 4
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
