// The REAL commitment scheme — matches circuits/latens_common's `commit()` byte-for-byte:
//   pub fn commit(amount: u128, salt: Field) -> Field {
//     std::hash::pedersen_hash_with_separator([amount as Field, salt], COMMITMENT_DOMAIN)
//   }
// with COMMITMENT_DOMAIN = 1. This replaces the placeholder keccak256(amount, salt) that
// positionStore.tsx used to compute — that placeholder was never going to open against a
// real proof, since a real commitment_update/solvency/liquidation_eligibility circuit
// verifies its Pedersen opening, not a keccak256 one. This module doesn't generate proofs
// (that's a separate, much larger undertaking — real proving needs the compiled circuit's
// ACIR bundled per-circuit, a witness solver, and Barretenberg's actual proving backend,
// likely in a Web Worker so it doesn't block the UI thread for the several-hundred-ms to
// low-seconds it takes) — it only makes the VALUE being committed to real, so a disclosure
// file or a future real proof can actually open it.
//
// Verified against circuits/commitment_update's own Prover.toml fixture: commit(100, 42)
// must equal 0x29275e212299c97d20d7976931cffaa92e97d5ba04ec6c06409a7c45c29bbe4a — see
// pedersen.test.ts. That's not a hypothetical check; it's the literal input/output pair the
// real circuit was compiled and proved against.
import { BarretenbergSync } from "@aztec/bb.js";

const COMMITMENT_DOMAIN = 1;

let apiPromise: ReturnType<typeof BarretenbergSync.initSingleton> | null = null;

function getApi() {
  // BarretenbergSync.initSingleton() loads and instantiates Barretenberg's WASM module the
  // first time it's called (a multi-megabyte download+compile) and reuses it after —
  // memoized here so every commit() call after the first one is fast and doesn't re-fetch.
  if (!apiPromise) apiPromise = BarretenbergSync.initSingleton();
  return apiPromise;
}

// Field elements are big-endian 32-byte encodings, matching how Noir/Barretenberg represent
// a BN254 scalar field element — this is NOT the same encoding as viem's own uint256 ABI
// encoding by coincidence, it just happens to also be big-endian 32 bytes; the two are
// compatible representations of the same underlying value.
function toFieldBytes(value: bigint): Uint8Array {
  const buf = new Uint8Array(32);
  let v = value;
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

function fromFieldBytes(bytes: Uint8Array): bigint {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

export async function pedersenCommit(amount: bigint, salt: bigint): Promise<`0x${string}`> {
  if (amount === 0n && salt === 0n) return `0x${"0".repeat(64)}`;
  const api = await getApi();
  const response = api.pedersenHash({ inputs: [toFieldBytes(amount), toFieldBytes(salt)], hashIndex: COMMITMENT_DOMAIN });
  const value = fromFieldBytes(response.hash);
  return `0x${value.toString(16).padStart(64, "0")}`;
}
