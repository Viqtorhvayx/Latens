// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Errors} from "../libraries/Errors.sol";

/// @title LatensDollar
/// @notice Minted and burned only by `LatensCDP`.
contract LatensDollar is ERC20, Ownable2Step {
    address public cdp;

    constructor(address initialOwner) ERC20("Latens Dollar", "LATD") Ownable(initialOwner) {}

    function setCDP(address cdp_) external onlyOwner {
        if (cdp != address(0)) revert Errors.PoolAlreadySet();
        if (cdp_ == address(0)) revert Errors.ZeroAddress();
        cdp = cdp_;
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != cdp) revert Errors.NotPool();
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        if (msg.sender != cdp) revert Errors.NotPool();
        _burn(from, amount);
    }
}
