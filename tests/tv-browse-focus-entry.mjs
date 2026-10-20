import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { renderIndex, validateRenderedArtifact } from "../scripts/build-core.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(process.env.WEBHOME_PLAYWRIGHT_PATH || join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }

const { output } = renderIndex();
validateRenderedArtifact(output);
const hook = `window.testBrowse = {
 state, tvBrowseState, tvBrowsePosition, tvBrowseFocusIntent, tvBrowseBeginStartup, tvBrowseOpenHistory,
 tvBrowseCloseHistory, tvBrowseSnapshot, restoreTvBrowseSnapshot, renderTvBrowse, homeFocusUserEpoch,
 normalizeRecentWatchingItems, sdk, bindActions, installRemoteKeys, syncBrowseDevicePresentation, focusRemoteTarget,
 ensureRemoteInitialFocus, ensureRemoteActiveFocus, tvBrowseColdStartFocusPending,
 tvWallpaperState, tvWallpaperScheduleIdle, tvWallpaperStopTimer, tvWallpaperCanEnter, tvWallpaperMove
};
window.testBrowse.setup = () => { syncBrowseDevicePresentation(); bindActions(); installRemoteKeys(); };
window.testBrowse.seedHistory = (raw) => normalizeRecentWatchingItems(raw);
window.testBrowse.rawHistory = (count, prefix, newestTime) => Array.from({ length: count }, (_, index) => ({
  key: 'fixture@@@' + prefix + '-' + index + '@@@0', siteKey: 'fixture', vodId: prefix + '-' + index,
  vodName: prefix + ' 历史 ' + (index + 1), vodPic: '/poster-history.svg',
  createTime: (newestTime || Date.now()) - index * 1000, position: 5000, duration: 60000
}));
window.testBrowse.scheduleStartupChecks = () => {
  setTimeout(ensureRemoteInitialFocus, 80);
  setTimeout(ensureRemoteInitialFocus, 260);
};
`;
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output);

const browser = await playwright.chromium.launch({ headless: true,
  ...(process.env.WEBHOME_BROWSER_EXECUTABLE ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE }
    : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" }) });
const errors = [];

async function pageAt(options) {
  const opts = options || {}, page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: html });
    }
    if (route.request().resourceType() === "image") {
      if (opts.imageDelay) await new Promise((resolve) => setTimeout(resolve, opts.imageDelay));
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="960"><rect width="640" height="960" fill="#456"/></svg>' });
    }
    if (url.includes("api.themoviedb.org") || url.includes("fixture.local/tmdb")) {
      return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ total_pages: 1, total_results: 0, results: [] }) });
    }
    return route.abort();
  });
  await page.goto("http://fixture.local/?_tv=1", { waitUntil: "domcontentloaded" });
  await page.evaluate((setup) => {
    window.WEBHOME_CONFIG.tmdb.apiBase = "http://fixture.local/tmdb";
    window.WEBHOME_CONFIG.tmdb.apiKey = "fixture";
    testBrowse.state.previewMode = true;
    testBrowse.state.activeList = "all";
    testBrowse.state.uiPrefs = Object.assign({}, testBrowse.state.uiPrefs || {}, {
      tvWallpaperEnterSeconds: 0, tvWallpaperIntervalSeconds: 0
    });
    document.documentElement.classList.add("tv-preview", "tv-mode");
    testBrowse.state.hot.ready = true;
    testBrowse.state.hot.items = Array.from({ length: 36 }, (_, index) => ({
      id: 8100 + index, tmdbId: 8100 + index, title: "推荐" + index, mediaType: "movie",
      source: "nostr-hot", pic: "/poster-" + index + ".svg", landscape: "/backdrop-" + index + ".svg",
      overview: "简介 " + index, releaseDate: "2025-01-01"
    }));
    testBrowse.state.recent.loaded = true;
    testBrowse.state.recent.loading = false;
    testBrowse.state.recent.items = [];
    testBrowse.state.recent.refreshedAt = Date.now();
    if (setup) {
      testBrowse.setup();
      testBrowse.tvBrowseBeginStartup(testBrowse.homeFocusUserEpoch());
      testBrowse.scheduleStartupChecks();
    }
  }, !!opts.setup);
  return page;
}

async function waitForCard(page, index) {
  await page.waitForFunction((wanted) => {
    const active = document.activeElement;
    return !!(active && active.matches("#tvBrowseRail .card") && Number(active.dataset.cardIndex) === wanted);
  }, index, { timeout: 8000 });
}

async function waitForRailReady(page) {
  await page.waitForFunction(() => !document.querySelector("#tvBrowsePosters").classList.contains("rail-loading")
    && !document.querySelector("#tvBrowseColumns").classList.contains("tv-browse-columns-pending"), null, { timeout: 10000 });
}

try {
  // Cold start keeps preview/rendering alive while startup and Gate focus work
  // are suppressed. The two production 80/260ms recovery checks run here.
  const cold = await pageAt({ setup: true, imageDelay: 180 });
  const beforeReady = await cold.evaluate(() => ({
    activeTag: document.activeElement.tagName,
    cardFocused: !!document.activeElement.closest?.("#tvBrowseRail .card"),
    pending: testBrowse.tvBrowseColdStartFocusPending()
  }));
  assert.equal(beforeReady.cardFocused, false);
  assert.equal(beforeReady.pending, true);
  await waitForRailReady(cold);
  await cold.waitForTimeout(360);
  const preview = await cold.evaluate(() => ({
    title: document.querySelector("#tvBrowseTitle").textContent,
    firstTitle: document.querySelector('#tvBrowseRail .card[data-card-index="0"] .title')?.textContent || "",
    active: document.activeElement,
    cardFocused: !!document.activeElement.closest?.("#tvBrowseRail .card"),
    columnFocused: !!document.activeElement.closest?.("#tvBrowseColumns button"),
    pending: testBrowse.tvBrowseColdStartFocusPending()
  }));
  assert.equal(preview.title, "推荐0", "the first recommendation remains the displayed preview");
  assert.equal(preview.cardFocused, false, "Gate completion and auto-focus checks do not focus the first poster");
  assert.equal(preview.columnFocused, false);
  assert.equal(preview.pending, true);

  await cold.keyboard.press("ArrowUp");
  await cold.waitForFunction(() => document.activeElement && document.activeElement.id === "tvColumn-recommendation");
  assert.equal(await cold.evaluate(() => testBrowse.tvBrowseState().coldStartFocusIntent), null,
    "one first direction is consumed to establish real category focus");
  await cold.keyboard.press("ArrowRight");
  await cold.waitForFunction(() => document.activeElement?.matches("#tvBrowseColumns button")
    && document.activeElement.id !== "tvColumn-recommendation");
  await cold.keyboard.press("ArrowLeft");
  await cold.waitForFunction(() => document.activeElement?.id === "tvColumn-recommendation");
  await cold.keyboard.press("ArrowDown");
  await waitForCard(cold, 0);
  console.log("TV_COLD_START_PREVIEW_NO_FOCUS_AND_FIRST_DPAD = PASS (browser)");
  console.log("TV_FIRST_DPAD_ONLY_FOCUSES_RECOMMENDATION_THEN_NORMAL_NAV = PASS (browser)");

  await cold.keyboard.press("ArrowRight");
  await waitForCard(cold, 1);
  const snapshot = await cold.evaluate(() => testBrowse.tvBrowseSnapshot());
  await cold.evaluate(() => testBrowse.focusRemoteTarget(document.querySelector("#tvFunction-settings")));
  await cold.evaluate((value) => {
    testBrowse.restoreTvBrowseSnapshot(value);
    testBrowse.renderTvBrowse();
    testBrowse.tvBrowseFocusIntent();
  }, snapshot);
  await waitForCard(cold, 1);
  assert.equal(await cold.evaluate(() => testBrowse.tvBrowseState().coldStartFocusIntent), null,
    "snapshot restore uses saved focus and never re-arms cold startup");
  console.log("TV_SNAPSHOT_RESTORE_RETAINS_SAVED_CARD = PASS (browser)");
  await cold.close();

  // The first D-pad may arrive while the visibility Gate still hides columns.
  // The key is held as an intent and resolved only after the existing release.
  const gated = await pageAt({ setup: true, imageDelay: 650 });
  await gated.waitForFunction(() => document.querySelector("#tvBrowsePosters").classList.contains("rail-loading"));
  await gated.keyboard.press("ArrowDown");
  const queued = await gated.evaluate(() => ({
    phase: testBrowse.tvBrowseState().coldStartFocusIntent?.phase,
    focusedColumn: document.activeElement?.closest?.("#tvBrowseColumns button")?.id || "",
    focusedCard: !!document.activeElement?.closest?.("#tvBrowseRail .card")
  }));
  assert.equal(queued.phase, "waiting-columns");
  assert.equal(queued.focusedColumn, "", "the hidden category never receives focus");
  assert.equal(queued.focusedCard, false, "generic focus recovery cannot fall through to a hidden poster");
  await waitForRailReady(gated);
  await gated.waitForFunction(() => document.activeElement?.id === "tvColumn-recommendation");
  console.log("TV_GATE_DPAD_QUEUED_UNTIL_CATEGORY_VISIBLE = PASS (browser)");
  await gated.close();

  // A truly idle cold start still prepares the preview and can enter wallpaper.
  // Set lastActivityAt to the configured deadline to exercise the real scheduler
  // without waiting ten wall-clock seconds.
  const wallpaper = await pageAt({ setup: true, imageDelay: 120 });
  await waitForRailReady(wallpaper);
  await wallpaper.waitForTimeout(300);
  const beforeWallpaper = await wallpaper.evaluate(() => ({
    cardFocused: !!document.activeElement?.closest?.("#tvBrowseRail .card"),
    currentKey: testBrowse.tvBrowseState().previewKey,
    pending: testBrowse.tvBrowseState().coldStartFocusIntent?.phase || ""
  }));
  assert.equal(beforeWallpaper.cardFocused, false);
  assert.ok(beforeWallpaper.currentKey, "the preview identity is initialized without DOM focus");
  assert.equal(beforeWallpaper.pending, "armed");
  await wallpaper.evaluate(() => {
    const state = testBrowse.tvBrowseState();
    testBrowse.state.uiPrefs.tvWallpaperEnterSeconds = 10;
    testBrowse.state.uiPrefs.tvWallpaperIntervalSeconds = 0;
    testBrowse.tvWallpaperStopTimer();
    state.wallpaper.lastActivityAt = Date.now() - 10000;
    testBrowse.tvWallpaperScheduleIdle(false);
  });
  await wallpaper.waitForFunction(() => testBrowse.tvWallpaperState().active && document.activeElement.id === "tvBrowse");
  assert.equal(await wallpaper.evaluate(() => testBrowse.tvBrowseState().coldStartFocusIntent), null,
    "wallpaper entry invalidates any unused cold-start focus intent");
  const wallpaperFirstKey = await wallpaper.evaluate(() => testBrowse.tvBrowsePosition().key);
  await wallpaper.keyboard.press("ArrowRight");
  await wallpaper.waitForFunction((key) => testBrowse.tvBrowsePosition().key !== key, wallpaperFirstKey);
  const wallpaperCurrentKey = await wallpaper.evaluate(() => testBrowse.tvBrowsePosition().key);
  await wallpaper.keyboard.press("ArrowDown");
  await wallpaper.waitForFunction(() => !testBrowse.tvWallpaperState().active);
  await wallpaper.waitForFunction((key) => document.activeElement?.matches("#tvBrowseRail .card")
    && document.activeElement.dataset.mediaKey === key, wallpaperCurrentKey);
  console.log("TV_WALLPAPER_IDLE_ENTRY_DPAD_AND_EXIT_FOCUS = PASS (browser)");
  await wallpaper.close();

  // Explicitly reopening History begins at the first currently sorted row;
  // refresh completion must not steal a user's later selection.
  const history = await pageAt({ setup: true });
  const firstHistoryKey = await history.evaluate(() => {
    const rows = testBrowse.seedHistory(testBrowse.rawHistory(8, "entry"));
    const ui = testBrowse.tvBrowseState();
    testBrowse.state.recent.items = rows;
    testBrowse.state.recent.loaded = true;
    testBrowse.state.recent.loading = false;
    testBrowse.state.recent.refreshedAt = Date.now();
    ui.positions["native-history"] = { key: rows[4].id, index: 4, scrollLeft: 512 };
    testBrowse.tvBrowseOpenHistory();
    return rows[0].id;
  });
  await waitForCard(history, 0);
  assert.equal(await history.evaluate(() => document.activeElement.dataset.mediaKey), firstHistoryKey);
  assert.deepEqual(await history.evaluate(() => {
    const p = testBrowse.tvBrowseState().positions["native-history"];
    return [p.key, p.index, p.scrollLeft];
  }), [firstHistoryKey, 0, 0]);
  for (let index = 1; index <= 4; index += 1) {
    await history.keyboard.press("ArrowRight");
    await waitForCard(history, index);
  }
  await history.evaluate(() => testBrowse.tvBrowseCloseHistory());
  await history.evaluate(() => testBrowse.tvBrowseOpenHistory());
  await waitForCard(history, 0);
  assert.equal(await history.evaluate(() => document.activeElement.dataset.mediaKey), firstHistoryKey);
  console.log("TV_HISTORY_REOPEN_STARTS_FIRST = PASS (browser)");
  await history.close();

  // A pending native History read still focuses the first result after it
  // arrives, while an input during a refresh invalidates that focus intent.
  const delayed = await pageAt({ setup: true });
  await delayed.evaluate(() => {
    testBrowse.state.recent.loaded = false;
    testBrowse.state.recent.items = [];
    const response = new Promise((resolve) => { window.resolveHistory = resolve; });
    window.fm = Object.assign({}, testBrowse.sdk(), { history: () => response });
    testBrowse.tvBrowseOpenHistory();
  });
  await delayed.waitForFunction(() => window.resolveHistory && testBrowse.state.recent.loading);
  await delayed.evaluate(() => resolveHistory(testBrowse.rawHistory(3, "delayed")));
  await delayed.waitForFunction(() => !testBrowse.state.recent.loading);
  await waitForCard(delayed, 0);
  assert.equal(await delayed.evaluate(() => Number(document.activeElement.dataset.cardIndex)), 0);
  await delayed.close();
  console.log("TV_HISTORY_DELAYED_LOAD_STARTS_FIRST = PASS (browser)");

  const userMoved = await pageAt({ setup: true });
  const movedKey = await userMoved.evaluate(() => {
    const raw = testBrowse.rawHistory(6, "refresh", Date.now() - 100000);
    const rows = testBrowse.seedHistory(raw);
    testBrowse.state.recent.items = rows;
    testBrowse.state.recent.loaded = true;
    testBrowse.state.recent.loading = false;
    testBrowse.state.recent.refreshedAt = 0;
    const response = new Promise((resolve) => { window.resolveHistory = resolve; });
    window.fm = Object.assign({}, testBrowse.sdk(), { history: () => response });
    testBrowse.tvBrowseOpenHistory();
    return rows[1].id;
  });
  await userMoved.waitForFunction(() => window.resolveHistory && testBrowse.state.recent.loading);
  await waitForCard(userMoved, 0);
  await userMoved.keyboard.press("ArrowRight");
  await waitForCard(userMoved, 1);
  assert.equal(await userMoved.evaluate(() => document.activeElement.dataset.mediaKey), movedKey);
  await userMoved.evaluate(() => resolveHistory(testBrowse.rawHistory(7, "refresh", Date.now() + 10000)));
  await userMoved.waitForFunction(() => !testBrowse.state.recent.loading);
  await userMoved.waitForFunction((key) => document.activeElement && document.activeElement.dataset.mediaKey === key, movedKey);
  assert.equal(await userMoved.evaluate(() => testBrowse.tvBrowseState().positions["native-history"].key), movedKey,
    "a user move during refresh is not reset to the first row");
  await userMoved.close();
  console.log("TV_HISTORY_USER_MOVE_NOT_STOLEN = PASS (browser)");

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
