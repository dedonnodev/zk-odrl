// Check the proof with snarkjs and with Groth16Verifier.sol (eth_call on the
// in-process Hardhat EVM). Both must accept the real proof and reject a wrong
// public input and a modified proof.
import { readFileSync } from "node:fs";
import hre from "hardhat";
import * as snarkjs from "snarkjs";

const read = (f) => JSON.parse(readFileSync(f));
const proof = read("build/proof.json");
const pub = read("build/public.json");
const vkey = read("build/verification_key.json");

// BN254 base field: -P = (x, q - y), still on the curve but a wrong proof
const q = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
const badProof = { ...proof, pi_a: [proof.pi_a[0], String(q - BigInt(proof.pi_a[1])), "1"] };
const badPub = [String(BigInt(pub[0]) + 1n)];

// pi_b coordinates are in the opposite order in snarkjs and in the contract
const args = (p, s) => [
  [BigInt(p.pi_a[0]), BigInt(p.pi_a[1])],
  [
    [BigInt(p.pi_b[0][1]), BigInt(p.pi_b[0][0])],
    [BigInt(p.pi_b[1][1]), BigInt(p.pi_b[1][0])],
  ],
  [BigInt(p.pi_c[0]), BigInt(p.pi_c[1])],
  s.map(BigInt),
];

const { viem } = await hre.network.connect();
const verifier = await viem.deployContract("Groth16Verifier");

const cases = [
  ["real proof", proof, pub, true],
  ["wrong public input", proof, badPub, false],
  ["modified proof", badProof, pub, false],
];
let ok = true;
for (const [name, p, s, expected] of cases) {
  const off = await snarkjs.groth16.verify(vkey, s, p);
  const on = await verifier.read.verifyProof(args(p, s));
  console.log(`${name.padEnd(18)} snarkjs ${off}, contract ${on}`);
  ok &&= off === expected && on === expected;
}

const gas = await (await viem.getPublicClient()).estimateContractGas({
  address: verifier.address,
  abi: verifier.abi,
  functionName: "verifyProof",
  args: args(proof, pub),
});
console.log(`gas estimate (whole tx, incl. 21000 base): ${gas}`);

// snarkjs leaves worker threads open
process.exit(ok ? 0 : 1);
