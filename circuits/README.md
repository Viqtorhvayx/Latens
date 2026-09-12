# Latens circuits

Noir implementations of the three zk-SNARK proofs behind Latens's confidential lending —
see `contracts/README.md` for how these plug into `LatensPool`. Written and verified against
a real, installed toolchain (`nargo 1.0.0-beta.26` + `bb 6.0.0-nightly.20260905` — see
"Toolchain" below), not from memory.

## Layout

```
circuits/
  latens_common/            shared library — the ONE `commit()` function every circuit uses
  commitment_update/        backs ICommitmentVerifier — every deposit/withdraw/borrow/repay
  solvency/                 backs ISolvencyVerifier — checked at borrow and withdraw
  liquidation_eligibility/  backs ILiquidationVerifier — checked at liquidate
```

`latens_common` exists because `commitment_update` is the only circuit that ever WRITES a
position's commitment, while `solvency` and `liquidation_eligibility` only ever OPEN
commitments it already wrote. If the `commit()` function ever diverged between circuits —
even by a different domain separator — every downstream proof would silently stop verifying
against real on-chain state. All three binary packages depend on it via a local path
dependency, so there is exactly one implementation, not three copies that could drift.

Run everything with:
```
cd circuits/<package> && nargo test
```

## Why Noir (briefly)

Chosen over Circom mainly for its type system and range-checked arithmetic, which removes a
lot of the manual bookkeeping where Circom's classic "under-constrained circuit" bugs creep
in — worth the trade against Circom's cheaper Groth16 verification gas and deeper audit
precedent for a first pass at this design. See the chat history for the full comparison.

## Things verified empirically, not assumed

Building financial circuits on assumed-but-unverified language semantics is exactly how
subtle soundness bugs happen. Before writing the real circuits, three specific behaviors of
this Noir version were checked with throwaway test circuits:

1. **`u128` arithmetic is checked.** `a - b` where `b > a`, and `a * b` where the product
   exceeds `u128::MAX`, both fail proving rather than silently wrapping. This is why the
   circuits use `u128` for amounts and prices instead of raw `Field` — the type itself
   enforces "you can't withdraw more than you have" and "this multiplication didn't
   overflow," with no hand-written range check needed.
2. **`Field as u128` is a truncating cast, not a checked one.** A wrapped/out-of-range
   `Field` value silently casts to whatever its low 128 bits are, with NO failure. An earlier
   draft of `commitment_update` computed the balance update in `Field` (to sidestep u128's
   checked arithmetic) and cast the result back to `u128` at the end — that draft was
   **unsound**: a withdrawal larger than the balance would wrap to a huge `Field` value whose
   low 128 bits could be made to look like a valid new balance. This is exactly the kind of
   bug that would have looked like working code. The shipped circuits never do this — they
   stay in `u128` for the whole computation instead.
3. **`if/else` only enforces the constraints of the branch actually taken**, even when the
   condition is a genuine runtime witness (not a compile-time literal) — confirmed with
   `nargo execute` against real ACIR, not just `nargo test`. This matters because
   `commitment_update`'s `if is_increase { old + delta } else { old - delta }` would be
   unusable if Noir constrained *both* branches unconditionally: every deposit would
   spuriously fail whenever `old_amount < delta`, since the unselected subtraction branch
   would underflow. It doesn't — verified by executing the circuit with `is_increase = true`
   and `old_amount < delta`, which succeeds, and separately with `is_increase = false` and
   the same values, which correctly fails.

## The real prove/verify pipeline (run once, end to end)

This was actually run against `circuits/solvency`, not just described:

```
nargo compile
nargo execute                                              # -> target/solvency.gz (witness)
bb write_vk -t evm -b target/solvency.json -o target/      # -> target/vk (1888 bytes)
bb prove -t evm -b target/solvency.json -w target/solvency.gz -o target/
                                                             # -> target/proof, target/public_inputs
bb verify -t evm -k target/vk -p target/proof -i target/public_inputs
                                                             # -> "Proof verified successfully"
bb write_solidity_verifier -k target/vk -o target/Verifier.sol
                                                             # -> a real ~2500-line Solidity verifier
```

Toolchain: `nargo 1.0.0-beta.26` (installed via `noirup`) paired with
`bb 6.0.0-nightly.20260905` (installed via `bbup -v 6.0.0-nightly.20260905` — the bundled
`bb-versions.json` compatibility map hadn't caught up to this nargo version at the time of
writing, so this pairing was found by using the newest available `bb` nightly rather than the
mapped one). If `bbup` fails to resolve a version automatically, pin both tools explicitly
rather than trusting "latest."

## Two gaps that were open, and how they closed

An earlier pass through this pipeline left two concrete integration gaps open rather than
guessing at security-critical calldata. Both are now closed, with real proofs verified
on-chain (Hardhat's local EVM) as evidence — see `contracts/README.md` for where the
resulting verifier contracts and adapters live.

**1. The generated verifier's `NUMBER_OF_PUBLIC_INPUTS` (15 for `solvency`) is NOT the
length of the `publicInputs` calldata argument.** Reading `BaseZKHonkVerifier.verify`
directly (in the generated Solidity, and cross-checked against Aztec's own
`barretenberg/sol` test harness in the `aztec-packages` repo) shows:
```solidity
require(publicInputs.length == vk.publicInputsSize - PAIRING_POINTS_SIZE, ...);
```
`PAIRING_POINTS_SIZE` is a fixed constant (**8**) — a BN254 pairing/aggregation object
embedded INSIDE the proof bytes themselves, extracted internally by the verifier
(`ZKTranscriptLib.loadProof`), never supplied by the caller. So `publicInputs` is exactly
each circuit's own declared public inputs (7 for `solvency`, 5 for `commitment_update`, 12
for `liquidation_eligibility`), and `proof` is bb's complete, unmodified proof blob — `bb
prove -o <dir>`'s own file split (`public_inputs` = N elements, `proof` = the rest) was
already exactly correct all along; no reconstruction or re-splitting needed. Confirmed by
deploying each real generated verifier and calling `.verify()` with a real proof — see
`test/SolvencyHonkVerifier.integration.test.js`,
`test/CommitmentHonkVerifier.integration.test.js`, and
`test/LiquidationHonkVerifier.integration.test.js` (each also confirms a tampered public
input is correctly rejected, so this isn't a vacuous pass).

**2. The generated Solidity now compiles**, using the exact settings Aztec's own
`barretenberg/sol/foundry.toml` uses for this same generated code: **solc 0.8.30, `evmVersion:
"cancun"`, `optimizer runs: 1`, no `viaIR`** — found by cloning `aztec-packages` and reading
its own build config, not by guessing. This project's other contracts still need `viaIR` at
0.8.24 for unrelated stack-depth reasons, so `hardhat.config.js` uses a per-file `overrides`
entry for each generated verifier and its adapter, letting both configurations coexist. Base
supports Cancun, so this is deployable there as-is.

## Where the real verifiers live now

`contracts/verifiers/generated/{Solvency,Commitment,Liquidation}HonkVerifier.sol` are the
machine-generated verifiers (regenerate with the commands above; each file's header
documents the exact command and what was hand-edited — only the bottom-level contract name,
so the three can coexist in one compilation). `contracts/verifiers/Noir{Solvency,Commitment,
Liquidation}Verifier.sol` are thin adapters implementing Latens's own `I*Verifier`
interfaces, doing the `uint256[]` → `bytes32[]` conversion and nothing else. `LatensPool`
itself is still deployed with `MockVerifier` by default in `script/deploy.js` (simplest path
for local development), but `test/LatensPool.realVerifier.integration.test.js` drives a real
`LatensPool.borrow()` call through `NoirSolvencyVerifier` end to end — proving the whole
stack fits together, not just each piece in isolation.

## Client-side proving is real, end to end

`frontend/lib/proving/` generates actual UltraHonk proofs in the browser — not a mock, not a
server round-trip. A Web Worker (`worker.ts`) loads the compiled circuit JSON (copied to
`frontend/public/circuits/*.json`), runs witness generation via `@noir-lang/noir_js`, and
proves via `@aztec/bb.js`'s `UltraHonkBackend` with `verifierTarget: "evm"` — the exact
Keccak-transcript, ZK-enabled flavor the generated Solidity verifiers above expect. All four
frontend call sites that previously submitted `"0x"` mock proofs (`BorrowCollateralStep.tsx`,
`PositionActionModal.tsx`, `CDPActionModal.tsx`, `liquidate/page.tsx`) now call into this
worker and submit genuine proofs.

This was cross-checked, not just assumed to work: proofs generated by this exact
noir_js + bb.js pipeline for all three circuits (`commitment_update`, `solvency`,
`liquidation_eligibility`) were verified against the real, deployed, machine-generated
Solidity verifiers in temporary Hardhat tests (the same pattern as
`test/SolvencyHonkVerifier.integration.test.js`, run against JS-produced rather than
CLI-produced proofs) — confirming the browser pipeline's output is byte-for-byte compatible
with what the on-chain verifiers accept, not just internally self-consistent.

`script/deployRealVerifiersTestnet.js` deploys the three real Honk verifiers + adapters to
Horizen testnet and calls `setVerifiers()` on the already-live `LatensPool`/`LatensCDP`,
switching the live deployment off `MockVerifier` without redeploying either pool (existing
positions and commitments are untouched). Run it with an owner key:

```
DEPLOYER_PRIVATE_KEY=<owner key> npx hardhat run script/deployRealVerifiersTestnet.js --network horizenTestnet
```

This has been run against the live Horizen testnet deployment — both `LatensPool` and
`LatensCDP` now verify through the real Honk verifiers, not `MockVerifier`.

## Confirmed live: a full real-proof cycle on Horizen testnet

`frontend/scripts/genLiveE2EProofs.mjs` (Phase A) + `script/liveE2ETestnet.js` (Phase B)
together drove a complete supply → borrow → repay → withdraw cycle through the live
`LatensPool` on Horizen testnet, using a brand-new wallet and real UltraHonk proofs generated
by the exact noir_js + bb.js pipeline the browser runs — not a local Hardhat network, the
actual deployed contracts, submitted as real transactions and checked against real
post-transaction on-chain state. All four steps succeeded, twice: supply with a fresh-deposit
commitment_update proof, borrow gated by a real solvency proof (verified against real oracle
prices and the live supply index), a full repay that closed the debt and paid its interest fee
out of collateral shares via a second commitment_update proof, and a partial withdrawal
requiring no solvency proof once debt-free (the `OutstandingDebt` gate makes that branch dead,
as documented in `LatensPool.withdrawCollateral`). This is the end-to-end confirmation that
client-side proving and the live verifier switch actually work together for a real user flow,
not just in isolation.

Regenerate and re-run with:
```
cd frontend && node scripts/genLiveE2EProofs.mjs && cd ..
DEPLOYER_PRIVATE_KEY=<owner key> npx hardhat run script/liveE2ETestnet.js --network horizenTestnet
```
