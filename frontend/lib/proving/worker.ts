// Real zk-SNARK proving, in a Web Worker. Generating an UltraHonk proof takes a few hundred
// milliseconds to low seconds (confirmed empirically: ~0.7s for the solvency circuit) and
// both witness generation and proving run Barretenberg's actual WASM — running that on the
// main thread would freeze the UI for the duration. This file only ever runs inside a
// worker context; see client.ts for the main-thread side of the protocol.
import { Noir } from "@noir-lang/noir_js";
import type { CompiledCircuit } from "@noir-lang/types";
import { Barretenberg, UltraHonkBackend } from "@aztec/bb.js";
import { CIRCUIT_PATH, type CircuitName } from "./circuits";

// tsconfig's `lib` is "dom", not "webworker" (the two can't coexist in one project, and this
// is the only file that needs worker-scope typing) — `self` under "dom" resolves to
// `Window`, whose `postMessage` has a different signature than a worker's. This is the
// narrow slice of DedicatedWorkerGlobalScope this file actually uses.
declare const self: {
  onmessage: ((event: MessageEvent<ProveRequest>) => void) | null;
  postMessage(message: ProveResponse): void;
};

type ProveRequest = {
  id: number;
  type: "prove";
  circuit: CircuitName;
  inputs: Record<string, string | boolean>;
};

type ProveResponse =
  | { id: number; type: "result"; proof: string; publicInputs: string[] }
  | { id: number; type: "error"; message: string };

// Both the compiled circuit JSON (one fetch per circuit, ~100KB) and the Barretenberg WASM
// instance (the expensive part — a multi-megabyte module) are memoized for the worker's
// whole lifetime: the worker itself is created once and reused across every proof a session
// generates, so paying either cost more than once per circuit would be pure waste.
const circuitCache = new Map<CircuitName, Promise<CompiledCircuit>>();
let bbApiPromise: Promise<Barretenberg> | null = null;

function loadCircuit(name: CircuitName): Promise<CompiledCircuit> {
  let cached = circuitCache.get(name);
  if (!cached) {
    cached = fetch(CIRCUIT_PATH[name]).then((r) => {
      if (!r.ok) throw new Error(`Failed to load circuit ${name}: HTTP ${r.status}`);
      return r.json();
    });
    circuitCache.set(name, cached);
  }
  return cached;
}

function getBbApi(): Promise<Barretenberg> {
  if (!bbApiPromise) bbApiPromise = Barretenberg.new();
  return bbApiPromise;
}

// `Buffer` is a Node global, not a Web API — unavailable in a real browser Web Worker, only
// working here by accident if it ever did (Next.js dev tooling sometimes polyfills it). This
// is the browser-portable equivalent for turning the proof's raw bytes into calldata hex.
function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

async function prove(circuitName: CircuitName, inputs: Record<string, string | boolean>): Promise<{ proof: string; publicInputs: string[] }> {
  const circuit = await loadCircuit(circuitName);
  const noir = new Noir(circuit);
  const { witness } = await noir.execute(inputs);

  const bbApi = await getBbApi();
  const backend = new UltraHonkBackend(circuit.bytecode, bbApi);
  // "evm": Keccak-based Fiat-Shamir transcript, ZK-enabled — the exact flavor
  // `bb prove -t evm` produces and the deployed generated Solidity verifiers expect. Any
  // other verifierTarget produces a proof that is internally consistent but rejected by
  // those verifiers (a different transcript hash), so this is not a stylistic choice.
  const proofData = await backend.generateProof(witness, { verifierTarget: "evm" });

  return {
    proof: `0x${bytesToHex(proofData.proof)}`,
    publicInputs: proofData.publicInputs,
  };
}

self.onmessage = async (event: MessageEvent<ProveRequest>) => {
  const { id, circuit, inputs } = event.data;
  try {
    const { proof, publicInputs } = await prove(circuit, inputs);
    self.postMessage({ id, type: "result", proof, publicInputs });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    self.postMessage({ id, type: "error", message });
  }
};
