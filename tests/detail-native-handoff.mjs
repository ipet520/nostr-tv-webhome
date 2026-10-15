import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const handoffSource = readFileSync(new URL("../src/js/19-pan-results-handoff-return.js", import.meta.url), "utf8");
const playbackSource = readFileSync(new URL("../src/js/07-detail-playback-race.js", import.meta.url), "utf8");
const controllerStart = handoffSource.indexOf("    async function playPanResult(item, options) {");
const controllerEnd = handoffSource.indexOf("\n    function handlePanPlayFailure", controllerStart);
assert.notEqual(controllerStart, -1, "playPanResult must remain the normal detail handoff");
assert.ok(controllerEnd > controllerStart, "playPanResult must be complete");
assert.doesNotMatch(handoffSource, /playDetailSessionCandidate|detailSessionFor/);
assert.doesNotMatch(playbackSource, /detailSession|sessionGeneration|state\.detailHistory|state\.detailMode|syncDetailMode/);

const calls = [];
const stored = new Map();
const scope = {
  state: { selected: { title: "Fixture title" }, pan: { viewToken: 7, isPlaying: false } },
  normalizePlaybackTarget: () => null,
  currentPlaybackTargetForItem: () => null,
  buildPanPlayPayload: (item) => ({ url: item.url, type: "quark" }),
  freshPanPreflight: async () => ({ available: true, cancelled: false, state: "ok" }),
  rememberWatchIntent: (...args) => calls.push(["watch-intent", ...args]),
  startWatchTracking: (...args) => calls.push(["watch-tracking", ...args]),
  persistPlaybackBeforeNativeHandoff: async () => calls.push(["persist"]),
  sdk: () => ({ pan: { play: (payload) => calls.push(["pan-play", payload]) } }),
  localStorage: { setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
  cancelPendingDirectPlay: () => calls.push(["cancel-pending"]),
  handlePanPlayFailure: (...args) => calls.push(["play-failure", ...args]),
  toast: (message) => calls.push(["toast", message])
};
const playPanResult = new Function(...Object.keys(scope), `return (${handoffSource.slice(controllerStart, controllerEnd).trim()});`)(...Object.values(scope));
await playPanResult({ url: "https://pan.example/share", title: "Fixture resource", diskType: "quark" }, { prechecked: true });

assert.equal(calls.filter(([name]) => name === "pan-play").length, 1, "normal detail playback must call Native pan.play once");
assert.deepEqual(calls.find(([name]) => name === "pan-play")[1], { url: "https://pan.example/share", type: "quark" });
assert.equal(stored.get("fm_pan_playing"), "1");
assert.equal(scope.state.pan.isPlaying, true);

console.log("DETAIL_NATIVE_PAN_HANDOFF = PASS");
