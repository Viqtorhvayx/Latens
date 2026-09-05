// Standing viewing keys — the upgrade lib/disclosure.ts's own header comment named as a
// deliberate follow-up rather than something built in that pass: instead of the position
// owner re-exporting and re-signing a fresh disclosure file after every change, they publish
// a self-encrypted note on-chain (LatensPool.publishViewingNote) alongside each action, and
// share the resulting PRIVATE viewing key with an auditor once. The auditor then gets
// passive, ongoing access to every past and future note for that address — the same shape
// as a Zcash viewing key — by scanning ViewingNotePublished events and decrypting them.
//
// The encryption itself is nacl.box (X25519-XSalsa20-Poly1305), the same authenticated-
// encryption construction MetaMask's own now-deprecated eth_getEncryptionPublicKey/eth_decrypt
// used — not a bespoke scheme. The viewing keypair is deterministic, derived from a wallet
// signature rather than randomly generated and stored: the owner can always re-derive it by
// re-signing the same fixed message, so there's nothing sensitive to persist client-side
// beyond the current browser session's in-memory cache (see lib/viewingKeyContext.tsx).
//
// What this does NOT change: LatensPool never verifies `ciphertext` is well-formed or
// correctly opens the position's real commitment — see publishViewingNote's own NatSpec.
// An auditor's trust still runs through the same live on-chain commitment check
// lib/disclosure.ts's `recomputeCommitment` already performs; this only removes the need
// for the owner to act again after every change.
import nacl from "tweetnacl";
import { bytesToHex, hexToBytes, keccak256, stringToBytes, bytesToString, type Hex } from "viem";

export type ViewingKeyPair = {
  publicKey: Hex;
  secretKey: Hex;
};

export const VIEWING_KEY_MESSAGE = "Latens viewing key v1 — do not sign this on any other site.";

// Deterministic: the same wallet signing the same fixed message always derives the same
// keypair, so the owner never needs to store the secret key anywhere to keep using it —
// only an auditor they've chosen to share it with does.
export function deriveViewingKeyPair(signature: Hex): ViewingKeyPair {
  const seed = hexToBytes(keccak256(signature));
  const keyPair = nacl.box.keyPair.fromSecretKey(seed);
  return { publicKey: bytesToHex(keyPair.publicKey), secretKey: bytesToHex(keyPair.secretKey) };
}

export type NoteContents = { amount: string; salt: string };

// Self-sealed: the note is encrypted FROM the owner's viewing key TO the owner's own viewing
// key (nacl.box's Diffie-Hellman step is symmetric, so using the same keypair on both sides
// is a valid, correctly-authenticated box, not a shortcut). Sharing the SECRET key later is
// what grants an auditor decrypt access — nothing about the ciphertext itself changes.
export function encryptNote(keyPair: ViewingKeyPair, contents: NoteContents): Hex {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const plaintext = stringToBytes(JSON.stringify(contents));
  const box = nacl.box(plaintext, nonce, hexToBytes(keyPair.publicKey), hexToBytes(keyPair.secretKey));
  const combined = new Uint8Array(nonce.length + box.length);
  combined.set(nonce, 0);
  combined.set(box, nonce.length);
  return bytesToHex(combined);
}

export function decryptNote(secretKey: Hex, publicKey: Hex, ciphertext: Hex): NoteContents | null {
  try {
    const combined = hexToBytes(ciphertext);
    const nonce = combined.slice(0, nacl.box.nonceLength);
    const box = combined.slice(nacl.box.nonceLength);
    const plaintext = nacl.box.open(box, nonce, hexToBytes(publicKey), hexToBytes(secretKey));
    if (!plaintext) return null;
    const parsed = JSON.parse(bytesToString(plaintext));
    if (typeof parsed.amount !== "string" || typeof parsed.salt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function publicKeyFromSecretKey(secretKey: Hex): Hex {
  const keyPair = nacl.box.keyPair.fromSecretKey(hexToBytes(secretKey));
  return bytesToHex(keyPair.publicKey);
}
