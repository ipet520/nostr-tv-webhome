import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Run production HTML functions and the App's actual SDK function expressions.
// Native Room/service execution is independently covered by Android unit tests;
// this transport uses isolated records, never a device or real database.
const source=name=>fs.readFileSync(new URL('../src/js/'+name,import.meta.url),'utf8');
const java=fs.readFileSync(new URL('../../app/app/src/main/java/com/fongmi/android/tv/web/HomeWebController.java',import.meta.url),'utf8');
const expressions={vod:java.match(/playVod:(\(siteKey,vodId,title,pic,options\)=>[^\n]+)/)[1].trim().replace(/,$/,''),
 history:java.match(/history:(\(options\)=>[^\n]+)/)[1].trim().replace(/,$/,''),
 historyDelete:java.match(/historyDelete:(\(options\)=>[^\n]+)/)[1].trim().replace(/,$/,'')};
const calls=[];
const native={rows:[],legacy:false,permission:true,failKey:'',playFailure:false,playing:null,historyQueue:null,envelope:null,historyFailureCount:0};
const localStore=new Map();
const raw=(site,extra={})=>({key:site+'@@@vod@@@7',cid:7,vodName:'Example',vodPic:'/poster.jpg',mediaType:'movie',tmdbId:42,position:50_000,duration:500_000,createTime:1000,...extra});
const refOf=row=>({version:1,kind:row.kind||'ITEM',historyKey:row.key,cid:row.cid,siteKey:row.key.split('@@@')[0],vodId:row.key.split('@@@')[1],mediaType:row.mediaType,tmdbId:row.tmdbId,seasonNumber:row.tmdbSeasonNumber??-1,updatedAt:row.createTime,scopeToken:'fixture-'+row.createTime});
const id=ref=>JSON.stringify([1,ref.kind,ref.cid,ref.historyKey,ref.kind==='SEASON'?ref.mediaType:'',ref.kind==='SEASON'?ref.tmdbId:0,ref.kind==='SEASON'?ref.seasonNumber:-1]);
const read=()=>native.legacy?native.rows.map(row=>({...row})):{version:1,mode:'independent',records:native.rows.map(row=>({...row,historyRecordRef:refOf(row),canPlayExact:row.cid===7&&row.exactAllowed!==false,canResume:row.cid===7&&row.position>0&&row.duration>0,canDelete:true,sourceLabel:row.key.split('@@@')[0],deleteScope:row.kind||'ITEM'})),legacy:native.rows.filter(row=>row.cid===7&&!row.kind).map(row=>({...row}))};
async function invoke(method,payload){
 calls.push({method,payload:JSON.parse(JSON.stringify(payload))});
 if(method==='app.history'){
   if(native.historyFailureCount>0){native.historyFailureCount--;throw Error('fixture transient Native History read failure');}
   if(native.historyQueue)return new Promise(resolve=>native.historyQueue.push(resolve));
   return native.envelope || (payload.mode==='independent'?read():native.rows.map(row=>({...row})));
 }
 if(method==='player.playVod'){
   const ref=payload.historyRecordRef;
   if(payload.intent!=='history_exact')return {};
   if(native.playFailure)throw Error('fixture playback failure');
   const row=native.rows.find(row=>id(refOf(row))===id(ref));
   if(!row||row.cid!==7)throw Error('History reference unavailable');
   native.playing={...row};return {accepted:true,version:1};
 }
 if(method==='app.historyDelete'){
   const results=payload.refs.map(ref=>{
     const displayId=id(ref);
     if(!native.permission||ref.historyKey===native.failKey)return {displayId,status:'FAILED',message:'permission or fixture failure'};
     const before=native.rows.length;native.rows=native.rows.filter(row=>id(refOf(row))!==displayId);
     return {displayId,status:native.rows.length<before?'DELETED':'NOT_FOUND'};
   });return {version:1,results,readback:read()};
 }
 throw Error('Unexpected SDK method '+method);
}
const c=vm.createContext({console:{debug(){},info(){}},URL,Math,Date,Set,Map,invoke,
 state:{activeList:'all',recent:{items:[],loaded:true,referenceVersion:1,loading:false,loadingPromise:null,refreshedAt:0,runSeq:0,activeRun:null,pendingRefresh:false,pendingRefreshSilent:true,pendingRefreshReconcileDetail:true,nativeHistoryRevision:0,nativeHistoryCommittedRevision:0,nativeKeyFlow:{}},historyContexts:{loaded:true,entries:[]},continueIndex:{loaded:true,entries:[]},watch:{item:{}}},
 document:{activeElement:null},localStorage:{getItem(key){return localStore.has(key)?localStore.get(key):null;},setItem(key,value){localStore.set(key,String(value));},removeItem(key){localStore.delete(key);}},
 normalizeTitle:s=>String(s||'').trim().toLowerCase(),resolvePanProviderForHistory:()=>'',isTvDiagnosticEnabled:()=>false,
 secondaryActiveQuery:()=>null,panSearchItemKey:i=>i.mediaType+':'+i.tmdbId,toast(){},
 $:()=>null,renderHome(){},renderCatalogQuery(){},renderActiveGrid(){},setStatus(){},recordRecentNativeKeyFlow(){},
 loadPendingWatch:async()=>null,
 rememberHomeReturn(){},rememberDetailReturn(){},saveUiSnapshotNow(){},rememberWatchIntent(){},startWatchTracking(){},
 playbackOriginForNativeIdentity:()=> 'native-vod'
});
for(const name of ['06-tmdb-history-model.js','15a-history-recent-continue.js','08b-native-history-delete.js','08a-catalog-recent-management.js','07-detail-playback-race.js']) vm.runInContext(source(name),c,{filename:name});
vm.runInContext(source('19-pan-results-handoff-return.js').split('    function panHealthKey')[0],c);
c.saveHistoryPlaybackContext=async()=>{};
vm.runInContext('const contractSdk={vod:'+expressions.vod+',history:'+expressions.history+',historyDelete:'+expressions.historyDelete+'}; function sdk(){return contractSdk;}',c);
const results=[];
async function test(name,fn){await fn();results.push(name);console.log(name+' = PASS');}
function load(){c.state.recent.items=c.normalizeRecentWatchingItems(read());return c.state.recent.items;}
const resumeSource=source('22-snapshot-resume-boot.js');
const historyEventListener=resumeSource.match(/window\.addEventListener\("fmhistorychange", (\(event\) => \{[\s\S]*?\n    \})\);/);
assert.ok(historyEventListener,'the production versioned Native History event listener is extractable');
const handleHistoryChange=vm.runInContext(historyEventListener[1],c);
async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,0));}assert.ok(check(),'async fixture timed out');}
await test('native history commit event is bridged and TV progress polling is removed',async()=>{
 const activity=fs.readFileSync(new URL('../../app/app/src/leanback/java/com/fongmi/android/tv/ui/activity/HomeActivity.java',import.meta.url),'utf8');
 const mobileVod=fs.readFileSync(new URL('../../app/app/src/mobile/java/com/fongmi/android/tv/ui/fragment/VodFragment.java',import.meta.url),'utf8');
 const mobileVideo=fs.readFileSync(new URL('../../app/app/src/mobile/java/com/fongmi/android/tv/ui/activity/VideoActivity.java',import.meta.url),'utf8');
 const leanbackVideo=fs.readFileSync(new URL('../../app/app/src/leanback/java/com/fongmi/android/tv/ui/activity/VideoActivity.java',import.meta.url),'utf8');
 const resume=source('22-snapshot-resume-boot.js');
 const settlement=source('19-pan-results-handoff-return.js').match(/function scheduleHistorySettlement\(\)[\s\S]*?\n    function findWatchHistory/);
 assert.match(activity,/case HISTORY:[\s\S]*?getHistory\(\);\s*if \(mWeb != null\) mWeb\.dispatchHistoryChanged\(\);/);
 assert.match(mobileVod,/case HISTORY:\s*if \(mWeb != null\) mWeb\.dispatchHistoryChanged\(\);\s*break;/);
 for(const video of [mobileVideo,leanbackVideo]){
  const save=video.match(/private void saveHistory\(boolean exit\) \{[\s\S]*?\n    \}/);
  assert.ok(save,'native player exit save path is extractable');
  assert.ok(save[0].indexOf('history.save()')>=0,'native History write is present');
  assert.ok(save[0].indexOf('history.save()')<save[0].indexOf('RefreshEvent.history()'),
   'the WebHome invalidation is posted after the Native History write');
 }
 assert.match(java,/public void dispatchHistoryChanged\(\)[\s\S]*?dispatchLifecycle\("fmhistorychange", "\{version:1\}"\);/);
 assert.match(resume,/window\.addEventListener\("fmhistorychange", \(event\) =>/);
 assert.match(resume,/loadRecentList\(\{ refresh: true, silent: true, reconcileDetail: false \}\)\.catch\(\(\) => \{\}\);/);
 assert.ok(settlement);assert.doesNotMatch(settlement[0],/loadRecentList/);
 const listener=resume.match(/window\.addEventListener\("fmhistorychange", (\(event\) => \{[\s\S]*?\n    \})\);/);
 assert.ok(listener,'the versioned Native History listener is extractable');
 const refreshCalls=[], pageState={active:true,detail:false};let revision=0;
 const eventContext=vm.createContext({tvBrowseActive:()=>pageState.active,
   markNativeHistoryChanged:()=>++revision,
   console:{debug(){}},
   $:()=>pageState.detail?{classList:{contains:()=>true}}:null,
   loadRecentList:options=>{refreshCalls.push(options);return Promise.resolve();}});
 const handleHistoryChange=vm.runInContext(listener[1],eventContext);
 handleHistoryChange({detail:{version:2}});assert.equal(refreshCalls.length,0);assert.equal(revision,0);
 handleHistoryChange({detail:{version:1}});assert.deepEqual(JSON.parse(JSON.stringify(refreshCalls[0])),{refresh:true,silent:true,reconcileDetail:false});
 pageState.detail=true;handleHistoryChange({detail:{version:1}});assert.equal(refreshCalls.length,2,'an active detail consumes the post-commit Native event');
 assert.deepEqual(JSON.parse(JSON.stringify(refreshCalls[1])),{refresh:true,silent:true,reconcileDetail:false});assert.equal(revision,2);
 pageState.detail=false;pageState.active=false;handleHistoryChange({detail:{version:1}});assert.equal(refreshCalls.length,2);assert.equal(revision,3);
});
await test('player return refreshes the committed exact Native record after a stale read and hands it off history_exact',async()=>{
 native.legacy=false;native.envelope=null;native.historyFailureCount=0;native.historyQueue=[];
 const sourceA=raw('A',{position:0,duration:500_000,createTime:2000,episodeUrl:'https://a.example/episode-4',vodFlag:'line-A',sourceBindingKey:'line-A#1',tmdbSeasonNumber:1,tmdbEpisodeNumber:4});
 const sourceC=raw('C',{position:185_000,duration:500_000,createTime:1000,episodeUrl:'https://c.example/episode-3',vodFlag:'line-C',sourceBindingKey:'line-C#1',tmdbSeasonNumber:1,tmdbEpisodeNumber:3});
 native.rows=[sourceA,sourceC];
 c.state.activeList='all';c.state.recent.items=[];c.state.recent.detailItems=[];c.state.recent.loaded=true;c.state.recent.error='';
 c.state.recent.loading=false;c.state.recent.loadingPromise=null;c.state.recent.pendingRefresh=false;
 c.state.recent.pendingRefreshSilent=true;c.state.recent.pendingRefreshReconcileDetail=true;
 c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 c.tvBrowseActive=()=>false;
 const item={id:'tmdb:movie:42',source:'tmdb',tmdbId:'42',mediaType:'movie',title:'Example',aliases:['Example']};
 c.state.selected=item;c.state.detailClosing=false;
 const detailSheet={classList:{contains:name=>name==='active'}};
 const classes={toggle(){},remove(){}};
 const button={style:{},dataset:{},classList:classes,closest:()=>({classList:classes}),setAttribute(){}};
 const continueText={textContent:''},searchText={textContent:''};
 c.$=id=>({detailSheet,detailContinueBtn:button,detailContinueText:continueText,detailSearchText:searchText})[id]||null;
 c.panSearchItemKey=value=>value.mediaType+':'+value.tmdbId;
 c.detailPlaybackIsCurrent=run=>run===c.state.detailPlayback&&!run.cancelled;
 c.detailDirectPlayReadyFor=()=>false;
 c.detailContinuePlayStateFor=value=>c.detailReturnedNativeHistoryFor(value)?'ready':'idle';
 c.clearDirectPlayStatus=()=>{};c.toast=()=>{};
 const run={item,token:17,handoffStarted:true,playRequested:true,phase:'STARTING_PLAYER',candidate:{url:'https://a.example/episode-4'}};
 c.state.detailPlayback=run;
 c.state.detailPlayerReturn={itemKey:'movie:42',handoffStarted:true,startedAt:Date.now(),returnedAt:0};
 const returnStart=resumeSource.indexOf('    async function rearmDetailPlaybackAfterPlayerReturn(options)');
 const returnEnd=resumeSource.indexOf('\n    async function handleWebHomeResume',returnStart);
 assert.ok(returnStart>=0&&returnEnd>returnStart,'the production player-return rearm function is extractable');
 const rearm=vm.runInContext('('+resumeSource.slice(returnStart,returnEnd).trim()+')',c);
 const returned=rearm({playerReturn:true});
 await waitFor(()=>native.historyQueue.length===1);
 const staleEnvelope=read();
 // The player has already returned, but the first WebView History read sees
 // A at zero while C has an older positive point. A must not borrow C's route.
 native.historyQueue.shift()(staleEnvelope);
 await returned;
 assert.ok(c.state.detailPlayerReturn.returnedAt>0);
 assert.equal(continueText.textContent,'播放','zero-progress current A row cannot borrow C history');
 assert.equal(c.findDetailContinueHistory(item),null,'only the newest current-work route is eligible; older C cannot be reused');
 assert.equal(c.state.recent.detailItems[0].historyRecordRef.siteKey,'A','detail lookup keeps the versioned Native reference, not legacy rows');

 // A later in-flight read still contains the zero point. Native commits A's
 // actual episode/progress, then posts the versioned fmhistorychange event.
 const oldRead=c.loadRecentList({refresh:true,silent:true,reconcileDetail:false});
 await waitFor(()=>native.historyQueue.length===1);
 native.rows[0]=Object.assign({},native.rows[0],{position:124_000,duration:500_000,createTime:3000,
  episodeUrl:'https://a.example/episode-4',vodFlag:'line-A',sourceBindingKey:'line-A#1',tmdbSeasonNumber:1,tmdbEpisodeNumber:4});
 const committedEnvelope=read();
 handleHistoryChange({detail:{version:1}});
 assert.equal(c.state.recent.activeRun.invalidated,true,'the pre-commit response cannot overwrite the returned detail');
 native.historyQueue.shift()(staleEnvelope);
 await waitFor(()=>native.historyQueue.length===1);
 native.historyQueue.shift()(committedEnvelope);
 await oldRead;
 assert.equal(c.state.recent.nativeHistoryCommittedRevision,c.state.recent.nativeHistoryRevision);
 assert.equal(c.state.recent.detailItems[0].position,124_000);
 assert.equal(c.state.recent.detailItems[0].siteKey,'A');
 assert.equal(c.state.recent.detailItems[0].vodId,'vod');
 assert.equal(c.state.recent.detailItems[0].episodeNumber,4);
 assert.equal(continueText.textContent,'续播','post-commit Native refresh changes the button from play to resume');
 assert.equal(button.dataset.mode,'CONTINUE');
 assert.equal(button.dataset.playState,'ready','the resume action and icon state are both ready even if an old resource run remains');

 // Clicking that state must dispatch the exact Native reference and preserve
 // the actual A route, episode and saved position through the bridge payload.
 const handoffSource=source('19-pan-results-handoff-return.js');
 const markerStart=handoffSource.indexOf('    function markDetailPlayerHandoff(item) {');
 const markerEnd=handoffSource.indexOf('\n    async function persistPlaybackBeforeNativeHandoff',markerStart);
 assert.ok(markerStart>=0&&markerEnd>markerStart,'the production detail handoff marker is extractable');
 vm.runInContext(handoffSource.slice(markerStart,markerEnd).trim(),c);
 const clickErrors=[];c.toast=message=>clickErrors.push(String(message||''));
 const handoffsBefore=calls.filter(call=>call.method==='player.playVod').length;
 assert.equal(await c.requestDetailPlayback(item),true,clickErrors.join('; ')||'resume click should complete the Native exact handoff');
 const handoffs=calls.filter(call=>call.method==='player.playVod');
 assert.equal(handoffs.length,handoffsBefore+1,'one resume click performs exactly one Native handoff');
 const handoff=handoffs.at(-1);
 assert.equal(handoff.payload.intent,'history_exact');
 assert.equal(handoff.payload.historyRecordRef.siteKey,'A');
 assert.equal(handoff.payload.historyRecordRef.vodId,'vod');
 assert.equal(native.playing.episodeUrl,'https://a.example/episode-4');
 assert.equal(native.playing.position,124_000);
 assert.equal(native.playing.sourceBindingKey,'line-A#1');
 assert.equal(c.state.detailPlayerReturn.handoffStarted,true,'the exact return handoff is one-shot');
 assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,'A@@@vod@@@7',
  'repeated history_exact handoff retains the last valid record while Native saves the next progress');
 native.historyQueue=null;

 // Repeat the real history_exact -> Native commit -> HTML return loop. Reads
 // arriving while the handoff marker is still active must not flash Play or
 // the yellow preparing icon between the label and authoritative refresh.
 for(let cycle=2;cycle<=3;cycle++){
  const a=native.rows.find(row=>row.key==='A@@@vod@@@7');
  a.position=cycle*111_000;a.createTime=3000+cycle*1000;
  const middleRead=c.loadRecentList({refresh:true,silent:true,reconcileDetail:false});
  await middleRead;
  assert.equal(continueText.textContent,'续播',`cycle ${cycle} in-flight update keeps the resume label`);
  assert.equal(button.dataset.playState,'ready',`cycle ${cycle} in-flight update keeps the ready icon state`);
  const returnAgain=await rearm({playerReturn:true});
  assert.equal(returnAgain,true,`cycle ${cycle} returns to the same active detail`);
  assert.equal(continueText.textContent,'续播',`cycle ${cycle} settles on the latest positive Native record`);
  assert.equal(button.dataset.mode,'CONTINUE');
  assert.equal(button.dataset.playState,'ready');
  assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,a.key);
  const nextStart=calls.filter(call=>call.method==='player.playVod').length;
  assert.equal(await c.requestDetailPlayback(item),true,`cycle ${cycle} continues from the exact current record`);
  assert.equal(calls.filter(call=>call.method==='player.playVod').length,nextStart+1,
   `cycle ${cycle} performs exactly one Native handoff`);
  const latest=calls.filter(call=>call.method==='player.playVod').at(-1);
  assert.equal(latest.payload.intent,'history_exact');
  assert.equal(latest.payload.historyRecordRef.historyKey,a.key);
  assert.equal(native.playing.position,cycle*111_000);
  assert.equal(native.playing.episodeUrl,'https://a.example/episode-4');
  assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,a.key);
 }
 native.historyFailureCount=1;
 assert.equal(await rearm({playerReturn:true}),true,'a transient History bridge error still completes the same-detail return');
 assert.ok(c.state.recent.error,'the fixture confirms the Native read failed transiently');
 assert.equal(continueText.textContent,'续播','a read failure preserves the last-good exact resume instead of treating it as absent');
 assert.equal(button.dataset.mode,'CONTINUE');
 assert.equal(button.dataset.playState,'ready');
 assert.equal(c.detailReturnedNativeHistoryFor(item).siteKey,'A');
 native.historyFailureCount=0;
 await c.loadRecentList({refresh:true,silent:true,reconcileDetail:false});
 c.$=()=>null;c.state.selected=null;c.state.detailPlayerReturn=null;c.state.detailPlayback=null;
 native.historyQueue=null;
});
await test('Native Search cancellation preserves preparation and a late committed A/C route becomes exact resume',async()=>{
 native.legacy=false;native.envelope=null;native.historyFailureCount=0;native.historyQueue=null;
 native.rows=[
  raw('A',{position:90_000,duration:500_000,createTime:5000,episodeUrl:'https://a.example/episode-2',vodFlag:'line-A',sourceBindingKey:'line-A#2',tmdbSeasonNumber:1,tmdbEpisodeNumber:2}),
  raw('C',{position:45_000,duration:500_000,createTime:4000,episodeUrl:'https://c.example/episode-1',vodFlag:'line-C',sourceBindingKey:'line-C#1',tmdbSeasonNumber:1,tmdbEpisodeNumber:1})
 ];
 c.state.activeList='all';c.state.recent.items=[];c.state.recent.detailItems=[];c.state.recent.loaded=false;
 c.state.recent.error='';c.state.recent.loading=false;c.state.recent.loadingPromise=null;c.state.recent.pendingRefresh=false;
 c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 const item={id:'tmdb:movie:42',source:'tmdb',tmdbId:'42',mediaType:'movie',title:'Example',aliases:['Example']};
 const run={item,itemKey:'movie:42',token:55,phase:'READY',active:false,candidate:{url:'https://prepared.example/play'},playRequested:false};
 c.state.selected=item;c.state.detailClosing=false;c.state.detailPlayback=run;c.state.detailPlayerReturn=null;
 c.state.pan={viewToken:1,directReady:{itemKey:'movie:42'},directFailure:null};
 await c.loadRecentList({refresh:true,silent:true,reconcileDetail:false});
 const handoffSource=source('19-pan-results-handoff-return.js');
 const install=(startMarker,endMarker)=>{
  const start=handoffSource.indexOf(startMarker),end=handoffSource.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0&&end>start,`extractable production function ${startMarker}`);
  vm.runInContext(handoffSource.slice(start,end).trim(),c);
 };
 install('    function nativeSearchReturnMarkerFor() {','\n    function nativeSearchHistorySnapshotFor');
 install('    function nativeSearchHistorySnapshotFor(item, history) {','\n    function nativeSearchHistoryChangeReason');
 install('    function nativeSearchHistoryChangeReason(item, marker, winner) {','\n    function nativeSearchHistoryChanged');
 install('    function nativeSearchHistoryChanged(item, marker, winner) {','\n    function setNativeSearchReturnMarker');
 install('    function setNativeSearchReturnMarker(item) {','\n    function clearNativeSearchReturnMarker');
 install('    function clearNativeSearchReturnMarker() {','\n    async function nativeSearch');
 install('    function retireDetailPreparedPlaybackAfterNativeSearch(item, marker, reason) {','\n    function reconcileDetailAfterNativeReturn');
 install('    function reconcileDetailAfterNativeReturn(item, origin) {','\n    // 滚动恢复：closeDetail(needBack)');
 const buttonClasses={toggle(){},remove(){}};
 const button={style:{},dataset:{},classList:buttonClasses,closest:()=>({classList:buttonClasses}),setAttribute(){}};
 const continueText={textContent:''},searchText={textContent:''};
 c.$=id=>({detailSheet:{classList:{contains:name=>name==='active'}},detailContinueBtn:button,
  detailContinueText:continueText,detailSearchText:searchText})[id]||null;
 c.setNativeSearchReturnMarker(item);
 const storedMarker=JSON.parse(localStore.get('fm_detail_native_search_return'));
 assert.equal(storedMarker.historySnapshot.siteKey,'A','search captures the actual pre-search winner');
 assert.equal(c.reconcileDetailAfterNativeReturn(item,'native-search'),false,'opening Native Search without playback is not a player return');
 assert.equal(c.state.detailPlayerReturn,null,'cancelled Native Search cannot make old History resumable');
 assert.equal(c.state.detailPlayback,run,'cancelled Native Search preserves the already prepared resource');
 assert.equal(run.candidate.url,'https://prepared.example/play');
 assert.equal(continueText.textContent,'播放','opening Native Search without playing cannot present an old record as resume');
 assert.notEqual(button.dataset.playState,'ready','cancelled search does not make an old Native record green');
 assert.ok(localStore.has('fm_detail_native_search_return'),'the probe remains available for a History save that races the first return read');

 native.historyQueue=[];
 const staleRead=c.loadRecentList({refresh:true,silent:true,reconcileDetail:false});
 await waitFor(()=>native.historyQueue.length===1);
 const stale=read();
 const played=native.rows.find(row=>row.key==='C@@@vod@@@7');
 Object.assign(played,{position:222_000,duration:500_000,createTime:6000,episodeUrl:'https://c.example/episode-1',vodFlag:'line-C',sourceBindingKey:'line-C#1',tmdbSeasonNumber:1,tmdbEpisodeNumber:1});
 const committed=read();
 handleHistoryChange({detail:{version:1}});
 native.historyQueue.shift()(stale);
 await waitFor(()=>native.historyQueue.length===1);
 native.historyQueue.shift()(committed);
 await staleRead;
 await waitFor(()=>!!c.state.detailPlayerReturn&&!c.state.detailPlayerReturn.handoffStarted);
 assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,played.key,'the late committed C record supersedes the old A source');
 assert.equal(c.state.detailPlayback,null,'only the exact prepared run captured by Native Search is retired');
 assert.equal(continueText.textContent,'续播');
 assert.equal(button.dataset.mode,'CONTINUE');
 assert.equal(button.dataset.playState,'ready','history_exact resume takes visual precedence over old resource preparation');
 assert.equal(c.detailReturnedNativeHistoryFor(item).siteKey,'C');

 const before=calls.filter(call=>call.method==='player.playVod').length;
 assert.equal(await c.requestDetailPlayback(item),true,'Native Search return offers executable exact resume');
 assert.equal(calls.filter(call=>call.method==='player.playVod').length,before+1);
 const handoff=calls.filter(call=>call.method==='player.playVod').at(-1);
 assert.equal(handoff.payload.intent,'history_exact');
 assert.equal(handoff.payload.historyRecordRef.siteKey,'C');
 assert.equal(handoff.payload.historyRecordRef.vodId,'vod');
 assert.equal(native.playing.episodeUrl,'https://c.example/episode-1');
 assert.equal(native.playing.position,222_000);
 assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,played.key,
  'the exact Native Search resume carries its actual C record into the next player transaction');
 native.historyQueue=null;
 Object.assign(played,{position:266_000,createTime:7000});
 const resumeStart=resumeSource.indexOf('    async function rearmDetailPlaybackAfterPlayerReturn(options)');
 const resumeEnd=resumeSource.indexOf('\n    async function handleWebHomeResume',resumeStart);
 const rearm=vm.runInContext('('+resumeSource.slice(resumeStart,resumeEnd).trim()+')',c);
 assert.equal(await rearm({playerReturn:true}),true,'repeated Native Search-derived playback returns without a detail resource run');
 assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,played.key);
 assert.equal(continueText.textContent,'续播');
 assert.equal(button.dataset.mode,'CONTINUE');
 assert.equal(button.dataset.playState,'ready');
 const secondHandoff= calls.filter(call=>call.method==='player.playVod').length;
 assert.equal(await c.requestDetailPlayback(item),true);
 assert.equal(calls.filter(call=>call.method==='player.playVod').length,secondHandoff+1);
 assert.equal(calls.filter(call=>call.method==='player.playVod').at(-1).payload.historyRecordRef.siteKey,'C');
 assert.equal(native.playing.position,266_000,'repeated Native Search resume uses the latest committed C progress');
 c.$=()=>null;c.state.selected=null;c.state.detailPlayback=null;c.state.detailPlayerReturn=null;
 localStore.delete('fm_detail_native_search_return');native.historyQueue=null;
});
await test('HTML Pan Search play and repeated history_exact returns stay on the push_agent Native record',async()=>{
 native.legacy=false;native.envelope=null;native.historyFailureCount=0;native.historyQueue=null;
 native.rows=[];c.state.activeList='all';c.state.recent.items=[];c.state.recent.detailItems=[];c.state.recent.loaded=true;
 c.state.recent.error='';c.state.recent.loading=false;c.state.recent.loadingPromise=null;c.state.recent.pendingRefresh=false;
 c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 const item={id:'tmdb:movie:42',source:'tmdb',tmdbId:'42',mediaType:'movie',title:'Example',aliases:['Example']};
 const oldRun={item,itemKey:'movie:42',token:92,phase:'PREPARING',active:true,preparationStarted:true,
  candidate:{url:'https://curated.example/old-route'},playRequested:false,handoffStarted:false};
 c.state.selected=item;c.state.detailClosing=false;c.state.detailPlayback=oldRun;c.state.detailPlayerReturn=null;
 c.state.pan={viewToken:91,playbackReturn:null,isPlaying:false};
 const buttonClasses={toggle(){},remove(){}};
 const button={style:{},dataset:{},classList:buttonClasses,closest:()=>({classList:buttonClasses}),setAttribute(){}};
 const continueText={textContent:''},searchText={textContent:''};
 const detailSheet={scrollTop:0,classList:{contains:name=>name==='active'}};
 const panSearchBlock={classList:{contains:name=>name==='active'}};
 const panResultList={scrollTop:0,querySelector:()=>null};
 c.$=id=>({detailSheet,panSearchBlock,panResultList,detailContinueBtn:button,
  detailContinueText:continueText,detailSearchText:searchText})[id]||null;
 c.panSearchItemKey=value=>value.mediaType+':'+value.tmdbId;
 c.detailPlaybackIsCurrent=run=>run===c.state.detailPlayback&&!run.cancelled;
 c.detailDirectPlayReadyFor=()=>false;
 c.detailContinuePlayStateFor=value=>c.detailReturnedNativeHistoryFor(value)?'ready':'idle';
 c.normalizePlaybackTarget=()=>null;c.currentPlaybackTargetForItem=()=>null;
 const panUrl='https://share.example/pan/selected-file';
 c.buildPanPlayPayload=panItem=>({url:panItem.url,type:panItem.diskType});
 c.panContextIsCurrent=context=>context.item===c.state.selected&&context.token===c.state.pan.viewToken;
 c.rememberWatchIntent=()=>{};c.startWatchTracking=()=>{};
 c.cancelPendingDirectPlay=()=>{};c.handlePanPlayFailure=(...args)=>{throw new Error('unexpected Pan handoff failure '+args.length);};
 c.toast=()=>{};c.recordPanDirectHandoffStage=()=>{};
 c.rememberPanPlaybackReturn=async(panItem,episodeTarget)=>{c.state.pan.playbackReturn={key:panItem.url,episodeTarget,detailScrollTop:19,listScrollTop:3};};
 c.persistPlaybackBeforeNativeHandoff=async(selectedItem,episodeTarget,panItem)=>{await c.rememberPanPlaybackReturn(panItem,episodeTarget);return {status:'settled'};};
 c.renderPanResults=()=>{};c.findByDataset=()=>null;c.lockPanFocus=()=>{};c.scheduleUiSnapshotSave=()=>{};
 c.requestAnimationFrame=()=>{};c.setTimeout=()=>0;
 const priorSdk=c.sdk;
 const panCalls=[];
 c.sdk=()=>Object.assign({},priorSdk(),{pan:{play:payload=>panCalls.push(payload)}});
 const handoffSource=source('19-pan-results-handoff-return.js');
 const extract=(sourceText,startMarker,endMarker,label)=>{
  const start=sourceText.indexOf(startMarker),end=sourceText.indexOf(endMarker,start+startMarker.length);
  assert.ok(start>=0&&end>start,`extractable production ${label}`);
  return sourceText.slice(start,end).trim();
 };
 vm.runInContext(extract(handoffSource,'    function clearNativeSearchReturnMarker() {','\n    async function nativeSearch','clear Native Search marker'),c);
 vm.runInContext(extract(handoffSource,'    function markDetailPlayerHandoff(item) {','\n    async function persistPlaybackBeforeNativeHandoff','player handoff marker'),c);
 const playPan=vm.runInContext('('+extract(handoffSource,'    async function playPanResult(item, options) {','\n    function handlePanPlayFailure','Pan playback entry')+')',c);
 const panCandidate={url:panUrl,title:'Example selected file',diskType:'quark',fileName:'Episode 4'};
 await playPan(panCandidate,{prechecked:true});
 assert.equal(panCalls.length,1,'HTML disk search invokes the native Pan player once');
 assert.deepEqual(JSON.parse(JSON.stringify(panCalls[0])),{url:panUrl,type:'quark'});
 assert.equal(c.state.detailPlayerReturn.handoffStarted,true,'Pan player handoff marks this still-open detail');
 assert.ok(c.state.pan.playbackReturn,'Pan return snapshot is present for the native-player return path');

 const panRecord=raw('push_agent',{key:'push_agent@@@'+panUrl+'@@@7',position:155_000,duration:500_000,createTime:8000,
  episodeUrl:panUrl,vodFlag:'quark',sourceBindingKey:'quark#1',playbackOrigin:'pan-push',tmdbSeasonNumber:1,tmdbEpisodeNumber:4});
 native.rows=[panRecord];
 const returnStart=resumeSource.indexOf('    async function rearmDetailPlaybackAfterPlayerReturn(options)');
 const returnEnd=resumeSource.indexOf('\n    async function handleWebHomeResume',returnStart);
 assert.ok(returnStart>=0&&returnEnd>returnStart,'production return rearm is extractable for Pan');
 const rearm=vm.runInContext('('+resumeSource.slice(returnStart,returnEnd).trim()+')',c);
 assert.equal(await rearm({playerReturn:true}),true,'Pan playback returns to the active HTML detail');
 assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,panRecord.key);
 assert.equal(c.state.detailPlayback,oldRun,'Pan return keeps the still-open detail run available without letting it override Native History');
 assert.equal(oldRun.candidate.url,'https://curated.example/old-route');
 assert.equal(oldRun.phase,'READY');
 assert.equal(c.detailReturnedNativeHistoryFor(item).siteKey,'push_agent');
 assert.equal(continueText.textContent,'续播');
 assert.equal(button.dataset.mode,'CONTINUE');
 assert.equal(button.dataset.playState,'ready');

 const panReturnStart=handoffSource.indexOf('    function restorePanPlaybackReturn(options)');
 const panReturnEnd=handoffSource.indexOf('\n    function panHealthLabel',panReturnStart);
 const restorePan=vm.runInContext('('+handoffSource.slice(panReturnStart,panReturnEnd).trim()+')',c);
 assert.equal(restorePan({skipRender:true}),true,'Pan UI return restoration leaves the native exact continuation intact');
 assert.equal(c.state.pan.playbackReturn,null);
 assert.equal(continueText.textContent,'续播');
 assert.equal(button.dataset.playState,'ready');

 const before=calls.filter(call=>call.method==='player.playVod').length;
 assert.equal(await c.requestDetailPlayback(item),true,'Pan resume click succeeds through history_exact');
 assert.equal(calls.filter(call=>call.method==='player.playVod').length,before+1);
 assert.equal(calls.filter(call=>call.method==='player.playVod').at(-1).payload.intent,'history_exact');
 assert.equal(calls.filter(call=>call.method==='player.playVod').at(-1).payload.historyRecordRef.siteKey,'push_agent');
 assert.equal(native.playing.key,panRecord.key);
 assert.equal(native.playing.position,155_000);

 panRecord.position=277_000;panRecord.createTime=9000;
 assert.equal(await rearm({playerReturn:true}),true,'a second Pan-derived exact playback return is rearmed');
 assert.equal(c.state.detailPlayerReturn.nativeHistoryKey,panRecord.key);
 assert.equal(continueText.textContent,'续播');
 assert.equal(button.dataset.mode,'CONTINUE');
 assert.equal(button.dataset.playState,'ready');
 assert.equal(await c.requestDetailPlayback(item),true);
 assert.equal(calls.filter(call=>call.method==='player.playVod').at(-1).payload.historyRecordRef.siteKey,'push_agent');
 assert.equal(native.playing.position,277_000,'repeated Pan resume uses the latest saved progress');
 c.sdk=priorSdk;c.$=()=>null;c.state.selected=null;c.state.detailPlayback=null;c.state.detailPlayerReturn=null;
 native.historyQueue=null;
});
await test('out-of-order Native reads preserve the committed progress and order',async()=>{
 native.legacy=false;native.envelope=null;native.historyQueue=[];
 native.rows=[raw('A',{position:10_000,duration:1_000_000,createTime:1000}),raw('B',{position:20_000,duration:1_000_000,createTime:2000})];
 c.state.activeList='all';c.state.recent.items=load();c.state.recent.loaded=true;c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 c.tvBrowseActive=()=>true;
 const stale=read();const pending=c.loadRecentList({refresh:true,silent:true,reconcileDetail:false});
 await waitFor(()=>native.historyQueue.length===1);
 native.rows[0]=Object.assign({},native.rows[0],{position:124000,createTime:3000});const fresh=read();
 handleHistoryChange({detail:{version:1}});
 assert.equal(c.state.recent.activeRun.invalidated,true);
 native.historyQueue.shift()(stale);
 await waitFor(()=>native.historyQueue.length===1);
 native.historyQueue.shift()(fresh);
 await pending;
 assert.equal(c.state.recent.items.length,2);
 assert.equal(c.state.recent.items[0].nativeHistoryKey,native.rows[0].key,'updated record becomes most recent');
 assert.equal(c.state.recent.items[0].position,124000,'stale response never overwrites the committed progress');
 assert.equal(c.state.recent.nativeHistoryCommittedRevision,c.state.recent.nativeHistoryRevision);
});
await test('inactive Native event remains pending until the next history read',async()=>{
 native.historyQueue=null;native.envelope=null;c.tvBrowseActive=()=>false;
 const readsBefore=calls.filter(call=>call.method==='app.history').length;
 native.rows[1]=Object.assign({},native.rows[1],{position:456000,createTime:4000});
 handleHistoryChange({detail:{version:1}});
 assert.equal(c.nativeHistoryRefreshPending(),true);
 assert.equal(calls.filter(call=>call.method==='app.history').length,readsBefore,'inactive page does not start an unrelated read');
 c.tvBrowseActive=()=>true;
 await c.loadRecentList({silent:true,reconcileDetail:false});
 assert.equal(c.nativeHistoryRefreshPending(),false);
 assert.equal(c.state.recent.items[0].nativeHistoryKey,native.rows[1].key);
 assert.equal(c.state.recent.items[0].position,456000);
 assert.equal(calls.filter(call=>call.method==='app.history').length,readsBefore+1,'pending revision forces a fresh read despite the normal Recent TTL');
});
await test('three consecutive post-playback Native events commit progress and ordering',async()=>{
 native.legacy=false;native.envelope=null;native.historyQueue=null;native.historyFailureCount=0;
 native.rows=[raw('A',{position:10000,duration:1000000,createTime:1000}),raw('B',{position:20000,duration:1000000,createTime:2000}),raw('C',{position:30000,duration:1000000,createTime:3000})];
 c.tvBrowseActive=()=>true;c.state.activeList='all';c.state.recent.items=load();c.state.recent.loaded=true;
 c.state.recent.loading=false;c.state.recent.loadingPromise=null;c.state.recent.pendingRefresh=false;
 c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 for(let cycle=1;cycle<=3;cycle++){
  const key=['A','B','C'][cycle-1]+'@@@vod@@@7';
  const row=native.rows.find(item=>item.key===key);
  row.position=cycle*111000;row.duration=1000000;row.createTime=10000+cycle*1000;
  native.rows.sort((a,b)=>Number(b.createTime||0)-Number(a.createTime||0));
  handleHistoryChange({detail:{version:1}});
  const pending=c.state.recent.loadingPromise;
  assert.ok(pending,`cycle ${cycle} starts a Native History read`);
  await pending;
  assert.equal(c.state.recent.items[0].nativeHistoryKey,key,`cycle ${cycle} commits the latest Native ordering`);
  assert.equal(c.state.recent.items.find(item=>item.nativeHistoryKey===key).position,cycle*111000,`cycle ${cycle} commits the current progress`);
  assert.equal(c.state.recent.items.every(item=>item.recentWatching===true),true,`cycle ${cycle} preserves history interaction metadata`);
  assert.equal(c.state.recent.nativeHistoryCommittedRevision,c.state.recent.nativeHistoryRevision,`cycle ${cycle} consumes its invalidation`);
 }
 native.rows=[raw('A',{position:10000,duration:1000000,createTime:1000}),raw('B',{position:20000,duration:1000000,createTime:2000}),raw('C',{position:30000,duration:1000000,createTime:3000})];
 c.state.recent.items=load();c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
});
await test('opening history during an older in-flight read queues a trailing Native refresh',async()=>{
 native.envelope=null;native.historyQueue=[];c.tvBrowseActive=()=>false;
 c.state.activeList='all';c.state.recent.items=load();c.state.recent.loaded=true;
 c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 const stale=read();const pending=c.loadRecentList({refresh:true,silent:true,reconcileDetail:false});
 await waitFor(()=>native.historyQueue.length===1);
 native.rows[0]=Object.assign({},native.rows[0],{position:333000,createTime:5000});native.rows.sort((a,b)=>Number(b.createTime||0)-Number(a.createTime||0));const fresh=read();
 handleHistoryChange({detail:{version:1}});
 assert.equal(c.nativeHistoryRefreshPending(),true);
 c.tvBrowseActive=()=>true;
 c.loadRecentList({silent:true,reconcileDetail:false});
 assert.equal(c.state.recent.activeRun.invalidated,true,'the pre-event read cannot commit as the latest view-open result');
 native.historyQueue.shift()(stale);
 await waitFor(()=>native.historyQueue.length===1);
 native.historyQueue.shift()(fresh);
 await pending;
 assert.equal(c.state.recent.items[0].position,333000);
 assert.equal(c.state.recent.items[0].nativeHistoryKey,native.rows[0].key);
 assert.equal(c.nativeHistoryRefreshPending(),false);
 native.historyQueue=null;
});
await test('a transient Native read failure after deletion preserves the last-good list and retries the pending revision',async()=>{
 native.historyQueue=null;native.envelope=null;native.legacy=false;
 native.rows=[raw('A',{position:10000,duration:1000000,createTime:1000}),raw('B',{position:20000,duration:1000000,createTime:2000}),raw('C',{position:30000,duration:1000000,createTime:3000})];
 c.state.activeList='all';c.tvBrowseActive=()=>true;c.state.recent.items=load();c.state.recent.loaded=true;
 c.state.recent.loading=false;c.state.recent.loadingPromise=null;c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 c.state.recent.error='stale transient read error';
 const deleted=c.state.recent.items[0];
 const deleteResults=await c.deleteHistoryRecords([deleted]);
 assert.equal(deleteResults[0].status,'DELETED');assert.equal(c.state.recent.items.length,2);assert.equal(c.state.recent.error,'','a verified delete readback clears a stale read error');
 assert.ok(c.state.recent.items.every(item=>item.recentWatching===true),'authoritative delete readback keeps every remaining record interactive');
 c.tvBrowseActive=()=>true;c.tvBrowseState=()=>({view:'history'});
 const remainingCards=c.state.recent.items.map(item=>({__mediaItem:item,isConnected:true,
  classList:{contains:name=>name==='recent-watching-card'},
  closest(selector){return selector==='.recent-watching-card'||selector==='#tvBrowseRail'?this:null;}}));
 assert.ok(remainingCards.every(card=>c.recentWatchingCard(card)===card&&c.recentWatchingPressKey(card)),
  'remaining records retain the exact card and remote-key recognition gates used by TV history');
 native.rows[0]=Object.assign({},native.rows[0],{position:156000,createTime:5000});native.historyFailureCount=1;
 const readsBefore=calls.filter(call=>call.method==='app.history').length;
 handleHistoryChange({detail:{version:1}});
 await c.state.recent.loadingPromise;
 assert.equal(calls.filter(call=>call.method==='app.history').length,readsBefore+2,'one failed Native read is followed by one bounded retry');
 assert.equal(c.state.recent.items.length,2,'a failed response cannot erase the verified post-delete list');
 assert.equal(c.state.recent.items[0].nativeHistoryKey,native.rows[0].key,'retry commits the latest post-delete ordering');
 assert.equal(c.state.recent.items[0].position,156000,'retry commits current Native progress');
 assert.equal(c.nativeHistoryRefreshPending(),false,'successful retry consumes the pending Native revision');
});
await test('failed bounded retry preserves history and a later Native read can consume the revision',async()=>{
 native.historyQueue=null;native.envelope=null;native.historyFailureCount=2;
 c.state.activeList='all';c.tvBrowseActive=()=>true;c.state.recent.items=load();c.state.recent.loaded=true;
 c.state.recent.loading=false;c.state.recent.loadingPromise=null;c.state.recent.nativeHistoryRevision=0;c.state.recent.nativeHistoryCommittedRevision=0;
 const expectedCount=c.state.recent.items.length, readsBefore=calls.filter(call=>call.method==='app.history').length;
 handleHistoryChange({detail:{version:1}});
 await c.state.recent.loadingPromise;
 assert.equal(calls.filter(call=>call.method==='app.history').length,readsBefore+2,'one event is limited to its initial read and one recovery retry');
 assert.equal(c.state.recent.items.length,expectedCount,'two failed reads retain the last-good list');
 assert.equal(c.nativeHistoryRefreshPending(),true,'failed bounded recovery must not consume the Native revision');
 native.historyFailureCount=0;
 await c.loadRecentList({silent:true,reconcileDetail:false});
 assert.equal(c.nativeHistoryRefreshPending(),false,'a later view read recovers the pending Native revision');
});
await test('a distinct player return during the refresh transaction is queued without extending the duplicate grace lock',async()=>{
 const resume=source('22-snapshot-resume-boot.js');
 const start=resume.indexOf('    function schedulePlayerReturn(options)');
 const end=resume.indexOf('    async function rearmDetailPlaybackAfterPlayerReturn(options)',start);
 assert.ok(start>=0&&end>start,'the production player-return scheduler is extractable');
 let runs=0,releaseFirst;
 const scheduler=vm.createContext({
  state:{resume:{timer:0},pan:{playbackReturn:false}},
  console:{debug(){}},
  setTimeout,clearTimeout,
  $:()=>null,
  nativeSearchReturnMarkerFor:()=>null,
  isRecentNativeHomeReturn:()=>false,
  readUiSnapshot:async()=>null,
  handleWebHomeResume:()=>{runs++;return runs===1?new Promise(resolve=>{releaseFirst=resolve;}):Promise.resolve();}
 });
 vm.runInContext(resume.slice(start,end),scheduler,{filename:'22-snapshot-resume-boot.js'});
 scheduler.schedulePlayerReturn({playerReturn:true});
 await waitFor(()=>runs===1);
 scheduler.schedulePlayerReturn({playerReturn:true});
 assert.equal(scheduler.schedulePlayerReturn._playerReturnPending,true,'a new Native handoff must survive an active return transaction');
 releaseFirst();
 await waitFor(()=>runs===2);
 assert.equal(scheduler.schedulePlayerReturn._playerReturnPending,false);
 assert.equal(scheduler.schedulePlayerReturn._running,false,'the active lock must end with the transaction');
 assert.ok(scheduler.schedulePlayerReturn._graceUntil>Date.now(),'duplicate lifecycle notifications retain a separate grace window');
 scheduler.schedulePlayerReturn({playerReturn:true});
 await waitFor(()=>runs===3);
 assert.equal(scheduler.schedulePlayerReturn._running,false,'a distinct return inside the grace window starts a fresh transaction');
 scheduler.scheduleWebHomeResume({force:true});
 await new Promise(resolve=>setTimeout(resolve,100));
 assert.equal(runs,3,'a generic duplicate resume remains suppressed during the grace window');
});
await test('E01_E05 independent sources are not collapsed by HTML',()=>{native.rows=[raw('A'),raw('B',{createTime:2000})];assert.equal(load().length,2);});
await test('E03_E11 same-key seasons differ and no-TMDB record stays keyed',()=>{
 native.rows=[raw('A',{mediaType:'tv',tmdbSeasonNumber:2,tmdbEpisodeNumber:5}),raw('A',{kind:'SEASON',mediaType:'tv',tmdbSeasonNumber:0,tmdbEpisodeNumber:1}),raw('B',{tmdbId:0})];
 const items=load();assert.equal(items.length,3);assert.notEqual(items[0].id,items[1].id);assert.equal(items.find(i=>i.historyRecordRef.kind==='SEASON').seasonNumber,0);
});
await test('E07_E08 actual SDK transmits selected A identity despite newer B',async()=>{
 native.rows=[raw('A'),raw('B',{createTime:9000})];const a=load().find(i=>i.siteKey==='A');await c.playNativeHistoryExact(a);
 assert.equal(native.playing.key,a.nativeHistoryKey);assert.equal(native.playing.position,50_000);
 const request=calls.at(-1);assert.equal(request.payload.intent,'history_exact');assert.equal(request.payload.historyRecordRef.cid,7);
});
await test('E10 deleted reference rejects rather than ordinary VOD fallback',async()=>{
 const a=load().find(i=>i.siteKey==='A');native.rows=native.rows.filter(r=>r.key!==a.nativeHistoryKey);
 await assert.rejects(c.playNativeHistoryExact(a));assert.equal(calls.at(-1).payload.intent,'history_exact');
});
await test('E12_E13 management selections count separate same-work records',()=>{
 native.rows=[raw('A'),raw('B')];const items=load();assert.equal(c.recentManageItems().length,2);
 c.state.recentManage={selectedKeys:{[c.recentHistoryItemKey(items[1])]:true}};
 assert.equal(c.recentManageSelectedItems().length,1);assert.equal(c.recentManageSelectedItems()[0].siteKey,'B');
});
await test('E14_E18 exact deletion preserves A and reports partial failure per identity',async()=>{
 native.rows=[raw('A'),raw('B'),raw('C')];const selected=load().filter(i=>i.siteKey!=='A');native.failKey=selected[1].nativeHistoryKey;
 const results=await c.deleteHistoryRecords(selected);assert.equal(results.filter(r=>r.status==='DELETED').length,1);assert.equal(results.filter(r=>r.status==='FAILED').length,1);
 assert.deepEqual(native.rows.map(r=>r.key),['A@@@vod@@@7','C@@@vod@@@7']);assert.equal(c.state.recent.items.length,2);native.failKey='';
});
await test('E19 permission denied never removes the displayed native item',async()=>{
 native.permission=false;const before=native.rows.length;const result=await c.deleteHistoryRecords([load()[0]]);
 assert.equal(result[0].status,'FAILED');assert.equal(native.rows.length,before);native.permission=true;
});
await test('E20 old SDK list remains displayable but precise operations are disabled',async()=>{
 native.legacy=true;const response=await c.readNativeHistoryForUi();const items=c.normalizeHistoryList(response);assert.ok(items.length);
 c.state.recent.referenceVersion=0;const before=calls.length;await assert.rejects(c.playNativeHistoryExact(items[0]));
 const result=await c.deleteHistoryRecords([items[0]]);assert.equal(result[0].status,'UNSUPPORTED');assert.equal(calls.length,before);
 native.legacy=false;c.state.recent.referenceVersion=1;
});
await test('E04 cross-CID reference is not presented as exactly playable',async()=>{
 native.rows=[raw('A',{key:'A@@@vod@@@8',cid:8})];const item=load()[0];assert.equal(item.historyCanResumeExact,false);assert.equal(item.historyCanPlayExact,false);await assert.rejects(c.playNativeHistoryExact(item));
});
await test('failed zero-progress exact start releases the marker and permits retry',async()=>{
 native.rows=[raw('A',{position:0,duration:0})];const item=load()[0];
 assert.equal(item.historyCanResumeExact,false);assert.equal(item.historyCanPlayExact,true);
 native.playFailure=true;await assert.rejects(c.playNativeHistoryExact(item),/fixture playback failure/);
 assert.equal(localStore.has('fm_pan_playing'),false,'failed handoff must not leave the duplicate-play lock set');
 native.playFailure=false;await c.playNativeHistoryExact(item);
 assert.equal(native.playing.key,item.nativeHistoryKey,'retry must keep the same exact History identity');
 assert.equal(localStore.get('fm_pan_playing'),'1');localStore.delete('fm_pan_playing');
});
await test('native fields map flag binding and distinguish unknown season from zero',()=>{
 const item=c.normalizeHistoryItem(raw('A',{mediaType:'tv',tmdbSeasonNumber:2,tmdbEpisodeNumber:7,vodFlag:'line2',sourceBindingKey:'line2#1'}),0);
 assert.equal(item.seasonNumber,2);assert.equal(item.episodeNumber,7);assert.equal(c.historyPlaybackContext(item.nativeHistoryRaw).flag,'line2');
 assert.equal(c.normalizeHistoryItem(raw('A',{mediaType:'tv',tmdbSeasonNumber:0,tmdbEpisodeNumber:0}),0).seasonNumber,-1);
});
await test('source contracts split fresh detail playback from explicit exact history',()=>{
 const bridge=fs.readFileSync(new URL('../../app/app/src/main/java/com/fongmi/android/tv/web/HomeWebBridge.java',import.meta.url),'utf8');
 const recent=source('15a-history-recent-continue.js');
 assert.ok(bridge.includes('return App.gson().toJson(History.get());'));
 assert.ok(bridge.includes('VideoActivity.startFromWebHome'));
 assert.ok(!bridge.includes('findResumeHistory(playSiteKey, vodId)'));
 assert.ok(bridge.includes('VideoActivity.startHistoryExact'));
 assert.ok(recent.includes('const ref = historyRecordReference(item)'));
 assert.ok(recent.includes('{ intent: "history_exact", historyRecordRef: ref }'));
});
await test('E26 seasonal projection becomes current row without losing selected source focus',()=>{
 native.rows=[raw('A',{kind:'SEASON',mediaType:'tv',tmdbSeasonNumber:1,tmdbEpisodeNumber:3}),raw('B',{mediaType:'tv',tmdbSeasonNumber:1,tmdbEpisodeNumber:4})];
 const saved=c.mediaDomKey(load()[0]);
 native.rows=[raw('B',{mediaType:'tv',tmdbSeasonNumber:1,tmdbEpisodeNumber:4}),raw('A',{mediaType:'tv',tmdbSeasonNumber:1,tmdbEpisodeNumber:3,position:90_000})];
 const current=load();assert.equal(c.historyRecordFocusItem(current,saved).siteKey,'A');
 assert.equal(c.historyRecordFocusItem(current,saved).position,90_000);
 native.rows=[raw('B',{mediaType:'tv',tmdbSeasonNumber:1,tmdbEpisodeNumber:4})];assert.equal(c.historyRecordFocusItem(load(),saved),null);
});
await test('E27 PUSH URL stays exact without fuzzy title conversion',async()=>{
 const url='https://example.test/video.mp4?a=1&b=2';
 native.rows=[raw('push',{key:'push@@@'+url+'@@@7',tmdbId:0})];const item=load()[0];
 await c.playNativeHistoryExact(item);const request=calls.at(-1).payload;
 assert.equal(request.vodId,url);assert.equal(request.historyRecordRef.historyKey,native.rows[0].key);
 assert.equal(request.intent,'history_exact');
});
if(process.env.WEBHOME_MULTI_SOURCE_FIXTURE_PATH) await test('MULTI_SOURCE_NATIVE_CAPABILITY_TO_HTML_EXACT_HANDOFF',async()=>{
 const records=JSON.parse(fs.readFileSync(process.env.WEBHOME_MULTI_SOURCE_FIXTURE_PATH,'utf8'));
 assert.equal(records.length,3,'ordinary video, disk-share and PUSH video fixtures');
 native.envelope={version:1,mode:'independent',records,legacy:records};
 native.rows=records;
 const items=c.normalizeHistoryList(await c.readNativeHistoryForUi());c.state.recent.items=items;assert.equal(items.length,3);
 for(const item of items){
  const rawRecord=records.find(row=>row.key===item.nativeHistoryKey);
  assert.equal(item.historyCanResumeExact,true);assert.equal(item.historyCapabilityReason,'');
  assert.equal(item.position,rawRecord.position);assert.equal(item.duration,rawRecord.duration);
  const before=calls.filter(call=>call.method==='player.playVod').length;
  await c.playNativeHistoryExact(item);
  const request=calls.at(-1).payload;
  assert.equal(request.intent,'history_exact');assert.equal(request.siteKey,'push_agent');
  assert.equal(request.vodId,rawRecord.historyRecordRef.vodId);
  assert.deepEqual(request.historyRecordRef,rawRecord.historyRecordRef);
  assert.equal(calls.filter(call=>call.method==='player.playVod').length,before+1);
  assert.equal(native.playing.key,rawRecord.key);assert.equal(native.playing.position,rawRecord.position);
 }
  const denied={...records[0],canPlayExact:false,canResume:false,capabilityReason:'原历史站源不可用',position:0};
 native.envelope={version:1,mode:'independent',records:[denied],legacy:[denied]};native.rows=[denied];
 const item=c.normalizeHistoryList(await c.readNativeHistoryForUi())[0];assert.equal(item.historyCanResumeExact,false);assert.equal(item.historyCanPlayExact,false);
 const before=calls.filter(call=>call.method==='player.playVod').length;
 await assert.rejects(()=>c.playNativeHistoryExact(item),/原历史站源不可用/);
 assert.equal(calls.filter(call=>call.method==='player.playVod').length,before);
 native.envelope=null;
});
if(process.env.WEBHOME_HISTORY_LOSS_FIXTURE_PATH) await test('LOSS_NATIVE_BRIDGE_FIXTURES_KEEP_TWO_WORKS_WITH_INDEPENDENT_CAPABILITIES',async()=>{
 const fixtures=JSON.parse(fs.readFileSync(process.env.WEBHOME_HISTORY_LOSS_FIXTURE_PATH,'utf8'));
 assert.equal(fixtures.length,9);
 for(const fixture of fixtures) {
   native.envelope=fixture.independent;
   const response=await c.readNativeHistoryForUi();
   const items=c.normalizeHistoryList(response);c.state.recent.items=items;
   assert.equal(fixture.legacy.length,2);assert.equal(response.records.length,2);assert.equal(items.length,2);
   assert.equal(new Set(items.map(c.recentHistoryItemKey)).size,2);
   assert.equal(c.recentManageItems().length,2);
   const b=items.find(i=>i.historyRecordRef.siteKey==='B');assert.ok(b);
   assert.equal(b.historyCanResumeExact,response.records.find(r=>r.tmdbId===99).canResume);
   assert.equal(b.historyCanPlayExact,response.records.find(r=>r.tmdbId===99).canPlayExact);
   if(!b.historyCanPlayExact) {
     const before=calls.length;await assert.rejects(c.playNativeHistoryExact(b));assert.equal(calls.length,before);
   }
   const legacy=c.normalizeHistoryList(fixture.legacy);assert.equal(legacy.length,2);
 }
 const noMetadata=JSON.parse(JSON.stringify(fixtures[0].independent));
 const b=noMetadata.records.find(r=>r.tmdbId===99);delete b.tmdbId;delete b.mediaType;delete b.duration;delete b.position;
 b.historyRecordRef.tmdbId=0;b.historyRecordRef.mediaType='';
 assert.equal(c.normalizeHistoryList(noMetadata).length,2,'missing metadata and progress do not remove a valid native identity');
 native.envelope=null;
});
await test('LOSS_MISSING_PROGRESS_DOES_NOT_HIDE_WORK_AND_DOES_NOT_BLOCK_EXACT_START',async()=>{
 for(const fields of [{position:0,duration:500_000},{position:0,duration:0},{position:undefined,duration:undefined}]) {
   native.rows=[raw('A'),raw('B',{vodName:'Other work',tmdbId:0,mediaType:'',...fields})];
   const items=load();assert.equal(items.length,2);assert.equal(new Set(items.map(c.recentHistoryItemKey)).size,2);
   const b=items.find(i=>i.siteKey==='B');assert.equal(b.historyCanResumeExact,false);assert.equal(b.historyCanPlayExact,true);
   assert.equal(c.detailHasAuthoritativeNativeHistory(b),false,'detail resume still requires a valid progress point');
   const before=calls.length;await c.playNativeHistoryExact(b);assert.equal(calls.length,before+1);
   assert.equal(calls.at(-1).payload.historyRecordRef.historyKey,b.nativeHistoryKey);
   assert.equal(native.playing.key,b.nativeHistoryKey);
 }
});
await test('DETAIL_RETURN_REQUIRES_A_VALID_PROGRESS_POINT_BUT_ZERO_POINT_HISTORY_REMAINS_PLAYABLE',()=>{
 for(const row of [
   raw('A',{position:0,duration:500_000,canPlayExact:true,canResume:false}),
   raw('A',{position:50_000,duration:0,canPlayExact:true,canResume:false}),
   raw('A',{position:50_000,duration:undefined,canPlayExact:true,canResume:false})
 ]) {
   const item=c.normalizeHistoryItem({...row,historyRecordRef:refOf(row)},0);
   assert.equal(c.detailHasAuthoritativeNativeHistory(item),false);
   assert.equal(c.nativeHistoryRecordCanPlayExact(item),true,'exact history entry may still start from the top');
 }
 const valid=raw('A',{position:50_000,duration:500_000,canPlayExact:true,canResume:true});
 const item=c.normalizeHistoryItem({...valid,historyRecordRef:refOf(valid)},0);
 assert.equal(c.detailHasAuthoritativeNativeHistory(item),true,'valid progress remains eligible for same-detail continuation');
});
console.log(JSON.stringify({layer:'HTML_WITH_ACTUAL_APP_SDK_EXPRESSIONS_AND_ISOLATED_NATIVE_TRANSPORT',results},null,2));
