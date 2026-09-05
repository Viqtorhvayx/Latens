import { describe, expect, it } from "vitest";
import { deriveViewingKeyPair, encryptNote, decryptNote, publicKeyFromSecretKey } from "./viewingKey";

const SIG_A = "0xaabbcc" as const;
const SIG_B = "0xddeeff" as const;

describe("deriveViewingKeyPair", () => {
  it("is deterministic for the same signature", () => {
    expect(deriveViewingKeyPair(SIG_A)).toEqual(deriveViewingKeyPair(SIG_A));
  });

  it("differs for a different signature", () => {
    expect(deriveViewingKeyPair(SIG_A).publicKey).not.toBe(deriveViewingKeyPair(SIG_B).publicKey);
  });
});

describe("publicKeyFromSecretKey", () => {
  it("recovers the same public key the pair was derived with", () => {
    const pair = deriveViewingKeyPair(SIG_A);
    expect(publicKeyFromSecretKey(pair.secretKey)).toBe(pair.publicKey);
  });
});

describe("encryptNote / decryptNote", () => {
  it("round-trips amount and salt exactly", () => {
    const pair = deriveViewingKeyPair(SIG_A);
    const ciphertext = encryptNote(pair, { amount: "123456789000000000000", salt: "42" });
    const decrypted = decryptNote(pair.secretKey, pair.publicKey, ciphertext);
    expect(decrypted).toEqual({ amount: "123456789000000000000", salt: "42" });
  });

  it("produces a different ciphertext each time (random nonce) for the same contents", () => {
    const pair = deriveViewingKeyPair(SIG_A);
    const c1 = encryptNote(pair, { amount: "100", salt: "1" });
    const c2 = encryptNote(pair, { amount: "100", salt: "1" });
    expect(c1).not.toBe(c2);
  });

  it("fails to decrypt with the wrong secret key", () => {
    const pair = deriveViewingKeyPair(SIG_A);
    const wrongPair = deriveViewingKeyPair(SIG_B);
    const ciphertext = encryptNote(pair, { amount: "100", salt: "1" });
    expect(decryptNote(wrongPair.secretKey, wrongPair.publicKey, ciphertext)).toBeNull();
  });

  it("fails to decrypt tampered ciphertext instead of returning garbage", () => {
    const pair = deriveViewingKeyPair(SIG_A);
    const ciphertext = encryptNote(pair, { amount: "100", salt: "1" });
    const tampered = (ciphertext.slice(0, -2) + (ciphertext.endsWith("00") ? "ff" : "00")) as `0x${string}`;
    expect(decryptNote(pair.secretKey, pair.publicKey, tampered)).toBeNull();
  });
});
