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
const hook = `window.testBrowse = { state, renderTvBrowse, tvBrowseState, tvBrowseBeginStartup, tvBrowseSelectColumn,
  tvBrowseQueryKey, tvBrowseOpenHistory, tvBrowseCloseHistory, enterRecentManageMode, exitRecentManageMode,
  bindActions, installRemoteKeys, syncBrowseDevicePresentation, focusRemoteTarget, secondaryGetQuery,
  secondaryActiveQuery, secondaryDefaultQueryFilters, tvBrowseMaybePreloadCategories, loadSecondaryPage,
  promoteSecondaryQueryRequests, homeFocusUserEpoch, isVisibleFocusable, tvBrowseDirectionalTarget };
window.testBrowse.setup = () => { syncBrowseDevicePresentation(); bindActions(); installRemoteKeys(); };
window.testBrowse.startRecommendationCold = () => {
  state.previewMode = true; state.deviceMode = "leanback"; state.activeList = "all"; state.homeV14.route = "home";
  document.documentElement.classList.add("tv-preview", "tv-mode");
  state.hot.ready = false; state.hot.items = [{id:"movie:81001",tmdbId:81001,title:"冷启动推荐",mediaType:"movie",source:"nostr-hot",pic:"/poster.jpg",landscape:"/backdrop.jpg",people:8}];
  state.recent.loaded = true; state.recent.items = [];
  testBrowse.setup(); tvBrowseBeginStartup(homeFocusUserEpoch());
};
window.testBrowse.finishRecommendation = () => { state.hot.ready = true; renderTvBrowse(); };
window.testBrowse.showHistory = (items, loaded = true) => {
  state.activeList = "all"; state.homeV14.route = "home"; state.recent.items = items || [];
  state.recent.loaded = loaded; state.recent.loading = false; state.recent.error = "";
  tvBrowseState().view = "history"; tvBrowseState().filterOpen = false; renderTvBrowse();
};
window.testBrowse.setHistoryLoader = loader => { loadRecentList = loader; };
window.testBrowse.trackMediaCards = () => {
  window.createdBrowseCards = 0;
  const original = mediaCard;
  mediaCard = function(...args) { window.createdBrowseCards += 1; return original.apply(this, args); };
};
window.testBrowse.historyItem = (index = 1) => {
  const historyKey = "fixture@@@vod-" + index + "@@@1";
  return {id:"history:" + historyKey,title:"历史记录" + index,mediaType:"movie",source:"history",pic:"/poster.jpg",
    historyKey,nativeHistoryKey:historyKey,siteKey:"fixture",vodId:"vod-" + index,position:8000,duration:100000,
    recentWatching:true,canDelete:true,canPlayExact:true,canResume:true,deleteScope:"ITEM",
    historyRecordRef:{version:1,kind:"ITEM",cid:1,historyKey,siteKey:"fixture",vodId:"vod-" + index,mediaType:"movie",seasonNumber:-1,updatedAt:Date.now()},
    nativeHistoryRaw:{position:8000,duration:100000}};
};
`;
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output, "test hook must replace production boot");

const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.WEBHOME_BROWSER_EXECUTABLE
    ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE }
    : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" })
});
const requests = [];
let activeRequests = 0, maxActiveRequests = 0;
const pageErrors = [];
async function pageAt() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#274538"/></svg>' });
    if (url.includes("/discover/")) {
      const parsed = new URL(url), params = parsed.searchParams, path = parsed.pathname;
      const type = path.includes("/tv") ? "tv" : "movie";
      const genre = params.get("with_genres") || "all";
      const sort = params.get("sort_by") || "default";
      const category = genre === "16" ? "anime" : genre === "99" ? "documentary" : genre === "10764|10767" ? "variety" : type;
      const request = { category, type, genre, sort, page: Number(params.get("page") || 1), url, at: Date.now() };
      requests.push(request); activeRequests += 1; maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
      await new Promise(resolve => setTimeout(resolve, 80));
      activeRequests -= 1;
      const body = {
        total_pages: 2, total_results: 40,
        results: Array.from({ length: 20 }, (_, index) => ({
          id: (type === "tv" ? 20000 : 10000) + request.page * 100 + index,
          title: `${category}-${sort}-movie-${request.page}-${index}`,
          name: `${category}-${sort}-tv-${request.page}-${index}`,
          poster_path: "/poster.jpg", backdrop_path: "/backdrop.jpg",
          release_date: "2025-01-01", first_air_date: "2025-01-01", vote_average: 8.1
        }))
      };
      return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    }
    return route.abort();
  });
  await page.goto("http://fixture.local/?_tv=1&_tv_diag=1");
  return page;
}
const press = async (page, key) => { await page.keyboard.press(key); await page.waitForTimeout(65); };
const active = page => page.evaluate(() => document.activeElement.id || document.activeElement.dataset.mediaKey || "");
const results = [];
try {
  const page = await pageAt();
  await page.evaluate(() => testBrowse.startRecommendationCold());
  assert.equal(requests.length, 0, "cold start keeps category network work behind the recommendation screen");
  const firstScreen = await page.evaluate(() => ({
    column: testBrowse.tvBrowseState().column,
    queryKey: document.querySelector("#tvBrowseRail").dataset.queryKey,
    recommendationTitle: document.querySelector("#tvBrowseTitle").textContent
  }));
  assert.equal(firstScreen.column, "recommendation");
  assert.match(firstScreen.recommendationTitle, /冷启动推荐/);
  await page.evaluate(() => testBrowse.finishRecommendation());
  await page.waitForTimeout(0);
  assert.equal(await page.evaluate(() => testBrowse.state.homeV14.tvSecondaryPreloadStarted), true);

  // A queued default-filter query becomes foreground as soon as the user
  // focuses it; the original request is reused rather than duplicated.
  await page.evaluate(() => testBrowse.tvBrowseSelectColumn("documentary"));
  await page.waitForFunction(() => testBrowse.secondaryActiveQuery("documentary")?.loaded === true);
  const requestStats = await page.evaluate(() => {
    const diagnostics = testBrowse.tvBrowseState().diagnostics || [];
    return {
      preload: diagnostics.find(event => event.kind === "TV_CATEGORY_PRELOAD_SCHEDULED"),
      promoted: diagnostics.filter(event => event.kind === "TV_CATEGORY_REQUEST_PROMOTED"),
      starts: diagnostics.filter(event => event.kind === "TV_CATEGORY_REQUEST_START")
    };
  });
  assert.deepEqual(requestStats.preload.categories.map(entry => entry.listId), ["movie", "tv", "anime", "variety", "documentary"]);
  assert.ok(requestStats.promoted.some(event => event.promoted), "focused queued request is promoted in the shared request budget");
  assert.ok(maxActiveRequests <= 4, `global request cap preserved, max=${maxActiveRequests}`);
  results.push("TV_COLD_PRELOAD_ORDER_PRIORITY_REUSE_AND_BUDGET");

  // Existing category data is kept in detached, bounded rail nodes. Returning
  // to a valid query restores node identity, focus position, and data without
  // rebuilding cards or sending another page-one request.
  await page.locator("#tvColumn-movie").focus();
  await page.waitForFunction(() => testBrowse.tvBrowseState().column === "movie" && document.querySelector("#tvBrowseRail").dataset.queryKey === testBrowse.secondaryActiveQuery("movie").key);
  await press(page, "ArrowDown");
  const movieFixture = await page.evaluate(() => {
    const rail = document.querySelector("#tvBrowseRail"), card = rail.querySelector(".card");
    const query = testBrowse.secondaryActiveQuery("movie");
    if (!card) return { cardCount: rail.children.length, itemCount: query.items.length, loaded: query.loaded, error: query.error, retryableError: query.retryableError, status: document.querySelector("#tvBrowseStatus").textContent };
    rail.scrollLeft = 73; testBrowse.tvBrowseState().positions[query.key].scrollLeft = 73;
    window.savedMovieCard = card;
    return { cardCount: rail.children.length, itemCount: query.items.length, mediaKey: card.dataset.mediaKey };
  });
  assert.ok(movieFixture.mediaKey, "fixture Movie query creates a visible card: " + JSON.stringify(movieFixture));
  const movieCardKey = movieFixture.mediaKey;
  await page.evaluate(() => testBrowse.trackMediaCards());
  await page.waitForFunction(() => ["movie", "tv", "anime", "variety", "documentary"].every(id => {
    const q = testBrowse.secondaryGetQuery(id, testBrowse.secondaryDefaultQueryFilters());
    return q.loaded && !q.loading;
  }));
  const backgroundStability = await page.evaluate(() => ({
    activeKey: document.activeElement.dataset.mediaKey || "", activeIsSavedNode: document.activeElement === window.savedMovieCard,
    savedNodeConnected: !!window.savedMovieCard?.isConnected, cardCreateCount: window.createdBrowseCards
  }));
  assert.equal(backgroundStability.activeKey, movieCardKey);
  assert.equal(backgroundStability.activeIsSavedNode, true, "background category completion preserves focused card identity");
  assert.equal(backgroundStability.savedNodeConnected, true);
  assert.equal(backgroundStability.cardCreateCount, 0, "offscreen preload completion does not rebuild foreground cards");
  assert.equal(new Set(requests.map(request => request.url)).size, requests.length, "same category/filter/page never issues duplicate URLs");
  const beforeTtlRefresh = requests.length;
  const priorDataVersion = await page.evaluate(() => {
    const query = testBrowse.secondaryActiveQuery("movie");
    query.loadedAt = Date.now() - 31 * 60 * 1000;
    window.createdBrowseCards = 0;
    const version = query.dataVersion;
    testBrowse.renderTvBrowse();
    return version;
  });
  await page.waitForFunction(version => {
    const query = testBrowse.secondaryActiveQuery("movie");
    return !query.loading && query.loadedAt > Date.now() - 60 * 1000 && query.dataVersion === version;
  }, priorDataVersion);
  assert.equal(requests.length, beforeTtlRefresh + 1, "expired category cache performs one legitimate foreground refresh");
  assert.equal(await page.evaluate(() => window.savedMovieCard === document.activeElement && window.savedMovieCard.isConnected), true,
    "same-data refresh retains the foreground card and focus");
  assert.equal(await page.evaluate(() => window.createdBrowseCards), 0);
  results.push("EXPIRED_CACHE_REFRESH_PRESERVES_FOREGROUND_CONTENT");
  const staleQueryKey = await page.evaluate(() => {
    const stale = testBrowse.secondaryGetQuery("movie", { mediaType:"all", genre:"28", region:"all", year:"all", sort:"hot" });
    window.staleQueryTask = testBrowse.loadSecondaryPage("movie", stale, 1, { reason:"fixture-stale-query" });
    const replacement = Object.assign({}, stale, { loaded:false, loading:false, requestSeq:stale.requestSeq + 1, items:[], sourceStates:[], pendingRequestKeys:[] });
    testBrowse.state.homeV14.secondaryQueries[stale.key] = replacement;
    window.staleQueryPair = { stale, replacement };
    return stale.key;
  });
  const staleCommit = await page.evaluate(async () => {
    await window.staleQueryTask;
    return { staleItems:window.staleQueryPair.stale.items.length, replacementItems:window.staleQueryPair.replacement.items.length,
      replacementLoaded:window.staleQueryPair.replacement.loaded, staleLoading:window.staleQueryPair.stale.loading };
  });
  assert.ok(staleQueryKey.includes("28"));
  assert.deepEqual(staleCommit, { staleItems:0, replacementItems:0, replacementLoaded:false, staleLoading:false },
    "a response for a replaced query identity cannot commit over the current cache entry");
  results.push("STALE_QUERY_IDENTITY_CANNOT_OVERWRITE_REPLACEMENT");
  const requestCountBeforeSwitch = requests.length;
  await page.locator("#tvColumn-tv").focus();
  await page.waitForFunction(() => testBrowse.tvBrowseState().column === "tv" && document.querySelector("#tvBrowseRail").dataset.queryKey === testBrowse.secondaryActiveQuery("tv").key);
  await page.locator("#tvColumn-movie").focus();
  await page.waitForFunction(() => testBrowse.tvBrowseState().column === "movie" && document.querySelector("#tvBrowseRail").dataset.queryKey === testBrowse.secondaryActiveQuery("movie").key);
  await press(page, "ArrowDown");
  assert.equal(await active(page), movieCardKey);
  assert.equal(await page.evaluate(() => window.savedMovieCard === document.activeElement), true, "return reuses the original card node");
  const createCountBeforeRender = await page.evaluate(() => { testBrowse.trackMediaCards(); renderTvBrowse(); return window.createdBrowseCards; });
  assert.equal(createCountBeforeRender, 0, "unchanged foreground data does not rebuild its visible cards");
  assert.equal(requests.length, requestCountBeforeSwitch, "switching back to a fresh category does not refetch page one");
  results.push("FOREGROUND_CATEGORY_NODE_AND_REQUEST_STABILITY");

  // The empty History state has an explicit centered presentation and a
  // reachable Retry target even when there is no card to bridge navigation.
  await page.evaluate(() => testBrowse.showHistory([], true));
  const emptyState = await page.evaluate(() => {
    const root = document.querySelector("#tvBrowse"), foreground = document.querySelector(".tv-browse-foreground");
    const feedback = document.querySelector(".tv-browse-feedback"), retry = document.querySelector("#tvBrowseRetry");
    const r = root.getBoundingClientRect(), f = foreground.getBoundingClientRect(), b = feedback.getBoundingClientRect();
    return { empty: root.classList.contains("empty-history"), retryHidden: retry.hidden, status: document.querySelector("#tvBrowseStatus").textContent,
      root: {x:r.x,y:r.y,w:r.width,h:r.height}, foreground:{x:f.x,y:f.y,w:f.width,h:f.height}, feedback:{x:b.x,y:b.y,w:b.width,h:b.height},
      dx: Math.abs((b.left + b.width / 2) - (r.left + r.width / 2)), dy: Math.abs((b.top + b.height / 2) - (r.top + r.height / 2)) };
  });
  assert.equal(emptyState.empty, true); assert.equal(emptyState.retryHidden, false); assert.match(emptyState.status, /暂无/);
  assert.ok(emptyState.dx < 2 && emptyState.dy < 2, JSON.stringify(emptyState));
  await page.locator("#recentManageBtn").focus();
  const emptyNav = await page.evaluate(() => ({
    view: testBrowse.tvBrowseState().view, host: document.activeElement.closest("#tvBrowseRail,#tvBrowseColumns,#tvBrowseFunctions,#tvBrowseRecentTools")?.id,
    retryHidden: document.querySelector("#tvBrowseRetry").hidden, retryFocusable: testBrowse.isVisibleFocusable(document.querySelector("#tvBrowseRetry")),
    target: testBrowse.tvBrowseDirectionalTarget("ArrowDown", document.activeElement)?.id,
    toolsTarget: testBrowse.tvBrowseHistoryToolsTarget?.()?.id
  }));
  await press(page, "ArrowDown");
  assert.equal(await active(page), "tvBrowseRetry", "empty history has a direct management-to-retry focus route: " + JSON.stringify(emptyNav));
  await press(page, "ArrowUp"); assert.equal(await active(page), "recentManageBtn", "Retry returns focus to the available history control");
  await press(page, "ArrowDown"); assert.equal(await active(page), "tvBrowseRetry");

  let readCount = 0;
  await page.evaluate(() => testBrowse.setHistoryLoader(async () => {
    window.fixtureHistoryReadCalls = Number(window.fixtureHistoryReadCalls || 0) + 1;
    state.recent.loading = true; state.recent.error = ""; renderTvBrowse();
    return new Promise(resolve => {
      window.finishFixtureHistoryRead = (next) => {
        if (next.error) state.recent.error = next.error;
        else { state.recent.items = next.items || []; state.recent.loaded = true; state.recent.refreshedAt = Date.now(); }
        state.recent.loading = false; renderTvBrowse(); resolve();
      };
    });
  }));
  await page.locator("#tvBrowseRetry").click(); readCount += 1;
  await page.waitForFunction(() => testBrowse.state.recent.loading);
  await page.evaluate(() => { const retry = document.querySelector("#tvBrowseRetry"); retry.click(); retry.click(); });
  assert.equal(await page.evaluate(() => window.fixtureHistoryReadCalls), 1, "loading blocks repeated Retry confirmations");
  assert.equal(await page.locator("#tvBrowseRetry").isHidden(), true, "loading hides the retry action");
  await page.evaluate(() => window.finishFixtureHistoryRead({ error: "Native History 暂时不可用" }));
  assert.match(await page.locator("#tvBrowseStatus").textContent(), /Native History/);
  assert.equal(await page.locator("#tvBrowseRetry").isVisible(), true);
  await page.locator("#tvBrowseRetry").click(); readCount += 1;
  await page.waitForFunction(() => testBrowse.state.recent.loading);
  assert.equal(await page.evaluate(() => window.fixtureHistoryReadCalls), 2);
  await page.evaluate(() => window.finishFixtureHistoryRead({ items: [testBrowse.historyItem(1)] }));
  await page.waitForFunction(() => document.querySelectorAll("#tvBrowseRail .card").length === 1);
  assert.equal(await page.locator("#tvBrowseRail .card").first().evaluate(card => card.__mediaItem.nativeHistoryRaw.position), 8000);
  assert.equal(await active(page), "history:fixture@@@vod-1@@@1", "successful retry transfers focus to the new visible history card");
  assert.equal(readCount, 2);
  results.push("EMPTY_HISTORY_CENTER_RETRY_LOADING_FAILURE_AND_RECOVERY");

  // Management starts on Select all, skips disabled Delete, reaches cards,
  // and restores Manage on exit without selecting anything on entry.
  await page.evaluate(() => testBrowse.showHistory([testBrowse.historyItem(1), testBrowse.historyItem(2)], true));
  await page.locator("#recentManageBtn").focus(); await page.locator("#recentManageBtn").click();
  assert.equal(await active(page), "recentManageSelectAll");
  assert.equal(await page.evaluate(() => Object.keys(testBrowse.state.recentManage.selectedKeys).length), 0);
  await press(page, "ArrowRight"); assert.equal(await active(page), "recentManageCancel");
  await press(page, "ArrowLeft"); assert.equal(await active(page), "recentManageSelectAll");
  await press(page, "ArrowDown"); assert.equal(await page.evaluate(() => document.activeElement.closest("#tvBrowseRail") !== null), true);
  await press(page, "ArrowUp"); assert.equal(await active(page), "recentManageSelectAll");
  await page.locator("#recentManageCancel").click();
  await page.waitForFunction(() => document.activeElement.id === "recentManageBtn");
  await page.evaluate(() => testBrowse.showHistory([], true));
  await page.locator("#recentManageBtn").focus(); await page.locator("#recentManageBtn").click();
  assert.equal(await active(page), "recentManageCancel", "disabled Select all falls back to the available Cancel action");
  await page.locator("#recentManageCancel").click();
  await page.waitForFunction(() => document.activeElement.id === "recentManageBtn");
  assert.equal(await active(page), "recentManageBtn");
  results.push("HISTORY_MANAGE_FOCUS_AND_EMPTY_FALLBACK");

  // The new TV directory preload must not borrow Mobile Home feed scheduling,
  // while the existing Mobile Secondary query still loads its own data.
  const mobilePage = await pageAt();
  const mobileRequestCount = requests.length;
  const mobilePreload = await mobilePage.evaluate(() => {
    document.documentElement.classList.remove("tv-preview", "tv-mode", "tv-browse-active");
    window.history.replaceState(null, "", "/");
    testBrowse.state.previewMode = false; testBrowse.state.deviceMode = "mobile";
    testBrowse.state.activeList = "all"; testBrowse.state.homeV14.route = "home"; testBrowse.state.hot.ready = true;
    testBrowse.setup();
    return testBrowse.tvBrowseMaybePreloadCategories("mobile-guard");
  });
  assert.equal(mobilePreload, false);
  assert.equal(requests.length, mobileRequestCount, "TV category preloader leaves Mobile startup requests unchanged");
  const mobileQuery = await mobilePage.evaluate(async () => {
    testBrowse.state.homeV14.route = "secondary"; testBrowse.state.homeV14.secondaryListId = "movie";
    const query = testBrowse.secondaryGetQuery("movie");
    await testBrowse.loadSecondaryPage("movie", query, 1);
    return { loaded: query.loaded, loading: query.loading, count: query.items.length, requestClass: query.requestClass };
  });
  assert.deepEqual(mobileQuery, { loaded: true, loading: false, count: 20, requestClass: "" });
  assert.equal(requests.length, mobileRequestCount + 1, "Mobile Secondary first page still issues its existing request");
  results.push("MOBILE_HOME_PRELOAD_BOUNDARY_AND_SECONDARY_QUERY");
  await mobilePage.close();

  assert.deepEqual(pageErrors, []);
  console.log("TV_BROWSE_RELIABILITY = PASS (Chromium integration simulation)");
  console.log("CASES = " + JSON.stringify(results));
  console.log("MAX_NETWORK_ACTIVE = " + maxActiveRequests);
  console.log("REAL_TV_DEVICE = PENDING");
  await page.close();
} finally {
  await browser.close();
}
