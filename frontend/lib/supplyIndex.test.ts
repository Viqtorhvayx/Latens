import { describe, expect, it } from "vitest";
import { projectSupplyIndexRay, SUPPLY_INDEX_PROJECTION_SECONDS } from "./supplyIndex";

const RAY = 10n ** 18n;

describe("projectSupplyIndexRay", () => {
  it("leaves an idle asset's index untouched", () => {
    expect(projectSupplyIndexRay(RAY, 0n)).toBe(RAY);
  });

  it("matches AssetRegistry.currentSupplyIndexRay's own arithmetic", () => {
    // index + index * rateBps * elapsed / (10_000 * 31_536_000)
    const index = 1_000_000_003_691_019_786n;
    const rateBps = 1n;
    const elapsed = 600n;
    const expected = index + (index * rateBps * elapsed) / (10_000n * 31_536_000n);
    expect(projectSupplyIndexRay(index, rateBps, elapsed)).toBe(expected);
  });

  it("only ever moves the index up, so the derived share delta only moves down", () => {
    const index = 1_000_000_003_691_019_786n;
    const projected = projectSupplyIndexRay(index, 1n);
    expect(projected).toBeGreaterThan(index);

    const amount = 50n * RAY;
    expect((amount * RAY) / projected).toBeLessThan((amount * RAY) / index);
  });

  it("covers the drift that actually reverted a real deposit", () => {
    // The live failure: index read at 1000000003691019786, mined ~29s later at
    // 1000000003782978183. A projection over the default window has to reach past that.
    const readIndex = 1_000_000_003_691_019_786n;
    const indexAtMining = 1_000_000_003_782_978_183n;
    const observedRateBps = 1n;
    expect(projectSupplyIndexRay(readIndex, observedRateBps, SUPPLY_INDEX_PROJECTION_SECONDS)).toBeGreaterThanOrEqual(indexAtMining);
  });
});
