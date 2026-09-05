const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier, toHonkPublicInputs } = require("./helpers/honkVerifier");

// Integration test against the REAL, machine-generated verifier for
// circuits/liquidation_eligibility — not MockVerifier. See
// SolvencyHonkVerifier.integration.test.js for the full explanation of the calldata mapping
// (publicInputs = the circuit's own 10 declared public inputs; proof = bb's unmodified
// proof blob).
describe("LiquidationHonkVerifier (real proof, real verifier)", function () {
  const targetDir = path.join(__dirname, "..", "circuits", "liquidation_eligibility", "target");
  const proofPath = path.join(targetDir, "proof");
  const publicInputsPath = path.join(targetDir, "public_inputs");

  let verifier;
  let bbPublicInputs;
  let bbProof;

  before(async function () {
    if (!fs.existsSync(proofPath) || !fs.existsSync(publicInputsPath)) {
      this.skip();
    }

    bbPublicInputs = fs.readFileSync(publicInputsPath);
    bbProof = fs.readFileSync(proofPath);

    verifier = await deployHonkVerifier("LiquidationHonkVerifier", "LiquidationHonkVerifier");
  });

  it("verifies a real proof of an insolvent-position liquidation within the bonus cap", async function () {
    const result = await verifier.verify(ethers.hexlify(bbProof), toHonkPublicInputs(bbPublicInputs));
    expect(result).to.equal(true);
  });

  it("rejects the same proof against a tampered public input", async function () {
    const tampered = Buffer.from(bbPublicInputs);
    tampered[tampered.length - 1] ^= 0xff; // flip a bit in the last public input (repayAmount)

    await expect(verifier.verify(ethers.hexlify(bbProof), toHonkPublicInputs(tampered))).to.be.reverted;
  });
});
