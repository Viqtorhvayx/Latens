const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`Deploying SupplyRewards to ${network.name} (chainId ${net.chainId}) with:`, deployer.address);

  const deploymentPath = path.join(__dirname, "..", "frontend", "lib", "deployment.json");
  const deployment = JSON.parse(fs.readFileSync(deploymentPath));
  if (Number(deployment.chainId) !== Number(net.chainId)) {
    throw new Error(`deployment.json is for chainId ${deployment.chainId}, connected to ${net.chainId}`);
  }

  const poolAddress = deployment.contracts.LatensPool.address;
  const zusdAddress = deployment.tokens.ZUSD.address;

  const zusd = await ethers.getContractAt("MockERC20", zusdAddress);

  const SupplyRewards = await ethers.getContractFactory("SupplyRewards");
  const epochDuration = 24n * 60n * 60n;
  const rewardPerEpoch = ethers.parseUnits("10", 18);
  const rewards = await SupplyRewards.deploy(deployer.address, poolAddress, zusdAddress, epochDuration, rewardPerEpoch);
  await rewards.waitForDeployment();
  console.log("SupplyRewards:", await rewards.getAddress());

  const fundAmount = ethers.parseUnits("50000", 18);
  await (await zusd.mint(deployer.address, fundAmount)).wait();
  await (await zusd.connect(deployer).approve(await rewards.getAddress(), fundAmount)).wait();
  await (await rewards.connect(deployer).fund(fundAmount)).wait();
  console.log("SupplyRewards funded with", ethers.formatUnits(fundAmount, 18), "ZUSD.");

  const artifactsDir = path.join(__dirname, "..", "artifacts", "contracts");
  const abi = JSON.parse(fs.readFileSync(path.join(artifactsDir, "core/SupplyRewards.sol/SupplyRewards.json"))).abi;
  deployment.contracts.SupplyRewards = { address: await rewards.getAddress(), abi };
  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log("Updated frontend/lib/deployment.json.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
