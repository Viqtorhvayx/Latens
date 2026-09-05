import { describe, expect, it } from "vitest";
import { pedersenCommit } from "./pedersen";

describe("pedersenCommit", () => {
  it("matches circuits/commitment_update's own Prover.toml fixture exactly", async () => {
    // ../circuits/commitment_update/Prover.toml: commit(100, 42) must equal this literal
    // value — this is the real circuit's own ground truth, not a value chosen by this test.
    expect(await pedersenCommit(100n, 42n)).toBe("0x29275e212299c97d20d7976931cffaa92e97d5ba04ec6c06409a7c45c29bbe4a");
  });

  it("is deterministic", async () => {
    expect(await pedersenCommit(100n, 42n)).toBe(await pedersenCommit(100n, 42n));
  });

  it("depends on both amount and salt", async () => {
    expect(await pedersenCommit(100n, 42n)).not.toBe(await pedersenCommit(101n, 42n));
    expect(await pedersenCommit(100n, 42n)).not.toBe(await pedersenCommit(100n, 43n));
  });

  it("is the zero hash only for amount=0, salt=0 (an empty position)", async () => {
    expect(await pedersenCommit(0n, 0n)).toBe(`0x${"0".repeat(64)}`);
    expect(await pedersenCommit(0n, 1n)).not.toBe(`0x${"0".repeat(64)}`);
  });
});
