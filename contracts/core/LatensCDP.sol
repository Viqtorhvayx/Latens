// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {AssetRegistry} from "./AssetRegistry.sol";
import {ProtocolTreasury} from "./ProtocolTreasury.sol";
import {LatensDollar} from "./LatensDollar.sol";
import {ICommitmentVerifier} from "../interfaces/ICommitmentVerifier.sol";
import {ISolvencyVerifier} from "../interfaces/ISolvencyVerifier.sol";
import {ILiquidationVerifier} from "../interfaces/ILiquidationVerifier.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {DataTypes} from "../libraries/DataTypes.sol";
import {Errors} from "../libraries/Errors.sol";

/// @title LatensCDP
/// @notice Confidential stablecoin minting: lock Pedersen-committed collateral, mint
/// `LatensDollar` against it. Same commitment/solvency-proof discipline as `LatensPool`.
contract LatensCDP is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRICE_STALENESS_WINDOW = 1 hours;
    uint256 public constant STABLECOIN_PRICE_E8 = 1e8; // LatensDollar is pegged to $1 by construction
    uint16 public constant MAX_MINT_FEE_BPS = 500; // 5% ceiling on the origination fee

    AssetRegistry public immutable registry;
    ProtocolTreasury public immutable treasury;
    LatensDollar public immutable latensDollar;
    IPriceOracle public priceOracle;
    ICommitmentVerifier public commitmentVerifier;
    ISolvencyVerifier public solvencyVerifier;
    ILiquidationVerifier public liquidationVerifier;

    uint16 public mintFeeBps;
    mapping(uint256 assetId => uint256) public totalCollateralLocked; // public aggregate, like AssetRegistry's
    uint256 public totalDebtMinted; // public aggregate

    mapping(address user => DataTypes.CDPPosition) public positions;

    event CDPCollateralUpdated(address indexed user, uint256 indexed assetId, uint256 newCommitment, bool isIncrease);
    event CDPDebtUpdated(address indexed user, uint256 newCommitment, bool isIncrease);
    event CDPLiquidated(
        address indexed user, address indexed liquidator, uint256 indexed collateralAssetId, uint256 seizedCollateralAmount, uint256 repayAmount
    );
    event MintFeeUpdated(uint16 bps);
    event VerifiersUpdated(address commitmentVerifier, address solvencyVerifier, address liquidationVerifier);
    event PriceOracleUpdated(address priceOracle);

    constructor(
        address initialOwner,
        AssetRegistry registry_,
        ProtocolTreasury treasury_,
        LatensDollar latensDollar_,
        IPriceOracle priceOracle_,
        ICommitmentVerifier commitmentVerifier_,
        ISolvencyVerifier solvencyVerifier_,
        ILiquidationVerifier liquidationVerifier_
    ) Ownable(initialOwner) {
        registry = registry_;
        treasury = treasury_;
        latensDollar = latensDollar_;
        priceOracle = priceOracle_;
        commitmentVerifier = commitmentVerifier_;
        solvencyVerifier = solvencyVerifier_;
        liquidationVerifier = liquidationVerifier_;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    function setMintFee(uint16 bps) external onlyOwner {
        if (bps > MAX_MINT_FEE_BPS) revert Errors.ExceedsMaxFee();
        mintFeeBps = bps;
        emit MintFeeUpdated(bps);
    }

    function setVerifiers(ICommitmentVerifier commitmentVerifier_, ISolvencyVerifier solvencyVerifier_, ILiquidationVerifier liquidationVerifier_)
        external
        onlyOwner
    {
        commitmentVerifier = commitmentVerifier_;
        solvencyVerifier = solvencyVerifier_;
        liquidationVerifier = liquidationVerifier_;
        emit VerifiersUpdated(address(commitmentVerifier_), address(solvencyVerifier_), address(liquidationVerifier_));
    }

    function setPriceOracle(IPriceOracle priceOracle_) external onlyOwner {
        priceOracle = priceOracle_;
        emit PriceOracleUpdated(address(priceOracle_));
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Collateral ───────────────────────────────────────────────────────────

    function supplyCollateral(uint256 assetId, uint256 amount, uint256 newCommitment, bytes calldata proof, uint256[] calldata publicInputs)
        external
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.Asset memory asset = registry.requireSupported(assetId);
        DataTypes.CDPPosition storage position = positions[msg.sender];

        if (!position.active) {
            position.active = true;
            position.collateralAssetId = assetId;
        } else if (position.collateralAssetId != assetId) {
            revert Errors.AssetNotSupported();
        }

        _verifyCommitmentUpdate({
            proof: proof,
            publicInputs: publicInputs,
            oldCommitment: position.collateralCommitment,
            newCommitment: newCommitment,
            delta: amount,
            isIncrease: true,
            assetId: assetId
        });

        IERC20(asset.token).safeTransferFrom(msg.sender, address(this), amount);

        position.collateralCommitment = newCommitment;
        position.lastUpdated = uint64(block.timestamp);
        totalCollateralLocked[assetId] += amount;

        emit CDPCollateralUpdated(msg.sender, assetId, newCommitment, true);
    }

    function withdrawCollateral(
        uint256 amount,
        uint256 newCommitment,
        bytes calldata updateProof,
        uint256[] calldata updatePublicInputs,
        bytes calldata solvencyProof,
        uint256[] calldata solvencyPublicInputs
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.CDPPosition storage position = positions[msg.sender];
        if (!position.active) revert Errors.AssetNotListed();

        DataTypes.Asset memory collateralAsset = registry.getAsset(position.collateralAssetId);

        _verifyCommitmentUpdate({
            proof: updateProof,
            publicInputs: updatePublicInputs,
            oldCommitment: position.collateralCommitment,
            newCommitment: newCommitment,
            delta: amount,
            isIncrease: false,
            assetId: position.collateralAssetId
        });

        if (position.hasDebt) {
            _verifySolvency({
                proof: solvencyProof,
                publicInputs: solvencyPublicInputs,
                collateralCommitment: newCommitment,
                debtCommitment: position.debtCommitment,
                collateralToken: collateralAsset.token,
                thresholdBps: collateralAsset.ltvBps
            });
        }

        position.collateralCommitment = newCommitment;
        position.lastUpdated = uint64(block.timestamp);
        totalCollateralLocked[position.collateralAssetId] -= amount;

        IERC20(collateralAsset.token).safeTransfer(msg.sender, amount);

        emit CDPCollateralUpdated(msg.sender, position.collateralAssetId, newCommitment, false);
    }

    // ── Stablecoin ───────────────────────────────────────────────────────────

    function mint(
        uint256 amount,
        uint256 newCommitment,
        bytes calldata updateProof,
        uint256[] calldata updatePublicInputs,
        bytes calldata solvencyProof,
        uint256[] calldata solvencyPublicInputs
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.CDPPosition storage position = positions[msg.sender];
        if (!position.active) revert Errors.AssetNotListed();

        DataTypes.Asset memory collateralAsset = registry.getAsset(position.collateralAssetId);

        _verifyCommitmentUpdate({
            proof: updateProof,
            publicInputs: updatePublicInputs,
            oldCommitment: position.debtCommitment,
            newCommitment: newCommitment,
            delta: amount,
            isIncrease: true,
            assetId: position.collateralAssetId
        });

        position.hasDebt = true;
        _verifySolvency({
            proof: solvencyProof,
            publicInputs: solvencyPublicInputs,
            collateralCommitment: position.collateralCommitment,
            debtCommitment: newCommitment,
            collateralToken: collateralAsset.token,
            thresholdBps: collateralAsset.ltvBps
        });

        position.debtCommitment = newCommitment;
        position.lastUpdated = uint64(block.timestamp);
        totalDebtMinted += amount;

        uint256 fee = (amount * mintFeeBps) / 10_000;
        latensDollar.mint(msg.sender, amount - fee);
        if (fee > 0) latensDollar.mint(address(treasury), fee);

        emit CDPDebtUpdated(msg.sender, newCommitment, true);
    }

    function burn(uint256 amount, uint256 newCommitment, bytes calldata updateProof, uint256[] calldata updatePublicInputs)
        external
        whenNotPaused
        nonReentrant
    {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.CDPPosition storage position = positions[msg.sender];
        if (!position.active || !position.hasDebt) revert Errors.AssetNotListed();

        _verifyCommitmentUpdate({
            proof: updateProof,
            publicInputs: updatePublicInputs,
            oldCommitment: position.debtCommitment,
            newCommitment: newCommitment,
            delta: amount,
            isIncrease: false,
            assetId: position.collateralAssetId
        });

        position.debtCommitment = newCommitment;
        position.lastUpdated = uint64(block.timestamp);
        totalDebtMinted -= amount;

        latensDollar.burn(msg.sender, amount);

        emit CDPDebtUpdated(msg.sender, newCommitment, false);
    }

    // ── Liquidation ──────────────────────────────────────────────────────────

    function liquidate(
        address user,
        uint256 repayAmount,
        uint256 seizedCollateralAmount,
        uint256 newCollateralCommitment,
        uint256 newDebtCommitment,
        bytes calldata eligibilityProof,
        uint256[] calldata eligibilityPublicInputs
    ) external whenNotPaused nonReentrant {
        if (repayAmount == 0 || seizedCollateralAmount == 0) revert Errors.ZeroAmount();
        DataTypes.CDPPosition storage position = positions[user];
        if (!position.active || !position.hasDebt) revert Errors.AssetNotListed();

        DataTypes.Asset memory collateralAsset = registry.getAsset(position.collateralAssetId);

        (uint256 collateralPriceE8, uint256 collateralUpdatedAt) = priceOracle.getPrice(collateralAsset.token);
        _requireFreshPrice(collateralUpdatedAt);

        if (eligibilityPublicInputs.length < 10) revert Errors.InvalidProof();
        _requireEq(eligibilityPublicInputs[0], position.collateralCommitment);
        _requireEq(eligibilityPublicInputs[1], position.debtCommitment);
        _requireEq(eligibilityPublicInputs[2], newCollateralCommitment);
        _requireEq(eligibilityPublicInputs[3], newDebtCommitment);
        _requireEq(eligibilityPublicInputs[4], collateralPriceE8);
        _requireEq(eligibilityPublicInputs[5], STABLECOIN_PRICE_E8);
        _requireEq(eligibilityPublicInputs[6], collateralAsset.liquidationThresholdBps);
        _requireEq(eligibilityPublicInputs[7], collateralAsset.liquidationBonusBps);
        _requireEq(eligibilityPublicInputs[8], seizedCollateralAmount);
        _requireEq(eligibilityPublicInputs[9], repayAmount);

        if (!liquidationVerifier.verifyLiquidationEligibility(eligibilityProof, eligibilityPublicInputs)) {
            revert Errors.InvalidProof();
        }

        position.collateralCommitment = newCollateralCommitment;
        position.debtCommitment = newDebtCommitment;
        position.lastUpdated = uint64(block.timestamp);

        totalCollateralLocked[position.collateralAssetId] -= seizedCollateralAmount;
        totalDebtMinted -= repayAmount;

        latensDollar.burn(msg.sender, repayAmount);
        IERC20(collateralAsset.token).safeTransfer(msg.sender, seizedCollateralAmount);

        emit CDPLiquidated(user, msg.sender, position.collateralAssetId, seizedCollateralAmount, repayAmount);
    }

    // ── Internal proof plumbing ──────────────────────────────────────────────

    function _verifyCommitmentUpdate(
        bytes calldata proof,
        uint256[] calldata publicInputs,
        uint256 oldCommitment,
        uint256 newCommitment,
        uint256 delta,
        bool isIncrease,
        uint256 assetId
    ) private view {
        if (publicInputs.length < 5) revert Errors.InvalidProof();
        _requireEq(publicInputs[0], oldCommitment);
        _requireEq(publicInputs[1], newCommitment);
        _requireEq(publicInputs[2], delta);
        _requireEq(publicInputs[3], isIncrease ? 1 : 0);
        _requireEq(publicInputs[4], assetId);

        if (!commitmentVerifier.verifyCommitmentUpdate(proof, publicInputs)) revert Errors.InvalidProof();
    }

    function _verifySolvency(
        bytes calldata proof,
        uint256[] calldata publicInputs,
        uint256 collateralCommitment,
        uint256 debtCommitment,
        address collateralToken,
        uint16 thresholdBps
    ) private view {
        (uint256 collateralPriceE8, uint256 collateralUpdatedAt) = priceOracle.getPrice(collateralToken);
        _requireFreshPrice(collateralUpdatedAt);

        if (publicInputs.length < 5) revert Errors.InvalidProof();
        _requireEq(publicInputs[0], collateralCommitment);
        _requireEq(publicInputs[1], debtCommitment);
        _requireEq(publicInputs[2], collateralPriceE8);
        _requireEq(publicInputs[3], STABLECOIN_PRICE_E8);
        _requireEq(publicInputs[4], thresholdBps);

        if (!solvencyVerifier.verifySolvency(proof, publicInputs)) revert Errors.InvalidProof();
    }

    function _requireFreshPrice(uint256 updatedAt) private view {
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > PRICE_STALENESS_WINDOW) revert Errors.StaleOraclePrice();
    }

    function _requireEq(uint256 a, uint256 b) private pure {
        if (a != b) revert Errors.InvalidProof();
    }
}
