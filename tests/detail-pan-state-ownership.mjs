import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const source16 = read("../src/js/16-detail-rendering.js");
const source17 = read("../src/js/17-pan-direct-health.js");
const source19 = read("../src/js/19-pan-results-handoff-return.js");
const source21 = read("../src/js/21-bindings-focus-anchor.js");
const source05 = read("../src/js/05-relay-network-pan-session.js");
const source07 = read("../src/js/07-detail-playback-race.js");

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker after: ${startMarker}`);
  return source.slice(start, end).trim();
}

function productionFunction(source, start, end, scope) {
  return new Function(...Object.keys(scope), `return (${between(source, start, end)});`)(...Object.values(scope));
}

const openDetail = between(source16, "    function openDetail(item, options) {", "\n    function ensureSheetViewport");
const resetPan = between(source16, "    function resetPanSearchState(hideBlock, options) {", "\n    function panItemIsRangePack");
const terminateDirectLane = between(source17, "    function terminateSupersededDetailDirectLaneForManualSearch(item, lifecycle) {", "\n    async function searchPanResources");
const searchPan = between(source17, "    async function searchPanResources(item, opts) {", "\n    function focusFirstPanResult");
const preparedCandidate = between(source07, "    function detailPreparedCandidateFor(item) {", "\n    function restoreDetailPreparedCandidate");
const directReady = between(source07, "    function detailDirectPlayReadyFor(item) {", "\n    function detailDirectPlayCandidateFor");
const requestPlayback = between(source07, "    async function requestDetailPlayback(item) {", "\n    function handleDetailPrimaryAction");
const admission = between(source19, "    function panAutoHealthAdmission(item, freshHealth) {", "\n    function panHealthSnapshot");
const startSession = between(source05, "    function startPanSearchSession(item, keyword, origin, options) {", "\n    function armPanSearchSessionHardGuard");
const sessionCurrent = between(source05, "    function isPanSearchSessionCurrent(item, token, sessionId, allowTerminal) {", "\n    function isPanSearchSessionActive");
const sessionActive = between(source05, "    function isPanSearchSessionActive(item, token, sessionId) {", "\n    function isPanSearchSessionHardExpired");
const closePan = between(source21, "    function closePanSearchToDetail() {", "\n    function handlePanBackKey");

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push([name, true, ""]);
  } catch (error) {
    checks.push([name, false, error.message]);
  }
}

function restoreHarness(preheat) {
  const item = { title: "Example", mediaType: "movie", tmdbId: 42 };
  const marker = { itemKey: "movie|42|Example", at: Date.now(), historySnapshot: null, detailRunToken: 13 };
  const storage = new Map([["fm_detail_native_search_return", JSON.stringify(marker)]]);
  const classNames = new Set();
  const detailSheet = {
    classList: {
      contains: (name) => classNames.has(name),
      add: (name) => classNames.add(name),
      remove: (name) => classNames.delete(name)
    },
    style: {},
    setAttribute() {},
    scrollTop: 0
  };
  const state = { selected: null, pan: {}, detailPlayerReturn: null, detailEpisodeTarget: null, tvFullscreen: false };
  const scope = {
    state,
    $: (id) => id === "detailSheet" ? detailSheet : null,
    isConnectionPanelOpen: () => false,
    closeConnectionPanel() {},
    clearDirectPlayStatus() {},
    cancelPendingDirectPlay() {},
    cancelDetailPlaybackPreparation() {},
    panSearchItemKey: () => marker.itemKey,
    setDetailPlaybackTarget() {},
    rememberHomeReturn() {},
    resetPanSearchState() {},
    clearNativeSearchReturnMarker: () => storage.delete("fm_detail_native_search_return"),
    nativeSearchReturnMarkerFor: productionFunction(source19,
      "    function nativeSearchReturnMarkerFor() {", "\n    function nativeSearchHistorySnapshotFor", {
        localStorage: {
          getItem: (key) => storage.get(key) || null,
          removeItem: (key) => storage.delete(key)
        },
        Date
      }),
    prepareDetailPlaybackForDetail: () => {
      if (preheat === "success") state.detailPlayback = { token: 21, item, candidate: { url: "https://pan.example/ready" }, phase: "READY" };
      else if (preheat === "failed") state.detailPlayback = { token: 21, item, candidate: null, phase: "NO_RESOURCE" };
      else state.detailPlayback = { token: 21, item, candidate: null, phase: "PREPARING", active: true };
      return Promise.resolve(null);
    },
    ensureSheetViewport() {},
    syncDetailLayout() {},
    document: { body: { classList: { add() {}, remove() {} } } },
    isNativeLeanbackClient: () => false,
    isNativeMobileClient: () => false,
    setTvMode() {},
    isTvLikeDevice: () => false,
    renderDetailBase() {},
    clearDetailExtras() {},
    location: { hash: "#detail" },
    history: { pushState() {} },
    rememberWatchIntent() {},
    currentPlaybackTargetForItem: () => null,
    setNativeToolbarVisible() {},
    shouldRefreshRecentList: () => false,
    loadRecentList() {},
    loadDetail() {},
    scheduleUiSnapshotSave() {}
  };
  const fn = new Function(...Object.keys(scope), `return (${openDetail});`)(...Object.values(scope));
  fn(item, { restore: true });
  return { item, marker, storage, state, scope, detailSheet };
}

function reconcileRestoredHistory(h) {
  const history = { source: "history", nativeHistoryKey: "site@@@vod@@@7", exact: true };
  const shared = {
    panSearchItemKey: () => h.marker.itemKey,
    recentNativeHistoryWinnerFor: () => history,
    detailHasAuthoritativeNativeHistory: () => true,
    detailHistoryMatches: () => true,
    nativeHistoryRecordCanPlayExact: (candidate) => !!candidate.exact,
    historyPlaybackPositionValue: (candidate) => Number(candidate.position || 0),
    localStorage: {
      getItem: (key) => h.storage.get(key) || null,
      removeItem: (key) => h.storage.delete(key)
    },
    Date
  };
  const snapshot = productionFunction(source19,
    "    function nativeSearchHistorySnapshotFor(item, history) {", "\n    function nativeSearchHistoryChangeReason", shared);
  const reason = productionFunction(source19,
    "    function nativeSearchHistoryChangeReason(item, marker, winner) {", "\n    function nativeSearchHistoryChanged", {
      ...shared,
      nativeSearchHistorySnapshotFor: snapshot
    });
  const changed = productionFunction(source19,
    "    function nativeSearchHistoryChanged(item, marker, winner) {", "\n    function setNativeSearchReturnMarker", {
      nativeSearchHistoryChangeReason: reason
    });
  const scope = {
    state: h.state,
    $: (id) => id === "detailSheet" ? h.detailSheet : null,
    ...shared,
    nativeSearchReturnMarkerFor: h.scope.nativeSearchReturnMarkerFor,
    nativeSearchHistorySnapshotFor: snapshot,
    nativeSearchHistoryChanged: changed,
    nativeSearchHistoryChangeReason: reason,
    detailNativeHistoryKey: (candidate) => candidate.nativeHistoryKey,
    retireDetailPreparedPlaybackAfterNativeSearch: () => false,
    clearNativeSearchReturnMarker: h.scope.clearNativeSearchReturnMarker,
    updateDetailContinueButton() {}
  };
  const reconcile = productionFunction(source19,
    "    function reconcileDetailAfterNativeReturn(item, origin) {", "\n    // 滚动恢复：closeDetail(needBack)", scope);
  return { result: reconcile(h.item, "native-search"), history };
}

for (const preheat of ["success", "failed", "preparing"]) {
  check(`snapshot restore keeps native-search marker with preheat ${preheat}`, () => {
    const h = restoreHarness(preheat);
    assert.ok(h.storage.has("fm_detail_native_search_return"),
      `restore cleared the native-search marker while preheat was ${preheat}`);
    const result = reconcileRestoredHistory(h);
    assert.equal(result.result, true, "a fresh matching exact Native record must reconcile after restore");
    assert.equal(h.state.detailPlayerReturn.nativeHistoryKey, result.history.nativeHistoryKey);
  });
}

function panHarness() {
  const item = { title: "Example", mediaType: "movie", tmdbId: 42, diskType: "quark", url: "https://pan.example/share" };
  const candidate = { ...item, identityVerdict: "STRONG" };
  const healthKey = "quark|https://pan.example/share";
  const run = { item, candidate, active: false, providerCommitted: true, phase: "READY" };
  const classNames = new Set();
  const block = { classList: { contains: (name) => classNames.has(name), add: (name) => classNames.add(name), remove: (name) => classNames.delete(name) }, style: {} };
  const tabs = { replaceChildren() {} };
  const results = { replaceChildren() {} };
  const hint = { textContent: "" };
  const state = {
    selected: item,
    detailPlayback: run,
    pan: {
      loading: true, keyword: "Example", activeType: "", results: [],
      health: { [healthKey]: { state: "ok", checkedAt: Date.now(), expiresAt: Date.now() + 60000 } },
      pending: {}, queued: new Set(), inFlight: new Set(), observer: null,
      flushTimer: 0, pollTimers: [], pollRound: 0, pollRoundStarted: {}, panSnapshotSeq: 0,
      requestSeq: 1, actualRequestAttempts: 1, lifecycleSeq: 1, sessionId: 1,
      sessionOrigin: "direct", sessionItemKey: "movie|42|Example", sessionStartedAt: Date.now(),
      sessionTerminal: false, sessionTerminalReason: "", sessionEndRecorded: false,
      sessionStartCount: 1, sessionEndCount: 0, sessionTimer: 0, initialAttempts: 1,
      pollRoundsStarted: 0, pollRoundsCompleted: 0, foregroundRecoveryCount: 0,
      viewToken: "auto-token", searchMode: "direct", initialSucceeded: false,
      initialResultState: "", lastFailureKind: "", retryRemaining: 0, finalFailure: false,
      directTransportExhausted: false, renderKeys: "", tabKeys: "", checkEnabled: true,
      focusKey: "", focusMode: "", playbackReturn: null, progress: { active: true, phase: "initial", round: 0, totalRounds: 2 },
      directReady: null, directFailure: null
    }
  };
  const scope = {
    state,
    $: (id) => ({ panSearchBlock: block, panTabs: tabs, panResultList: results, panSearchHint: hint })[id] || null,
    endPanSearchSession() {}, clearPanSessionTimer() {}, clearPanPollTimers() {}, setPanProgress() {}, updatePostPanFocusState() {},
    panKeyword: () => "Example", panSearchItemKey: () => "movie|42|Example",
    getPanSearchLifecycleFor: (value) => {
      const sameSession = state.pan.keyword === "Example" && state.pan.sessionItemKey === "movie|42|Example";
      return {
        sameSession,
        origin: state.pan.sessionOrigin,
        active: !!(sameSession && state.pan.loading && !state.pan.sessionTerminal),
        phase: state.pan.progress.phase,
        terminalReason: state.pan.sessionTerminalReason
      };
    },
    panHealthKey: (value) => `${value.diskType}|${value.url}`,
    isPanHealthFresh: (value) => {
      const health = state.pan.health[`${value.diskType}|${value.url}`];
      return !!(health && health.expiresAt > Date.now());
    },
    isPanCheckSupported: () => true, panCheckAvailable: () => true,
    detailPlaybackIsCurrent: (value) => value === state.detailPlayback,
    automaticVideoCandidateVerdict: () => ({ accepted: true }),
    settleDetailPlayback: (value, phase, reason) => { value.phase = phase; value.error = reason; },
    updateDetailContinueButton() {}, recordAutomaticMediaRejected() {},
    reportDetailDirectRaceResult: (action, candidate, reason) => {
      laneReports.push({ action, candidate, reason });
      state.detailPlayback.directTerminal = true;
      if (state.detailPlayback.curatedTerminal) {
        state.detailPlayback.raceActive = false;
        state.detailPlayback.phase = "NO_RESOURCE";
      }
      return true;
    },
    recordPanSearchSessionDiag() {}, setPanStatus() {}, setPanProgress() {},
    panSearchPollIntervals: () => [100, 200], armPanSearchSessionHardGuard() {},
    centerPanSearchBlock() {}, emptyNode: () => ({}), panEmptyStateText: () => "empty",
    ensurePanAuthHeaders: () => new Promise(() => {}), requestPanSearchWithRetry: () => new Promise(() => {}),
    defaultPanConfig: () => ({}), toast() {}, scheduleUiSnapshotSave() {},
    clearTimeout, setTimeout, Date, Object, Number, String, Math, Promise, Set, Map,
    detailPrimaryActionButton: () => ({}), requestAnimationFrame: (fn) => fn(),
    isTvLikeDevice: () => false, isDetailPrimaryAction: () => false, restoreDetailTopAnchor() {}, focusRemoteTarget() {}
  };
  const laneReports = [];
  const reset = new Function(...Object.keys(scope), `return (${resetPan});`)(...Object.values(scope));
  const admissionFn = new Function("state", "panHealthKey", "isPanHealthFresh", "isPanCheckSupported", "panCheckAvailable",
    `return (${admission});`)(state, scope.panHealthKey, scope.isPanHealthFresh, scope.isPanCheckSupported, scope.panCheckAvailable);
  const prepared = new Function("state", "detailPlaybackIsCurrent", "automaticVideoCandidateVerdict", "panAutoHealthAdmission", "settleDetailPlayback", "updateDetailContinueButton", "recordAutomaticMediaRejected",
    `return (${preparedCandidate});`)(state, scope.detailPlaybackIsCurrent, scope.automaticVideoCandidateVerdict, admissionFn, scope.settleDetailPlayback, scope.updateDetailContinueButton, scope.recordAutomaticMediaRejected);
  const directReadyFn = new Function("state", "detailPlaybackIsCurrent", "detailPreparedCandidateFor",
    "getPanSearchLifecycleFor", "detailDirectReadyCandidateFor", "panSearchItemKey", "panAutoIdentityVerdict",
    "automaticVideoCandidateVerdict", "recordAutomaticMediaRejected", "panAutoHealthAdmission",
    `return (${directReady});`)(state, scope.detailPlaybackIsCurrent, prepared,
      scope.getPanSearchLifecycleFor, () => null, scope.panSearchItemKey, () => ({ verdict: "ACCEPT" }),
      scope.automaticVideoCandidateVerdict, scope.recordAutomaticMediaRejected, admissionFn);
  const sessionStart = new Function("state", "clearPanSessionTimer", "clearPanPollTimers", "panSearchItemKey", "recordPanSearchSessionDiag",
    `return (${startSession});`)(state, scope.clearPanSessionTimer, scope.clearPanPollTimers, scope.panSearchItemKey, scope.recordPanSearchSessionDiag);
  const current = new Function("state", `return (${sessionCurrent});`)(state);
  const active = new Function("state", "isPanSearchSessionCurrent", "isPanSearchSessionHardExpired",
    `return (${sessionActive});`)(state, current, () => false);
  const terminate = new Function("state", "getPanSearchLifecycleFor", "detailPlaybackIsCurrent", "reportDetailDirectRaceResult",
    `return (${terminateDirectLane});`)(state, scope.getPanSearchLifecycleFor, scope.detailPlaybackIsCurrent, scope.reportDetailDirectRaceResult);
  scope.resetPanSearchState = reset;
  scope.panAutoHealthAdmission = admissionFn;
  scope.startPanSearchSession = sessionStart;
  scope.isPanSearchSessionActive = active;
  scope.terminateSupersededDetailDirectLaneForManualSearch = terminate;
  const played = [];
  Object.assign(scope, {
    detailReturnedNativeHistoryFor: () => null,
    detailPreparedCandidateFor: prepared,
    playPreparedDetailCandidate: async (...args) => { played.push(args); },
    detailDirectPlayCandidateFor: () => null,
    detailDirectFailureTypeFor: () => "",
    detailUnreleasedInfo: () => ({ unreleased: false }),
    settleDetailUnreleased() {},
    canonicalResourceKey: () => false,
    resolveCanonicalResourceTitle: async () => null,
    playBestQuark() {},
    DIRECT_PLAY_STATUS_TEXT: {},
    showDirectPlayStatus() {},
    setDetailPlaybackTarget() {},
    currentPlaybackTargetForItem: () => null
  });
  const search = new Function(...Object.keys(scope), `return (${searchPan});`)(...Object.values(scope));
  const close = new Function(...Object.keys(scope), `return (${closePan});`)(...Object.values(scope));
  const request = new Function(...Object.keys(scope), `return (${requestPlayback});`)(...Object.values(scope));
  return { item, candidate, run, state, healthKey, scope, prepared, directReady: directReadyFn, search, close, active, request, played, laneReports };
}

{
  const h = panHarness();
  const oldToken = h.state.pan.viewToken;
  const oldSessionId = h.state.pan.sessionId;
  h.search(h.item, { origin: "manual", forceNewSession: true });
  check("manual search preserves the already prepared candidate and its healthy cache", () => {
    assert.equal(h.state.detailPlayback.candidate, h.candidate);
    assert.equal(h.prepared(h.item), h.candidate);
    assert.equal(h.directReady(h.item), true);
    assert.equal(h.scope.panAutoHealthAdmission(h.candidate, {}).state, "ok");
  });
  check("manual search leaves the primary action pointed at the prepared candidate", () => {
    h.request(h.item);
    assert.equal(h.played.length, 1);
    assert.equal(h.played[0][1], h.candidate);
  });
  check("manual search gets a new session and stale automatic callbacks are rejected", () => {
    assert.notEqual(h.state.pan.sessionId, oldSessionId);
    assert.notEqual(h.state.pan.viewToken, oldToken);
    assert.equal(h.active(h.item, oldToken, oldSessionId), false);
  });
}

{
  const h = panHarness();
  const action = { item: h.item, detailRun: h.run, raceMode: true, cancelReason: "", playRequested: false };
  h.run.providerCommitted = false;
  h.run.raceActive = true;
  h.run.curatedTerminal = true;
  h.run.directTerminal = false;
  h.run.candidate = null;
  h.run.directAction = action;
  const oldToken = h.state.pan.viewToken;
  const oldSessionId = h.state.pan.sessionId;
  h.search(h.item, { origin: "manual", forceNewSession: true });
  check("manual search retires the superseded Direct race lane before replacing its token", () => {
    assert.equal(h.laneReports.length, 1);
    assert.equal(h.laneReports[0].action, action);
    assert.equal(h.laneReports[0].candidate, null);
    assert.equal(h.laneReports[0].reason, "MANUAL_SEARCH_STARTED");
    assert.equal(action.cancelReason, "manual_search_started");
    assert.equal(h.run.directTerminal, true);
    assert.equal(h.run.raceActive, false, "the already terminal Curated lane can settle the existing race");
    assert.equal(h.run.phase, "NO_RESOURCE");
    assert.notEqual(h.state.pan.sessionId, oldSessionId);
    assert.notEqual(h.state.pan.viewToken, oldToken);
    assert.equal(h.active(h.item, oldToken, oldSessionId), false);
  });
}

{
  const h = panHarness();
  h.state.pan.loading = false;
  h.close();
  check("returning from an empty manual search preserves the unconsumed prepared candidate", () => {
    assert.equal(h.state.detailPlayback.candidate, h.candidate);
    assert.equal(h.prepared(h.item), h.candidate);
    assert.equal(h.directReady(h.item), true);
    assert.equal(h.scope.panAutoHealthAdmission(h.candidate, {}).state, "ok");
  });
}

{
  const h = panHarness();
  h.search(h.item, { origin: "manual", forceNewSession: true });
  h.state.pan.health[h.healthKey] = { state: "bad", checkedAt: Date.now(), expiresAt: Date.now() + 60000 };
  check("a manual health result that confirms bad still rejects the prepared candidate", () => {
    assert.equal(h.scope.panAutoHealthAdmission(h.candidate, {}).accepted, false);
    assert.equal(h.prepared(h.item), null);
    assert.equal(h.directReady(h.item), false);
    assert.equal(h.run.error, "fresh_bad_candidate");
  });
}

{
  const h = panHarness();
  h.state.pan.health[h.healthKey].state = "bad";
  h.state.pan.health[h.healthKey].expiresAt = Date.now() + 60000;
  h.scope.resetPanSearchState(false, { preserveHealth: true, reason: "manual" });
  check("preserving candidate state does not bypass a confirmed bad health result", () => {
    const admissionResult = h.scope.panAutoHealthAdmission(h.candidate, {});
    assert.equal(admissionResult.accepted, false);
    assert.equal(admissionResult.state, "bad");
  });
}

const failures = checks.filter(([, passed]) => !passed);
for (const [name, passed, detail] of checks) {
  console.log(`${name} = ${passed ? "PASS" : "FAIL"}${detail ? ` :: ${detail}` : ""}`);
}
if (failures.length) {
  console.log(`BASELINE_FAILURES_REPRODUCED = ${failures.length}`);
  process.exitCode = 1;
} else {
  console.log("DETAIL_RETURN_AND_PAN_STATE_OWNERSHIP = PASS");
}
