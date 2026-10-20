import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vm from "node:vm";

const source = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
function extract(name, next) {
  const start = source.indexOf(`    function ${name}(`);
  const end = source.indexOf(`\n    function ${next}(`, start);
  assert.ok(start >= 0 && end > start, `can isolate ${name}`);
  return source.slice(start, end);
}

const openHistory = extract("tvBrowseOpenHistory", "tvBrowseCloseHistory");
const focusIntent = extract("tvBrowseFocusIntent", "tvBrowseTryFocus");
const tryFocus = extract("tvBrowseTryFocus", "tvBrowseSelectColumn");
const beginStartup = extract("tvBrowseBeginStartup", "tvBrowseActive");
const restoreSnapshot = extract("restoreTvBrowseSnapshot", "renderCatalogQuery");

const events = [];
const historyUi = {
  view: "home", filterOpen: false, positions: {
    "native-history": { key: "previous-history-row", index: 4, scrollLeft: 428 }
  }, focusIntent: { epoch: 2, focus: { type: "id", key: "oldFocus" } }
};
const historyRuntime = {
  state: { tvBrowse: historyUi },
  document: { activeElement: { id: "tvFunction-history" } },
  tvBrowseState: () => historyUi,
  tvBrowseActive: () => true,
  tvBrowseSavePosition: () => events.push("save-home-position"),
  homeFocusSnapshot: () => ({ type: "id", key: "tvFunction-history" }),
  clearTvPanelHistoryEntry: () => events.push("clear-filter-history"),
  ensureTvPanelHistoryEntry: () => events.push("push-history-marker"),
  shouldRefreshRecentList: () => true,
  loadRecentList: (options) => { events.push(["load-history", options.refresh]); return Promise.resolve(); },
  renderTvBrowse: () => events.push("render-history"),
  tvBrowseFocusIntent: (focus, options) => events.push(["history-focus-intent", focus, options])
};
vm.runInNewContext(`${openHistory}\nglobalThis.openHistory = tvBrowseOpenHistory;`, historyRuntime);
historyRuntime.openHistory();
assert.deepEqual(JSON.parse(JSON.stringify(historyUi.positions["native-history"])), { key: "", index: 0, scrollLeft: 0 });
assert.equal(historyUi.view, "history");
assert.equal(historyUi.focusIntent, null, "the old view's focus request is discarded on explicit History entry");
assert.ok(events.indexOf("save-home-position") < events.findIndex((event) => Array.isArray(event) && event[0] === "load-history"));
assert.ok(events.findIndex((event) => Array.isArray(event) && event[0] === "load-history") < events.indexOf("render-history"));
assert.ok(events.indexOf("render-history") < events.findIndex((event) => Array.isArray(event) && event[0] === "history-focus-intent"));
console.log("TV_HISTORY_NEW_ENTRY_RESETS_POSITION = PASS (production function VM)");

const startupUi = { column: "recommendation", view: "home" };
const startupRuntime = {
  state: { homeV14: {} }, tvBrowseState: () => startupUi, tvBrowseActive: () => true,
  homeFocusUserEpoch: () => 7, tvBrowseQueryKey: () => "recommendation",
  renderTvBrowse: () => {}, tvBrowseFocusIntent: () => {}
};
vm.runInNewContext(`${beginStartup}\nglobalThis.beginStartup = tvBrowseBeginStartup;`, startupRuntime);
startupRuntime.beginStartup(7);
assert.deepEqual(JSON.parse(JSON.stringify(startupUi.startupFocusAnimation)), { epoch: 7, queryKey: "recommendation" });
console.log("TV_COLD_START_INITIAL_FOCUS_STATE = PASS (production function VM)");

const classNames = new Set();
const callbacks = [];
const fakeRail = {};
const focusedCard = {
  dataset: { cardIndex: "0" },
  classList: { add: (name) => classNames.add(name), remove: (name) => classNames.delete(name) },
  closest: (selector) => selector === "#tvBrowseRail .card" ? focusedCard : selector === "#tvBrowseRail" ? fakeRail : null,
  querySelector: (selector) => selector === ".poster-wrap" ? {} : null
};
const focusDocument = { activeElement: null };
const focusUi = {
  view: "home", column: "recommendation", focusIntent: { epoch: 11, focus: null },
  startupFocusAnimation: { epoch: 11, queryKey: "recommendation" }
};
const focusState = { remoteInitialFocused: false, hot: { ready: true } };
const focusQuery = { loaded: true, loading: false, hasMore: false, items: [{}] };
const focusRuntime = {
  state: focusState, document: focusDocument, tvBrowseState: () => focusUi,
  homeFocusUserEpoch: () => 11, tvBrowseQueryKey: () => "recommendation",
  tvWallpaperIsActive: () => false, tvBrowseActive: () => true, isSidebarOpen: () => false,
  focusScopeRoot: () => focusDocument, secondaryActiveQuery: () => focusQuery,
  tvBrowsePosition: () => ({ key: "", index: 0 }), tvBrowsePosterTarget: () => focusedCard,
  isVisibleFocusable: () => true,
  focusRemoteTarget: (target) => { focusDocument.activeElement = target; },
  getComputedStyle: (target, pseudo) => pseudo ? { opacity: "1" } : { transform: "matrix(1.04, 0, 0, 1.04, 0, 0)" },
  requestAnimationFrame: (callback) => callbacks.push(callback)
};
vm.runInNewContext(`${tryFocus}\nglobalThis.tryFocus = tvBrowseTryFocus;`, focusRuntime);
focusRuntime.tryFocus();
assert.equal(focusDocument.activeElement, focusedCard, "the current first card receives the real DOM focus immediately");
assert.equal(classNames.has("tv-browse-initial-focus"), true, "the one-frame no-transition marker applies only to the initial card");
assert.equal(focusState.remoteInitialFocused, true);
assert.equal(focusUi.startupFocusAnimation, null);
callbacks.shift()();
assert.equal(classNames.has("tv-browse-initial-focus"), false, "the marker is removed on the next animation frame");
console.log("TV_COLD_START_FOCUS_SETTLES_WITHOUT_TRANSITION = PASS (production function VM)");

const restoreUi = { startupFocusAnimation: { epoch: 12, queryKey: "recommendation" } };
const restoreRuntime = {
  tvBrowseState: () => restoreUi, tvBrowseColumns: () => [{ listId: "recommendation" }],
  state: { homeV14: { secondaryFilters: {} } }, secondaryCatalogBaseItems: () => [],
  secondaryFilterGroups: () => []
};
vm.runInNewContext(`${restoreSnapshot}\nglobalThis.restore = restoreTvBrowseSnapshot;`, restoreRuntime);
restoreRuntime.restore({ view: "history", column: "recommendation", positions: {}, filters: {} });
assert.equal(restoreUi.startupFocusAnimation, null, "UI snapshot restoration does not inherit cold-start focus styling");
console.log("TV_SNAPSHOT_FOCUS_NOT_CLASSIFIED_AS_COLD_START = PASS (production function VM)");
