import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/css/05-home-tv.css", import.meta.url), "utf8");
const templateSource = readFileSync(new URL("../src/index.template.html", import.meta.url), "utf8");

function extractFunction(name, nextName) {
  const start = source.indexOf("function " + name + "(");
  assert.notEqual(start, -1, name + " exists");
  const end = nextName ? source.indexOf("function " + nextName + "(", start) : -1;
  assert.ok(end > start, name + " has an end boundary");
  return source.slice(start, end);
}

const stepSource = extractFunction("tvBrowseTransformRailStep", "tvBrowseScheduleRailImagePreparation");
const writeSource = extractFunction("tvBrowseWriteRailPosition", "tvBrowseRailPositionChanged");
assert.match(stepSource, /1 - Math\.exp\(-elapsed \/ 48\)/, "B uses its original 48ms exponential easing formula");
assert.match(stepSource, /Math\.abs\(delta\) <= 2/, "B snaps only within its original two CSS pixel threshold");
assert.match(stepSource, /tvBrowseWriteRailPosition\(rail, before \+ delta \* fraction, \{ silent: true \}\)/,
  "B advances from the current logical position using the latest target");
assert.match(writeSource, /translate3d\(/, "B moves the inner track with translate3d");
assert.doesNotMatch(stepSource, /\b(?:rail|container)\.scrollLeft\s*=/, "B frames do not compete through native scrollLeft");
assert.doesNotMatch(source, /tvBrowseCriticalDampedStep|tvBrowseD2RailStep|motionMode === "d2"/,
  "the D2 motion kernel and active mode are removed");
assert.match(source, /window\.__TV_BROWSE_RAIL_MOTION__\s*\|\|\s*"transform"/,
  "B Transform is the default controller");
assert.match(cssSource, /#tvBrowseRail\[data-rail-motion-mode="transform"\]\s*\{\s*overflow-x:\s*hidden;/,
  "the transform controller owns visual scrolling without native overflow");
assert.match(templateSource, /id="tvBrowseRail"[^>]*data-rail-motion-mode="transform"/,
  "the initial markup selects B before runtime binding");

let nextFrameId = 0;
const frames = new Map();
const track = { style: { transform: "" } };
const position = { scrollLeft: 0 };
const runtime = {
  motionMode: "transform", logicalPos: 0, generation: 1, frame: 1, target: 100,
  targetKey: "card-1", focusCard: null, focusGeometry: null, lastFrameAt: 0
};
const rail = { dataset: { queryKey: "query-1" }, scrollLeft: 0, contains: () => true };
let completed = 0;
const sandbox = {
  tvBrowseState: () => ({ railScroll: runtime }),
  tvBrowseRailTrack: () => track,
  tvBrowseActive: () => true,
  tvWallpaperIsActive: () => false,
  tvBrowseQueryKey: () => "query-1",
  tvBrowseRailMaxPosition: () => 700,
  tvBrowseWriteRailPosition(_rail, value) {
    const next = Math.max(0, Math.min(700, Number(value) || 0));
    runtime.logicalPos = next;
    track.style.transform = "translate3d(" + (-next) + "px,0,0)";
    return next;
  },
  tvBrowsePosition: () => position,
  tvBrowseRailPositionChanged: () => { completed += 1; position.scrollLeft = runtime.logicalPos; },
  tvBrowseClearRailAnchorFocusVisual() {},
  $(id) { assert.equal(id, "tvBrowseRail"); return rail; },
  requestAnimationFrame(callback) { const id = ++nextFrameId; frames.set(id, callback); return id; }
};
vm.createContext(sandbox);
vm.runInContext(stepSource + "\nglobalThis.step = tvBrowseTransformRailStep;", sandbox);

function advanceFrame(time) {
  assert.equal(frames.size, 1, "B has exactly one pending movement frame");
  const [id, callback] = frames.entries().next().value;
  frames.delete(id);
  callback(time);
}

const expectedFirst = 100 * (1 - Math.exp(-16 / 48));
sandbox.step(16, 1);
assert.ok(Math.abs(runtime.logicalPos - expectedFirst) < 1e-9, "first movement frame matches original B easing");
assert.equal(rail.scrollLeft, 0, "native scroll position remains untouched");
assert.equal(track.style.transform, "translate3d(" + (-runtime.logicalPos) + "px,0,0)", "logical position is applied to the inner track");

const beforeRetarget = runtime.logicalPos;
runtime.target = 200;
advanceFrame(32);
const expectedRetarget = beforeRetarget + (200 - beforeRetarget) * (1 - Math.exp(-16 / 48));
assert.ok(Math.abs(runtime.logicalPos - expectedRetarget) < 1e-9, "an active B frame reads the newest target");

const beforeReverse = runtime.logicalPos;
runtime.target = 40;
advanceFrame(48);
assert.ok(runtime.logicalPos < beforeReverse && runtime.logicalPos > 40,
  "rapid reversal continues from the live position toward the newest target without a reset");
assert.equal(frames.size, 1, "retargeting reuses the running RAF instead of starting a second controller");

let frameTime = 64;
while (runtime.frame && frameTime < 2000) {
  advanceFrame(frameTime);
  frameTime += 16;
}
assert.equal(runtime.logicalPos, 40, "reversed movement converges exactly at the newest target");
assert.equal(runtime.frame, 0, "the single RAF stops at rest");
assert.equal(completed, 1, "settling invokes the existing save, image preparation and snapshot completion path");
assert.equal(position.scrollLeft, 40, "the shared Browse position records the logical transform position");

runtime.logicalPos = 690;
runtime.target = 900;
runtime.frame = 1;
runtime.lastFrameAt = 0;
sandbox.step(16, 1);
const expectedClamped = 690 + (700 - 690) * (1 - Math.exp(-16 / 48));
assert.ok(Math.abs(runtime.logicalPos - expectedClamped) < 1e-9, "B clamps the target to the natural rail maximum");
assert.equal(rail.scrollLeft, 0, "edge clamping still does not use native scrolling");

console.log("TV_BROWSE_TRANSFORM_MOTION_VM = PASS");
