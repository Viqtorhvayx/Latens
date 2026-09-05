// Selective-disclosure export/verify — the "viewing key" feature, M1 scope.
//
// This is the "disclosure export" design, not the full Zcash-style standing viewing key:
// the position owner explicitly signs and hands over a snapshot naming exactly what's
// disclosed, rather than an auditor holding a key that can decrypt an on-chain ciphertext
// stream on their own schedule. That's a real, smaller feature — see the follow-up note
// below for what upgrading to a standing key would require.
//
// Reuses positionStore's `commitment`, which is the real Pedersen scheme from
// circuits/latens_common (see lib/pedersen.ts) — so `makeEntry`/`recomputeCommitment` here
// and positionStore.tsx's own commitments can never diverge, same invariant
// circuits/latens_common documents for why the three Noir circuits share one `commit` impl.
// Being async now (a real hash call, not a synchronous placeholder) is why both functions
// below return Promises.
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

export async function makeEntry(assetId: number, symbol: string, kind: DisclosureKind, amount: bigint, salt: bigint): Promise<DisclosureEntry> {
  return {
    assetId,
    symbol,
    kind,
    amount: amount.toString(),
    salt: salt.toString(),
    commitment: await commitment(amount, salt),
  };
}

export function recomputeCommitment(entry: DisclosureEntry): Promise<`0x${string}`> {
  return commitment(BigInt(entry.amount), BigInt(entry.salt));
}
