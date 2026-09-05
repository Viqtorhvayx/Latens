"use client";

// Caches the current wallet's derived viewing keypair for the rest of this browser session,
// so publishing a note on every supply/withdraw/borrow/repay doesn't prompt a fresh signature
// each time — deriveViewingKeyPair() is deterministic, so re-signing the same fixed message
// always reproduces the identical keypair anyway; this cache only saves the user repeating
// that signature prompt. The keypair itself is never persisted to localStorage: like the
// rest of this app's local position state, it's gone on refresh, and cheaply re-derivable
// with one more signature. Only the `enabled` on/off preference is persisted (see below) —
// a plain boolean has nothing to hide.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { deriveViewingKeyPair, VIEWING_KEY_MESSAGE, type ViewingKeyPair } from "./viewingKey";

const ENABLED_STORAGE_KEY = "latens.viewingKeyEnabled";

const ViewingKeyContext = createContext<{
  keyPair: ViewingKeyPair | null;
  ensure: () => Promise<ViewingKeyPair>;
  // Whether future supply/withdraw/borrow/repay actions should also publish a viewing note.
  // Off by default and only ever turned on from the Viewing Key page — a plain boolean, safe
  // to persist locally (unlike the keypair itself, it reveals nothing about the position).
  enabled: boolean;
  setEnabled: (value: boolean) => void;
} | null>(null);

export function ViewingKeyProvider({ children }: { children: React.ReactNode }) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [keyPair, setKeyPair] = useState<ViewingKeyPair | null>(null);
  // Lazy initializer, not an effect: reads localStorage once on mount without a
  // setState-in-effect cascade (window is undefined during SSR, so this must stay guarded).
  const [enabled, setEnabledState] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(ENABLED_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      window.localStorage.setItem(ENABLED_STORAGE_KEY, String(value));
    } catch {
      // Not persisting the preference just means asking again next session — harmless.
    }
  }, []);
  // Tracks which address the cached keyPair belongs to — a stale keypair from a
  // previously-connected account must never be reused after switching accounts.
  const cachedForAddress = useRef<string | null>(null);
  // Collapses concurrent callers (e.g. two actions confirmed in quick succession) onto the
  // same in-flight signature request instead of prompting the wallet twice.
  const pending = useRef<Promise<ViewingKeyPair> | null>(null);

  const ensure = useCallback(async (): Promise<ViewingKeyPair> => {
    if (!address) throw new Error("Connect a wallet first.");
    if (keyPair && cachedForAddress.current === address.toLowerCase()) return keyPair;
    if (pending.current) return pending.current;

    const promise = (async () => {
      const signature = await signMessageAsync({ message: VIEWING_KEY_MESSAGE });
      const derived = deriveViewingKeyPair(signature);
      cachedForAddress.current = address.toLowerCase();
      setKeyPair(derived);
      return derived;
    })();
    pending.current = promise;
    try {
      return await promise;
    } finally {
      pending.current = null;
    }
  }, [address, keyPair, signMessageAsync]);

  return <ViewingKeyContext.Provider value={{ keyPair, ensure, enabled, setEnabled }}>{children}</ViewingKeyContext.Provider>;
}

export function useViewingKey() {
  const ctx = useContext(ViewingKeyContext);
  if (!ctx) throw new Error("useViewingKey must be used within ViewingKeyProvider");
  return ctx;
}
