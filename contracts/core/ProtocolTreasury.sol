// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IZenStakingPool} from "../interfaces/IZenStakingPool.sol";
import {Errors} from "../libraries/Errors.sol";

/// @notice Holds the protocol's reserve-factor cut of interest and splits it between
/// protocol runway and the ZEN staking rewards pool.
/// @dev The 15-20% contribution range is the indicative figure from Latens's Season 2
/// application, not an arbitrary constant — see the grant's "Long-term alignment & ZEN
/// staking" terms. `setContributionRate` cannot exceed that range without a redeploy, so a
/// future admin can't silently walk the number up past what was committed to.
contract ProtocolTreasury is Ownable2Step {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_CONTRIBUTION_BPS = 2_000; // 20%, the top of the grant's indicative range

    IZenStakingPool public zenStakingPool;
    uint16 public stakingContributionBps = 1_750; // 17.5%, midpoint of the 15-20% range

    event StakingPoolUpdated(address indexed zenStakingPool);
    event ContributionRateUpdated(uint16 bps);
    event FeesSwept(address indexed token, uint256 toStaking, uint256 toRunway);

    constructor(address initialOwner, address zenStakingPool_) Ownable(initialOwner) {
        zenStakingPool = IZenStakingPool(zenStakingPool_);
    }

    function setStakingPool(address zenStakingPool_) external onlyOwner {
        zenStakingPool = IZenStakingPool(zenStakingPool_);
        emit StakingPoolUpdated(zenStakingPool_);
    }

    function setContributionRate(uint16 bps) external onlyOwner {
        if (bps > MAX_CONTRIBUTION_BPS) revert Errors.ExceedsGrantIndicativeRange();
        stakingContributionBps = bps;
        emit ContributionRateUpdated(bps);
    }

    /// @notice Splits this contract's balance of `token` between the ZEN staking pool and
    /// protocol runway. Permissionless on purpose — any keeper can trigger distribution, so
    /// fees never sit idle waiting on an admin.
    function sweep(address token) external {
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) return;

        uint256 toStaking = (amount * stakingContributionBps) / 10_000;
        uint256 toRunway = amount - toStaking;

        if (toStaking > 0 && address(zenStakingPool) != address(0)) {
            IERC20(token).forceApprove(address(zenStakingPool), toStaking);
            zenStakingPool.contribute(token, toStaking);
        }

        emit FeesSwept(token, toStaking, toRunway);
    }

    function withdrawRunway(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
