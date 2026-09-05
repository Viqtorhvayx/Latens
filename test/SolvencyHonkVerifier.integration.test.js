const { expect } = require("chai");
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { deployHonkVerifier, toHonkPublicInputs } = require("./helpers/honkVerifier");

// Integration test against the REAL, machine-generated verifier for circuits/solvency —
// not MockVerifier. Confirms how to correctly assemble calldata for Barretenberg's
// generated Honk Solidity verifier: `NUMBER_OF_PUBLIC_INPUTS` (13) is NOT the length of the
// `publicInputs` argument — reading `BaseZKHonkVerifier.verify` directly shows
// `require(publicInputs.length == vk.publicInputsSize - PAIRING_POINTS_SIZE)`, and
// `PAIRING_POINTS_SIZE = 8` is a fixed constant (a BN254 pairing/aggregation object embedded
// INSIDE the proof bytes themselves, extracted internally via `ZKTranscriptLib.loadProof`,
// never supplied by the caller). So `publicInputs` is exactly the circuit's own 5 declared
// public inputs, and `proof` is bb's complete, unmodified proof blob — bb's own `-o <dir>`
// file split (`public_inputs` = 5 elements, `proof` = the rest) is already exactly correct,
// with no reconstruction or re-splitting needed.
//
// Requires a real proof to already exist at circuits/solvency/target/{proof,public_inputs}
// — generate it with the commands in circuits/README.md before running this file.
describe("SolvencyHonkVerifier (real proof, real verifier)", function () {
  const targetDir = path.join(__dirname, "..", "circuits", "solvency", "target");
  const proofPath = path.join(targetDir, "proof");
  const publicInputsPath = path.join(targetDir, "public_inputs");

  let verifier;
  let bbPublicInputs;
  let bbProof;

  before(async function () {
    if (!fs.existsSync(proofPath) || !fs.existsSync(publicInputsPath)) {
      this.skip();
    }

    bbPublicInputs = fs.readFileSync(publicInputsPath); // 5 x 32 bytes, per the circuit
    bbProof = fs.readFileSync(proofPath); // bb's complete, unmodified proof blob

    verifier = await deployHonkVerifier("SolvencyHonkVerifier", "SolvencyHonkVerifier");
  });

  it("verifies a real proof exactly as bb's own file split produces it — no reconstruction needed", async function () {
    const result = await verifier.verify(ethers.hexlify(bbProof), toHonkPublicInputs(bbPublicInputs));
    expect(result).to.equal(true);
  });

  it("rejects the same proof against a tampered public input", async function () {
    const tampered = Buffer.from(bbPublicInputs);
    tampered[tampered.length - 1] ^= 0xff; // flip a bit in the last public input (thresholdBps)

    await expect(verifier.verify(ethers.hexlify(bbProof), toHonkPublicInputs(tampered))).to.be.reverted;
  });
});
