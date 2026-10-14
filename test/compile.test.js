import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile, ProfileError } from "../src/compile.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../policies/${f}`, import.meta.url)));
const printer = () => load("printer.jsonld");
const archive = () => load("archive.jsonld");
const off = { idx: 0, op: 0, len: 0, val: [0n, 0n, 0n, 0n] };

const rejects = (doc, pattern) => assert.rejects(compile(doc), (e) => {
  assert.ok(e instanceof ProfileError, `expected ProfileError, got ${e}`);
  assert.match(e.message, pattern);
  return true;
});

test("printer compiles to the slot table of profilo-odrl.md §9", async () => {
  assert.deepEqual(await compile(printer()), [{
    resourceId: 1,
    perm: { mode: 1, slots: [
      { idx: 0, op: 7, len: 2, val: [1n, 2n, 0n, 0n] },
      { idx: 4, op: 3, len: 1, val: [5n, 0n, 0n, 0n] },
      off, off,
    ] },
    proh: { mode: 1, slots: [{ idx: 3, op: 1, len: 1, val: [2n, 0n, 0n, 0n] }, off, off, off] },
    prohActive: 1,
  }]);
});

test("or over @graph references compiles to mode 2", async () => {
  const [c] = await compile(archive());
  assert.equal(c.resourceId, 3);
  assert.equal(c.perm.mode, 2);
  assert.deepEqual(c.perm.slots.slice(0, 2), [
    { idx: 1, op: 1, len: 1, val: [2n, 0n, 0n, 0n] },
    { idx: 2, op: 6, len: 1, val: [3n, 0n, 0n, 0n] },
  ]);
  assert.equal(c.prohActive, 0);
  assert.deepEqual(c.proh, { mode: 1, slots: [off, off, off, off] });
});

test("xone compiles to mode 3", async () => {
  const d = archive();
  const lc = d["@graph"][0].permission[0].constraint[0];
  lc.xone = lc.or;
  delete lc.or;
  assert.equal((await compile(d))[0].perm.mode, 3);
});

test("set order does not change the slot", async () => {
  const d = printer();
  d.permission[0].constraint[0].rightOperand.reverse();
  assert.deepEqual(await compile(d), await compile(printer()));
});

test("policy-level target and action apply to every rule", async () => {
  const d = printer();
  d.target = "ex:resource/printer-3F";
  d.action = "print";
  for (const r of [...d.permission, ...d.prohibition]) { delete r.target; delete r.action; }
  assert.deepEqual(await compile(d), await compile(printer()));
});

test("one compiled policy per (target, action) pair", async () => {
  const d = printer();
  d.permission[0].action = d.prohibition[0].action = ["print", "reproduce"];
  assert.deepEqual((await compile(d)).map((c) => c.resourceId), [1, 2]);
});

test("a repeated action compiles once", async () => {
  const d = printer();
  d.permission[0].action = d.prohibition[0].action = ["print", "print"];
  assert.deepEqual(await compile(d), await compile(printer()));
});

test("N and K must be integers", async () => {
  for (const opts of [{ N: Number.NaN }, { N: 2.5 }, { K: Number.NaN }, { K: 1.5 }]) {
    await assert.rejects(compile(printer(), opts), RangeError, JSON.stringify(opts));
  }
});

test("integer and dateTime literals are encoded", async () => {
  const d = printer();
  d.permission[0].constraint[1].rightOperand = 5; // plain JSON number
  d.permission[0].constraint.push({
    leftOperand: "dateTime", operator: "lt",
    rightOperand: { "@value": "2027-01-01T01:00:00+01:00", "@type": "xsd:dateTime" },
  });
  const [c] = await compile(d);
  assert.deepEqual(c.perm.slots[1].val, [5n, 0n, 0n, 0n]);
  assert.deepEqual(c.perm.slots[2], { idx: 5, op: 3, len: 1, val: [1798761600n, 0n, 0n, 0n] });
});

test("a permission without constraints compiles to no enabled slot", async () => {
  const d = printer();
  delete d.permission[0].constraint;
  delete d.prohibition;
  const [c] = await compile(d);
  assert.deepEqual(c.perm, { mode: 1, slots: [off, off, off, off] });
});

// each case breaks printer.jsonld (or archive.jsonld) in one way
const bad = {
  "@context": [(d) => { d["@context"][1].zk = "http://other/#"; }, /@context/],
  "policy type": [(d) => { d["@type"] = "Agreement"; }, /must be Set/],
  "missing uid": [(d) => { delete d.uid; }, /uid is required/],
  "wrong profile": [(d) => { d.profile = "http://example.com/p"; }, /profile must be/],
  "conflict perm": [(d) => { d.conflict = "perm"; }, /conflict must be prohibit/],
  "two permissions": [(d) => { d.permission.push(d.permission[0]); }, /exactly one permission/],
  "two prohibitions": [(d) => { d.prohibition.push(d.prohibition[0]); }, /at most one prohibition/],
  "duty": [(d) => { d.permission[0].duty = [{ action: "compensate" }]; }, /duty is out of profile/],
  "inheritFrom": [(d) => { d.inheritFrom = "ex:policy/base"; }, /inheritFrom is out of profile/],
  "unknown leftOperand": [(d) => { d.permission[0].constraint[1].leftOperand = "spatial"; }, /spatial is not supported/],
  "unsupported operator": [(d) => { d.permission[0].constraint[0].operator = "isA"; }, /operator isA not allowed/],
  "lt on an enum": [(d) => { d.prohibition[0].constraint[0].operator = "lt"; }, /operator lt not allowed on enum/],
  "eq on dateTime": [(d) => {
    d.permission[0].constraint[1] = { leftOperand: "dateTime", operator: "eq",
      rightOperand: { "@value": "2027-01-01T00:00:00Z", "@type": "xsd:dateTime" } };
  }, /operator eq not allowed on dateTime/],
  "dateTime without timezone": [(d) => {
    d.permission[0].constraint[1] = { leftOperand: "dateTime", operator: "lt",
      rightOperand: { "@value": "2027-01-01T00:00:00", "@type": "xsd:dateTime" } };
  }, /with timezone/],
  "unknown enum value": [(d) => { d.prohibition[0].constraint[0].rightOperand = { "@id": "zk:badgeStatus/lost" }; }, /unknown value/],
  "enum as plain string": [(d) => { d.prohibition[0].constraint[0].rightOperand = "zk:badgeStatus/suspended"; }, /must be an IRI/],
  "set larger than K": [(d) => {
    d.permission[0].constraint[0].rightOperand = ["RnD", "Admin", "Sales", "Operations", "RnD"]
      .map((v) => ({ "@id": `zk:department/${v}` }));
  }, /1\.\.4 values, got 5/],
  "duplicate set values": [(d) => {
    d.permission[0].constraint[0].rightOperand = [{ "@id": "zk:department/RnD" }, { "@id": "zk:department/RnD" }];
  }, /duplicate values/],
  "two values on eq": [(d) => {
    d.prohibition[0].constraint[0].rightOperand = [{ "@id": "zk:badgeStatus/active" }, { "@id": "zk:badgeStatus/suspended" }];
  }, /one value, got 2/],
  "2^64": [(d) => { d.permission[0].constraint[1].rightOperand["@value"] = "18446744073709551616"; }, /does not fit in 64 bits/],
  "JSON number above 2^53 - 1": [(d) => { d.permission[0].constraint[1].rightOperand = 2 ** 53; }, /0\.\.2\^53-1/],
  "negative integer": [(d) => { d.permission[0].constraint[1].rightOperand["@value"] = "-1"; }, /non-negative/],
  "decimal number": [(d) => { d.permission[0].constraint[1].rightOperand = 4.5; }, /0\.\.2\^53-1/],
  "rightOperandReference": [(d) => {
    const c = d.permission[0].constraint[1];
    delete c.rightOperand;
    c.rightOperandReference = "ex:threshold";
  }, /rightOperandReference is out of profile/],
  "more than N constraints": [(d) => {
    const c = d.permission[0].constraint;
    c.push(c[1], c[1], c[1]);
  }, /5 constraints, at most N = 4/],
  "prohibition on another action": [(d) => { d.prohibition[0].action = "reproduce"; }, /must equal the permission's/],
  "unknown resource": [(d) => { d.permission[0].target = d.prohibition[0].target = "ex:resource/fax"; }, /no resourceId/],
  "misspelled property": [(d) => {
    d.permission[0].constraints = d.permission[0].constraint;
    delete d.permission[0].constraint;
  }, /invalid JSON-LD/],
  "assignee with a refinement": [(d) => {
    d.permission[0].assignee = { "@id": "ex:registry/employees", refinement: [{ leftOperand: "zk:role", operator: "eq", rightOperand: { "@id": "zk:role/manager" } }] };
  }, /assignee must be an IRI/],
  "target with a refinement": [(d) => {
    d.permission[0].target = d.prohibition[0].target = { "@id": "ex:resource/printer-3F", "@type": "AssetCollection", refinement: [{ leftOperand: "zk:role", operator: "eq", rightOperand: { "@id": "zk:role/manager" } }] };
  }, /target must be an IRI/],
  "action with a refinement": [(d) => {
    d.permission[0].action = d.prohibition[0].action = [{ "@id": "odrl:print", refinement: [{ leftOperand: "zk:role", operator: "eq", rightOperand: { "@id": "zk:role/manager" } }] }];
  }, /action must be an IRI/],
  "operator with extra properties": [(d) => {
    d.prohibition[0].constraint[0].operator = { "@id": "odrl:eq", "ex:note": "x" };
  }, /operator must be an IRI/],
  "embedded @context": [(d) => { d.prohibition[0]["@context"] = { eq: "http://www.w3.org/ns/odrl/2/neq" }; }, /@context is allowed only at the top/],
  "impossible date": [(d) => {
    d.permission[0].constraint[1] = { leftOperand: "dateTime", operator: "lt",
      rightOperand: { "@value": "2027-02-30T00:00:00Z", "@type": "xsd:dateTime" } };
  }, /with timezone/],
  "empty logical constraint": [(d) => {
    d.prohibition[0].constraint = [{ "@type": "LogicalConstraint", or: { "@list": [] } }];
  }, /at least one operand/],
  "fractional seconds": [(d) => {
    d.permission[0].constraint[1] = { leftOperand: "dateTime", operator: "gteq",
      rightOperand: { "@value": "2027-01-01T00:00:00.9Z", "@type": "xsd:dateTime" } };
  }, /whole seconds/],
  "enum value named like an Object property": [(d) => {
    d.prohibition[0].constraint[0].rightOperand = { "@id": "zk:badgeStatus/constructor" };
  }, /unknown value/],
  "blank-node uid": [(d) => { d.uid = "_:b0"; }, /uid must be an IRI/],
  "wrong assignee": [(d) => { d.permission[0].assignee = "ex:someone"; }, /issuer registry/],
};
for (const [name, [mutate, pattern]] of Object.entries(bad)) {
  test(`rejects: ${name}`, () => { const d = printer(); mutate(d); return rejects(d, pattern); });
}

const badLogical = {
  "nested logical constraint": [(g) => {
    g[2] = { "@type": "LogicalConstraint", uid: "ex:policy/archive/c2", and: { "@list": [{ "@id": "ex:policy/archive/c1" }] } };
  }, /nested logical constraints/],
  "mixed simple and logical": [(g) => {
    g[0].permission[0].constraint.push({ leftOperand: "zk:role", operator: "eq", rightOperand: { "@id": "zk:role/employee" } });
  }, /must be the only constraint/],
  "andSequence": [(g) => {
    const lc = g[0].permission[0].constraint[0];
    lc.andSequence = lc.or;
    delete lc.or;
  }, /andSequence is out of profile/],
  "unresolved reference": [(g) => { g.pop(); }, /unresolved constraint reference/],
  "unreferenced constraint": [(g) => { g[0].permission[0].constraint[0].or["@list"].pop(); }, /not referenced by any rule/],
  "duplicate @id in @graph": [(g) => {
    g.splice(2, 0, { ...g[2], rightOperand: { "@value": "5", "@type": "xsd:integer" } });
  }, /defined twice/],
  "constraint referenced twice": [(g) => {
    g[0].permission[0].constraint[0].or["@list"][1] = { "@id": "ex:policy/archive/c1" };
    g.pop();
  }, /referenced twice/],
};
for (const [name, [mutate, pattern]] of Object.entries(badLogical)) {
  test(`rejects: ${name}`, () => { const d = archive(); mutate(d["@graph"]); return rejects(d, pattern); });
}
