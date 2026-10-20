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
const hook = `window.testBrowse = { state, tvBrowseState, tvBrowseFocusIntent, tvBrowseBeginStartup, tvBrowseOpenHistory,
 tvBrowseCloseHistory, tvBrowseSnapshot, restoreTvBrowseSnapshot, renderTvBrowse, homeFocusUserEpoch,
 normalizeRecentWatchingItems, sdk, bindActions, installRemoteKeys, syncBrowseDevicePresentation, focusRemoteTarget };
window.testBrowse.setup = () => { syncBrowseDevicePresentation(); bindActions(); installRemoteKeys(); };
window.testBrowse.seedHistory = (raw) => normalizeRecentWatchingItems(raw);
window.testBrowse.rawHistory = (count, prefix, newestTime) => Array.from({ length: count }, (_, index) => ({
  key: 'fixture@@@' + prefix + '-' + index + '@@@0', siteKey: 'fixture', vodId: prefix + '-' + index,
  vodName: prefix + ' 历史 ' + (index + 1), vodPic: '/poster-history.svg',
  createTime: (newestTime || Date.now()) - index * 1000, position: 5000, duration: 60000
}));
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
    document.documentElement.classList.add("tv-preview", "tv-mode");
    testBrowse.state.hot.ready = true;
    testBrowse.state.hot.items = Array.from({ length: 36 }, (_, index) => ({
      id: 8100 + index, tmdbId: 8100 + index, title: "推荐" + index, mediaType: "movie",
      source: "nostr-hot", pic: "/poster-" + index + ".svg", landscape: "/backdrop-" + index + ".svg",
      overview: "简介", releaseDate: "2025-01-01"
    }));
    testBrowse.state.recent.loaded = true;
    testBrowse.state.recent.loading = false;
    testBrowse.state.recent.items = [];
    testBrowse.state.recent.refreshedAt = Date.now();
    if (setup) { testBrowse.setup(); testBrowse.tvBrowseBeginStartup(testBrowse.homeFocusUserEpoch()); }
  }, !!opts.setup);
  return page;
}

async function waitForCard(page, index) {
  await page.waitForFunction((wanted) => {
    const active = document.activeElement;
    return !!(active && active.matches("#tvBrowseRail .card") && Number(active.dataset.cardIndex) === wanted);
  }, index, { timeout: 8000 });
}

try {
  // Cold startup: keep the first card hidden behind the existing readiness gate,
  // then assert the first focused frame is already at its final visual state.
  const cold = await pageAt({ setup: false, imageDelay: 180 });
  const gate = await cold.evaluate(() => {
    window.initialFocusTrace = [];
    window.initialCardFocusEvents = 0;
    document.addEventListener("focusin", (event) => {
      const card = event.target.closest && event.target.closest("#tvBrowseRail .card");
      if (!card || Number(card.dataset.cardIndex) !== 0) return;
      window.initialCardFocusEvents += 1;
      let frames = 0;
      const sample = () => {
        const transform = getComputedStyle(card).transform;
        const match = transform.match(/^matrix\(([^,]+)/);
        window.initialFocusTrace.push({
          scale: match ? Number(match[1]) : 1,
          borderOpacity: Number(getComputedStyle(card.querySelector(".poster-wrap"), "::after").opacity),
          visible: getComputedStyle(card).visibility
        });
        if (++frames < 8) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }, true);
    testBrowse.setup();
    testBrowse.tvBrowseBeginStartup(testBrowse.homeFocusUserEpoch());
    return document.querySelector("#tvBrowsePosters").classList.contains("rail-loading");
  });
  assert.equal(gate, true, "cold first-card focus is held by the existing rail readiness gate");
  await waitForCard(cold, 0);
  await cold.waitForFunction(() => window.initialFocusTrace.length > 0);
  const firstFrame = await cold.evaluate(() => window.initialFocusTrace[0]);
  assert.equal(firstFrame.visible, "visible");
  assert.ok(Math.abs(firstFrame.scale - 1.04) < 0.001, `initial scale is already final: ${firstFrame.scale}`);
  assert.equal(firstFrame.borderOpacity, 1, "the first visible frame has the full 2px focus border");
  await cold.waitForTimeout(120);
  const startupFocusEvents = await cold.evaluate(() => window.initialCardFocusEvents);
  assert.equal(startupFocusEvents, 1, "delayed Gate release does not refocus the first card");

  await cold.evaluate(() => {
    const next = document.querySelector('#tvBrowseRail .card[data-card-index="1"]');
    window.userFocusTransition = false;
    next.addEventListener("transitionrun", (event) => {
      if (event.propertyName === "transform") window.userFocusTransition = true;
    });
  });
  await cold.keyboard.press("ArrowRight");
  await cold.waitForFunction(() => document.activeElement.matches('#tvBrowseRail .card[data-card-index="1"]'));
  await cold.waitForFunction(() => window.userFocusTransition);
  const userTransition = await cold.evaluate(() => ({
    duration: getComputedStyle(document.activeElement).transitionDuration,
    startupMarker: document.activeElement.classList.contains("tv-browse-initial-focus")
  }));
  assert.equal(userTransition.duration, "0.17s", "user navigation keeps the normal focus transition");
  assert.equal(userTransition.startupMarker, false);

  const restored = await cold.evaluate(() => {
    const snapshot = testBrowse.tvBrowseSnapshot();
    testBrowse.focusRemoteTarget(document.querySelector("#tvFunction-settings"));
    testBrowse.tvBrowseState().startupFocusAnimation = { epoch: testBrowse.homeFocusUserEpoch(), queryKey: "test" };
    testBrowse.restoreTvBrowseSnapshot(snapshot);
    testBrowse.renderTvBrowse();
    testBrowse.tvBrowseFocusIntent();
    return {
      index: Number(document.activeElement.dataset.cardIndex),
      startupMarker: document.activeElement.classList.contains("tv-browse-initial-focus"),
      startupState: testBrowse.tvBrowseState().startupFocusAnimation
    };
  });
  assert.equal(restored.index, 1, "snapshot restoration keeps its saved card");
  assert.equal(restored.startupMarker, false, "snapshot focus does not receive cold-start styling");
  assert.equal(restored.startupState, null, "snapshot restoration clears cold-start-only state");
  await cold.close();
  console.log("TV_BROWSE_COLD_FIRST_FOCUS_NO_FLASH = PASS");

  // A fresh explicit History entry clears its previous position; closing and
  // reopening starts from the current first row again.
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
  const fifthKey = await history.evaluate(() => document.activeElement.dataset.mediaKey);
  await history.evaluate(() => testBrowse.tvBrowseCloseHistory());
  await history.evaluate(() => testBrowse.tvBrowseOpenHistory());
  await waitForCard(history, 0);
  assert.equal(await history.evaluate(() => document.activeElement.dataset.mediaKey), firstHistoryKey,
    "a new History entry starts at row one after leaving from row five");
  assert.notEqual(fifthKey, firstHistoryKey);
  await history.close();
  console.log("TV_BROWSE_HISTORY_REOPEN_STARTS_FIRST = PASS");

  // Unloaded History waits for the current result, and an input during a stale
  // refresh invalidates the entry intent so it cannot steal the user's focus.
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
  console.log("TV_BROWSE_HISTORY_DELAYED_LOAD_STARTS_FIRST = PASS");

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
  console.log("TV_BROWSE_HISTORY_USER_MOVE_NOT_STOLEN = PASS");

  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
