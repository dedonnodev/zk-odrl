// ODRL policy (JSON-LD) -> circuit slots, following the profile in
// docs/design/profilo-odrl.md and the slot layout in docs/design/design.md §5.
// Anything outside the profile is rejected with a ProfileError.
import jsonld from "jsonld";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const ODRL = "http://www.w3.org/ns/odrl/2/";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const PROFILE = "https://github.com/dedonnodev/zk-odrl/profile";
const CONTEXT = [
  "http://www.w3.org/ns/odrl.jsonld",
  { zk: `${PROFILE}#`, ex: "http://example.com/" },
];
const odrlContext = JSON.parse(readFileSync(new URL("../vocab/odrl.jsonld", import.meta.url)));
export const vocab = JSON.parse(readFileSync(new URL("../vocab/attributes.json", import.meta.url)));

export const OPS = { eq: 1, neq: 2, lt: 3, lteq: 4, gt: 5, gteq: 6, isAnyOf: 7, isNoneOf: 8 };
const ALLOWED_OPS = {
  enum: ["eq", "neq", "isAnyOf", "isNoneOf"],
  integer: Object.keys(OPS),
  dateTime: ["lt", "lteq", "gt", "gteq"],
};
const MODES = { and: 1, or: 2, xone: 3 };
const MAX = 2n ** 64n;

export class ProfileError extends Error {}
const fail = (msg) => { throw new ProfileError(msg); };

// expanded key of a compact ODRL term
const key = (k) => (k.startsWith("@") ? k : ODRL + k);
const short = (iri) => iri.replace(ODRL, "").replace(`${PROFILE}#`, "");
const values = (node, k) => node[key(k)] ?? [];
// the IRI of a bare reference {"@id": …}; undefined for a node with more
// properties (e.g. a refinement), which must not be silently dropped
const idOf = (v) => (Object.keys(v).length === 1 ? v["@id"] : undefined);
const isType = (node, t) => node["@type"]?.includes(ODRL + t) ?? false;
const isConstraint = (n) => isType(n, "Constraint") || isType(n, "LogicalConstraint");

function only(node, keys, where) {
  const allowed = keys.map(key);
  for (const k of Object.keys(node)) {
    if (!allowed.includes(k)) fail(`${where}: ${short(k)} is out of profile`);
  }
}

function iri(node, k, where) {
  const v = values(node, k);
  if (v.length !== 1) fail(`${where}: exactly one ${k} required`);
  return idOf(v[0]) ?? fail(`${where}: ${k} must be an IRI`);
}

// The policy uses only an offline copy of the ODRL context.
async function documentLoader(url) {
  if (url !== CONTEXT[0]) throw new Error(`remote context not allowed: ${url}`);
  return { document: odrlContext, documentUrl: url };
}

// Returns one compiled policy per (target, action) pair:
// { resourceId, perm: {mode, slots}, proh: {mode, slots}, prohActive },
// each slot { idx, op, len, val: bigint[K] }, N slots per rule.
export async function compile(doc, { N = 4, K = 4 } = {}) {
  // a slot hash has K + 3 inputs, circomlib Poseidon takes at most 16
  if (!Number.isInteger(N) || !Number.isInteger(K) || K < 1 || K > 13 || N < 1) throw new RangeError("need integers N >= 1 and 1 <= K <= 13");
  if (!isDeepStrictEqual(doc["@context"], CONTEXT)) {
    fail(`@context must be ${JSON.stringify(CONTEXT)}`);
  }
  // a nested @context could redefine terms (e.g. "eq" as neq) unseen by a reader
  const nested = (x, top) => x && typeof x === "object"
    && ((!top && "@context" in x) || Object.values(x).some((y) => nested(y, false)));
  if (nested(doc, true)) fail("@context is allowed only at the top of the document");
  let nodes;
  try {
    nodes = await jsonld.expand(doc, { documentLoader, safe: true });
  } catch (e) {
    fail(`invalid JSON-LD: ${e.message}`);
  }

  const ids = nodes.filter((n) => n["@id"]).map((n) => n["@id"]);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) fail(`node ${dup} is defined twice`);
  const byId = new Map(nodes.filter((n) => n["@id"]).map((n) => [n["@id"], n]));
  const policies = nodes.filter((n) => !isConstraint(n));
  if (policies.length !== 1) fail("the document must contain exactly one policy");
  const p = policies[0];
  only(p, ["@id", "@type", "profile", "conflict", "permission", "prohibition",
    "target", "action", "assignee", "assigner"], "policy");
  if (!isDeepStrictEqual(p["@type"], [ODRL + "Set"])) fail("policy: @type must be Set");
  if (!p["@id"]) fail("policy: uid is required");
  if (p["@id"].startsWith("_:")) fail("policy: uid must be an IRI, not a blank node");
  if (iri(p, "profile", "policy") !== PROFILE) fail(`policy: profile must be ${PROFILE}`);
  if (iri(p, "conflict", "policy") !== ODRL + "prohibit") fail("policy: conflict must be prohibit");

  const perms = values(p, "permission");
  const prohs = values(p, "prohibition");
  if (perms.length !== 1) fail("policy: exactly one permission required");
  if (prohs.length > 1) fail("policy: at most one prohibition allowed");

  // ODRL Information Model 2.2 §2.7.1: policy-level target, action, assignee apply to every rule
  const shared = (rule) => {
    const out = { ...rule };
    for (const k of ["target", "action", "assignee"]) {
      if (p[key(k)]) out[key(k)] = [...values(rule, k), ...values(p, k)];
    }
    return out;
  };
  const ctx = { byId, used: new Set(), N, K };
  const perm = parseRule(shared(perms[0]), "permission", ctx);
  const proh = prohs.length ? parseRule(shared(prohs[0]), "prohibition", ctx) : null;
  for (const [id, n] of byId) {
    if (isConstraint(n) && !ctx.used.has(id)) fail(`constraint ${id} is not referenced by any rule`);
  }
  if (proh && (proh.target !== perm.target
      || !isDeepStrictEqual([...proh.actions].sort(), [...perm.actions].sort()))) {
    fail("prohibition: target and actions must equal the permission's");
  }

  return perm.actions.map((action) => {
    const r = vocab.resources.find((r) => r.target === perm.target && r.action === action);
    if (!r) fail(`no resourceId for (${perm.target}, ${short(action)}) in vocab/attributes.json`);
    return {
      resourceId: r.id,
      perm: pad(perm, N, K),
      proh: pad(proh ?? { mode: MODES.and, slots: [] }, N, K),
      prohActive: proh ? 1 : 0,
    };
  });
}

function parseRule(rule, where, ctx) {
  only(rule, ["target", "action", "assignee", "assigner", "constraint"], where);
  const target = iri(rule, "target", where);
  // an action listed twice is the same action: one compiled policy
  const actions = [...new Set(values(rule, "action").map((a) => idOf(a) ?? fail(`${where}: action must be an IRI`)))];
  if (!actions.length) fail(`${where}: at least one action required`);
  if (rule[key("assignee")] && iri(rule, "assignee", where) !== vocab.registry) {
    fail(`${where}: assignee must be the issuer registry ${vocab.registry}`);
  }

  let constraints = values(rule, "constraint");
  let mode = MODES.and;
  if (constraints.some((c) => isType(c, "LogicalConstraint"))) {
    if (constraints.length !== 1) fail(`${where}: a LogicalConstraint must be the only constraint of the rule`);
    const [lc] = constraints;
    only(lc, ["@type", "@id", "and", "or", "xone"], `${where} logical constraint`);
    const names = Object.keys(MODES).filter((m) => lc[key(m)]);
    if (names.length !== 1) fail(`${where}: a LogicalConstraint needs exactly one of and, or, xone`);
    mode = MODES[names[0]];
    constraints = lc[key(names[0])].flatMap((x) => x["@list"] ?? [x]).map((ref) => {
      const id = ref["@id"];
      if (!id || Object.keys(ref).length !== 1) fail(`${where}: logical operands must be references {"@id": …}`);
      const node = ctx.byId.get(id) ?? fail(`${where}: unresolved constraint reference ${id}`);
      if (ctx.used.has(id)) fail(`${where}: constraint ${id} referenced twice`);
      ctx.used.add(id);
      return node;
    });
    if (!constraints.length) fail(`${where}: a LogicalConstraint needs at least one operand`);
  }
  if (constraints.length > ctx.N) fail(`${where}: ${constraints.length} constraints, at most N = ${ctx.N}`);
  return { target, actions, mode, slots: constraints.map((c) => parseConstraint(c, where, ctx.K)) };
}

function parseConstraint(c, where, K) {
  if (isType(c, "LogicalConstraint")) fail(`${where}: nested logical constraints are out of profile`);
  only(c, ["@id", "@type", "leftOperand", "operator", "rightOperand"], `${where} constraint`);
  const left = iri(c, "leftOperand", where);
  const idx = vocab.operands.findIndex((o) => o.iri === left);
  if (idx < 0) fail(`${where}: leftOperand ${short(left)} is not supported`);
  const operand = vocab.operands[idx];
  const op = short(iri(c, "operator", where));
  if (!ALLOWED_OPS[operand.type].includes(op)) {
    fail(`${where}: operator ${op} not allowed on ${operand.type} ${short(left)}`);
  }

  const raw = values(c, "rightOperand");
  const isSet = op === "isAnyOf" || op === "isNoneOf";
  if (isSet ? raw.length < 1 || raw.length > K : raw.length !== 1) {
    fail(`${where}: ${op} takes ${isSet ? `1..${K} values` : "one value"}, got ${raw.length}`);
  }
  // sorted, so that the same set always gives the same slot and policyHash
  const val = raw.map((v) => encode(v, operand, where)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (new Set(val).size !== val.length) fail(`${where}: duplicate values in ${op}`);
  return { idx, op: OPS[op], len: val.length, val };
}

function encode(v, operand, where) {
  if (operand.type === "enum") {
    const id = idOf(v) ?? fail(`${where}: enum value must be an IRI {"@id": …}`);
    const name = id.startsWith(operand.iri + "/") ? id.slice(operand.iri.length + 1) : undefined;
    // hasOwn: "constructor" or "__proto__" must not resolve to Object.prototype
    const code = name !== undefined && Object.hasOwn(operand.values, name) ? operand.values[name] : undefined;
    if (code === undefined) fail(`${where}: unknown value ${id}`);
    return BigInt(code);
  }
  const { "@value": x, "@type": t, ...rest } = v;
  if (x === undefined || Object.keys(rest).length) fail(`${where}: value must be a literal`);
  let n;
  if (operand.type === "dateTime") {
    // explicit timezone required (ODRL Vocabulary 2.2 §4.5.6), converted to UTC seconds
    // whole seconds only: flooring a fraction would loosen a gteq threshold
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/;
    if (t !== XSD + "dateTime" || !iso.test(x) || Number.isNaN(Date.parse(x)) || !isCalendarDate(x)) {
      fail(`${where}: dateTime must be an xsd:dateTime in whole seconds with timezone, got ${JSON.stringify(x)}`);
    }
    n = BigInt(Date.parse(x) / 1000);
  } else if (typeof x === "number" && t === undefined) {
    // JSON numbers are doubles: above 2^53 - 1 they may be silently rounded
    if (!Number.isSafeInteger(x) || x < 0) fail(`${where}: JSON number must be an integer in 0..2^53-1, got ${x}`);
    n = BigInt(x);
  } else if (t === XSD + "integer" && typeof x === "string" && /^\d+$/.test(x)) {
    n = BigInt(x);
  } else {
    fail(`${where}: integer must be a non-negative JSON integer or {"@value": "…", "@type": "xsd:integer"}`);
  }
  if (n < 0n || n >= MAX) fail(`${where}: value ${n} does not fit in 64 bits`);
  return n;
}

// Date.parse rolls 2027-02-30 over to March 2 instead of rejecting it
function isCalendarDate(x) {
  const [y, m, d] = x.slice(0, 10).split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d));
  return day.getUTCFullYear() === y && day.getUTCMonth() === m - 1 && day.getUTCDate() === d;
}

function pad({ mode, slots }, N, K) {
  const full = slots.map((s) => ({ ...s, val: [...s.val, ...Array(K - s.len).fill(0n)] }));
  while (full.length < N) full.push({ idx: 0, op: 0, len: 0, val: Array(K).fill(0n) });
  return { mode, slots: full };
}
