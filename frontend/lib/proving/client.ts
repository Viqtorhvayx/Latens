"use client";

// Main-thread side of real proof generation. Every actual proving call — witness
// generation, then an UltraHonk proof — runs inside worker.ts, in a Web Worker, so the
// several-hundred-millisecond-to-low-seconds cost doesn't freeze the page (see worker.ts's
// own header for the measured cost). This file only ever runs on the main thread: it starts
// the worker lazily (nothing about proving loads until the first actual proof is needed),
// and turns its message-passing protocol into an ordinary awaitable function per circuit.
import {
  type CircuitName,
  type CommitmentUpdateInputs,
  type SolvencyInputs,
  type LiquidationEligibilityInputs,
  type ProofResult,
  commitmentUpdateInputMap,
  solvencyInputMap,
  liquidationEligibilityInputMap,
} from "./circuits";

type PendingEntry = { resolve: (r: ProofResult) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingEntry>();

function getWorker(): Worker {
  if (worker) return worker;
  // `new URL(..., import.meta.url)` is the pattern both webpack and Turbopack recognize to
  // bundle a file as a separate worker chunk rather than inlining it into the main bundle —
  // see Next.js's own Turbopack docs on `new Worker()` handling. `type: "module"` matters:
  // noir_js and bb.js are ESM, and a classic (non-module) worker can't `import` them.
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = (event: MessageEvent<{ id: number; type: "result" | "error"; proof?: string; publicInputs?: string[]; message?: string }>) => {
    const { id, type } = event.data;
    const entry = pending.get(id);
    if (!entry) return; // a stale/duplicate message for a request we've already settled
    pending.delete(id);
    if (type === "result") {
      entry.resolve({ proof: event.data.proof as `0x${string}`, publicInputs: (event.data.publicInputs ?? []).map((h) => BigInt(h)) });
    } else {
      entry.reject(new Error(event.data.message ?? "Proving failed"));
    }
  };
  w.onerror = (event: ErrorEvent) => {
    // A worker-level error (e.g. the module failed to load at all) has no request id to key
    // off — it would otherwise strand every in-flight call waiting forever. Reject all of
    // them and let the next call spin up a fresh worker rather than reuse a dead one.
    const err = new Error(event.message || "The proving worker crashed");
    for (const entry of pending.values()) entry.reject(err);
    pending.clear();
    worker = null;
  };
  worker = w;
  return w;
}

function request(circuit: CircuitName, inputs: Record<string, string | boolean>): Promise<ProofResult> {
  const id = nextId++;
  const w = getWorker();
  return new Promise<ProofResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type: "prove", circuit, inputs });
  });
}

// One real proof per call, matching each circuit's own on-chain interface
// (I{Commitment,Solvency,LiquidationEligibility}Verifier.sol) — see circuits.ts for the
// exact input-map field mapping every call site has to get right.
export function proveCommitmentUpdate(inputs: CommitmentUpdateInputs): Promise<ProofResult> {
  return request("commitment_update", commitmentUpdateInputMap(inputs));
}

export function proveSolvency(inputs: SolvencyInputs): Promise<ProofResult> {
  return request("solvency", solvencyInputMap(inputs));
}

export function proveLiquidationEligibility(inputs: LiquidationEligibilityInputs): Promise<ProofResult> {
  return request("liquidation_eligibility", liquidationEligibilityInputMap(inputs));
}
