// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Public price feed. Prices are intentionally NOT part of the confidentiality
/// surface — the zk circuits take them as public inputs.
interface IPriceOracle {
    /// @return priceE8 the asset's USD price, scaled by 1e8 (Chainlink-style).
    /// @return updatedAt unix timestamp of the last update.
    function getPrice(address asset) external view returns (uint256 priceE8, uint256 updatedAt);
}
