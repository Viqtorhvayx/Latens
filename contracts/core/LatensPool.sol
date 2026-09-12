// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {AssetRegistry} from "./AssetRegistry.sol";
import {ProtocolTreasury} from "./ProtocolTreasury.sol";
import {ICommitmentVerifier} from "../interfaces/ICommitmentVerifier.sol";
import {ISolvencyVerifier} from "../interfaces/ISolvencyVerifier.sol";
import {ILiquidationVerifier} from "../interfaces/ILiquidationVerifier.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {DataTypes} from "../libraries/DataTypes.sol";
import {Errors} from "../libraries/Errors.sol";

/// @title LatensPool
/// @notice Confidential borrow-lend market for Horizen. Individual position sizes are never
/// stored or read in the clear — only commitments — and every state transition requires a
/// zk-SNARK proof that the arithmetic was done correctly. Market-level aggregates and prices
/// are public by design (see `AssetRegistry`); what Latens hides is who holds how much.
///
/// @dev THREAT MODEL, STATED PLAINLY (this is the honest version of the homepage copy):
///  - The ERC20 transfer that funds a deposit/borrow/repay is visible on a public L3 like any
///    other transaction — Latens does not hide transaction-level amounts or timing.
///  - What stays private is RESTING POSITION STATE: nobody but the position's owner (who
///    holds the commitment's opening) can read how much collateral or debt an address has,
///    before liquidation. `CollateralUpdated`/`DebtUpdated` deliberately carry no delta
///    `amount` — summing one address's own event history must not recover its running
///    total. An owner gets their own delta history from `publishViewingNote` or their own
///    client-side records, never from a public event.
///  - At liquidation, `seizedCollateralAmount` and `repayAmount` become public — see
///    `ILiquidationVerifier`'s dev note. Keeping even that private is open design space for
///    a later milestone, not something this scaffold claims to have solved.
///  - Interest is real and utilization-driven (see `AssetRegistry.borrowRateBps`), settled
///    at `repay` time against the position's COLLATERAL rather than the borrowed asset, so a
///    borrower repays exactly the principal they drew. Suppliers earn the matching side of it
///    through `AssetRegistry.currentSupplyIndexRay`.
///  - Every zk proof is checked through a pluggable verifier interface; `MockVerifier` is
///    a development stand-in and must never be wired in production.
contract LatensPool is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant PRICE_STALENESS_WINDOW = 1 hours;
    uint256 private constant RAY = 1e18;
    uint256 private constant BPS_DENOMINATOR = 10_000;

    AssetRegistry public immutable registry;
    ProtocolTreasury public immutable treasury;
    IPriceOracle public priceOracle;
    ICommitmentVerifier public commitmentVerifier;
    ISolvencyVerifier public solvencyVerifier;
    ILiquidationVerifier public liquidationVerifier;

    mapping(address user => DataTypes.Position) public positions;

    /// @dev No `amount` field — see the THREAT MODEL note above.
    event CollateralUpdated(address indexed user, uint256 indexed assetId, uint256 newCommitment, bool isIncrease);
    event DebtUpdated(address indexed user, uint256 indexed assetId, uint256 newCommitment, bool isIncrease);
    event Liquidated(
        address indexed user,
        address indexed liquidator,
        uint256 indexed collateralAssetId,
        uint256 debtAssetId,
        uint256 seizedCollateralAmount,
        uint256 repayAmount
    );
    event VerifiersUpdated(address commitmentVerifier, address solvencyVerifier, address liquidationVerifier);
    event PriceOracleUpdated(address priceOracle);
    /// @notice A position owner's self-encrypted opening of one of their own commitments,
    /// published as a standing viewing key note — see `publishViewingNote`.
    event ViewingNotePublished(address indexed user, uint256 indexed assetId, bool isDebt, uint256 timestamp, bytes ciphertext);

    constructor(
        address initialOwner,
        AssetRegistry registry_,
        ProtocolTreasury treasury_,
        IPriceOracle priceOracle_,
        ICommitmentVerifier commitmentVerifier_,
        ISolvencyVerifier solvencyVerifier_,
        ILiquidationVerifier liquidationVerifier_
    ) Ownable(initialOwner) {
        registry = registry_;
        treasury = treasury_;
        priceOracle = priceOracle_;
        commitmentVerifier = commitmentVerifier_;
        solvencyVerifier = solvencyVerifier_;
        liquidationVerifier = liquidationVerifier_;
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    /// @notice Swaps the verifying contracts. Gated to the owner because a malicious
    /// verifier can forge proofs of solvency — this is as security-critical as upgrading
    /// the pool's logic itself, and should sit behind the same governance process as the
    /// Foundation's milestone-acceptance authority described in the grant terms.
    function setVerifiers(
        ICommitmentVerifier commitmentVerifier_,
        ISolvencyVerifier solvencyVerifier_,
        ILiquidationVerifier liquidationVerifier_
    ) external onlyOwner {
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

    /// @param assetId market to supply collateral into.
    /// @param amount ERC20 amount to pull from the caller (public — see the threat model note).
    /// @param newCommitment the position's new collateral commitment.
    /// @param proof zk proof that `newCommitment` correctly encodes `oldAmount + amount`.
    /// @param publicInputs see `ICommitmentVerifier` for the illustrative layout.
    function supplyCollateral(
        uint256 assetId,
        uint256 amount,
        uint256 newCommitment,
        bytes calldata proof,
        uint256[] calldata publicInputs
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.Asset memory asset = registry.requireSupported(assetId);
        DataTypes.Position storage position = positions[msg.sender];

        if (!position.active) {
            position.active = true;
            position.collateralAssetId = assetId;
        } else if (position.collateralAssetId != assetId) {
            revert Errors.AssetNotSupported(); // this scaffold is single-collateral per position
        }

        uint256 shareDelta = (amount * RAY) / registry.currentSupplyIndexRay(assetId);

        _verifyShareUpdate({
            proof: proof,
            publicInputs: publicInputs,
            oldCommitment: position.collateralCommitment,
            newCommitment: newCommitment,
            maxDelta: shareDelta,
            isIncrease: true,
            assetId: assetId
        });

        IERC20(asset.token).safeTransferFrom(msg.sender, address(this), amount);

        position.collateralCommitment = newCommitment;
        position.lastUpdated = uint64(block.timestamp);
        registry.recordSupply(assetId, amount, true);

        emit CollateralUpdated(msg.sender, assetId, newCommitment, true);
    }

    /// @param amount ERC20 amount to return to the caller.
    /// @param newCommitment the position's new collateral commitment, post-withdrawal.
    /// @param updateProof proof that `newCommitment` correctly encodes `oldAmount - amount`.
    /// @param updatePublicInputs see `ICommitmentVerifier`.
    /// @param solvencyProof proof the position stays above LTV after withdrawal, if it carries debt.
    /// @param solvencyPublicInputs see `ISolvencyVerifier`.
    function withdrawCollateral(
        uint256 amount,
        uint256 newCommitment,
        bytes calldata updateProof,
        uint256[] calldata updatePublicInputs,
        bytes calldata solvencyProof,
        uint256[] calldata solvencyPublicInputs
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.Position storage position = positions[msg.sender];
        if (!position.active) revert Errors.AssetNotListed();

        // Collateral is locked for as long as the position owes anything. Deciding whether a
        // PARTIAL withdrawal leaves a position solvent needs the collateral total, which is
        // exactly what this protocol keeps hidden — it is knowable only inside the solvency
        // circuit, and this deployment's verifier is a permissive mock that will wave any
        // proof through. Until real proving is wired, the honest enforcement is the blunt
        // one: repay first, then withdraw. Without it a borrower can empty their collateral
        // while still owing, which also strands `repay`, since the fee it settles has
        // nothing left to come out of.
        if (position.hasDebt) revert Errors.OutstandingDebt();

        DataTypes.Asset memory collateralAsset = registry.getAsset(position.collateralAssetId);
        uint256 collateralIndexRay = registry.currentSupplyIndexRay(position.collateralAssetId);
        uint256 shareDelta = (amount * RAY) / collateralIndexRay;

        _verifyShareBurn({
            proof: updateProof,
            publicInputs: updatePublicInputs,
            oldCommitment: position.collateralCommitment,
            newCommitment: newCommitment,
            minDelta: shareDelta,
            assetId: position.collateralAssetId
        });

        if (position.hasDebt) {
            DataTypes.Asset memory debtAsset = registry.getAsset(position.debtAssetId);
            _verifySolvency({
                proof: solvencyProof,
                publicInputs: solvencyPublicInputs,
                collateralCommitment: newCommitment,
                debtCommitment: position.debtCommitment,
                collateralToken: collateralAsset.token,
                debtToken: debtAsset.token,
                collateralIndexRay: collateralIndexRay,
                debtIndexRay: RAY,
                thresholdBps: collateralAsset.ltvBps
            });
        }

        position.collateralCommitment = newCommitment;
        position.lastUpdated = uint64(block.timestamp);
        registry.recordSupply(position.collateralAssetId, amount, false);

        IERC20(collateralAsset.token).safeTransfer(msg.sender, amount);

        emit CollateralUpdated(msg.sender, position.collateralAssetId, newCommitment, false);
    }

    // ── Debt ─────────────────────────────────────────────────────────────────

    function borrow(
        uint256 debtAssetId,
        uint256 amount,
        uint256 newCommitment,
        bytes calldata updateProof,
        uint256[] calldata updatePublicInputs,
        bytes calldata solvencyProof,
        uint256[] calldata solvencyPublicInputs
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.Position storage position = positions[msg.sender];
        if (!position.active) revert Errors.AssetNotListed();

        DataTypes.Asset memory debtAsset = registry.requireSupported(debtAssetId);
        DataTypes.Asset memory collateralAsset = registry.getAsset(position.collateralAssetId);

        if (!position.hasDebt) {
            position.hasDebt = true;
            position.debtAssetId = debtAssetId;
        } else if (position.debtAssetId != debtAssetId) {
            revert Errors.AssetNotSupported(); // single debt asset per position in this scaffold
        }

        _verifyCommitmentUpdate({
            proof: updateProof,
            publicInputs: updatePublicInputs,
            oldCommitment: position.debtCommitment,
            newCommitment: newCommitment,
            delta: amount,
            isIncrease: true,
            assetId: debtAssetId
        });

        _verifySolvency({
            proof: solvencyProof,
            publicInputs: solvencyPublicInputs,
            collateralCommitment: position.collateralCommitment,
            debtCommitment: newCommitment,
            collateralToken: collateralAsset.token,
            debtToken: debtAsset.token,
            collateralIndexRay: registry.currentSupplyIndexRay(position.collateralAssetId),
            debtIndexRay: RAY,
            thresholdBps: collateralAsset.ltvBps
        });

        position.debtCommitment = newCommitment;
        position.lastUpdated = uint64(block.timestamp);
        position.debtLastUpdated = uint64(block.timestamp);
        registry.recordBorrow(debtAssetId, amount, true);

        IERC20(debtAsset.token).safeTransfer(msg.sender, amount);

        emit DebtUpdated(msg.sender, debtAssetId, newCommitment, true);
    }

    /// @notice Repays `amount` of the borrowed asset, exactly. The interest owed on it is
    /// settled against the position's COLLATERAL rather than taken as a second helping of
    /// the borrowed token.
    ///
    /// @dev Charging interest in the borrowed asset made a loan impossible to close: a
    /// borrower who draws 20 ZEN holds exactly 20 ZEN, and clearing the debt then costs
    /// 20 ZEN plus a fee they have no way to fund short of acquiring more of the asset they
    /// just borrowed. Debt sizes are confidential, so there is also no way to quietly grow
    /// the debt commitment by the fee instead. Collateral is the one balance a borrower is
    /// guaranteed to have already posted, so that is what the fee comes out of, and a
    /// repayment of the full principal now closes the position in one call.
    ///
    /// The fee is converted from the debt asset into the collateral asset at oracle prices
    /// and then into collateral shares, so all three of those inputs move between reading
    /// and mining. `_verifyShareBurn` takes it as a floor rather than an equality for that
    /// reason: the caller may burn MORE collateral than the fee strictly requires, never
    /// less, so drift costs the borrower dust and can never shortchange the pool.
    ///
    /// No solvency proof is required here even though collateral shrinks: `amount` of debt
    /// is retired against an interest charge that is a small fraction of it, so the
    /// position's collateral-to-debt ratio can only improve.
    /// @param amount the debt token amount to repay.
    /// @param newDebtCommitment the debt commitment after `amount` is retired.
    /// @param debtProof proof that `newDebtCommitment` encodes oldDebt - amount.
    /// @param debtPublicInputs see `ICommitmentVerifier`.
    /// @param newCollateralCommitment the collateral commitment after the fee is deducted.
    /// @param collateralProof proof that `newCollateralCommitment` encodes the reduced collateral.
    /// @param collateralPublicInputs see `ICommitmentVerifier`.
    function repay(
        uint256 amount,
        uint256 newDebtCommitment,
        bytes calldata debtProof,
        uint256[] calldata debtPublicInputs,
        uint256 newCollateralCommitment,
        bytes calldata collateralProof,
        uint256[] calldata collateralPublicInputs,
        bool closesDebt
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert Errors.ZeroAmount();
        DataTypes.Position storage position = positions[msg.sender];
        if (!position.active || !position.hasDebt) revert Errors.AssetNotListed();

        DataTypes.Asset memory debtAsset = registry.getAsset(position.debtAssetId);
        DataTypes.Asset memory collateralAsset = registry.getAsset(position.collateralAssetId);

        (uint256 interestInCollateral, uint256 interestShares) =
            _interestAsCollateral(position.debtAssetId, position.collateralAssetId, debtAsset.token, collateralAsset.token, amount, position.debtLastUpdated);

        _verifyCommitmentUpdate({
            proof: debtProof,
            publicInputs: debtPublicInputs,
            oldCommitment: position.debtCommitment,
            newCommitment: newDebtCommitment,
            delta: amount,
            isIncrease: false,
            assetId: position.debtAssetId
        });

        _verifyShareBurn({
            proof: collateralProof,
            publicInputs: collateralPublicInputs,
            oldCommitment: position.collateralCommitment,
            newCommitment: newCollateralCommitment,
            minDelta: interestShares,
            assetId: position.collateralAssetId
        });

        position.debtCommitment = newDebtCommitment;
        position.collateralCommitment = newCollateralCommitment;
        position.lastUpdated = uint64(block.timestamp);
        position.debtLastUpdated = uint64(block.timestamp);
        // Whether a repayment leaves nothing owed is a fact about a hidden amount, so the
        // caller asserts it and `newDebtCommitment` is what a real commitment_update proof
        // would have to open to zero for the claim to stand. It matters because collateral
        // stays locked while `hasDebt` is set: without a way to clear the flag, paying a
        // loan off in full would leave the collateral stranded forever.
        if (closesDebt) {
            position.hasDebt = false;
        }
        registry.recordBorrow(position.debtAssetId, amount, false);

        // Exactly the principal, and nothing more, leaves the borrower's wallet.
        IERC20(debtAsset.token).safeTransferFrom(msg.sender, address(this), amount);

        // The fee never moves as a transfer from the borrower: the collateral backing it is
        // already held here, and burning the shares is what hands it over. Only the reserve
        // share actually leaves, so only that decrements the market's supplied aggregate;
        // the remainder stays put, which is what pays the market's other suppliers.
        if (interestInCollateral > 0) {
            uint256 reserveCut = (interestInCollateral * collateralAsset.reserveFactorBps) / BPS_DENOMINATOR;
            if (reserveCut > 0) {
                registry.recordSupply(position.collateralAssetId, reserveCut, false);
                IERC20(collateralAsset.token).safeTransfer(address(treasury), reserveCut);
            }
        }

        emit DebtUpdated(msg.sender, position.debtAssetId, newDebtCommitment, false);
    }

    /// @dev The interest owed on `amount`, expressed in the collateral asset and in the
    /// collateral shares a position commitment actually encodes. Split out to keep `repay`
    /// under the stack limit.
    function _interestAsCollateral(
        uint256 debtAssetId,
        uint256 collateralAssetId,
        address debtToken,
        address collateralToken,
        uint256 amount,
        uint64 debtLastUpdated
    ) private view returns (uint256 interestInCollateral, uint256 interestShares) {
        uint256 interestFee = registry.quoteRepayInterestFee(debtAssetId, amount, debtLastUpdated);
        if (interestFee == 0) return (0, 0);

        (uint256 debtPriceE8, uint256 debtUpdatedAt) = priceOracle.getPrice(debtToken);
        (uint256 collateralPriceE8, uint256 collateralUpdatedAt) = priceOracle.getPrice(collateralToken);
        _requireFreshPrice(debtUpdatedAt);
        _requireFreshPrice(collateralUpdatedAt);
        if (collateralPriceE8 == 0) revert Errors.StaleOraclePrice();

        // Normalized through USD rather than compared raw: the two assets rarely share
        // decimals, and multiplying base units by a price without dividing by the token's
        // own scale silently favours whichever side carries more of them.
        uint256 interestValueE8 = (interestFee * debtPriceE8) / (10 ** IERC20Metadata(debtToken).decimals());
        interestInCollateral = (interestValueE8 * (10 ** IERC20Metadata(collateralToken).decimals())) / collateralPriceE8;
        interestShares = (interestInCollateral * RAY) / registry.currentSupplyIndexRay(collateralAssetId);
    }

    // ── Liquidation ──────────────────────────────────────────────────────────

    /// @notice Repays part of `user`'s debt and seizes collateral plus the configured
    /// liquidation bonus, per `eligibilityProof`. See `ILiquidationVerifier` for the honest
    /// account of what stays private here and what doesn't.
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
        DataTypes.Position storage position = positions[user];
        if (!position.active || !position.hasDebt) revert Errors.AssetNotListed();

        DataTypes.Asset memory collateralAsset = registry.getAsset(position.collateralAssetId);
        DataTypes.Asset memory debtAsset = registry.getAsset(position.debtAssetId);

        (uint256 collateralPriceE8, uint256 collateralUpdatedAt) = priceOracle.getPrice(collateralAsset.token);
        (uint256 debtPriceE8, uint256 debtUpdatedAt) = priceOracle.getPrice(debtAsset.token);
        _requireFreshPrice(collateralUpdatedAt);
        _requireFreshPrice(debtUpdatedAt);

        uint256 collateralIndexRay = registry.currentSupplyIndexRay(position.collateralAssetId);

        if (eligibilityPublicInputs.length < 12) revert Errors.InvalidProof();
        _requireEq(eligibilityPublicInputs[0], position.collateralCommitment);
        _requireEq(eligibilityPublicInputs[1], position.debtCommitment);
        _requireEq(eligibilityPublicInputs[2], newCollateralCommitment);
        _requireEq(eligibilityPublicInputs[3], newDebtCommitment);
        _requireEq(eligibilityPublicInputs[4], collateralPriceE8);
        _requireEq(eligibilityPublicInputs[5], debtPriceE8);
        _requireEq(eligibilityPublicInputs[6], collateralIndexRay);
        _requireEq(eligibilityPublicInputs[7], RAY);
        _requireEq(eligibilityPublicInputs[8], collateralAsset.liquidationThresholdBps);
        _requireEq(eligibilityPublicInputs[9], collateralAsset.liquidationBonusBps);
        _requireEq(eligibilityPublicInputs[10], seizedCollateralAmount);
        _requireEq(eligibilityPublicInputs[11], repayAmount);

        if (!liquidationVerifier.verifyLiquidationEligibility(eligibilityProof, eligibilityPublicInputs)) {
            revert Errors.InvalidProof();
        }

        position.collateralCommitment = newCollateralCommitment;
        position.debtCommitment = newDebtCommitment;
        position.lastUpdated = uint64(block.timestamp);

        registry.recordSupply(position.collateralAssetId, seizedCollateralAmount, false);
        registry.recordBorrow(position.debtAssetId, repayAmount, false);

        IERC20(debtAsset.token).safeTransferFrom(msg.sender, address(this), repayAmount);
        IERC20(collateralAsset.token).safeTransfer(msg.sender, seizedCollateralAmount);

        emit Liquidated(user, msg.sender, position.collateralAssetId, position.debtAssetId, seizedCollateralAmount, repayAmount);
    }

    // ── Standing viewing key ─────────────────────────────────────────────────

    /// @notice Publishes a self-encrypted opening of `msg.sender`'s own commitment for
    /// `assetId`/`isDebt`, as an event log entry only — no state is read or written, so this
    /// can never affect accounting, solvency, or any other invariant.
    ///
    /// This is the standing-viewing-key upgrade the frontend's disclosure export originally
    /// deferred (see frontend/lib/disclosure.ts's FOLLOW-UP note): a one-time signed
    /// disclosure export requires the position owner to act again after every change, while
    /// an auditor holding the plaintext of `ciphertext` (decrypted with a viewing private key
    /// the owner shared once, out of band) gets passive, ongoing access to every update from
    /// here on, the same shape as a Zcash viewing key. `ciphertext` is opaque to this
    /// contract — it does not verify the encryption is well-formed, correctly opens the
    /// position's real commitment, or even decrypts to anything meaningful. That's
    /// deliberate: this event is a courier, not a source of truth. An auditor's trust still
    /// has to run through the same live on-chain commitment check the disclosure-file flow
    /// already does (see lib/disclosure.ts's `recomputeCommitment` / the Verify page) — this
    /// just removes the need for the owner to re-export after every change.
    function publishViewingNote(uint256 assetId, bool isDebt, bytes calldata ciphertext) external {
        emit ViewingNotePublished(msg.sender, assetId, isDebt, block.timestamp, ciphertext);
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

    /// @dev Share deltas can't be bound with equality, unlike every other public input.
    /// `currentSupplyIndexRay` advances every second an asset has live utilization, and a
    /// share delta is derived from it — so binding by equality asks the caller to predict
    /// the index of whichever future block their transaction happens to land in. That is
    /// not winnable: a wallet takes seconds to sign, the index has moved by then, and the
    /// call reverts with InvalidProof no matter how honest it was. It looked like it worked
    /// only because an asset nobody has borrowed against has a static index.
    ///
    /// These two bind directionally instead, always leaving any drift in the pool's favour:
    /// a deposit may claim no MORE shares than its amount buys at the live index, and a
    /// withdrawal must burn no FEWER than its amount costs. A caller who reads the index a
    /// little early is then simply credited (or debited) a dust amount against themselves
    /// rather than rejected, and gets a usable window instead of a single winning second.
    /// Nothing else loosens: both commitments, the direction flag and the asset id all
    /// still bind exactly, so a proof still can't be replayed onto a different update.
    function _verifyShareUpdate(
        bytes calldata proof,
        uint256[] calldata publicInputs,
        uint256 oldCommitment,
        uint256 newCommitment,
        uint256 maxDelta,
        bool isIncrease,
        uint256 assetId
    ) private view {
        if (publicInputs.length < 5) revert Errors.InvalidProof();
        _requireEq(publicInputs[0], oldCommitment);
        _requireEq(publicInputs[1], newCommitment);
        if (publicInputs[2] > maxDelta) revert Errors.InvalidProof();
        _requireEq(publicInputs[3], isIncrease ? 1 : 0);
        _requireEq(publicInputs[4], assetId);

        if (!commitmentVerifier.verifyCommitmentUpdate(proof, publicInputs)) revert Errors.InvalidProof();
    }

    function _verifyShareBurn(
        bytes calldata proof,
        uint256[] calldata publicInputs,
        uint256 oldCommitment,
        uint256 newCommitment,
        uint256 minDelta,
        uint256 assetId
    ) private view {
        if (publicInputs.length < 5) revert Errors.InvalidProof();
        _requireEq(publicInputs[0], oldCommitment);
        _requireEq(publicInputs[1], newCommitment);
        if (publicInputs[2] < minDelta) revert Errors.InvalidProof();
        _requireEq(publicInputs[3], 0);
        _requireEq(publicInputs[4], assetId);

        if (!commitmentVerifier.verifyCommitmentUpdate(proof, publicInputs)) revert Errors.InvalidProof();
    }

    function _verifySolvency(
        bytes calldata proof,
        uint256[] calldata publicInputs,
        uint256 collateralCommitment,
        uint256 debtCommitment,
        address collateralToken,
        address debtToken,
        uint256 collateralIndexRay,
        uint256 debtIndexRay,
        uint16 thresholdBps
    ) private view {
        (uint256 collateralPriceE8, uint256 collateralUpdatedAt) = priceOracle.getPrice(collateralToken);
        (uint256 debtPriceE8, uint256 debtUpdatedAt) = priceOracle.getPrice(debtToken);
        _requireFreshPrice(collateralUpdatedAt);
        _requireFreshPrice(debtUpdatedAt);

        if (publicInputs.length < 7) revert Errors.InvalidProof();
        _requireEq(publicInputs[0], collateralCommitment);
        _requireEq(publicInputs[1], debtCommitment);
        _requireEq(publicInputs[2], collateralPriceE8);
        _requireEq(publicInputs[3], debtPriceE8);
        // Same moving target as _verifyShareUpdate, and bounded the same way: a caller may
        // only UNDERSTATE the supply index, which understates what their collateral shares
        // are worth and so can only make this check stricter on them, never looser.
        if (publicInputs[4] > collateralIndexRay) revert Errors.InvalidProof();
        _requireEq(publicInputs[5], debtIndexRay);
        _requireEq(publicInputs[6], thresholdBps);

        if (!solvencyVerifier.verifySolvency(proof, publicInputs)) revert Errors.InvalidProof();
    }

    function _requireFreshPrice(uint256 updatedAt) private view {
        // `updatedAt > block.timestamp` would otherwise underflow this subtraction and revert
        // with a generic Panic instead of this clear, expected error — MockPriceOracle always
        // stamps block.timestamp so it can't trigger this today, but nothing stops a future
        // real IPriceOracle implementation (a different chain's clock skew, a buggy or
        // compromised adapter) from reporting one.
        if (updatedAt > block.timestamp || block.timestamp - updatedAt > PRICE_STALENESS_WINDOW) revert Errors.StaleOraclePrice();
    }

    function _requireEq(uint256 a, uint256 b) private pure {
        if (a != b) revert Errors.InvalidProof();
    }
}
