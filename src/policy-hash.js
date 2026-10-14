// policyHash of a compiled policy, preimage order of docs/design/design.md §6.
// Must match the circuit: same Poseidon (circomlib <-> poseidon-lite).
import * as poseidon from "poseidon-lite";

const H = (xs) => poseidon[`poseidon${xs.length}`](xs.map(BigInt));

const ruleHash = ({ mode, slots }) =>
  slots.reduce((h, s) => H([h, H([s.idx, s.op, s.len, ...s.val])]), BigInt(mode));

export const policyHash = (c) =>
  H([ruleHash(c.perm), ruleHash(c.proh), c.prohActive, c.resourceId]);
