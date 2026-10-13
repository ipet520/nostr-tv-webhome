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
const hook = `window.testBrowse = { renderDetailBase, renderDetailTitleMeta, secondaryGetQuery, state, renderAll, renderTvBrowse, tvBrowseState, tvBrowseFocusIntent,
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
const baselineOutput=execFileSync('git',['show','70ac0793249107ffd4c9b26e34c60b34ae04bee9:index.html'],{encoding:'utf8',maxBuffer:4*1024*1024});
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
const results=[];
async function geometry(p){return p.evaluate(()=>{
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
 const title=document.querySelector('#detailTitle'),img=document.querySelector('#detailLogoImg'),score=document.querySelector('#detailTitleMeta'),row=title.closest('.detail-title-row');
 return {logo:rect(img),title:rect(title),score:rect(score),row:rect(row),actions:rect(document.querySelector('#detailSheet > .actions')),titleVisible:getComputedStyle(title).visibility==='visible',logoVisible:!img.hidden&&getComputedStyle(document.querySelector('#detailLogoWrap')).display!=='none',scoreText:score.textContent,ratio:img.naturalWidth/img.naturalHeight,slot:!!row.querySelector('.detail-title-slot')};
 });}
async function setup(p,id,title,score,asset){await p.evaluate(({id,title,score,asset})=>{
 const item={tmdbId:id,id,mediaType:'movie',title,source:'tmdb',pic:'/poster.jpg'};if(asset)item.logo=asset;
 const detail={id,title,vote_average:score,overview:'详情简介',genres:[{id:18,name:'剧情'}]};
 testBrowse.state.selected=item;testBrowse.state.detail=detail;document.querySelector('#detailSheet').classList.add('active','detail-large');
 testBrowse.renderDetailBase(item);testBrowse.renderDetailTitleMeta(item,detail);testBrowse.renderDetailTitleLogo(item,detail,title);
 },{id,title,score,asset});}
const overlaps=(a,b)=>a.x<b.right&&b.x<a.right&&a.y<b.bottom&&b.y<a.bottom;
try{
 for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540},{width:1728,height:894},{width:2048,height:930},{width:1280,height:400}]){
  for(const [kind,w,h,title,score]of [['wide',1200,140,'短片',8.6],['tall',140,900,'窄艺术标题',8.6],['long',1200,140,'这是很长很长的电影文字标题以及带冒号：中文和 English Subtitle 2026',8.6],['no-score',600,180,'无评分影片',0]]){
   const before=await pageAt(true,viewport,true,true),after=await pageAt(true,viewport);await after.waitForTimeout(150);await before.waitForTimeout(150);
   const asset='/layout-'+kind+'.png';
   for(const page of [before,after])await page.route('**'+asset,async r=>{await new Promise(resolve=>setTimeout(resolve,250));await r.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="gold"/><text x="10" y="80" fill="#333" font-size="64">ART TITLE</text></svg>`});});
   await setup(before,71000+results.length,title,score,asset);await setup(after,71000+results.length,title,score,asset);
   const pending=await geometry(after);await after.waitForFunction(()=>!document.querySelector('#detailLogoImg').hidden&&document.querySelector('#detailLogoImg').naturalWidth>0);await before.waitForFunction(()=>!document.querySelector('#detailLogoImg').hidden&&document.querySelector('#detailLogoImg').naturalWidth>0);await after.waitForTimeout(220);
   const old=await geometry(before),now=await geometry(after);assert.equal(now.slot,true);assert.equal(now.titleVisible,false);assert.equal(now.logoVisible,true);assert.ok(!overlaps(now.logo,now.score),'art and rating have separate paint bounds');assert.ok(now.row.bottom<=now.actions.y+.1);assert.deepEqual(now.actions,pending.actions,'delayed art does not move detail actions');assert.ok(Math.abs(now.logo.width/now.logo.height-w/h)<.02,JSON.stringify({kind,w,h,now}));assert.ok(now.logo.height<=96.1);if(score)assert.ok(now.scoreText.includes('8.6'));else assert.equal(now.scoreText,'');
   results.push({viewport,kind,before:old,pending,after:now});
   if(process.env.WEBHOME_VISUAL_DIR&&['wide','long'].includes(kind))for(const [page,version]of [[before,'before'],[after,'after']])await page.screenshot({path:join(process.env.WEBHOME_VISUAL_DIR,`${viewport.width}x${viewport.height}-detail-${kind}-${version}.png`)});
   if(kind==='wide'){
    // Constrained TV information width wraps rating below the fixed title slot.
    await after.locator('#detailSheet > .detail-info').first().evaluate(e=>{e.style.width='190px';e.style.maxWidth='190px';});const tight=await geometry(after);assert.ok(tight.score.y>=tight.title.bottom);assert.ok(!overlaps(tight.logo,tight.score));
   }
   await setup(after,72000+results.length,title,score,null);await after.waitForTimeout(180);const fallback=await geometry(after);assert.equal(fallback.titleVisible,true);assert.equal(fallback.logoVisible,false);assert.ok(!overlaps(fallback.title,fallback.score));
   await after.route('**/broken-title.png',r=>r.abort());await setup(after,73000+results.length,title,score,'/broken-title.png');await after.waitForTimeout(300);assert.equal((await geometry(after)).titleVisible,true);assert.equal((await geometry(after)).logoVisible,false);
   await before.close();await after.close();
  }
  console.log(`TV_DETAIL_TITLE ${viewport.width}x${viewport.height} = PASS`);
 }
 const mobile=await pageAt(false,{width:390,height:844});await mobile.evaluate(()=>testBrowse.renderDetailTitleLogo({title:'中文文字标题',mediaType:'movie',id:90000},{id:90000},'中文文字标题'));assert.equal(await mobile.locator('.detail-title-slot').count(),0);await mobile.close();
 assert.deepEqual(errors,[]);console.log('DETAIL_LOGO_SCORE_LAYOUT = PASS; ANDROID_DEVICE = NOT_RUN');
}finally{if(process.env.WEBHOME_VISUAL_DIR)writeFileSync(join(process.env.WEBHOME_VISUAL_DIR,'detail-geometry.json'),JSON.stringify(results,null,2));await browser.close();}
