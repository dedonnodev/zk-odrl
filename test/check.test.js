import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { check } from "../src/check.js";

const printer = () => JSON.parse(readFileSync(new URL("../policies/printer.jsonld", import.meta.url)));

test("a policy in profile is compatible, with its compiled output", async () => {
  const r = await check(printer());
  assert.equal(r.compatible, true);
  assert.deepEqual(r.issues, []);
  assert.equal(r.compiled.length, 1);
  assert.equal(r.compiled[0].resourceId, 1);
});

test("every construct a proof cannot show is listed, not only the first", async () => {
  const d = printer();
  d.permission[0].duty = [{ action: "compensate" }];
  d.permission[0].constraint[1].leftOperand = "count";
  d.obligation = [{ action: "delete" }];
  const r = await check(d);
  assert.equal(r.compatible, false);
  const provable = r.issues.filter((i) => i.kind === "not ZK-provable").map((i) => i.construct).sort();
  assert.deepEqual(provable, ["count", "duty", "obligation"]);
});

test("a construct left out by choice is reported as out of profile", async () => {
  const d = printer();
  d.permission[0].constraint[0].operator = "isA";
  const r = await check(d);
  assert.equal(r.compatible, false);
  assert.equal(r.issues.length, 1);
  assert.equal(r.issues[0].kind, "out of profile");
  assert.match(r.issues[0].message, /operator isA not allowed/);
});

test("a not-provable construct is not reported twice", async () => {
  const d = printer();
  d.permission[0].duty = [{ action: "compensate" }];
  const r = await check(d);
  assert.deepEqual(r.issues.map((i) => i.kind), ["not ZK-provable"]);
});

test("andSequence and full IRIs are recognized", async () => {
  const d = JSON.parse(readFileSync(new URL("../policies/archive.jsonld", import.meta.url)));
  const lc = d["@graph"][0].permission[0].constraint[0];
  lc.andSequence = lc.or;
  delete lc.or;
  d["@graph"][2].leftOperand = "http://www.w3.org/ns/odrl/2/meteredTime";
  const r = await check(d);
  assert.deepEqual(r.issues.map((i) => i.construct).sort(), ["andSequence", "meteredTime"]);
});

test("policies/not-provable.jsonld lists duty and count", async () => {
  const d = JSON.parse(readFileSync(new URL("../policies/not-provable.jsonld", import.meta.url)));
  const r = await check(d);
  assert.deepEqual(r.issues.map((i) => `${i.kind}: ${i.construct}`).sort(), ["not ZK-provable: count", "not ZK-provable: duty"]);
});
