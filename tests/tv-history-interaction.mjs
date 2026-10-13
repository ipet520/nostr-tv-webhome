import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
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
 RECENT_DOUBLE_PRESS_WINDOW_MS, cancelRecentDeleteArm, isVisibleFocusable, tvHistoryPressItem, tvPresentationStatus, homeHeroPresentationStatus, tvEpisodeStatusLabel, normalizeHistoryList, tvBrowseCloseHistory, tvBrowseContinueHistory, tvBrowseQueryKey, tvBrowseOpenHistory, tvBrowsePreview, publishHomeWeeklySnapshot, enterRecentManageMode, exitRecentManageMode,
 openDetail, closeDetail, sdk, loadRecentList, tvBrowseBeginStartup, homeFocusUserEpoch, storeMovieDetailCache, storeTvDetailCache, updateMovieReleaseStatusCards, requestMovieDetailShared, homeEnrichmentRequest, bestDetailLogo, tvBrowseClearPreview, focusRemoteTarget, artLogoResource, prepareArtLogo, renderDetailTitleLogo };
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
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.WEBHOME_BROWSER_EXECUTABLE ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE } : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" }) });
const errors = []; const geometryResults=[];
if(process.env.WEBHOME_VISUAL_DIR)mkdirSync(process.env.WEBHOME_VISUAL_DIR,{recursive:true});
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


const results=[];
async function historyPage(count=3) {
  const p=await pageAt(true);await p.evaluate(count=>{
    testBrowse.disableTracking(); window.vodCalls=[];window.deleteCalls=[];window.historyReads=0;window.deleteFailure=false;window.nativeBacks=0;
    window.historyFixture=Array.from({length:count},(_,i)=>({key:`fixture@@@vod-${i+1}@@@1`,vodName:'历史记录'+(i+1),vodPic:'/poster.jpg',position:8000+i*1000,duration:100000,episodeName:'Native episode '+(i+1),createTime:Date.now()-i*1000,mediaType:'movie',tmdbId:7000+i}));
    const original=testBrowse.sdk();window.fm=Object.assign({},original,{
      history:async()=>{historyReads++;return historyFixture.map(i=>({...i}));},
      device:async()=>({ip:'http://fixture.local:9978'}),
      req:async(url,options)=>{
        if(url.endsWith('/api/playback/progress/delete')) {
          const payload=JSON.parse(options.body);deleteCalls.push(payload);
          if(deleteFailure)return {status:500,body:{success:false,message:'delete fixture failed'}};
          const before=historyFixture.length;historyFixture=historyFixture.filter(i=>i.key!==payload.historyKey);
          return {status:200,body:{success:true,action:'deleted',affected:before-historyFixture.length}};
        }
        return original.req(url,options);
      },
      vod:async(...args)=>{vodCalls.push(args);},back:()=>nativeBacks++
    });testBrowse.state.recent.loaded=false;testBrowse.state.recent.items=[];
  },count);
  await p.locator('#tvFunction-history').click();await p.waitForFunction(()=>!testBrowse.state.recent.loading);
  if(count)await p.locator('#tvBrowseRail .card').first().focus();
  return p;
}
async function waitWindow(p){await p.waitForTimeout(await p.evaluate(()=>testBrowse.RECENT_DOUBLE_PRESS_WINDOW_MS)+90);}
async function counts(p){return p.evaluate(()=>({vod:vodCalls.length,deleted:deleteCalls.length,pending:testBrowse.state.recentDelete.pendingTimer,armed:testBrowse.state.recentDelete.armedKey}));}
async function ok(name,p){results.push(name);console.log(name+' = PASS');await p.close();}

async function checks() {
  let p=await historyPage();
  assert.equal(await p.locator('#tvBrowseFunctions').isVisible(),false);assert.equal(await p.locator('#tvBrowseColumns').isVisible(),false);
  assert.equal(await p.locator('#tvBrowseFunctions button[tabindex="0"]').count(),0);
  assert.deepEqual(await p.locator('#tvBrowseRecentTools button').evaluateAll(bs=>bs.filter(b=>!b.hidden&&!b.closest('[hidden]')).map(b=>b.id)),['recentManageBtn']);
  for(const key of ['ArrowUp','ArrowUp','ArrowUp','ArrowLeft','ArrowRight']){await press(p,key);assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#tvBrowseFunctions,#tvBrowseColumns')),false);}
  assert.equal(await active(p),'recentManageBtn');
  await press(p,'Escape');assert.equal(await p.locator('#tvBrowseFunctions').isVisible(),true);assert.equal(await p.locator('#tvBrowseFunctions button[tabindex="0"]').count(),5);assert.equal(await active(p),'tvFunction-history');
  await ok('HISTORY_NAV_ISOLATION_AND_HOME_RESTORE',p);

  p=await historyPage();await p.keyboard.down('Enter');
  await p.evaluate(()=>document.activeElement.click());await p.keyboard.up('Enter');await p.evaluate(()=>document.activeElement.click());
  assert.equal((await counts(p)).vod,0,'no handoff before double-press window');await waitWindow(p);
  assert.equal((await counts(p)).vod,1);assert.equal((await counts(p)).deleted,0);assert.equal((await counts(p)).armed,'');
  assert.equal(await p.evaluate(()=>vodCalls[0][1]),'vod-1');assert.equal(await p.locator('#detailSheet.active').count(),0);
  await p.evaluate(()=>{localStorage.removeItem('fm_pan_playing');testBrowse.restoreHomeReturn();});assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'history');
  await ok('SINGLE_PRESS_KEYUP_CLICK_DEDUPE_AND_RETURN',p);

  p=await historyPage();await press(p,'Enter');await press(p,'Enter');
  assert.ok((await counts(p)).armed);assert.equal((await counts(p)).pending,0);await waitWindow(p);assert.equal((await counts(p)).vod,0);assert.equal((await counts(p)).deleted,0);
  await press(p,'Enter');await p.waitForFunction(()=>historyFixture.length===2&&!testBrowse.state.recent.loading&&document.querySelectorAll('#tvBrowseRail .card').length===2);
  await p.waitForTimeout(250);assert.equal((await counts(p)).vod,0);assert.equal((await counts(p)).deleted,1);
  assert.ok((await p.locator('#tvBrowseTitle').textContent()).includes('2'));assert.equal(await p.locator('#tvHistoryEpisode').textContent(),'Native episode 2');
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.mediaKey),await p.locator('#tvBrowseRail .card').first().getAttribute('data-media-key'));
  await ok('DOUBLE_PRESS_CANCELS_PLAY_THIRD_CONFIRMS_SINGLE_DELETE',p);

  p=await historyPage();await p.evaluate(()=>{historyFixture[1].tmdbId=historyFixture[0].tmdbId;return testBrowse.loadRecentList({refresh:true,silent:true});});
  await p.locator('#tvBrowseRail .card').first().focus();await press(p,'Enter');await press(p,'ArrowRight');await press(p,'Enter');await waitWindow(p);
  assert.equal((await counts(p)).deleted,0);assert.equal((await counts(p)).armed,'');assert.equal(await p.evaluate(()=>vodCalls[0][1]),'vod-2');
  await ok('DIFFERENT_NATIVE_IDENTITIES_NEVER_DOUBLE_DELETE',p);

  p=await historyPage();await press(p,'Enter');await p.keyboard.down('Enter');await waitWindow(p);assert.equal((await counts(p)).vod,0,'second valid keydown prevents first single from escaping while held');await p.keyboard.up('Enter');assert.ok((await counts(p)).armed);await press(p,'ArrowRight');assert.equal((await counts(p)).armed,'');await ok('SECOND_PRESS_HELD_ACROSS_WINDOW_NEVER_STARTS_PLAY',p);

  p=await historyPage();await p.keyboard.down('Enter');for(let i=0;i<4;i++)await p.keyboard.down('Enter');await p.keyboard.up('Enter');await waitWindow(p);
  assert.equal((await counts(p)).vod,1);assert.equal((await counts(p)).armed,'');assert.equal((await counts(p)).deleted,0);
  await ok('HELD_ENTER_REPEAT_IS_ONE_PRESS',p);

  p=await historyPage();await press(p,'Enter');await press(p,'ArrowRight');await waitWindow(p);assert.equal((await counts(p)).vod,0);assert.equal((await counts(p)).pending,0);
  await press(p,'Enter');await press(p,'Enter');assert.ok((await counts(p)).armed);await press(p,'ArrowUp');assert.equal((await counts(p)).armed,'');
  await p.locator('#tvBrowseRail .card').first().focus();await press(p,'Enter');await p.locator('#recentManageBtn').focus();await waitWindow(p);assert.equal((await counts(p)).vod,0);
  await ok('MOVEMENT_AND_BLUR_CANCEL_PENDING_AND_ARM',p);

  p=await historyPage();await press(p,'Enter');await press(p,'Escape');assert.equal((await counts(p)).pending,0);assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'home');assert.equal(await p.locator('#tvBrowseFunctions').isVisible(),true);await waitWindow(p);assert.equal((await counts(p)).vod,0);
  await ok('BACK_CLEARS_PENDING_SINGLE',p);

  p=await historyPage();await press(p,'Enter');await press(p,'Enter');await press(p,'Escape');assert.equal((await counts(p)).armed,'');assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'home');assert.equal(await active(p),'tvFunction-history');await ok('BACK_EXITS_HISTORY_AND_CLEARS_DELETE_CONFIRMATION',p);

  p=await historyPage();await press(p,'Enter');await p.evaluate(()=>{historyFixture=[];return testBrowse.loadRecentList({refresh:true,silent:true});});await waitWindow(p);
  assert.equal((await counts(p)).vod,0);assert.equal((await counts(p)).pending,0);assert.equal(await p.locator('#tvHistoryResume').isVisible(),false);assert.equal(await active(p),'recentManageBtn');
  await ok('EXPIRED_RECORD_CANNOT_PLAY_EMPTY_FOCUS_VALID',p);

  p=await historyPage();await press(p,'ArrowUp');await p.keyboard.press('Enter');await p.waitForTimeout(35);assert.equal((await counts(p)).vod,1);assert.equal((await counts(p)).pending,0);
  assert.equal(await p.evaluate(()=>vodCalls[0][1]),'vod-1');await ok('CONTINUE_BUTTON_IMMEDIATE_SHARED_NATIVE_GATE',p);

  p=await historyPage();await press(p,'Enter');await p.evaluate(()=>testBrowse.enterRecentManageMode());assert.equal((await counts(p)).pending,0);await p.locator('#recentManageCancel').click();await p.waitForFunction(()=>document.activeElement.id==='recentManageBtn');await p.locator('#tvBrowseRail .card').first().focus();await press(p,'Enter');await waitWindow(p);assert.equal((await counts(p)).vod,1);assert.equal((await counts(p)).armed,'');await ok('MANAGE_SWITCH_CLEARS_PENDING_AND_EXIT_RESTORES_SINGLE',p);

  p=await historyPage();await press(p,'Enter');await p.locator('#recentManageBtn').click();assert.equal((await counts(p)).pending,0);
  await p.locator('#tvBrowseRail .card').first().focus();await press(p,'Enter');await press(p,'Enter');await waitWindow(p);
  assert.equal((await counts(p)).vod,0);assert.equal((await counts(p)).armed,'');assert.equal(await p.evaluate(()=>Object.keys(testBrowse.state.recentManage.selectedKeys).length),0);
  await press(p,'ArrowUp');assert.equal(await active(p),'recentManageSelectAll');await press(p,'Enter');
  assert.equal(await p.evaluate(()=>Object.keys(testBrowse.state.recentManage.selectedKeys).length),3);
  await press(p,'ArrowRight');assert.equal(await active(p),'recentManageDelete');await press(p,'Enter');assert.equal((await counts(p)).deleted,0);await press(p,'Enter');
  await p.waitForFunction(()=>!testBrowse.state.recentManage.deleting&&historyFixture.length===0&&document.querySelectorAll('#tvBrowseRail .card').length===0);
  assert.equal((await counts(p)).deleted,3);assert.equal((await counts(p)).vod,0);assert.equal(await p.locator('#tvHistoryResume').isVisible(),false);
  assert.equal(await p.locator('#tvBrowseBackdrop').evaluate(e=>e.style.backgroundImage),'');
  await p.waitForTimeout(120);assert.equal(await active(p),'recentManageCancel');await press(p,'Enter');assert.equal(await active(p),'recentManageBtn');
  await ok('MANAGE_SELECT_TOGGLE_SELECT_ALL_CONFIRM_BATCH_CLEAR',p);

  p=await historyPage(1);await press(p,'Enter');await press(p,'Enter');await press(p,'Enter');
  await p.waitForFunction(()=>!testBrowse.state.recent.loading&&historyFixture.length===0&&document.querySelectorAll('#tvBrowseRail .card').length===0);await p.waitForTimeout(120);
  assert.equal(await p.locator('#tvHistoryResume').isVisible(),false);assert.equal(await active(p),'recentManageBtn');assert.match(await p.locator('#tvBrowseStatus').textContent(),/暂无/);
  await ok('LAST_SINGLE_DELETE_REFRESHES_EMPTY_VIEW',p);

  p=await historyPage(1);await press(p,'Enter');await press(p,'Enter');await p.evaluate(()=>{testBrowse.state.recent.items=[];});await press(p,'Enter');await waitWindow(p);
  assert.equal((await counts(p)).deleted,0);assert.equal((await counts(p)).vod,0);assert.equal((await counts(p)).armed,'');await ok('INVALIDATED_ARM_CANNOT_DELETE',p);

  p=await historyPage(1);await p.locator('#tvBrowseRail .card').click();assert.equal((await counts(p)).vod,0);await waitWindow(p);assert.equal((await counts(p)).vod,1);
  await ok('POINTER_CLICK_USES_SAME_SINGLE_PRESS_WINDOW',p);

  p=await historyPage(1);await p.evaluate(()=>deleteFailure=true);await press(p,'Enter');await press(p,'Enter');await press(p,'Enter');await p.waitForFunction(()=>deleteCalls.length>0);await p.waitForTimeout(250);
  assert.equal(await p.locator('#tvBrowseRail .card').count(),1);assert.equal(await p.locator('#tvHistoryResume').isVisible(),true);assert.equal(await p.evaluate(()=>historyFixture.length),1);assert.equal((await counts(p)).vod,0);
  assert.match(await p.locator('#toast').textContent(),/失败/);await ok('DELETE_FAILURE_PRESERVES_NATIVE_RECORD',p);

  p=await historyPage();await p.evaluate(()=>deleteFailure=true);await p.locator('#recentManageBtn').click();await p.locator('#recentManageSelectAll').click();await p.locator('#recentManageDelete').click();await p.locator('#recentManageDelete').click();
  await p.waitForFunction(()=>deleteCalls.length>0&&!testBrowse.state.recentManage.deleting);assert.equal(await p.locator('#tvBrowseRail .card').count(),3);assert.equal(await p.evaluate(()=>historyFixture.length),3);assert.equal((await counts(p)).vod,0);assert.match(await p.locator('#toast').textContent(),/删除失败/);
  await ok('BATCH_DELETE_FAILURE_PRESERVES_REAL_RECORDS',p);
}
try {await checks();assert.deepEqual(errors,[]);console.log('HISTORY_INTERACTION_ACCEPTANCE = PASS; ANDROID_DEVICE = NOT_RUN');}
finally {if(process.env.WEBHOME_VISUAL_DIR)writeFileSync(join(process.env.WEBHOME_VISUAL_DIR,'interaction-results.json'),JSON.stringify(results,null,2));await browser.close();}
