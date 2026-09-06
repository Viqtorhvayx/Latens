use latens_common::commit;

global BPS_DENOMINATOR: u128 = 10_000;
global RAY: u128 = 1_000_000_000_000_000_000;

fn main(
    collateral_amount: u128,
    collateral_salt: Field,
    debt_amount: u128,
    debt_salt: Field,
    new_collateral_salt: Field,
    new_debt_salt: Field,
    collateral_commitment: pub Field,
    debt_commitment: pub Field,
    new_collateral_commitment: pub Field,
    new_debt_commitment: pub Field,
    collateral_price_e8: pub u128,
    debt_price_e8: pub u128,
    collateral_index_ray: pub u128,
    debt_index_ray: pub u128,
    liquidation_threshold_bps: pub u32,
    liquidation_bonus_bps: pub u32,
    seized_collateral_amount: pub u128,
    repay_amount: pub u128,
) {
    assert(collateral_commitment == commit(collateral_amount, collateral_salt));
    assert(debt_commitment == commit(debt_amount, debt_salt));

    let real_debt_amount: u128 = (debt_amount * debt_index_ray) / RAY;
    let real_collateral_amount: u128 = (collateral_amount * collateral_index_ray) / RAY;

    let debt_value: u128 = real_debt_amount * debt_price_e8;
    let collateral_value: u128 = real_collateral_amount * collateral_price_e8;
    let scaled_debt: u128 = debt_value * BPS_DENOMINATOR;
    let threshold_value: u128 = collateral_value * (liquidation_threshold_bps as u128);
    assert(scaled_debt > threshold_value);

    let seized_collateral_shares: u128 = (seized_collateral_amount * RAY) / collateral_index_ray;
    let repay_shares: u128 = (repay_amount * RAY) / debt_index_ray;
    assert(seized_collateral_shares <= collateral_amount);
    assert(repay_shares <= debt_amount);

    let seized_value: u128 = seized_collateral_amount * collateral_price_e8;
    let repaid_value: u128 = repay_amount * debt_price_e8;
    let max_seizable_value: u128 = repaid_value * (BPS_DENOMINATOR + (liquidation_bonus_bps as u128));
    assert(seized_value * BPS_DENOMINATOR <= max_seizable_value);

    let remaining_collateral = collateral_amount - seized_collateral_shares;
    let remaining_debt = debt_amount - repay_shares;
    assert(new_collateral_commitment == commit(remaining_collateral, new_collateral_salt));
    assert(new_debt_commitment == commit(remaining_debt, new_debt_salt));
}

fn run(
    collateral_amount: u128,
    debt_amount: u128,
    collateral_price_e8: u128,
    debt_price_e8: u128,
    collateral_index_ray: u128,
    debt_index_ray: u128,
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
    let seized_collateral_shares = (seized_collateral_amount * RAY) / collateral_index_ray;
    let repay_shares = (repay_amount * RAY) / debt_index_ray;
    let new_collateral_commitment =
        commit(collateral_amount - seized_collateral_shares, new_collateral_salt);
    let new_debt_commitment = commit(debt_amount - repay_shares, new_debt_salt);

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
        collateral_index_ray,
        debt_index_ray,
        liquidation_threshold_bps,
        liquidation_bonus_bps,
        seized_collateral_amount,
        repay_amount,
    );
}

#[test]
fn accepts_liquidating_an_insolvent_position_within_the_bonus_cap() {
    run(1000, 1900, 2, 1, RAY, RAY, 8_000, 800, 270, 500);
}

#[test(should_fail)]
fn rejects_liquidating_a_healthy_position() {
    run(1000, 1000, 2, 1, RAY, RAY, 8_000, 800, 100, 100);
}

#[test(should_fail)]
fn rejects_liquidating_a_position_exactly_at_the_threshold() {
    run(1000, 800, 2, 1, RAY, RAY, 8_000, 800, 100, 100);
}

#[test(should_fail)]
fn rejects_seizing_more_collateral_than_the_position_holds() {
    run(1000, 1900, 2, 1, RAY, RAY, 8_000, 800, 1500, 500);
}

#[test(should_fail)]
fn rejects_a_seized_amount_that_exceeds_the_bonus_cap() {
    run(1000, 1900, 2, 1, RAY, RAY, 8_000, 800, 1000, 500);
}

#[test]
fn a_grown_debt_index_makes_a_previously_healthy_position_liquidatable() {
    let grown_debt_index = RAY + RAY / 4;
    run(1000, 800, 1, 1, RAY, grown_debt_index, 8_000, 800, 90, 100);
}

#[test(should_fail)]
fn a_grown_collateral_index_can_rescue_a_position_from_liquidation() {
    let grown_collateral_index = RAY + RAY / 2;
    run(1000, 1900, 2, 1, grown_collateral_index, RAY, 8_000, 800, 270, 500);
}

#[test(should_fail)]
fn rejects_seizing_more_real_collateral_than_the_position_holds_after_indexing() {
    let grown_collateral_index = RAY + RAY / 2;
    run(1000, 3000, 2, 1, grown_collateral_index, RAY, 8_000, 800, 1600, 500);
}
