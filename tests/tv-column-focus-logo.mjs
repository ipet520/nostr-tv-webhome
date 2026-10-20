import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
const hook = `window.testBrowse = { secondaryGetQuery, state, renderAll, renderTvBrowse, tvBrowseState, tvBrowseFocusIntent,
 tvBrowseSelectColumn, tvBrowseSnapshot, restoreTvBrowseSnapshot, rememberHomeReturn, restoreHomeReturn,
 buildUiSnapshot, restoreUiSnapshot, openSidebar, closeSidebar, openSearchPage, closeSearchPage,
 bindActions, installRemoteKeys, secondaryActiveQuery, syncBrowseDevicePresentation, handleWebHomeResume, boot,
 RECENT_DOUBLE_PRESS_WINDOW_MS, cancelRecentDeleteArm, isVisibleFocusable, tvHistoryPressItem, tvPresentationStatus, homeHeroPresentationStatus, tvEpisodeStatusLabel, normalizeHistoryList, tvBrowseCloseHistory, tvBrowseContinueHistory, tvBrowseQueryKey, tvBrowseOpenHistory, tvBrowsePreview, publishHomeWeeklySnapshot, enterRecentManageMode, exitRecentManageMode,
 openDetail, closeDetail, sdk, loadRecentList, tvBrowseBeginStartup, homeFocusUserEpoch, storeMovieDetailCache, storeTvDetailCache, updateMovieReleaseStatusCards, requestMovieDetailShared, homeEnrichmentRequest, bestDetailLogo, tvBrowseClearPreview, focusRemoteTarget, artLogoResource, prepareArtLogo, renderDetailTitleLogo };
 window.testBrowse.railPosition = rail => typeof tvBrowseRailCurrentPosition === "function"
   ? tvBrowseRailCurrentPosition(rail) : Number(rail && rail.scrollLeft || 0);
 window.testBrowse.setRailPosition = (rail,value) => typeof tvBrowseWriteRailPosition === "function"
   ? tvBrowseWriteRailPosition(rail,value,{silent:true}) : (rail.scrollLeft=value);
 window.testBrowse.disableTracking = () => { rememberWatchIntent = () => {}; startWatchTracking = () => {}; saveHistoryPlaybackContext = async () => {}; };
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
const baselineOutput=execFileSync('git',['show','1cc51d13dcbc314bcbd2facee0de8cb21b1d8252:index.html'],{encoding:'utf8',maxBuffer:4*1024*1024});
const baselineHtml=baselineOutput.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/,hook);
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.WEBHOME_BROWSER_EXECUTABLE ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE } : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" }) });
const errors = []; const geometryResults=[];
if(process.env.WEBHOME_VISUAL_DIR)mkdirSync(process.env.WEBHOME_VISUAL_DIR,{recursive:true});
async function pageAt(tv, viewport = { width: 1280, height: 720 }, setup = true, baseline = false) {
  const page = await browser.newPage({ viewport, ...(!tv ? { hasTouch: true, isMobile: true } : {}) });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: baseline ? baselineHtml : html });
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
 const p=await pageAt(true);await p.waitForTimeout(200);
 await p.evaluate(()=>{for(const id of ['movie','tv','anime','documentary','variety']){const q=testBrowse.seed(id,12);q.hasMore=false;}});
 await p.locator('#tvColumn-movie').focus();assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),'movie');
 await p.locator('#tvBrowseRail').evaluate(e=>testBrowse.setRailPosition(e,400));await p.waitForTimeout(150);
 const stable=await p.evaluate(()=>({seq:testBrowse.secondaryActiveQuery('movie').requestSeq,scroll:testBrowse.railPosition(document.querySelector('#tvBrowseRail')),nativeScroll:document.querySelector('#tvBrowseRail').scrollLeft,node:!!(window.savedCard=document.querySelector('#tvBrowseRail .card'))}));
 await press(p,'Enter');assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().filterOpen),false);
 assert.equal(await p.evaluate(()=>window.savedCard===document.querySelector('#tvBrowseRail .card')),true);
 assert.equal(await p.locator('#tvBrowseRail').evaluate(e=>testBrowse.railPosition(e)),stable.scroll);
 assert.equal(stable.nativeScroll,0,"B Transform uses the logical position rather than browser scrollLeft");
 assert.equal(await p.evaluate(()=>testBrowse.secondaryActiveQuery('movie').requestSeq),stable.seq);
 await press(p,'Enter');assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().filterOpen),true);await press(p,'Escape');
 assert.equal(await p.locator('#tvBrowseRail').evaluate(e=>testBrowse.railPosition(e)),stable.scroll);
 for(const id of ['tv','anime','documentary','variety','movie','tv','movie']){
  await p.locator('#tvColumn-'+id).focus();assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),id);
  assert.equal(await p.locator('#tvBrowseColumns button[aria-pressed="true"]').getAttribute('data-column'),id);
 }
 await p.locator('#tvFunction-search').focus();assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),'movie');
 await p.locator('#tvBrowseRail .card').first().focus();assert.equal(await p.locator('#tvColumn-movie').getAttribute('aria-pressed'),'true');
 await p.evaluate(()=>{const s=testBrowse.tvBrowseSnapshot();testBrowse.tvBrowseSelectColumn('tv');testBrowse.restoreTvBrowseSnapshot(s);testBrowse.renderTvBrowse();});assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),'movie');
 await p.close();
 console.log('COLUMN_FOCUS_SELECTS_ONCE_CONFIRM_FILTER_POSITION_SNAPSHOT = PASS');
 for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540},{width:1280,height:400}]){
  const current=await pageAt(true,viewport),before=await pageAt(true,viewport,true,true);await current.waitForTimeout(200);await before.waitForTimeout(200);
  for(const [w,h]of [[1000,240],[240,1000],[600,600]]){
   for(const page of [current,before])await page.evaluate(({w,h})=>{const img=document.querySelector('#tvBrowseLogo');img.src='data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="gold"/></svg>`);img.hidden=false;document.querySelector('#tvBrowseTitle').hidden=true;},{w,h});
   await current.waitForFunction(()=>document.querySelector('#tvBrowseLogo').naturalWidth>0);await before.waitForFunction(()=>document.querySelector('#tvBrowseLogo').naturalWidth>0);
   const measure=page=>page.locator('#tvBrowseLogo').evaluate(e=>{const r=e.getBoundingClientRect(),slot=e.parentElement.getBoundingClientRect(),meta=document.querySelector('#tvBrowseMeta').getBoundingClientRect(),cols=document.querySelector('#tvBrowseColumns').getBoundingClientRect(),info=document.querySelector('#tvBrowseInfo').getBoundingClientRect();return {width:r.width,height:r.height,bottom:r.bottom,slotBottom:slot.bottom,metaTop:meta.top,infoBottom:info.bottom,columnsTop:cols.top};});
   const a=await measure(current),b=await measure(before);assert.ok(Math.abs(a.width/a.height-w/h)<.01);assert.ok(a.bottom<=a.slotBottom+.1&&a.bottom<=a.metaTop+.1&&a.infoBottom<a.columnsTop);
   if(viewport.height>=720)assert.ok(a.width>b.width||a.height>b.height,'standard TV art grows while preserving aspect');
   console.log('LOGO_GEOMETRY '+JSON.stringify({viewport,ratio:w/h,before:b,after:a}));
  }
  await current.close();await before.close();
 }
 assert.deepEqual(errors,[]);console.log('TV_COLUMN_FOCUS_LOGO = PASS; ANDROID_DEVICE = NOT_RUN');
}finally{await browser.close();}
