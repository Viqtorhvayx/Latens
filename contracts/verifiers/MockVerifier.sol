// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ICommitmentVerifier} from "../interfaces/ICommitmentVerifier.sol";
import {ISolvencyVerifier} from "../interfaces/ISolvencyVerifier.sol";
import {ILiquidationVerifier} from "../interfaces/ILiquidationVerifier.sol";

/// @notice Development/testnet stand-in for the real zk-SNARK verifiers.
/// @dev DO NOT DEPLOY TO PRODUCTION OR MAINNET. This lets `LatensPool`'s state machine
/// (commitment bookkeeping, accounting, access control) be built and tested end-to-end
/// before the M1 circuits exist. In `strict` mode it requires the trivial proof
/// `keccak256(abi.encode(publicInputs))`, so tests can still exercise the "invalid proof
/// reverts" path without a real circuit; in permissive mode (the default) it accepts
/// anything, which is only ever appropriate for local development.
contract MockVerifier is ICommitmentVerifier, ISolvencyVerifier, ILiquidationVerifier {
    address public immutable owner;
    bool public strict;

    constructor(bool strict_) {
        owner = msg.sender;
        strict = strict_;
    }

    function setStrict(bool strict_) external {
        require(msg.sender == owner, "MockVerifier: not owner");
        strict = strict_;
    }

    function verifyCommitmentUpdate(bytes calldata proof, uint256[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        return _check(proof, publicInputs);
    }

    function verifySolvency(bytes calldata proof, uint256[] calldata publicInputs) external view returns (bool) {
        return _check(proof, publicInputs);
    }

    function verifyLiquidationEligibility(bytes calldata proof, uint256[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        return _check(proof, publicInputs);
    }

    function _check(bytes calldata proof, uint256[] calldata publicInputs) private view returns (bool) {
        if (!strict) return true;
        return keccak256(proof) == keccak256(abi.encode(publicInputs));
    }
}
