---
title: Proof system
---

# Proof system

Every state-changing call into the protocol is gated by at least one of three zero-knowledge
proofs. In each case the contract itself computes or fetches every value the proof is
checked against (old and new commitments, deltas, asset IDs, live oracle prices) and binds
them before calling the verifier, so a valid proof produced for one call can never be
replayed against another.

## The three proofs

| Proof | Interface | Used by | Statement |
|---|---|---|---|
| Commitment update | `ICommitmentVerifier.verifyCommitmentUpdate` | Every deposit, withdrawal, borrow, and repayment | "I know the opening of the old commitment, and the new commitment correctly adds or subtracts the public delta." |
| Solvency | `ISolvencyVerifier.verifySolvency` | Borrow, withdraw | "This position's collateral and debt, at current public prices, satisfy the LTV threshold", without revealing either amount. |
| Liquidation eligibility | `ILiquidationVerifier.verifyLiquidationEligibility` | Liquidate | "This position is below the liquidation threshold, and here are the post-liquidation commitments." The hardest of the three to state and prove. |

Each interface's public-input layout matches its circuit in `circuits/` field for field.

## Verifier contracts

`MockVerifier` is the development and testnet stand-in: it accepts any proof unless deployed
in `strict` mode. It must never be deployed anywhere but local development and testnets used
for exactly that purpose. There is no on-chain guard preventing a misconfigured mainnet
deployment from using it, so that gate belongs to the deploy process and any milestone
acceptance review, not the contract itself.

The real path is a set of machine-generated Solidity verifiers, one per proof, produced by
Aztec's Barretenberg toolchain from the compiled Noir circuits (`bb write_solidity_verifier`).
A thin adapter per proof (`NoirSolvencyVerifier`, `NoirCommitmentVerifier`,
`NoirLiquidationVerifier`) implements Latens's own verifier interfaces and does the
`uint256[]` → `bytes32[]` conversion the generated contracts expect, nothing else.

All three real verifiers compile, are deployed in the test suite, and have been driven
end to end: a real `LatensPool.borrow()` call gated by a genuine solvency proof, a real
`LatensPool.liquidate()` call gated by a genuine liquidation proof, and a real
`LatensCDP.supplyCollateral()` call gated by a genuine commitment-update proof, each also
confirmed to correctly reject a tampered public input, so the pass is not vacuous. See
[Status and limits](./status) for why the public testnet deployment still runs on the mock
despite that.

## Gas cost

Real proof verification measured empirically on Sepolia:

| Verifier | Gas |
|---|---|
| `CommitmentHonkVerifier.verify()` | ≈ 3,657,714 |
| `SolvencyHonkVerifier.verify()` | ≈ 3,661,232 |
| `LiquidationHonkVerifier.verify()` | ≈ 3,669,619 |

That is roughly 20–40x the cost of the mock verifier. It is a known, deliberate trade
against Circom's cheaper Groth16 verification gas. See [The circuits](./circuits) for why
Noir was chosen anyway.
