// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IZenStakingPool} from "../interfaces/IZenStakingPool.sol";

/// @notice Test-only stand-in for Horizen's ZEN staking rewards pool. Not part of the
/// Latens protocol — the real integration point is `IZenStakingPool`.
contract MockZenStakingPool is IZenStakingPool {
    using SafeERC20 for IERC20;

    mapping(address => uint256) public totalContributed;

    function contribute(address token, uint256 amount) external {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        totalContributed[token] += amount;
    }
}
