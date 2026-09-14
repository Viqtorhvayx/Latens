// Gas limits for the calls that carry zero-knowledge proofs.
//
// These are stated explicitly rather than estimated because borrow, withdraw, repay and mint
// are submitted right after a price-refresh transaction: estimating before that refresh is
// mined prices the call against a stale feed, which reverts with StaleOraclePrice instead of
// returning a usable number.
//
// Sized from real Horizen testnet receipts taken AFTER the pool switched to the
// machine-generated Honk verifiers. Verifying a real proof costs ~2.5M gas where MockVerifier
// cost almost nothing, so the pre-switch receipts are not a guide:
//
//                        MockVerifier      real verifiers
//   supplyCollateral        157,522           2,605,593
//   withdrawCollateral      104,258           2,594,321   (no open debt; see below)
//   borrow                  199,098           5,168,999   (commitment + solvency)
//   repay                   124,752           5,084,276   (debt + collateral-burn commitments)
//
// withdrawCollateral was measured against a fully repaid position, so it ran no solvency
// proof. Withdrawing against an open debt runs a second proof and lands near borrow, which is
// why it takes the two-proof limit rather than the one-proof limit.
//
// The headroom above the measured figures is free: unused gas is refunded, and only the
// portion actually burned is ever paid for. The ceiling that matters is the 30,000,000 block
// gas limit, which both tiers sit well inside.
//
// If the circuits or the verifier are ever regenerated, re-measure before assuming these
// still hold — a limit that silently became too small is exactly how every user-facing
// action broke once already.

/// One commitment proof: supplying collateral.
export const SINGLE_PROOF_CALL_GAS = 4_000_000n;

/// Two proofs: borrow, repay, mint, burn, and any withdrawal against an open debt.
export const DOUBLE_PROOF_CALL_GAS = 8_000_000n;

/// Publishing a viewing note emits an event and verifies nothing.
export const VIEWING_NOTE_GAS = 600_000n;

/// A plain ERC20 approval.
export const APPROVE_GAS = 100_000n;
