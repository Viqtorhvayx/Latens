"use client";

import { useCallback, useSyncExternalStore } from "react";
import { latensPool } from "./contracts";

// Supplying to lend and depositing collateral to borrow are the SAME on-chain call here:
// both are `supplyCollateral`, and the resulting balance is one balance that simultaneously
// earns Supply APY and backs any loan drawn against it. The protocol has no field for which
// one you meant, and inventing an on-chain flag would be inventing a distinction the money
// does not have.
//
// What genuinely differs is intent, and intent is worth showing: someone who came through
// Supply is a lender who may or may not ever borrow, while someone who came through the
// Borrow flow's collateral step is a borrower who deposited only to draw against it. That is
// a fact about how the position was opened, so it is recorded here, next to the commitment
// data rather than inside it — this file is presentational, and nothing that signs a
// transaction reads it.
export type PositionRole = "lender" | "borrower";

const STORAGE_KEY = `latens.roles.v1.${latensPool.address.toLowerCase()}`;

type RoleMap = Record<string, PositionRole>; // `${address}:${assetId}` -> role

function load(): RoleMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as RoleMap) : {};
  } catch {
    return {};
  }
}

function keyFor(address: string, assetId: number): string {
  return `${address.toLowerCase()}:${assetId}`;
}

export function getPositionRole(address: string | undefined, assetId: number | undefined): PositionRole | undefined {
  if (!address || assetId === undefined) return undefined;
  return load()[keyFor(address, assetId)];
}

// First writer wins. A borrower who later tops up through Supply is still a borrower, and a
// lender who later borrows against what they lent is still a lender — the role describes how
// the position was opened, not the last thing done to it.
export function recordPositionRole(address: string, assetId: number, role: PositionRole): void {
  if (typeof window === "undefined") return;
  try {
    const roles = load();
    const key = keyFor(address, assetId);
    if (roles[key]) return;
    roles[key] = role;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(roles));
  } catch {
    // A browser refusing localStorage costs a label, nothing more.
  }
}

// Read through useSyncExternalStore rather than an effect: localStorage is exactly the kind
// of external store it exists for, and it supplies a separate server snapshot so the
// prerendered markup (which has no localStorage) cannot disagree with the browser's first
// paint. An effect-plus-setState would have to render twice to say the same thing.
export function usePositionRole(address: string | undefined, assetId: number | undefined): PositionRole | undefined {
  const subscribe = useCallback((onChange: () => void) => {
    if (typeof window === "undefined") return () => {};
    // Fires for writes from other tabs. A write in this tab is followed by a re-render
    // anyway, and getSnapshot runs on every render, so that case needs no event.
    window.addEventListener("storage", onChange);
    return () => window.removeEventListener("storage", onChange);
  }, []);

  const getSnapshot = useCallback(() => getPositionRole(address, assetId), [address, assetId]);

  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
