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
const native={rows:[],legacy:false,permission:true,failKey:'',playing:null};
const raw=(site,extra={})=>({key:site+'@@@vod@@@7',cid:7,vodName:'Example',vodPic:'/poster.jpg',mediaType:'movie',tmdbId:42,position:50_000,duration:500_000,createTime:1000,...extra});
const refOf=row=>({version:1,kind:row.kind||'ITEM',historyKey:row.key,cid:row.cid,siteKey:row.key.split('@@@')[0],vodId:row.key.split('@@@')[1],mediaType:row.mediaType,tmdbId:row.tmdbId,seasonNumber:row.tmdbSeasonNumber??-1,updatedAt:row.createTime,scopeToken:'fixture-'+row.createTime});
const id=ref=>JSON.stringify([1,ref.kind,ref.cid,ref.historyKey,ref.kind==='SEASON'?ref.mediaType:'',ref.kind==='SEASON'?ref.tmdbId:0,ref.kind==='SEASON'?ref.seasonNumber:-1]);
const read=()=>native.legacy?native.rows.map(row=>({...row})):{version:1,mode:'independent',records:native.rows.map(row=>({...row,historyRecordRef:refOf(row),canResume:row.cid===7,canDelete:true,sourceLabel:row.key.split('@@@')[0],deleteScope:row.kind||'ITEM'})),legacy:native.rows.filter(row=>row.cid===7&&!row.kind).map(row=>({...row}))};
async function invoke(method,payload){
 calls.push({method,payload:JSON.parse(JSON.stringify(payload))});
 if(method==='app.history')return payload.mode==='independent'?read():native.rows.map(row=>({...row}));
 if(method==='player.playVod'){
   const ref=payload.historyRecordRef;
   if(payload.intent!=='history_exact')return {};
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
 state:{recent:{items:[],loaded:true,referenceVersion:1},historyContexts:{loaded:true,entries:[]},continueIndex:{loaded:true,entries:[]}},
 document:{activeElement:null},localStorage:{setItem(){},removeItem(){}},
 normalizeTitle:s=>String(s||'').trim().toLowerCase(),resolvePanProviderForHistory:()=>'',isTvDiagnosticEnabled:()=>false,
 secondaryActiveQuery:()=>null,panSearchItemKey:i=>i.mediaType+':'+i.tmdbId,toast(){},
 rememberHomeReturn(){},rememberDetailReturn(){},saveUiSnapshotNow(){},rememberWatchIntent(){},startWatchTracking(){},
 playbackOriginForNativeIdentity:()=> 'native-vod'
});
for(const name of ['06-tmdb-history-model.js','15a-history-recent-continue.js','08b-native-history-delete.js','08a-catalog-recent-management.js','07-detail-playback-race.js']) vm.runInContext(source(name),c,{filename:name});
vm.runInContext(source('19-pan-results-handoff-return.js').split('    function panHealthKey')[0],c);
c.saveHistoryPlaybackContext=async()=>{};
vm.runInContext('const contractSdk={vod:'+expressions.vod+',history:'+expressions.history+',historyDelete:'+expressions.historyDelete+'}; function sdk(){return contractSdk;}',c);
const results=[];
async function test(name,fn){await fn();results.push(name);console.log(name+' = PASS');}
function load(){c.state.recent.items=c.normalizeHistoryList(read());return c.state.recent.items;}
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
await test('E04 cross-CID reference is not presented as resumable',async()=>{
 native.rows=[raw('A',{key:'A@@@vod@@@8',cid:8})];const item=load()[0];assert.equal(item.historyCanResumeExact,false);await assert.rejects(c.playNativeHistoryExact(item));
});
await test('native fields map flag binding and distinguish unknown season from zero',()=>{
 const item=c.normalizeHistoryItem(raw('A',{mediaType:'tv',tmdbSeasonNumber:2,tmdbEpisodeNumber:7,vodFlag:'line2',sourceBindingKey:'line2#1'}),0);
 assert.equal(item.seasonNumber,2);assert.equal(item.episodeNumber,7);assert.equal(c.historyPlaybackContext(item.nativeHistoryRaw).flag,'line2');
 assert.equal(c.normalizeHistoryItem(raw('A',{mediaType:'tv',tmdbSeasonNumber:0,tmdbEpisodeNumber:0}),0).seasonNumber,-1);
});
await test('source contracts keep no-option legacy read and detail default intent intact',()=>{
 const bridge=fs.readFileSync(new URL('../../app/app/src/main/java/com/fongmi/android/tv/web/HomeWebBridge.java',import.meta.url),'utf8');
 assert.ok(bridge.includes('return App.gson().toJson(History.get());'));assert.ok(bridge.includes('History resume = findResumeHistory(playSiteKey, vodId);'));
 assert.ok(source('15a-history-recent-continue.js').includes('const ref = !opts.detail && historyRecordReference(item)'));
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
console.log(JSON.stringify({layer:'HTML_WITH_ACTUAL_APP_SDK_EXPRESSIONS_AND_ISOLATED_NATIVE_TRANSPORT',results},null,2));
