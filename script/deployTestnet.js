const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Deploying Latens to ${network.name} (chainId ${net.chainId}) with:`, deployer.address);

  // Nonces assigned locally rather than re-derived per send — some public RPCs load-balance
  // across backend nodes whose mempool views can lag, producing spurious
  // "replacement transaction underpriced" errors otherwise.
  let nonce = await ethers.provider.getTransactionCount(deployer.address, "pending");
  const nextNonce = () => ({ nonce: nonce++ });

  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const zen = await MockERC20.deploy("Wrapped ZEN", "ZEN", 18, nextNonce());
  const zusd = await MockERC20.deploy("Horizen USD", "ZUSD", 18, nextNonce());
  const wbtc = await MockERC20.deploy("Wrapped Bitcoin", "WBTC", 8, nextNonce());
  const usdc = await MockERC20.deploy("USD Coin", "USDC", 6, nextNonce());
  await zen.waitForDeployment();
  await zusd.waitForDeployment();
  await wbtc.waitForDeployment();
  await usdc.waitForDeployment();
  console.log("Tokens deployed.");

  const MockPriceOracle = await ethers.getContractFactory("MockPriceOracle");
  const oracle = await MockPriceOracle.deploy(nextNonce());
  await oracle.waitForDeployment();
  await (await oracle.setPrice(await zen.getAddress(), ethers.parseUnits("2", 8), nextNonce())).wait();
  await (await oracle.setPrice(await zusd.getAddress(), ethers.parseUnits("1", 8), nextNonce())).wait();
  await (await oracle.setPrice(await wbtc.getAddress(), ethers.parseUnits("60000", 8), nextNonce())).wait();
  await (await oracle.setPrice(await usdc.getAddress(), ethers.parseUnits("1", 8), nextNonce())).wait();
  console.log("Price oracle deployed and seeded.");

  const MockVerifier = await ethers.getContractFactory("MockVerifier");
  const verifier = await MockVerifier.deploy(false, nextNonce());
  await verifier.waitForDeployment();

  const MockZenStakingPool = await ethers.getContractFactory("MockZenStakingPool");
  const stakingPool = await MockZenStakingPool.deploy(nextNonce());
  await stakingPool.waitForDeployment();

  const AssetRegistry = await ethers.getContractFactory("AssetRegistry");
  const registry = await AssetRegistry.deploy(deployer.address, nextNonce());
  await registry.waitForDeployment();

  const ProtocolTreasury = await ethers.getContractFactory("ProtocolTreasury");
  const treasury = await ProtocolTreasury.deploy(deployer.address, await stakingPool.getAddress(), nextNonce());
  await treasury.waitForDeployment();

  const LatensPool = await ethers.getContractFactory("LatensPool");
  const pool = await LatensPool.deploy(
    deployer.address,
    await registry.getAddress(),
    await treasury.getAddress(),
    await oracle.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
    await verifier.getAddress(),
    nextNonce()
  );
  await pool.waitForDeployment();
  await (await registry.setPool(await pool.getAddress(), nextNonce())).wait();
  console.log("LatensPool deployed and wired.");

  const zenAssetId = 0n;
  await (await registry.listAsset(await zen.getAddress(), 8_000, 8_500, 800, 1_000, nextNonce())).wait();
  const zusdAssetId = 1n;
  await (await registry.listAsset(await zusd.getAddress(), 8_000, 8_500, 800, 1_000, nextNonce())).wait();
  const wbtcAssetId = 2n;
  await (await registry.listAsset(await wbtc.getAddress(), 7_000, 7_500, 1_000, 1_000, nextNonce())).wait();
  const usdcAssetId = 3n;
  await (await registry.listAsset(await usdc.getAddress(), 8_000, 8_500, 800, 1_000, nextNonce())).wait();

  await (await registry.setInterestRateModel(zenAssetId, 200, 1_000, 30_000, 8_000, nextNonce())).wait();
  await (await registry.setInterestRateModel(zusdAssetId, 50, 800, 10_000, 9_000, nextNonce())).wait();
  await (await registry.setInterestRateModel(wbtcAssetId, 100, 1_200, 40_000, 7_000, nextNonce())).wait();
  await (await registry.setInterestRateModel(usdcAssetId, 50, 800, 10_000, 9_000, nextNonce())).wait();
  console.log("Markets listed with interest rate models.");

  // Seeding via a raw transfer (rather than a real supplyCollateral() call) means
  // AssetRegistry.totalSupplied never sees this liquidity on its own — it only moves inside
  // recordSupply(), which only the pool can call as part of that flow. seedTotalSupplied()
  // books the same amount into the aggregate directly, so utilization/APR/APY reflect the
  // real tokens now sitting in the pool instead of reading as 0% forever.
  const zenSeed = ethers.parseUnits("5000", 18);
  await (await zen.mint(deployer.address, ethers.parseUnits("10000", 18), nextNonce())).wait();
  await (await zen.transfer(await pool.getAddress(), zenSeed, nextNonce())).wait();
  await (await registry.seedTotalSupplied(zenAssetId, zenSeed, nextNonce())).wait();

  const zusdSeed = ethers.parseUnits("50000", 18);
  await (await zusd.mint(deployer.address, ethers.parseUnits("100000", 18), nextNonce())).wait();
  await (await zusd.transfer(await pool.getAddress(), zusdSeed, nextNonce())).wait();
  await (await registry.seedTotalSupplied(zusdAssetId, zusdSeed, nextNonce())).wait();

  const wbtcSeed = ethers.parseUnits("5", 8);
  await (await wbtc.mint(deployer.address, ethers.parseUnits("10", 8), nextNonce())).wait();
  await (await wbtc.transfer(await pool.getAddress(), wbtcSeed, nextNonce())).wait();
  await (await registry.seedTotalSupplied(wbtcAssetId, wbtcSeed, nextNonce())).wait();

  const usdcSeed = ethers.parseUnits("50000", 6);
  await (await usdc.mint(deployer.address, ethers.parseUnits("100000", 6), nextNonce())).wait();
  await (await usdc.transfer(await pool.getAddress(), usdcSeed, nextNonce())).wait();
  await (await registry.seedTotalSupplied(usdcAssetId, usdcSeed, nextNonce())).wait();
  console.log("Pool liquidity seeded and booked into totalSupplied.");

  const LatensDollar = await ethers.getContractFactory("LatensDollar");
  const latensDollar = await LatensDollar.deploy(deployer.address, nextNonce());
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
    await verifier.getAddress(),
    nextNonce()
  );
  await cdp.waitForDeployment();
  await (await latensDollar.setCDP(await cdp.getAddress(), nextNonce())).wait();
  await (await cdp.setMintFee(50, nextNonce())).wait();
  console.log("LatensCDP deployed and wired.");

  const SupplyRewards = await ethers.getContractFactory("SupplyRewards");
  const epochDuration = 24n * 60n * 60n;
  const rewardPerEpoch = ethers.parseUnits("10", 18);
  const rewards = await SupplyRewards.deploy(deployer.address, await pool.getAddress(), await zusd.getAddress(), epochDuration, rewardPerEpoch, nextNonce());
  await rewards.waitForDeployment();
  await (await zusd.mint(deployer.address, ethers.parseUnits("50000", 18), nextNonce())).wait();
  await (await zusd.connect(deployer).approve(await rewards.getAddress(), ethers.parseUnits("50000", 18), nextNonce())).wait();
  await (await rewards.connect(deployer).fund(ethers.parseUnits("50000", 18), nextNonce())).wait();

  // The 50,000 ZUSD above is a bootstrap grant, not the program's only source of funds: wire
  // the treasury to top SupplyRewards back up out of real ZUSD-market interest on every
  // sweep, so the program's runway scales with actual usage instead of only ever counting
  // down from a fixed number.
  await (await treasury.setSupplyRewards(await rewards.getAddress(), nextNonce())).wait();
  await (await treasury.setRewardsContributionRate(1_500, nextNonce())).wait();
  console.log("SupplyRewards deployed, funded, and wired to the treasury sweep.");

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
      SupplyRewards: { address: await rewards.getAddress(), abi: abiOf("core/SupplyRewards.sol/SupplyRewards.json") },
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
  console.log("SupplyRewards:", await rewards.getAddress());
  console.log("Wrote frontend/lib/deployment.json");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
