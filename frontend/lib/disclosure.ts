// Selective-disclosure export/verify — a one-time signed snapshot the position owner
// explicitly hands over, naming exactly what's disclosed at the moment of export. This
// stays useful even now that a standing alternative exists (lib/viewingKey.ts,
// lib/viewingKeyContext.tsx, LatensPool.publishViewingNote): it needs no on-chain action, no
// opt-in ahead of time, and no fixed viewing keypair the owner has to manage — you sign once,
// right now, for exactly this recipient. The standing viewing key trades that one-shot
// simplicity for passive, ongoing access without re-exporting after every future change; see
// lib/viewingKey.ts's own header for that design.
//
// Reuses positionStore's `commitment`, which is the real Pedersen scheme from
// circuits/latens_common (see lib/pedersen.ts) — so `makeEntry`/`recomputeCommitment` here
// and positionStore.tsx's own commitments can never diverge, same invariant
// circuits/latens_common documents for why the three Noir circuits share one `commit` impl.
// Being async now (a real hash call, not a synchronous placeholder) is why both functions
// below return Promises.
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
