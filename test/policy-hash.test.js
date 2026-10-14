import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { policyHash } from "../src/policy-hash.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));

test("printer policyHash matches the committed vector", async () => {
  const [c] = await compile(read("../policies/printer.jsonld"));
  const [vector] = read("./vectors/printer.json");
  assert.equal(policyHash(c).toString(), vector.policyHash);
});

test("changing any field changes policyHash", async () => {
  const [c] = await compile(read("../policies/printer.jsonld"));
  const h = policyHash(c);
  const fields = [(x) => x.resourceId++, (x) => (x.prohActive = 0)];
  for (const rule of ["perm", "proh"]) {
    fields.push((x) => x[rule].mode++);
    for (let i = 0; i < 4; i++) {
      for (const f of ["idx", "op", "len"]) fields.push((x) => x[rule].slots[i][f]++);
      for (let j = 0; j < 4; j++) fields.push((x) => x[rule].slots[i].val[j]++);
    }
  }
  for (const change of fields) {
    const x = structuredClone(c);
    change(x);
    assert.notEqual(policyHash(x), h, change.toString());
  }
});
