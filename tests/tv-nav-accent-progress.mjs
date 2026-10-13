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
const baselineOutput=execFileSync('git',['show','ea756ad19b24e469a7775feb68af364a24cc9178:index.html'],{encoding:'utf8',maxBuffer:4*1024*1024});
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


const green='rgb(53, 224, 122)';const measured=[];
async function snapshot(p,selector) {
 return p.locator(selector).evaluate(e=>{const s=getComputedStyle(e),a=getComputedStyle(e,'::after');const props=['backgroundColor','color','fontSize','fontWeight','border','borderRadius','boxShadow','outline','padding','width','height','transform','filter'];
 const style=n=>Object.fromEntries(props.map(k=>[k,getComputedStyle(n)[k]]));
 return {filter:!!e.closest('#tvBrowseFilters'),column:e.classList.contains('tv-browse-column'),style:style(e),line:{content:a.content,width:a.width,height:a.height,left:a.left,bottom:a.bottom,transform:a.transform,shadow:a.boxShadow,color:a.backgroundColor},icons:Array.from(e.querySelectorAll('svg,.dot')).map(n=>({style:style(n),stroke:getComputedStyle(n).stroke,fill:getComputedStyle(n).fill})),rect:e.getBoundingClientRect().toJSON()};});
}
function preserved(before,after,{line=false,search=false}={}) {
 // Round 9 deliberately changes column typography/geometry and the shared
 // vertical budget. Compare protected skin and control sizes here; the layout
 // test separately measures and validates the intended positional changes.
 const column=after.column,filter=after.filter;assert.equal(column,before.column);assert.equal(filter,before.filter);
 const stableStyle=s=>Object.fromEntries(Object.entries(s).filter(([k])=>(!column || !['fontSize','padding','width','height'].includes(k))&&(!filter||k!=='height')));
 assert.deepEqual(stableStyle(after.style),stableStyle(before.style));
 if(!column)for(const k of filter?['width']:['x','width','height'])assert.equal(after.rect[k],before.rect[k]);
 assert.deepEqual({...after.line,left:column?before.line.left:after.line.left,color:line?before.line.color:after.line.color},before.line);
 if(column&&after.line.content==='""')assert.ok(Math.abs(parseFloat(after.line.left)-after.rect.width/2)<1.1,'line stays centered in the compact button');
 assert.deepEqual(after.icons.map(i=>({...i,stroke:search?before.icons[0].stroke:i.stroke})),before.icons);
 if(line)assert.equal(after.line.color,green);if(search)assert.equal(after.icons[0].stroke,green);
}
async function openFixtureHistory(p) {
 await p.evaluate(()=>{testBrowse.disableTracking();window.fm=Object.assign({},testBrowse.sdk(),{history:async()=>[{key:'fixture@@@progress@@@1',vodName:'真实历史记录',vodPic:'/poster.jpg',position:3608000,duration:7322000,episodeName:'这是很长很长的原生剧集名称需要正常省略而不能挤压右侧播放时间',createTime:Date.now()}]});testBrowse.state.recent.loaded=false;});
 await p.locator('#tvFunction-history').click();await p.waitForFunction(()=>!testBrowse.state.recent.loading&&document.querySelectorAll('#tvBrowseRail .card').length===1);
}
async function geometry(p) {return p.locator('.tv-history-progress-info').evaluate(e=>{const t=document.querySelector('#tvHistoryTime'),n=document.querySelector('#tvHistoryEpisode'),b=document.querySelector('#tvHistoryContinue'),r=e.parentElement,bar=document.querySelector('#tvHistoryProgress');const rect=n=>n.getBoundingClientRect().toJSON();const timeRange=document.createRange();timeRange.selectNodeContents(t);
 return {width:e.getBoundingClientRect().width,info:rect(e),button:rect(b),row:rect(r),time:rect(t),timeInk:timeRange.getBoundingClientRect().toJSON(),name:rect(n),nameOverflow:n.scrollWidth>n.clientWidth,nameRule:getComputedStyle(n).textOverflow,timeText:t.textContent,progressHeight:bar.getBoundingClientRect().height,played:getComputedStyle(bar.firstElementChild).backgroundColor,unplayed:getComputedStyle(bar).backgroundColor,ratio:bar.firstElementChild.getBoundingClientRect().width/bar.getBoundingClientRect().width,tabIndex:bar.tabIndex,color:getComputedStyle(t).color};});}
async function checkView(viewport) {
 const p=await pageAt(true,viewport),ref=await pageAt(true,viewport,true,true);await p.waitForTimeout(200);await ref.waitForTimeout(200);
 for(const page of [p,ref])await page.evaluate(()=>{const q=testBrowse.seed('movie',4);q.hasMore=false;testBrowse.tvBrowseSelectColumn('movie');});
 for(const shade of ['#dedede','#151515']) {
  for(const page of [p,ref])await page.evaluate(color=>document.querySelectorAll('.tv-browse-backdrop').forEach(e=>e.style.backgroundImage=`linear-gradient(${color},${color})`),shade);
  await p.locator('#tvBrowseRail .card').first().focus();await ref.locator('#tvBrowseRail .card').first().focus();
  let old=await snapshot(ref,'#tvColumn-movie'),now=await snapshot(p,'#tvColumn-movie');preserved(old,now,{line:true});assert.equal(now.line.width,'18px');assert.equal(now.line.height,'2px');
  preserved(await snapshot(ref,'#tvColumn-tv'),await snapshot(p,'#tvColumn-tv'));assert.equal((await snapshot(p,'#tvColumn-tv')).style.backgroundColor,'rgba(40, 40, 40, 0.18)');
  await p.locator('#tvColumn-movie').focus();await ref.locator('#tvColumn-movie').focus();await p.waitForTimeout(250);await ref.waitForTimeout(250);preserved(await snapshot(ref,'#tvColumn-movie'),await snapshot(p,'#tvColumn-movie'),{line:true});
  assert.equal((await snapshot(p,'#tvColumn-movie')).style.backgroundColor,'rgba(255, 255, 255, 0.55)');assert.equal((await snapshot(p,'#tvColumn-movie')).style.color,'rgb(23, 33, 43)');
  if(process.env.WEBHOME_VISUAL_DIR)await p.screenshot({path:join(process.env.WEBHOME_VISUAL_DIR,`category-${viewport.width}-${shade.slice(1)}.png`)});
  for(const selector of ['#tvFunction-live','#tvFunction-history','#tvFunction-settings','#connectionToggle']){
   await p.locator(selector).focus();await ref.locator(selector).focus();await p.waitForTimeout(200);await ref.waitForTimeout(200);old=await snapshot(ref,selector);now=await snapshot(p,selector);preserved(old,now,{line:true});assert.equal(now.line.width,'18px');assert.equal(now.line.height,'2px');assert.equal(now.style.color,old.style.color);
  }
  const normalOld=await snapshot(ref,'#tvFunction-search'),normalNow=await snapshot(p,'#tvFunction-search');preserved(normalOld,normalNow);
  await p.locator('#tvFunction-search').focus();await ref.locator('#tvFunction-search').focus();await p.waitForTimeout(200);await ref.waitForTimeout(200);
  preserved(await snapshot(ref,'#tvFunction-search'),await snapshot(p,'#tvFunction-search'),{search:true});assert.equal((await snapshot(p,'#tvFunction-search')).line.content,'none');
  assert.deepEqual(await p.locator('#tvFunction-search circle,#tvFunction-search path').evaluateAll(ns=>ns.map(n=>getComputedStyle(n).stroke)),[green,green]);
  if(process.env.WEBHOME_VISUAL_DIR)await p.screenshot({path:join(process.env.WEBHOME_VISUAL_DIR,`search-${viewport.width}-${shade.slice(1)}.png`)});
 }
 // Round 10 selected filter lines join the scoped green accent; capsule remains unchanged.
 for(const page of [p,ref]){await page.locator('#tvColumn-movie').focus();await press(page,'Enter');await press(page,'Enter');}
 const filter='#tvBrowseFilters button[aria-pressed="true"]';preserved(await snapshot(ref,filter+' >> nth=0'),await snapshot(p,filter+' >> nth=0'),{line:true});
 assert.equal((await snapshot(p,filter+' >> nth=0')).line.color,green);
 for(const page of [p,ref])await press(page,'Escape');
 await openFixtureHistory(p);await openFixtureHistory(ref);
 assert.equal(await p.locator('#tvBrowseFunctions').isVisible(),false);assert.equal(await p.locator('#tvBrowseFunctions button[tabindex="0"]').count(),0);
 for(const selector of ['#recentManageBtn','#tvHistoryContinue']){
  preserved(await snapshot(ref,selector),await snapshot(p,selector));await p.locator(selector).focus();await ref.locator(selector).focus();await p.waitForTimeout(250);await ref.waitForTimeout(250);preserved(await snapshot(ref,selector),await snapshot(p,selector));
 }
 const before=await geometry(ref),after=await geometry(p);const expected=Math.max(220,Math.min(viewport.width*.16,320));assert.ok(Math.abs(after.width-expected)<.1);
 for(const k of ['x','width','height'])assert.equal(after.button[k],before.button[k]);assert.equal(after.progressHeight,3);assert.equal(after.played,'rgb(217, 87, 99)');assert.equal(after.unplayed,'rgba(255, 255, 255, 0.45)');assert.equal(after.tabIndex,-1);assert.ok(Math.abs(after.ratio-3608/7322)<.002);assert.equal(after.timeText,'1:00:08 / 2:02:02');
 assert.equal(after.nameRule,'ellipsis');assert.equal(after.nameOverflow,true);assert.ok(after.timeInk.right<=after.info.right+.1 && after.timeInk.left>=after.info.left-.1);assert.ok(after.info.right<viewport.width);
 if(viewport.width===960){await p.locator('.tv-history-resume').evaluate(e=>e.style.maxWidth='320px');const tight=await geometry(p);assert.ok(tight.width<220);assert.deepEqual(tight.button.width,after.button.width);assert.ok(tight.timeInk.right<=tight.row.right+.1);measured.push({viewport,mode:'constrained-320px-row',...tight});await p.locator('.tv-history-resume').evaluate(e=>e.style.maxWidth='');}
 measured.push({viewport,mode:'normal',beforeWidth:before.width,...after});console.log('NAV_ACCENT_PROGRESS',JSON.stringify({viewport,beforeWidth:before.width,width:after.width,timeText:after.timeText}));
 if(process.env.WEBHOME_VISUAL_DIR)await p.screenshot({path:join(process.env.WEBHOME_VISUAL_DIR,`history-${viewport.width}.png`)});
 await p.close();await ref.close();
}
try {
 for(const v of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540},{width:2048,height:930}])await checkView(v);
 const mobile=await pageAt(false,{width:390,height:844}),baseMobile=await pageAt(false,{width:390,height:844},true,true);
 assert.equal(await mobile.locator('#tvBrowse').isVisible(),false);preserved(await snapshot(baseMobile,'#homeSearchLauncher'),await snapshot(mobile,'#homeSearchLauncher'));
 await mobile.close();await baseMobile.close();assert.deepEqual(errors,[]);console.log('TV_NAV_ACCENT_PROGRESS = PASS; ANDROID_DEVICE = NOT_RUN');
}finally{if(process.env.WEBHOME_VISUAL_DIR)writeFileSync(join(process.env.WEBHOME_VISUAL_DIR,'geometry.json'),JSON.stringify(measured,null,2));await browser.close();}
