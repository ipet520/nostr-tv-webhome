import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/js/19-pan-results-handoff-return.js", import.meta.url), "utf8");
const sessionSource = readFileSync(new URL("../src/js/07a-detail-session.js", import.meta.url), "utf8");
const signature = "function panAutoHealthAdmission(item, freshHealth)";
const start = source.indexOf(signature);
assert.notEqual(start, -1, "panAutoHealthAdmission must remain the automatic health authority");
const open = source.indexOf("{", start);
let depth = 0;
let end = -1;
for (let index = open; index < source.length; index += 1) {
  if (source[index] === "{") depth += 1;
  if (source[index] === "}") {
    depth -= 1;
    if (depth === 0) { end = index + 1; break; }
  }
}
assert.notEqual(end, -1, "panAutoHealthAdmission function must be complete");

const admission = source.slice(start, end);
const result = vm.runInNewContext(`
  const state = { pan: { health: { "quark|https://pan.example/share": { state: "ok", checkedAt: 1, expiresAt: Date.now() + 60000 } } } };
  const panHealthKey = item => item.diskType + "|" + item.url;
  const isPanHealthFresh = () => true;
  const isPanCheckSupported = () => true;
  const panCheckAvailable = () => true;
  ${admission}
  const item = { diskType: "quark", url: "https://pan.example/share" };
  ({ freshBad: panAutoHealthAdmission(item, { "quark|https://pan.example/share": "bad" }),
     freshLocked: panAutoHealthAdmission(item, { "quark|https://pan.example/share": "locked" }),
     freshOk: panAutoHealthAdmission(item, { "quark|https://pan.example/share": "ok" }),
     cachedOk: panAutoHealthAdmission(item, {}) });
`);

assert.equal(result.freshBad.accepted, false);
assert.equal(result.freshBad.reason, "FRESH_REJECTED");
assert.equal(result.freshLocked.accepted, false);
assert.equal(result.freshOk.accepted, true);
assert.equal(result.cachedOk.accepted, true);
assert.match(sessionSource, /panAutoHealthAdmission\(candidate, freshHealth\)/);
assert.match(sessionSource, /\[panHealthKey\(candidate\)\]: preflight\.state/);

console.log("FRESH_BAD_OVERRIDES_CACHED_OK = PASS");
console.log("FRESH_LOCKED_REJECTED = PASS");
console.log("FRESH_OK_ACCEPTED = PASS");
console.log("UNAVAILABLE_PREFLIGHT_USES_CACHED_POLICY = PASS");
console.log("DETAIL_SESSION_PASSES_CURRENT_PREFLIGHT = PASS");
