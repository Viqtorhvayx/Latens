---
title: Contracts
---

# Contracts

## Core

| Contract | Role |
|---|---|
| `LatensPool` | Entry point for `supplyCollateral`, `withdrawCollateral`, `borrow`, `repay`, and `liquidate`. Binds every value a proof is checked against before calling a verifier. |
| `AssetRegistry` | Public market configuration, per-asset aggregates, and the kinked interest rate model. Owner-governed. |
| `LatensCDP` | Confidential stablecoin minting. Locks committed collateral and mints `LatensDollar` against it. |
| `LatensDollar` | The protocol's own stablecoin. Minted and burned only by `LatensCDP`. |
| `ProtocolTreasury` | Collects the reserve-factor slice of interest and routes it to ZEN staking and the supply-rewards programme. |
| `SupplyRewards` | Epoch-based supplier incentives, topped up from real protocol revenue on every treasury sweep rather than only a fixed initial grant. |

## Interfaces

`ICommitmentVerifier`, `ISolvencyVerifier`, and `ILiquidationVerifier` define the three proof
checks described in [Proof system](./proofs). `IPriceOracle` and `IZenStakingPool` define the
external dependencies `LatensPool` and `ProtocolTreasury` rely on.

## Verifiers

`MockVerifier` is the development stand-in. `NoirSolvencyVerifier`,
`NoirCommitmentVerifier`, and `NoirLiquidationVerifier` are thin adapters over the real,
machine-generated Barretenberg verifiers in `verifiers/generated/`. See
[The circuits](./circuits) for how those are produced.

## Position model

Positions are single-collateral, single-debt-asset, and isolated per user. Cross-margin,
multi-asset positions would require the circuits to aggregate over many assets in a single
proof, which is materially harder and out of scope for this milestone.

## Libraries

`DataTypes` and `Errors` hold the protocol's shared structs and custom errors respectively,
kept small and dependency-free so every other contract can import them without pulling in
unrelated logic.
