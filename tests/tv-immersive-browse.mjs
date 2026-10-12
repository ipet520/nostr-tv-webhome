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
// Exercise actual source, including its event handlers, with deterministic
// business fixtures. Exporting lexical functions is confined to this test HTML.
const hook = `window.testBrowse = { state, renderAll, renderTvBrowse, tvBrowseState, tvBrowseFocusIntent,
 tvBrowseSelectColumn, tvBrowseSnapshot, restoreTvBrowseSnapshot, rememberHomeReturn, restoreHomeReturn,
 buildUiSnapshot, restoreUiSnapshot, openSidebar, closeSidebar, openSearchPage, closeSearchPage,
 bindActions, installRemoteKeys, secondaryActiveQuery, syncBrowseDevicePresentation, handleWebHomeResume, boot,
 tvBrowsePreview, publishHomeWeeklySnapshot, enterRecentManageMode, exitRecentManageMode,
 openDetail, closeDetail, sdk, loadRecentList, tvBrowseBeginStartup, homeFocusUserEpoch, storeMovieDetailCache, storeTvDetailCache, updateMovieReleaseStatusCards, requestMovieDetailShared, homeEnrichmentRequest, bestDetailLogo, tvBrowseClearPreview };
 window.testBrowse.setup = () => {
   syncBrowseDevicePresentation(); bindActions(); installRemoteKeys();
 };
 window.testBrowse.bootWithIdentityGate = () => {
   ensureIdentity = () => new Promise((resolve) => { window.releaseIdentity = resolve; });
   loadEvents = async () => {}; subscribeNostr = () => {}; hotLoadIndex = async () => {};
   return boot();
 };
 window.testBrowse.seed = (id, count = 40) => {
   const query = secondaryGetQuery(id); query.loaded = true; query.loading = false;
   query.page = 1; query.hasMore = true;
   query.items = Array.from({length: count}, (_, index) => ({
     id: 1000 + index, tmdbId: 1000 + index, title: id + index,
     mediaType: 'movie', source: 'tmdb', pic: '/poster.jpg', landscape: '/backdrop-' + index + '.jpg',
     releaseDate: '2025-01-01', overview: '影片简介', genreIds: [18], voteAverage: 8.2
   })); return query;
 };
`;
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output);
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.WEBHOME_BROWSER_EXECUTABLE ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE } : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" }) });
const errors = [];
async function pageAt(tv, viewport = { width: 1280, height: 720 }, setup = true) {
  const page = await browser.newPage({ viewport, ...(!tv ? { hasTouch: true, isMobile: true } : {}) });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#274538"/></svg>' });
    if (url.includes("api.themoviedb.org") || url.includes("fixture.local/tmdb")) {
      const p = Number(new URL(url).searchParams.get("page") || 1);
      await new Promise((resolve) => setTimeout(resolve, url.includes("discover/tv") ? 70 : 20));
      return route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ total_pages: 3, total_results: 60, results: Array.from({ length: 20 }, (_, i) => ({ id: p * 100 + i, title: "分页" + p + i, name: "剧集" + p + i, poster_path: "/poster.jpg", backdrop_path: "/backdrop.jpg", release_date: "2025-01-01", first_air_date: "2025-01-01" })) }) });
    }
    return route.abort();
  });
  await page.goto("http://fixture.local/" + (tv ? "?_tv=1" : ""));
  await page.evaluate(({ tv, setup }) => {
    const api = window.testBrowse;
    window.WEBHOME_CONFIG.tmdb.apiBase = "http://fixture.local/tmdb";
    window.WEBHOME_CONFIG.tmdb.apiKey = "fixture";
    if (tv) { api.state.previewMode = true; document.documentElement.classList.add("tv-preview", "tv-mode"); }
    api.state.hot.ready = true;
    api.state.hot.items = Array.from({ length: 45 }, (_, i) => ({ title: "推荐" + i, tmdbId: i + 1, id: i + 1, mediaType: "movie", source: "nostr-hot", people: 4, pic: "/poster.jpg", landscape: "/backdrop-" + i + ".jpg", overview: "推荐影片简介", releaseDate: "2025-01-01" }));
    api.state.recent.loaded = true; api.state.recent.items = [];
    if (setup) { api.setup(); api.tvBrowseBeginStartup(api.homeFocusUserEpoch()); }
  }, { tv, setup });
  return page;
}
async function focus(page, selector) { await page.locator(selector).focus(); }
async function active(page) { return page.evaluate(() => document.activeElement.id || document.activeElement.dataset.mediaKey); }
async function press(page, key) { await page.keyboard.press(key); await page.waitForTimeout(75); }
try {
  for (const mode of ['records', 'empty', 'failure', 'user']) {
    const initial = await pageAt(true, undefined, false);
    await initial.evaluate(() => {
      testBrowse.setup(); testBrowse.state.recent.loaded = false; testBrowse.state.recent.items = [];
      const historyResult = new Promise((resolve, reject) => { window.resolveHistory = resolve; window.rejectHistory = reject; });
      window.fm = Object.assign({}, testBrowse.sdk(), { history: () => historyResult });
      testBrowse.tvBrowseBeginStartup(testBrowse.homeFocusUserEpoch());
    });
    await initial.waitForFunction(() => window.resolveHistory);
    assert.equal(await initial.evaluate(() => testBrowse.tvBrowseState().column), 'recent', 'pending is not empty');
    if (mode === 'user') { await focus(initial, '#tvColumn-movie'); await press(initial, 'Enter'); }
    await initial.evaluate(mode => {
      if (mode === 'failure') rejectHistory(new Error('history fixture failed'));
      else resolveHistory(mode === 'records' || mode === 'user' ? [{ key: 'fixture@@@1', vodName: '有效最近观看', vodPic: '/poster.jpg', vodId: '1', createTime: Date.now() }] : []);
    }, mode);
    await initial.waitForFunction(() => !testBrowse.state.recent.loading);
    assert.equal(await initial.evaluate(() => testBrowse.tvBrowseState().column), mode === 'records' || mode === 'failure' ? 'recent' : mode === 'user' ? 'movie' : 'recommendation');
    if (mode === 'records') assert.equal(await initial.evaluate(() => document.activeElement.closest('#tvBrowseRail')?.id), 'tvBrowseRail');
    if (mode === 'failure') assert.equal(await initial.locator('#tvBrowseRetry').isVisible(), true);
    if (mode === 'user') assert.equal(await active(initial), 'tvColumn-movie');
    await initial.close();
  }
  const cold = await pageAt(true, undefined, false);
  await cold.evaluate(() => { window.bootTask = testBrowse.bootWithIdentityGate(); });
  await cold.waitForFunction(() => document.querySelectorAll('#tvBrowseRail .card').length > 1 && window.releaseIdentity);
  await cold.locator('#tvBrowseRail .card').nth(1).focus(); await press(cold, 'ArrowRight');
  const coldUserKey = await active(cold);
  await cold.evaluate(async () => { releaseIdentity(); await bootTask; }); await cold.waitForTimeout(300);
  assert.equal(await active(cold), coldUserKey, 'actual boot completion never steals user navigation focus');
  await cold.evaluate(() => testBrowse.tvBrowseSelectColumn('recent'));
  await cold.locator('#recentManageBtn').click();
  assert.equal(await cold.locator('#recentManageActions').isVisible(), true, 'boot binds shared history controls before first render');
  await cold.close();
  const tv = await pageAt(true);
  await tv.evaluate(() => { testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); });
  assert.equal(await tv.locator("#homeHero").count(), 0, "old Home is not instantiated on TV");
  assert.equal(await tv.locator("#homeRecentRail,#homeRecommendationRail,#homeWeeklyRail,#listStack").count(), 0);
  assert.equal(await tv.locator("#tvBrowseRail .card").count(), 18);
  assert.equal(await tv.evaluate(() => document.activeElement.closest("#tvBrowseRail")?.id), "tvBrowseRail");
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.heroTimer), 0);
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.heroFeed.loading), false);
  assert.equal(await tv.evaluate(() => Object.keys(testBrowse.state.homeV14.categoryFeeds).length), 0);
  await press(tv, "ArrowUp"); assert.equal(await active(tv), "tvColumn-recommendation");
  await press(tv, "ArrowUp"); assert.equal(await active(tv), "tvFunction-search");
  const functions = await tv.locator('#tvBrowseFunctions button').evaluateAll((buttons) => buttons.map(b => ({id:b.id, label:b.getAttribute('aria-label') || b.textContent.trim()})));
  assert.deepEqual(functions.map(b=>b.label), ['搜索','直播','设置','基础设置']);
  assert.equal(await tv.locator('#connectionToggle').innerText(), '');
  for (const id of ['tvFunction-live','tvFunction-settings','connectionToggle']) {
    await press(tv, 'ArrowRight'); assert.equal(await active(tv), id);
  }
  await tv.waitForTimeout(250);
  const glass = await tv.locator('#connectionToggle').evaluate(el=>({bg:getComputedStyle(el).backgroundColor, outline:getComputedStyle(el).outlineStyle}));
  assert.equal(glass.bg, 'rgba(255, 255, 255, 0.2)'); assert.equal(glass.outline, 'solid');
  await press(tv, "ArrowDown"); assert.equal(await active(tv), "tvColumn-recommendation");
  await press(tv, "ArrowRight"); assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "recommendation", "navigation does not activate a column");
  await focus(tv, "#tvColumn-movie"); await press(tv, "Enter");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "movie");
  assert.equal(await tv.evaluate(() => location.hash), "");
  await press(tv, "Enter");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().filterOpen), true);
  assert.equal(await tv.locator("#tvBrowseFunctions").isVisible(), false);
  assert.equal(await tv.locator("#tvBrowseInfo").isVisible(), false);
  assert.equal(await tv.evaluate(() => document.querySelector('#tvBrowseRail .card')?.getAttribute('tabindex')), "-1");
  const filterStyle = await tv.locator('#tvBrowseFilters').evaluate(el=>({bg:getComputedStyle(el).backgroundColor, shadow:getComputedStyle(el).boxShadow}));
  assert.deepEqual(filterStyle, {bg:'rgba(0, 0, 0, 0)', shadow:'none'});
  const filterOption=await tv.locator('#tvBrowseFilters button').last().evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor,blur:getComputedStyle(el).backdropFilter}));
  assert.deepEqual(filterOption,{bg:'rgba(0, 0, 0, 0)',border:'rgba(0, 0, 0, 0)',blur:'none'});
  const railRect = await tv.locator('#tvBrowseRail').boundingBox();
  const columnRect = await tv.locator('#tvBrowseColumns').boundingBox();
  const filterBefore = await tv.evaluate(() => document.activeElement.dataset.value);
  await press(tv, "ArrowRight");
  assert.notEqual(await tv.evaluate(() => document.activeElement.dataset.value), filterBefore);
  const railBox = await tv.locator("#tvBrowseRail").boundingBox();
  await press(tv, "Escape");
  assert.equal(await active(tv), "tvColumn-movie");
  assert.deepEqual(await tv.locator("#tvBrowseRail").boundingBox(), railBox);
  await tv.keyboard.down("Enter"); await tv.keyboard.down("Enter"); await tv.keyboard.up("Enter");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().filterOpen), false, "repeat is not double confirm");
  await tv.evaluate(() => { testBrowse.tvBrowseState().confirm = null; document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 23, bubbles: true })); document.activeElement.dispatchEvent(new KeyboardEvent("keyup", { keyCode: 23, bubbles: true })); });
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().filterOpen), false);
  await tv.waitForFunction(() => testBrowse.secondaryActiveQuery("movie").loaded);
  await focus(tv, "#tvColumn-movie");
  await tv.waitForTimeout(450); await press(tv, "Enter"); await press(tv, "Enter");
  await tv.locator('#tvBrowseFilters button[data-group="sort"][data-value="rating"]').click();
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.secondaryFilters.movie.sort), "rating");
  await tv.waitForFunction(() => testBrowse.secondaryActiveQuery("movie").loaded);
  assert.equal(await tv.evaluate(() => document.activeElement.dataset.value), "rating", "filter DOM focus survives result commit");
  assert.ok(await tv.locator("#tvBrowseRail .card").count(), JSON.stringify(await tv.evaluate(() => ({ query: testBrowse.secondaryActiveQuery("movie"), status: document.querySelector("#tvBrowseStatus").textContent }))));
  await press(tv, "Escape");
  assert.deepEqual(await tv.locator('#tvBrowseRail').boundingBox(), railRect);
  assert.deepEqual(await tv.locator('#tvBrowseColumns').boundingBox(), columnRect);
  await press(tv, "ArrowDown");
  // Paging uses the actual shared TMDB loader and appends without replacing the prefix.
  await tv.evaluate(() => { window.firstPoster = document.querySelector("#tvBrowseRail .card"); document.querySelector("#tvBrowseRail .card:last-child").focus(); });
  await tv.waitForFunction(() => document.querySelectorAll("#tvBrowseRail .card").length >= 40);
  assert.equal(await tv.evaluate(() => firstPoster === document.querySelector("#tvBrowseRail .card")), true);
  await tv.evaluate(() => { document.querySelectorAll("#tvBrowseRail .card")[22].focus(); testBrowse.rememberHomeReturn(document.activeElement.__mediaItem, document.activeElement); });
  const returnKey = await active(tv);
  await tv.evaluate(() => testBrowse.restoreHomeReturn());
  assert.equal(await active(tv), returnKey);
  // The same Home return snapshot is used by real detail/native handoffs.
  const saved = await tv.evaluate(() => testBrowse.buildUiSnapshot());
  await tv.evaluate((saved) => { testBrowse.restoreTvBrowseSnapshot(saved.tvBrowse); testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); }, saved);
  assert.equal(await active(tv), returnKey);
  assert.equal(await tv.locator('#homeSidebar,#homeSidebarBackdrop,#homeMenuLauncher,#tvFunction-menu').count(), 0);
  assert.equal(await tv.evaluate(() => testBrowse.openSidebar()), false);
  await tv.evaluate(() => { window.liveCalls = 0; window.settingCalls = 0; window.fm = { openLive: () => { liveCalls++; }, openSetting: () => { settingCalls++; }, history: async () => [] }; });
  await focus(tv, '#tvFunction-live'); await press(tv, 'Enter');
  assert.equal(await tv.evaluate(() => liveCalls), 1);
  await tv.evaluate(() => testBrowse.handleWebHomeResume({ force: true })); await tv.waitForTimeout(100);
  assert.equal(await active(tv), 'tvFunction-live');
  await press(tv, 'Enter'); await press(tv, 'ArrowDown');
  await tv.evaluate(() => testBrowse.handleWebHomeResume({ force: true })); await tv.waitForTimeout(100);
  assert.equal(await active(tv), 'tvColumn-movie', 'user navigation cancels a stale Native focus return');
  await focus(tv, '#tvFunction-settings'); await press(tv, 'Enter'); assert.equal(await tv.evaluate(() => settingCalls), 1);
  assert.equal(await tv.locator('#tvFunction-history,#tvFunction-keep,#tvFunction-menu').count(), 0);
  assert.equal(await tv.locator('#tvFunction-search').innerText(), '搜索');
  assert.equal(await tv.locator('#tvFunction-search svg').count(), 1);
  await tv.evaluate(() => { delete window.fm; });
  await focus(tv, '#connectionToggle'); await press(tv, 'Enter');
  assert.equal(await tv.locator('#connectionBody').evaluate(el=>el.classList.contains('open')), true);
  await press(tv, 'Escape'); await tv.waitForTimeout(150);
  assert.equal(await tv.locator('#connectionBody').evaluate(el=>el.classList.contains('open')), false);
  await focus(tv, '#tvColumn-movie');
  await tv.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true, keyCode:38, which:38})));
  assert.equal(await active(tv), 'tvFunction-search');
  await tv.waitForTimeout(75);
  await press(tv, 'Enter');
  assert.equal(await tv.locator("#searchPage").isVisible(), true);
  await tv.evaluate(() => testBrowse.closeSearchPage()); await tv.waitForTimeout(50);
  assert.equal(await active(tv), "tvFunction-search");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "movie");
  await tv.evaluate(() => { testBrowse.state.recent.loaded = true; testBrowse.state.recent.items = [{ source: 'history', recentWatching: true, title: '无海报历史', mediaType: 'movie', tmdbId: 123, nativeHistoryKey: 'history-123' }]; testBrowse.tvBrowseSelectColumn('recent'); });
  assert.equal(await tv.locator('#tvBrowseRail .recent-watching-card').count(), 1, "history without poster remains accessible");
  await tv.locator('#recentManageBtn').click();
  assert.equal(await tv.locator('#recentManageActions').isVisible(), true);
  await press(tv, 'Escape');
  assert.equal(await tv.locator('#recentManageActions').isVisible(), false);
  await tv.evaluate(() => testBrowse.tvBrowseSelectColumn('movie'));
  const sizes = await tv.evaluate(() => ({ doc: document.documentElement.scrollHeight, height: innerHeight, functions: document.querySelector("#tvBrowseFunctions").getBoundingClientRect().toJSON(), columns: document.querySelector("#tvBrowseColumns").getBoundingClientRect().toJSON() }));
  assert.ok(sizes.doc <= sizes.height + 1, "no whole-page vertical overflow");
  assert.ok(sizes.functions.left > 600 && sizes.columns.top >= 300 && sizes.columns.top < 420);
  if (process.env.WEBHOME_TEST_SCREENSHOT) {
    await tv.evaluate(() => document.querySelector('#tvBrowseRail .card').focus());
    await tv.waitForTimeout(200);
    await tv.screenshot({ path: process.env.WEBHOME_TEST_SCREENSHOT });
  }
  // Deliberately finish the first image decode after the second selection.
  await tv.evaluate(() => {
    const OriginalImage = window.Image; const images = [];
    window.Image = class { constructor() { images.push(this); } };
    testBrowse.tvBrowsePreview({ tmdbId: 9001, mediaType: 'movie', title: 'older', landscape: '/older.jpg' });
    const oldCommit = images[0].onload;
    testBrowse.tvBrowsePreview({ tmdbId: 9002, mediaType: 'movie', title: 'newer', landscape: '/newer.jpg' });
    images[1].onload(); oldCommit(); window.Image = OriginalImage;
  });
  assert.equal(await tv.locator('#tvBrowseTitle').innerText(), 'newer');
  assert.ok(await tv.evaluate(() => testBrowse.tvBrowseState().backdropUrl.includes('newer.jpg')));
  // Late old-query completion cannot publish into a different column.
  await tv.evaluate(() => { testBrowse.tvBrowseSelectColumn("tv"); testBrowse.tvBrowseSelectColumn("recommendation"); });
  await tv.waitForTimeout(250);
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "recommendation");
  assert.ok((await tv.locator("#tvBrowseTitle").innerText()).startsWith("推荐"));
  // Reload-style restore rehydrates required pages before consuming media focus.
  const reloaded = await pageAt(true);
  await reloaded.evaluate(async (saved) => { await testBrowse.restoreUiSnapshot(saved); }, saved);
  await reloaded.waitForFunction((key) => document.activeElement.dataset.mediaKey === key, returnKey);
  assert.equal(await reloaded.evaluate(() => testBrowse.state.homeV14.secondaryFilters.movie.sort), "rating");
  await reloaded.evaluate(async () => { await testBrowse.restoreUiSnapshot({ version: 1, route: 'home', homeRoute: 'secondary', secondaryListId: 'cn-tv', activeList: 'all' }); });
  assert.equal(await reloaded.evaluate(() => testBrowse.tvBrowseState().column), 'tv');
  assert.equal(await reloaded.locator('#secondaryCatalog').count(), 0, 'legacy snapshot maps to the new TV browser');
  await reloaded.evaluate(() => { testBrowse.tvBrowseSelectColumn('now-playing'); testBrowse.state.homeLatest.items = [{ tmdbId: 99, mediaType: 'movie', title: 'weekly', pic: '/poster.jpg', weeklyUpdateText: '本周上映' }]; testBrowse.state.homeLatest.loaded = true; testBrowse.state.homeLatest.loading = false; testBrowse.publishHomeWeeklySnapshot('fixture', { final: true }); });
  assert.equal(await reloaded.locator('#tvBrowseRail .card').count(), 1);
  assert.equal(await reloaded.evaluate(() => testBrowse.secondaryActiveQuery('now-playing').hasMore), false);
  // Cold pending -> user navigation -> late Nostr must not take focus.
  await tv.evaluate(() => { testBrowse.state.hot.ready = false; testBrowse.state.hot.items = []; testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); });
  await press(tv, "ArrowUp"); const userTarget = await active(tv);
  await tv.evaluate(() => { testBrowse.state.hot.ready = true; testBrowse.state.hot.items = [{ id: 9, tmdbId: 9, title: "late", source: "nostr-hot", mediaType: "movie", pic: "/poster.jpg", people: 1 }]; testBrowse.renderAll(); });
  assert.equal(await active(tv), userTarget);
  // Metadata fields and the existing type-specific detail caches share media identity.
  await tv.evaluate(() => {
    testBrowse.storeMovieDetailCache({tmdbId: 7001}, {id: 7001, overview: '电影缓存简介', vote_average: 9});
    testBrowse.storeTvDetailCache({tmdbId: 7001}, {id: 7001, overview: '同号电视剧简介'});
    testBrowse.tvBrowsePreview({tmdbId: 7001, mediaType: 'movie', title: '电影'});
  });
  assert.equal(await tv.locator('#tvBrowseOverview').innerText(), '电影缓存简介');
  await tv.evaluate(() => testBrowse.tvBrowsePreview({tmdbId: 7002, mediaType: 'movie', title: '另一部', description: 'description 简介'}));
  assert.equal(await tv.locator('#tvBrowseOverview').innerText(), 'description 简介');
  await tv.evaluate(() => testBrowse.tvBrowsePreview({tmdbId: 7003, mediaType: 'movie', title: '无简介'}));
  assert.equal(await tv.locator('#tvBrowseOverview').innerText(), '');

  // Title artwork reuses typed caches, the language chooser and the existing request budget.
  const artwork = await pageAt(true);
  await artwork.waitForTimeout(300);
  let logoRequests = 0;
  await artwork.route('**/tmdb/movie/9100?*', async route => {
    logoRequests++; await new Promise(resolve=>setTimeout(resolve,100));
    await route.fulfill({contentType:'application/json',body:JSON.stringify({id:9100, overview:'缓存艺术标题', images:{logos:[{file_path:'/art-en.png',iso_639_1:'en',vote_average:10},{file_path:'/art-zh.png',iso_639_1:'zh',vote_average:1}]}})});
  });
  await artwork.route('**/art-*.png', async route => {
    if (route.request().url().includes('fail')) return route.abort();
    await route.fulfill({contentType:'image/svg+xml',body:route.request().url().includes('tall') ? '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="480"><path fill="white" d="M10 10h60v400H10z"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="90"><text x="5" y="60" fill="white" font-size="56">作品艺术标题</text></svg>'});
  });
  await artwork.evaluate(() => {
    const item={id:9100,tmdbId:9100,mediaType:'movie',title:'即时文字标题'};
    testBrowse.tvBrowsePreview(item); testBrowse.tvBrowsePreview(item);
    window.joinLogo = testBrowse.requestMovieDetailShared(item,testBrowse.homeEnrichmentRequest);
  });
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),true);
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),false);
  assert.ok(await artwork.locator('#tvBrowseLogo').getAttribute('src').then(src=>src.endsWith('/art-zh.png')));
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({tmdbId:9100,mediaType:'movie',title:'即时文字标题'}));
  await artwork.waitForTimeout(250); assert.equal(logoRequests,1,'shared cache and pending request prevent duplicate queries');
  await artwork.evaluate(() => {
    testBrowse.storeTvDetailCache({tmdbId:9100},{id:9100,images:{logos:[{file_path:'/art-tv.png',iso_639_1:'zh'}]}});
    testBrowse.tvBrowsePreview({id:9100,tmdbId:9100,mediaType:'tv',title:'电视剧艺术标题'});
  });
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden && document.querySelector('#tvBrowseLogo').src.endsWith('/art-tv.png'));
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),false,'same ID across movie and TV never shares artwork');
  await artwork.evaluate(() => {
    testBrowse.storeMovieDetailCache({tmdbId:9101},{id:9101,images:{logos:[]}});
    testBrowse.tvBrowsePreview({tmdbId:9101,mediaType:'movie',title:'没有艺术标题'});
  });
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),true);
  assert.equal(await artwork.locator('#tvBrowseLogo').isVisible(),false);
  await artwork.evaluate(() => testBrowse.tvBrowsePreview({tmdbId:9101,mediaType:'movie',title:'加载失败',logo:'/art-fail.png'}));
  await artwork.waitForTimeout(150);
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),true);
  assert.equal(await artwork.locator('#tvBrowseLogo').isVisible(),false);
  const staleArtwork = await artwork.evaluate(() => {
    const OriginalImage=window.Image; window.Image=class{};
    testBrowse.tvBrowsePreview({id:9101,tmdbId:9101,mediaType:'movie',title:'旧片',logo:'/art-old.png'});
    const stale=testBrowse.tvBrowseState().logoImage.onload;
    testBrowse.tvBrowsePreview({id:9101,tmdbId:9101,mediaType:'tv',title:'新片',logo:'/art-new.png'});
    testBrowse.tvBrowseState().logoImage.onload(); stale(); window.Image=OriginalImage;
    return {src:document.querySelector('#tvBrowseLogo').src,title:document.querySelector('#tvBrowseTitle').textContent};
  });
  assert.ok(staleArtwork.src.endsWith('/art-new.png')); assert.equal(staleArtwork.title,'新片');
  assert.equal(await artwork.evaluate(()=>testBrowse.bestDetailLogo({images:{logos:[{file_path:'/en.png',iso_639_1:'en'},{file_path:'/tw.png',iso_639_1:'zh-TW'},{file_path:'/cn.png',iso_639_1:'zh-CN'}]}}).file_path),'/cn.png');
  let lateRequests=0;
  await artwork.route('**/tmdb/movie/9104?*',async route=>{
    lateRequests++; await new Promise(resolve=>setTimeout(resolve,350));
    await route.fulfill({contentType:'application/json',body:JSON.stringify({id:9104,images:{logos:[{file_path:'/art-late.png',iso_639_1:'zh'}]}})});
  });
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({id:9104,tmdbId:9104,mediaType:'movie',title:'迟到旧片'}));
  await artwork.waitForFunction(()=>testBrowse.tvBrowseState().logoRequestKey==='movie:9104');
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({id:9105,tmdbId:9105,mediaType:'tv',title:'当前新片',logo:'/art-current.png'}));
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  await artwork.waitForTimeout(500);
  assert.equal(lateRequests,1); assert.equal(await artwork.locator('#tvBrowseTitle').innerText(),'当前新片');
  assert.ok((await artwork.locator('#tvBrowseLogo').getAttribute('src')).endsWith('/art-current.png'),'late detail response cannot repaint a different selected title');
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({tmdbId:9103,mediaType:'tv',title:'窄长标题',logo:'/art-tall.png'}));
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  const tall=await artwork.locator('#tvBrowseLogo').boundingBox(); assert.ok(tall.height<=72.1 && tall.width<tall.height);
  await artwork.evaluate(()=>{testBrowse.tvBrowseClearPreview();testBrowse.tvBrowsePreview({tmdbId:9103,mediaType:'tv',title:'窄长标题',logo:'/art-tall.png'});});
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({tmdbId:9100,mediaType:'movie',title:'即时文字标题',overview:'明亮和深色背景下的作品信息可读性验证。',releaseDate:'2025-01-01'}));
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  if (process.env.WEBHOME_TEST_SCREENSHOT) {
    for (const [name,color] of [['bright','#dbd7bb'],['dark','#152433']]) {
      await artwork.evaluate(color=>{
        const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect fill="'+color+'" width="1280" height="720"/></svg>';
        document.querySelector('#tvBrowseBackdrop').style.backgroundImage='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';
        document.querySelector('#tvBrowseBackdrop').classList.add('visible'); document.querySelector('#tvBrowseBackdropNext').classList.remove('visible');
      },color);
      await artwork.waitForTimeout(300);
      await artwork.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-'+name+'.png')});
    }
  }
  await artwork.evaluate(()=>{testBrowse.tvBrowseSelectColumn('movie');});
  await focus(artwork,'#tvColumn-movie'); await press(artwork,'Enter'); await press(artwork,'Enter');
  if (process.env.WEBHOME_TEST_SCREENSHOT) await artwork.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-filters.png')});
  await artwork.close();

  const mobile = await pageAt(false, { width: 390, height: 844 });
  await mobile.evaluate(() => testBrowse.renderAll());
  assert.equal(await mobile.locator("#homeHero").count(), 1);
  assert.equal(await mobile.locator("#tvBrowse").isVisible(), false);
  await mobile.locator('#homeRecommendationMore').click();
  assert.equal(await mobile.locator('#secondaryCatalog').isVisible(), true);
  await mobile.locator('#secondaryCatalogBack').click(); await mobile.waitForTimeout(100);
  await mobile.locator('#homeMenuLauncher').click();
  assert.equal(await mobile.locator('#homeSidebar').isVisible(), true);
  assert.equal(await mobile.locator('#homeSidebarBackdrop').isVisible(), true);
  await press(mobile, 'Escape'); await mobile.waitForTimeout(250);
  assert.equal(await mobile.locator('#homeSidebar').isVisible(), false);
  await mobile.evaluate(() => testBrowse.openSearchPage()); assert.equal(await mobile.locator("#searchPage").isVisible(), true);
  assert.equal(await mobile.evaluate(() => document.documentElement.classList.contains("tv-browse-active")), false);
  for (const viewport of [{ width:1280,height:720 }, { width: 1920, height: 1080 }, { width: 960, height: 540 }]) {
    const sized = await pageAt(true, viewport);
    await sized.evaluate(() => { testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); });
    assert.ok(await sized.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
    assert.equal(await sized.locator('#homeHero,#secondaryCatalog').count(), 0);
    await sized.evaluate(() => testBrowse.tvBrowsePreview({ mediaType:'movie', tmdbId:8000, title:'这是一部用来验证长标题和多行简介布局的影片名称', releaseDate:'2025-01-01', description:'多行简介应显示在更高的左侧资料区，保留与中部栏目之间的空间。'.repeat(8) }));
    const geometry = await sized.evaluate(() => ({info:document.querySelector('#tvBrowseInfo').getBoundingClientRect().toJSON(), columns:document.querySelector('#tvBrowseColumns').getBoundingClientRect().toJSON(), height:innerHeight}));
    assert.ok(geometry.info.top < geometry.height*.13 && geometry.info.bottom < geometry.columns.top, 'raised information remains clear of fixed columns');
    assert.equal(await sized.locator('#tvFunction-search').innerText(), '搜索');
    const controls=await sized.locator('#tvBrowseFunctions button').evaluateAll(bs=>bs.map(b=>({id:b.id,r:b.getBoundingClientRect().toJSON()})));
    assert.ok(controls.every(b=>Math.abs(b.r.height-controls[0].r.height)<.1),'one external height for all controls');
    assert.ok(controls[0].r.width/controls[0].r.height>3 && controls[0].r.width/controls[0].r.height<5,'short horizontal search box');
    const icon=await sized.locator('#tvFunction-search svg').boundingBox();
    assert.ok(icon.x>controls[0].r.x+controls[0].r.width/2);
    console.log('CONTROL_DIMENSIONS '+viewport.width+'x'+viewport.height+' = '+JSON.stringify(controls));
    await sized.close();
  }
  // Actual Detail DOM/history/close chain, using a poster whose fixture requires no Native playback.
  await tv.evaluate(() => { testBrowse.tvBrowseSelectColumn('movie'); document.querySelector('#tvBrowseRail .card').focus(); testBrowse.openDetail(document.activeElement.__mediaItem, { returnTarget: document.activeElement }); });
  await tv.waitForTimeout(160);
  assert.equal(await tv.locator('#detailSheet').evaluate((el) => el.classList.contains('active')), true);
  await focus(tv, '#detailSearchBtn'); await tv.waitForTimeout(250);
  for (const action of ['detailContinueBtn','detailSearchBtn','panSearchBtn']) {
    await focus(tv,'#'+action); await tv.waitForTimeout(250);
    const style=await tv.locator('#'+action).evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,shadow:getComputedStyle(el).boxShadow}));
    assert.deepEqual(style,{bg:'rgb(247, 247, 247)',color:'rgb(23, 23, 23)',shadow:'none'});
  }
  await tv.evaluate(() => testBrowse.closeDetail(false)); await tv.waitForTimeout(650);
  assert.equal(await tv.evaluate(() => document.activeElement.closest('#tvBrowseRail')?.id), 'tvBrowseRail');
  await tv.evaluate(() => { testBrowse.openSearchPage(); testBrowse.openDetail({ tmdbId: 88, mediaType: 'movie', title: 'search-detail', source: 'tmdb', pic: '/poster.jpg' }, { returnTarget: document.querySelector('#searchPageBack') }); });
  await tv.waitForTimeout(160); await tv.evaluate(() => testBrowse.closeDetail(false)); await tv.waitForTimeout(650);
  assert.equal(await tv.locator('#searchPage').isVisible(), true, 'Search -> Detail -> Back stays on Search');
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.route), 'search');
  assert.deepEqual(errors, [], "no browser runtime errors");
  console.log("TV_IMMERSIVE_BROWSE = PASS (real Chromium DOM / keyboard / query fixtures)");
  console.log("NATIVE_DEVICE_PLAYBACK_AND_RESUME = NOT_RUN (real device required)");
} finally { await browser.close(); }
