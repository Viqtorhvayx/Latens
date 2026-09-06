// SPDX-License-Identifier: MIT
// Loose pragma (not exact-pinned like most of contracts/): this interface is imported by
// both the 0.8.24 graph (LatensPool.sol) and the 0.8.30 graph (NoirSolvencyVerifier.sol,
// forced by SolvencyHonkVerifier.sol's own pragma) — see hardhat.config.js's overrides.
pragma solidity ^0.8.24;

/// @notice Verifies that a position satisfies a health-factor threshold without revealing
/// its collateral or debt amounts.
/// @dev The circuit proves knowledge of the openings of `collateralCommitment` and
/// `debtCommitment` and that, after scaling each side by its own interest index,
/// `debtAmount * debtIndexRay * debtPriceE8 * 10_000 <= collateralAmount * collateralIndexRay
/// * collateralPriceE8 * thresholdBps`. Prices are public (oracle-sourced); only the amounts
/// stay private. Used at borrow / withdraw time with `thresholdBps = ltvBps` (origination
/// check), matching the real Season 2 grant question "what is confidential, and from whom":
/// the answer here is the position size, not the market price or the fact that a position
/// exists.
///
/// This layout matches circuits/solvency/src/main.nr field for field — that circuit has
/// actually been compiled, proven, and locally verified with real Barretenberg tooling (see
/// circuits/README.md).
interface ISolvencyVerifier {
    /// @param proof Serialized zk-SNARK proof.
    /// @param publicInputs Layout (matches circuits/solvency/src/main.nr):
    ///   [0] collateralCommitment
    ///   [1] debtCommitment
    ///   [2] collateralPriceE8
    ///   [3] debtPriceE8
    ///   [4] collateralIndexRay (RAY-scaled, 1e18 = 1:1)
    ///   [5] debtIndexRay (RAY-scaled; today's callers only index the collateral side and
    ///       always pass RAY here, but the circuit treats both sides the same way)
    ///   [6] thresholdBps
    function verifySolvency(bytes calldata proof, uint256[] calldata publicInputs) external view returns (bool);
}
