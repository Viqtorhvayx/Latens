// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface to Horizen's ZEN staking rewards pool. Latens contributes a
/// share of protocol fees here, per its Season 2 ecosystem-alignment commitment.
interface IZenStakingPool {
    function contribute(address token, uint256 amount) external;
}
