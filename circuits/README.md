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

## Two concrete, unresolved gaps — read before wiring these into the contracts

**1. The generated verifier expects 13 public inputs; the circuit declares 5.**
`circuits/solvency` has 5 `pub` parameters (matching `ISolvencyVerifier.sol`'s documented
layout), and `bb prove`'s own `public_inputs` output file is exactly 5 field elements
(160 bytes). But the generated `Verifier.sol`'s `NUMBER_OF_PUBLIC_INPUTS` constant is **13**.
The extra 8 are believed to be Barretenberg's own ZK-Honk masking/blinding values (from its
zero-knowledge Sumcheck), appended into the same calldata array by convention — not
application data, and not something this scaffold has derived the exact construction of.
Calling the generated verifier correctly needs either Barretenberg's own reference
integration (`bb.js`'s TypeScript verifier helpers) run once against a real proof to observe
the true calldata shape, or a close reading of UltraHonk's ZK-variant source. Guessing at the
layout of security-critical verifier calldata would be worse than leaving this open.

**2. The generated Solidity verifier does not currently compile in this project's Hardhat
setup.** `bb write_solidity_verifier` output for `circuits/solvency` fails Solidity's Yul
optimizer with `YulException: Variable ... is 1 too deep in the stack` and a
"No memoryguard was present" warning, reproducible with both `viaIR: true` and plain
compilation, and unaffected by optimizer `runs`. This is not a config mistake on this
project's side — Aztec's own documentation describes Barretenberg's Solidity verifier
generation as work-in-progress and explicitly warns to expect breaking changes and rough
edges. Because of this, no generated verifier or adapter contract is committed under
`contracts/` yet — it would break `npx hardhat compile` for everyone. Regenerate locally with
the commands above to see the real, current state of this gap; `circuits/*/target/` is
gitignored precisely because it's build output, not because it's hidden.

**Net effect:** `LatensPool` is still wired to `MockVerifier` (see `contracts/README.md`).
These two gaps — the public-input layout and the compile failure — are exactly what M1 needs
to close before a real verifier can be swapped in via `LatensPool.setVerifiers`.
