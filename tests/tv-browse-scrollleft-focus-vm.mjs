import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");
const browse = read("src/js/11e-tv-browse.js");
const css = read("src/css/05-home-tv.css");
const template = read("src/index.template.html");

function functionSource(name, nextName) {
  const start = browse.indexOf(`    function ${name}(`);
  const end = browse.indexOf(`\n    function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `production function ${name} is present`);
  return browse.slice(start, end);
}

const targetSource = functionSource("tvBrowseRailTargetScrollLeft", "tvBrowseExpectedRailScrollLeft");
const cancelSource = functionSource("tvBrowseCancelRailScroll", "tvBrowseScheduleRailAnchor");
const scheduleSource = functionSource("tvBrowseScheduleRailAnchor", "tvBrowseScheduleRailImagePreparation");
const setAnchorSource = functionSource("tvBrowseSetRailAnchor", "tvBrowseInitialVisibleCardCount");
const contextSource = [targetSource, cancelSource, scheduleSource, setAnchorSource].join("\n");

assert.doesNotMatch(browse, /tvBrowseTransformRailStep|tvBrowseEnsureRailMotionMode|tvBrowseUpdateRailAnchorFocusVisual|tvBrowseRailMotionMode|tvBrowseRailTrack/,
  "production Browse has no transform-mode or spatial-focus motion path");
assert.doesNotMatch(browse, /logicalPos|focusVisualCards|focusGeometry/,
  "rail motion state contains no transform-only or interpolated-focus state");
assert.match(template, /<div id="tvBrowseRail" class="rail tv-browse-rail"><\/div>/,
  "the original rail directly owns the card elements");
assert.doesNotMatch(template, /tvBrowseRailTrack|data-rail-motion-mode/,
  "the production rail has no motion-mode wrapper or switch");
assert.match(css, /html\.tv-browse-active \.tv-browse-rail \{ display: flex; align-items: flex-start; gap: var\(--tv-card-gap,1\.4vw\); overflow-x: auto;/,
  "the production rail uses the original native overflow layout");
assert.match(css, /html\.tv-browse-active \.tv-browse-rail \.card:focus \{ transform: scale\(1\.04\); \}/,
  "the original 1.04 focus scale is restored without a motion transition");
assert.match(css, /html\.tv-browse-active \.tv-browse-rail \.card:focus \.poster-wrap::after \{[^}]*border: 2px solid rgba\(255,255,255,\.9\)/,
  "the original immediate 2px focus ring remains on the focused poster");
assert.doesNotMatch(css, /transition: transform 170ms|transition: opacity 160ms|tv-browse-spatial-focus|focus-interpolated/,
  "the later focus transitions and per-frame visual interpolation are removed");

let nextFrameId = 0;
const frames = new Map();
const canceled = new Set();
let imagePrepRequests = 0;
const ui = { railScroll: { frame: 0, target: null, targetKey: "", lastFrameAt: 0 } };
const rail = {
  clientWidth: 640,
  clientLeft: 0,
  scrollWidth: 4300,
  scrollLeft: 0,
  dataset: { queryKey: "movie-query" },
  style: {},
  contains: node => node && node.parentNode === rail,
  getBoundingClientRect: () => ({ left: 40, right: 680, width: 640 })
};
const cards = Array.from({ length: 30 }, (_, index) => {
  const card = {
    parentNode: rail,
    classList: { contains: value => value === "card" },
    dataset: { mediaKey: `movie-${index}`, cardIndex: String(index) },
    getBoundingClientRect: () => {
      const left = 80 + index * 140 - rail.scrollLeft;
      return { left, right: left + 120, width: 120, top: 0, bottom: 180, height: 180 };
    },
    closest: selector => selector === "#tvBrowseRail" ? rail : null
  };
  return card;
});
const context = {
  $: id => id === "tvBrowseRail" ? rail : null,
  tvBrowseState: () => ui,
  tvBrowseActive: () => true,
  tvWallpaperIsActive: () => false,
  tvWallpaperCurrentSelection: () => null,
  tvWallpaperCardFor: () => null,
  tvBrowseScheduleRailImagePreparation: () => { imagePrepRequests += 1; },
  tvBrowseRailTargetScrollLeft: null,
  requestAnimationFrame: callback => { const id = ++nextFrameId; frames.set(id, callback); return id; },
  cancelAnimationFrame: id => { canceled.add(id); frames.delete(id); },
  getComputedStyle: () => ({ paddingLeft: "40px", paddingRight: "40px" }),
  Number, Math, Array, Set, Object
};
const vmModule = await import("node:vm");
const api = vmModule.runInNewContext(`${contextSource}\n({ target: tvBrowseRailTargetScrollLeft, cancel: tvBrowseCancelRailScroll, schedule: tvBrowseScheduleRailAnchor, setAnchor: tvBrowseSetRailAnchor })`, context);
context.tvBrowseRailTargetScrollLeft = api.target;

function runFrame(now) {
  const entry = [...frames.entries()].find(([id]) => !canceled.has(id));
  assert.ok(entry, "a motion frame is scheduled while a target is unsettled");
  frames.delete(entry[0]);
  entry[1](now);
}

const firstTarget = api.target(cards[0], rail);
assert.equal(firstTarget, 0, "the first card obeys the natural left boundary");
const maxScroll = rail.scrollWidth - rail.clientWidth;
assert.equal(api.target(cards.at(-1), rail), maxScroll, "the last card obeys the natural right boundary");

const targetFour = api.target(cards[4], rail);
assert.equal(targetFour, 340, "card target is calculated from the actual scrollport center and padding");
assert.equal(api.schedule(cards[4]), true, "an off-center card schedules one scrollLeft anchor motion");
const firstFrameId = ui.railScroll.frame;
runFrame(16);
const firstMove = rail.scrollLeft;
assert.ok(firstMove > 0 && firstMove < targetFour, "the first RAF advances from the physical scrollLeft using the c155 exponential step");
assert.equal(ui.railScroll.frame !== 0, true, "the same RAF controller remains active during movement");

const currentPosition = rail.scrollLeft;
const frameBeforeRetarget = ui.railScroll.frame;
const targetSix = api.target(cards[6], rail);
assert.equal(api.schedule(cards[6]), true, "a new focus retargets the active scroll motion");
assert.equal(ui.railScroll.frame, frameBeforeRetarget, "retargeting retains the active animation frame rather than scheduling a second controller");
assert.equal(frames.size, 1, "only one RAF callback controls the rail during retargeting");
assert.equal(ui.railScroll.target, targetSix, "the active animation reads the newest target");
runFrame(32);
assert.ok(rail.scrollLeft > currentPosition, "retargeting continues from the current physical position");

const beforeReverse = rail.scrollLeft;
const targetThree = api.target(cards[3], rail);
api.schedule(cards[3]);
assert.equal(ui.railScroll.target, targetThree, "reverse input replaces the stale forward target");
runFrame(48);
assert.ok(rail.scrollLeft < beforeReverse, "reverse input changes direction from the current scrollLeft without resetting it");
let now = 64;
let guard = 0;
while (ui.railScroll.frame && guard++ < 200) runFrame(now += 16);
assert.ok(guard < 200, "the c155 scrollLeft motion settles in a bounded number of frames");
assert.ok(Math.abs(rail.scrollLeft - targetThree) <= 1.25, "the final position snaps within the original 1.25px completion tolerance");
assert.equal(ui.railScroll.frame, 0, "the frame state clears when the target is reached");
assert.ok(imagePrepRequests >= 2, "image preparation is scheduled at motion start and completion");

api.setAnchor(cards[0]);
assert.equal(rail.scrollLeft, 0, "direct restoration uses physical scrollLeft");
api.setAnchor(cards.at(-1));
assert.equal(rail.scrollLeft, maxScroll, "tail restoration clamps to the native scroll maximum");
console.log("TV_BROWSE_SCROLLLEFT_FOCUS_VM = PASS");
