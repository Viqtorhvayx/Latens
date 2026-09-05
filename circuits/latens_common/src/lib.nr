// Shared commitment scheme for every Latens circuit.
//
// SECURITY-CRITICAL INVARIANT: `commit` must be byte-for-byte identical across
// `commitment_update`, `solvency`, and `liquidation_eligibility`. `commitment_update` is the
// only circuit that ever WRITES a position's commitment on-chain; `solvency` and
// `liquidation_eligibility` only ever OPEN and reason about commitments that
// `commitment_update` already produced. If this function ever diverges between circuits —
// a different domain separator, a different field order — every downstream proof silently
// stops verifying against real on-chain state. That is why this lives in one shared package
// that all three circuits depend on, instead of being copy-pasted three times.
//
// This is a placeholder scheme (Pedersen hash, domain-separated) for the M1 milestone, not
// an audited final commitment design.
global COMMITMENT_DOMAIN: u32 = 1;

pub fn commit(amount: u128, salt: Field) -> Field {
    std::hash::pedersen_hash_with_separator([amount as Field, salt], COMMITMENT_DOMAIN)
}

/// A commitment of 0 is the sentinel for "no position/no debt yet" throughout Latens —
/// every circuit that opens a possibly-absent commitment should use this instead of
/// hardcoding the literal `0`.
pub fn is_empty_or_matches(commitment: Field, amount: u128, salt: Field) -> bool {
    (commitment == 0) | (commitment == commit(amount, salt))
}

#[test]
fn commit_is_deterministic() {
    assert(commit(100, 42) == commit(100, 42));
}

#[test]
fn commit_depends_on_both_amount_and_salt() {
    assert(commit(100, 42) != commit(101, 42));
    assert(commit(100, 42) != commit(100, 43));
}

#[test]
fn is_empty_or_matches_accepts_zero() {
    assert(is_empty_or_matches(0, 999, 999));
}

#[test]
fn is_empty_or_matches_accepts_the_real_opening() {
    let c = commit(100, 42);
    assert(is_empty_or_matches(c, 100, 42));
}

#[test]
fn is_empty_or_matches_rejects_a_wrong_opening() {
    let c = commit(100, 42);
    assert(!is_empty_or_matches(c, 100, 43));
}
