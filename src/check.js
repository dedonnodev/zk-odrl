// Compatibility check of an ODRL policy with this library: either compatible,
// with the compiled output, or a list of issues of two kinds
// (docs/design/profilo-odrl.md §11):
// - "not ZK-provable": the construct needs future actions, an order of events
//   or memory across uses, so no single proof can show it;
// - "out of profile": provable in principle, left out of the prototype.
// Every not-provable construct is listed; of the out-of-profile ones only the
// first is, because the compiler stops there.
import { compile, ProfileError } from "./compile.js";

const ODRL = "http://www.w3.org/ns/odrl/2/";
const NOT_PROVABLE_PROPERTIES = ["duty", "obligation", "consequence", "remedy", "andSequence", "status"];
const NOT_PROVABLE_OPERANDS = ["count", "meteredTime", "elapsedTime", "timeInterval", "delayPeriod", "event", "payAmount"];

const term = (s) => s.replace(ODRL, "").replace(/^odrl:/, "");

function notProvable(x, path, out) {
  if (Array.isArray(x)) {
    x.forEach((y, i) => notProvable(y, `${path}[${i}]`, out));
  } else if (x && typeof x === "object") {
    for (const [k, v] of Object.entries(x)) {
      const here = path ? `${path}.${term(k)}` : term(k);
      if (NOT_PROVABLE_PROPERTIES.includes(term(k))) out.push({ construct: term(k), path: here });
      if (term(k) === "leftOperand" && typeof v === "string" && NOT_PROVABLE_OPERANDS.includes(term(v))) {
        out.push({ construct: term(v), path: here });
      }
      notProvable(v, here, out);
    }
  }
  return out;
}

export async function check(doc, options) {
  const issues = notProvable(doc, "", []).map(({ construct, path }) => ({
    kind: "not ZK-provable", construct, message: `${construct} at ${path}`,
  }));
  try {
    const compiled = await compile(doc, options);
    return { compatible: issues.length === 0, issues, compiled };
  } catch (e) {
    if (!(e instanceof ProfileError)) throw e;
    // the compiler stops at the first construct it rejects: skip it if it is
    // one of the not-provable constructs already listed
    if (!issues.some((i) => new RegExp(`\\b${i.construct}\\b`).test(e.message))) {
      issues.push({ kind: "out of profile", message: e.message });
    }
    return { compatible: false, issues };
  }
}
