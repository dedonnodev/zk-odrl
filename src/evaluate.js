// Reference semantics of the circuit (docs/design/design.md §5), used as a
// test oracle: compiled policy + evaluable values -> grant (true) or deny.

import { vocab } from "./compile.js";

const LEAF = ["department", "role", "clearanceLevel", "badgeStatus"];

// User attributes by name ({ department: "RnD", clearanceLevel: 3, … }) ->
// codes of vocab/attributes.json, as the issuer would attest them.
export function attributeCodes(attrs) {
  const out = {};
  for (const name of LEAF) {
    const operand = vocab.operands.find((o) => o.iri.endsWith(`#${name}`));
    const v = attrs[name];
    if (v === undefined) throw new Error(`missing ${name}`);
    if (operand.type === "enum") {
      if (!Object.hasOwn(operand.values, v)) throw new Error(`unknown ${name} ${v}`);
      out[name] = BigInt(operand.values[v]);
    } else {
      if (!Number.isSafeInteger(v) || v < 0) throw new Error(`${name} must be a non-negative integer`);
      out[name] = BigInt(v);
    }
  }
  return out;
}

// env: evaluable values, indexed in the order of the operands of
// vocab/attributes.json; attributes are codes
export function environment({ department, role, clearanceLevel, badgeStatus }, now) {
  const t = BigInt(now);
  const dayOfWeek = (t / 86400n + 3n) % 7n; // 1970-01-01 was a Thursday, Monday = 0
  return [department, role, clearanceLevel, badgeStatus].map(BigInt).concat(dayOfWeek, t);
}

export function evaluate(c, env) {
  return rule(c.perm, env) && !(c.prohActive && rule(c.proh, env));
}

function rule({ mode, slots }, env) {
  const on = slots.filter((s) => s.op !== 0);
  const S = on.filter((s) => slot(s, env[s.idx])).length;
  return mode === 1 ? S === on.length : mode === 2 ? S >= 1 : S === 1;
}

function slot({ op, len, val }, x) {
  // only the first len entries count: 0 padding is a valid integer value
  const any = val.slice(0, len).includes(x);
  return [false, x === val[0], x !== val[0], x < val[0], x <= val[0],
    x > val[0], x >= val[0], any, !any][op];
}
