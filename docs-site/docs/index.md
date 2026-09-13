---
id: index
slug: /
title: Introduction
sidebar_label: Introduction
---

# Introduction

Latens is a confidential borrow-lend protocol for Horizen, the EVM-native L3 settling on
Base that Latens is built and deployed on. Collateral and debt amounts are never written or
read in the clear: they exist on-chain only as cryptographic commitments, and every action
that would normally require reading a balance (depositing, borrowing, repaying, minting,
liquidating) is instead gated by a zero-knowledge proof that answers a narrow yes-or-no
question without revealing the numbers behind it.

This section explains what that means in practice, what is and isn't hidden, and how the
pieces fit together. It is written for anyone evaluating the protocol: users, auditors,
integrators, and grant reviewers alike.

:::warning[Testnet build]
Latens runs on Horizen testnet today, not mainnet, and has not undergone an independent
security audit — don't put real value behind it yet. Every proof it verifies is real: the
live deployment checks them through the machine-generated zero-knowledge verifiers, not a
mock. See [Status and limits](./status) for the full picture of what is and isn't done.
:::

## Why confidentiality matters here

A conventional lending market publishes every position. Anyone can read how much collateral
an address holds, how much it has borrowed, and therefore exactly how far it sits from
liquidation. That transparency is useful to liquidators, but it is corrosive to everyone
else: a public collateral ratio is a standing invitation for MEV bots to watch for the exact
block where a position crosses its threshold, and it turns any institution's balance sheet
into information a competitor should never have had.

Latens keeps position sizes private by default while keeping the protocol itself fully
auditable: solvency is provable on-chain at all times, even though no individual position
is ever disclosed without its owner's consent.

## What Latens does

The protocol supports three actions, all gated by the same confidential machinery:

- **Lend**: supply an asset to a market and earn a real, compounding yield funded by
  borrower interest.
- **Borrow**: draw a loan against deposited collateral, sized against a proven (not
  disclosed) health factor.
- **Mint**: lock collateral and mint LatensDollar, the protocol's own confidential
  stablecoin, through a dedicated CDP contract.

Continue to [Privacy model](./privacy-model) for exactly what is private, what is public on
purpose, and why.
