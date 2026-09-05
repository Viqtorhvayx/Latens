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
interface ISolvencyVerifier {
    /// @param proof Serialized zk-SNARK proof.
    /// @param publicInputs Illustrative layout:
    ///   [0] collateralCommitment
    ///   [1] debtCommitment
    ///   [2] collateralPriceE8
    ///   [3] debtPriceE8
    ///   [4] thresholdBps
    function verifySolvency(bytes calldata proof, uint256[] calldata publicInputs) external view returns (bool);
}
