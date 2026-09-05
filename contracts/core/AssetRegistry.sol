// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {DataTypes} from "../libraries/DataTypes.sol";
import {Errors} from "../libraries/Errors.sol";

/// @notice Registry of supported markets and their public risk parameters and aggregates.
/// @dev Deliberately separate from `LatensPool`: risk parameters are governed by the
/// Foundation-style admin process described in Latens's grant terms (milestone structures
/// are "proposed and negotiated," with final acceptance authority retained), while the pool
/// itself should be as small and auditable as possible.
contract AssetRegistry is Ownable2Step {
    address public pool;
    uint256 public assetCount;

    mapping(uint256 assetId => DataTypes.Asset) private _assets;

    event PoolSet(address indexed pool);
    event AssetListed(uint256 indexed assetId, address indexed token, uint16 ltvBps, uint16 liquidationThresholdBps);
    event AssetParamsUpdated(
        uint256 indexed assetId, uint16 ltvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps, uint16 reserveFactorBps
    );
    event AssetSupportToggled(uint256 indexed assetId, bool isSupported);

    modifier onlyPool() {
        if (msg.sender != pool) revert Errors.NotPool();
        _;
    }

    constructor(address initialOwner) Ownable(initialOwner) {}

    /// @notice One-time wiring of the pool address, done once after both contracts deploy.
    function setPool(address pool_) external onlyOwner {
        if (pool != address(0)) revert Errors.PoolAlreadySet();
        if (pool_ == address(0)) revert Errors.ZeroAddress();
        pool = pool_;
        emit PoolSet(pool_);
    }

    function listAsset(
        address token,
        uint16 ltvBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps,
        uint16 reserveFactorBps
    ) external onlyOwner returns (uint256 assetId) {
        _validateRiskParams(ltvBps, liquidationThresholdBps);
        if (token == address(0)) revert Errors.ZeroAddress();

        assetId = assetCount++;
        _assets[assetId] = DataTypes.Asset({
            token: token,
            isSupported: true,
            ltvBps: ltvBps,
            liquidationThresholdBps: liquidationThresholdBps,
            liquidationBonusBps: liquidationBonusBps,
            reserveFactorBps: reserveFactorBps,
            totalSupplied: 0,
            totalBorrowed: 0
        });

        emit AssetListed(assetId, token, ltvBps, liquidationThresholdBps);
    }

    function updateRiskParams(
        uint256 assetId,
        uint16 ltvBps,
        uint16 liquidationThresholdBps,
        uint16 liquidationBonusBps,
        uint16 reserveFactorBps
    ) external onlyOwner {
        _validateRiskParams(ltvBps, liquidationThresholdBps);
        DataTypes.Asset storage asset = _requireListed(assetId);

        asset.ltvBps = ltvBps;
        asset.liquidationThresholdBps = liquidationThresholdBps;
        asset.liquidationBonusBps = liquidationBonusBps;
        asset.reserveFactorBps = reserveFactorBps;

        emit AssetParamsUpdated(assetId, ltvBps, liquidationThresholdBps, liquidationBonusBps, reserveFactorBps);
    }

    function setSupported(uint256 assetId, bool isSupported) external onlyOwner {
        _requireListed(assetId).isSupported = isSupported;
        emit AssetSupportToggled(assetId, isSupported);
    }

    function recordSupply(uint256 assetId, uint256 amount, bool increase) external onlyPool {
        DataTypes.Asset storage asset = _requireListed(assetId);
        if (increase) asset.totalSupplied += amount;
        else asset.totalSupplied -= amount;
    }

    function recordBorrow(uint256 assetId, uint256 amount, bool increase) external onlyPool {
        DataTypes.Asset storage asset = _requireListed(assetId);
        if (increase) asset.totalBorrowed += amount;
        else asset.totalBorrowed -= amount;
    }

    function getAsset(uint256 assetId) external view returns (DataTypes.Asset memory) {
        return _assets[assetId];
    }

    function requireSupported(uint256 assetId) external view returns (DataTypes.Asset memory asset) {
        asset = _assets[assetId];
        if (asset.token == address(0)) revert Errors.AssetNotListed();
        if (!asset.isSupported) revert Errors.AssetNotSupported();
    }

    function _requireListed(uint256 assetId) private view returns (DataTypes.Asset storage asset) {
        asset = _assets[assetId];
        if (asset.token == address(0)) revert Errors.AssetNotListed();
    }

    function _validateRiskParams(uint16 ltvBps, uint16 liquidationThresholdBps) private pure {
        if (liquidationThresholdBps > 10_000 || ltvBps >= liquidationThresholdBps) {
            revert Errors.InvalidRiskParams();
        }
    }
}
