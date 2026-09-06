use latens_common::commit;

global BPS_DENOMINATOR: u128 = 10_000;
global RAY: u128 = 1_000_000_000_000_000_000;

fn main(
    collateral_amount: u128,
    collateral_salt: Field,
    debt_amount: u128,
    debt_salt: Field,
    collateral_commitment: pub Field,
    debt_commitment: pub Field,
    collateral_price_e8: pub u128,
    debt_price_e8: pub u128,
    collateral_index_ray: pub u128,
    debt_index_ray: pub u128,
    threshold_bps: pub u32,
) {
    assert(collateral_commitment == commit(collateral_amount, collateral_salt));
    assert(debt_commitment == commit(debt_amount, debt_salt));

    let real_debt_amount: u128 = (debt_amount * debt_index_ray) / RAY;
    let real_collateral_amount: u128 = (collateral_amount * collateral_index_ray) / RAY;

    let debt_value: u128 = real_debt_amount * debt_price_e8;
    let collateral_value: u128 = real_collateral_amount * collateral_price_e8;

    let scaled_debt: u128 = debt_value * BPS_DENOMINATOR;
    let threshold_value: u128 = collateral_value * (threshold_bps as u128);

    assert(scaled_debt <= threshold_value);
}

#[test]
fn accepts_a_healthy_position_at_unit_index() {
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(1000, 2);
    main(1000, 1, 1000, 2, collateral_commitment, debt_commitment, 2, 1, RAY, RAY, 8_000);
}

#[test(should_fail)]
fn rejects_an_unhealthy_position_at_unit_index() {
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(1900, 2);
    main(1000, 1, 1900, 2, collateral_commitment, debt_commitment, 2, 1, RAY, RAY, 8_000);
}

#[test]
fn accepts_a_position_exactly_at_the_threshold_at_unit_index() {
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(800, 2);
    main(1000, 1, 800, 2, collateral_commitment, debt_commitment, 1, 1, RAY, RAY, 8_000);
}

#[test(should_fail)]
fn rejects_a_mismatched_collateral_opening() {
    let real_collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(100, 2);
    main(5000, 1, 100, 2, real_collateral_commitment, debt_commitment, 2, 1, RAY, RAY, 8_000);
}

#[test]
fn a_grown_debt_index_makes_a_position_riskier() {
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(1000, 2);
    let grown_debt_index = RAY + RAY / 2;
    main(1000, 1, 1000, 2, collateral_commitment, debt_commitment, 2, 1, RAY, grown_debt_index, 8_000);
}

#[test(should_fail)]
fn a_grown_debt_index_can_push_a_position_into_insolvency() {
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(800, 2);
    let grown_debt_index = RAY + RAY / 4;
    main(1000, 1, 800, 2, collateral_commitment, debt_commitment, 1, 1, RAY, grown_debt_index, 8_000);
}

#[test]
fn a_grown_collateral_index_offsets_a_grown_debt_index() {
    let collateral_commitment = commit(1000, 1);
    let debt_commitment = commit(1000, 2);
    let grown_index = RAY + RAY / 2;
    main(1000, 1, 1000, 2, collateral_commitment, debt_commitment, 2, 1, grown_index, grown_index, 8_000);
}
