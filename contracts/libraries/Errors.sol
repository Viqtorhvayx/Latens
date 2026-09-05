// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Shared custom errors for the Latens protocol.
library Errors {
    error InvalidRiskParams();
    error AssetNotListed();
    error AssetNotSupported();
    error NotPool();
    error PoolAlreadySet();
    error InvalidProof();
    error ZeroAddress();
    error ZeroAmount();
    error StaleOraclePrice();
    error ExceedsGrantIndicativeRange();
}
