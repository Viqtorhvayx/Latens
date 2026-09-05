import { describe, expect, it } from "vitest";
import { activityLabel } from "./activity";

describe("activityLabel", () => {
  it("labels a collateral increase as Supplied", () => {
    expect(activityLabel({ kind: "collateral", isIncrease: true })).toBe("Supplied");
  });
  it("labels a collateral decrease as Withdrew", () => {
    expect(activityLabel({ kind: "collateral", isIncrease: false })).toBe("Withdrew");
  });
  it("labels a debt increase as Borrowed", () => {
    expect(activityLabel({ kind: "debt", isIncrease: true })).toBe("Borrowed");
  });
  it("labels a debt decrease as Repaid", () => {
    expect(activityLabel({ kind: "debt", isIncrease: false })).toBe("Repaid");
  });
});
