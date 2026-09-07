---
title: Status and limits
---

# Status and limits

This is a working protocol scaffold, not a finished product, and the distinction is worth
stating plainly rather than leaving a reader to infer it.

## What's real

- **The pool's accounting, access control, pausability, and proof-binding logic** are
  written and tested against `MockVerifier`.
- **All three circuits exist**, and real on-chain verifiers for all three are wired,
  tested, and proven working against real proofs. See [The circuits](./circuits) and
  [Proof system](./proofs). This includes a real `LatensPool.borrow()` call gated by a
  genuine solvency proof and a real `LatensPool.liquidate()` call gated by a genuine
  liquidation proof, each also confirmed to reject a tampered public input.
- **Interest is real and utilization-driven**, and **supplier yield genuinely compounds**
  through a per-asset index rather than a placeholder number. See
  [Interest, yield & minting](./economics).
- **Every deployed contract is source-verified** on the block explorer for its network,
  see [Deployment](./deployment) for the current set of addresses.

## What isn't finished yet

- **No independent security audit has been done.** A security self-review exists in the
  repository (`contracts/SECURITY_REVIEW.md`). It is a genuine review, written by the same
  author as the code, and is explicitly not a substitute for an independent one.
- **The publicly deployed testnet instance uses a permissive mock verifier**, not the real
  proof system. The real verifiers exist, compile, are deployed in the test suite, and have
  been driven end to end. But the public deployment stays on the mock because there is no
  client-side proof generation in the frontend yet, so wiring a real verifier there today
  would make every action in the interface revert.
- **The mock verifier must never reach mainnet.** There is no on-chain guard preventing a
  misconfigured deployment from using it; that gate belongs to the deploy process and to
  milestone-acceptance review, not to the contract itself.
- **Circuit soundness has not been independently audited.** The empirical language checks
  described in [The circuits](./circuits) are real, but narrow: they rule out specific,
  identified failure modes, not every possible one. A circuit audit is a different
  discipline from a Solidity review, and neither has been performed independently.
- **Cross-margin, multi-asset positions are out of scope for this milestone.** Positions are
  single-collateral, single-debt-asset, and isolated per user.
- **Liquidation amounts become public.** The seized collateral and repaid debt amounts for a
  liquidated position are visible on-chain at the moment of liquidation. See
  [Privacy model](./privacy-model) for the full boundary of what stays private and what
  doesn't.

## Roadmap

| Milestone | Target | Description |
|---|---|---|
| M1 | Q1 2027 | Core privacy capability: confidential deposit, borrow, and health-factor proofs live on testnet. |
| M2 | Q2 2027 | Independent security audit of the proof system and liquidation logic, before mainnet exposure. |
| M3 | Q3 2027 | Mainnet usage: real deposits and borrows on Horizen, demonstrating product-market fit. |
