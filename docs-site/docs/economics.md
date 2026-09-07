---
title: Interest, yield & minting
---

# Interest, yield, and minting

## Interest is utilization-driven

`AssetRegistry` holds a kinked interest rate model per listed asset. `LatensPool.repay`
charges a genuine, time-weighted fee on top of the repaid amount, computed over the exact
elapsed time since the position's debt was last touched, not a flat placeholder.

## Suppliers earn a real, compounding yield

Position commitments encode **shares of a per-asset index**
(`AssetRegistry.currentSupplyIndexRay`, RAY-scaled), not raw token units. Only the
reserve-factor slice of a repayment's interest fee moves on to `ProtocolTreasury`; the rest
stays in the pool and backs the index's growth, so a later withdrawal of the same shares
returns more real tokens than were originally deposited.

The solvency and liquidation-eligibility circuits value a position at `amount * index / RAY`
before pricing it. The index is applied to the *amount* first, deliberately, rather than
folded into the price. See each circuit's own documentation for why.

The debt side of a position, and everything about `LatensCDP`, is **not** index-scaled.
Both circuits accept a `debtIndexRay` input generically, but every caller today passes `RAY`
(a no-op), matching the flat-fee interest `LatensPool.repay` already charged before
index-scaling existed on the supply side.

## Confidential stablecoin minting

`LatensCDP` reuses the same commitment-and-solvency-proof discipline as `LatensPool`: lock
Pedersen-committed collateral, mint `LatensDollar` against it, and pay a one-time origination
fee. That fee is the entire revenue mechanism on the minting path: per-position minted
amounts cannot be distributed proportionally without revealing them, for the same reason
individual borrow amounts cannot be on the lending side.

`LatensCDP` shares `AssetRegistry`'s listed collateral assets and their LTV and liquidation
parameters, but keeps its own aggregates. `AssetRegistry.recordSupply` and `recordBorrow` are
gated to the single `pool` address, which `LatensPool` already occupies, so `LatensCDP`
tracks its own state rather than contending for that same slot.

## Supplier rewards funding

`SupplyRewards` pays a flat, per-epoch reward to any address with an active supply position
that checks in during that epoch. Funding is not a one-time grant that only ever counts
down: `ProtocolTreasury` routes a configurable share of swept interest revenue into
`SupplyRewards.fund()` on every sweep (15% by default, capped at 30%), so the rewards
programme's runway scales with real usage instead of a fixed initial balance.
