"use client";

// Tracks the connected wallet's OWN collateral/debt amounts and salts client-side, in
// localStorage — this is the private half of a Latens position, and by design can never be
// read back from chain (that's the whole point of confidentiality). The pool only ever
// sees a commitment.
//
// IMPORTANT — this dev build's commitment scheme is a placeholder, not the real one: it's
// a plain keccak256(amount, salt), computed here in TypeScript, NOT the Pedersen-hash scheme
// circuits/latens_common actually uses. That's fine for now because this deployment wires
// MockVerifier (see script/deployLocal.js) — LatensPool's own binding checks only require
// the commitment you claim to be writing matches what you pass in, not that it's a real
// zk-valid Pedersen commitment. Swapping in real privacy means replacing this whole module
// with actual client-side proof generation (bb.js, most likely in a Web Worker so proving
// doesn't block the UI thread) — a separate, substantial task, not something this scaffold
// claims to have done.
import { createContext, useContext, useMemo, useState } from "react";
import { encodePacked, keccak256, type Address } from "viem";

export type AssetPosition = {
  supplied: bigint;
  suppliedSalt: bigint;
  borrowed: bigint;
  borrowedSalt: bigint;
};

type PositionsByAsset = Record<number, AssetPosition>;
type Store = Record<string, PositionsByAsset>; // keyed by lowercase address

const EMPTY: AssetPosition = { supplied: 0n, suppliedSalt: 0n, borrowed: 0n, borrowedSalt: 0n };
const STORAGE_KEY = "latens.positions.v1";

export function randomSalt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31)); // stay under the BN254 field size
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}

export function commitment(amount: bigint, salt: bigint): `0x${string}` {
  if (amount === 0n && salt === 0n) return `0x${"0".repeat(64)}`;
  return keccak256(encodePacked(["uint256", "uint256"], [amount, salt]));
}

function load(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const out: Store = {};
    for (const addr of Object.keys(parsed)) {
      out[addr] = {};
      for (const assetId of Object.keys(parsed[addr])) {
        const p = parsed[addr][assetId];
        out[addr][Number(assetId)] = {
          supplied: BigInt(p.supplied),
          suppliedSalt: BigInt(p.suppliedSalt),
          borrowed: BigInt(p.borrowed),
          borrowedSalt: BigInt(p.borrowedSalt),
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

function save(store: Store) {
  const serializable: Record<string, Record<number, Record<string, string>>> = {};
  for (const addr of Object.keys(store)) {
    serializable[addr] = {};
    for (const assetId of Object.keys(store[addr]).map(Number)) {
      const p = store[addr][assetId];
      serializable[addr][assetId] = {
        supplied: p.supplied.toString(),
        suppliedSalt: p.suppliedSalt.toString(),
        borrowed: p.borrowed.toString(),
        borrowedSalt: p.borrowedSalt.toString(),
      };
    }
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

// A prepared update is pure — it computes what the new commitment WOULD be without
// touching the store. The caller must send the on-chain tx first and only call `commit`
// with `patch` once that tx actually succeeds. This matters: applying the local mutation
// eagerly (the earlier design) left localStorage silently ahead of chain state the moment
// any tx reverted — every subsequent action would then also fail, since the "old
// commitment" this module computes would permanently mismatch what LatensPool actually
// has on-chain, with no way to recover short of clearing storage.
export type PreparedUpdate = {
  oldCommitment: `0x${string}`;
  newCommitment: `0x${string}`;
  patch: Partial<AssetPosition>;
};

function prepare(current: AssetPosition, field: "supplied" | "borrowed", delta: bigint, direction: "increase" | "decrease"): PreparedUpdate {
  const saltField = field === "supplied" ? "suppliedSalt" : "borrowedSalt";
  const amount = current[field];
  const salt = current[saltField];
  if (direction === "decrease" && delta > amount) {
    throw new Error(field === "supplied" ? "Can't withdraw more than you've supplied." : "Can't repay more than you owe.");
  }
  const oldCommitment = commitment(amount, salt);
  const newAmount = direction === "increase" ? amount + delta : amount - delta;
  const newSalt = randomSalt();
  const newCommitment = commitment(newAmount, newSalt);
  return { oldCommitment, newCommitment, patch: { [field]: newAmount, [saltField]: newSalt } };
}

const PositionStoreContext = createContext<{
  get: (address: Address | undefined, assetId: number) => AssetPosition;
  prepareSupply: (address: Address, assetId: number, delta: bigint) => PreparedUpdate;
  prepareWithdraw: (address: Address, assetId: number, delta: bigint) => PreparedUpdate;
  prepareBorrow: (address: Address, assetId: number, delta: bigint) => PreparedUpdate;
  prepareRepay: (address: Address, assetId: number, delta: bigint) => PreparedUpdate;
  commit: (address: Address, assetId: number, patch: Partial<AssetPosition>) => void;
} | null>(null);

export function PositionStoreProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer: runs once on mount, reading localStorage client-side only (load()
  // itself guards the server/SSR case). Avoids a synchronous setState-in-effect render.
  const [store, setStore] = useState<Store>(() => load());

  const value = useMemo(
    () => ({
      get(address: Address | undefined, assetId: number): AssetPosition {
        if (!address) return EMPTY;
        return store[address.toLowerCase()]?.[assetId] ?? EMPTY;
      },
      prepareSupply(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "supplied", delta, "increase");
      },
      prepareWithdraw(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "supplied", delta, "decrease");
      },
      prepareBorrow(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "borrowed", delta, "increase");
      },
      prepareRepay(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "borrowed", delta, "decrease");
      },
      commit(address: Address, assetId: number, patch: Partial<AssetPosition>) {
        const key = address.toLowerCase();
        // Functional updater, not a closure over the outer `store`: callers that commit
        // more than once in the same synchronous tick (e.g. ImportBackupModal restoring
        // both a collateral and a debt entry in one loop) would otherwise each compute
        // their update from the same stale snapshot, and the second setStore call would
        // silently discard the first commit instead of building on it.
        setStore((prevStore) => {
          const current = prevStore[key]?.[assetId] ?? EMPTY;
          const next: Store = { ...prevStore, [key]: { ...prevStore[key], [assetId]: { ...current, ...patch } } };
          save(next);
          return next;
        });
      },
    }),
    [store],
  );

  return <PositionStoreContext.Provider value={value}>{children}</PositionStoreContext.Provider>;
}

export function usePositionStore() {
  const ctx = useContext(PositionStoreContext);
  if (!ctx) throw new Error("usePositionStore must be used within PositionStoreProvider");
  return ctx;
}
