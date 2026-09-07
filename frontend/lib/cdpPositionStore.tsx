"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { Address } from "viem";
import { commitment, randomSalt } from "./positionStore";
import { latensCDP } from "./contracts";

export type CDPAssetPosition = {
  collateral: bigint;
  collateralSalt: bigint;
  debt: bigint;
  debtSalt: bigint;
};

type PositionsByAsset = Record<number, CDPAssetPosition>;
type Store = Record<string, PositionsByAsset>;

const EMPTY: CDPAssetPosition = { collateral: 0n, collateralSalt: 0n, debt: 0n, debtSalt: 0n };

// Scoped to the CDP's own address — see positionStore.tsx's STORAGE_KEY comment for why: a
// stale commitment left over from a previous deployment doesn't match a genuinely fresh
// on-chain position, and every call reverts with InvalidProof until that mismatch clears.
const STORAGE_KEY = `latens.cdp.positions.v1.${latensCDP.address.toLowerCase()}`;

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
          collateral: BigInt(p.collateral),
          collateralSalt: BigInt(p.collateralSalt),
          debt: BigInt(p.debt),
          debtSalt: BigInt(p.debtSalt),
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
        collateral: p.collateral.toString(),
        collateralSalt: p.collateralSalt.toString(),
        debt: p.debt.toString(),
        debtSalt: p.debtSalt.toString(),
      };
    }
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable));
}

export type PreparedCDPUpdate = {
  oldCommitment: `0x${string}`;
  newCommitment: `0x${string}`;
  patch: Partial<CDPAssetPosition>;
};

async function prepare(current: CDPAssetPosition, field: "collateral" | "debt", delta: bigint, direction: "increase" | "decrease"): Promise<PreparedCDPUpdate> {
  const saltField = field === "collateral" ? "collateralSalt" : "debtSalt";
  const amount = current[field];
  const salt = current[saltField];
  if (direction === "decrease" && delta > amount) {
    throw new Error(field === "collateral" ? "Can't withdraw more than you've supplied." : "Can't burn more than you owe.");
  }
  const oldCommitment = await commitment(amount, salt);
  const newAmount = direction === "increase" ? amount + delta : amount - delta;
  const newSalt = randomSalt();
  const newCommitment = await commitment(newAmount, newSalt);
  return { oldCommitment, newCommitment, patch: { [field]: newAmount, [saltField]: newSalt } };
}

const CDPPositionStoreContext = createContext<{
  get: (address: Address | undefined, assetId: number) => CDPAssetPosition;
  prepareSupply: (address: Address, assetId: number, delta: bigint) => Promise<PreparedCDPUpdate>;
  prepareWithdraw: (address: Address, assetId: number, delta: bigint) => Promise<PreparedCDPUpdate>;
  prepareMint: (address: Address, assetId: number, delta: bigint) => Promise<PreparedCDPUpdate>;
  prepareBurn: (address: Address, assetId: number, delta: bigint) => Promise<PreparedCDPUpdate>;
  commit: (address: Address, assetId: number, patch: Partial<CDPAssetPosition>) => void;
} | null>(null);

export function CDPPositionStoreProvider({ children }: { children: React.ReactNode }) {
  const [store, setStore] = useState<Store>(() => load());

  const value = useMemo(
    () => ({
      get(address: Address | undefined, assetId: number): CDPAssetPosition {
        if (!address) return EMPTY;
        return store[address.toLowerCase()]?.[assetId] ?? EMPTY;
      },
      prepareSupply(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "collateral", delta, "increase");
      },
      prepareWithdraw(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "collateral", delta, "decrease");
      },
      prepareMint(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "debt", delta, "increase");
      },
      prepareBurn(address: Address, assetId: number, delta: bigint) {
        const current = store[address.toLowerCase()]?.[assetId] ?? EMPTY;
        return prepare(current, "debt", delta, "decrease");
      },
      commit(address: Address, assetId: number, patch: Partial<CDPAssetPosition>) {
        const key = address.toLowerCase();
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

  return <CDPPositionStoreContext.Provider value={value}>{children}</CDPPositionStoreContext.Provider>;
}

export function useCDPPositionStore() {
  const ctx = useContext(CDPPositionStoreContext);
  if (!ctx) throw new Error("useCDPPositionStore must be used within CDPPositionStoreProvider");
  return ctx;
}
