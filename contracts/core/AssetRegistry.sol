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
    mapping(uint256 assetId => uint256) private _supplyIndexRay;
    mapping(uint256 assetId => uint64) private _indexLastAccrued;

    event PoolSet(address indexed pool);
    event AssetListed(uint256 indexed assetId, address indexed token, uint16 ltvBps, uint16 liquidationThresholdBps);
    event AssetParamsUpdated(
        uint256 indexed assetId, uint16 ltvBps, uint16 liquidationThresholdBps, uint16 liquidationBonusBps, uint16 reserveFactorBps
    );
    event AssetSupportToggled(uint256 indexed assetId, bool isSupported);
    event InterestRateModelUpdated(uint256 indexed assetId, uint16 baseRateBps, uint16 slope1Bps, uint16 slope2Bps, uint16 kinkBps);

    uint256 private constant BPS_DENOMINATOR = 10_000;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant RAY = 1e18;

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

        _supplyIndexRay[assetId] = RAY;
        _indexLastAccrued[assetId] = uint64(block.timestamp);

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

    function utilizationBps(uint256 assetId) public view returns (uint256) {
        DataTypes.Asset storage asset = _requireListed(assetId);
        if (asset.totalSupplied == 0) return 0;
        return (asset.totalBorrowed * BPS_DENOMINATOR) / asset.totalSupplied;
    }

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

    /// @notice The rate suppliers actually earn, RAY-scaled (1e18 = 100% per year).
    /// @dev This is the authoritative supply rate; `supplyRateBps` below is a rounded view
    /// of it. Basis points cannot carry this number: a supply rate is a borrow rate scaled
    /// down TWICE, once by utilization and once by the reserve factor, so at any realistic
    /// early-market utilization it lands well below one basis point and integer division
    /// floors it to zero. A market at 0.4% utilization against a 2.05% borrow rate earns
    /// suppliers 0.0074% per year, which in bps is 0 — and a zero rate here doesn't merely
    /// display wrong, it freezes `currentSupplyIndexRay` outright, so suppliers genuinely
    /// accrue nothing until utilization climbs far enough for the truncation to stop
    /// biting. Same formula, kept at 1e18 so the small numbers survive.
    function supplyRateRay(uint256 assetId) public view returns (uint256) {
        DataTypes.Asset storage asset = _requireListed(assetId);
        uint256 borrowRateRay = (borrowRateBps(assetId) * RAY) / BPS_DENOMINATOR;
        uint256 grossRateRay = (borrowRateRay * utilizationBps(assetId)) / BPS_DENOMINATOR;
        return (grossRateRay * (BPS_DENOMINATOR - asset.reserveFactorBps)) / BPS_DENOMINATOR;
    }

    /// @notice `supplyRateRay` rounded to basis points, for callers that want the headline
    /// figure. Reads 0 whenever the true rate is under a basis point, which is exactly the
    /// rounding `supplyRateRay` exists to avoid applying to the index itself.
    function supplyRateBps(uint256 assetId) public view returns (uint256) {
        return (supplyRateRay(assetId) * BPS_DENOMINATOR) / RAY;
    }

    function quoteRepayInterestFee(uint256 assetId, uint256 repayAmount, uint64 sinceTimestamp) external view returns (uint256) {
        if (block.timestamp <= sinceTimestamp) return 0;
        uint256 elapsed = block.timestamp - sinceTimestamp;
        return (repayAmount * borrowRateBps(assetId) * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    /// @notice The live conversion rate between a collateral share (what position
    /// commitments actually encode) and the underlying token, RAY-scaled (1e18 = 1:1).
    /// Grows continuously at `supplyRateRay` — real, compounding yield for whoever holds
    /// the shares, funded by the supplier-side cut of `LatensPool.repay`'s interest.
    function currentSupplyIndexRay(uint256 assetId) public view returns (uint256) {
        _requireListed(assetId);
        uint256 elapsed = block.timestamp - _indexLastAccrued[assetId];
        uint256 index = _supplyIndexRay[assetId];
        return index + (index * supplyRateRay(assetId) * elapsed) / (RAY * SECONDS_PER_YEAR);
    }

    function recordSupply(uint256 assetId, uint256 amount, bool increase) external onlyPool {
        DataTypes.Asset storage asset = _requireListed(assetId);
        _checkpointSupplyIndex(assetId);
        if (increase) asset.totalSupplied += amount;
        else asset.totalSupplied -= amount;
    }

    /// @notice Books protocol-owned liquidity (e.g. tokens transferred to the pool directly,
    /// outside any user's `supplyCollateral`) into `totalSupplied`, so utilization, borrow
    /// APR, and supply APY correctly reflect it. Unlike a real supply, this is not backed by
    /// any user position or share commitment — there's no share ledger in this contract for
    /// it to disturb — it exists purely so seed liquidity isn't invisible to those aggregates.
    function seedTotalSupplied(uint256 assetId, uint256 amount) external onlyOwner {
        DataTypes.Asset storage asset = _requireListed(assetId);
        _checkpointSupplyIndex(assetId);
        asset.totalSupplied += amount;
    }

    function recordBorrow(uint256 assetId, uint256 amount, bool increase) external onlyPool {
        DataTypes.Asset storage asset = _requireListed(assetId);
        _checkpointSupplyIndex(assetId);
        if (increase) asset.totalBorrowed += amount;
        else asset.totalBorrowed -= amount;
    }

    /// @dev Must run BEFORE the caller applies its totalSupplied/totalBorrowed delta — the
    /// elapsed period being checkpointed accrued at the utilization/rate that held during
    /// that period, not the one about to take effect.
    function _checkpointSupplyIndex(uint256 assetId) private {
        _supplyIndexRay[assetId] = currentSupplyIndexRay(assetId);
        _indexLastAccrued[assetId] = uint64(block.timestamp);
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
