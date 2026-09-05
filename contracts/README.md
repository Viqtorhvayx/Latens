# Latens contracts

Confidential borrow-lend protocol scaffold for Horizen (Season 2 Builder Ecosystem Fund,
RFP: "Private Borrow-Lend Protocol"). This is the pool's state machine and access-control
surface — not a finished, audited protocol. Read "Status" before assuming anything here is
production-ready.

## Layout

```
contracts/
  core/
    LatensPool.sol        entrypoint: supplyCollateral, withdrawCollateral, borrow, repay, liquidate
    AssetRegistry.sol      public market config + aggregates (owner-governed)
    ProtocolTreasury.sol   reserve-factor collection -> ZEN staking pool contribution
  interfaces/
    ICommitmentVerifier.sol   confidential balance-update proof
    ISolvencyVerifier.sol     health-factor-above-threshold proof (borrow/withdraw)
    ILiquidationVerifier.sol  insolvency proof (liquidation)
    IPriceOracle.sol
    IZenStakingPool.sol
  verifiers/
    MockVerifier.sol       dev/test stand-in — accepts any proof unless `strict` mode is set
  mocks/                  test-only ERC20 / oracle / staking pool, not part of the protocol
  libraries/
    DataTypes.sol, Errors.sol
```

## What's confidential, and what isn't

- **Private:** a position's resting collateral and debt amounts. They're never stored or
  read in the clear — only as commitments, opened and reasoned about exclusively inside
  zk-SNARK circuits.
- **Public, on purpose:** per-market aggregates (`AssetRegistry.totalSupplied` /
  `totalBorrowed`), oracle prices, and — critically — the ERC20 transfer amounts that fund
  each deposit/borrow/repay. A lending market needs public liquidity and price data to
  function; Latens's privacy guarantee is scoped to *who holds how much*, not to the market
  as a whole.
- **Public only at liquidation:** `seizedCollateralAmount` and `repayAmount` become public
  the moment a position is liquidated (see `ILiquidationVerifier`'s dev note). Keeping that
  private too is open design space, not something claimed here.

## Status

- The pool's accounting, access control, pausability, and proof-binding logic are written
  and tested (`npx hardhat test`) against `MockVerifier`, which accepts any proof — **there
  is no real zero-knowledge circuit yet.** The M1 milestone is building it (commitment
  scheme, the three circuits below, and their on-chain verifying-key contracts) and swapping
  it in via `LatensPool.setVerifiers`.
- There is **no interest-rate/accrual model.** `repay`'s reserve-factor cut is a placeholder
  for real interest-based revenue, wired end-to-end (down to `ProtocolTreasury`'s
  contribution to the ZEN staking pool) so the money-flow shape is testable before accrual
  exists.
- Positions are **single-collateral, single-debt-asset, isolated per user** — cross-margin,
  multi-asset positions would require the circuits to aggregate over many assets in one
  proof, which is materially harder and out of scope for this milestone.
- `MockVerifier` must never be deployed anywhere but local development and testnets used for
  exactly that purpose. There is no on-chain guard preventing a misconfigured mainnet
  deployment from using it — that gate belongs in the deploy process and the Foundation's
  milestone-acceptance review, not in the contract itself.

## The three proofs

| Proof | Used by | Statement |
|---|---|---|
| `ICommitmentVerifier.verifyCommitmentUpdate` | every deposit/withdraw/borrow/repay | "I know the opening of the old commitment, and the new commitment correctly adds/subtracts the public delta." |
| `ISolvencyVerifier.verifySolvency` | borrow, withdraw | "This position's collateral and debt, at current public prices, satisfy the LTV threshold" — without revealing either amount. |
| `ILiquidationVerifier.verifyLiquidationEligibility` | liquidate | "This position is *below* the liquidation threshold, and here are the post-liquidation commitments" — the hardest of the three; see its NatSpec. |

Every public-input layout documented in these interfaces is illustrative pending the actual
circuit design — the contract enforces that whatever layout is used, LatensPool itself
computed or fetched every value the proof is checked against (old/new commitments, deltas,
asset IDs, live oracle prices), so a valid proof from one call can never be replayed against
another.

## Running it

```
npm install
npx hardhat compile
npx hardhat test
```

Compilation currently requires `viaIR: true` (set in `hardhat.config.js`) — `LatensPool`'s
named-argument internal calls otherwise hit Solidity's stack-too-deep limit.
