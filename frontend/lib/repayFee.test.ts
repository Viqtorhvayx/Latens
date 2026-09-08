import { describe, expect, it } from "vitest";
import { repayInterestFee, projectedRepayFee, maxRepayableAmount, REPAY_FEE_PROJECTION_SECONDS } from "./repayFee";

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

describe("maxRepayableAmount", () => {
  it("repays the whole debt when the balance covers it plus the fee", () => {
    const debt = 10n * ZEN;
    const balance = 20n * ZEN;
    expect(maxRepayableAmount(debt, balance, BORROW_RATE_BPS, 3_600n)).toBe(debt);
  });

  it("leaves room for the fee when the balance is exactly the debt", () => {
    // The live case: borrowed 20 ZEN, holding exactly 20 ZEN, so the fee has nowhere to
    // come from. The old Max filled in the full 20 and the transaction could only revert.
    const debt = 20n * ZEN;
    const balance = 20n * ZEN;
    const max = maxRepayableAmount(debt, balance, BORROW_RATE_BPS, 3_600n);
    expect(max).toBeLessThan(debt);
    expect(max + projectedRepayFee(max, BORROW_RATE_BPS, 3_600n)).toBeLessThanOrEqual(balance);
  });

  it("never returns an amount whose projected fee overruns the balance", () => {
    for (const [debt, balance, elapsed] of [
      [20n * ZEN, 20n * ZEN, 3_600n],
      [100n * ZEN, 5n * ZEN, 86_400n],
      [1n * ZEN, 1n * ZEN, 31_536_000n],
    ] as const) {
      const max = maxRepayableAmount(debt, balance, BORROW_RATE_BPS, elapsed);
      expect(max + projectedRepayFee(max, BORROW_RATE_BPS, elapsed)).toBeLessThanOrEqual(balance);
    }
  });

  it("is zero with nothing owed or nothing held", () => {
    expect(maxRepayableAmount(0n, 20n * ZEN, BORROW_RATE_BPS, 600n)).toBe(0n);
    expect(maxRepayableAmount(20n * ZEN, 0n, BORROW_RATE_BPS, 600n)).toBe(0n);
  });

  it("uses the projection window, so a slow signature does not invalidate the amount", () => {
    const debt = 20n * ZEN;
    const balance = 20n * ZEN;
    const max = maxRepayableAmount(debt, balance, BORROW_RATE_BPS, 0n);
    // Still covered even if mining lands at the far end of the window.
    expect(max + repayInterestFee(max, BORROW_RATE_BPS, REPAY_FEE_PROJECTION_SECONDS)).toBeLessThanOrEqual(balance);
  });
});
