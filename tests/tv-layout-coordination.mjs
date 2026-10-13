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
const measurements=[];
const views=[{width:1920,height:1080},{width:1280,height:720},{width:960,height:540},{width:1728,height:894},{width:2048,height:930},{width:1280,height:400}];
async function measure(p){return p.evaluate(()=>{
 const root=document.querySelector('#tvBrowse'),rail=document.querySelector('#tvBrowseRail'),card=rail.firstElementChild;
 const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
 const get=s=>document.querySelector(s),cs=(e,pseudo)=>getComputedStyle(e,pseudo),cols=get('#tvBrowseColumns'),fg=get('.tv-browse-foreground'),fb=get('.tv-browse-feedback');
 const nodes={root,foreground:fg,info:get('#tvBrowseInfo'),columns:cols,filters:get('#tvBrowseFilters'),resume:get('#tvHistoryResume'),rail,card,poster:card.querySelector('.poster-wrap'),title:card.querySelector('.card-title'),feedback:fb};
 const vars=['safe-top','safe-bottom','rail-slot','focus-space','gap','column-space','column-font','column-pad-x','column-gap','poster-height','poster-width','rail-gap','filter-overview-lines'];
 const last=cols.lastElementChild,first=cols.firstElementChild;
 const intro=get('#tvBrowseFilterOverview');
 const titles=Array.from(rail.children).slice(0,6).map(c=>{const t=c.querySelector('.card-title'),b=c.querySelector('.card-body');const range=document.createRange();range.selectNodeContents(t);return {glyph:rect(range),text:t.textContent,card:rect(c),poster:rect(c.querySelector('.poster-wrap')),body:rect(b),title:rect(t),overflow:cs(t).overflow,whiteSpace:cs(t).whiteSpace,ellipsis:cs(t).textOverflow,align:cs(t).textAlign,scrollWidth:t.scrollWidth,clientWidth:t.clientWidth};});
 const filterRows=Array.from(get('#tvBrowseFilters').querySelectorAll('.secondary-filter-row')).map(e=>({rect:rect(e),margin:cs(e).marginBottom}));
 return {titles,filterRows,intro:intro?{rect:rect(intro),hidden:intro.hidden,text:intro.textContent,lines:cs(intro).webkitLineClamp}:null,railPadding:cs(rail).padding,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visual:{height:visualViewport.height,width:visualViewport.width,scale:visualViewport.scale}},visibleHeight:parseFloat(root.style.getPropertyValue('--tv-visible-height')),rects:Object.fromEntries(Object.entries(nodes).map(([k,e])=>[k,rect(e)])),vars:Object.fromEntries(vars.map(k=>[k,cs(root).getPropertyValue('--tv-'+k)])),rows:cs(fg).gridTemplateRows,feedbackHidden:fb.hidden,titleBottomSpace:root.getBoundingClientRect().bottom-card.querySelector('.card-title').getBoundingClientRect().bottom,column:{font:cs(first).fontSize,padding:cs(first).padding,gap:cs(cols).gap,contentWidth:last.getBoundingClientRect().right-first.getBoundingClientRect().left,background:cs(last).backgroundColor,line:{width:cs(get('#tvColumn-movie'),'::after').width}},filterFont:cs(get('#tvBrowseFilters')).getPropertyValue('--tv-filter-font'),railScroll:rail.scrollLeft,frame:cs(card.querySelector('.poster-wrap'),'::after').border,transform:cs(card).transform};
 });}
async function history(p){await p.evaluate(()=>{
 testBrowse.disableTracking();window.fm=Object.assign({},testBrowse.sdk(),{history:async()=>Array.from({length:12},(_,i)=>({key:'fixture@@@history'+i+'@@@1',vodName:i?'历史影片 '+i:'同一影视长标题用于省略验证',vodPic:'/poster.jpg',position:3608000,duration:7322000,episodeName:'第47集',createTime:Date.now()-i}))});testBrowse.state.recent.loaded=false;
 });await p.locator('#tvFunction-history').click();await p.waitForFunction(()=>!testBrowse.state.recent.loading&&document.querySelectorAll('#tvBrowseRail .card').length===12);}
async function run(viewport,baseline,host=false){
 const p=await pageAt(true,viewport,true,baseline);await p.waitForTimeout(200);
 if(host){await p.evaluate(()=>document.documentElement.style.setProperty('--fm-web-height',innerHeight*.84+'px'));await p.waitForTimeout(200);}
 await p.evaluate(()=>{const q=testBrowse.seed('movie',12);q.hasMore=false;q.items.forEach((x,i)=>{x.title=['短片','六至八字中文片名','这是超过十字的长中文影片标题需要省略','The Extraordinary Adventures of a Very Long English Title','中英文混合 Movie Title 2026','片名：带冒号和很长的副标题'][i%6];x.overview='这里是统一的影视简介，保持同一数据用于三个状态的布局比较。'.repeat(4);});testBrowse.tvBrowseSelectColumn('movie');});
 const states={};const save=async(name)=>{await p.locator(name==='history'?'#recentManageBtn':name==='filters'?'#tvBrowseFilters button >> nth=0':'#tvColumn-movie').focus();await p.waitForTimeout(300);const normal=await measure(p);await p.locator('#tvBrowseRail .card').first().focus();await p.waitForTimeout(300);states[name]=await measure(p);states[name].normal=normal;if(process.env.WEBHOME_VISUAL_DIR){await p.screenshot({path:join(process.env.WEBHOME_VISUAL_DIR,`${viewport.width}x${viewport.height}${host?'-host':''}-${name}-${baseline?'before':'after'}.png`)});if(name==='home'&&!host)await p.locator('#tvBrowseColumns').screenshot({path:join(process.env.WEBHOME_VISUAL_DIR,`${viewport.width}x${viewport.height}-columns-${baseline?'before':'after'}.png`)});}};
 await save('home');await p.locator('#tvColumn-movie').focus();await press(p,'Enter');await press(p,'Enter');await save('filters');
 assert.deepEqual(states.filters.rects.rail,states.home.rects.rail,'filter opening keeps rail stable');
 assert.equal(await p.locator('#tvBrowseColumns').isVisible(),false);assert.equal(await p.locator('#tvBrowseColumns button[tabindex="0"]').count(),0);
 await press(p,'ArrowUp');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#tvBrowseFilters')),true);
 await press(p,'Escape');await p.locator('#tvBrowseRail .card').first().focus();await p.waitForTimeout(300);assert.deepEqual((await measure(p)).rects.rail,states.home.rects.rail,'filter close keeps rail stable');
 await history(p);await save('history');
 for(const [state,m] of Object.entries(states)){
  if(!baseline&&!process.env.WEBHOME_MEASURE_ONLY){const r=m.rects;
   assert.ok(Math.abs(r.poster.width/r.poster.height-2/3)<.001);assert.ok(r.poster.y>=r.rail.y&&r.card.bottom<=r.rail.bottom+.1);assert.ok(r.title.bottom<r.root.bottom);assert.ok(m.frame.includes('2px solid rgba(255, 255, 255, 0.9)'));assert.ok(m.transform.includes('1.04'));
   if(state==='home')assert.ok(r.info.bottom<r.columns.y);
   if(state==='history')assert.ok(r.resume.bottom<=r.rail.y);
   if(state==='filters'){assert.ok(r.filters.bottom<=r.rail.y);assert.equal(m.filterRows.length,4);if(m.visibleHeight<450)assert.equal(m.intro.hidden,true);else{assert.equal(m.intro.hidden,false);assert.ok(m.intro.rect.y>=m.filterRows[3].rect.bottom&&m.intro.rect.bottom<=r.rail.y);}}
   for(const t of m.titles){assert.ok(t.title.x>=t.card.x-.1&&t.title.right<=t.card.right+.1);assert.ok(Math.abs((t.title.x+t.title.right)/2-(t.poster.x+t.poster.right)/2)<.15);assert.equal(t.align,'center');assert.equal(t.overflow,'hidden');assert.equal(t.ellipsis,'ellipsis');assert.equal(t.whiteSpace,'nowrap');if(t.scrollWidth<=t.clientWidth)assert.ok(Math.abs((t.glyph.x+t.glyph.right)/2-(t.poster.x+t.poster.right)/2)<.5,'actual short text glyphs center on their poster');}for(let i=1;i<m.titles.length;i++)assert.ok(m.titles[i-1].title.right<m.titles[i].title.x,'adjacent title bounds do not overlap');
   assert.ok(m.titleBottomSpace>=8,'visible title safety');if(viewport.width===1920)assert.ok(m.titleBottomSpace>=25&&m.titleBottomSpace<=35,'round 10 standard TV target');
  }
 }
 if(!baseline&&!process.env.WEBHOME_MEASURE_ONLY){
 const column=await p.locator('#tvColumn-movie').evaluate(e=>{const s=getComputedStyle(e,'::after');return [s.width,s.height,s.backgroundColor];});assert.deepEqual(column,['18px','2px','rgb(53, 224, 122)']);
 await press(p,'Escape');await p.evaluate(()=>{const q=testBrowse.seed('movie',12);q.hasMore=false;testBrowse.tvBrowseSelectColumn('movie');});await p.locator('#tvBrowseRail .card').first().focus();await p.waitForTimeout(300);
 const stable=await measure(p);
 await p.evaluate(()=>{const q=testBrowse.secondaryGetQuery('movie');q.error='受控错误提示';testBrowse.renderTvBrowse();});await p.waitForTimeout(300);
 assert.equal(await p.locator('.tv-browse-feedback').isVisible(),true);const warned=await measure(p);assert.ok(warned.rects.card.bottom<warned.rects.feedback.y);assert.equal(warned.rects.poster.height,stable.rects.poster.height);
 await p.evaluate(()=>{testBrowse.secondaryGetQuery('movie').error='';testBrowse.renderTvBrowse();});await p.waitForTimeout(300);assert.deepEqual((await measure(p)).rects.rail,stable.rects.rail);
 }
 measurements.push({viewport,host,version:baseline?'before':'after',states});await p.close();return states;
}
try{
 for(const v of views){const before=await run(v,true),after=await run(v,false);
  for(const name of ['home','history','filters']){if(!process.env.WEBHOME_MEASURE_ONLY){assert.ok(after[name].titleBottomSpace<=before[name].titleBottomSpace+.1,'reduce wasted lower space');assert.ok(Math.abs(after[name].rects.poster.height-before[name].rects.poster.height)<.1,'preserve poster dimensions');}}
  if(!process.env.WEBHOME_MEASURE_ONLY){assert.ok(parseFloat(after.home.column.font)<=24);assert.ok(parseFloat(after.home.column.font)>=16);assert.ok(after.home.column.contentWidth===before.home.column.contentWidth);assert.equal(after.filters.filterFont,before.filters.filterFont);}
  console.log(JSON.stringify({viewport:v,before:before.home.titleBottomSpace,after:after.home.titleBottomSpace,column:after.home.column}));
 }
 await run({width:1280,height:400},true,true);await run({width:1280,height:400},false,true);
 const p=await pageAt(true);await p.waitForTimeout(200);
 await p.evaluate(()=>{const q=testBrowse.seed('movie',12);q.hasMore=false;q.items.forEach((x,i)=>x.overview='当前影片简介 '+i);testBrowse.tvBrowseSelectColumn('movie');});
 await p.locator('#tvColumn-movie').focus();await press(p,'Enter');await press(p,'Enter');
 await p.locator('#tvBrowseRail .card').nth(1).focus();assert.equal(await p.locator('#tvBrowseFilterOverview').textContent(),'当前影片简介 1');await p.locator('#tvBrowseRail .card').first().focus();assert.equal(await p.locator('#tvBrowseFilterOverview').textContent(),'当前影片简介 0');
 const groups=await p.locator('#tvBrowseFilters .secondary-filter-row').evaluateAll(rows=>rows.map(e=>e.dataset.group));assert.equal(groups.length,4);
 for(const group of groups){
  const option=p.locator(`#tvBrowseFilters button[data-group="${group}"]`).nth(1);await option.focus();await press(p,'Enter');await p.waitForTimeout(150);
  const selected=p.locator(`#tvBrowseFilters button[data-group="${group}"][aria-pressed="true"]`);assert.equal(await selected.count(),1);
  await p.locator('#tvBrowseRail .card').first().focus();
  assert.deepEqual(await selected.evaluate(e=>{const s=getComputedStyle(e,'::after');return [s.width,s.height,s.backgroundColor];}),['18px','2px','rgb(53, 224, 122)']);
  await option.focus();await press(p,'Enter');await p.waitForTimeout(150);assert.equal(await option.getAttribute('aria-pressed'),'false','second confirm cancels chosen filter');
 }
 const saved=await p.evaluate(()=>JSON.stringify(testBrowse.state.homeV14.secondaryFilters));await press(p,'Escape');assert.equal(await p.evaluate(()=>JSON.stringify(testBrowse.state.homeV14.secondaryFilters)),saved);
 await p.locator('#tvColumn-movie').focus();await press(p,'Enter');await press(p,'Enter');
 const rail=await p.locator('#tvBrowseRail').boundingBox();await p.evaluate(()=>testBrowse.tvBrowsePreview({title:'没有简介',mediaType:'other',id:'empty-description'}));
 assert.equal(await p.locator('#tvBrowseFilterOverview').isVisible(),false);assert.deepEqual(await p.locator('#tvBrowseRail').boundingBox(),rail);
 await p.close();console.log('FOUR_FILTER_GREEN_SELECT_CANCEL_BLUR_RETURN_EMPTY_SYNOPSIS = PASS');
 assert.deepEqual(errors,[]);console.log('TV_LAYOUT_COORDINATION = PASS; ANDROID_DEVICE = NOT_RUN');
}finally{if(process.env.WEBHOME_VISUAL_DIR)writeFileSync(join(process.env.WEBHOME_VISUAL_DIR,'layout-geometry.json'),JSON.stringify(measurements,null,2));await browser.close();}
