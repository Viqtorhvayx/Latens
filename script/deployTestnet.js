const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Deploys the full Latens scaffold to a REAL, PUBLICLY REACHABLE testnet (Base Sepolia by
// default — see hardhat.config.js's baseSepolia entry) so the frontend actually works from
// any device, not just this machine's local Hardhat node. Structurally the same as
// script/deployLocal.js (mock ERC20s + mock oracle + MockVerifier for all three proof
// types, since there's still no client-side proof generation — see
// frontend/lib/positionStore.tsx), just pointed at a network other devices can reach and
// without deployLocal.js's hardcoded Hardhat default-account seeding (there's no "alice"/
// "bob" on a public testnet — MockERC20.mint is already permissionless, see
// frontend/components/FaucetButton.tsx).
async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Deploying Latens to ${network.name} (chainId ${net.chainId}) with:`, deployer.address);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const zen = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
  const zusd = await MockERC20.deploy("Horizen USD", "ZUSD", 18);
  const wbtc = await MockERC20.deploy("Wrapped Bitcoin", "WBTC", 8);
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  await zen.waitForDeployment();
  await zusd.waitForDeployment();
  await wbtc.waitForDeployment();
  await usdc.waitForDeployment();
  console.log("Tokens deployed.");

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.waitForDeployment();
  await (await oracle.setPrice(await zen.getAddress(), ethers.parseUnits("2", 8))).wait();
  await (await oracle.setPrice(await zusd.getAddress(), ethers.parseUnits("1", 8))).wait();
  await (await oracle.setPrice(await wbtc.getAddress(), ethers.parseUnits("60000", 8))).wait();
  await (await oracle.setPrice(await usdc.getAddress(), ethers.parseUnits("1", 8))).wait();
  console.log("Price oracle deployed and seeded.");

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false);
  await verifier.waitForDeployment();

  const MockZenStakingPool = await ethers.getContractFactory("MockZenStakingPool");
  const stakingPool = await MockZenStakingPool.deploy();
  await stakingPool.waitForDeployment();

  const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
  const registry = await AssetRegistry.deploy(deployer.address);
  await registry.waitForDeployment();

  const ProtocolTreasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await ProtocolTreasury.deploy(deployer.address, await stakingPool.getAddress());
  await treasury.waitForDeployment();

  const LatensPool = await ethers.getContractFactory("LatensPool");
  const pool = await LatensPool.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    await oracle.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress()
  );
  await pool.waitForDeployment();
  await (await registry.setPool(await pool.getAddress())).wait();
  console.log("LatensPool deployed and wired.");

  const zenAssetId = 0n;
  await (await registry.listAsset(await zen.getAddress(), 8_000, 8_500, 800, 1_000)).wait();
  const zusdAssetId = 1n;
  await (await registry.listAsset(await zusd.getAddress(), 8_000, 8_500, 800, 1_000)).wait();
  const wbtcAssetId = 2n;
  await (await registry.listAsset(await wbtc.getAddress(), 7_000, 7_500, 1_000, 1_000)).wait();
  const usdcAssetId = 3n;
  await (await registry.listAsset(await usdc.getAddress(), 8_000, 8_500, 800, 1_000)).wait();

  await (await registry.setInterestRateModel(zenAssetId, 200, 1_000, 30_000, 8_000)).wait();
  await (await registry.setInterestRateModel(zusdAssetId, 50, 800, 10_000, 9_000)).wait();
  await (await registry.setInterestRateModel(wbtcAssetId, 100, 1_200, 40_000, 7_000)).wait();
  await (await registry.setInterestRateModel(usdcAssetId, 50, 800, 10_000, 9_000)).wait();
  console.log("Markets listed with interest rate models.");

  // Seed pool liquidity so early borrow() calls have something to draw down.
  await (await zusd.mint(deployer.address, ethers.parseUnits("100000", 18))).wait();
  await (await zusd.transfer(await pool.getAddress(), ethers.parseUnits("50000", 18))).wait();
  await (await wbtc.mint(deployer.address, ethers.parseUnits("10", 8))).wait();
  await (await wbtc.transfer(await pool.getAddress(), ethers.parseUnits("5", 8))).wait();
  await (await usdc.mint(deployer.address, ethers.parseUnits("100000", 6))).wait();
  await (await usdc.transfer(await pool.getAddress(), ethers.parseUnits("50000", 6))).wait();
  console.log("Pool liquidity seeded.");

  const LatensDollar = await ethers.getContractFactory("LatensDollar");
  const latensDollar = await LatensDollar.deploy(deployer.address);
  await latensDollar.waitForDeployment();

  const LatensCDP = await ethers.getContractFactory("LatensCDP");
  const cdp = await LatensCDP.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    await latensDollar.getAddress(),
    await oracle.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress()
  );
  await cdp.waitForDeployment();
  await (await latensDollar.setCDP(await cdp.getAddress())).wait();
  await (await cdp.setMintFee(50)).wait(); // 0.5% origination fee
  console.log("LatensCDP deployed and wired.");

  const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
  function abiOf(rel) {
    return JSON.parse(fs.readFileSync(path.join(artifactsDir, rel))).abi;
  }

  const deployment = {
    chainId: Number(net.chainId),
    contracts: {
      LatensPool: { address: await pool.getAddress(), abi: abiOf("core/LatensPool.sol/LatensPool.json") },
      AssetRegistry: { address: await registry.getAddress(), abi: abiOf("core/AssetRegistry.sol/AssetRegistry.json") },
      MockPriceOracle: { address: await oracle.getAddress(), abi: abiOf("mocks/MockPriceOracle.sol/MockPriceOracle.json") },
      MockERC20: { abi: abiOf("mocks/MockERC20.sol/MockERC20.json") },
      LatensCDP: { address: await cdp.getAddress(), abi: abiOf("core/LatensCDP.sol/LatensCDP.json") },
      LatensDollar: { address: await latensDollar.getAddress(), abi: abiOf("core/LatensDollar.sol/LatensDollar.json") },
    },
    tokens: {
      ZEN: { address: await zen.getAddress(), symbol: "ZEN", decimals: 18, assetId: Number(zenAssetId) },
      ZUSD: { address: await zusd.getAddress(), symbol: "ZUSD", decimals: 18, assetId: Number(zusdAssetId) },
      WBTC: { address: await wbtc.getAddress(), symbol: "WBTC", decimals: 8, assetId: Number(wbtcAssetId) },
      USDC: { address: await usdc.getAddress(), symbol: "USDC", decimals: 6, assetId: Number(usdcAssetId) },
    },
  };

  const outDir = path.join(__dirname, "..", "frontend", "lib");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "deployment.json"), JSON.stringify(deployment, null, 2));

  console.log("\n--- Deployment summary ---");
  console.log("Network:", network.name, `(chainId ${net.chainId})`);
  console.log("LatensPool:", await pool.getAddress());
  console.log("AssetRegistry:", await registry.getAddress());
  console.log("ZEN:", await zen.getAddress());
  console.log("ZUSD:", await zusd.getAddress());
  console.log("WBTC:", await wbtc.getAddress());
  console.log("USDC:", await usdc.getAddress());
  console.log("LatensCDP:", await cdp.getAddress());
  console.log("LatensDollar:", await latensDollar.getAddress());
  console.log("Wrote frontend/lib/deployment.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
