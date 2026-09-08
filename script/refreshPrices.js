// Heartbeat for the testnet MockPriceOracle.
//
// LatensPool and LatensCDP both reject any solvency-gated call whose price is older than
// their PRICE_STALENESS_WINDOW (1 hour). A real oracle updates itself; MockPriceOracle only
// advances when someone calls it, so a deployment left alone for an hour starts rejecting
// every borrow, withdraw-against-debt, mint and liquidate with StaleOraclePrice, while
// supply, repay and burn keep working. Nothing is wrong with the positions; the feed just
// hasn't been touched.
//
// The app now sends this refresh itself before each affected action (see
// frontend/lib/useFreshPrices.ts), so users don't need this script. It's here for keeping a
// deployment warm ahead of a demo, and for checking feed age without sending anything:
//
//   npx hardhat run script/refreshPrices.js --network horizenTestnet          # refresh if stale
//   CHECK_ONLY=1 npx hardhat run script/refreshPrices.js --network horizenTestnet
//
// refreshTimestamp is permissionless and can only re-stamp a price that is already set, so
// any funded account can run this. It cannot change what a price says.
const { ethers } = require("hardhat");
const deployment = require("../frontend/lib/deployment.json");

const STALENESS_WINDOW_SECONDS = 3600;

async function main() {
  const checkOnly = Boolean(process.env.CHECK_ONLY);
  const oracle = await ethers.getContractAt("MockPriceOracle", deployment.contracts.MockPriceOracle.address);
  const block = await ethers.provider.getBlock("latest");

  console.log(`Oracle ${deployment.contracts.MockPriceOracle.address} on chain ${deployment.chainId}`);
  console.log(`Block timestamp ${block.timestamp} (${new Date(block.timestamp * 1000).toISOString()})\n`);

  const stale = [];
  for (const token of Object.values(deployment.tokens)) {
    const [priceE8, updatedAt] = await oracle.getPrice(token.address);
    const ageSeconds = block.timestamp - Number(updatedAt);
    const isStale = ageSeconds > STALENESS_WINDOW_SECONDS;
    if (isStale) stale.push(token);
    console.log(
      `${token.symbol.padEnd(6)} $${(Number(priceE8) / 1e8).toString().padEnd(10)} ` +
        `age ${(ageSeconds / 3600).toFixed(1)}h  ${isStale ? "STALE" : "fresh"}`
    );
  }

  if (stale.length === 0) {
    console.log("\nAll prices are within the staleness window. Nothing to do.");
    return;
  }
  if (checkOnly) {
    console.log(`\n${stale.length} price(s) stale. Re-run without CHECK_ONLY to refresh.`);
    return;
  }

  console.log("");
  for (const token of stale) {
    const tx = await oracle.refreshTimestamp(token.address);
    await tx.wait();
    console.log(`Refreshed ${token.symbol}  ${tx.hash}`);
  }
  console.log("\nDone. Borrow, withdraw, mint and liquidate will go through again.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
