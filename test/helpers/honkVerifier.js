const { ethers } = require("hardhat");

// Shared helper for deploying one of the three machine-generated Honk verifiers.
//
// All three generated files (contracts/verifiers/generated/*.sol) declare identically-named
// shared libraries (RelationsLib, ZKTranscriptLib, ...) — deliberately left unrenamed, see
// each file's header comment. That makes bare-name lookups like
// `ethers.getContractFactory("RelationsLib")` ambiguous once more than one is loaded, so
// every deployment here uses Hardhat's fully-qualified "<sourceName>:<contractName>" form.
async function deployHonkVerifier(fileName, contractName) {
  const sourceName = `contracts/verifiers/generated/${fileName}.sol`;

  const relationsLib = await (await ethers.getContractFactory(`${sourceName}:RelationsLib`)).deploy();
  const zkTranscriptLib = await (await ethers.getContractFactory(`${sourceName}:ZKTranscriptLib`)).deploy();

  const Verifier = await ethers.getContractFactory(`${sourceName}:${contractName}`, {
    libraries: {
      RelationsLib: await relationsLib.getAddress(),
      ZKTranscriptLib: await zkTranscriptLib.getAddress(),
    },
  });
  return Verifier.deploy();
}

function toHonkPublicInputs(buf) {
  const inputs = [];
  for (let i = 0; i < buf.length / 32; i++) {
    inputs.push(ethers.hexlify(buf.subarray(i * 32, (i + 1) * 32)));
  }
  return inputs;
}

module.exports = { deployHonkVerifier, toHonkPublicInputs };
