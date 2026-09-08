# Security self-review

**This is a self-review by the same person/agent who wrote the code, not an independent
audit.** It does not substitute for one, and the protocol should not be treated as
audit-ready on the strength of this document alone — see contracts/README.md's own "Status"
section for what's real and what isn't yet. What follows is an honest record of what was
actually checked, what was found, and — just as important — what was explicitly out of
scope for this pass.

## Scope

Read in full: `LatensPool.sol`, `AssetRegistry.sol`, `ProtocolTreasury.sol`,
`NoirSolvencyVerifier.sol` (as a representative sample of the three `Noir*Verifier.sol`
adapters — all three follow an identical pattern and are exercised end-to-end by
`script/deployRealVerifiers.js`), `MockVerifier.sol`, `MockPriceOracle.sol`. Skimmed for
obvious issues: the frontend's handling of pasted disclosure JSON and user input (no
`dangerouslySetInnerHTML`, `eval`, or `innerHTML` anywhere in the codebase — React's default
JSX escaping is doing the real work here, and nothing bypasses it).

Not in scope for this pass, and not claimed to be covered:
- The Noir circuits' own cryptographic soundness beyond what `circuits/README.md` already
  documents and empirically verified (the `u128`/`Field` casting behavior, `if/else`
  constraint scoping). A real circuit audit is a different discipline than a Solidity review.
- Gas optimization, griefing via gas-cost economics, or MEV/frontrunning analysis.
- Formal verification or fuzzing — this was manual code reading, not tooling-assisted.
- The frontend's dependency supply chain (npm packages), CSP/headers, or deployment
  infrastructure once this exists somewhere real (see item 9 in the project's open-items
  list — there is no live deployment to review yet).

## What was found and fixed

**Price staleness check could underflow instead of reverting cleanly
(`LatensPool._requireFreshPrice`).** The check was `block.timestamp - updatedAt >
PRICE_STALENESS_WINDOW`. If an `IPriceOracle` implementation ever reports an `updatedAt`
timestamp ahead of the current block — `MockPriceOracle` can't do this today (it always
stamps `block.timestamp` at write time), but nothing in the `IPriceOracle` interface
prevents a different, real implementation from doing so, whether from clock skew, a bug, or
a compromised oracle adapter — the subtraction underflows. Solidity 0.8's checked arithmetic
turns that into a bare `Panic(0x11)` revert instead of the intended, legible
`StaleOraclePrice()` error. Every price-gated call (`borrow`, `withdrawCollateral`,
`liquidate`) was affected identically.

This was never an exploitable path to stealing funds or bypassing a check — either way, the
call correctly reverts, so the practical severity is low. It's a robustness/defense-in-depth
fix: the contract now degrades cleanly against any future `IPriceOracle` implementation,
not just the one mock it's tested against today. Fixed with one added condition
(`updatedAt > block.timestamp`), verified with a new regression test
(`test/LatensPool.test.js`, "rejects a price oracle reporting a timestamp in the future...")
that was confirmed to fail with the exact predicted `Panic(0x11)` before the fix and pass
after it.

## Things noticed, deliberately not changed

These are real observations, not bugs — flagged here so they're a documented decision
rather than an unstated gap, per the same "state the threat model plainly" standard
`LatensPool`'s own NatSpec already holds itself to.

- **`supplyCollateral`, `withdrawCollateral`, `borrow`, and `repay` all move ERC20 tokens
  before updating `position` state**, which is checks-*interactions*-effects rather than the
  textbook checks-effects-interactions order. In isolation this would be a classic
  reentrancy setup. It isn't exploitable here because every one of these functions (plus
  `liquidate`) carries `nonReentrant`, and OpenZeppelin's guard shares one `_status` slot
  across every `nonReentrant` function on the contract — a reentrant call into any of them,
  from inside a malicious token's `transfer`/`transferFrom` hook, reverts immediately
  regardless of which function it re-enters. Reordering to strict CEI would be a defense-in-
  depth improvement with no behavior change, but isn't a live vulnerability today given the
  guard's contract-wide (not per-function) locking.
- **`AssetRegistry.listAsset`/`updateRiskParams` validate `ltvBps < liquidationThresholdBps`
  and `liquidationThresholdBps <= 10_000`, but not `liquidationBonusBps`.** An owner could
  configure an unreasonably large bonus, letting liquidators seize disproportionate
  collateral. This is gated `onlyOwner`, consistent with the header comment's stated
  Foundation-governance trust model (risk parameters are meant to be admin-controlled) — not
  a permissionless exploit, so left as an owner-trust assumption rather than "fixed."
  Worth a bounds check if the governance model ever becomes less trusted than "the
  Foundation's milestone-acceptance process."
- **Nothing stops a position from using the same asset as both its collateral and its debt.**
  Not obviously exploitable (the pool's own ERC20 balance still bounds how much can be
  borrowed), just an unusual product configuration nobody has evaluated as intentional or
  not. Noted rather than blocked, since blocking it is a product decision, not a security one.
- **`ProtocolTreasury.sweep` is permissionless and accepts an arbitrary `token` address.**
  This is by its own design (any keeper can trigger distribution rather than waiting on an
  admin), and the worst a caller can do is trigger the split/event on a token the treasury
  happens to hold zero or dust of — no funds move that the owner couldn't already move via
  `withdrawRunway`. Not a finding, just confirmed as intentional after reading it.

## Addendum: a real privacy leak, found and fixed

**`CollateralUpdated`/`DebtUpdated` used to emit the plaintext delta `amount` on every
supply/withdraw/borrow/repay.** Both events are indexed by `user`, so this didn't just leak
one transaction's size — it let anyone watching a single address's own event history sum
every increase and decrease and recover its exact current collateral/debt amount, with no
need to touch the Pedersen commitment in `positions` at all. This is exactly the kind of
"resting position state" this contract's own THREAT MODEL comment claims stays private; as
written, that claim didn't hold against the most basic on-chain analysis (summing an
address's own logs is what a block explorer shows by default).

Fixed by dropping `amount` from both events — they now only say a position changed, in
which direction, for which asset; `newCommitment` is all a public observer or a later
disclosure needs. An owner who wants their own delta history back (e.g. this frontend's
"Recent activity" list) now gets it from a client-side-only record
(`frontend/lib/activityStore.ts`) written at the moment their own transaction confirms, the
same trust boundary `positionStore.ts` already draws around a position's plaintext amount
and salt — never read back from a public event. Regression test:
`test/LatensPool.test.js`, "CollateralUpdated/DebtUpdated never carry the delta amount...".

The ERC20 `Transfer` log still exposes the same delta at the token layer, and that part is
unchanged and separately disclosed above — this fix closes the pool's own event, not the
underlying transaction visibility the THREAT MODEL note already names as out of scope for
this scaffold.

## Addendum: share-delta binding is directional, not exact

`LatensPool` binds every public input by equality except one, and the exception is
deliberate. A collateral share delta is derived from `currentSupplyIndexRay`, which advances
every second an asset carries utilization. Binding it by equality asks the caller to name
the index of whichever future block their transaction lands in, which no caller can do: the
index moves while a wallet is being signed, and the call then reverts with `InvalidProof`
however honest it was. This was not theoretical. A real deposit on the testnet deployment
failed exactly this way, submitting a delta derived from an index 92 million ray-units
behind the one the pool computed 29 seconds later. It went unnoticed because an asset nobody
has borrowed against has a completely static index, so deposits into idle markets worked.

`_verifyShareUpdate` and `_verifyShareBurn` therefore bound that one input directionally: a
deposit may claim no more shares than its amount buys at the live index, and a withdrawal
must burn no fewer than its amount costs. Both commitments, the direction flag and the asset
id still bind exactly, so a proof still cannot be replayed onto a different update, a
different asset, or the opposite direction. `_verifySolvency` treats the collateral index the
same way and for the same reason: a caller may only understate it, which understates what
their own collateral is worth and can only make the solvency check stricter on them.

What this gives up: drift between reading the index and mining is absorbed as a dust
rounding rather than a revert, and that rounding always falls against the caller. What it
does not give up is any bound that protects the pool. The direction of each inequality was
chosen on that basis, and `test/FrontendFlows.e2e.test.js` asserts both the accepted and the
rejected side of each.

## Recommendation

Treat this document as a description of what one more pair of eyes looked for and found —
not a certification. The project's own "what's left to do" list already names a real,
independent third-party audit as a separate, unstarted item; nothing here changes that.
