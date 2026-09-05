// SPDX-License-Identifier: MIT
// Loose pragma (not exact-pinned like most of contracts/): this interface is imported by
// both the 0.8.24 graph (LatensPool.sol) and the 0.8.30 graph (NoirCommitmentVerifier.sol,
// forced by CommitmentHonkVerifier.sol's own pragma) — see hardhat.config.js's overrides.
pragma solidity ^0.8.24;

/// @notice Verifies confidential updates to a single commitment (collateral or debt).
/// @dev The circuit proves knowledge of the opening of `oldCommitment` (amount, salt),
/// knowledge of a fresh `newSalt`, and that
/// `newCommitment == commit(oldAmount +/- publicDelta, newSalt)`
/// — all without revealing `oldAmount` or the resulting amount. `publicDelta` (the
/// deposit/withdraw/borrow/repay amount) is public because the ERC20 transfer that moves it
/// is itself public on an EVM chain; what stays private is the running position size.
///
/// This layout matches circuits/commitment_update/src/main.nr field for field. What's still
/// open is the on-chain verifier itself — LatensPool is wired to MockVerifier until the two
/// gaps documented in circuits/README.md (public-input layout of the generated Solidity
/// verifier, and a Solidity compile failure in Barretenberg's generated code) are closed.
interface ICommitmentVerifier {
    /// @param proof Serialized zk-SNARK proof, format defined by the deployed verifying key.
    /// @param publicInputs Layout (matches circuits/commitment_update/src/main.nr):
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
