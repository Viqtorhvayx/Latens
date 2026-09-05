// Latens — liquidation_eligibility circuit
//
// Backs `ILiquidationVerifier` — the hardest of the three proofs, and the one this scaffold
// is most honest about not having fully solved (see that interface's NatSpec). It proves,
// given a position's real (private) collateral and debt:
//
//   1. The position is genuinely INSOLVENT at the given public prices (the negation of the
//      `solvency` circuit's check) — a keeper cannot liquidate a healthy position.
//   2. `seized_collateral_amount` and `repay_amount` are each no more than the position
//      actually holds — a keeper cannot seize or "repay" more than exists.
//   3. The seized collateral's value is capped at the repaid debt's value plus the
//      configured liquidation bonus — a keeper cannot take more than they're entitled to.
//   4. The post-liquidation commitments correctly reflect collateral/debt reduced by
//      exactly the seized/repaid amounts.
//
// `seized_collateral_amount` and `repay_amount` are PUBLIC: this scaffold's position is that
// a position's privacy holds until it needs to be liquidated, not forever — see
// `ILiquidationVerifier.sol`. Whether partial-liquidation amounts can stay private too (e.g.
// via a further confidential transfer to the keeper) is open design space for the M1
// milestone, not something this circuit presumes to have solved.
use latens_common::commit;

global BPS_DENOMINATOR: u128 = 10_000;

fn main(
    // Private: the position's real, pre-liquidation opening.
    collateral_amount: u128,
    collateral_salt: Field,
    debt_amount: u128,
    debt_salt: Field,
    // Private: fresh salts for the post-liquidation commitments.
    new_collateral_salt: Field,
    new_debt_salt: Field,
    // Public — see `ILiquidationVerifier.sol` for the exact array layout LatensPool expects.
    collateral_commitment: pub Field,
    debt_commitment: pub Field,
    new_collateral_commitment: pub Field,
    new_debt_commitment: pub Field,
    collateral_price_e8: pub u128,
    debt_price_e8: pub u128,
    liquidation_threshold_bps: pub u32,
    liquidation_bonus_bps: pub u32,
    seized_collateral_amount: pub u128,
    repay_amount: pub u128,
) {
    assert(collateral_commitment == commit(collateral_amount, collateral_salt));
    assert(debt_commitment == commit(debt_amount, debt_salt));

    // (1) The position must genuinely be insolvent — strictly the negation of `solvency`'s
    // check. Equal-to-threshold is healthy (see `solvency`'s boundary test), so liquidation
    // requires a strict `>`, not `>=`.
    let debt_value: u128 = debt_amount * debt_price_e8;
    let collateral_value: u128 = collateral_amount * collateral_price_e8;
    let scaled_debt: u128 = debt_value * BPS_DENOMINATOR;
    let threshold_value: u128 = collateral_value * (liquidation_threshold_bps as u128);
    assert(scaled_debt > threshold_value);

    // (2) Can't seize or repay more than the position actually holds.
    assert(seized_collateral_amount <= collateral_amount);
    assert(repay_amount <= debt_amount);

    // (3) Seized value is capped at repaid value plus the configured bonus. This protects
    // the borrower from a keeper claiming an inflated `seized_collateral_amount`; it does
    // NOT guarantee the keeper receives at least their bonus (a keeper can always choose to
    // under-claim). Sizing the bonus so liquidation stays profitable is a market-design
    // question for the M1 milestone, not something this constraint decides.
    let seized_value: u128 = seized_collateral_amount * collateral_price_e8;
    let repaid_value: u128 = repay_amount * debt_price_e8;
    let max_seizable_value: u128 = repaid_value * (BPS_DENOMINATOR + (liquidation_bonus_bps as u128));
    assert(seized_value * BPS_DENOMINATOR <= max_seizable_value);

    // (4) Post-liquidation commitments correctly reflect the seizure/repayment.
    let remaining_collateral = collateral_amount - seized_collateral_amount;
    let remaining_debt = debt_amount - repay_amount;
    assert(new_collateral_commitment == commit(remaining_collateral, new_collateral_salt));
    assert(new_debt_commitment == commit(remaining_debt, new_debt_salt));
}

fn run(
    collateral_amount: u128,
    debt_amount: u128,
    collateral_price_e8: u128,
    debt_price_e8: u128,
    liquidation_threshold_bps: u32,
    liquidation_bonus_bps: u32,
    seized_collateral_amount: u128,
    repay_amount: u128,
) {
    let collateral_salt = 1;
    let debt_salt = 2;
    let new_collateral_salt = 3;
    let new_debt_salt = 4;
    let collateral_commitment = commit(collateral_amount, collateral_salt);
    let debt_commitment = commit(debt_amount, debt_salt);
    let new_collateral_commitment =
        commit(collateral_amount - seized_collateral_amount, new_collateral_salt);
    let new_debt_commitment = commit(debt_amount - repay_amount, new_debt_salt);

    main(
        collateral_amount,
        collateral_salt,
        debt_amount,
        debt_salt,
        new_collateral_salt,
        new_debt_salt,
        collateral_commitment,
        debt_commitment,
        new_collateral_commitment,
        new_debt_commitment,
        collateral_price_e8,
        debt_price_e8,
        liquidation_threshold_bps,
        liquidation_bonus_bps,
        seized_collateral_amount,
        repay_amount,
    );
}

#[test]
fn accepts_liquidating_an_insolvent_position_within_the_bonus_cap() {
    // $2000 collateral (1000 @ $2), $1900 debt (1900 @ $1) -> 95% of value, over an 80%
    // threshold: insolvent. Liquidator repays 500 debt ($500) and seizes 270 collateral
    // ($540) -> 8% bonus over the $500 repaid, within the configured 800 bps (8%) cap.
    run(1000, 1900, 2, 1, 8_000, 800, 270, 500);
}

#[test(should_fail)]
fn rejects_liquidating_a_healthy_position() {
    // $2000 collateral, $1000 debt -> 50% of value, well under an 80% threshold.
    run(1000, 1000, 2, 1, 8_000, 800, 100, 100);
}

#[test(should_fail)]
fn rejects_liquidating_a_position_exactly_at_the_threshold() {
    // Exactly at 80% is healthy per `solvency`'s own boundary test — liquidation requires
    // strictly worse than the threshold, not merely equal to it.
    run(1000, 800, 2, 1, 8_000, 800, 100, 100);
}

#[test(should_fail)]
fn rejects_seizing_more_collateral_than_the_position_holds() {
    run(1000, 1900, 2, 1, 8_000, 800, 1500, 500);
}

#[test(should_fail)]
fn rejects_a_seized_amount_that_exceeds_the_bonus_cap() {
    // Repaying 500 debt ($500) should cap seizure at $540 (8% bonus) = 270 collateral units
    // at $2 each. Claiming 1000 units ($2000 seized) is far beyond that.
    run(1000, 1900, 2, 1, 8_000, 800, 1000, 500);
}
