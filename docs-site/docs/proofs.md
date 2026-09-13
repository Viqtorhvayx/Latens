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
confirmed to correctly reject a tampered public input, so the pass is not vacuous.

**The public Horizen testnet deployment now runs on these real verifiers, not the mock.**
`script/deployRealVerifiersTestnet.js` deployed all three and called `setVerifiers()` on the
live `LatensPool` and `LatensCDP` without redeploying either — existing positions and
commitments were untouched. A full supply → borrow → repay → withdraw cycle was then driven
against the live deployment with a fresh wallet and genuinely client-side-generated proofs
(the exact `@noir-lang/noir_js` + `@aztec/bb.js` pipeline `frontend/lib/proving/` runs in the
browser, not a local devnet or a CLI-generated fixture), and verified on-chain. See
[Status and limits](./status) for the current state of that switch.

## Where proofs are generated

Every proof is generated **client-side, in the user's browser**, inside a Web Worker
(`frontend/lib/proving/worker.ts`) — witness generation via `@noir-lang/noir_js`, proving via
`@aztec/bb.js`'s `UltraHonkBackend`. Nothing about a position's hidden amounts ever leaves
the browser in the process; the worker exists specifically so this real WASM cryptography
(a few hundred milliseconds to low seconds per action) doesn't block the UI thread. Latens
does not use a remote proving service, a co-processor, or a trusted third party of any kind
to generate or verify a proof — verification happens entirely on-chain, in the Solidity
verifiers above.

**On zkVerify:** Latens was evaluated against zkVerify's off-chain proof-aggregation model as
a possible gas-cost optimization, but it is not part of the current design. Direct on-chain
verification was chosen first because it needed no additional trust assumption and no
dependency on a destination-chain attestation contract being deployed on Horizen (which was
unconfirmed at evaluation time). Revisiting zkVerify as a cost layer *on top of* — not instead
of — the already-working direct verifier path remains a legitimate future optimization, not
something currently implemented or claimed.

## Gas cost

Two different measurements exist, for two different things — worth keeping distinct rather
than averaging together:

**Isolated `.verify()` call, measured on Sepolia** (calling just the verifier contract, no
surrounding pool logic):

| Verifier | Gas |
|---|---|
| `CommitmentHonkVerifier.verify()` | ≈ 3,657,714 |
| `SolvencyHonkVerifier.verify()` | ≈ 3,661,232 |
| `LiquidationHonkVerifier.verify()` | ≈ 3,669,619 |

**Full end-to-end pool transaction, measured on live Horizen testnet** (proof verification
plus every other cost in the call — state writes, ERC-20 transfers, index accrual):

| Call | Proofs verified | Total gas |
|---|---|---|
| `supplyCollateral` | 1 (commitment update) | 2,605,569 |
| `borrow` | 2 (commitment update + solvency) | 5,168,999 |
| `repay` | 2 (commitment update, debt + collateral) | 5,084,180 |
| `withdrawCollateral` | 1 (commitment update) | 2,594,213 |

That's roughly 20–40x the cost of the mock verifier per proof — a known, deliberate trade
against Circom's cheaper Groth16 verification gas. See [The circuits](./circuits) for why
Noir was chosen anyway, and the zkVerify note above for the honest state of cost-optimization
work on top of this baseline.
