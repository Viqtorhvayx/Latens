// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {LatensPool} from "./LatensPool.sol";
import {Errors} from "../libraries/Errors.sol";

contract SupplyRewards is Ownable2Step {
    using SafeERC20 for IERC20;

    struct Checkpoint {
        uint64 lastEpoch;
        bool hasCheckpoint;
        uint256 pendingReward;
    }

    LatensPool public immutable pool;
    IERC20 public immutable rewardToken;
    uint256 public immutable startTime;

    uint256 public epochDuration;
    uint256 public rewardPerEpoch;

    mapping(address => Checkpoint) public checkpoints;

    event EpochDurationUpdated(uint256 epochDuration);
    event RewardPerEpochUpdated(uint256 rewardPerEpoch);
    event Funded(uint256 amount);
    event Checkpointed(address indexed user, uint256 epoch, uint256 pendingReward);
    event Claimed(address indexed user, uint256 amount);

    constructor(address initialOwner, LatensPool pool_, IERC20 rewardToken_, uint256 epochDuration_, uint256 rewardPerEpoch_)
        Ownable(initialOwner)
    {
        if (epochDuration_ == 0) revert Errors.InvalidRiskParams();
        pool = pool_;
        rewardToken = rewardToken_;
        epochDuration = epochDuration_;
        rewardPerEpoch = rewardPerEpoch_;
        startTime = block.timestamp;
    }

    function setEpochDuration(uint256 epochDuration_) external onlyOwner {
        if (epochDuration_ == 0) revert Errors.InvalidRiskParams();
        epochDuration = epochDuration_;
        emit EpochDurationUpdated(epochDuration_);
    }

    function setRewardPerEpoch(uint256 rewardPerEpoch_) external onlyOwner {
        rewardPerEpoch = rewardPerEpoch_;
        emit RewardPerEpochUpdated(rewardPerEpoch_);
    }

    function fund(uint256 amount) external onlyOwner {
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(amount);
    }

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - startTime) / epochDuration;
    }

    function checkpoint() external {
        (,,,,,, bool active,) = pool.positions(msg.sender);
        if (!active) revert Errors.NoActivePosition();

        uint256 epoch = currentEpoch();
        Checkpoint storage cp = checkpoints[msg.sender];

        if (cp.hasCheckpoint && epoch == cp.lastEpoch + 1) {
            cp.pendingReward += rewardPerEpoch;
        }

        cp.lastEpoch = uint64(epoch);
        cp.hasCheckpoint = true;

        emit Checkpointed(msg.sender, epoch, cp.pendingReward);
    }

    function claim() external {
        Checkpoint storage cp = checkpoints[msg.sender];
        uint256 amount = cp.pendingReward;
        if (amount == 0) revert Errors.ZeroAmount();

        cp.pendingReward = 0;
        rewardToken.safeTransfer(msg.sender, amount);

        emit Claimed(msg.sender, amount);
    }
}
