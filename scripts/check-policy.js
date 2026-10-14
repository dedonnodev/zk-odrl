// Tell whether an ODRL policy is fully compatible with this library.
// Usage: node scripts/check-policy.js <policy.jsonld> [N] [K]
// Exit code 0 if compatible, 1 if not.
import { readFileSync } from "node:fs";
import { check } from "../src/check.js";
import { policyHash } from "../src/policy-hash.js";

const MODES = ["", "and", "or", "xone"];
const [file, N = "4", K = "4"] = process.argv.slice(2);
const opts = { N: Number(N), K: Number(K) };
let r;
try {
  r = await check(JSON.parse(readFileSync(file)), opts);
} catch (e) {
  if (!(e instanceof RangeError || e instanceof SyntaxError || e.code === "ENOENT")) throw e;
  console.error(`error: ${e.message}`);
  process.exit(1);
}

if (r.compatible) {
  console.log(`${file}: compatible (N = ${opts.N} slots per rule, K = ${opts.K} values per set)`);
  for (const c of r.compiled) {
    const used = (rule) => `${rule.slots.filter((s) => s.op !== 0).length}/${opts.N} slots, ${MODES[rule.mode]}`;
    console.log(`  resourceId ${c.resourceId}: permission ${used(c.perm)}; `
      + `prohibition ${c.prohActive ? used(c.proh) : "none"}`);
    console.log(`    policyHash ${policyHash(c)}`);
  }
} else {
  console.log(`${file}: not compatible`);
  for (const i of r.issues) console.log(`  - ${i.kind}: ${i.message}`);
}
process.exit(r.compatible ? 0 : 1);
