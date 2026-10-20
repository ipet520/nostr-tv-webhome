import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vm from "node:vm";

const browseSource = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
const focusSource = readFileSync(new URL("../src/js/14-grid-card-focus.js", import.meta.url), "utf8");

function extract(source, name, next) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf(`\n    function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `can isolate ${name}`);
  return source.slice(start, end);
}

const beginStartup = extract(browseSource, "tvBrowseBeginStartup", "tvBrowseCancelColdStartFocusIntent");
const cancelCold = extract(browseSource, "tvBrowseCancelColdStartFocusIntent", "tvBrowseColdStartFocusContextCurrent");
const contextCurrent = extract(browseSource, "tvBrowseColdStartFocusContextCurrent", "tvBrowseColdStartFocusPending");
const pendingCold = extract(browseSource, "tvBrowseColdStartFocusPending", "tvBrowseShouldCaptureColdStartDpad");
const initialColumnsPending = extract(browseSource, "tvBrowseInitialColumnsPending", "tvBrowseShouldCaptureColdStartDpad");
const shouldCapture = extract(browseSource, "tvBrowseShouldCaptureColdStartDpad", "tvBrowseConsumeColdStartDpad");
const consumeCold = extract(browseSource, "tvBrowseConsumeColdStartDpad", "tvBrowseResolveColdStartFocusIntent");
const resolveCold = extract(browseSource, "tvBrowseResolveColdStartFocusIntent", "tvBrowseActive");
const releaseColumns = extract(browseSource, "tvBrowseReleaseInitialColumns", "tvBrowsePosterSource");
const openHistory = extract(browseSource, "tvBrowseOpenHistory", "tvBrowseCloseHistory");
const tryFocus = extract(browseSource, "tvBrowseTryFocus", "tvBrowseSelectColumn");
const restoreSnapshot = extract(browseSource, "restoreTvBrowseSnapshot", "renderCatalogQuery");
const ensureInitial = extract(focusSource, "ensureRemoteInitialFocus", "ensureRemoteActiveFocus");
const ensureActive = extract(focusSource, "ensureRemoteActiveFocus", "focusInitialHomeNow");
const initialHome = extract(focusSource, "initialHomeFocus", "currentHomeFocus");

const coldHelpers = [cancelCold, contextCurrent, pendingCold, initialColumnsPending, shouldCapture, consumeCold, resolveCold].join("\n");
let rendered = 0;
let focusIntentCalls = 0;
const recommendationPosition = { key: "old-key", index: 8, scrollLeft: 640 };
const startupUi = {
  column: "history", view: "history", focusIntent: { epoch: 0, focus: { type: "id", key: "stale" } },
  retryFocusIntent: { epoch: 0 }, coldStartFocusIntent: null,
  positions: { recommendation: recommendationPosition }
};
const startupRuntime = {
  state: { tvBrowse: startupUi, homeV14: {}, remoteInitialFocused: false },
  tvBrowseState: () => startupUi,
  tvBrowseActive: () => true,
  homeFocusUserEpoch: () => 7,
  tvBrowseQueryKey: () => "recommendation",
  tvBrowsePosition: () => recommendationPosition,
  renderTvBrowse: () => { rendered += 1; },
  tvBrowseFocusIntent: () => { focusIntentCalls += 1; }
};
vm.runInNewContext(`${beginStartup}\nglobalThis.beginStartup = tvBrowseBeginStartup;`, startupRuntime);
startupRuntime.beginStartup(7);
assert.equal(startupUi.column, "recommendation");
assert.equal(startupUi.view, "home");
assert.deepEqual(JSON.parse(JSON.stringify(recommendationPosition)), { key: "", index: 0, scrollLeft: 0 });
assert.deepEqual(JSON.parse(JSON.stringify(startupUi.coldStartFocusIntent)), { phase: "armed", epoch: 7, queryKey: "recommendation" });
assert.equal(startupUi.focusIntent, null);
assert.equal(startupUi.retryFocusIntent, null);
assert.equal(rendered, 1, "the normal Browse render still initializes the preview and resources");
assert.equal(focusIntentCalls, 0, "cold startup no longer creates a focus request");
console.log("TV_COLD_START_PREVIEW_WITHOUT_FOCUS = PASS (production function VM)");

const category = { id: "tvColumn-recommendation" };
let columnsVisible = true;
let columnsGatePending = false;
let focusEpoch = 7;
let wallpaperActive = false;
let sidebarOpen = false;
const activeDocument = { activeElement: { tagName: "BODY" } };
let scope = activeDocument;
const focusLog = [];
const columnsElement = { classList: { contains: (name) => name === "tv-browse-columns-pending" && columnsGatePending } };
const focusUi = {
  view: "home", column: "recommendation",
  coldStartFocusIntent: { phase: "armed", epoch: 7, queryKey: "recommendation" }
};
const focusState = { remoteInitialFocused: false, tvBrowse: focusUi };
const focusRuntime = {
  state: focusState, document: activeDocument,
  tvBrowseState: () => focusUi,
  tvBrowseActive: () => true,
  tvBrowseQueryKey: () => "recommendation",
  tvWallpaperIsActive: () => wallpaperActive,
  isSidebarOpen: () => sidebarOpen,
  focusScopeRoot: () => scope,
  homeFocusUserEpoch: () => focusEpoch,
  $: (id) => id === "tvColumn-recommendation" ? category : id === "tvBrowseColumns" ? columnsElement : null,
  isVisibleFocusable: (target) => target === category && columnsVisible,
  focusRemoteTarget: (target) => { activeDocument.activeElement = target; focusLog.push(target.id); },
  tvBrowseColdStartFocusContextCurrent: undefined
};
vm.runInNewContext(`${coldHelpers}\nglobalThis.cold = {
  cancel: tvBrowseCancelColdStartFocusIntent,
  pending: tvBrowseColdStartFocusPending,
  shouldCapture: tvBrowseShouldCaptureColdStartDpad,
  consume: tvBrowseConsumeColdStartDpad,
  resolve: tvBrowseResolveColdStartFocusIntent
};`, focusRuntime);

const firstKey = { prevented: false, stopped: false, immediateStopped: false,
  preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; },
  stopImmediatePropagation() { this.immediateStopped = true; } };
assert.equal(focusRuntime.cold.shouldCapture("ArrowLeft"), true);
assert.equal(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].every((key) => focusRuntime.cold.shouldCapture(key)), true,
  "all four D-pad directions share the same one-shot category activation rule");
assert.equal(focusRuntime.cold.shouldCapture("Enter"), false);
focusEpoch += 1; // markHomeUserNavigation runs before the main key handler.
assert.equal(focusRuntime.cold.consume(firstKey, "ArrowLeft"), true);
assert.equal(activeDocument.activeElement, category, "the first direction focuses only the Recommendation category");
assert.deepEqual(focusLog, ["tvColumn-recommendation"]);
assert.equal(firstKey.prevented && firstKey.stopped && firstKey.immediateStopped, true, "the handled key cannot continue to generic navigation");
assert.equal(focusUi.coldStartFocusIntent, null, "the one-shot intent clears after successful focus");
console.log("TV_FIRST_DPAD_CONSUMED_ONCE = PASS (production helper VM)");

focusUi.coldStartFocusIntent = { phase: "armed", epoch: focusEpoch, queryKey: "recommendation" };
columnsVisible = false;
activeDocument.activeElement = { tagName: "BODY" };
const gateKey = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {} };
assert.equal(focusRuntime.cold.consume(gateKey, "ArrowDown"), true);
assert.equal(focusUi.coldStartFocusIntent.phase, "waiting-columns");
assert.deepEqual(focusLog, ["tvColumn-recommendation"], "hidden category does not receive focus while the Gate is active");
columnsVisible = true;
vm.runInNewContext(`${releaseColumns}\nglobalThis.release = tvBrowseReleaseInitialColumns;`, Object.assign(focusRuntime, {
  $: (id) => id === "tvBrowseColumns" ? { classList: { contains: () => true, remove() {} } } : id === "tvColumn-recommendation" ? category : null,
  syncTvBrowseVisibility: () => {},
  tvBrowseTryFocus: () => {},
  tvWallpaperIsActive: () => false
}));
focusRuntime.release();
assert.equal(activeDocument.activeElement, category, "Gate release fulfills the still-current pending focus intent");
assert.equal(focusUi.coldStartFocusIntent, null);
assert.equal(focusLog.length, 2);
console.log("TV_GATE_PENDING_FOCUS_RESOLVES_WHEN_VISIBLE = PASS (production function VM)");

focusUi.coldStartFocusIntent = { phase: "waiting-columns", epoch: focusEpoch, queryKey: "recommendation" };
columnsVisible = true;
focusUi.view = "history";
const staleFocusCount = focusLog.length;
assert.equal(focusRuntime.cold.resolve(), false);
assert.equal(focusUi.coldStartFocusIntent, null, "route change invalidates the deferred focus intent");
assert.equal(focusLog.length, staleFocusCount, "stale intent cannot focus Recommendation after route change");
console.log("TV_STALE_COLD_FOCUS_INTENT_DROPPED = PASS (production helper VM)");

focusUi.view = "home";
focusUi.coldStartFocusIntent = { phase: "armed", epoch: focusEpoch, queryKey: "recommendation" };
let autoIntentCalls = 0, posterFallbackCalls = 0;
const autoFocusRuntime = Object.assign({}, focusRuntime, {
  tvBrowseColdStartFocusPending: () => true,
  tvBrowseInitialColumnsPending: () => false,
  tvBrowseInitialColumnsPending: () => false,
  tvBrowseFocusIntent: () => { autoIntentCalls += 1; },
  tvBrowseTryFocus: () => { autoIntentCalls += 1; },
  isSidebarOpen: () => false,
  focusScopeRoot: () => activeDocument,
  isVisibleFocusable: () => false,
  restoreConnectionPanelFocus: () => false,
  tvBrowsePosterTarget: () => { posterFallbackCalls += 1; return category; },
  firstContentFocus: () => category
});
vm.runInNewContext(`${ensureInitial}\n${ensureActive}\nglobalThis.checkAutoFocus = [ensureRemoteInitialFocus, ensureRemoteActiveFocus];`, autoFocusRuntime);
autoFocusRuntime.checkAutoFocus[0]();
assert.equal(autoIntentCalls, 0, "80/260ms-style automatic checks do not establish focus during cold preview");
assert.equal(autoFocusRuntime.checkAutoFocus[1](), true);
assert.equal(posterFallbackCalls, 0, "active-focus fallback cannot bypass first-DPAD category focus");
console.log("TV_AUTOMATIC_FOCUS_CHECKS_GUARDED = PASS (production function VM)");

const cancelledColdAutoRuntime = Object.assign({}, autoFocusRuntime, {
  tvBrowseColdStartFocusPending: () => false,
  tvBrowseInitialColumnsPending: undefined,
  $: (id) => id === "tvBrowseColumns" ? columnsElement : null
});
columnsGatePending = true;
vm.runInNewContext(`${initialColumnsPending}\n${ensureInitial}\n${ensureActive}\n${initialHome}\nglobalThis.checkPendingColumns = [ensureRemoteInitialFocus, ensureRemoteActiveFocus, initialHomeFocus];`, cancelledColdAutoRuntime);
cancelledColdAutoRuntime.checkPendingColumns[0]();
assert.equal(autoIntentCalls, 0, "an invalidated cold intent cannot be recreated by delayed automatic focus during the Gate");
assert.equal(cancelledColdAutoRuntime.checkPendingColumns[1](), true);
assert.equal(cancelledColdAutoRuntime.checkPendingColumns[2](), null);
assert.equal(posterFallbackCalls, 0, "the initial-column Gate cannot fall through to a hidden poster after intent invalidation");
console.log("TV_GATE_NO_HIDDEN_POSTER_FALLBACK_AFTER_NAVIGATION = PASS (production function VM)");

const markNavigation = extract(focusSource, "markHomeUserNavigation", "ensureRemoteInitialFocus");
const navigatedUi = { coldStartFocusIntent: { phase: "waiting-columns" } };
const navigationRuntime = {
  state: { homeV14: { focusUserEpoch: 4 } },
  tvBrowseActive: () => true,
  tvBrowseCancelColdStartFocusIntent: () => { navigatedUi.coldStartFocusIntent = null; },
  focusReturnEl: null,
  navigatedUi
};
vm.runInNewContext(`${markNavigation}\nglobalThis.markNavigation = markHomeUserNavigation;`, navigationRuntime);
navigationRuntime.markNavigation();
assert.equal(navigatedUi.coldStartFocusIntent, null, "a subsequent effective navigation invalidates the deferred category focus");
assert.equal(navigationRuntime.state.homeV14.focusUserEpoch, 5);
console.log("TV_NEW_NAVIGATION_INVALIDATES_QUEUED_COLD_FOCUS = PASS (production function VM)");

const historyEvents = [];
const historyPosition = { key: "old-history", index: 4, scrollLeft: 512 };
const historyUi = { view: "home", filterOpen: false, positions: { "native-history": historyPosition }, focusIntent: null };
const historyRuntime = {
  state: { tvBrowse: historyUi }, document: { activeElement: { id: "tvFunction-history" } },
  tvBrowseState: () => historyUi,
  tvBrowseActive: () => true,
  tvBrowseCancelColdStartFocusIntent: () => { historyEvents.push("cancel-cold-start"); },
  tvBrowseSavePosition: () => historyEvents.push("save-home-position"),
  homeFocusSnapshot: () => ({ type: "id", key: "tvFunction-history" }),
  clearTvPanelHistoryEntry: () => historyEvents.push("clear-filter-history"),
  ensureTvPanelHistoryEntry: () => historyEvents.push("push-history-marker"),
  shouldRefreshRecentList: () => true,
  loadRecentList: (options) => { historyEvents.push(["load-history", options.refresh]); return Promise.resolve(); },
  renderTvBrowse: () => historyEvents.push("render-history"),
  tvBrowseFocusIntent: (focus, options) => historyEvents.push(["history-focus-intent", focus, options])
};
vm.runInNewContext(`${openHistory}\nglobalThis.openHistory = tvBrowseOpenHistory;`, historyRuntime);
historyRuntime.openHistory();
assert.deepEqual(JSON.parse(JSON.stringify(historyPosition)), { key: "", index: 0, scrollLeft: 0 });
assert.equal(historyUi.view, "history");
assert.ok(historyEvents.indexOf("save-home-position") < historyEvents.findIndex((event) => Array.isArray(event) && event[0] === "load-history"));
assert.ok(historyEvents.indexOf("render-history") < historyEvents.findIndex((event) => Array.isArray(event) && event[0] === "history-focus-intent"));
console.log("TV_HISTORY_ENTRY_POSITION_RESET_PRESERVED = PASS (production function VM)");

const snapshotUi = { coldStartFocusIntent: { phase: "armed", epoch: 9, queryKey: "recommendation" } };
const snapshotRuntime = {
  tvBrowseState: () => snapshotUi,
  tvBrowseCancelColdStartFocusIntent: () => { snapshotUi.coldStartFocusIntent = null; },
  tvBrowseColumns: () => [{ listId: "recommendation" }],
  state: { homeV14: { secondaryFilters: {} } },
  secondaryCatalogBaseItems: () => [], secondaryFilterGroups: () => []
};
vm.runInNewContext(`${restoreSnapshot}\nglobalThis.restore = restoreTvBrowseSnapshot;`, snapshotRuntime);
snapshotRuntime.restore({ view: "home", column: "recommendation", positions: {}, filters: {} });
assert.equal(snapshotUi.coldStartFocusIntent, null, "snapshot restore never enters cold no-focus mode");
console.log("TV_SNAPSHOT_RESTORE_COLD_FOCUS_CLEARED = PASS (production function VM)");
