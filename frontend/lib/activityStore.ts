// A local, client-side-only record of the connected wallet's own supply/withdraw/borrow/
// repay history — timestamps, amounts, and tx hashes, keyed by address in localStorage.
//
// This used to be reconstructed by scanning LatensPool's CollateralUpdated/DebtUpdated
// events for `args.amount`. That was a real privacy leak: those events are public and
// indexed by `user`, so anyone — not just the position's owner — could sum a single
// address's own event history and recover its exact running total, without ever touching
// the Pedersen commitment in storage. The contract no longer emits `amount` on those events
// (see LatensPool.sol's THREAT MODEL note), so the amount side of "recent activity" now has
// to come from somewhere that was never public in the first place: the same client-side
// record positionStore already keeps of the plaintext amount/salt behind each commitment.
//
// Consequence worth being explicit about: this history is LOCAL to the browser that made
// each transaction, same as positionStore's amounts and salts. It doesn't survive a cleared
// profile or follow the user to a new device, and nothing here is meant to change that —
// ExportDisclosureModal/ImportBackupModal already exist for deliberately moving that kind
// of private state around; this file doesn't attempt to duplicate them.
import type { Address } from "viem";

export type ActivityEntry = {
  kind: "collateral" | "debt";
  isIncrease: boolean;
  assetId: number;
  amount: bigint;
  timestamp: number;
  transactionHash: `0x${string}`;
};

type SerializedEntry = Omit<ActivityEntry, "amount"> & { amount: string };
type Store = Record<string, SerializedEntry[]>; // keyed by lowercase address, newest first

const STORAGE_KEY = "latens.activity.v1";
const MAX_ENTRIES_PER_ADDRESS = 100;

function load(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function save(store: Store) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

/** Call once a transaction has actually confirmed — never speculatively before submission. */
export function appendActivity(address: Address, entry: Omit<ActivityEntry, "timestamp">) {
  const store = load();
  const key = address.toLowerCase();
  const serialized: SerializedEntry = { ...entry, amount: entry.amount.toString(), timestamp: Date.now() };
  const existing = store[key] ?? [];
  store[key] = [serialized, ...existing].slice(0, MAX_ENTRIES_PER_ADDRESS);
  save(store);
}

export function getActivity(address: Address): ActivityEntry[] {
  const store = load();
  const entries = store[address.toLowerCase()] ?? [];
  return entries.map((e) => ({ ...e, amount: BigInt(e.amount) }));
}

export function activityLabel(entry: Pick<ActivityEntry, "kind" | "isIncrease">): string {
  if (entry.kind === "collateral") return entry.isIncrease ? "Supplied" : "Withdrew";
  return entry.isIncrease ? "Borrowed" : "Repaid";
}
