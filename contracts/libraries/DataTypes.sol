// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Shared structs for the Latens protocol.
library DataTypes {
    /// @dev Market-level configuration and aggregates. These are deliberately PUBLIC —
    /// a lending market cannot function without public price and liquidity data. Latens's
    /// confidentiality guarantee is scoped to individual position sizes, not to the market
    /// as a whole (see `LatensPool` for the private side of the design).
    struct Asset {
        address token;
        bool isSupported;
        uint16 ltvBps; // max loan-to-value at origination, basis points (e.g. 7500 = 75%)
        uint16 liquidationThresholdBps; // basis points, must be > ltvBps
        uint16 liquidationBonusBps; // bonus paid to liquidators, basis points
        uint16 reserveFactorBps; // protocol's cut of interest, basis points
        uint256 totalSupplied; // public aggregate
        uint256 totalBorrowed; // public aggregate
        uint16 baseRateBps;
        uint16 slope1Bps;
        uint16 slope2Bps;
        uint16 kinkBps;
    }

    /// @dev A user's confidential position in one market. Amounts are never stored in the
    /// clear — only Pedersen/Poseidon-style commitments to (amount, salt) tuples. Reading
    /// or updating a position requires a zk-SNARK proof of correct knowledge and arithmetic;
    /// see `ICommitmentVerifier`, `ISolvencyVerifier`, and `ILiquidationVerifier`.
    /// @dev This scaffold models one ISOLATED position per user: a single collateral asset
    /// and a single debt asset, chosen when the position is opened. Multi-collateral,
    /// cross-margin positions would require the ZK circuits to aggregate over many assets
    /// at once, which is materially harder and is out of scope for the M1 milestone —
    /// tracked here as deliberate scope, not an oversight.
    struct Position {
        uint256 collateralAssetId;
        uint256 debtAssetId;
        uint256 collateralCommitment;
        uint256 debtCommitment;
        uint64 lastUpdated;
        uint64 debtLastUpdated;
        bool active;
        bool hasDebt;
    }

    struct CDPPosition {
        uint256 collateralAssetId;
        uint256 collateralCommitment;
        uint256 debtCommitment;
        uint64 lastUpdated;
        bool active;
        bool hasDebt;
    }
}
