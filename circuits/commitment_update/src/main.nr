// Latens — commitment_update circuit
//
// Backs `ICommitmentVerifier` in the Latens contracts. Every deposit / withdraw / borrow /
// repay call proves, without revealing any amount:
//   "I know the opening (amount, salt) of `old_commitment` (or this is a brand-new
//    position, signalled by `old_commitment == 0`), I know a fresh `new_salt`, and
//    `new_commitment` correctly commits to `old_amount + delta` (deposit/borrow) or
//    `old_amount - delta` (withdraw/repay)."
//
// `delta` and `is_increase` are PUBLIC because the ERC20 transfer that moves `delta` is
// itself public on an EVM chain — see the threat-model note in LatensPool.sol. What stays
// private is the resulting position size.
//
// This is the ONLY circuit that ever produces a new commitment; `solvency` and
// `liquidation_eligibility` only open commitments this circuit already wrote, using the
// identical `commit` function from `latens_common` — see that package for why sharing it
// matters.
use latens_common::{commit, is_empty_or_matches};

fn main(
    // Private: the position's current opening, and the freshly chosen salt for the new one.
    old_amount: u128,
    old_salt: Field,
    new_salt: Field,
    // Public: see `ICommitmentVerifier.sol` for the exact array layout LatensPool expects.
    old_commitment: pub Field,
    new_commitment: pub Field,
    delta: pub u128,
    is_increase: pub bool,
    asset_id: pub Field,
) {
    // asset_id isn't part of the hash preimage — LatensPool already scopes each position's
    // commitment to one market in contract storage. It's a public input purely so the
    // contract can bind this proof to the specific call it was generated for.
    let _ = asset_id;

    assert(is_empty_or_matches(old_commitment, old_amount, old_salt));

    // Verified empirically (see circuits/README.md): Noir only enforces the checked-
    // arithmetic constraint of the branch that's actually selected at proving time, so this
    // does not spuriously fail on the unselected branch, and a genuine underflow on the
    // selected branch (withdrawing/repaying more than the position holds) correctly fails.
    let new_amount = if is_increase { old_amount + delta } else { old_amount - delta };

    assert(new_commitment == commit(new_amount, new_salt));
}

#[test]
fn accepts_a_correct_deposit() {
    let old_commitment = 0; // fresh position
    let new_salt = 42;
    let new_commitment = commit(100, new_salt);
    main(0, 0, new_salt, old_commitment, new_commitment, 100, true, 7);
}

#[test]
fn accepts_a_correct_withdrawal() {
    let old_salt = 11;
    let old_commitment = commit(100, old_salt);
    let new_salt = 12;
    let new_commitment = commit(60, new_salt);
    main(100, old_salt, new_salt, old_commitment, new_commitment, 40, false, 7);
}

#[test(should_fail)]
fn rejects_a_withdrawal_that_overdraws() {
    let old_salt = 11;
    let old_commitment = commit(100, old_salt);
    let new_salt = 12;
    let new_commitment = commit(0, new_salt);
    // Claiming to withdraw 150 against a balance of 100 — the subtraction must underflow.
    main(100, old_salt, new_salt, old_commitment, new_commitment, 150, false, 7);
}

#[test(should_fail)]
fn rejects_a_new_commitment_that_doesnt_match_the_claimed_delta() {
    let old_salt = 11;
    let old_commitment = commit(100, old_salt);
    let new_salt = 12;
    let wrong_new_commitment = commit(999, new_salt); // doesn't equal 100 + 40
    main(100, old_salt, new_salt, old_commitment, wrong_new_commitment, 40, true, 7);
}

#[test(should_fail)]
fn rejects_the_wrong_opening_of_the_old_commitment() {
    let real_old_salt = 11;
    let old_commitment = commit(100, real_old_salt);
    let new_salt = 12;
    let new_commitment = commit(140, new_salt);
    // Prover doesn't actually know the real opening — guesses a different (amount, salt).
    main(100, 999, new_salt, old_commitment, new_commitment, 40, true, 7);
}
