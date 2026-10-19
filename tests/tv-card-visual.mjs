import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
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
const hook = `window.testBrowse = { state, mediaCard, renderTvBrowse, tvBrowseState, tvBrowsePreview, tvBrowseSelectColumn, syncBrowseDevicePresentation,
 tvBrowseBeginStartup, homeFocusUserEpoch };
 window.testBrowse.setup = () => {
   syncBrowseDevicePresentation(); bindActions(); installRemoteKeys();
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
 window.testBrowse.seedHistory = () => {
   state.recent.loaded = true; state.recent.loading = false; state.recent.error = "";
   state.recent.items = Array.from({length: 3}, (_, index) => ({
     id: "history-visual-" + index, title: "历史影片" + index, mediaType: "movie", source: "history",
     pic: "/history-poster-" + index + ".jpg", landscape: "/history-backdrop-" + index + ".jpg"
   }));
   const ui = tvBrowseState(); ui.view = "history"; ui.filterOpen = false; ui.previewKey = "";
   renderTvBrowse({reason: "focus-visual-history"});
 };
`;
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output);
const baselineHtml=execFileSync('git',['show','1cc51d13dcbc314bcbd2facee0de8cb21b1d8252:index.html'],{encoding:'utf8',maxBuffer:4*1024*1024}).replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/,hook);
assert.notEqual(baselineHtml,html,'baseline fixture uses the actual previous DOM and CSS');
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.WEBHOME_BROWSER_EXECUTABLE ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE } : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" }) });
const errors = [];
async function pageAt(tv, viewport = { width: 1280, height: 720 }, setup = true, baseline = false) {
  const page = await browser.newPage({ viewport, ...(!tv ? { hasTouch: true, isMobile: true } : {}) });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: baseline ? baselineHtml : html });
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="342" height="513"><rect width="342" height="513" fill="#274538"/><rect x="8" y="8" width="326" height="497" fill="none" stroke="#79b39b" stroke-width="4"/></svg>' });
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

try {
 const capture=async p=>{
  const values=[];
  for(const target of ['#tvColumn-movie','#tvColumn-tv','#tvBrowseRail .card']) {
   // Compare the same active-column state in the historical fixture: current
   // builds select on focus, while the old fixture needed explicit selection.
   if(target.startsWith('#tvColumn-'))await p.evaluate(id=>testBrowse.tvBrowseSelectColumn(id),target.slice('#tvColumn-'.length));
   await p.locator(target).first().focus();await p.waitForTimeout(350);
   values.push(await p.evaluate(()=>{
    const style=el=>{const s=getComputedStyle(el);return Object.fromEntries(['backgroundColor','color','fontSize','fontWeight','border','borderRadius','boxShadow','outline','padding','width','height','transform','transitionProperty','transitionDuration','transitionTimingFunction','textOverflow','whiteSpace','overflow'].map(k=>[k,s[k]]));};
    const column=document.querySelector('#tvColumn-movie'),normal=document.querySelector('#tvColumn-documentary'),focused=document.querySelector('#tvColumn-tv');
    const line=getComputedStyle(column,'::after');
    const card=document.querySelector('#tvBrowseRail .card'),title=card.querySelector('.card-title');
    const rect=el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,yRatio:r.y/innerHeight,bottomRatio:r.bottom/innerHeight};};
    const rail=card.parentElement,poster=card.querySelector('.poster-wrap'),cols=document.querySelector('#tvBrowseColumns');
    const frame=getComputedStyle(poster,'::after');
    return {column:style(column),normal:style(normal),focused:style(focused),line:[line.width,line.height,line.backgroundColor],card:style(card),poster:style(poster),title:style(title),body:style(card.querySelector('.card-body')),rating:style(card.querySelector('.rating-badge')),
     frame:{content:frame.content,border:frame.border,borderRadius:frame.borderRadius,inset:frame.inset,pointerEvents:frame.pointerEvents,opacity:frame.opacity,transitionProperty:frame.transitionProperty,transitionDuration:frame.transitionDuration},
     layout:{info:rect(document.querySelector('#tvBrowseInfo')),columns:rect(cols),firstColumn:rect(cols.firstElementChild),rail:rect(rail),card:rect(card),poster:rect(poster),image:rect(card.querySelector('img')),title:rect(title),gap:poster.getBoundingClientRect().top-cols.getBoundingClientRect().bottom,bottomSpace:innerHeight-title.getBoundingClientRect().bottom,railGap:getComputedStyle(rail).gap},
     viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio,visual:{width:visualViewport.width,height:visualViewport.height,scale:visualViewport.scale},media:{landscape:matchMedia('(orientation:landscape)').matches,min901:matchMedia('(min-width:901px)').matches,coarse:matchMedia('(pointer:coarse)').matches,dvh:CSS.supports('height','100dvh')}}};
   }));
  }
  return values;
 };
 const screenshots=process.env.WEBHOME_VISUAL_DIR;
 if(screenshots) mkdirSync(screenshots,{recursive:true});
 for (const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540},{width:1728,height:894},{width:2048,height:930},{width:1280,height:400}]) {
  const p=await pageAt(true,viewport); await p.waitForTimeout(300);
  await p.evaluate(()=>{
   const q=testBrowse.seed('movie',3);q.hasMore=false;q.items.forEach(item=>{item.weeklyUpdateText='更新至S01E47 · 10月5日更新';});q.items[0].title='短标题';q.items[1].title='这是一个需要截断省略的很长很长的影片标题';testBrowse.tvBrowseSelectColumn('movie');
   // Exercise the real mediaCard fallback without changing catalog eligibility.
   const third=document.querySelectorAll('#tvBrowseRail .card')[2];
   third.replaceWith(testBrowse.mediaCard({...third.__mediaItem,pic:''},2,{home:true}));
   document.querySelector('#tvColumn-movie').focus();
  });
  assert.equal(await p.locator('#tvBrowseRail .card').count(),3);
  assert.ok((await p.locator('#tvBrowseRail .card img').nth(2).getAttribute('src')).startsWith('data:image/gif'));
  const inspect=()=>p.locator('#tvBrowseRail .card').first().evaluate(card=>{
   const style=el=>{const s=getComputedStyle(el);return {align:s.textAlign,outline:s.outline,shadow:s.boxShadow,border:s.borderTop,background:s.backgroundColor,width:s.width,padding:s.padding,overflow:s.overflow,whiteSpace:s.whiteSpace,ellipsis:s.textOverflow,transform:s.transform,transitionProperty:s.transitionProperty,transitionDuration:s.transitionDuration};};
   const frame=getComputedStyle(card.querySelector('.poster-wrap'),'::after');
   return {active:document.activeElement.className,card:style(card),poster:style(card.querySelector('.poster-wrap')),body:style(card.querySelector('.card-body')),title:style(card.querySelector('.card-title')),frame:{opacity:frame.opacity,transitionProperty:frame.transitionProperty,transitionDuration:frame.transitionDuration}};
  });
  await p.waitForTimeout(350);const normal=await inspect(); await p.locator('#tvBrowseRail .card').first().focus();await p.waitForTimeout(350);const focused=await inspect();
  assert.ok(focused.active.includes('card focusable'));
  for(const state of [normal,focused]) {assert.equal(state.title.align,'center');assert.equal(state.title.whiteSpace,'nowrap');assert.equal(state.title.ellipsis,'ellipsis');assert.ok(state.card.outline.includes('none'));assert.ok(state.title.outline.includes('none'));}
  assert.equal(normal.card.transform,'none');assert.equal(normal.title.width,focused.title.width);assert.ok(focused.card.transform.includes('1.04'));
  assert.equal(normal.card.transitionProperty,'transform');assert.equal(normal.card.transitionDuration,'0.17s');
  assert.equal(focused.card.transitionProperty,'transform');assert.equal(focused.card.transitionDuration,'0.17s');
  assert.equal(normal.frame.transitionProperty,'opacity');assert.equal(normal.frame.transitionDuration,'0.16s');
  await p.locator('#tvColumn-movie').focus();await p.waitForTimeout(180);const blurred=await inspect();
  assert.equal(blurred.card.transform,'none','blur settles back to the original card size');assert.equal(blurred.frame.opacity,'0','focus frame fades out');
  assert.equal(await p.locator('#tvBrowseRail .card-title').nth(1).evaluate(el=>el.scrollWidth>el.clientWidth),true);
  for(const card of await p.locator('#tvBrowseRail .card').all()) {
   await card.focus();await p.waitForTimeout(160);
   const offset=await card.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('.card-title').getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2);});
   assert.ok(offset<.1,'title box remains centered on its card');
   assert.equal(await card.locator('[tabindex],button,a,input').count(),0,'the card remains the sole focus node');
   assert.equal(await card.locator('.poster-wrap').evaluate(el=>getComputedStyle(el).borderRadius),'6px');
  }
  for(const index of [0,2]) {
   const card=p.locator('#tvBrowseRail .card').nth(index);await card.focus();await p.waitForTimeout(190);
   const bounds=await card.evaluate(el=>{const c=el.getBoundingClientRect(),r=el.parentElement.getBoundingClientRect(),s=el.nextElementSibling||el.previousElementSibling,n=s&&s.getBoundingClientRect();return {card:{left:c.left,right:c.right,top:c.top,bottom:c.bottom},rail:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},neighbor:n&&{left:n.left,right:n.right}};});
   assert.ok(bounds.card.left>=bounds.rail.left&&bounds.card.right<=bounds.rail.right,'scaled edge card remains inside the visible rail');
   assert.ok(bounds.card.top>=bounds.rail.top&&bounds.card.bottom<=bounds.rail.bottom,'scaled edge card remains inside the vertical rail slot');
   if(index===0)assert.ok(bounds.card.right<=bounds.neighbor.left,'focused first card does not cover its neighbor');
   else assert.ok(bounds.neighbor.right<=bounds.card.left,'focused last card does not cover its neighbor');
  }
  await p.locator('#tvBrowseRail .card').first().focus();
  for(let move=0;move<12;move++) await p.keyboard.press(move%2?'ArrowLeft':'ArrowRight');
  await p.waitForTimeout(180);
  assert.equal(await p.locator('#tvBrowseRail .poster-wrap').evaluateAll(els=>els.filter(el=>getComputedStyle(el,'::after').opacity==='1').length),1,'rapid focus changes leave exactly one fully visible poster frame');
  await p.evaluate(()=>testBrowse.seedHistory());
  const historyCard=p.locator('#tvBrowseRail .card').first();await historyCard.focus();await p.waitForTimeout(190);
  const historyFocus=await historyCard.evaluate(el=>({transform:getComputedStyle(el).transform,transition:getComputedStyle(el).transitionDuration,frame:getComputedStyle(el.querySelector('.poster-wrap'),'::after').opacity}));
  assert.ok(historyFocus.transform.includes('1.04'),'History rail cards use the same focused scale');
  assert.equal(historyFocus.transition,'0.17s');assert.equal(historyFocus.frame,'1');
  await p.evaluate(()=>testBrowse.tvBrowseSelectColumn('movie'));
  const ref=await pageAt(true,viewport,true,true);await ref.waitForTimeout(300);
  for(const page of [p,ref])await page.evaluate(()=>{testBrowse.seed('tv',3).hasMore=false;});
  await ref.evaluate(()=>{const q=testBrowse.seed('movie',3);q.hasMore=false;testBrowse.tvBrowseSelectColumn('movie');});
  const before=await capture(ref),after=await capture(p);
  for(let i=0;i<after.length;i++) {
   for(const key of ['backgroundColor','color','fontWeight','border','borderRadius','boxShadow','outline']) {
    assert.equal(after[i].column[key],before[i].column[key],'selected semantics unchanged');
    if(i===1) assert.equal(after[i].focused[key],before[i].focused[key],'focused capsule semantics unchanged');
   }
   assert.deepEqual(after[i].line,before[i].line);
   assert.deepEqual(after[i].line,i===0?['18px','2px','rgb(53, 224, 122)']:['auto','auto','rgba(0, 0, 0, 0)']);
   for(const key of ['fontWeight','textOverflow','whiteSpace','overflow']) assert.equal(after[i].title[key],before[i].title[key]);
   for(const key of ['padding','transform']) assert.equal(after[i].card[key],before[i].card[key]);
   assert.ok(Math.abs(after[i].layout.poster.width/after[i].layout.poster.height-2/3)<.001,'ordinary and focused posters preserve 2:3');
   assert.ok(Math.abs(parseFloat(after[i].poster.width)-parseFloat(after[i].card.width))<.1,'poster has no legacy overscan');
   assert.equal(after[i].poster.borderRadius,after[i].card.borderRadius);
   const a=after[i].layout,b=before[i].layout;
   assert.ok(Math.abs(a.firstColumn.x-a.info.x)<.1);
   assert.ok(a.poster.y>=a.rail.y && a.title.bottom<a.rail.bottom && a.card.bottom<a.rail.bottom,'focus remains within the rail clipping bounds');
   assert.ok(a.title.y>a.poster.bottom && a.card.bottom<viewport.height && a.info.bottom<a.columns.y);
   assert.deepEqual(a.image,a.poster,'image fills the independently rounded poster');
   assert.equal(after[i].frame.content,'""','the inset ring exists for both directions of opacity transition');
   assert.equal(after[i].frame.opacity,i===2?'1':'0');
   if(i===2) {assert.equal(after[i].frame.border,'2px solid rgba(255, 255, 255, 0.9)');assert.equal(after[i].frame.borderRadius,after[i].poster.borderRadius);assert.equal(after[i].frame.inset,'0px');assert.equal(after[i].frame.pointerEvents,'none');}
   assert.equal(after[i].normal.backgroundColor,'rgba(40, 40, 40, 0.18)');assert.equal(after[i].normal.boxShadow,'none');
  }
  console.log(JSON.stringify({viewport:after[2].viewport,before:before[2].layout,after:after[2].layout}));
  await ref.close();
  for(const shade of ['#dedede','#151515']) {
   await p.evaluate(color=>document.querySelectorAll('.tv-browse-backdrop').forEach(el=>el.style.backgroundImage=`linear-gradient(${color},${color})`),shade);
   for(const [name,target] of [['selected','#tvColumn-movie'],['focused','#tvColumn-tv'],['card','#tvBrowseRail .card']]) {
    await p.locator(target).first().focus();await p.waitForTimeout(350);
    if(screenshots) await p.screenshot({path:join(screenshots,`${viewport.width}-${shade==='#dedede'?'bright':'dark'}-${name}.png`)});
   }
  }
  await focus(p,'#tvColumn-movie');
  const railBefore=await p.locator('#tvBrowseRail').boundingBox();await press(p,'Enter');await press(p,'Enter');
  assert.equal(await p.locator('#tvBrowseColumns').isVisible(),false);
  assert.equal(await p.locator('#tvBrowseColumns button[tabindex="0"]').count(),0);
  assert.deepEqual(await p.locator('#tvBrowseRail').boundingBox(),railBefore,'filter visibility preserves the rail layout');
  await press(p,'ArrowDown');await press(p,'ArrowDown');await press(p,'ArrowDown');await press(p,'ArrowDown');
  assert.equal(await p.evaluate(()=>document.activeElement.closest('#tvBrowseRail')!==null),true);
  await press(p,'ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.closest('#tvBrowseFilters')!==null),true);
  await press(p,'Escape');assert.equal(await p.locator('#tvBrowseColumns').isVisible(),true);
  assert.deepEqual(await p.locator('#tvBrowseRail').boundingBox(),railBefore);
  const readability=await p.locator('#tvBrowseRail .card-title').first().evaluate(el=>{
   const s=getComputedStyle(el),probe=document.createElement('span');
   Object.assign(probe.style,{font:s.font,letterSpacing:s.letterSpacing,whiteSpace:'nowrap',position:'fixed',visibility:'hidden'});document.body.appendChild(probe);
   const widths={};for(const text of ['兰香如故影片','兰香如故片','The Crown']) {probe.textContent=text;widths[text]=probe.getBoundingClientRect().width;}probe.remove();
   return {width:el.clientWidth,widths};
  });
  assert.ok(readability.widths[viewport.height>=540?'兰香如故影片':'兰香如故片']<=readability.width,'representative Chinese title is actually readable');
  assert.ok(readability.widths['The Crown']<=readability.width,'representative English title fits');
  const slotBefore=await p.locator('.tv-browse-title').boundingBox();
  await p.evaluate(()=>testBrowse.tvBrowsePreview({...document.querySelector('#tvBrowseRail .card').__mediaItem,title:'非常长的电影标题反复描述很多文字用于检查隐藏文字不得撑高艺术标题槽位'}));
  assert.deepEqual(await p.locator('.tv-browse-title').boundingBox(),slotBefore,'long fallback title never changes the artwork slot');
  await p.evaluate(()=>document.documentElement.style.setProperty('--fm-web-height',(innerHeight*.84)+'px'));
  await p.locator('#tvBrowseRail .card').first().focus();await p.waitForTimeout(350);
  const shortHost=await p.evaluate(()=>{
   const card=document.querySelector('#tvBrowseRail .card'),poster=card.querySelector('.poster-wrap'),title=card.querySelector('.card-title');
   const c=card.getBoundingClientRect(),r=card.parentElement.getBoundingClientRect(),t=title.getBoundingClientRect(),p=poster.getBoundingClientRect();
   const infoEnd=Math.max(...Array.from(document.querySelector('#tvBrowseInfo').querySelectorAll('h1,img,#tvBrowseMeta,#tvBrowseUpdate,#tvBrowseOverview')).filter(el=>{const s=getComputedStyle(el);return s.display!=='none'&&s.visibility!=='hidden';}).map(el=>el.getBoundingClientRect().bottom));
   return {cardBottom:c.bottom,railBottom:r.bottom,posterTop:p.top,posterRatio:p.width/p.height,railTop:r.top,titleBottom:t.bottom,titleHeight:t.height,titleWidth:title.clientWidth,infoBottom:infoEnd,columnsTop:document.querySelector('#tvBrowseColumns').getBoundingClientRect().top,rootBottom:document.querySelector('#tvBrowse').getBoundingClientRect().bottom,pageOverflow:document.documentElement.scrollHeight>innerHeight+1};
  });
  assert.ok(shortHost.cardBottom<shortHost.railBottom && shortHost.titleBottom<shortHost.rootBottom && shortHost.posterTop>shortHost.railTop);
  assert.equal(shortHost.pageOverflow,false);
  assert.ok(shortHost.infoBottom<shortHost.columnsTop,'short host information does not overlap navigation');
  assert.ok(shortHost.titleWidth>=readability.widths['兰香如故片'],'short host keeps a real readable title');
  assert.ok(Math.abs(shortHost.posterRatio-2/3)<.001,'short host resizes both dimensions together');
  console.log('SHORT_HOST_LAYOUT '+JSON.stringify({viewport,...shortHost}));
  console.log(`TV_CARD_COLUMN_VISUAL ${viewport.width}x${viewport.height} = PASS`);
  await p.close();
 }
 const mobile=await pageAt(false,{width:390,height:844});assert.equal(await mobile.locator('#tvBrowse').isVisible(),false);await mobile.close();
 assert.deepEqual(errors,[]);
} finally { await browser.close(); }
