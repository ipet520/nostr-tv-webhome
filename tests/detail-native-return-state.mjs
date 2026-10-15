import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const handoffSource = read("../src/js/19-pan-results-handoff-return.js");
const playbackSource = read("../src/js/07-detail-playback-race.js");
const detailSource = read("../src/js/16-detail-rendering.js");
const resumeSource = read("../src/js/22-snapshot-resume-boot.js");
const recentSource = read("../src/js/08a-catalog-recent-management.js");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker after: ${startMarker}`);
  return source.slice(start, end).trim();
}

const retireSource = between(
  handoffSource,
  "    function retireDetailPreparedPlaybackAfterNativeSearch(item, marker, reason) {",
  "\n    function reconcileDetailAfterNativeReturn"
);
const reconcileSource = between(
  handoffSource,
  "    function reconcileDetailAfterNativeReturn(item, origin) {",
  "\n    // 滚动恢复：closeDetail(needBack)"
);

function reconcileHarness({ historyChanged = true, capturedRunToken = 13 } = {}) {
  const item = { title: "Selected title" };
  const run = {
    item,
    itemKey: "media-1",
    token: 13,
    candidate: { url: "https://current.example/play" },
    continueResource: { id: "current-resource" },
    playRequested: true,
    handoffStarted: true,
    phase: "PAN_PLAY_CALLED"
  };
  const calls = [];
  const state = {
    selected: item,
    detailClosing: false,
    recent: { error: "" },
    detailPlayback: run,
    detailHistoryHandoff: { item },
    historyResume: { stale: true },
    detailEpisodeTarget: { stale: true },
    pan: {
      directReady: { itemKey: "media-1" },
      directFailure: { itemKey: "media-1" }
    }
  };
  const scope = {
    state,
    $: () => ({ classList: { contains: () => true } }),
    panSearchItemKey: () => "media-1",
    nativeSearchReturnMarkerFor: () => ({
      itemKey: "media-1",
      detailRunToken: capturedRunToken,
      detailRunItemKey: "media-1"
    }),
    recentNativeHistoryWinnerFor: () => ({ source: "history" }),
    detailHasAuthoritativeNativeHistory: () => true,
    detailHistoryMatches: () => true,
    nativeSearchHistoryChanged: () => historyChanged,
    nativeSearchHistoryChangeReason: () => historyChanged ? "progress-advanced" : "",
    detailPlaybackIsCurrent: (candidate) => candidate === state.detailPlayback && !candidate.cancelled,
    clearDirectPlayStatus: (...args) => calls.push(["clear-status", ...args]),
    cancelDetailPlaybackPreparation: (...args) => {
      calls.push(["cancel-prepare", ...args]);
      run.cancelled = true;
      state.detailPlayback = null;
    },
    updateDetailContinueButton: () => calls.push(["update-button"]),
    console: { debug() {} }
  };
  const names = Object.keys(scope);
  const values = Object.values(scope);
  const reconcile = new Function(...names,
    `const retireDetailPreparedPlaybackAfterNativeSearch = (${retireSource}); return (${reconcileSource});`
  )(...values);
  return { item, run, state, calls, reconcile };
}

{
  const h = reconcileHarness();
  assert.equal(h.reconcile(h.item, "native-search"), true);
  assert.equal(h.state.detailPlayback, null, "changed Native History retires only the captured prepared run");
  assert.equal(h.run.cancelled, true);
  assert.equal(h.run.candidate, null);
  assert.equal(h.state.historyResume, null);
  assert.equal(h.state.detailEpisodeTarget, null);
  assert.equal(h.state.pan.directReady, null);
  assert.equal(h.state.pan.directFailure, null);
  assert.equal(h.calls.filter(([name]) => name === "cancel-prepare").length, 1);
  assert.equal(h.calls.filter(([name]) => name === "update-button").length, 1);
}

{
  const h = reconcileHarness({ capturedRunToken: 12 });
  assert.equal(h.reconcile(h.item, "native-search"), true);
  assert.equal(h.state.detailPlayback, h.run, "a newer run is not retired by an older Native Search marker");
  assert.equal(h.run.candidate.url, "https://current.example/play");
  assert.equal(h.calls.some(([name]) => name === "cancel-prepare"), false);
}

{
  const h = reconcileHarness({ historyChanged: false });
  assert.equal(h.reconcile(h.item, "native-search"), true);
  assert.equal(h.state.detailPlayback, h.run, "unchanged history preserves current preparation");
  assert.equal(h.calls.some(([name]) => name === "cancel-prepare"), false);
}

const updateButtonStart = playbackSource.indexOf("    function updateDetailContinueButton() {");
assert.notEqual(updateButtonStart, -1, "missing updateDetailContinueButton function");
const updateButtonSource = playbackSource.slice(updateButtonStart).trim();
const selectedItem = { title: "Current detail" };
const classes = new Set();
const actions = { classList: {
  toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); },
  remove(name) { classes.delete(name); }
} };
const button = {
  style: {},
  dataset: {},
  classList: { toggle() {} },
  closest() { return actions; },
  setAttribute() {}
};
const continueText = { textContent: "" };
const searchText = { textContent: "" };
let resumeHistory = { nativeHistoryKey: "history-a", canResume: true };
const currentCandidate = { url: "https://selected-source.example/current" };
const state = { selected: selectedItem, detailPlayback: { candidate: currentCandidate } };
const updateButton = new Function("$", "state", "findDetailContinueHistory", "detailDirectPlayReadyFor", "detailContinuePlayStateFor",
  `return (${updateButtonSource});`
)((id) => ({
  detailContinueBtn: button,
  detailContinueText: continueText,
  detailSearchText: searchText
})[id], state, () => resumeHistory, () => false, () => "idle");

updateButton();
assert.equal(continueText.textContent, "续播");
assert.equal(button.dataset.mode, "CONTINUE");
assert.equal(classes.has("has-continue"), true);
assert.equal(button.__historyItem, null, "Native History is not attached to the current resource action");
assert.equal(state.detailPlayback.candidate, currentCandidate, "presentation update does not replace the selected resource");

resumeHistory = null;
updateButton();
assert.equal(continueText.textContent, "播放");
assert.equal(button.dataset.mode, "FIRST_PLAY");
assert.equal(classes.has("has-continue"), false);

const requestSource = between(
  playbackSource,
  "    async function requestDetailPlayback(item) {",
  "\n    function handleDetailPrimaryAction"
);
assert.match(requestSource, /detailPreparedCandidateFor\(item\)/);
assert.match(requestSource, /playPreparedDetailCandidate\(item, prepared, button\)/);
assert.doesNotMatch(requestSource, /findDetailContinueHistory|detailHistory|historyResume|detailMode/);
assert.match(playbackSource, /function handleDetailPrimaryAction\(\)\s*\{\s*return requestDetailPlayback\(state\.selected\);/);

const rearmSource = between(
  resumeSource,
  "    async function rearmDetailPlaybackAfterPlayerReturn(options) {",
  "\n    async function handleWebHomeResume"
);
assert.doesNotMatch(rearmSource, /prepareDetailPlaybackForDetail|prepareDetailPlayback\(/,
  "player return must not start another resource preparation");

function returnHarness(run) {
  const item = { title: "Returned detail" };
  if (run) run.item = item;
  const calls = [];
  const state = { selected: item, detailClosing: false, detailPlayback: run || null };
  const sheet = { classList: { contains: () => true } };
  const scope = {
    state,
    $: () => sheet,
    detailPlaybackIsCurrent: (candidate) => candidate === state.detailPlayback && !candidate.cancelled,
    loadRecentList: async (options) => calls.push(["load-recent", options]),
    clearDirectPlayStatus: (...args) => calls.push(["clear-status", ...args]),
    cancelDetailPlaybackPreparation: (...args) => {
      calls.push(["cancel-prepare", ...args]);
      if (state.detailPlayback) state.detailPlayback.cancelled = true;
      state.detailPlayback = null;
    },
    updateDetailContinueButton: () => calls.push(["update-button"])
  };
  const fn = new Function(...Object.keys(scope), `return (${rearmSource});`)(...Object.values(scope));
  return { calls, state, item, fn };
}

{
  const run = { item: null, token: 4, handoffStarted: true, phase: "PAN_PLAY_CALLED" };
  const h = returnHarness(run);
  assert.equal(await h.fn({ playerReturn: true }), true);
  assert.equal(h.calls.filter(([name]) => name === "load-recent").length, 1);
  assert.equal(h.calls.filter(([name]) => name === "cancel-prepare").length, 1);
  assert.deepEqual(h.calls.find(([name]) => name === "cancel-prepare"), ["cancel-prepare", "player_returned"]);
  assert.equal(h.state.detailPlayback, null);
  assert.equal(h.state.selected, h.item);
  assert.equal(h.calls.some(([name]) => name === "update-button"), true);
}

{
  const run = { item: null, token: 5, handoffStarted: false, phase: "READY", candidate: { url: "https://current.example/play" } };
  const h = returnHarness(run);
  assert.equal(await h.fn({ playerReturn: true }), true);
  assert.equal(h.state.detailPlayback, run, "a still-current unhanded resource remains available");
  assert.equal(h.calls.some(([name]) => name === "cancel-prepare"), false);
}

{
  const h = returnHarness(null);
  assert.equal(await h.fn({ playerReturn: false }), false);
  assert.equal(h.calls.length, 0);
}

assert.match(detailSource, /if \(opts\.playerReturnRestore !== true\) \{\s*prepareDetailPlaybackForDetail\(item,\s*\{\s*reason: "detail_open"/,
  "a fresh detail open prepares resources, while a player-return restore does not auto-prepare");
assert.match(detailSource, /reason: "detail_open"/);
assert.match(recentSource, /recent\.items = normalized \|\| \[\];[\s\S]*?updateDetailContinueButton\(\);/,
  "the button presentation refreshes after a successful Native History list commit");
assert.doesNotMatch(recentSource, /syncDetailMode\(/, "the removed Continue Gate stays removed");

console.log("NATIVE_SEARCH_PREPARED_RUN_ISOLATION = PASS");
console.log("DETAIL_RESUME_STATUS_IS_PRESENTATION_ONLY = PASS");
console.log("PLAYER_RETURN_DOES_NOT_AUTO_PREPARE = PASS");
console.log("FRESH_DETAIL_ENTRY_PREPARES = PASS");
