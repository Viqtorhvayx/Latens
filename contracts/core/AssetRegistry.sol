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
    event InterestRateModelUpdated(uint256 indexed assetId, uint16 baseRateBps, uint16 slope1Bps, uint16 slope2Bps, uint16 kinkBps);

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;

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
            totalBorrowed: 0,
            baseRateBps: 0,
            slope1Bps: 0,
            slope2Bps: 0,
            kinkBps: 0
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

    /// @notice Configures the kinked interest rate model used by `borrowRateBps` /
    /// `supplyRateBps` / `quoteRepayInterestFee`. `kinkBps` must sit strictly between 0 and
    /// 10000 — the point past which `slope2Bps` (steeper) applies instead of `slope1Bps`.
    function setInterestRateModel(uint256 assetId, uint16 baseRateBps, uint16 slope1Bps, uint16 slope2Bps, uint16 kinkBps)
        external
        onlyOwner
    {
        if (kinkBps == 0 || kinkBps >= BPS_DENOMINATOR) revert Errors.InvalidRiskParams();
        DataTypes.Asset storage asset = _requireListed(assetId);
        asset.baseRateBps = baseRateBps;
        asset.slope1Bps = slope1Bps;
        asset.slope2Bps = slope2Bps;
        asset.kinkBps = kinkBps;
        emit InterestRateModelUpdated(assetId, baseRateBps, slope1Bps, slope2Bps, kinkBps);
    }

    /// @notice Share of `assetId`'s supplied liquidity currently borrowed out, in bps.
    function utilizationBps(uint256 assetId) public view returns (uint256) {
        DataTypes.Asset storage asset = _requireListed(assetId);
        if (asset.totalSupplied == 0) return 0;
        return (asset.totalBorrowed * BPS_DENOMINATOR) / asset.totalSupplied;
    }

    /// @notice The market's current instantaneous borrow rate, annualized, in bps —
    /// `baseRateBps` at 0% utilization, rising by `slope1Bps` up to `kinkBps` utilization,
    /// then by the steeper `slope2Bps` beyond it. Returns 0 if no model is configured.
    function borrowRateBps(uint256 assetId) public view returns (uint256) {
        DataTypes.Asset storage asset = _requireListed(assetId);
        if (asset.kinkBps == 0) return 0;
        uint256 utilization = utilizationBps(assetId);
        if (utilization <= asset.kinkBps) {
            return asset.baseRateBps + (utilization * asset.slope1Bps) / asset.kinkBps;
        }
        uint256 excessUtilization = utilization - asset.kinkBps;
        return asset.baseRateBps + asset.slope1Bps + (excessUtilization * asset.slope2Bps) / (BPS_DENOMINATOR - asset.kinkBps);
    }

    /// @notice The rate, annualized in bps, at which this market currently generates
    /// protocol revenue (interest collected at repay time, net of `reserveFactorBps`,
    /// funding the treasury / ZEN staking pool — see LatensPool.repay). This is NOT a
    /// yield paid to individual suppliers: their commitment amounts cannot grow without
    /// revealing them, so pass-through supply yield needs a future circuit upgrade (see
    /// contracts/README.md). It is a real, live, utilization-driven number, not a
    /// placeholder.
    function supplyRateBps(uint256 assetId) public view returns (uint256) {
        DataTypes.Asset storage asset = _requireListed(assetId);
        uint256 grossRate = (borrowRateBps(assetId) * utilizationBps(assetId)) / BPS_DENOMINATOR;
        return (grossRate * (BPS_DENOMINATOR - asset.reserveFactorBps)) / BPS_DENOMINATOR;
    }

    /// @notice Quotes the interest fee LatensPool.repay charges on top of `repayAmount`,
    /// approximating simple interest at the market's CURRENT spot rate over the exact
    /// elapsed time since `sinceTimestamp` (a position's own `debtLastUpdated`). This uses
    /// the rate at quote time for the whole window rather than a time-integrated index —
    /// exact when a position borrows once and repays once, an approximation when a
    /// position's debt is touched more than twice.
    function quoteRepayInterestFee(uint256 assetId, uint256 repayAmount, uint64 sinceTimestamp) external view returns (uint256) {
        if (block.timestamp <= sinceTimestamp) return 0;
        uint256 elapsed = block.timestamp - sinceTimestamp;
        return (repayAmount * borrowRateBps(assetId) * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
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
