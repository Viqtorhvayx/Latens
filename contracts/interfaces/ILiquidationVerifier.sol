// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Verifies that a position is eligible for liquidation, and the exact amounts
/// a keeper may seize, without the position ever having been readable in the clear before
/// this proof was produced.
/// @dev This is the hardest unsolved problem named in Latens's own RFP response: proving
/// insolvency (the negation of `ISolvencyVerifier`) while disclosing only what settlement
/// requires. This scaffold takes the position that `seizedCollateralAmount` and
/// `repayAmount` become PUBLIC at the moment of liquidation — a position's privacy holds
/// until it needs to be liquidated, not forever. Whether a partial-liquidation amount can
/// stay private too (e.g. via a second confidential transfer to the keeper) is open design
/// space for the M1 milestone, not something this interface presumes to have solved.
interface ILiquidationVerifier {
    /// @param proof Serialized zk-SNARK proof.
    /// @param publicInputs Illustrative layout:
    ///   [0] collateralCommitment (pre-liquidation)
    ///   [1] debtCommitment (pre-liquidation)
    ///   [2] newCollateralCommitment (post-liquidation, seized amount removed)
    ///   [3] newDebtCommitment (post-liquidation, repaid amount removed)
    ///   [4] collateralPriceE8
    ///   [5] debtPriceE8
    ///   [6] liquidationThresholdBps
    ///   [7] seizedCollateralAmount (public — see dev note above)
    ///   [8] repayAmount (public — see dev note above)
    function verifyLiquidationEligibility(bytes calldata proof, uint256[] calldata publicInputs)
        external
        view
        returns (bool);
}
