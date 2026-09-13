---
title: Status and limits
---

# Status and limits

This is a working protocol scaffold, not a finished product, and the distinction is worth
stating plainly rather than leaving a reader to infer it.

## What's real

- **The live testnet deployment verifies real proofs.** The machine-generated Honk verifiers
  are deployed on Horizen testnet and wired into `LatensPool` and `LatensCDP` via
  `setVerifiers()` — `MockVerifier` no longer gates anything there. A full
  supply → borrow → repay → withdraw cycle has been driven against the live pool with a
  fresh wallet and genuine proofs, verified on-chain.
- **Proofs are generated client-side, in the browser.** `frontend/lib/proving/` runs real
  UltraHonk proving in a Web Worker (`@noir-lang/noir_js` for witness generation,
  `@aztec/bb.js` for proving), wired into every user-facing action. Its output was
  cross-checked against the deployed Solidity verifiers for all three circuits — byte-for-byte
  compatible, not merely self-consistent.
- **All three circuits exist** and are proven working against real proofs, including a real
  `LatensPool.borrow()` gated by a genuine solvency proof and a real `LatensPool.liquidate()`
  gated by a genuine liquidation proof, each also confirmed to reject a tampered public
  input. See [The circuits](./circuits) and [Proof system](./proofs).
- **The pool's accounting, access control, pausability, and proof-binding logic** are
  covered by a full test suite.
- **Interest is real and utilization-driven**, and **supplier yield genuinely compounds**
  through a per-asset index rather than a placeholder number. See
  [Interest, yield & minting](./economics).
- **Every deployed contract is source-verified** on the block explorer for its network,
  see [Deployment](./deployment) for the current set of addresses.

## What isn't finished yet

- **No independent security audit has been done.** A security self-review exists in the
  repository (`contracts/SECURITY_REVIEW.md`). It is a genuine review, written by the same
  author as the code, and is explicitly not a substitute for an independent one.
- **Nothing is on mainnet.** Everything above is testnet. Real deposits, real users, and the
  operational lessons that only come from those are still ahead.
- **The mock verifier must never reach mainnet.** There is no on-chain guard preventing a
  misconfigured deployment from using it; that gate belongs to the deploy process and to
  milestone-acceptance review, not to the contract itself.
- **Circuit soundness has not been independently audited.** The empirical language checks
  described in [The circuits](./circuits) are real, but narrow: they rule out specific,
  identified failure modes, not every possible one. A circuit audit is a different
  discipline from a Solidity review, and neither has been performed independently.
- **Cross-margin, multi-asset positions are out of scope for this milestone.** Positions are
  single-collateral, single-debt-asset, and isolated per user. Supplying a second asset into
  a position that already holds one is rejected on-chain, and the interface disables the
  action rather than letting it fail in a wallet.
- **The testnet price feed is a mock that needs a heartbeat.** Both contracts reject any
  solvency-gated call whose price is more than an hour old. A production oracle updates
  itself; `MockPriceOracle` only advances when something calls it, so a deployment left
  alone for an hour starts rejecting borrow, withdraw-against-debt, mint and liquidate with
  `StaleOraclePrice`, while supply, repay and burn keep working. The interface re-stamps the
  feed itself before each affected action, and `script/refreshPrices.js` does the same from
  the command line. The re-stamp is permissionless and cannot change what a price says, only
  how recently it was checked.
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
