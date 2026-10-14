// Compile an ODRL policy into circuit slots and policyHash (JSON on stdout).
// Usage: node scripts/compile-policy.js <policy.jsonld> [N] [K]
import { readFileSync } from "node:fs";
import { compile, ProfileError } from "../src/compile.js";
import { policyHash } from "../src/policy-hash.js";

const [file, N = "4", K = "4"] = process.argv.slice(2);
try {
  const compiled = await compile(JSON.parse(readFileSync(file)), { N: Number(N), K: Number(K) });
  const out = compiled.map((c) => ({ ...c, policyHash: policyHash(c) }));
  console.log(JSON.stringify(out, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2));
} catch (e) {
  if (!(e instanceof ProfileError || e instanceof RangeError || e instanceof SyntaxError || e.code === "ENOENT")) throw e;
  console.error(`${e instanceof ProfileError ? "out of profile" : "error"}: ${e.message}`);
  process.exit(1);
}
