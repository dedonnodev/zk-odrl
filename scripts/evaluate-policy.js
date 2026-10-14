// Evaluate an ODRL policy for one user at one instant, with the reference
// semantics of the circuit (no proof): prints GRANT or DENY per resource.
// Usage: node scripts/evaluate-policy.js <policy.jsonld> '<attributes JSON>' <ISO dateTime>
//   attributes by name, e.g. {"department":"RnD","role":"employee","clearanceLevel":3,"badgeStatus":"active"}
import { readFileSync } from "node:fs";
import { compile, ProfileError } from "../src/compile.js";
import { attributeCodes, environment, evaluate } from "../src/evaluate.js";

const [file, attrs, at] = process.argv.slice(2);
try {
  const now = Date.parse(at) / 1000;
  if (!Number.isInteger(now) || now < 0) throw new Error(`bad dateTime ${at}, use e.g. 2026-10-14T10:00:00Z`);
  const env = environment(attributeCodes(JSON.parse(attrs)), now);
  for (const c of await compile(JSON.parse(readFileSync(file)))) {
    console.log(`resourceId ${c.resourceId}: ${evaluate(c, env) ? "GRANT" : "DENY"}`);
  }
} catch (e) {
  console.error(e instanceof ProfileError ? `out of profile: ${e.message}` : `error: ${e.message}`);
  process.exit(1);
}
