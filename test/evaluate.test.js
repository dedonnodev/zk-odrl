import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compile } from "../src/compile.js";
import { environment, evaluate } from "../src/evaluate.js";

const printer = JSON.parse(readFileSync(new URL("../policies/printer.jsonld", import.meta.url)));
const WEDNESDAY = 1791374400; // 2026-10-07T12:00:00Z
const SATURDAY = 1791633600; // 2026-10-10T12:00:00Z
const MONDAY = 1791201600; // 2026-10-05T12:00:00Z
const user = (department, badgeStatus) => ({ department, role: 1, clearanceLevel: 0, badgeStatus });

test("dayOfWeek is Monday = 0", () => {
  assert.equal(environment(user(1, 1), MONDAY)[4], 0n);
  assert.equal(environment(user(1, 1), WEDNESDAY)[4], 2n);
  assert.equal(environment(user(1, 1), SATURDAY)[4], 5n);
});

test("printer: expected outcomes of profilo-odrl.md §9", async () => {
  const [c] = await compile(printer);
  assert.equal(evaluate(c, environment(user(1, 1), WEDNESDAY)), true); // R&D, active
  assert.equal(evaluate(c, environment(user(3, 1), WEDNESDAY)), false); // Sales
  assert.equal(evaluate(c, environment(user(1, 1), SATURDAY)), false); // weekend
  assert.equal(evaluate(c, environment(user(1, 2), WEDNESDAY)), false); // suspended
});

test("printer: every department, badge and day agrees with the policy text", async () => {
  const [c] = await compile(printer);
  for (let department = 1; department <= 4; department++) {
    for (let badgeStatus = 1; badgeStatus <= 2; badgeStatus++) {
      for (let day = 0; day < 7; day++) {
        const now = MONDAY + day * 86400;
        const expected = department <= 2 && day < 5 && badgeStatus !== 2;
        assert.equal(evaluate(c, environment(user(department, badgeStatus), now)), expected,
          `department ${department}, badge ${badgeStatus}, day ${day}`);
      }
    }
  }
});

test("set padding never matches: isAnyOf [2, 4] is false on Monday (0)", () => {
  const slot = { idx: 4, op: 7, len: 2, val: [2n, 4n, 0n, 0n] };
  const off = { idx: 0, op: 0, len: 0, val: [0n, 0n, 0n, 0n] };
  const c = { perm: { mode: 1, slots: [slot, off, off, off] }, proh: { mode: 1, slots: [off, off, off, off] }, prohActive: 0 };
  assert.equal(evaluate(c, environment(user(1, 1), MONDAY)), false);
  assert.equal(evaluate(c, environment(user(1, 1), WEDNESDAY)), true);
});

test("or and xone: archive policy", async () => {
  const archive = JSON.parse(readFileSync(new URL("../policies/archive.jsonld", import.meta.url)));
  const [or] = await compile(archive);
  const xone = { ...or, perm: { ...or.perm, mode: 3 } };
  const who = (role, clearanceLevel) => environment({ department: 1, role, clearanceLevel, badgeStatus: 1 }, MONDAY);
  assert.equal(evaluate(or, who(2, 5)), true); // manager and level 5: both true
  assert.equal(evaluate(xone, who(2, 5)), false);
  assert.equal(evaluate(or, who(1, 3)), true);
  assert.equal(evaluate(xone, who(1, 3)), true);
  assert.equal(evaluate(or, who(1, 2)), false);
});

test("attributes by name are encoded with the vocab table", async () => {
  const { attributeCodes } = await import("../src/evaluate.js");
  assert.deepEqual(
    attributeCodes({ department: "Admin", role: "contractor", clearanceLevel: 3, badgeStatus: "active" }),
    { department: 2n, role: 3n, clearanceLevel: 3n, badgeStatus: 1n },
  );
  assert.throws(() => attributeCodes({ department: "Legal", role: "employee", clearanceLevel: 0, badgeStatus: "active" }), /unknown department Legal/);
  assert.throws(() => attributeCodes({ department: "RnD", role: "employee", badgeStatus: "active" }), /missing clearanceLevel/);
  assert.throws(() => attributeCodes({ department: "RnD", role: "employee", clearanceLevel: "high", badgeStatus: "active" }), /clearanceLevel must be a non-negative integer/);
});
