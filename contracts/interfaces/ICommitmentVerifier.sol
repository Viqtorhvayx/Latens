// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Verifies confidential updates to a single commitment (collateral or debt).
/// @dev The circuit proves knowledge of the opening of `oldCommitment` (amount, salt),
/// knowledge of a fresh `newSalt`, and that
/// `newCommitment == commit(oldAmount +/- publicDelta, newSalt)`
/// — all without revealing `oldAmount` or the resulting amount. `publicDelta` (the
/// deposit/withdraw/borrow/repay amount) is public because the ERC20 transfer that moves it
/// is itself public on an EVM chain; what stays private is the running position size.
///
/// This interface's exact public-input layout is a placeholder pending the M1 circuit
/// (see the Latens Season 2 milestones) — treat the shape as illustrative, not final.
interface ICommitmentVerifier {
    /// @param proof Serialized zk-SNARK proof, format defined by the deployed verifying key.
    /// @param publicInputs Illustrative layout:
    ///   [0] oldCommitment (0 for a brand-new position)
    ///   [1] newCommitment
    ///   [2] publicDelta (the ERC20 amount moved this call)
    ///   [3] isIncrease (1 = deposit/borrow, 0 = withdraw/repay)
    ///   [4] assetId
    function verifyCommitmentUpdate(bytes calldata proof, uint256[] calldata publicInputs)
        external
        view
        returns (bool);
}
