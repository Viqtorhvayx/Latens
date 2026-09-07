---
title: The circuits
---

# The circuits

The three proofs described in [Proof system](./proofs) are implemented as
[Noir](https://noir-lang.org/) circuits.

## Why Noir

Noir was chosen over Circom mainly for its type system and range-checked arithmetic, which
removes a substantial amount of the manual bookkeeping where Circom's classic
under-constrained-circuit bugs tend to creep in. That is a deliberate trade against Circom's
cheaper Groth16 verification gas and deeper audit precedent. It is the right call for a first pass
at this design, not a claim that it is free.

## Shared library

`latens_common` holds the single `commit()` function every circuit uses. Only the
commitment-update circuit ever *writes* a position's commitment; solvency and liquidation
eligibility only ever *open* commitments it already wrote. If the commitment function ever
diverged between circuits, even by a different domain separator, every downstream proof
would silently stop verifying against real on-chain state. All three circuits depend on it
via a local path dependency, so there is exactly one implementation, not three copies that
could drift apart.

## Language behavior verified empirically

Building financial circuits on assumed-but-unverified language semantics is exactly how
subtle soundness bugs happen. Three specific behaviors of this Noir version were checked
with throwaway test circuits before the real ones were written:

1. **`u128` arithmetic is checked.** Subtraction that would underflow, and multiplication
   that would overflow `u128::MAX`, both fail proving rather than silently wrapping. This is
   why the circuits compute in `u128` rather than raw `Field`: the type itself enforces "you
   cannot withdraw more than you have" with no hand-written range check needed.
2. **`Field as u128` is a truncating cast, not a checked one.** An out-of-range `Field`
   value silently casts to its low 128 bits with no failure. An earlier draft of the
   commitment-update circuit computed the balance update in `Field` to sidestep `u128`'s
   checked arithmetic, then cast the result back at the end. That draft was **unsound**: a
   withdrawal larger than the balance would wrap to a huge `Field` value whose low 128 bits
   could be made to look like a valid new balance. The shipped circuits never leave `u128`
   for the computation.
3. **`if`/`else` only enforces the constraints of the branch actually taken**, confirmed by
   executing the compiled circuit (`nargo execute`, not just `nargo test`) with a genuine
   runtime witness. This is what makes `commitment_update`'s
   `if is_increase { old + delta } else { old - delta }` usable at all. If Noir constrained
   both branches unconditionally, every deposit would spuriously fail whenever
   `old_amount < delta`, since the unselected subtraction branch would underflow.

## The prove/verify pipeline

Run once, end to end, against a real installed toolchain:

```bash
nargo compile
nargo execute                                              # -> target/circuit.gz (witness)
bb write_vk -t evm -b target/circuit.json -o target/       # -> target/vk
bb prove -t evm -b target/circuit.json -w target/circuit.gz -o target/
                                                             # -> target/proof, target/public_inputs
bb verify -t evm -k target/vk -p target/proof -i target/public_inputs
                                                             # -> "Proof verified successfully"
bb write_solidity_verifier -k target/vk -o target/Verifier.sol
```

Toolchain: `nargo 1.0.0-beta.26` paired with `bb 6.0.0-nightly.20260905`. If `bbup` fails to
resolve a compatible version automatically, pin both tools explicitly rather than trusting
"latest": the bundled compatibility map can lag a fresh `nargo` release.

## Compilation settings

The generated Solidity verifiers require different compiler settings than the rest of the
protocol: **solc 0.8.30, `evmVersion: "cancun"`, optimizer runs 1, no `viaIR`**, the exact
settings Aztec's own `barretenberg/sol` build uses for this generated code, found by reading
that project's own build configuration rather than guessing. The rest of the contracts still
need `viaIR` at solc 0.8.24 for unrelated stack-depth reasons, so the Hardhat config carries
a per-file override for each generated verifier and its adapter, letting both configurations
coexist in one compilation. Base supports Cancun, so this is deployable there as-is.
