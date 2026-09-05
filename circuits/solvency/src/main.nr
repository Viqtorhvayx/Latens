// Latens — solvency circuit
//
// Backs `ISolvencyVerifier`. Called at borrow and withdraw time, whenever a position
// carries debt, to prove — without revealing either amount —
//   "This position's collateral and debt, at the given public prices, satisfy
//    debtValue * 10000 <= collateralValue * thresholdBps."
//
// LatensPool only ever calls this when the position genuinely has debt (see
// `_verifySolvency`'s call sites), so unlike `commitment_update`'s old-commitment check,
// there is no "zero means no position yet" case to special-case here — both commitments are
// expected to be real openings.
use latens_common::commit;

global BPS_DENOMINATOR: u128 = 10_000;

fn main(
    // Private
    collateral_amount: u128,
    collateral_salt: Field,
    debt_amount: u128,
    debt_salt: Field,
    // Public — see `ISolvencyVerifier.sol` for the exact array layout LatensPool expects.
    collateral_commitment: pub Field,
    debt_commitment: pub Field,
    collateral_price_e8: pub u128,
    debt_price_e8: pub u128,
    threshold_bps: pub u32,
) {
    assert(collateral_commitment == commit(collateral_amount, collateral_salt));
    assert(debt_commitment == commit(debt_amount, debt_salt));

    // u128 arithmetic here is checked (see circuits/README.md): if these multiplications
    // would overflow u128 for a legitimately large position, proving simply fails rather
    // than silently wrapping. That is a completeness limit (very large positions may need a
    // wider representation in a later milestone), never a soundness hole.
    let debt_value: u128 = debt_amount * debt_price_e8;
    let collateral_value: u128 = collateral_amount * collateral_price_e8;

    let scaled_debt: u128 = debt_value * BPS_DENOMINATOR;
    let threshold_value: u128 = collateral_value * (threshold_bps as u128);

    assert(scaled_debt <= threshold_value);
}

#[test]
fn accepts_a_healthy_position() {
    // 1000 units of collateral @ $2 = $2000; 1000 units of debt @ $1 = $1000 -> 50% of value,
    // comfortably under an 80% threshold.
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(1000, 2);
    main(1000, 1, 1000, 2, collateral_commitment, debt_commitment, 2, 1, 8_000);
}

#[test(should_fail)]
fn rejects_an_unhealthy_position() {
    // $2000 collateral, $1900 debt -> 95% of value, over an 80% threshold.
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(1900, 2);
    main(1000, 1, 1900, 2, collateral_commitment, debt_commitment, 2, 1, 8_000);
}

#[test]
fn accepts_a_position_exactly_at_the_threshold() {
    // $1000 collateral @ 80% threshold allows exactly $800 of debt.
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(800, 2);
    main(1000, 1, 800, 2, collateral_commitment, debt_commitment, 1, 1, 8_000);
}

#[test(should_fail)]
fn rejects_a_mismatched_collateral_opening() {
    let real_collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(100, 2);
    // Prover claims 5000 units of collateral but the on-chain commitment was for 1000.
    main(5000, 1, 100, 2, real_collateral_commitment, debt_commitment, 2, 1, 8_000);
}
