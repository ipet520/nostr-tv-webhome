import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/css/05-home-tv.css", import.meta.url), "utf8");
const templateSource = readFileSync(new URL("../src/index.template.html", import.meta.url), "utf8");
function extract(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start) : source.indexOf("\n    }", start) + 6;
  assert.ok(end > start, `${name} has an end boundary`);
  return source.slice(start, end);
}

const criticalStepSource = extract("tvBrowseCriticalDampedStep", "tvBrowseD2RailStep");
const criticalStep = vm.runInNewContext(`${criticalStepSource}; tvBrowseCriticalDampedStep`);
const settle = (position, velocity, target) => Math.abs(target - position) <= 0.75 && Math.abs(velocity) <= 12;
function runMotion(target, seed = { position: 0, velocity: 0 }, maxFrames = 240) {
  let position = seed.position, velocity = seed.velocity;
  const trace = [];
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const next = criticalStep(position, velocity, target, 1000 / 60);
    position = next.position; velocity = next.velocity;
    trace.push({ position, velocity });
    if (settle(position, velocity, target)) return { position: target, velocity: 0, trace, settled: true };
  }
  return { position, velocity, trace, settled: false };
}

const right = runMotion(1000);
assert.equal(right.settled, true, "single target converges to the exact center target");
assert.ok(right.trace.every((item, index) => index === 0 || item.position >= right.trace[index - 1].position), "single rightward motion is monotonic");

let position = 0, velocity = 0;
for (let frame = 0; frame < 15; frame += 1) {
  ({ position, velocity } = criticalStep(position, velocity, 1000, 1000 / 60));
}
const beforeReverse = { position, velocity };
const immediateRedirect = criticalStep(position, velocity, 420, 0);
assert.equal(immediateRedirect.position, beforeReverse.position, "retargeting begins at the current logical position");
assert.equal(immediateRedirect.velocity, beforeReverse.velocity, "retargeting preserves velocity at the instant of redirection");
const afterReverse = criticalStep(position, velocity, 420, 1000 / 60);
assert.ok(Math.abs(afterReverse.position - beforeReverse.position) < 20, "the first redirected frame continues from the live position without a visible jump");
assert.ok(afterReverse.velocity < 0, "the reversed target redirects motion toward the newest target");
const reversed = runMotion(420, afterReverse);
assert.equal(reversed.settled, true, "reversed target eventually settles");

const cappedLargeStep = criticalStep(15, 320, 800, 200);
const cappedStep = criticalStep(15, 320, 800, 80);
assert.ok(Math.abs(cappedLargeStep.position - cappedStep.position) < 1e-9, "a delayed frame is capped at the D2 maximum integration interval");
assert.ok(Math.abs(cappedLargeStep.velocity - cappedStep.velocity) < 1e-9, "frame-gap capping preserves matching velocity integration");

const stepSource = extract("tvBrowseD2RailStep", "tvBrowseScheduleRailImagePreparation");
assert.match(stepSource, /tvBrowseCriticalDampedStep\(/, "the integrated RAF invokes the preserved D2 kernel");
assert.match(stepSource, /translate3d\(/, "D2 presents motion through the inner track transform");
assert.doesNotMatch(stepSource, /\b(?:rail|container)\.scrollLeft\s*=/, "D2 frames do not write native horizontal scroll position");
assert.match(stepSource, /Math\.abs\(goal - result\.position\) <= 0\.75/);
assert.match(stepSource, /Math\.abs\(result\.velocity\) <= 12/);
assert.match(stepSource, /generation !== Number\(scroll\.generation/);

const cancelSource = extract("tvBrowseCancelRailScroll", "tvBrowseScheduleRailAnchor");
const state = { railScroll: { frame: 9, generation: 3, velocity: 520, target: 800, targetKey: "x" } };
let canceled = 0;
const context = {
  tvBrowseState: () => state,
  tvBrowseClearRailAnchorFocusVisual: () => true,
  $(id) { return id === "tvBrowseRail" ? {} : null; },
  cancelAnimationFrame(id) { canceled = id; }
};
vm.runInNewContext(`${cancelSource}; tvBrowseCancelRailScroll()`, context);
assert.equal(canceled, 9, "cancel releases the owned RAF");
assert.equal(state.railScroll.frame, 0);
assert.equal(state.railScroll.generation, 4, "late RAF callbacks are invalidated");
assert.equal(state.railScroll.velocity, 0, "cancellation does not leak velocity to a new rail session");
assert.equal(state.railScroll.target, null);
assert.match(source, /window\.__TV_BROWSE_RAIL_MOTION__\s*\|\|\s*"d2"/, "the selected D2 controller has a testable local baseline rollback switch");
assert.match(cssSource, /#tvBrowseRail\[data-rail-motion-mode="d2"\]\s*\{\s*overflow-x:\s*hidden;/, "D2 owns the physical rail only in D2 mode");
assert.match(templateSource, /id="tvBrowseRail"[^>]*data-rail-motion-mode="d2"/, "the rail starts with D2 visual state before runtime binding");

console.log("TV_BROWSE_D2_MOTION_VM = PASS");
