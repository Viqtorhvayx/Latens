import { describe, expect, it } from "vitest";
import { projectSupplyIndexRay, SUPPLY_INDEX_PROJECTION_SECONDS } from "./supplyIndex";
import { supplyRateRayFrom } from "./valuation";

const RAY = 10n ** 18n;

describe("projectSupplyIndexRay", () => {
  it("leaves an idle asset's index untouched", () => {
    expect(projectSupplyIndexRay(RAY, 0n)).toBe(RAY);
  });

  it("matches AssetRegistry.currentSupplyIndexRay's own arithmetic", () => {
    // index + index * rateRay * elapsed / (RAY * 31_536_000)
    const index = 1_000_000_003_691_019_786n;
    const rateRay = supplyRateRayFrom(205n, 40n, 1_000n);
    const elapsed = 600n;
    const expected = index + (index * rateRay * elapsed) / (RAY * 31_536_000n);
    expect(projectSupplyIndexRay(index, rateRay, elapsed)).toBe(expected);
  });

  it("still projects at a sub-basis-point rate, where the bps view reads zero", () => {
    // The regression this guards: driven off supplyRateBps this returned the index
    // unchanged, so a deposit raced the index exactly as before the fix.
    const rateRay = supplyRateRayFrom(205n, 40n, 1_000n);
    expect((rateRay * 10_000n) / RAY).toBe(0n); // bps view is zero
    const index = 1_000_000_003_691_019_786n;
    expect(projectSupplyIndexRay(index, rateRay)).toBeGreaterThan(index);
  });

  it("only ever moves the index up, so the derived share delta only moves down", () => {
    const index = 1_000_000_003_691_019_786n;
    const projected = projectSupplyIndexRay(index, supplyRateRayFrom(500n, 5_000n, 1_000n));
    expect(projected).toBeGreaterThan(index);

    const amount = 50n * RAY;
    expect((amount * RAY) / projected).toBeLessThan((amount * RAY) / index);
  });

  it("covers the drift that actually reverted a real deposit", () => {
    // The live failure: index read at 1000000003691019786, mined ~29s later at
    // 1000000003782978183. A projection over the default window has to reach past that.
    const readIndex = 1_000_000_003_691_019_786n;
    const indexAtMining = 1_000_000_003_782_978_183n;
    const rateRay = supplyRateRayFrom(78n, 320n, 1_000n); // ZUSD at the time: 0.78% APR, 3.2% util
    expect(projectSupplyIndexRay(readIndex, rateRay, SUPPLY_INDEX_PROJECTION_SECONDS)).toBeGreaterThanOrEqual(indexAtMining);
  });
});
