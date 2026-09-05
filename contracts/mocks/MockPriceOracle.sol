// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @notice Test-only oracle with owner-settable prices. Not part of the Latens protocol.
contract MockPriceOracle is IPriceOracle {
    address public immutable owner;
    mapping(address => uint256) private _priceE8;
    mapping(address => uint256) private _updatedAt;

    constructor() {
        owner = msg.sender;
    }

    function setPrice(address asset, uint256 priceE8) external {
        require(msg.sender == owner, "MockPriceOracle: not owner");
        _priceE8[asset] = priceE8;
        _updatedAt[asset] = block.timestamp;
    }

    function getPrice(address asset) external view returns (uint256 priceE8, uint256 updatedAt) {
        return (_priceE8[asset], _updatedAt[asset]);
    }
}
