---
title: Viewing keys
---

# Viewing keys

A viewing key is a standing alternative to exporting a fresh disclosure file after every
position change, built on the same idea as a
[Zcash viewing key](https://z.cash/learn/what-are-viewing-keys/).

## How it works

Turning a viewing key on does not change anything `LatensPool` or `LatensCDP` verifies or
requires. It is purely additional information published alongside the usual commitment
update. From that point forward, every supply, withdrawal, borrow, and repayment also
publishes a self-encrypted note on-chain describing the change in the clear, but encrypted
under a key only the position owner controls.

Handing the corresponding private key to an auditor gives them passive, ongoing access to
every note from then on. They reconstruct the position's full history directly from
on-chain events, with no fresh export needed from the owner each time a position changes.

## Handling the private key

The private key is generated deterministically from a wallet signature, so it can always be
recovered by signing again, so there is nothing separate to back up. Treat a shared viewing
private key like a bank statement, not a password: whoever holds it can read every disclosed
note, but they cannot move funds or affect the position in any way. Read access and spend
access are entirely separate in this design.

## Disclosure files, for comparison

A disclosure file is the one-time counterpart: a snapshot signed by the position owner's
wallet at export time, useful when a single point-in-time attestation is enough and a
standing key would be more access than the recipient needs. Anyone holding a disclosure file
can check it against live on-chain state on the app's Verify page, which tests the file
rather than trusting the numbers written inside it.
