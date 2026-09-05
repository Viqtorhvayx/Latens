// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Verifies that a position satisfies a health-factor threshold without revealing
/// its collateral or debt amounts.
/// @dev The circuit proves knowledge of the openings of `collateralCommitment` and
/// `debtCommitment` and that
/// `debtAmount * debtPriceE8 * 10_000 <= collateralAmount * collateralPriceE8 * thresholdBps`.
/// Prices are public (oracle-sourced); only the amounts stay private. Used at borrow /
/// withdraw time with `thresholdBps = ltvBps` (origination check), matching the real Season 2
/// grant question "what is confidential, and from whom": the answer here is the position
/// size, not the market price or the fact that a position exists.
///
/// This layout matches circuits/solvency/src/main.nr field for field — that circuit has
/// actually been compiled, proven, and locally verified with real Barretenberg tooling (see
/// circuits/README.md). What's still open is wiring a real on-chain verifier in place of
/// MockVerifier; see that same README for the two concrete gaps blocking it.
interface ISolvencyVerifier {
    /// @param proof Serialized zk-SNARK proof.
    /// @param publicInputs Layout (matches circuits/solvency/src/main.nr):
    ///   [0] collateralCommitment
    ///   [1] debtCommitment
    ///   [2] collateralPriceE8
    ///   [3] debtPriceE8
    ///   [4] thresholdBps
    function verifySolvency(bytes calldata proof, uint256[] calldata publicInputs) external view returns (bool);
}
