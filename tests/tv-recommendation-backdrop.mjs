import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {renderIndex,validateRenderedArtifact} from '../scripts/build-core.mjs';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.WEBHOME_PLAYWRIGHT_PATH||join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const baseline='b29ebba1ca46c2c9e6406b6bcf1eb19c721ad9c1';
const hook=`window.testBackdrop={state,buildHotItemsFromIndex,displayImage,tvBrowsePreview,tvBrowsePrepareLogo,tvBrowseState,storeMovieDetailCache,storeTvDetailCache,secondaryGetQuery,renderTvBrowse,tvBrowseSelectColumn};
window.testBackdrop.setup=()=>{state.previewMode=true;document.documentElement.classList.add('tv-preview','tv-mode');state.hot.ready=true;state.hot.items=[];state.recent.loaded=true;syncBrowseDevicePresentation();bindActions();installRemoteKeys();renderTvBrowse();};
window.imageDecodes=[];
const OriginalImage=window.Image;
window.Image=class extends OriginalImage{constructor(...args){super(...args);this.addEventListener('load',()=>imageDecodes.push({url:this.src,naturalWidth:this.naturalWidth,naturalHeight:this.naturalHeight}));}};
`;
const {output}=renderIndex();validateRenderedArtifact(output);
const html={before:execFileSync('git',['show',baseline+':index.html'],{encoding:'utf8',maxBuffer:4*1024*1024}),after:output};
for(const key of Object.keys(html)){const value=html[key];html[key]=value.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/,hook);assert.notEqual(value,html[key]);}
const browser=await chromium.launch({headless:true,...(process.env.WEBHOME_BROWSER_EXECUTABLE?{executablePath:process.env.WEBHOME_BROWSER_EXECUTABLE}:{channel:process.env.WEBHOME_BROWSER_CHANNEL||'chrome'})});
const report={kind:'CHROMIUM_FIXTURE_DECODES',baseline,results:[],errors:[]};
const artifactDir=process.env.WEBHOME_VISUAL_DIR;
if(artifactDir)mkdirSync(artifactDir,{recursive:true});
async function pageAt(version,{details={},delays={},imageDelays={}}={}){
 const p=await browser.newPage({viewport:{width:1920,height:1080}}),requests=[];
 p.on('pageerror',e=>report.errors.push(e.message));
 await p.route('**/*',async route=>{
   const url=route.request().url();
   if(url==='http://fixture.local/?_tv=1')return route.fulfill({contentType:'text/html',body:html[version]});
   requests.push(url);
   if(route.request().resourceType()==='image'){
     const size=Number(url.match(/\/w(\d+)\//)?.[1]||780),backdrop=url.includes('backdrop');
     if(imageDelays[url.split('/').pop()])await new Promise(r=>setTimeout(r,imageDelays[url.split('/').pop()]));
     return route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${backdrop?Math.round(size*9/16):size*1.5}"><rect width="100%" height="100%" fill="#204538"/></svg>`});
   }
   const match=new URL(url).pathname.match(/\/(movie|tv)\/(\d+)$/);
   if(match){
     const id=Number(match[2]);if(delays[id])await new Promise(r=>setTimeout(r,delays[id]));
     return route.fulfill({contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({id,media_type:match[1],overview:'详情异步补全',release_date:'2025-01-01',images:{logos:[]},...(details[id]||{})})});
   }
   return route.abort();
 });
 await p.goto('http://fixture.local/?_tv=1');
 await p.evaluate(()=>{WEBHOME_CONFIG.tmdb.apiBase='http://fixture.local/tmdb';WEBHOME_CONFIG.tmdb.apiKey='fixture';testBackdrop.setup();});
 return {p,requests};
}
async function nostr(p,ids,cached={}){
 return p.evaluate(({ids,cached})=>{
   const a=testBackdrop;
   a.state.hot.media=new Map(ids.map((id,index)=>['tmdb:movie:'+id,{m:'tmdb:movie:'+id,t:'推荐'+id,mt:'movie',tid:String(id),p:'/poster-'+id+'.jpg',c:30-index,l:100-index}]));
   a.state.hot.items=a.buildHotItemsFromIndex();
   for(const [id,detail]of Object.entries(cached))a.storeMovieDetailCache({tmdbId:Number(id)}, {id:Number(id),images:{logos:[]},...detail});
   a.renderTvBrowse();document.querySelector('#tvBrowseRail .card').focus();
   return a.state.hot.items;
 },{ids,cached});
}
async function painted(p,path){await p.waitForFunction(path=>testBackdrop.tvBrowseState().backdropUrl.endsWith(path),path);}
async function result(p,name,version,requests){
 const record=await p.evaluate(()=>({url:testBackdrop.tvBrowseState().backdropUrl,decodes:imageDecodes,previewKey:testBackdrop.tvBrowseState().previewKey,details:Object.keys(testBackdrop.state.movieDetail.cache),budget:testBackdrop.state.homeV14.requestBudget}));
 const matching=record.decodes.findLast(x=>x.url===record.url);
 assert.ok(matching,'visible background was actually decoded');
 report.results.push({name,version,url:record.url,naturalWidth:matching.naturalWidth,naturalHeight:matching.naturalHeight,imageType:matching.naturalWidth>matching.naturalHeight?'landscape':'portrait',detailRequests:requests.filter(x=>/\/(movie|tv)\/\d+\?/.test(x)),imageRequests:requests.filter(x=>x.includes('image.tmdb.org')),budgetMax:record.budget?.maxActive||0});
 if(artifactDir)await p.screenshot({path:join(artifactDir,`${name}-${version}.png`)});
 console.log(name+' '+version+' '+JSON.stringify({url:record.url,naturalWidth:matching.naturalWidth,naturalHeight:matching.naturalHeight}));
}
async function checks(version){
 let {p,requests}=await pageAt(version);
 const items=await nostr(p,[91001],{91001:{backdrop_path:'/cached-backdrop.jpg'}});
 assert.equal(items[0].image,items[0].pic);assert.equal(items[0].landscape,undefined,'actual Nostr model contains only its compact poster');
 await painted(p,'cached-backdrop.jpg');
 const size=version==='before'?'w780':'w1280';
 assert.equal(await p.evaluate(()=>testBackdrop.tvBrowseState().backdropUrl),`https://image.tmdb.org/t/p/${size}/cached-backdrop.jpg`);
 assert.equal(requests.filter(x=>/\/movie\/91001\?/.test(x)).length,0,'cached detail does not request again');
 await result(p,'cached-nostr-backdrop',version,requests);await p.close();

 ({p,requests}=await pageAt(version,{details:{91002:{backdrop_path:'/async-backdrop.jpg'}},delays:{91002:250}}));
 await nostr(p,[91002]);await painted(p,'poster-91002.jpg');
 const fallback=await p.evaluate(()=>testBackdrop.tvBrowseState().backdropUrl);
 assert.equal(fallback,'https://image.tmdb.org/t/p/w780/poster-91002.jpg');
  await painted(p,'async-backdrop.jpg');
  assert.equal(await p.evaluate(()=>testBackdrop.tvBrowseState().backdropUrl),`https://image.tmdb.org/t/p/${size}/async-backdrop.jpg`);
 await p.waitForTimeout(70);
 const imageRequestCount=requests.filter(x=>x.includes('/'+size+'/async-backdrop.jpg')).length;
 await p.evaluate(()=>{const item=testBackdrop.state.hot.items[0];for(let i=0;i<5;i++)testBackdrop.tvBrowsePreview(item);});
 await p.waitForTimeout(100);
 assert.equal(requests.filter(x=>/\/movie\/91002\?/.test(x)).length,1,'shared foreground metadata request is deduped');
 assert.equal(requests.filter(x=>x.includes('/'+size+'/async-backdrop.jpg')).length,imageRequestCount,'repeated preview adds no image request');
 assert.equal(await p.evaluate(()=>imageDecodes.filter(x=>x.url.endsWith('/async-backdrop.jpg')).length),1,'one preload/decode for the upgraded background');
 await result(p,'async-upgrade',version,requests);report.results.at(-1).initialUrl=fallback;await p.close();

 ({p,requests}=await pageAt(version));await nostr(p,[91003],{91003:{poster_path:'/detail-poster.jpg',backdrop_path:null}});
 await painted(p,'poster-91003.jpg');
 assert.equal(await p.evaluate(()=>testBackdrop.tvBrowseState().backdropUrl),'https://image.tmdb.org/t/p/w780/poster-91003.jpg');
 assert.equal(requests.filter(x=>x.includes('/w1280/')).length,0,'poster fallback is never labelled a landscape');
 await result(p,'poster-fallback',version,requests);await p.close();

 ({p,requests}=await pageAt(version,{details:{91004:{backdrop_path:'/old-backdrop.jpg'},91005:{backdrop_path:'/new-backdrop.jpg'}},delays:{91004:350,91005:30},imageDelays:{'old-backdrop.jpg':200}}));
 await nostr(p,[91004,91005]);await p.locator('#tvBrowseRail .card').nth(1).focus();
 await painted(p,'new-backdrop.jpg');await p.waitForTimeout(550);
 assert.ok((await p.evaluate(()=>testBackdrop.tvBrowseState().backdropUrl)).endsWith('/new-backdrop.jpg'));
 assert.equal(requests.filter(x=>/\/movie\/91004\?/.test(x)).length,1);assert.equal(requests.filter(x=>/\/movie\/91005\?/.test(x)).length,1);
 await result(p,'late-detail-focus-guard',version,requests);await p.close();

 // Once an old image is already decoding, its callback must also be stale.
 ({p,requests}=await pageAt(version,{imageDelays:{'old-decoding-backdrop.jpg':350}}));
 await nostr(p,[91006,91007],{91006:{backdrop_path:'/old-decoding-backdrop.jpg'},91007:{backdrop_path:'/new-decoded-backdrop.jpg'}});
 await p.waitForFunction(()=>testBackdrop.tvBrowseState().pendingImage?.src.endsWith('/old-decoding-backdrop.jpg'));
 await p.locator('#tvBrowseRail .card').nth(1).focus();await painted(p,'new-decoded-backdrop.jpg');await p.waitForTimeout(450);
 assert.ok((await p.evaluate(()=>testBackdrop.tvBrowseState().backdropUrl)).endsWith('new-decoded-backdrop.jpg'));
 await result(p,'late-image-focus-guard',version,requests);await p.close();

 for(const column of ['movie','tv','anime','documentary','variety']){
   ({p,requests}=await pageAt(version));
   await p.evaluate(column=>{
     const type=column==='movie'||column==='documentary'?'movie':'tv';
     const q=testBackdrop.secondaryGetQuery(column);q.items=[{id:'tmdb:'+type+':92001',tmdbId:92001,title:'已有TMDB分类',mediaType:type,source:'tmdb',pic:'/catalog-poster.jpg',landscape:'https://image.tmdb.org/t/p/w780/catalog-backdrop.jpg'}];q.loaded=true;q.hasMore=false;
     (type==='tv'?testBackdrop.storeTvDetailCache:testBackdrop.storeMovieDetailCache)(q.items[0],{id:92001,backdrop_path:'/detail-backdrop.jpg',images:{logos:[]}});testBackdrop.tvBrowseSelectColumn(column);
   },column);
   await painted(p,'catalog-backdrop.jpg');
   assert.equal(await p.evaluate(()=>testBackdrop.tvBrowseState().backdropUrl),'https://image.tmdb.org/t/p/w1280/catalog-backdrop.jpg','existing explicit landscape priority is unchanged');
   await result(p,'tmdb-'+column,version,requests);await p.close();
 }
 // A detail with the wrong identity is not an eligible backdrop source.
 ({p,requests}=await pageAt(version));
 await p.evaluate(()=>testBackdrop.tvBrowsePreview({id:'unmatched',mediaType:'other',title:'安全回退',pic:'/safe-poster.jpg',heroDetail:{id:'wrong',backdrop_path:'/wrong-backdrop.jpg'}}));
 await painted(p,'safe-poster.jpg');assert.equal(requests.some(x=>x.includes('wrong-backdrop')),false);
 await result(p,'mismatched-detail',version,requests);await p.close();

 ({p,requests}=await pageAt(version));
 await nostr(p,Array.from({length:40},(_,i)=>93001+i));await p.waitForTimeout(500);
 await result(p,'bounded-recommendation-requests',version,requests);
 const requestIds=requests.filter(x=>/\/movie\/93\d+\?/.test(x)).map(x=>new URL(x).pathname);
 assert.ok(requestIds.length>0&&requestIds.length<40,'background repair never fetches the whole recommendation list');
 assert.equal(new Set(requestIds).size,requestIds.length,'artwork and status share each metadata request');
 await p.close();
}
try{
 await checks('before');await checks('after');
 assert.deepEqual(report.errors,[]);
 for(const row of report.results){assert.ok(row.budgetMax<=4,'global request cap is preserved');if(row.name.startsWith('tmdb-'))assert.deepEqual(report.results.find(x=>x.name===row.name&&x.version==='before').url,row.url);}
 assert.equal(report.results.find(x=>x.name==='bounded-recommendation-requests'&&x.version==='after').detailRequests.length,report.results.find(x=>x.name==='bounded-recommendation-requests'&&x.version==='before').detailRequests.length,'no extra metadata requests compared with baseline');
 console.log('RECOMMENDATION_BACKDROP = PASS; REAL_TV_CLARITY = PENDING');
}finally{if(artifactDir)writeFileSync(join(artifactDir,'backdrop-results.json'),JSON.stringify(report,null,2));await browser.close();}
