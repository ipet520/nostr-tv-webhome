import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { renderIndex, validateRenderedArtifact } from "../scripts/build-core.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(process.env.WEBHOME_PLAYWRIGHT_PATH || join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const { output } = renderIndex();
validateRenderedArtifact(output);
// Exercise actual source, including its event handlers, with deterministic
// business fixtures. Exporting lexical functions is confined to this test HTML.
const hook = `window.testBrowse = { rememberDetailReturn, restoreDetailReturn, beginDetailSession, endDetailSession, detailSessionFor, detailSessionSnapshot, restoreDetailSessionAfterPlayerReturn, requestDetailPlayback, prepareDetailPlayback, detailPlaybackIsCurrent, tryCommitDetailProvider, setDetailPlaybackTarget, reconcileDetailAfterNativeReturn, state, renderAll, renderTvBrowse, tvBrowseState, tvBrowseFocusIntent,
 tvBrowseSelectColumn, tvBrowseSnapshot, restoreTvBrowseSnapshot, rememberHomeReturn, restoreHomeReturn,
 buildUiSnapshot, restoreUiSnapshot, openSidebar, closeSidebar, openSearchPage, closeSearchPage,
 bindActions, installRemoteKeys, secondaryActiveQuery, syncBrowseDevicePresentation, handleWebHomeResume, boot,
 RECENT_DOUBLE_PRESS_WINDOW_MS, cancelRecentDeleteArm, isVisibleFocusable, tvHistoryPressItem, tvPresentationStatus, homeHeroPresentationStatus, tvEpisodeStatusLabel, normalizeHistoryList, tvBrowseCloseHistory, tvBrowseContinueHistory, tvBrowseQueryKey, tvBrowseOpenHistory, tvBrowsePreview, publishHomeWeeklySnapshot, enterRecentManageMode, exitRecentManageMode,
 openDetail, closeDetail, sdk, loadRecentList, renderHomeRecent, tvBrowseBeginStartup, homeFocusUserEpoch, storeMovieDetailCache, storeTvDetailCache, updateMovieReleaseStatusCards, requestMovieDetailShared, homeEnrichmentRequest, bestDetailLogo, tvBrowseClearPreview, focusRemoteTarget, artLogoResource, prepareArtLogo, renderDetailTitleLogo };
 window.testBrowse.configureSession = () => {
 window.providerCalls=[];window.preflightCalls=0;window.curatedDelay=20;window.directDelay=60;window.preflightDelay=0;
 window.fixtureCandidate={key:'candidateB',url:'https://pan.quark.cn/s/B',diskType:'quark',title:'chosen B',identityVerdict:'STRONG',healthAdmission:'ok'};
 canonicalResourceKey=()=>'';resolveCanonicalResourceTitle=async item=>item;loadDetail=async()=>{};
 resolveCuratedPlaybackCandidate=(item,run)=>new Promise(resolve=>{providerCalls.push({provider:'curated',key:run.itemKey,reason:run.reason,seq:run.seq,stack:new Error().stack});const candidate={...fixtureCandidate};setTimeout(()=>resolve({candidate,identityVerdict:'STRONG',sourceId:'fixture'}),curatedDelay);});
 playBestQuark=(item,options)=>new Promise(resolve=>{const run=state.detailPlayback;providerCalls.push({provider:'pan-direct',key:run.itemKey,reason:run.reason,seq:run.seq,stack:new Error().stack});const candidate={...fixtureCandidate};setTimeout(()=>{tryCommitDetailProvider(run,'pan-direct',candidate,{identityVerdict:'STRONG',healthAccepted:!candidate.bad,healthState:candidate.bad?'bad':'ok'});resolve(candidate);},directDelay);});
 freshPanPreflight=async candidate=>{preflightCalls++;await new Promise(r=>setTimeout(r,preflightDelay));return {available:true,cancelled:false,state:candidate.bad?'bad':'ok'};};
 panAutoHealthAdmission=(candidate,freshHealth)=>{const key=panHealthKey(candidate);const health=state.pan.health[key];const stateValue=freshHealth&&Object.prototype.hasOwnProperty.call(freshHealth,key)?freshHealth[key]:health&&health.state;return {accepted:stateValue==='ok',state:stateValue||'unconfirmed'};};
 isPanHealthBad=candidate=>{const health=state.pan.health[panHealthKey(candidate)];return !!(health&&health.state==='bad'&&(!health.expiresAt||health.expiresAt>Date.now()));};
 automaticVideoCandidateVerdict=(item,candidate)=>({accepted:!candidate.invalidType,reason:'fixture'});
 detailDirectPlayReadyFor=()=>!!(state.detailPlayback&&state.detailPlayback.providerCommitted);
};
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
const testOutput = process.env.WEBHOME_TEST_REF ? execFileSync('git', ['show', process.env.WEBHOME_TEST_REF + ':index.html'], {encoding:'utf8',maxBuffer:4*1024*1024}) : output;
const html = testOutput.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
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



const controller=readFileSync(new URL('../../app/app/src/main/java/com/fongmi/android/tv/web/HomeWebController.java',import.meta.url),'utf8');
const expression=controller.match(/detailSession:(\(options\)=>[^\n]+)/)[1].trim().replace(/,$/,'');
const results=[];const leases=new Map();const closed=new Set();const calls=[];let rejectPlay=false;let playDelay=0;let responseDelay=0;
const historyA={key:'A@@@vod@@@7',vodName:'作品X',vodPic:'/poster.jpg',mediaType:'movie',tmdbId:42,position:90000,duration:500000,createTime:1000};
async function invoke(method,payload) {
 calls.push({method,payload:JSON.parse(JSON.stringify(payload))});
 if(method==='fixture.progress') {const lease=leases.get(payload.id);lease.history={...historyA,key:'push_agent@@@https://pan.quark.cn/s/B@@@7',vodFlag:'lineB',sourceBindingKey:'lineB#1',episodeUrl:'episodeB',position:50000,createTime:Date.now(),...payload.history};return true;}
 if(method!=='player.detailSession')throw Error('unexpected '+method);
 if(payload.operation==='close'){leases.delete(payload.sessionId);closed.add(payload.sessionId);return {version:1,closed:true};}
 if(payload.operation==='play') {
  await new Promise(r=>setTimeout(r,playDelay));if(rejectPlay)throw Error('fixture native rejection');if(closed.has(payload.sessionId))throw Error('closed lease');
  if(payload.resume&&!leases.get(payload.sessionId)?.history)throw Error('no owned resume');
  const old=leases.get(payload.sessionId);leases.set(payload.sessionId,{...old,id:payload.sessionId,mediaKey:payload.mediaKey,requestId:payload.requestId,route:payload.resume?old.route:payload.route,history:payload.resume?old.history:null});
 }
 const lease=leases.get(payload.sessionId);if(!lease)throw Error('missing native lease');
 const receipt={version:1,sessionId:lease.id,mediaKey:lease.mediaKey,requestId:lease.requestId,route:lease.route,accepted:true,actualPlayback:'UNKNOWN',canResume:!!lease.history,history:lease.history};
 if(payload.operation==='play')await new Promise(r=>setTimeout(r,responseDelay));
 return receipt;
}
async function detailPage(tv=true) {
 const p=await pageAt(tv);await p.exposeFunction('fixtureInvoke',invoke);
 await p.evaluate(({expression,historyA})=>{
  testBrowse.configureSession();testBrowse.disableTracking();
  const original=testBrowse.sdk();window.legacyPlays=0;
  window.fm=Object.assign({},original,{detailSession:new Function('invoke','return ('+expression+')')(window.fixtureInvoke),history:async()=>[historyA],pan:Object.assign({},original.pan,{play:()=>legacyPlays++}),vod:()=>legacyPlays++});
  testBrowse.state.recent.loaded=true;testBrowse.state.recent.items=testBrowse.normalizeHistoryList([historyA]);testBrowse.state.recent.detailItems=testBrowse.state.recent.items;
 },{expression,historyA});return p;
}
const item={id:42,tmdbId:42,title:'作品X',mediaType:'movie',source:'tmdb',pic:'/poster.jpg',releaseDate:'2020-01-01'};
async function open(p,selected=item,options={}){await p.evaluate(({selected,options})=>testBrowse.openDetail(selected,options),{selected,options});await p.waitForFunction(()=>testBrowse.state.detailPlayback?.providerCommitted);}
async function mark(name,p){results.push(name);console.log(name+' = PASS');if(p)await p.close();}
async function checks(){
 let emptyPage=await detailPage();await emptyPage.evaluate(()=>{testBrowse.state.recent.items=[];testBrowse.state.recent.detailItems=[];window.fm.history=async()=>[];});await open(emptyPage);assert.equal(await emptyPage.evaluate(()=>providerCalls.length),2);await mark('S01_NO_HISTORY_FRESH_PREPARATION',emptyPage);
 let p=await detailPage();await open(p);
 assert.equal(await p.evaluate(()=>testBrowse.state.detailMode),'FIRST_PLAY');assert.equal(await p.evaluate(()=>providerCalls.length),2);
 assert.equal(await p.evaluate(()=>testBrowse.state.detailPlayback.providerCommitCount),1);await mark('S01_S02_S03_FRESH_RACE_WITH_OLD_A',null);
 const playStart=calls.filter(c=>c.payload.operation==='play').length;
 await p.evaluate(()=>Promise.all([testBrowse.requestDetailPlayback(testBrowse.state.selected),testBrowse.requestDetailPlayback(testBrowse.state.selected)]));
 await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='ACCEPTED');
 assert.equal(calls.filter(c=>c.payload.operation==='play').length-playStart,1);assert.equal(await p.evaluate(()=>legacyPlays),0);
 const id=await p.evaluate(()=>testBrowse.state.detailSession.id);assert.equal(calls.at(-1).payload.route.vodId,'https://pan.quark.cn/s/B');
 const preparations=await p.evaluate(()=>providerCalls.length);await invoke('fixture.progress',{id});
 await p.evaluate(()=>testBrowse.restoreDetailSessionAfterPlayerReturn(testBrowse.state.selected));
 assert.equal(await p.evaluate(()=>testBrowse.state.detailMode),'CONTINUE');assert.equal(await p.evaluate(()=>providerCalls.length),preparations);
 const replayStart=calls.filter(c=>c.payload.operation==='play').length;
 await p.evaluate(()=>Promise.all([testBrowse.requestDetailPlayback(testBrowse.state.selected),testBrowse.requestDetailPlayback(testBrowse.state.selected)]));
 await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='ACCEPTED');
 assert.equal(calls.filter(c=>c.payload.operation==='play').length-replayStart,1);assert.equal(calls.filter(c=>c.payload.operation==='play').at(-1).payload.resume,true);
 await mark('S04_S05_S06_S13_B_RETURN_PROGRESS_AND_IDEMPOTENT_REPLAY',null);
 const snapshot=await p.evaluate(()=>testBrowse.buildUiSnapshot());
 await p.reload();await p.evaluate(({expression})=>{testBrowse.configureSession();testBrowse.disableTracking();window.fm=Object.assign({},testBrowse.sdk(),{detailSession:new Function('invoke','return ('+expression+')')(window.fixtureInvoke),history:async()=>[]});},{expression});
 await p.evaluate(snapshot=>testBrowse.openDetail(snapshot.selected,{restore:true,skipHistory:true,playerReturnRestore:true,detailSessionReturn:snapshot.detailSessionReturn}),snapshot);
 await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='RETURNED');assert.equal(await p.evaluate(()=>providerCalls.length),0);assert.equal(await p.evaluate(()=>testBrowse.state.detailSession.id),id);
 await mark('S14_WEBVIEW_RELOAD_NATIVE_LEASE_VALIDATED',null);
 await p.evaluate(()=>testBrowse.closeDetail(true));await p.waitForTimeout(260);await open(p);
 assert.notEqual(await p.evaluate(()=>testBrowse.state.detailSession.id),id);assert.equal(await p.evaluate(()=>providerCalls.length),2,JSON.stringify(await p.evaluate(()=>providerCalls)));assert.equal(leases.has(id),false);
 await mark('S07_S25_CLOSE_REOPEN_NEW_PREPARATION_PRESERVES_NATIVE_HISTORY',p);
 p=await detailPage();await p.evaluate(()=>{curatedDelay=130;directDelay=150;testBrowse.openDetail({id:1,tmdbId:1,mediaType:'movie',source:'tmdb',title:'旧作品',releaseDate:'2020-01-01'});testBrowse.closeDetail(true);testBrowse.closeDetail(true);curatedDelay=10;directDelay=20;testBrowse.openDetail({id:2,tmdbId:2,mediaType:'movie',source:'tmdb',title:'新作品',releaseDate:'2020-01-01'});});await p.waitForTimeout(280);
 assert.equal(await p.evaluate(()=>testBrowse.state.selected.title),'新作品');assert.equal(await p.locator('#detailSheet').evaluate(e=>e.classList.contains('active')),true);assert.equal(await p.evaluate(()=>testBrowse.state.detailPlayback.item.tmdbId),2);
 await mark('S08_S09_LATE_A_AND_REPEAT_CLOSE_DO_NOT_OVERWRITE_B',p);
 p=await detailPage();await p.evaluate(()=>{directDelay=0;curatedDelay=70;});await open(p);await p.waitForTimeout(90);
 assert.equal(await p.evaluate(()=>testBrowse.state.detailPlayback.provider),'pan-direct');assert.equal(await p.evaluate(()=>testBrowse.state.detailPlayback.providerCommitCount),1);
 await mark('S10_DIRECT_FIRST_SINGLE_COMMIT',p);
 p=await detailPage();await open(p);const failedId=await p.evaluate(()=>testBrowse.state.detailSession.id);const badStart=calls.filter(c=>c.payload.operation==='play').length;await p.evaluate(()=>{testBrowse.state.detailPlayback.candidate.bad=true;testBrowse.requestDetailPlayback(testBrowse.state.selected);});await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='FAILED');assert.equal(calls.filter(c=>c.payload.operation==='play').length,badStart);
 await p.evaluate(()=>{fixtureCandidate.url='https://pan.quark.cn/s/C';return testBrowse.requestDetailPlayback(testBrowse.state.selected);});await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='ACCEPTED');assert.notEqual(await p.evaluate(()=>testBrowse.state.detailSession.id),failedId);assert.equal(calls.filter(c=>c.payload.operation==='play').at(-1).payload.route.vodId,'https://pan.quark.cn/s/C');
 await mark('S11_S26_BAD_CACHE_REJECTED_EXPLICIT_FRESH_RETRY',p);
 p=await detailPage();await open(p);const staleStart=calls.filter(c=>c.payload.operation==='play').length;await p.evaluate(()=>{const candidate=testBrowse.state.detailPlayback.candidate;const key=panHealthKey(candidate);testBrowse.state.pan.health[key]={state:'ok',checkedAt:Date.now(),expiresAt:Date.now()+300000};candidate.bad=true;return testBrowse.requestDetailPlayback(testBrowse.state.selected);});await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='FAILED');assert.equal(calls.filter(c=>c.payload.operation==='play').length,staleStart);await mark('S27_FRESH_BAD_PREFLIGHT_OVERRIDES_CACHED_OK',p);
 p=await detailPage();await open(p);rejectPlay=true;await p.evaluate(()=>testBrowse.requestDetailPlayback(testBrowse.state.selected));await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='FAILED');rejectPlay=false;
 assert.equal(await p.evaluate(()=>testBrowse.state.detailSession.accepted),false);assert.equal(await p.evaluate(()=>localStorage.getItem('fm_pan_playing')),null);
 await mark('S12_REJECTED_HANDOFF_NOT_SUCCESS',p);
 for(const invalid of ['expired','wrong-work','corrupt','lease-missing']) {p=await detailPage();await p.evaluate(({item,invalid})=>{const saved={version:1,id:'session_corrupt',requestId:'request_corrupt',itemKey:[item.mediaType,item.tmdbId,item.title].join('|'),expiresAt:Date.now()+100000,returnIntent:'native-player',candidate:{url:'https://pan.quark.cn/s/B',diskType:'quark'}};if(invalid==='expired')saved.expiresAt=Date.now()-1;if(invalid==='wrong-work')saved.itemKey='wrong';if(invalid==='corrupt')saved.id='!';testBrowse.openDetail(item,{restore:true,playerReturnRestore:true,detailSessionReturn:saved});},{item,invalid});await p.waitForFunction(()=>testBrowse.state.detailPlayback?.providerCommitted);assert.equal(await p.evaluate(()=>testBrowse.state.detailSession.phase),'READY');await p.close();}
 await mark('S15_CORRUPT_EXPIRED_WRONG_WORK_RETURN_REJECTED',null);
 p=await detailPage();await open(p);const before=await p.evaluate(()=>testBrowse.state.detailSession.id);await p.evaluate(()=>testBrowse.reconcileDetailAfterNativeReturn(testBrowse.state.selected,'native-search'));assert.equal(await p.evaluate(()=>testBrowse.state.detailSession.id),before);assert.equal(await p.evaluate(()=>testBrowse.state.detailPlayback.provider),'curated');
 await p.evaluate(()=>testBrowse.setDetailPlaybackTarget(testBrowse.state.selected,{seasonNumber:2,episodeNumber:4,flag:'line2',episodeTitle:'第4集'}));await p.waitForFunction(()=>testBrowse.state.detailPlayback?.providerCommitted);
 assert.notEqual(await p.evaluate(()=>testBrowse.state.detailSession.id),before);assert.equal(await p.evaluate(()=>testBrowse.state.detailSession.target.episodeNumber),4);
 await mark('S18_S20_SEARCH_ISOLATION_TARGET_GENERATION',p);
 p=await detailPage();await open(p);await p.evaluate(()=>{delete window.fm.detailSession;});await p.evaluate(()=>testBrowse.requestDetailPlayback(testBrowse.state.selected));await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='FAILED');assert.equal(await p.evaluate(()=>legacyPlays),0);await mark('S24_OLD_SDK_SAFE_REFUSAL',p);
 p=await detailPage();await open(p);responseDelay=500;await p.evaluate(()=>{testBrowse.requestDetailPlayback(testBrowse.state.selected);});await p.waitForTimeout(80);const delayedId=await p.evaluate(()=>testBrowse.state.detailSession.id);await invoke('fixture.progress',{id:delayedId});await p.evaluate(()=>testBrowse.restoreDetailSessionAfterPlayerReturn(testBrowse.state.selected));await p.waitForTimeout(600);responseDelay=0;assert.equal(await p.evaluate(()=>testBrowse.state.detailSession.phase),'RETURNED');assert.equal(await p.evaluate(()=>testBrowse.state.detailSession.canResume),true);await mark('S13_LATE_ACCEPTANCE_CANNOT_OVERWRITE_RETURN',p);
 p=await detailPage();await open(p);const repeatStart=calls.filter(c=>c.payload.operation==='play').length;await p.locator('#detailContinueBtn').focus();await p.keyboard.down('Enter');await p.keyboard.down('Enter');await p.keyboard.down('Enter');await p.keyboard.up('Enter');await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='ACCEPTED');assert.equal(calls.filter(c=>c.payload.operation==='play').length-repeatStart,1);await mark('S21_HELD_CONFIRM_ONE_HANDOFF',p);
 p=await detailPage();await open(p);await p.evaluate(()=>testBrowse.requestDetailPlayback(testBrowse.state.selected));await p.waitForFunction(()=>testBrowse.state.detailSession.phase==='ACCEPTED');const badSnapshot=await p.evaluate(()=>testBrowse.buildUiSnapshot());badSnapshot.detailSessionReturn.candidate.url='https://pan.quark.cn/s/WRONG';badSnapshot.detailSessionReturn.candidate.normalizedUrl='https://pan.quark.cn/s/WRONG';await p.reload();await p.evaluate(({expression,badSnapshot})=>{testBrowse.configureSession();testBrowse.disableTracking();window.fm=Object.assign({},testBrowse.sdk(),{detailSession:new Function('invoke','return ('+expression+')')(window.fixtureInvoke),history:async()=>[]});testBrowse.openDetail(badSnapshot.selected,{restore:true,skipHistory:true,playerReturnRestore:true,detailSessionReturn:badSnapshot.detailSessionReturn});},{expression,badSnapshot});await p.waitForFunction(()=>testBrowse.state.detailPlayback?.providerCommitted);assert.notEqual(await p.evaluate(()=>testBrowse.state.detailSession.id),badSnapshot.detailSessionReturn.id);await mark('S15_SOURCE_BINDING_MISMATCH_REJECTED',p);
 p=await detailPage();await open(p);await p.waitForTimeout(100);await p.evaluate(()=>{const sheet=document.querySelector('#detailSheet');const filler=document.createElement('div');filler.style.height='1600px';sheet.appendChild(filler);sheet.scrollTop=80;document.querySelector('#detailContinueBtn').focus({preventScroll:true});testBrowse.rememberDetailReturn(document.activeElement);sheet.scrollTop=0;testBrowse.restoreDetailReturn();});await p.waitForTimeout(260);assert.equal(await p.evaluate(()=>document.querySelector('#detailSheet').scrollTop),80);assert.equal(await p.evaluate(()=>document.activeElement.id),'detailContinueBtn');await mark('S22_TV_DETAIL_SCROLL_FOCUS_RESTORE',p);
 p=await detailPage(false);await open(p);assert.equal(await p.locator('#detailSheet').evaluate(e=>e.classList.contains('active')),true);await p.evaluate(()=>testBrowse.closeDetail(true));await p.waitForTimeout(260);assert.equal(await p.evaluate(()=>testBrowse.state.detailSession),null);await mark('S23_MOBILE_DETAIL_LIFETIME',p);
}
try{await checks();assert.deepEqual(errors,[]);console.log('D_SESSION_CHROMIUM = PASS; TCL_REAL_DEVICE = PENDING');}finally{await browser.close();}
