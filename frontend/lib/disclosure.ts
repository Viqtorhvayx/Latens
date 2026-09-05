// Selective-disclosure export/verify — the "viewing key" feature, M1 scope.
//
// This is the "disclosure export" design, not the full Zcash-style standing viewing key:
// the position owner explicitly signs and hands over a snapshot naming exactly what's
// disclosed, rather than an auditor holding a key that can decrypt an on-chain ciphertext
// stream on their own schedule. That's a real, smaller feature — see the follow-up note
// below for what upgrading to a standing key would require.
//
// IMPORTANT — this reuses positionStore's placeholder keccak256(amount, salt) commitment,
// NOT the real Pedersen scheme in circuits/latens_common. That's consistent with the rest
// of this dev build (MockVerifier doesn't care), but means the on-chain match this performs
// is only meaningful against a MockVerifier deployment. Swapping in real verifiers means
// this file's `commitment` import needs to move to a real Pedersen implementation (e.g.
// via bb.js) at the same time positionStore.tsx does — they must never diverge, same
// invariant circuits/latens_common documents for the three Noir circuits.
//
// FOLLOW-UP (not built here): a real standing viewing key would have LatensPool emit an
// ECIES-encrypted (amount, salt) note alongside each commitment update, with a viewing
// keypair derived deterministically from a wallet signature. That gives an auditor
// passive, ongoing access without the user re-exporting after every change — a contract
// change, not just a frontend one, and out of scope for this pass.
import { commitment } from "./positionStore";

export type DisclosureKind = "collateral" | "debt";

export type DisclosureEntry = {
  assetId: number;
  symbol: string;
  kind: DisclosureKind;
  amount: string; // raw base units, decimal string
  salt: string; // decimal string
  commitment: `0x${string}`;
};

export type DisclosurePayload = {
  version: 1;
  chainId: number;
  pool: `0x${string}`;
  address: `0x${string}`;
  issuedAt: string;
  entries: DisclosureEntry[];
};

export type Disclosure = DisclosurePayload & { signature: `0x${string}` };

export function buildDisclosureMessage(d: DisclosurePayload): string {
  const lines = [
    "Latens position disclosure",
    `version:${d.version}`,
    `chainId:${d.chainId}`,
    `pool:${d.pool}`,
    `address:${d.address}`,
    `issuedAt:${d.issuedAt}`,
    ...d.entries.map((e) => `entry:${e.assetId}:${e.kind}:${e.amount}:${e.salt}:${e.commitment}`),
  ];
  return lines.join("\n");
}

export function makeEntry(assetId: number, symbol: string, kind: DisclosureKind, amount: bigint, salt: bigint): DisclosureEntry {
  return {
    assetId,
    symbol,
    kind,
    amount: amount.toString(),
    salt: salt.toString(),
    commitment: commitment(amount, salt),
  };
}

export function recomputeCommitment(entry: DisclosureEntry): `0x${string}` {
  return commitment(BigInt(entry.amount), BigInt(entry.salt));
}
