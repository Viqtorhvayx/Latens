---
title: Privacy model
---

# Privacy model

Confidentiality is not a feature Latens adds on top of a conventional lending protocol — it
is the reason the protocol exists. Every collateral and debt amount is hidden from
everyone but its owner, enforced not by access control or by trusting an operator, but by
zero-knowledge proof: the chain never holds a number it could leak, only a cryptographic
commitment and a proof that the arithmetic on the hidden value underneath was done correctly.

That guarantee is scoped precisely: it covers **who holds how much**, not the market as a
whole. Being exact about that boundary matters more than claiming everything is hidden, so
this page states each side of it explicitly, then covers how the guarantee is actually
enforced end to end.

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

## How the guarantee is actually enforced

A privacy claim is only as strong as what stands behind it. Latens's stands on three things,
each checkable independently rather than taken on trust:

**Real proofs, generated where the private data lives.** Every proof is produced client-side,
in the position owner's own browser — witness generation and UltraHonk proving run in a Web
Worker, using the position's actual hidden amounts and salts, which never leave that browser.
There is no server that sees a plaintext balance in order to prove something about it. See
[Proof system](./proofs) for the exact pipeline.

**Real on-chain verification, not a placeholder.** The proof a user submits is checked by a
machine-generated Solidity verifier compiled directly from the Noir circuit — not approved by
an operator, not rubber-stamped by a mock. `MockVerifier` exists only for local development
and must never gate a production deployment; the live Horizen testnet deployment verifies
through the real verifiers today, and that switch is itself something anyone can confirm
on-chain by reading `LatensPool.commitmentVerifier()`.

**Binding that can't be replayed or substituted.** Every proof is checked against values the
contract itself computes or reads at call time — old and new commitments, deltas, live
oracle prices, the live supply index — before the verifier is ever called, so a valid proof
generated for one action can never be reused for a different one, a different asset, or a
different position. Swapping which verifier contracts are trusted is gated to the protocol
owner specifically because a malicious verifier could forge exactly this guarantee; that
makes it as security-critical as upgrading the pool's logic itself.

## Audit status

An internal security self-review exists (`contracts/SECURITY_REVIEW.md`, in the repository)
and documents, plainly, what was checked, what was found and fixed, and what was explicitly
out of scope for that pass. It is written by the same people who wrote the code and is
**not** a substitute for an independent audit — an independent review of both the Solidity
contracts and the Noir circuits' cryptographic soundness (a genuinely different discipline
from a Solidity review) is a funded milestone on the roadmap, not yet complete.
