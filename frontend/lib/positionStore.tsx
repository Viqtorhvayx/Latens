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

function randomSalt(): bigint {
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

const PositionStoreContext = createContext<{
  get: (address: Address | undefined, assetId: number) => AssetPosition;
  applySupply: (address: Address, assetId: number, delta: bigint) => { oldCommitment: `0x${string}`; newCommitment: `0x${string}` };
  applyBorrow: (address: Address, assetId: number, delta: bigint) => { oldCommitment: `0x${string}`; newCommitment: `0x${string}` };
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
      applySupply(address: Address, assetId: number, delta: bigint) {
        const key = address.toLowerCase();
        const current = store[key]?.[assetId] ?? EMPTY;
        const oldCommitment = commitment(current.supplied, current.suppliedSalt);
        const newAmount = current.supplied + delta;
        const newSalt = randomSalt();
        const newCommitment = commitment(newAmount, newSalt);

        const next: Store = {
          ...store,
          [key]: {
            ...store[key],
            [assetId]: { ...current, supplied: newAmount, suppliedSalt: newSalt },
          },
        };
        setStore(next);
        save(next);
        return { oldCommitment, newCommitment };
      },
      applyBorrow(address: Address, assetId: number, delta: bigint) {
        const key = address.toLowerCase();
        const current = store[key]?.[assetId] ?? EMPTY;
        const oldCommitment = commitment(current.borrowed, current.borrowedSalt);
        const newAmount = current.borrowed + delta;
        const newSalt = randomSalt();
        const newCommitment = commitment(newAmount, newSalt);

        const next: Store = {
          ...store,
          [key]: {
            ...store[key],
            [assetId]: { ...current, borrowed: newAmount, borrowedSalt: newSalt },
          },
        };
        setStore(next);
        save(next);
        return { oldCommitment, newCommitment };
      },
    }),
    [store]
  );

  return <PositionStoreContext.Provider value={value}>{children}</PositionStoreContext.Provider>;
}

export function usePositionStore() {
  const ctx = useContext(PositionStoreContext);
  if (!ctx) throw new Error("usePositionStore must be used within PositionStoreProvider");
  return ctx;
}
