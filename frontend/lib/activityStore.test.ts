import { beforeEach, describe, expect, it } from "vitest";
import { appendActivity, getActivity, activityLabel } from "./activityStore";

// The suite runs under vitest's plain "node" environment (see vitest.config.ts) — no
// `window`/`localStorage` global, and pulling in jsdom for one file's sake isn't worth the
// new dependency. activityStore.ts only reads `window.localStorage` inside its function
// bodies (same pattern as positionStore.ts), so a minimal in-memory stub of just the Web
// Storage surface it actually calls (`getItem`/`setItem`), assigned before any test runs,
// is enough to exercise the real module unmodified.
const memory = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    },
    clear: () => memory.clear(),
  },
};

const ADDR = "0xAbC0000000000000000000000000000000dEF0" as const;
const OTHER = "0x1230000000000000000000000000000000fEEd" as const;

beforeEach(() => {
  memory.clear();
});

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

describe("appendActivity / getActivity", () => {
  it("returns nothing for an address with no history", () => {
    expect(getActivity(ADDR)).toEqual([]);
  });

  it("round-trips an entry, including a large bigint amount", () => {
    appendActivity(ADDR, {
      kind: "collateral",
      isIncrease: true,
      assetId: 1,
      amount: 123456789012345678901234n,
      transactionHash: "0xaaaa",
    });
    const [entry] = getActivity(ADDR);
    expect(entry.amount).toBe(123456789012345678901234n);
    expect(entry.kind).toBe("collateral");
    expect(entry.assetId).toBe(1);
    expect(entry.transactionHash).toBe("0xaaaa");
    expect(typeof entry.timestamp).toBe("number");
  });

  it("orders newest first", () => {
    appendActivity(ADDR, { kind: "collateral", isIncrease: true, assetId: 1, amount: 1n, transactionHash: "0x1" });
    appendActivity(ADDR, { kind: "debt", isIncrease: true, assetId: 2, amount: 2n, transactionHash: "0x2" });
    const entries = getActivity(ADDR);
    expect(entries.map((e) => e.transactionHash)).toEqual(["0x2", "0x1"]);
  });

  it("keeps histories for different addresses separate", () => {
    appendActivity(ADDR, { kind: "collateral", isIncrease: true, assetId: 1, amount: 1n, transactionHash: "0x1" });
    appendActivity(OTHER, { kind: "debt", isIncrease: true, assetId: 2, amount: 2n, transactionHash: "0x2" });
    expect(getActivity(ADDR)).toHaveLength(1);
    expect(getActivity(OTHER)).toHaveLength(1);
    expect(getActivity(ADDR)[0].transactionHash).toBe("0x1");
  });

  it("is case-insensitive on address", () => {
    appendActivity(ADDR, { kind: "collateral", isIncrease: true, assetId: 1, amount: 1n, transactionHash: "0x1" });
    expect(getActivity(ADDR.toLowerCase() as typeof ADDR)).toHaveLength(1);
  });

  it("caps history at 100 entries per address, dropping the oldest", () => {
    for (let i = 0; i < 105; i++) {
      appendActivity(ADDR, { kind: "collateral", isIncrease: true, assetId: 1, amount: BigInt(i), transactionHash: `0x${i}` });
    }
    const entries = getActivity(ADDR);
    expect(entries).toHaveLength(100);
    expect(entries[0].amount).toBe(104n); // newest kept
    expect(entries[99].amount).toBe(5n); // oldest surviving entry — 0..4 dropped
  });
});
