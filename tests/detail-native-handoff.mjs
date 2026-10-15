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
let invalidateAfterSnapshot = false;
const scope = {
  state: { selected: { title: "Fixture title" }, detailPlayerReturn: null, pan: { viewToken: 7, isPlaying: false } },
  panContextIsCurrent: (context) => scope.state.pan.viewToken === context.token && scope.state.selected === context.item,
  normalizePlaybackTarget: () => null,
  currentPlaybackTargetForItem: () => null,
  buildPanPlayPayload: (item) => ({ url: item.url, type: "quark" }),
  freshPanPreflight: async () => ({ available: true, cancelled: false, state: "ok" }),
  rememberWatchIntent: (...args) => calls.push(["watch-intent", ...args]),
  startWatchTracking: (...args) => calls.push(["watch-tracking", ...args]),
  persistPlaybackBeforeNativeHandoff: async () => {
    calls.push(["persist"]);
    if (invalidateAfterSnapshot) scope.state.pan.viewToken += 1;
  },
  sdk: () => ({ pan: { play: (payload) => calls.push(["pan-play", payload]) } }),
  localStorage: { setItem: (key, value) => stored.set(key, value), removeItem: (key) => stored.delete(key) },
  cancelPendingDirectPlay: () => calls.push(["cancel-pending"]),
  markDetailPlayerHandoff: (item) => {
    const marker = { itemKey: "fixture", handoffStarted: true, returnedAt: 0 };
    calls.push(["mark-detail-player-handoff", item]);
    scope.state.detailPlayerReturn = marker;
    return marker;
  },
  handlePanPlayFailure: (...args) => calls.push(["play-failure", ...args]),
  toast: (message) => calls.push(["toast", message])
};
const playPanResult = new Function(...Object.keys(scope), `return (${handoffSource.slice(controllerStart, controllerEnd).trim()});`)(...Object.values(scope));
await playPanResult({ url: "https://pan.example/share", title: "Fixture resource", diskType: "quark" }, { prechecked: true });

assert.equal(calls.filter(([name]) => name === "pan-play").length, 1, "normal detail playback must call Native pan.play once");
assert.equal(calls.filter(([name]) => name === "mark-detail-player-handoff").length, 1, "detail handoff must mark the same-detail player return");
assert.deepEqual(calls.find(([name]) => name === "pan-play")[1], { url: "https://pan.example/share", type: "quark" });
assert.equal(stored.get("fm_pan_playing"), "1");
assert.equal(scope.state.pan.isPlaying, true);

const successfulHandoffCount = calls.filter(([name]) => name === "pan-play").length;
scope.state.pan.viewToken += 1;
scope.state.detailPlayerReturn = null;
invalidateAfterSnapshot = true;
await playPanResult({ url: "https://pan.example/stale", title: "Stale resource", diskType: "quark" }, { prechecked: true });
assert.equal(calls.filter(([name]) => name === "pan-play").length, successfulHandoffCount,
  "closing or switching away during the handoff barrier cannot launch an old detail request: " + calls.map(([name]) => name).join(","));
assert.equal(scope.state.detailPlayerReturn, null, "cancelled handoff cannot leave a false player-return marker");

const failureStart = handoffSource.indexOf("    function handlePanPlayFailure(item, error, actionId, detailPlayerReturn) {");
const failureEnd = handoffSource.indexOf("\n    function emptyNode", failureStart);
assert.notEqual(failureStart, -1, "failed native handoff cleanup must remain explicit");
assert.ok(failureEnd > failureStart, "failed native handoff cleanup must be complete");
const candidate = { url: "https://pan.example/share" };
const detailMarker = { itemKey: "fixture", handoffStarted: true, returnedAt: 0 };
const failedRun = { itemKey: "fixture", handoffStarted: true, candidate, phase: "STARTING_PLAYER" };
const failureScope = {
  state: { pan: {}, detailPlayerReturn: detailMarker, detailPlayback: failedRun },
  localStorage: { removeItem: () => {} },
  updateDetailContinueButton: () => {},
  updateDirectPlayStatus: () => false,
  DIRECT_PLAY_STATUS_TEXT: { FINAL_ERROR: "failed" },
  toast: () => {},
  panSearchItemKey: (item) => item.key
};
const handlePanPlayFailure = new Function(...Object.keys(failureScope), `return (${handoffSource.slice(failureStart, failureEnd).trim()});`)(...Object.values(failureScope));
handlePanPlayFailure({ key: "fixture" }, new Error("launch failed"), null, detailMarker);
assert.equal(failureScope.state.detailPlayerReturn, null, "failed launch cannot masquerade as a player return");
assert.equal(failedRun.handoffStarted, false, "failed launch must release the one-shot detail handoff");
assert.equal(failedRun.phase, "READY", "failed launch must leave its prepared candidate retryable");
assert.equal(failedRun.candidate, candidate, "failed launch must retain the prepared resource");
const newerMarker = { itemKey: "fixture", handoffStarted: true, returnedAt: 0 };
failureScope.state.detailPlayerReturn = newerMarker;
handlePanPlayFailure({ key: "fixture" }, new Error("late failure"), null, detailMarker);
assert.equal(failureScope.state.detailPlayerReturn, newerMarker, "late failure cannot clear a newer handoff marker");

console.log("DETAIL_NATIVE_PAN_HANDOFF = PASS");
