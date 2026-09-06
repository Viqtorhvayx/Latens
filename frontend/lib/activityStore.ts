// A local, client-side-only record of the connected wallet's own supply/withdraw/borrow/
// repay history — timestamps, amounts, and tx hashes, keyed by address in localStorage.
// Amounts never touch a public event (see LatensPool.sol's THREAT MODEL note), so this is
// the only place "recent activity" can read them from. Like positionStore's amounts and
// salts, this history is local to the browser that made each transaction — it doesn't
// follow the user to a new device; ExportDisclosureModal/ImportBackupModal cover that.
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
