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
 tvPresentationStatus, homeHeroPresentationStatus, tvEpisodeStatusLabel, normalizeHistoryList, tvBrowseCloseHistory, tvBrowseContinueHistory, tvBrowseQueryKey, tvBrowseOpenHistory, tvBrowsePreview, publishHomeWeeklySnapshot, enterRecentManageMode, exitRecentManageMode,
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


async function logoChecks() {
  const p=await pageAt(true); const events=[]; const counts=new Map();
  await p.evaluate(()=>{const ImageCtor=window.Image;window.logoDecodes={};window.Image=function(...args){const img=new ImageCtor(...args),decode=img.decode.bind(img);img.decode=()=>{logoDecodes[img.src]=(logoDecodes[img.src]||0)+1;return decode();};return img;};});
  await p.route('**/tmdb/movie/8800*',async route=>{
    const id=Number(new URL(route.request().url()).pathname.split('/').pop());
    counts.set(id,(counts.get(id)||0)+1); events.push({stage:'detail',id,time:Date.now()});
    await new Promise(r=>setTimeout(r,80));
    await route.fulfill({contentType:'application/json',body:JSON.stringify({id,overview:'资料'+id,images:{logos:id===88002?[]:[{file_path:'/logo-'+id+'.png',iso_639_1:'zh'}]}})});
  });
  await p.route('**/*logo-8800*.png',async route=>{events.push({stage:'image',url:route.request().url(),time:Date.now()});await route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="180"><rect width="600" height="180" fill="white"/></svg>'});});
  await p.evaluate(()=>{const q=testBrowse.seed('movie',4);q.hasMore=false;q.items.forEach((i,n)=>{i.id=i.tmdbId=88000+n;});testBrowse.tvBrowseSelectColumn('movie');});
  await p.waitForFunction(()=>testBrowse.state.movieDetail.cache['movie:88001']?.logoAsset?.ready===true);
  const beforeFocus=Date.now(); const decodes=await p.evaluate(()=>logoDecodes); assert.equal(Object.entries(decodes).find(([url])=>url.includes("88001"))[1],1,"shared asset decodes once before focus");
  assert.ok(events.some(e=>e.stage==='detail'&&e.id===88001&&e.time<beforeFocus));
  assert.ok(events.some(e=>e.stage==='image'&&e.url.includes('88001')&&e.time<beforeFocus));
  await p.locator('#tvBrowseRail .card').nth(1).focus();
  assert.equal(await p.locator('#tvBrowseLogo').isVisible(),true,'decoded adjacent art is immediate');
  await p.waitForFunction(()=>testBrowse.state.movieDetail.cache['movie:88002']?.detail?.id===88002);
  await p.locator('#tvBrowseRail .card').nth(2).focus();await p.waitForTimeout(250);
  assert.equal(await p.locator('#tvBrowseLogo').isVisible(),false,'confirmed no-logo stays text');
  await p.locator('#tvBrowseRail .card').nth(1).focus();await p.locator('#tvBrowseRail .card').nth(2).focus();await p.waitForTimeout(120);
  assert.equal(counts.get(88001),1);assert.equal(counts.get(88002),1);assert.equal(await p.evaluate(()=>Object.entries(logoDecodes).find(([url])=>url.includes("88001"))[1]),1);
  const budget=await p.evaluate(()=>testBrowse.state.homeV14.requestBudget);
  assert.ok(budget.maxActive<=4);assert.ok(budget.maxByClass.enrichment<=1);
  await p.evaluate(()=>{testBrowse.seed('tv',2);testBrowse.tvBrowseSelectColumn('tv');});await p.waitForTimeout(220);
  assert.ok(!(await p.locator('#tvBrowseLogo').getAttribute('src')||'').includes('8800'),'old movie art never paints another column');
  console.log('LOGO_TWO_STAGE',JSON.stringify({events,budget:budget.maxByClass,counts:[...counts]}));await p.close();
}

async function statusChecks() {
  const p=await pageAt(true);
  const result=await p.evaluate(()=>{
    const item={tmdbId:100,mediaType:'tv',weeklyUpdateText:'更新至S15E18 · 2月15日更新'};
    const detail={id:100,status:'Ended',number_of_episodes:335,number_of_seasons:15,last_episode_to_air:{season_number:15,episode_number:18,air_date:'2015-02-15'}};
    const cases=['Ended','Canceled','Returning Series','Unknown'].map(status=>({status,text:testBrowse.tvPresentationStatus(item,{...detail,status})}));
    const wrong=testBrowse.tvPresentationStatus(item,{...detail,id:101});
    const q=testBrowse.seed('tv',1);q.hasMore=false;q.items[0]={...item,id:'tmdb:tv:100',source:'tmdb',pic:'/poster.jpg',title:'CSI'};
    testBrowse.storeTvDetailCache(item,detail);testBrowse.tvBrowseSelectColumn('tv');
    return {cases,wrong,hero:testBrowse.homeHeroPresentationStatus(item,detail),preview:document.querySelector('#tvBrowseUpdate').textContent,poster:document.querySelector('.card-air-status').textContent,final:testBrowse.tvPresentationStatus(item,{...detail,last_episode_to_air:{...detail.last_episode_to_air,air_date:new Date().toISOString().slice(0,10)}})};
  });
  assert.match(result.cases[0].text,/已完结.*335/);assert.match(result.cases[1].text,/已停播/);assert.ok(!result.cases[1].text.includes('335'));
  assert.match(result.cases[2].text,/更新至 S15E18/);assert.match(result.cases[3].text,/已播 S15E18/);
  for(const entry of result.cases)assert.ok(!entry.text.includes('2月15日'));
  assert.equal(result.hero,result.preview);assert.equal(result.hero,result.poster);assert.match(result.final,/已完结/);
  console.log('TV_LIFECYCLE',JSON.stringify(result));await p.close();
}

async function historyChecks(viewport) {
  const p=await pageAt(true,viewport);await p.waitForTimeout(100);
  await p.route('**/tmdb/tv/77*',async route=>{const id=Number(new URL(route.request().url()).pathname.split('/').pop());await route.fulfill({contentType:'application/json',body:JSON.stringify({id,status:'Returning Series',number_of_seasons:2,last_episode_to_air:{season_number:2,episode_number:9},first_air_date:'2024-01-01',overview:'历史资料由匹配的 TMDB 详情补充；续播季集与进度仍来自原生记录。',genres:[{id:18,name:'剧情'}],backdrop_path:'/history-background.jpg',images:{logos:[]}})});});
  await p.evaluate(()=>{
    window.historyFixture=[{key:'fixture@@@vod-1@@@1',vodName:'真实观看记录一',vodPic:'/poster.jpg',position:8000,duration:23000,episodeName:'原生记录第7集',createTime:Date.now(),tmdbId:771,mediaType:'tv'}, {key:'fixture@@@vod-2@@@1',vodName:'真实观看记录二',vodPic:'/poster2.jpg',position:16000,duration:100000,episodeName:'原生记录第12集',createTime:Date.now()-1000,tmdbId:772,mediaType:'tv'}];
    window.vodCalls=[];window.nativeBacks=0;
    window.fm=Object.assign({},testBrowse.sdk(),{history:async()=>historyFixture,vod:async(...args)=>{vodCalls.push(args);await new Promise(r=>setTimeout(r,120));},back:()=>{nativeBacks++;}});
    testBrowse.disableTracking();
    testBrowse.state.recent.loaded=false;testBrowse.state.recent.items=[];
  });
  await p.locator('#tvFunction-history').click();await p.waitForFunction(()=>!testBrowse.state.recent.loading&&document.querySelectorAll('#tvBrowseRail .card').length===2); await p.waitForFunction(()=>document.querySelector('#tvBrowseOverview').textContent.includes('匹配的 TMDB'));
  assert.equal(await p.locator('#tvBrowseFunctions button').count(),5);
  assert.equal(await p.locator('#tvBrowseFunctions').isVisible(),false);assert.equal(await p.locator('#tvBrowseFunctions button[tabindex="0"]').count(),0);
  const top=await p.locator('#tvBrowseRecentTools').boundingBox();assert.ok(top.x>=0&&top.x+top.width<viewport.width);
  assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'history');
  assert.equal(await p.locator('#tvColumn-recent').count(),0);
  assert.equal(await p.locator('#tvBrowseColumns').isVisible(),false);
  assert.equal(await p.locator('#tvHistoryTime').textContent(),'0:08 / 0:23');
  assert.equal(await p.locator('#tvHistoryEpisode').textContent(),'原生记录第7集');
  const progress=await p.locator('#tvHistoryProgress').evaluate(e=>({height:e.getBoundingClientRect().height,bg:getComputedStyle(e).backgroundColor,played:getComputedStyle(e.firstElementChild).backgroundColor,width:e.firstElementChild.getBoundingClientRect().width/e.getBoundingClientRect().width,tab:e.tabIndex}));
  assert.equal(progress.height,3);assert.equal(progress.bg,'rgba(255, 255, 255, 0.45)');assert.equal(progress.played,'rgb(217, 87, 99)');assert.ok(Math.abs(progress.width-8/23)<.002);assert.equal(progress.tab,-1);
  await p.locator('#tvBrowseRail .card').first().focus();await press(p,'ArrowUp');assert.equal(await active(p),'tvHistoryContinue');
  await p.waitForTimeout(250); const focused=await p.locator('#tvHistoryContinue').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,icon:getComputedStyle(e.querySelector('svg')).fill,rect:e.getBoundingClientRect().toJSON()}));
  assert.equal(focused.bg,'rgb(247, 247, 247)');assert.equal(focused.icon,'rgb(53, 224, 122)');assert.ok(focused.rect.right<viewport.width);
  await press(p,'ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.closest('#tvBrowseRail')?.id),'tvBrowseRail');
  assert.equal(await p.locator('#tvHistoryContinue svg').evaluate(e=>getComputedStyle(e).fill),'rgb(53, 224, 122)');
  const geometry=await p.locator('#tvBrowseRail .card').first().evaluate(e=>{const r=e.querySelector('.poster-wrap').getBoundingClientRect(),t=e.querySelector('.card-title').getBoundingClientRect();return {posterWidth:r.width,posterHeight:r.height,ratio:r.width/r.height,titleBottom:t.bottom,margin:innerHeight-t.bottom};});
  assert.ok(Math.abs(geometry.ratio-2/3)<.001);assert.ok(geometry.margin>5);
  await p.keyboard.down('Enter'); await p.keyboard.down('Enter'); await p.keyboard.up('Enter'); await p.waitForTimeout(250);
  await p.evaluate(()=>{document.querySelector('#tvBrowseRail .card').click();document.querySelector('#tvHistoryContinue').click();document.querySelector('#tvBrowseRail .card').click();});await p.waitForTimeout(180);
  assert.equal(await p.evaluate(()=>vodCalls.length),1,'both entrances share the same in-flight/native marker gate');
  assert.equal(await p.evaluate(()=>vodCalls[0][0]),'fixture');assert.equal(await p.evaluate(()=>vodCalls[0][1]),'vod-1');assert.equal(await p.locator('#detailSheet.active').count(),0);
  await p.evaluate(()=>{localStorage.removeItem('fm_pan_playing');testBrowse.restoreHomeReturn();});
  assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'history','native return restores history snapshot');
  await p.locator('#tvBrowseRail .card').nth(1).focus();assert.equal(await p.locator('#tvHistoryTime').textContent(),'0:16 / 1:40');
  await p.locator('#tvHistoryContinue').click();await p.waitForTimeout(180);assert.equal(await p.evaluate(()=>vodCalls[1][1]),'vod-2');
  await p.evaluate(()=>{localStorage.removeItem('fm_pan_playing');historyFixture=historyFixture.slice(0,1);});await p.evaluate(()=>testBrowse.loadRecentList({refresh:true,silent:true}));
  assert.equal(await p.locator('#tvBrowseRail .card').count(),1);assert.equal(await p.locator('#tvHistoryTime').textContent(),'0:08 / 0:23');
  assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().positions['native-history'].key),await p.locator('#tvBrowseRail .card').getAttribute('data-media-key'));
  assert.equal(await p.locator('#connectionToggle').isVisible(),false);
  await press(p,'Escape');assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'home');assert.equal(await active(p),'tvFunction-history');assert.equal(await p.evaluate(()=>nativeBacks),0);
  await press(p,'Escape');assert.equal(await p.evaluate(()=>nativeBacks),1,'second back reaches the unchanged Native boundary');
  await p.locator('#tvFunction-history').click();await p.waitForTimeout(50);await p.evaluate(()=>history.back());await p.waitForTimeout(120);assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'home','native-style history traversal uses existing popstate');
  const record={viewport,geometry,focused,progress}; geometryResults.push(record); console.log('HISTORY_GEOMETRY',JSON.stringify(record));
  if(process.env.WEBHOME_VISUAL_DIR){await p.locator('#tvFunction-history').click();await p.waitForTimeout(300);await p.locator('#tvBrowseRail .card').focus();await p.screenshot({path:join(process.env.WEBHOME_VISUAL_DIR,`history-${viewport.width}x${viewport.height}.png`)});}
  await p.close();
}

async function historyEdgeChecks() {
  const p=await pageAt(true);await p.evaluate(()=>{
    testBrowse.disableTracking();window.resolveNativeHistory=null;window.fm=Object.assign({},testBrowse.sdk(),{history:()=>new Promise(r=>{resolveNativeHistory=r;})});testBrowse.state.recent.loaded=false;
  });
  await p.locator('#tvFunction-history').click();assert.match(await p.locator('#tvBrowseStatus').textContent(),/加载/);assert.equal(await p.locator('#tvHistoryResume').isVisible(),false);
  await p.evaluate(()=>{window.fm.history=async()=>[];resolveNativeHistory([]);});await p.waitForFunction(()=>!testBrowse.state.recent.loading);assert.match(await p.locator('#tvBrowseStatus').textContent(),/暂无/);assert.equal(await p.locator('#tvBrowseRail .card').count(),0);
  await p.evaluate(()=>{window.fm.history=async()=>{throw Error('Bridge unavailable');};return testBrowse.loadRecentList({refresh:true,silent:true});});assert.match(await p.locator('#tvBrowseStatus').textContent(),/Bridge unavailable/);assert.equal(await p.locator('#tvHistoryResume').isVisible(),false);
  await p.evaluate(()=>{window.fm.history=async()=>[{key:'fixture@@@zero@@@1',vodName:'进度未知',duration:0,position:0,createTime:Date.now()}];return testBrowse.loadRecentList({refresh:true,silent:true});});
  assert.equal(await p.locator('#tvHistoryProgress').isVisible(),false);assert.equal(await p.locator('#tvHistoryContinue').isEnabled(),false);assert.match(await p.locator('#tvHistoryTime').textContent(),/暂无/);
  await p.evaluate(()=>{window.fm.history=async()=>[{key:'fixture@@@missing@@@1',vodName:'缺少位置',duration:100000,createTime:Date.now()}];return testBrowse.loadRecentList({refresh:true,silent:true});});
  assert.equal(await p.locator('#tvHistoryProgress').isVisible(),false,'missing Native position never becomes fake zero percent');assert.match(await p.locator('#tvHistoryTime').textContent(),/暂无有效/);
  await p.evaluate(()=>{window.fm.history=async()=>[];return testBrowse.loadRecentList({refresh:true,silent:true});});assert.equal(await p.locator('#tvHistoryResume').isVisible(),false);assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().positions['native-history'].key),'');
  await press(p,'Escape');
  await p.evaluate(()=>{testBrowse.restoreTvBrowseSnapshot({column:'recent',positions:{},filterOpen:true});testBrowse.renderTvBrowse();testBrowse.tvBrowseFocusIntent({type:'id',key:'tvColumn-recent'});});
  assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),'recommendation');assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'home');assert.equal(await p.locator('#tvColumn-recent').count(),0);assert.equal(await p.evaluate(()=>document.activeElement.closest('#tvBrowseRail')?.id),'tvBrowseRail');
  await p.close(); console.log('HISTORY_EMPTY_FAILURE_UPDATE_LEGACY = PASS');
}

try {
  if(process.env.WEBHOME_TEST_CASE!=="history") { await logoChecks();await statusChecks(); } await historyEdgeChecks();
  for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540},{width:1728,height:894},{width:2048,height:930},{width:1280,height:400}])await historyChecks(viewport);
  if(process.env.WEBHOME_VISUAL_DIR)writeFileSync(join(process.env.WEBHOME_VISUAL_DIR,'geometry.json'),JSON.stringify(geometryResults,null,2));
  assert.deepEqual(errors,[]);console.log('ROUND8_HISTORY_LOGO_STATUS = PASS; ANDROID_DEVICE = NOT_RUN');
} finally {await browser.close();}
