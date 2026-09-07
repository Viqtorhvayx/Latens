// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IZenStakingPool} from "../interfaces/IZenStakingPool.sol";
import {ISupplyRewards} from "../interfaces/ISupplyRewards.sol";
import {Errors} from "../libraries/Errors.sol";

/// @notice Holds the protocol's reserve-factor cut of interest and splits it three ways:
/// the ZEN staking rewards pool, SupplyRewards, and protocol runway.
/// @dev The 15-20% staking contribution range is the indicative figure from Latens's Season
/// 2 application, not an arbitrary constant — see the grant's "Long-term alignment & ZEN
/// staking" terms. `setContributionRate` cannot exceed that range without a redeploy, so a
/// future admin can't silently walk the number up past what was committed to.
///
/// The SupplyRewards slice exists so that program isn't only ever a single fixed grant that
/// drains at a flat per-checkpoint rate regardless of protocol usage (see SupplyRewards'
/// own header) — every sweep now tops it back up with a share of whatever interest revenue
/// actually came in, so its runway scales with real activity instead of counting down to
/// zero on a fixed clock.
contract ProtocolTreasury is Ownable2Step {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_CONTRIBUTION_BPS = 2_000; // 20%, the top of the grant's indicative range
    uint16 public constant MAX_REWARDS_CONTRIBUTION_BPS = 3_000; // 30% — a cap on this contract's own discretion, not an external commitment

    IZenStakingPool public zenStakingPool;
    ISupplyRewards public supplyRewards;
    uint16 public stakingContributionBps = 1_750; // 17.5%, midpoint of the 15-20% range
    uint16 public rewardsContributionBps;

    event StakingPoolUpdated(address indexed zenStakingPool);
    event SupplyRewardsUpdated(address indexed supplyRewards);
    event ContributionRateUpdated(uint16 bps);
    event RewardsContributionRateUpdated(uint16 bps);
    event FeesSwept(address indexed token, uint256 toStaking, uint256 toRewards, uint256 toRunway);

    constructor(address initialOwner, address zenStakingPool_) Ownable(initialOwner) {
        zenStakingPool = IZenStakingPool(zenStakingPool_);
    }

    function setStakingPool(address zenStakingPool_) external onlyOwner {
        zenStakingPool = IZenStakingPool(zenStakingPool_);
        emit StakingPoolUpdated(zenStakingPool_);
    }

    /// @notice Wiring is optional (leave unset, or zero it out, and sweep behaves exactly as
    /// before — every token goes to staking/runway only). Set once SupplyRewards exists so
    /// sweep() can start topping it up in its own reward token.
    function setSupplyRewards(address supplyRewards_) external onlyOwner {
        supplyRewards = ISupplyRewards(supplyRewards_);
        emit SupplyRewardsUpdated(supplyRewards_);
    }

    function setContributionRate(uint16 bps) external onlyOwner {
        if (bps > MAX_CONTRIBUTION_BPS) revert Errors.ExceedsGrantIndicativeRange();
        stakingContributionBps = bps;
        emit ContributionRateUpdated(bps);
    }

    function setRewardsContributionRate(uint16 bps) external onlyOwner {
        if (bps > MAX_REWARDS_CONTRIBUTION_BPS) revert Errors.ExceedsGrantIndicativeRange();
        rewardsContributionBps = bps;
        emit RewardsContributionRateUpdated(bps);
    }

    /// @notice Splits this contract's balance of `token` between the ZEN staking pool,
    /// SupplyRewards, and protocol runway. Permissionless on purpose — any keeper can
    /// trigger distribution, so fees never sit idle waiting on an admin.
    /// @dev The SupplyRewards slice only applies when `token` is actually that pool's own
    /// reward token — SupplyRewards.fund() has no way to accept anything else, and every
    /// other market's interest keeps flowing to staking/runway exactly as before.
    function sweep(address token) external {
        uint256 amount = IERC20(token).balanceOf(address(this));
        if (amount == 0) return;

        uint256 toStaking = (amount * stakingContributionBps) / 10_000;
        uint256 toRewards;
        if (address(supplyRewards) != address(0) && rewardsContributionBps > 0 && token == address(supplyRewards.rewardToken())) {
            toRewards = (amount * rewardsContributionBps) / 10_000;
        }
        uint256 toRunway = amount - toStaking - toRewards;

        if (toStaking > 0 && address(zenStakingPool) != address(0)) {
            IERC20(token).forceApprove(address(zenStakingPool), toStaking);
            zenStakingPool.contribute(token, toStaking);
        }
        if (toRewards > 0) {
            IERC20(token).forceApprove(address(supplyRewards), toRewards);
            supplyRewards.fund(toRewards);
        }

        emit FeesSwept(token, toStaking, toRewards, toRunway);
    }

    function withdrawRunway(address token, address to, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(to, amount);
    }
}
