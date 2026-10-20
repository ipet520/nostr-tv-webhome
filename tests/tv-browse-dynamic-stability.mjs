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
  const rail=document.querySelector('#tvBrowseRail'),card=rail.querySelector('.card');
  return {t:performance.now(),column:tvBrowseState().column,view:tvBrowseState().view,filter:tvBrowseState().filterOpen,
    viewport: {width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visualHeight:visualViewport.height,visualWidth:visualViewport.width,visualScale:visualViewport.scale},
    rail:rect(rail),poster:card?rect(card.querySelector('.poster-wrap')):null,title:card?rect(card.querySelector('.card-title')):null,
    resume:rect(document.querySelector('#tvHistoryResume')),overview:rect(document.querySelector('#tvBrowseFilterOverview')),
    feedback:rect(document.querySelector('.tv-browse-feedback')),feedbackHidden:document.querySelector('.tv-browse-feedback').hidden,
    info:rect(document.querySelector('#tvBrowseInfo')),columns:rect(document.querySelector('#tvBrowseColumns')),
    columnPill:rect(document.querySelector('#tvColumn-'+testBrowse.tvBrowseState().column)),
    filters:rect(document.querySelector('#tvBrowseFilters')),scrollY,railScroll:testBrowse.railPosition(rail),nativeRailScroll:rail.scrollLeft,root:rect(document.querySelector('#tvBrowse')),
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
 if(version==='after'&&check){
   const pillSizes=await p.locator('#tvColumn-movie').evaluate(button=>{
     const size=()=>{const rect=button.getBoundingClientRect();return {width:rect.width,height:rect.height};};
     const normal=size();button.focus();const focused=size();return {normal,focused};
   });
   assert.deepEqual(pillSizes.focused,pillSizes.normal,'selected category pill keeps the same dimensions when focused');
   await p.locator('#tvBrowseRail .card').first().focus();await pause(p,200);
 }
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
 const rapid=await p.evaluate(()=>({calls:metrics.calls,count:document.querySelectorAll('#tvBrowseRail .card').length,query:document.querySelector('#tvBrowseRail').dataset.queryKey}));
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
async function railMotionStability(){
 const p=await pageAt('after',{width:1280,height:720});await pause(p,120);
 await p.evaluate(()=>{
   const q=testBrowse.seed('movie',50);q.hasMore=false;
   q.items=q.items.map((item,index)=>Object.assign(item,{mediaType:'other',source:'fixture',pic:'/motion-poster-'+index+'.jpg'}));
   testBrowse.tvBrowseSelectColumn('movie');
 });
 await p.waitForFunction(()=>document.querySelectorAll('#tvBrowseRail .tv-browse-rail-track > .card').length>=18);
 await p.evaluate(()=>{
   const rail=document.querySelector('#tvBrowseRail'),cards=testBrowse.railCards(rail);
   testBrowse.setRailPosition(rail,0);
   testBrowse.focusRemoteTarget(cards[0]);
   for(let index=1;index<=8;index++)testBrowse.focusRemoteTarget(cards[index]);
   const active=document.activeElement,expectedTarget=testBrowse.tvBrowseState().railScroll.target;
   const started=performance.now();window.railMotionTrace=[];window.railMotionDone=false;
   const sample=()=>{
     const railRect=rail.getBoundingClientRect(),cardRect=active.getBoundingClientRect(),style=getComputedStyle(rail);
     const center=railRect.left+rail.clientLeft+(parseFloat(style.paddingLeft)||0)
       +(rail.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0))/2;
     window.railMotionTrace.push({at:performance.now()-started,scroll:testBrowse.railPosition(rail),actualScrollLeft:rail.scrollLeft,error:cardRect.left+cardRect.width/2-center,
       frame:!!testBrowse.tvBrowseState().railScroll.frame,transform:getComputedStyle(active).transform,spatial:rail.classList.contains('tv-browse-spatial-focus')});
     if(testBrowse.tvBrowseState().railScroll.frame||performance.now()-started<260)requestAnimationFrame(sample);
     else window.railMotionDone=true;
   };
   window.railMotionExpectedTarget=expectedTarget;requestAnimationFrame(sample);
 });
 await p.waitForFunction(()=>window.railMotionDone,{},{timeout:1200});
 const motion=await p.evaluate(()=>({trace:window.railMotionTrace,expected:window.railMotionExpectedTarget,
   focusedIndex:Number(document.activeElement.dataset.cardIndex),running:!!testBrowse.tvBrowseState().railScroll.frame}));
 const trace=motion.trace,scroll=trace.map(sample=>sample.scroll),last=trace.slice(-6),firstMoved=trace.find(sample=>Math.abs(sample.scroll)>.5);
 assert.equal(motion.focusedIndex,8,'the real focused card remains the selected navigation target');
 assert.ok(firstMoved&&firstMoved.at<=80,'the rail begins following the new target within the immediate animation frames');
 assert.ok(scroll.every((value,index)=>!index||value>=scroll[index-1]-1.25),'rightward anchor motion never corrects back toward an older target');
 assert.ok(Math.abs(scroll.at(-1)-motion.expected)<=1.25,'the latest target is reached without a corrective second anchor');
 assert.ok(Math.abs(trace.at(-1).error)<=2,'the focused card settles on the visual center anchor');
 assert.ok(trace.every(sample=>sample.actualScrollLeft===0),'B Transform never lets native scrollLeft compete with its logical position');
 assert.ok(Math.max(...last.map(sample=>sample.scroll))-Math.min(...last.map(sample=>sample.scroll))<=.5,'the settled rail does not micro-jitter');
 const focusScales=trace.map(sample=>{const match=sample.transform.match(/^matrix\(([^,]+)/);return match?Number(match[1]):sample.transform==='none'?1:NaN;});
 assert.ok(focusScales.every(scale=>Number.isFinite(scale)&&scale>=.999&&scale<=1.041),'ordinary B focus scaling stays within the existing 1.04 limit');
 assert.ok(focusScales.some(scale=>scale>1.001),'the actual focused card keeps the ordinary CSS focus scale while the rail moves');
 assert.ok(trace.every(sample=>!sample.spatial),'B does not run a second spatial focus visual controller');
 assert.equal(motion.running,false,'only one coalesced animation remains and it is cleared at rest');
 await p.evaluate(()=>{
   const rail=document.querySelector('#tvBrowseRail'),cards=testBrowse.railCards(rail);
   testBrowse.focusRemoteTarget(cards[7]);testBrowse.focusRemoteTarget(cards[6]);testBrowse.focusRemoteTarget(cards[5]);
   const active=document.activeElement,expectedTarget=testBrowse.tvBrowseState().railScroll.target;
   const started=performance.now();window.reverseMotionTrace=[];window.reverseMotionDone=false;
   const sample=()=>{
     const railRect=rail.getBoundingClientRect(),cardRect=active.getBoundingClientRect(),style=getComputedStyle(rail);
     const center=railRect.left+rail.clientLeft+(parseFloat(style.paddingLeft)||0)
       +(rail.clientWidth-(parseFloat(style.paddingLeft)||0)-(parseFloat(style.paddingRight)||0))/2;
     window.reverseMotionTrace.push({at:performance.now()-started,scroll:testBrowse.railPosition(rail),actualScrollLeft:rail.scrollLeft,error:cardRect.left+cardRect.width/2-center,
       frame:!!testBrowse.tvBrowseState().railScroll.frame});
     if(testBrowse.tvBrowseState().railScroll.frame||performance.now()-started<260)requestAnimationFrame(sample);
     else window.reverseMotionDone=true;
   };
   window.reverseMotionExpectedTarget=expectedTarget;requestAnimationFrame(sample);
 });
 await p.waitForFunction(()=>window.reverseMotionDone,{},{timeout:1200});
 const reverse=await p.evaluate(()=>({trace:window.reverseMotionTrace,expected:window.reverseMotionExpectedTarget,
   focusedIndex:Number(document.activeElement.dataset.cardIndex)}));
 const reverseTrace=reverse.trace,reverseScroll=reverseTrace.map(sample=>sample.scroll),reverseLast=reverseTrace.slice(-6);
 assert.equal(reverse.focusedIndex,5,'reverse input immediately selects the latest leftward card');
 assert.ok(reverseScroll.every((value,index)=>!index||value<=reverseScroll[index-1]+1.25),'leftward anchor motion does not jump back toward the previous rightward target');
 assert.ok(Math.abs(reverseScroll.at(-1)-reverse.expected)<=1.25&&Math.abs(reverseTrace.at(-1).error)<=2,'reverse motion settles on its latest visual anchor');
 assert.ok(Math.max(...reverseLast.map(sample=>sample.scroll))-Math.min(...reverseLast.map(sample=>sample.scroll))<=.5,'reverse motion also settles without micro-jitter');
 assert.ok(reverseTrace.every(sample=>sample.actualScrollLeft===0),'reverse motion continues to use only B Transform control');
 report.results.push({version:'after',motion:{firstMoveMs:firstMoved.at,finalOffset:trace.at(-1).error,settledRange:Math.max(...last.map(sample=>sample.scroll))-Math.min(...last.map(sample=>sample.scroll)),reverseOffset:reverseTrace.at(-1).error,reverseSettledRange:Math.max(...reverseLast.map(sample=>sample.scroll))-Math.min(...reverseLast.map(sample=>sample.scroll)),samples:trace.length+reverseTrace.length}});
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
 if(check)await railMotionStability();
 if(check)for(const after of report.results.filter(x=>x.version==='after'&&x.home)){
   const before=report.results.find(x=>x.version==='before'&&x.home&&x.host===after.host&&x.viewport.width===after.viewport.width&&x.viewport.height===after.viewport.height);
   for(const field of ['info','rail','poster','title'])assert.deepEqual(after.home[field],before.home[field],`the established Browse ${field} geometry must not change`);
   assert.ok(after.home.columnPill.height<before.home.columnPill.height,'TV Browse category pills are shorter than the previous short-fat layout');
   assert.deepEqual(after.home.columns.width,before.home.columns.width,'the category strip keeps its existing horizontal layout width');
 }
 assert.deepEqual(report.errors,[]);
 console.log(JSON.stringify({geometry:report.results.filter(x=>x.home).map(x=>({version:x.version,viewport:x.viewport,host:x.host,railY:x.home.rail.y,historyGap:x.home.poster.y-x.history.resume.bottom,filterGap:x.home.poster.y-x.filter.overview.bottom})),cold:report.results.filter(x=>x.trace).map(x=>({version:x.version,iteration:x.coldIteration,spread:x.spread})),performance:report.performance},null,2));
 console.log('TV_DYNAMIC_STABILITY = '+(check?'PASS':'MEASURE_ONLY')+'; REAL_TV = PENDING');
}finally{if(artifactDir)writeFileSync(join(artifactDir,'dynamic-stability.json'),JSON.stringify(report,null,2));await browser.close();}
