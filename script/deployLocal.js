const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Local/dev-only deployment: wires MockVerifier for all three proof types (see
// contracts/README.md for how to swap in the real Noir*Verifier adapters instead), deploys
// mock ERC20s + a mock price oracle + a mock ZEN staking pool, lists four markets, and mints
// test tokens to the first few Hardhat default accounts so the frontend has something real
// to connect to and call. Writes addresses + ABIs to frontend/lib/deployment.json.
async function main() {
  const [deployer, alice, bob] = await ethers.getSigners();
  console.log("Deploying Latens (local dev) with:", deployer.address);

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const zen = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18);
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6);
  const wbtc = await MockERC20.deploy("Wrapped Bitcoin", "WBTC", 8);
  const dai = await MockERC20.deploy("Dai Stablecoin", "DAI", 18);
  await zen.waitForDeployment();
  await usdc.waitForDeployment();
  await wbtc.waitForDeployment();
  await dai.waitForDeployment();

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy();
  await oracle.waitForDeployment();
  await (await oracle.setPrice(await zen.getAddress(), ethers.parseUnits("2", 8))).wait();
  await (await oracle.setPrice(await usdc.getAddress(), ethers.parseUnits("1", 8))).wait();
  await (await oracle.setPrice(await wbtc.getAddress(), ethers.parseUnits("60000", 8))).wait();
  await (await oracle.setPrice(await dai.getAddress(), ethers.parseUnits("1", 8))).wait();

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

  // 80% LTV, 85% liquidation threshold, 8% bonus, 10% reserve factor for stablecoins/ZEN;
  // WBTC gets a tighter 70%/75% band to reflect higher price volatility.
  const zenAssetId = 0n;
  await (await registry.listAsset(await zen.getAddress(), 8_000, 8_500, 800, 1_000)).wait();
  const usdcAssetId = 1n;
  await (await registry.listAsset(await usdc.getAddress(), 8_000, 8_500, 800, 1_000)).wait();
  const wbtcAssetId = 2n;
  await (await registry.listAsset(await wbtc.getAddress(), 7_000, 7_500, 1_000, 1_000)).wait();
  const daiAssetId = 3n;
  await (await registry.listAsset(await dai.getAddress(), 8_000, 8_500, 800, 1_000)).wait();

  // Seed pool liquidity and test-account balances so the frontend has something to show.
  await (await usdc.mint(deployer.address, ethers.parseUnits("1000000", 6))).wait();
  await (await usdc.transfer(await pool.getAddress(), ethers.parseUnits("500000", 6))).wait();
  await (await wbtc.mint(deployer.address, ethers.parseUnits("100", 8))).wait();
  await (await wbtc.transfer(await pool.getAddress(), ethers.parseUnits("50", 8))).wait();
  await (await dai.mint(deployer.address, ethers.parseUnits("1000000", 18))).wait();
  await (await dai.transfer(await pool.getAddress(), ethers.parseUnits("500000", 18))).wait();

  await (await zen.mint(alice.address, ethers.parseUnits("10000", 18))).wait();
  await (await usdc.mint(alice.address, ethers.parseUnits("50000", 6))).wait();
  await (await wbtc.mint(alice.address, ethers.parseUnits("5", 8))).wait();
  await (await dai.mint(alice.address, ethers.parseUnits("50000", 18))).wait();
  await (await zen.mint(bob.address, ethers.parseUnits("10000", 18))).wait();
  await (await usdc.mint(bob.address, ethers.parseUnits("50000", 6))).wait();
  await (await wbtc.mint(bob.address, ethers.parseUnits("5", 8))).wait();
  await (await dai.mint(bob.address, ethers.parseUnits("50000", 18))).wait();

  const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
  function abiOf(rel) {
    return JSON.parse(fs.readFileSync(path.join(artifactsDir, rel))).abi;
  }

  const deployment = {
    chainId: 31337,
    contracts: {
      LatensPool: { address: await pool.getAddress(), abi: abiOf("core/LatensPool.sol/LatensPool.json") },
      AssetRegistry: { address: await registry.getAddress(), abi: abiOf("core/AssetRegistry.sol/AssetRegistry.json") },
      MockPriceOracle: { address: await oracle.getAddress(), abi: abiOf("mocks/MockPriceOracle.sol/MockPriceOracle.json") },
      MockERC20: { abi: abiOf("mocks/MockERC20.sol/MockERC20.json") },
    },
    tokens: {
      ZEN: { address: await zen.getAddress(), symbol: "ZEN", decimals: 18, assetId: Number(zenAssetId) },
      USDC: { address: await usdc.getAddress(), symbol: "USDC", decimals: 6, assetId: Number(usdcAssetId) },
      WBTC: { address: await wbtc.getAddress(), symbol: "WBTC", decimals: 8, assetId: Number(wbtcAssetId) },
      DAI: { address: await dai.getAddress(), symbol: "DAI", decimals: 18, assetId: Number(daiAssetId) },
    },
  };

  const outDir = path.join(__dirname, "..", "frontend", "lib");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "deployment.json"), JSON.stringify(deployment, null, 2));

  console.log("LatensPool:", await pool.getAddress());
  console.log("AssetRegistry:", await registry.getAddress());
  console.log("ZEN:", await zen.getAddress());
  console.log("USDC:", await usdc.getAddress());
  console.log("WBTC:", await wbtc.getAddress());
  console.log("DAI:", await dai.getAddress());
  console.log("Wrote frontend/lib/deployment.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
