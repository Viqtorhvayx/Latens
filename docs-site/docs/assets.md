---
title: Assets
---

# Assets

Four collateral and debt assets are listed, chosen to be genuinely grounded on Horizen
rather than merely recognizable.

| Symbol | Notes |
|---|---|
| ZEN | Horizen's native gas and staking token. Confirmed native to the network. |
| ZUSD | Horizen Labs' own natively-issued stablecoin. Confirmed native to the network. |
| WBTC | A bridged major named in Horizen's Archon Bridge documentation for EON. |
| USDC | A bridged major named in the same documentation for EON. |

## A caveat on the bridged assets

EON is mid-migration to a new, Base-settling L3 per Horizen's own announcement, and that
network's final bridged-asset list is not yet published. Treat WBTC and USDC here as
best-available and sourced rather than confirmed for the destination network. DAI was
considered and dropped for exactly this reason: it had no sourced Horizen-specific
grounding, only generic recognizability, and this project would rather list four sourced
assets than five where one is a guess.

## Listing parameters

Each listed asset carries its own LTV, liquidation threshold, liquidation bonus, and
reserve factor, configured in `AssetRegistry` and shared between `LatensPool` and
`LatensCDP`. See [Contracts](./contracts) for where that configuration lives.
