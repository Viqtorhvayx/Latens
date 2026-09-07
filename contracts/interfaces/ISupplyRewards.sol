// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal interface to SupplyRewards, used by ProtocolTreasury to route a share of
/// swept interest revenue there. Kept as an interface rather than importing SupplyRewards
/// directly: SupplyRewards imports LatensPool, which imports ProtocolTreasury, so a direct
/// import here would be circular.
interface ISupplyRewards {
    function fund(uint256 amount) external;
    function rewardToken() external view returns (IERC20);
}
