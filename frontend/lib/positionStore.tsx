"use client";

// Tracks the connected wallet's OWN collateral/debt amounts and salts client-side, in
// localStorage — this is the private half of a Latens position, and by design can never be
// read back from chain (that's the whole point of confidentiality). The pool only ever
// sees a commitment.
//
// The commitment scheme itself is now the REAL one: `commitment()` below calls
// pedersenCommit() (lib/pedersen.ts), which matches circuits/latens_common's `commit()`
// byte-for-byte via bb.js's actual Barretenberg pedersen_hash primitive — verified against
// the real circuit's own Prover.toml fixture, see lib/pedersen.test.ts. That used to be a
// placeholder keccak256(amount, salt), which could never have opened against a real proof.
//
// What's STILL not done: actual zk-SNARK PROOF generation. This module produces a real
// commitment value, but every supply/withdraw/borrow/repay/liquidate call in this frontend
// still submits "0x" as its proof — that's a much larger task (bundling each circuit's
// compiled ACIR, running a witness solver via @noir-lang/noir_js, then Barretenberg's actual
// proving backend, almost certainly in a Web Worker given proving isn't instant). This
// deployment's MockVerifier accepts that "0x" regardless — LatensPool's own binding checks
// only require the commitment you claim to be writing matches what you pass in, which is
// exactly what's now genuinely true instead of merely asserted.
import { createContext, useContext, useMemo, useState } from "react";
import type { Address } from "viem";
import { pedersenCommit } from "./pedersen";
import { latensPool } from "./contracts";

export type AssetPosition = {
  supplied: bigint;
  suppliedSalt: bigint;
  borrowed: bigint;
  borrowedSalt: bigint;
};

type PositionsByAsset = Record<number, AssetPosition>;
type Store = Record<string, PositionsByAsset>; // keyed by lowercase address

const EMPTY: AssetPosition = { supplied: 0n, suppliedSalt: 0n, borrowed: 0n, borrowedSalt: 0n };

// Scoped to the pool's own address, not just "latens.positions.v1" — a redeploy gives every
// contract a new address, so a stale local commitment from a previous deployment simply
// lives under a different, now-unreachable key instead of silently getting reused as this
// deployment's own state. This matters more than it looks: prepare() below computes
// oldCommitment from whatever this store currently holds, and the pool checks that value
// against its own on-chain position — a stale entry from an old deployment doesn't match a
// genuinely fresh on-chain position (collateralCommitment 0), so every action reverts with
// InvalidProof until the mismatch is cleared. Scoping the key means there's no mismatch to
// clear: state from a different pool address was never "this deployment's" to begin with.
const STORAGE_KEY = `latens.positions.v1.${latensPool.address.toLowerCase()}`;

export function randomSalt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(31)); // stay under the BN254 field size
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  return value;
}

export const commitment = pedersenCommit;

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
  shareDelta: bigint;
  patch: Partial<AssetPosition>;
};

export const RAY = 1_000_000_000_000_000_000n;

export function sharesToReal(shares: bigint, indexRay: bigint): bigint {
  return (shares * indexRay) / RAY;
}

// Async now that `commitment` is a real (WASM-backed) Pedersen hash rather than a
// synchronous keccak256 call — every caller of prepare*() below must await it.
async function prepare(current: AssetPosition, field: "supplied" | "borrowed", delta: bigint, direction: "increase" | "decrease", indexRay: bigint): Promise<PreparedUpdate> {
  const saltField = field === "supplied" ? "suppliedSalt" : "borrowedSalt";
  const shares = current[field];
  const salt = current[saltField];
  const shareDelta = (delta * RAY) / indexRay;
  if (direction === "decrease" && shareDelta > shares) {
    throw new Error(field === "supplied" ? "Can't withdraw more than you've supplied." : "Can't repay more than you owe.");
  }
  const oldCommitment = await commitment(shares, salt);
  const newShares = direction === "increase" ? shares + shareDelta : shares - shareDelta;
  const newSalt = randomSalt();
  const newCommitment = await commitment(newShares, newSalt);
  return { oldCommitment, newCommitment, shareDelta, patch: { [field]: newShares, [saltField]: newSalt } };
}

const PositionStoreContext = createContext<{
  get: (address: Address | undefined, assetId: number) => AssetPosition;
  prepareSupply: (address: Address, assetId: number, delta: bigint, indexRay: bigint) => Promise<PreparedUpdate>;
  prepareWithdraw: (address: Address, assetId: number, delta: bigint, indexRay: bigint) => Promise<PreparedUpdate>;
  prepareBorrow: (address: Address, assetId: number, delta: bigint) => Promise<PreparedUpdate>;
  prepareRepay: (address: Address, assetId: number, delta: bigint) => Promise<PreparedUpdate>;
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
      prepareSupply(address: Address, assetId: number, delta: bigint, indexRay: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "supplied", delta, "increase", indexRay);
      },
      prepareWithdraw(address: Address, assetId: number, delta: bigint, indexRay: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "supplied", delta, "decrease", indexRay);
      },
      prepareBorrow(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "borrowed", delta, "increase", RAY);
      },
      prepareRepay(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "borrowed", delta, "decrease", RAY);
      }, // each returns prepare(...)'s Promise directly — no need to mark these `async` too
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
