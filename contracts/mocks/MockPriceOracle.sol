// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

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

    /// @notice Test-only escape hatch to set an arbitrary `updatedAt`, including one in the
    /// future — exercises LatensPool's defense against an IPriceOracle implementation
    /// reporting a timestamp ahead of the current block (see its `_requireFreshPrice`).
    function setPriceWithTimestamp(address asset, uint256 priceE8, uint256 updatedAt) external {
        require(msg.sender == owner, "MockPriceOracle: not owner");
        _priceE8[asset] = priceE8;
        _updatedAt[asset] = updatedAt;
    }

    /// @notice Bumps `updatedAt` to now without touching the price itself — permissionless
    /// on purpose. A real oracle updates on its own; this mock only advances when someone
    /// calls setPrice(), so on a live testnet a price set once at deploy time silently ages
    /// past PRICE_STALENESS_WINDOW (1 hour, in both LatensPool and LatensCDP) and every
    /// solvency-gated call starts reverting with StaleOraclePrice regardless of whether
    /// anything else about the call is correct — not a market-data problem, just this mock
    /// needing a heartbeat. Doesn't need to be owner-gated: it can't change what price an
    /// asset reports, only how recently that same price counts as checked, so it can't be
    /// used to manipulate a position's valuation — only to keep a genuinely-set price from
    /// going stale. Reverts on an asset that was never priced, rather than manufacturing a
    /// fresh timestamp for a price that doesn't exist.
    function refreshTimestamp(address asset) external {
        require(_priceE8[asset] != 0, "MockPriceOracle: no price set");
        _updatedAt[asset] = block.timestamp;
    }

    function getPrice(address asset) external view returns (uint256 priceE8, uint256 updatedAt) {
        return (_priceE8[asset], _updatedAt[asset]);
    }
}
