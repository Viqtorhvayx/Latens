---
title: Interest, yield & minting
---

# Interest, yield, and minting

## Interest is utilization-driven

`AssetRegistry` holds a kinked interest rate model per listed asset. `LatensPool.repay`
charges a genuine, time-weighted fee computed over the exact elapsed time since the
position's debt was last touched, not a flat placeholder.

## The fee is settled against collateral, not the borrowed asset

A borrower repays exactly the principal they drew. The interest owed on it is converted at
oracle prices into the collateral asset and deducted from the position's collateral
commitment instead of being pulled as a second helping of the borrowed token.

This is a deliberate correction rather than a stylistic choice. Charging the fee in the
borrowed asset made a loan impossible to close: someone who draws 20 ZEN holds exactly
20 ZEN, and clearing the debt then cost 20 ZEN plus a fee they had no way to fund short of
acquiring more of the asset they had just borrowed. Because debt sizes are confidential,
there is also no way to quietly grow the debt commitment by the fee instead. Collateral is
the one balance a borrower is guaranteed to have already posted.

The conversion depends on two oracle prices and the supply index, all of which move between
a caller reading them and the transaction being mined, so the pool takes the collateral
burn as a floor rather than an equality: a caller may burn more collateral than the fee
strictly requires, never less.

## Suppliers earn a real, compounding yield

Position commitments encode **shares of a per-asset index**
(`AssetRegistry.currentSupplyIndexRay`, RAY-scaled), not raw token units. The index is
driven by `supplyRateRay`, held at 1e18 rather than in basis points because a supply rate is
a borrow rate scaled down twice, by utilization and again by the reserve factor, and a young
market's lands well under a basis point where integer rounding would erase it entirely.

Only the reserve-factor slice of a repayment's interest moves on to `ProtocolTreasury`; the
rest stays in the pool.

:::warning[Known gap: fee denomination versus index denomination]
Because fees now arrive in the collateral asset while each market's index is driven by that
market's own rate model, a borrowed market's index grows whether or not that market received
the fee. A supplier's claim on the borrowed asset therefore grows without that particular
borrower's fee funding it. Closing this needs either a swap of the fee into the borrowed
asset at repay time or an index driven by realized fees rather than a rate model; on the
current testnet deployment the seeded liquidity absorbs the difference.
`test/LatensPool.yield.test.js` pins the behaviour so it cannot be mistaken for fixed.
:::

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
