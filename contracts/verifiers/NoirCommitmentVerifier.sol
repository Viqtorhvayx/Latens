// SPDX-License-Identifier: MIT
// Not pinned to an exact version like the rest of contracts/: this file imports
// CommitmentHonkVerifier.sol, whose own internal pragma (^0.8.27) forces the whole import
// graph to compile under one shared solc version — see the matching override in
// hardhat.config.js, which resolves that to 0.8.30/cancun for both files together.
pragma solidity ^0.8.24;

import {ICommitmentVerifier} from "../interfaces/ICommitmentVerifier.sol";
import {CommitmentHonkVerifier} from "./generated/CommitmentHonkVerifier.sol";

/// @notice Adapter between Latens's protocol-level `ICommitmentVerifier` interface and the
/// real, machine-generated `CommitmentHonkVerifier` (Barretenberg's UltraHonk EVM verifier
/// for circuits/commitment_update).
/// @dev See `NoirSolvencyVerifier`'s NatSpec for the full explanation of this calldata
/// mapping (confirmed against a real proof in
/// `test/CommitmentHonkVerifier.integration.test.js`): `publicInputs` is exactly the
/// circuit's own 5 declared public inputs — not `NUMBER_OF_PUBLIC_INPUTS` (13), which
/// includes 8 pairing-point-object elements the verifier extracts from inside `proof`
/// itself. `proof` is passed straight through as bb produces it, unmodified.
contract NoirCommitmentVerifier is ICommitmentVerifier {
    CommitmentHonkVerifier public immutable honkVerifier;

    constructor(CommitmentHonkVerifier honkVerifier_) {
        honkVerifier = honkVerifier_;
    }

    function verifyCommitmentUpdate(bytes calldata proof, uint256[] calldata publicInputs)
        external
        view
        returns (bool)
    {
        bytes32[] memory honkPublicInputs = new bytes32[](publicInputs.length);
        for (uint256 i = 0; i < publicInputs.length; i++) {
            honkPublicInputs[i] = bytes32(publicInputs[i]);
        }
        return honkVerifier.verify(proof, honkPublicInputs);
    }
}
