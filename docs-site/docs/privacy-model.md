---
title: Privacy model
---

# Privacy model

Latens's privacy guarantee is scoped precisely: it covers **who holds how much**, not the
market as a whole. Being exact about that boundary matters more than claiming everything is
hidden, so this page states each side of it explicitly.

## Private

A position's resting collateral and debt amounts are never stored or read in the clear.
They exist on-chain only as [Pedersen commitments](https://en.wikipedia.org/wiki/Commitment_scheme),
opened exclusively inside a zero-knowledge circuit, which returns a yes-or-no answer about a
property of the position (is it solvent? does this new commitment correctly reflect this
deposit?) without revealing the values it reasoned over.

## Public, on purpose

A lending market cannot function without some public state:

- **Per-market aggregates**: total supplied and total borrowed per asset, tracked by
  `AssetRegistry` and used to compute utilization, supply APY, and borrow APR.
- **Oracle prices**: every listed asset's price feed is public, as it has to be for the
  solvency circuit to check a position against it.
- **Transfer amounts**: the ERC-20 amount moved in a given deposit, withdrawal, borrow, or
  repayment is visible on-chain, because token transfers themselves are public. What stays
  hidden is the position's *resulting* balance, not the individual transaction size.

## Public at liquidation

The seized collateral amount and the repaid debt amount become public the moment a position
is liquidated. The liquidation circuit proves eligibility and computes the post-liquidation
commitments, but the amounts exchanged in that specific transaction are necessarily visible
on-chain. Keeping those private too is open design space that this protocol does not
currently claim to solve.

## Selective disclosure: viewing keys

Confidentiality that cannot be lifted on demand is a real problem for anyone who answers to
an auditor, an accountant, or a regulator. Latens addresses this with **viewing keys**, in
the same spirit as a Zcash viewing key: a position owner can turn one on, and every future
action also publishes a self-encrypted note on-chain alongside the usual commitment update.
Handing the corresponding private key to an auditor once gives them passive, ongoing access
to every note from that point forward, reconstructed directly from on-chain events with no
fresh export required from the owner each time.

A **disclosure file** covers the same need for a one-time snapshot rather than a standing
key: it is signed by the position owner's wallet, and anyone holding it can check it against
live on-chain state on the app's Verify page, which tests the file rather than simply
trusting the numbers written inside it.

The choice of when and to whom to disclose always belongs to the position owner. Hidden by
default; provable the moment they decide it should be.
