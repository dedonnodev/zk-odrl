// Turn an ODRL policy with one "gteq" constraint and a user's attributes
// into the circuit input.
// Usage: node scripts/policy-input.js <policy.json> <attributes.json>
import { readFileSync } from "node:fs";

const [policyFile, attrFile] = process.argv.slice(2);
const policy = JSON.parse(readFileSync(policyFile));
const attrs = JSON.parse(readFileSync(attrFile));

const rules = policy.permission ?? [];
const constraints = rules[0]?.constraint ?? [];
if (rules.length !== 1 || constraints.length !== 1) {
  throw new Error("only one permission with one constraint is supported");
}
const { leftOperand, operator, rightOperand } = constraints[0];
if (operator !== "gteq") throw new Error(`operator ${operator} not supported`);
if (!Number.isSafeInteger(rightOperand) || rightOperand < 0) {
  throw new Error("rightOperand must be a non-negative integer");
}

const name = leftOperand.split("/").pop();
if (!(name in attrs)) throw new Error(`missing attribute ${name}`);

console.log(JSON.stringify({
  attribute: String(attrs[name]),
  threshold: String(rightOperand),
}));
