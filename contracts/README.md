# Latens contracts

Confidential borrow-lend protocol scaffold for Horizen (Season 2 Builder Ecosystem Fund,
RFP: "Private Borrow-Lend Protocol"). This is the pool's state machine and access-control
surface — not a finished, audited protocol. Read "Status" before assuming anything here is
production-ready.

## Layout

```
contracts/
  core/
    LatensPool.sol        entrypoint: supplyCollateral, withdrawCollateral, borrow, repay, liquidate
    AssetRegistry.sol      public market config + aggregates + interest rate model (owner-governed)
    ProtocolTreasury.sol   fee collection -> ZEN staking pool contribution
    LatensCDP.sol          confidential stablecoin minting: lock collateral, mint LatensDollar
    LatensDollar.sol       the protocol's own stablecoin — minted/burned only by LatensCDP
  interfaces/
    ICommitmentVerifier.sol   confidential balance-update proof
    ISolvencyVerifier.sol     health-factor-above-threshold proof (borrow/withdraw)
    ILiquidationVerifier.sol  insolvency proof (liquidation)
    IPriceOracle.sol
    IZenStakingPool.sol
  verifiers/
    MockVerifier.sol       dev/test stand-in — accepts any proof unless `strict` mode is set
    NoirSolvencyVerifier.sol      adapter -> generated/SolvencyHonkVerifier.sol (real)
    NoirCommitmentVerifier.sol    adapter -> generated/CommitmentHonkVerifier.sol (real)
    NoirLiquidationVerifier.sol   adapter -> generated/LiquidationHonkVerifier.sol (real)
    generated/              machine-generated Barretenberg verifiers — see file headers
  mocks/                  test-only ERC20 / oracle / staking pool, not part of the protocol
  libraries/
    DataTypes.sol, Errors.sol
```

## What's confidential, and what isn't

- **Private:** a position's resting collateral and debt amounts. They're never stored or
  read in the clear — only as commitments, opened and reasoned about exclusively inside
  zk-SNARK circuits.
- **Public, on purpose:** per-market aggregates (`AssetRegistry.totalSupplied` /
  `totalBorrowed`), oracle prices, and — critically — the ERC20 transfer amounts that fund
  each deposit/borrow/repay. A lending market needs public liquidity and price data to
  function; Latens's privacy guarantee is scoped to *who holds how much*, not to the market
  as a whole.
- **Public only at liquidation:** `seizedCollateralAmount` and `repayAmount` become public
  the moment a position is liquidated (see `ILiquidationVerifier`'s dev note). Keeping that
  private too is open design space, not something claimed here.

## Status

- The pool's accounting, access control, pausability, and proof-binding logic are written
  and tested (`npx hardhat test`) against `MockVerifier`, which accepts any proof.
- **All three circuits exist, and real on-chain verifiers for all three are wired, tested,
  and proven working** — see `../circuits/README.md`. Each `Noir*Verifier.sol` adapter wraps
  a real, machine-generated Barretenberg verifier and has been called with a real proof in
  Hardhat's local EVM (`test/*HonkVerifier.integration.test.js`), including confirming a
  tampered public input is correctly rejected. `test/LatensPool.realVerifier.integration.test.js`
  goes further and drives a real `LatensPool.borrow()` call — collateral deposit, a live
  solvency check, a debt disbursement — through `NoirSolvencyVerifier` end to end, with
  `MockVerifier` only standing in for the other two proof types in that one test.
  `test/LatensPool.liquidate.realVerifier.integration.test.js` does the same for the
  liquidation path: a real `LatensPool.liquidate()` call gated by the REAL
  `LiquidationHonkVerifier`, reaching the fixture's exact pre-liquidation position via
  `MockVerifier`-gated setup calls first (a real solvency proof cannot exist for an
  intentionally-insolvent intermediate state, so the setup has to use the permissive path —
  only the liquidation call itself is real). `test/LatensCDP.realVerifier.integration.test.js`
  proves `LatensCDP` is wired the same way: a real `LatensCDP.supplyCollateral()` call gated
  by the REAL `CommitmentHonkVerifier`. A real-proof MINT test for `LatensCDP` (the
  solvency-gated path) isn't possible against the existing `circuits/solvency` fixture — it
  was generated with `debt_price_e8 = 1`, but `LatensCDP` hardcodes
  `STABLECOIN_PRICE_E8 = 1e8` for LatensDollar's fixed $1 peg, so the fixture's proof can
  never satisfy that binding check; regenerating a matching fixture needs the `nargo`/`bb`
  toolchain, unavailable here. `script/deploy.js` — the testnet/production deployment path —
  wires all three real `Noir*Verifier.sol` adapters (deploying each
  `generated/*HonkVerifier.sol` with its `RelationsLib`/`ZKTranscriptLib` libraries linked)
  into BOTH `LatensPool` and `LatensCDP` by default; set `MOCK_VERIFIERS=1` to fall back to
  the old permissive `MockVerifier` behavior for an environment that genuinely needs it
  (never mainnet) — this has been run against a live local node end to end in both modes,
  not just compiled. `script/deployLocal.js` — what the frontend's local dev loop actually
  runs against — stays on `MockVerifier` for all three, on both contracts, on purpose:
  there's no client-side proof generation yet (see `frontend/lib/positionStore.tsx`), so a
  real verifier there would just make every button in the UI revert. `npm run
  deploy:real-verifiers` (`script/deployRealVerifiers.js`) demonstrates the `LatensPool`
  liquidation path manually as well, independent of the hardhat test above.
- **Interest is real and utilization-driven**, not a placeholder: `AssetRegistry` holds a
  kinked rate model per asset (`setInterestRateModel` / `borrowRateBps` / `supplyRateBps`),
  and `LatensPool.repay` charges a genuine, time-weighted fee on top of the repaid amount via
  `quoteRepayInterestFee`, computed over the exact elapsed time since the position's debt was
  last touched. What this can't do yet: compound onto a position's own hidden principal, or
  pay suppliers a matching pass-through yield — both require the `commitment_update` and
  `solvency` circuits to accept a public index-scaling term (there is no `nargo`/`bb`
  toolchain available to build that here). Until then, collected interest funds
  `ProtocolTreasury` (and its contribution to the ZEN staking pool) rather than individual
  suppliers — see `AssetRegistry.supplyRateBps`'s NatSpec for the full reasoning. TVL and
  Borrow APR shown in the frontend's Markets page are real, live, computed figures built on
  this model, not placeholders.
- **Four collateral/debt assets, chosen to actually be grounded on Horizen:** ZEN (the
  network's native gas/staking token) and ZUSD (Horizen Labs' own natively-issued
  stablecoin) are confirmed native. WBTC and USDC are the two bridged majors Horizen's own
  Archon Bridge documentation names for the EON network — EON itself is mid-migration to a
  new, Base-settling L3 (per Horizen's own June 2025 announcement) whose final bridged-asset
  list isn't published yet, so treat these two as "best available, sourced" rather than
  confirmed on the new L3. DAI was dropped for exactly this reason: it had no sourced
  Horizen-specific grounding, just generic recognizability.
- **Confidential stablecoin minting (`LatensCDP` / `LatensDollar`)** reuses the same
  commitment/solvency-proof discipline as `LatensPool` — lock Pedersen-committed collateral,
  mint `LatensDollar` against it, pay a one-time origination fee (the entire revenue
  mechanism here, since per-position minting amounts aren't distributable proportionally
  either, for the same reason as above). It shares `AssetRegistry`'s listed collateral
  assets and their LTV/liquidation parameters, but keeps its own aggregates —
  `AssetRegistry.recordSupply`/`recordBorrow` are gated to the one `pool` address
  `LatensPool` already occupies.
- Positions are **single-collateral, single-debt-asset, isolated per user** — cross-margin,
  multi-asset positions would require the circuits to aggregate over many assets in one
  proof, which is materially harder and out of scope for this milestone.
- `MockVerifier` must never be deployed anywhere but local development and testnets used for
  exactly that purpose. There is no on-chain guard preventing a misconfigured mainnet
  deployment from using it — that gate belongs in the deploy process and the Foundation's
  milestone-acceptance review, not in the contract itself.
- No independent security audit has been done. `SECURITY_REVIEW.md` in this directory is a
  self-review — real, but explicitly not a substitute for one; read it for exactly what that
  means and what it does and doesn't cover.

## The three proofs

| Proof | Used by | Statement |
|---|---|---|
| `ICommitmentVerifier.verifyCommitmentUpdate` | every deposit/withdraw/borrow/repay | "I know the opening of the old commitment, and the new commitment correctly adds/subtracts the public delta." |
| `ISolvencyVerifier.verifySolvency` | borrow, withdraw | "This position's collateral and debt, at current public prices, satisfy the LTV threshold" — without revealing either amount. |
| `ILiquidationVerifier.verifyLiquidationEligibility` | liquidate | "This position is *below* the liquidation threshold, and here are the post-liquidation commitments" — the hardest of the three; see its NatSpec. |

Each interface's public-input layout now matches its real circuit in `../circuits/` field
for field. Regardless of layout, LatensPool itself computed or fetched every value the proof
is checked against (old/new commitments, deltas, asset IDs, live oracle prices) and binds
them before calling the verifier, so a valid proof from one call can never be replayed
against another.

## Running it

```
npm install
npx hardhat compile
npx hardhat test
```

Compilation currently requires `viaIR: true` (set in `hardhat.config.js`) — `LatensPool`'s
named-argument internal calls otherwise hit Solidity's stack-too-deep limit.
