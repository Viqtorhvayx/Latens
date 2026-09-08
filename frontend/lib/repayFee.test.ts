import { describe, expect, it } from "vitest";
import { repayInterestFee, projectedRepayFee } from "./repayFee";

const ZEN = 10n ** 18n;
const BORROW_RATE_BPS = 205n; // 2.05%, the live ZEN rate

describe("repayInterestFee", () => {
  it("matches AssetRegistry.quoteRepayInterestFee's own arithmetic", () => {
    const amount = 20n * ZEN;
    const elapsed = 3_600n;
    expect(repayInterestFee(amount, BORROW_RATE_BPS, elapsed)).toBe((amount * BORROW_RATE_BPS * elapsed) / (10_000n * 31_536_000n));
  });

  it("is zero before any time has passed", () => {
    expect(repayInterestFee(20n * ZEN, BORROW_RATE_BPS, 0n)).toBe(0n);
  });

  it("grows with every second the debt sits there, which is what the approval kept missing", () => {
    const a = repayInterestFee(20n * ZEN, BORROW_RATE_BPS, 600n);
    const b = repayInterestFee(20n * ZEN, BORROW_RATE_BPS, 660n);
    expect(b).toBeGreaterThan(a);
  });
});

describe("projectedRepayFee", () => {
  it("covers the real shortfall that reverted a live repayment", () => {
    // The actual failure: approved 19.000040301195459157 ZEN of allowance against
    // 19.000040758181126331 needed at mining. Approving on the projected fee has to clear
    // the gap with room to spare.
    const amount = 19n * ZEN;
    const approvedFee = 40_301_195_459_157n; // what the UI quoted
    const neededFee = 40_758_181_126_331n; // what the pool recomputed
    expect(approvedFee).toBeLessThan(neededFee); // the bug, restated

    // Reconstruct the elapsed time the quoted fee implies, then project from there.
    const elapsed = (approvedFee * 10_000n * 31_536_000n) / (amount * BORROW_RATE_BPS);
    expect(projectedRepayFee(amount, BORROW_RATE_BPS, elapsed)).toBeGreaterThan(neededFee);
  });

  it("is never smaller than the fee owed right now", () => {
    const amount = 20n * ZEN;
    for (const elapsed of [0n, 1n, 600n, 86_400n]) {
      expect(projectedRepayFee(amount, BORROW_RATE_BPS, elapsed)).toBeGreaterThanOrEqual(repayInterestFee(amount, BORROW_RATE_BPS, elapsed));
    }
  });
});
