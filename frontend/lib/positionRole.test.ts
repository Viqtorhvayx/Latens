import { beforeEach, describe, expect, it } from "vitest";

// Same stub as activityStore.test.ts: vitest runs in plain "node" here, and an in-memory
// pair of Web Storage calls is enough for a module that only reads and writes one key.
const memory = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
  },
};

const { getPositionRole, recordPositionRole } = await import("./positionRole");

describe("positionRole", () => {
  beforeEach(() => {
    memory.clear();
  });

  it("has no role for a position that was never opened", () => {
    expect(getPositionRole("0xabc", 1)).toBeUndefined();
  });

  it("records how a position was opened", () => {
    recordPositionRole("0xabc", 1, "lender");
    expect(getPositionRole("0xabc", 1)).toBe("lender");
  });

  it("keeps the opening role when a borrower later tops up through Supply", () => {
    recordPositionRole("0xabc", 1, "borrower");
    recordPositionRole("0xabc", 1, "lender");
    expect(getPositionRole("0xabc", 1)).toBe("borrower");
  });

  it("is case-insensitive about the address, since wallets disagree on checksumming", () => {
    recordPositionRole("0xAbCdEf", 2, "lender");
    expect(getPositionRole("0xabcdef", 2)).toBe("lender");
  });

  it("keeps roles separate per asset", () => {
    recordPositionRole("0xabc", 1, "lender");
    recordPositionRole("0xabc", 2, "borrower");
    expect(getPositionRole("0xabc", 1)).toBe("lender");
    expect(getPositionRole("0xabc", 2)).toBe("borrower");
  });

  it("returns nothing without an address or asset", () => {
    expect(getPositionRole(undefined, 1)).toBeUndefined();
    expect(getPositionRole("0xabc", undefined)).toBeUndefined();
  });
});
