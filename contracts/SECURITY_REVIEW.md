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

## Recommendation

Treat this document as a description of what one more pair of eyes looked for and found —
not a certification. The project's own "what's left to do" list already names a real,
independent third-party audit as a separate, unstarted item; nothing here changes that.
