import { describe, expect, it } from "vitest";
import { explorerAddressUrl, explorerTxUrl } from "./chainExplorer";

describe("explorerTxUrl", () => {
  it("builds a Basescan URL for Base mainnet", () => {
    expect(explorerTxUrl(8453, "0xabc")).toBe("https://basescan.org/tx/0xabc");
  });
  it("builds a Sepolia Basescan URL for Base Sepolia", () => {
    expect(explorerTxUrl(84532, "0xabc")).toBe("https://sepolia.basescan.org/tx/0xabc");
  });
  it("builds an Etherscan Sepolia URL for Ethereum Sepolia", () => {
    expect(explorerTxUrl(11155111, "0xabc")).toBe("https://sepolia.etherscan.io/tx/0xabc");
  });
  it("returns undefined for local Hardhat, which has no real explorer", () => {
    expect(explorerTxUrl(31337, "0xabc")).toBeUndefined();
  });
  it("returns undefined for any unrecognized chain", () => {
    expect(explorerTxUrl(1, "0xabc")).toBeUndefined();
  });
});

describe("explorerAddressUrl", () => {
  it("builds a Basescan address URL for Base mainnet", () => {
    expect(explorerAddressUrl(8453, "0xdead")).toBe("https://basescan.org/address/0xdead");
  });
  it("builds an Etherscan Sepolia address URL for Ethereum Sepolia", () => {
    expect(explorerAddressUrl(11155111, "0xdead")).toBe("https://sepolia.etherscan.io/address/0xdead");
  });
  it("returns undefined for local Hardhat, which has no real explorer", () => {
    expect(explorerAddressUrl(31337, "0xdead")).toBeUndefined();
  });
});
