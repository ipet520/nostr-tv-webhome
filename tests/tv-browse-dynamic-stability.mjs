import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { renderIndex } from '../scripts/build-core.mjs';

const require = createRequire(import.meta.url);
const playwright = require(process.env.WEBHOME_PLAYWRIGHT_PATH || join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const baseline = '3dc5c418814cb67ef4e33fffe9b589ef6e7384fd';
const hookSource = readFileSync(new URL('./tv-layout-coordination.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const hook = hookSource.slice(hookSource.indexOf('const hook = `') + 14, hookSource.indexOf('`;\nconst html'));
assert.ok(hook.includes('window.testBrowse.seed'), 'reuse real application fixture exports');
const instrument = `
window.metrics = { calls: {}, trace: [], paints: [] };
for (const name of ['renderTvBrowse', 'layoutTvBrowse', 'mediaCard', 'observeHomeImages', 'observeTvCardEnrichment', 'observeMovieCardEnrichment', 'tvBrowsePreview']) {
  const original = eval(name);
  const wrapped = function(...args) {
    const at = performance.now();
    try { return original.apply(this, args); }
    finally { const m = window.metrics.calls[name] || (window.metrics.calls[name] = {count:0,ms:0}); m.count++; m.ms += performance.now() - at; }
  };
  eval(name + ' = wrapped');
}
testBrowse.renderTvBrowse = renderTvBrowse;
testBrowse.readRect = () => {
  const rect = e => { const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}; };
  const rail=document.querySelector('#tvBrowseRail'),card=rail.firstElementChild;
  return {t:performance.now(),column:tvBrowseState().column,view:tvBrowseState().view,filter:tvBrowseState().filterOpen,
    viewport: {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualHeight:visualViewport.height,visualWidth:visualViewport.width,visualScale:visualViewport.scale},
    rail:rect(rail),poster:card?rect(card.querySelector('.poster-wrap')):null,title:card?rect(card.querySelector('.card-title')):null,
    resume:rect(document.querySelector('#tvHistoryResume')),overview:rect(document.querySelector('#tvBrowseFilterOverview')),
    feedback:rect(document.querySelector('.tv-browse-feedback')),feedbackHidden:document.querySelector('.tv-browse-feedback').hidden,
    info:rect(document.querySelector('#tvBrowseInfo')),columns:rect(document.querySelector('#tvBrowseColumns')),
    filters:rect(document.querySelector('#tvBrowseFilters')),scrollY,railScroll:rail.scrollLeft,root:rect(document.querySelector('#tvBrowse')),
    active:document.activeElement.id||document.activeElement.dataset.mediaKey||'',cardTransform:card?getComputedStyle(card).transform:null,query:rail.dataset.queryKey};
};
`;
const replaceBoot = output => output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook + instrument);
const outputs = { before: replaceBoot(execFileSync('git', ['show', baseline + ':index.html'], {encoding:'utf8',maxBuffer:4*1024*1024})), after: replaceBoot(renderIndex().output) };
const artifactDir = process.env.WEBHOME_VISUAL_DIR;
if (artifactDir) mkdirSync(artifactDir,{recursive:true});
const browser = await playwright.chromium.launch({headless:true,...(process.env.WEBHOME_BROWSER_EXECUTABLE?{executablePath:process.env.WEBHOME_BROWSER_EXECUTABLE}:{channel:process.env.WEBHOME_BROWSER_CHANNEL||'chrome'})});
const report = {kind:'CHROMIUM_SIMULATION',baseline,results:[],performance:[],errors:[]};
const check = process.env.WEBHOME_MEASURE_ONLY !== '1';
let requests = [];
async function pageAt(version, viewport, cold=false) {
  const p = await browser.newPage({viewport});
  p.on('pageerror',e=>report.errors.push(e.message));
  await p.route('**/*',async route=>{
    const url=route.request().url();
    if(new URL(url).origin==='http://fixture.local' && new URL(url).pathname==='/') return route.fulfill({contentType:'text/html',body:outputs[version]});
    if(route.request().resourceType()==='image') return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#274538"/></svg>'});
    if(url.includes('/tmdb/')||url.includes('api.themoviedb.org')) {
      requests.push(url);
      await new Promise(r=>setTimeout(r,url.includes('discover/tv')?120:70));
      const tv=url.includes('/tv');
      return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id:123,overview:'异步补全简介',total_pages:1,results:Array.from({length:20},(_,i)=>({id:(tv?500:200)+i,title:'影片'+i,name:'剧集'+i,poster_path:'/poster.jpg',backdrop_path:'/backdrop.jpg',release_date:'2025-01-01',first_air_date:'2025-01-01'}))})});
    }
    return route.abort();
  });
  await p.goto('http://fixture.local/?_tv=1');
  await p.evaluate(cold=>{
    const a=testBrowse;a.state.previewMode=true;document.documentElement.classList.add('tv-preview','tv-mode');
    WEBHOME_CONFIG.tmdb.apiBase='http://fixture.local/tmdb';WEBHOME_CONFIG.tmdb.apiKey='fixture';
    a.state.hot.ready=!cold;a.state.hot.items=[];a.state.recent.loaded=true;a.state.recent.items=[];
    a.setup();a.tvBrowseBeginStartup(a.homeFocusUserEpoch());
  },cold);
  return p;
}
const pause = (p,ms=100) => p.waitForTimeout(ms);
async function geometry(version,viewport,host=false){
 const p=await pageAt(version,viewport);await pause(p);
 if(host){await p.evaluate(()=>document.documentElement.style.setProperty('--fm-web-height',innerHeight*.84+'px'));await pause(p);}
 await p.evaluate(()=>{const q=testBrowse.seed('movie',20);q.hasMore=false;q.items.forEach(x=>x.overview='当前影片简介用于观察下方留白。'.repeat(6));testBrowse.tvBrowseSelectColumn('movie');});
 await p.locator('#tvBrowseRail .card').first().focus();await pause(p,300);
 const home=await p.evaluate(()=>testBrowse.readRect());
 if(artifactDir)await p.screenshot({path:join(artifactDir,`${viewport.width}x${viewport.height}${host?'-host':''}-home-${version}.png`)});
 await p.locator('#tvColumn-movie').focus();await p.keyboard.press('Enter');await p.keyboard.press('Enter');
 await p.locator('#tvBrowseRail .card').first().focus();await pause(p,300);
 const filter=await p.evaluate(()=>testBrowse.readRect());
 if(artifactDir)await p.screenshot({path:join(artifactDir,`${viewport.width}x${viewport.height}${host?'-host':''}-filter-${version}.png`)});
 assert.equal(await p.locator('#tvBrowseColumns').isVisible(),false);
 assert.equal(await p.locator('#tvBrowseInfo').isVisible(),false);
 await p.keyboard.press('ArrowUp');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#tvBrowseFilters')),true);
 await p.keyboard.press('Escape');await pause(p);
 const closed=await p.evaluate(()=>testBrowse.readRect());
 assert.deepEqual(closed.rail,home.rail,'filter close preserves baseline');
 await p.evaluate(()=>{testBrowse.disableTracking();window.fm=Object.assign({},testBrowse.sdk(),{history:async()=>Array.from({length:12},(_,i)=>({key:'fixture@@@history'+i+'@@@1',vodName:'历史影片'+i,vodPic:'/poster.jpg',position:360000,duration:720000,episodeName:'第47集',createTime:Date.now()-i}))});testBrowse.state.recent.loaded=false;});
 await p.locator('#tvFunction-history').click();await p.waitForFunction(()=>document.querySelectorAll('#tvBrowseRail .card').length===12&&!testBrowse.state.recent.loading);
 await p.locator('#tvBrowseRail .card').first().focus();await pause(p,300);
 const history=await p.evaluate(()=>testBrowse.readRect());
 if(artifactDir)await p.screenshot({path:join(artifactDir,`${viewport.width}x${viewport.height}${host?'-host':''}-history-${version}.png`)});
 assert.deepEqual(history.rail,home.rail,'history baseline matches Home');
 await p.keyboard.press('ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.id),'tvHistoryContinue');
 await p.keyboard.press('Escape');await pause(p);
 assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().view),'home');
 if(version==='after'&&check){
   const focusTop=home.poster.y;
   assert.ok(focusTop-history.resume.bottom>=Math.min(12,home.root.height*.025),'history breathes above focused poster');
   if(viewport.height>=450)assert.ok(focusTop-filter.overview.bottom>=home.root.height*.025,'filter synopsis breathes above focused poster');
   assert.ok(history.resume.y>history.info.bottom,'continue follows synopsis');
 }
 report.results.push({version,viewport,host,home,filter,history});await p.close();
}
async function coldStart(version,viewport,iteration){
 const p=await pageAt(version,viewport,true);
 await p.evaluate(()=>{window.samples=[];window.sampling=true;const sample=()=>{if(!sampling)return;samples.push(testBrowse.readRect());requestAnimationFrame(sample);};requestAnimationFrame(sample);});
 await pause(p,120);
 await p.evaluate(()=>{testBrowse.state.hot.items=Array.from({length:18},(_,i)=>({id:i+10,tmdbId:i+10,title:'冷启动'+i,mediaType:'movie',source:'nostr-hot',pic:'/poster.jpg',overview:'资料逐步到达'}));testBrowse.state.hot.ready=true;testBrowse.renderTvBrowse();});
 await pause(p,120);
 await p.evaluate(()=>{testBrowse.state.hot.items.forEach(x=>x.overview='稍后补全的长简介'.repeat(50));testBrowse.renderTvBrowse();});
 await pause(p,120);
 // Page-one empty/loading and asynchronous results exercise the same status chain.
 await p.locator('#tvColumn-tv').focus();await pause(p,300);
 const trace=await p.evaluate(()=>{sampling=false;return samples;});
 const spread=Math.max(...trace.map(x=>x.rail.y))-Math.min(...trace.map(x=>x.rail.y));
 if(version==='after'&&check){assert.ok(spread<.1,`cold start rail displacement ${spread}`);assert.ok(trace.every(x=>x.scrollY===0),'not page scrolling');}
 report.results.push({version,viewport,coldIteration:iteration,spread,trace});await p.close();
}
async function performanceRun(version,count){
 const p=await pageAt(version,{width:1280,height:720});await pause(p,200);
 const cdp=await p.context().newCDPSession(p);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Performance.enable');
 await p.evaluate(count=>{for(const id of ['movie','tv','anime','documentary','variety']){const q=testBrowse.seed(id,count);q.hasMore=false;q.items.forEach(x=>x.mediaType='other');}testBrowse.tvBrowseSelectColumn('movie');},count);await pause(p,250);
 requests=[];await p.evaluate(()=>metrics.calls={});
 const before=await cdp.send('Performance.getMetrics');
 const timings=[];
 for(let i=0;i<20;i++){
   const id=['tv','anime','documentary','variety','movie'][i%5];
   const timing=await p.evaluate(async id=>{
     const at=performance.now();document.querySelector('#tvColumn-'+id).focus();const focusMs=performance.now()-at;
     const firstFrame=await new Promise(r=>requestAnimationFrame(()=>r(performance.now()-at)));
     await new Promise(resolve=>{const poll=()=>{if(document.querySelector('#tvBrowseRail').dataset.queryKey===testBrowse.secondaryActiveQuery(id).key){resolve();return;}requestAnimationFrame(poll);};poll();});
     const contentMs=performance.now()-at;return {focusMs,firstFrame,contentMs,active:document.activeElement.id,column:testBrowse.tvBrowseState().column};
   },id);
   assert.equal(timing.column,id);assert.equal(timing.active,'tvColumn-'+id);timings.push(timing);await pause(p,35);
 }
 const after=await cdp.send('Performance.getMetrics');const metricsDelta={};
 for(const name of ['LayoutCount','LayoutDuration','RecalcStyleCount','RecalcStyleDuration','ScriptDuration'])metricsDelta[name]=after.metrics.find(x=>x.name===name).value-before.metrics.find(x=>x.name===name).value;
 const calls=await p.evaluate(()=>metrics.calls);
 await p.evaluate(()=>{
   metrics.input=[];
   document.addEventListener('keydown',e=>{
     if(!e.key.startsWith('Arrow'))return;
     const m={key:e.key,at:performance.now()};metrics.input.push(m);
     requestAnimationFrame(()=>{m.frameMs=performance.now()-m.at;m.target=document.activeElement.id;});
   },true);
   document.addEventListener('focusin',()=>{const m=metrics.input[metrics.input.length-1];if(m&&m.focusMs==null)m.focusMs=performance.now()-m.at;},true);
 });
 for(const key of ['ArrowRight','ArrowRight','ArrowRight','ArrowRight','ArrowLeft','ArrowLeft','ArrowLeft','ArrowLeft']){await p.keyboard.press(key);await pause(p,90);}
 const input=await p.evaluate(()=>metrics.input);
 // Multiple focus events before a frame must finish on the final selected query.
 await p.evaluate(()=>{for(const id of ['tv','anime','documentary','variety','movie'])document.querySelector('#tvColumn-'+id).focus();});await pause(p,200);
 assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),'movie');
 assert.equal(await p.evaluate(()=>document.querySelector('#tvBrowseRail').dataset.queryKey===testBrowse.secondaryActiveQuery('movie').key),true);
 report.performance.push({version,count,cpuRate:4,timings,input,metricsDelta,calls,requests:requests.length});await p.close();
}
async function switching(version){
 const p=await pageAt(version,{width:1280,height:720});await pause(p,150);
 await p.evaluate(()=>{for(const id of ['movie','tv','anime','documentary','variety']){const q=testBrowse.seed(id,180);q.hasMore=false;q.items.forEach(x=>x.mediaType='other');}testBrowse.tvBrowseSelectColumn('movie');metrics.calls={};});
 await p.evaluate(()=>{for(const id of ['tv','anime','documentary','variety'])document.querySelector('#tvColumn-'+id).focus();});await pause(p,150);
 const rapid=await p.evaluate(()=>({calls:metrics.calls,count:document.querySelector('#tvBrowseRail').children.length,query:document.querySelector('#tvBrowseRail').dataset.queryKey}));
 assert.equal(await p.evaluate(()=>document.querySelector('#tvBrowseRail').dataset.queryKey===testBrowse.secondaryActiveQuery('variety').key),true);
 if(version==='after'&&check){assert.equal(rapid.calls.mediaCard.count,18,'coalesced traversal only renders the final visible batch');assert.equal(rapid.count,18);}
 await p.evaluate(()=>testBrowse.tvBrowseSelectColumn('movie'));
 for(let i=0;i<65;i++)await p.locator('#tvBrowseRail .card').nth(i).focus();
 assert.equal(await p.evaluate(()=>document.activeElement.dataset.cardIndex),'64');
 assert.equal(await p.evaluate(()=>testBrowse.secondaryActiveQuery('movie').items.length),180,'DOM batching never truncates business data');
 const saved=await p.evaluate(()=>{const value=testBrowse.tvBrowseSnapshot();testBrowse.tvBrowseSelectColumn('tv');document.querySelector('#tvFunction-search').focus();testBrowse.restoreTvBrowseSnapshot(value);testBrowse.renderTvBrowse();testBrowse.tvBrowseFocusIntent();return value;});
 await pause(p,100);assert.equal(await p.evaluate(()=>document.activeElement.dataset.cardIndex),'64');
 // Down in the very same event turn must flush the current query, not use
 // cards from the previous column while the after-paint render is pending.
 await p.evaluate(()=>{document.querySelector('#tvColumn-tv').focus();document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true,cancelable:true}));});
 assert.equal(await p.evaluate(()=>document.querySelector('#tvBrowseRail').dataset.queryKey===testBrowse.secondaryActiveQuery('tv').key),true);
 assert.equal(await p.evaluate(()=>document.activeElement.closest('#tvBrowseRail')!==null),true);
 await p.evaluate(()=>{testBrowse.openSearchPage();testBrowse.closeSearchPage();});await pause(p,150);
 assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),'tv');
 // An obsolete response may fill its query cache, but cannot replace the
 // new selected column or its focus. Shared page-one requests stay unique.
 requests=[];
 await p.evaluate(()=>{for(const id of ['movie','tv']){const q=testBrowse.secondaryActiveQuery(id);q.loaded=false;q.loading=false;q.items=[];q.page=0;q.sourceStates=[];}document.querySelector('#tvColumn-movie').focus();});await pause(p,45);
 await p.locator('#tvColumn-tv').focus();await pause(p,45);await p.locator('#tvColumn-anime').focus();await pause(p,400);
 assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().column),'anime');
 assert.equal(await p.evaluate(()=>document.querySelector('#tvBrowseRail').dataset.queryKey===testBrowse.secondaryActiveQuery('anime').key),true);
 assert.equal(await p.evaluate(()=>document.activeElement.id),'tvColumn-anime');
 const discover=requests.filter(url=>url.includes('/discover/'));
 assert.equal(new Set(discover).size,discover.length,'no duplicate page-one network requests');
 report.results.push({version,rapid,savedIndex:saved.positions[Object.keys(saved.positions).find(k=>k.includes('movie'))]?.index,discoverRequests:discover.length});
 await p.close();
}
try{
 for(const version of ['before','after']){
   for(const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:1280,height:400}])await geometry(version,viewport);
   await geometry(version,{width:1280,height:400},true);
   for(let i=0;i<3;i++)await coldStart(version,{width:1280,height:720},i);
   for(const count of [20,180])await performanceRun(version,count);
   await switching(version);
 }
 if(check)for(const after of report.results.filter(x=>x.version==='after'&&x.home)){
   const before=report.results.find(x=>x.version==='before'&&x.home&&x.host===after.host&&x.viewport.width===after.viewport.width&&x.viewport.height===after.viewport.height);
   for(const field of ['info','columns','rail','poster','title'])assert.deepEqual(after.home[field],before.home[field],`normal Home ${field} must not change`);
 }
 assert.deepEqual(report.errors,[]);
 console.log(JSON.stringify({geometry:report.results.filter(x=>x.home).map(x=>({version:x.version,viewport:x.viewport,host:x.host,railY:x.home.rail.y,historyGap:x.home.poster.y-x.history.resume.bottom,filterGap:x.home.poster.y-x.filter.overview.bottom})),cold:report.results.filter(x=>x.trace).map(x=>({version:x.version,iteration:x.coldIteration,spread:x.spread})),performance:report.performance},null,2));
 console.log('TV_DYNAMIC_STABILITY = '+(check?'PASS':'MEASURE_ONLY')+'; REAL_TV = PENDING');
}finally{if(artifactDir)writeFileSync(join(artifactDir,'dynamic-stability.json'),JSON.stringify(report,null,2));await browser.close();}
