import assert from "node:assert/strict";
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
 tvBrowseOpenHistory, tvBrowsePreview, publishHomeWeeklySnapshot, enterRecentManageMode, exitRecentManageMode,
 openDetail, closeDetail, sdk, loadRecentList, tvBrowseBeginStartup, homeFocusUserEpoch, storeMovieDetailCache, storeTvDetailCache, updateMovieReleaseStatusCards, requestMovieDetailShared, homeEnrichmentRequest, bestDetailLogo, tvBrowseClearPreview, focusRemoteTarget, artLogoResource, prepareArtLogo, renderDetailTitleLogo,
 tvBrowseRailCurrentPosition };
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
const errors = [];
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

async function round5Checks() {
  const p=await pageAt(true); await p.waitForTimeout(300);
  let movieDetails=0, catalogRequests=0;
  await p.route('**/tmdb/movie/99001?*',async route=>{movieDetails++;await new Promise(r=>setTimeout(r,100)); await route.fulfill({contentType:'application/json',body:JSON.stringify({id:99001,overview:'已有 Logo 的电影仍补全真实简介',release_date:'2024-01-01',vote_average:8.8,genres:[{id:18,name:'剧情'}]})});});
  await p.route('**/tmdb/movie/99002?*',async route=>{await new Promise(r=>setTimeout(r,350));await route.fulfill({contentType:'application/json',body:JSON.stringify({id:99002,overview:'迟到的旧电影简介'})});});
  await p.evaluate(()=>{
    const q=testBrowse.seed('movie',3);q.hasMore=false;
    q.items=q.items.map((item,index)=>Object.assign(item,{id:'tmdb:movie:'+(99001+index),tmdbId:99001+index,title:'电影'+index,listTitle:'电影',overview:'',desc:'电影 · 电影'+index,releaseDate:index===0?'':'2025-01-01',logo:index===0?'/art-existing.png':''}));
    testBrowse.storeTvDetailCache({tmdbId:99001},{id:99001,overview:'同号电视剧不能串入'});
    testBrowse.storeMovieDetailCache({tmdbId:99003},{id:99003,overview:'',release_date:'2025-01-01'});
    testBrowse.tvBrowseSelectColumn('movie');document.querySelector('#tvBrowseRail .card').focus();
  });
  await p.waitForFunction(()=>document.querySelector('#tvBrowseOverview').textContent==='已有 Logo 的电影仍补全真实简介');
  assert.equal(movieDetails,1); assert.equal(await p.locator('#tvBrowseInfo').isVisible(),true);
  assert.ok((await p.locator('#tvBrowseMeta').innerText()).includes('2024'));
  assert.ok((await p.locator('#tvBrowseMeta').innerText()).includes('8.8'));
  await p.locator('#tvBrowseRail .card').nth(1).focus();
  await p.waitForFunction(()=>testBrowse.tvBrowseState().previewDetailRequestKey==='movie:99002');
  await press(p,'ArrowRight'); await p.waitForTimeout(450);
  assert.equal(await p.locator('#tvBrowseTitle').textContent(),'电影2');assert.equal(await p.locator('#tvBrowseOverview').innerText(),'');
  assert.equal(await p.locator('#tvBrowseInfo').isVisible(),true,'missing synopsis never hides the information group');
  await focus(p,'#tvColumn-movie'); await press(p,'Enter'); await press(p,'Enter');
  await press(p,'ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.group),'region');
  await press(p,'ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.dataset.group),'genre');
  const queryBefore=await p.evaluate(()=>testBrowse.secondaryActiveQuery('movie').requestSeq);
  await press(p,'ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.dataset.group),'genre');
  assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().filterOpen),true);
  assert.equal(await p.locator('#tvBrowseInfo').isVisible(),false);
  await press(p,'Escape');assert.equal(await active(p),'tvColumn-movie');
  assert.equal(await p.evaluate(()=>testBrowse.secondaryActiveQuery('movie').requestSeq),queryBefore,'closing filters does not reload the query');
  await focus(p,'#tvColumn-movie');await press(p,'Enter');await press(p,'Enter');
  await focus(p,'#tvBrowseFilters button[data-group="sort"][data-value="hot"]');
  await press(p,'ArrowDown');assert.ok((await active(p)).includes('movie'));
  assert.equal(await p.evaluate(()=>document.activeElement.closest('#tvBrowseRail')!==null),true);
  await press(p,'ArrowRight');await press(p,'ArrowUp');
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.group+':'+document.activeElement.dataset.value),'sort:hot');
  await p.route('**/tmdb/discover/movie?*',async route=>{catalogRequests++;await new Promise(r=>setTimeout(r,350));await route.fulfill({contentType:'application/json',body:JSON.stringify({total_pages:1,results:[{id:99003,title:'筛选后电影',overview:'筛选后列表简介',poster_path:'/poster.jpg',backdrop_path:'/backdrop.jpg',release_date:'2025-01-01',genre_ids:[18],vote_average:8}]})});});
  await p.locator('#tvBrowseFilters button[data-group="sort"][data-value="rating"]').click();
  assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().filterOpen),true,'applying a condition keeps filters open');
  await press(p,'ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'rating','empty loading results retain a valid filter target');
  await p.waitForFunction(()=>testBrowse.secondaryActiveQuery('movie').loaded);
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'rating','late query does not steal filter focus');
  assert.equal(await p.evaluate(()=>testBrowse.state.homeV14.secondaryFilters.movie.sort),'rating');
  assert.equal(await p.locator('#tvBrowseOverview').innerText(),'筛选后列表简介');assert.equal(catalogRequests,1);
  await p.close();
  for (const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540}]) {
    const page=await pageAt(true,viewport);await page.waitForTimeout(300);
    await page.evaluate(()=>{testBrowse.seed('movie');testBrowse.tvBrowseSelectColumn('movie');});
    const topRects=await page.locator('#tvBrowseFunctions button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().toJSON()));
    for(const id of ['tvFunction-search','tvFunction-live','tvFunction-settings','connectionToggle']) {
      await focus(page,'#'+id);
      const f=await page.locator('#'+id).evaluate(el=>({bg:getComputedStyle(el).backgroundColor,line:getComputedStyle(el,'::after').width,outline:getComputedStyle(el).outlineStyle,transform:getComputedStyle(el.querySelector('span,svg')).transform,filter:getComputedStyle(el.querySelector('span,svg')).filter}));
      assert.equal(f.line,id==='tvFunction-search'?'auto':'18px');assert.equal(f.outline,'none');assert.ok(f.transform.includes('1.06'));assert.ok(f.filter.includes('1.18'));
      assert.equal(f.bg,id==='tvFunction-search'?'rgba(0, 0, 0, 0.12)':'rgba(0, 0, 0, 0)');
      assert.deepEqual(await page.locator('#tvBrowseFunctions button').evaluateAll(bs=>bs.map(b=>b.getBoundingClientRect().toJSON())),topRects);
    }
    await focus(page,'#tvColumn-movie');
    const pill=await page.locator('#tvColumn-movie').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,radius:getComputedStyle(el).borderRadius,line:getComputedStyle(el,'::after').width,outline:getComputedStyle(el).outlineStyle}));
    assert.deepEqual(pill,{bg:'rgba(255, 255, 255, 0.55)',color:'rgb(23, 33, 43)',radius:'999px',line:'18px',outline:'none'});
    assert.equal(await page.locator('#connectionToggle').evaluate(el=>getComputedStyle(el,'::after').content),'none','top focus marker disappears after leaving');
    await press(page,'Enter');await press(page,'Enter');
    const rows=await page.locator('#tvBrowseFilters .secondary-filter-row').evaluateAll(rows=>rows.map(row=>{const l=row.querySelector('.secondary-filter-label'),b=row.querySelector('button'),o=row.querySelector('.secondary-filter-options'),lr=l.getBoundingClientRect(),br=b.getBoundingClientRect();return {labelFont:getComputedStyle(l).fontSize,buttonFont:getComputedStyle(b).fontSize,centerDelta:(lr.top+lr.height/2)-(br.top+br.height/2),labelLeft:lr.left,optionLeft:o.getBoundingClientRect().left,labelWidth:lr.width,height:br.height,overflow:getComputedStyle(row).overflowY};}));
    assert.ok(rows.every(r=>r.labelFont===r.buttonFont && Math.abs(r.centerDelta)<.1 && r.overflow==='visible'));
    assert.ok(rows.every(r=>r.labelWidth===rows[0].labelWidth && r.optionLeft===rows[0].optionLeft && r.height===rows[0].height));
    for (const group of ['genre','region','year','sort']) {
      for (const edge of ['first','last']) {
        await page.evaluate(({group,edge})=>{const bs=document.querySelectorAll('#tvBrowseFilters button[data-group="'+group+'"]');testBrowse.focusRemoteTarget(edge==='first'?bs[0]:bs[bs.length-1]);},{group,edge});
        await page.waitForTimeout(40);
        const geometry=await page.evaluate(()=>{const b=document.activeElement,o=b.parentElement,br=b.getBoundingClientRect(),or=o.getBoundingClientRect(),panel=document.querySelector('#tvBrowseFilters').getBoundingClientRect();return {top:br.top,bottom:br.bottom,left:br.left,right:br.right,ot:or.top,ob:or.bottom,ol:or.left,orr:or.right,pt:panel.top,pb:panel.bottom,outline:getComputedStyle(b).outlineStyle,shadow:getComputedStyle(b).boxShadow};});
        assert.ok(geometry.top>=geometry.ot+2 && geometry.bottom<=geometry.ob-2 && geometry.top>=geometry.pt && geometry.bottom<=geometry.pb);
        assert.ok(geometry.left>=geometry.ol && geometry.right<=geometry.orr,'edge options are fully revealed');
        assert.equal(geometry.outline,'none');assert.ok(geometry.shadow.includes('inset'));
      }
    }
    if(process.env.WEBHOME_TEST_SCREENSHOT) {
      for(const [name,color] of [['bright','#e3dfc6'],['dark','#152433']]) {
        await page.evaluate(color=>{const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080"><rect fill="'+color+'" width="1920" height="1080"/></svg>';document.querySelector('#tvBrowseBackdrop').style.backgroundImage='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';document.querySelector('#tvBrowseBackdrop').classList.add('visible');document.querySelector('#tvBrowseBackdropNext').classList.remove('visible');testBrowse.focusRemoteTarget(document.querySelector('#tvBrowseFilters button'));},color);
        await page.waitForTimeout(250);await page.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-filters-'+name+'-'+viewport.width+'.png')});
      }
      await press(page,'Escape');await press(page,'ArrowUp');await page.waitForTimeout(60);await page.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-functions-'+viewport.width+'.png')});
    }
    console.log('ROUND5_FILTER_GEOMETRY '+viewport.width+' = '+JSON.stringify(rows));await page.close();
  }
  console.log('ROUND5_FILTER_NAV_MOVIE_PREVIEW_AND_STATES = PASS (Chromium fixtures)');
}


async function round5InteractionAndArtwork() {
  const p=await pageAt(true);await p.waitForTimeout(300);
  let queries=0;
  await p.route('**/tmdb/discover/movie?*',async r=>{queries++;const u=new URL(r.request().url());await new Promise(r=>setTimeout(r,u.searchParams.get('with_genres')==='28'?120:20));await r.fulfill({contentType:'application/json',body:JSON.stringify({total_pages:1,results:[{id:60001,title:'条件结果',poster_path:'/poster.jpg',backdrop_path:'/backdrop.jpg',release_date:'2025-01-01',genre_ids:[28]}]})});});
  await p.evaluate(()=>{testBrowse.seed('movie',3).hasMore=false;testBrowse.tvBrowseSelectColumn('movie');});
  await focus(p,'#tvColumn-movie');await press(p,'Enter');await press(p,'Enter');
  const genre='#tvBrowseFilters button[data-group="genre"][data-value="28"]';
  await p.locator(genre).click();await p.waitForFunction(()=>testBrowse.secondaryActiveQuery('movie').loaded);
  await p.locator('#tvBrowseFilters button[data-group="region"][data-value="CN"]').click();await p.waitForFunction(()=>testBrowse.secondaryActiveQuery('movie').loaded);
  await p.locator('#tvBrowseFilters button[data-group="region"][data-value="CN"]').click();
  assert.equal(await p.evaluate(()=>testBrowse.state.homeV14.secondaryFilters.movie.region),'all');
  assert.equal(await p.evaluate(()=>testBrowse.state.homeV14.secondaryFilters.movie.genre),'28');
  assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'CN');
  assert.equal(await p.locator('#tvBrowseFilters button[data-group="region"][data-value="all"]').getAttribute('aria-pressed'),'true');
  await p.waitForFunction(()=>testBrowse.secondaryActiveQuery('movie').loaded);
  const before=queries;
  await p.locator('#tvBrowseFilters button[data-group="region"][data-value="all"]').click();await p.waitForTimeout(70);assert.equal(queries,before);
  await focus(p,'#tvBrowseFilters button[data-group="sort"][data-value="rating"]');await press(p,'Enter');
  await p.waitForFunction(()=>testBrowse.secondaryActiveQuery('movie').loaded);
  await press(p,'Enter');assert.equal(await p.evaluate(()=>testBrowse.state.homeV14.secondaryFilters.movie.sort),'hot');
  await p.waitForFunction(()=>testBrowse.secondaryActiveQuery('movie').loaded);
  await press(p,'ArrowDown');assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#tvBrowseRail')),true);
  assert.equal(await p.locator('#tvBrowseFilters').isVisible(),true);
  await press(p,'ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.dataset.group+':'+document.activeElement.dataset.value),'sort:rating');
  await press(p,'ArrowDown');
  await p.evaluate(()=>testBrowse.openDetail(document.activeElement.__mediaItem,{returnTarget:document.activeElement}));await p.waitForTimeout(150);
  await press(p,'Escape');await p.waitForTimeout(300);
  assert.equal(await p.locator('#tvBrowseFilters').isVisible(),true);assert.equal(await p.evaluate(()=>!!document.activeElement.closest('#tvBrowseRail')),true);
  await press(p,'ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'rating');
  await p.evaluate(()=>{const q=testBrowse.secondaryActiveQuery('movie');q.items=[];q.hasMore=false;testBrowse.renderTvBrowse();});
  await press(p,'ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'rating','empty final results retain valid filter focus');
  await press(p,'Escape');assert.equal(await active(p),'tvColumn-movie');
  await p.close();

  const art=await pageAt(true);await art.waitForTimeout(300);
  await art.route('**/ready-art*.png',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100"><text x="10" y="70" font-size="60" fill="white">ART TITLE</text></svg>'}));
  await art.evaluate(async()=>{
    const q=testBrowse.seed('movie',3);q.hasMore=false;
    q.items.forEach((item,i)=>{item.tmdbId=62000+i;item.id=62000+i;testBrowse.storeMovieDetailCache(item,{id:item.tmdbId,images:{logos:[{file_path:'/ready-art'+i+'.png',iso_639_1:'zh'}]}});});
    testBrowse.tvBrowseSelectColumn('movie');document.querySelector('#tvBrowseRail .card').focus();
    await testBrowse.prepareArtLogo(testBrowse.artLogoResource(q.items[0],null));
    await testBrowse.prepareArtLogo(testBrowse.artLogoResource(q.items[1],null));
  });
  const direct=await art.evaluate(()=>{const card=document.querySelectorAll('#tvBrowseRail .card')[1];card.focus();return {visible:!document.querySelector('#tvBrowseLogo').hidden,text:getComputedStyle(document.querySelector('#tvBrowseTitle')).visibility};});
  assert.deepEqual(direct,{visible:true,text:'hidden'},'prepared neighbouring artwork displays synchronously');
  const overlay=await art.evaluate(()=>{const img=document.querySelector('#tvBrowseLogo').getBoundingClientRect(),text=document.querySelector('#tvBrowseTitle').getBoundingClientRect();return {imageLeft:img.left,textLeft:text.left};});
  assert.equal(overlay.imageLeft,overlay.textLeft,'artwork and text share the same title slot');
  await art.evaluate(()=>testBrowse.openDetail(document.activeElement.__mediaItem,{returnTarget:document.activeElement}));
  assert.equal(await art.locator('#detailLogoImg').isVisible(),true,'detail immediately shares ready home resource');
  assert.equal(await art.locator('#detailTitle').isVisible(),false);
  const beforeRect=await art.locator('.actions').first().boundingBox();
  await art.evaluate(()=>{const item={mediaType:'movie',tmdbId:62002,title:'中文标题也使用艺术图片'};testBrowse.state.selected=item;testBrowse.renderDetailTitleLogo(item,{id:62002,images:{logos:[{file_path:'/ready-art2.png',iso_639_1:'zh'}]}},item.title);});
  await art.waitForFunction(()=>!document.querySelector('#detailLogoImg').hidden);
  assert.equal(await art.locator('#detailTitle').textContent(),'中文标题也使用艺术图片');
  assert.deepEqual(await art.locator('.actions').first().boundingBox(),beforeRect,'artwork changes do not move detail actions');
  const detailArt=await art.locator('#detailLogoImg').boundingBox();assert.ok(detailArt.height<=96 && detailArt.width<=1280);
  if(process.env.WEBHOME_TEST_SCREENSHOT) await art.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-detail-art.png')});
  await art.evaluate(()=>{const item={mediaType:'tv',tmdbId:62002,title:'同号电视剧无图片'};testBrowse.state.selected=item;testBrowse.renderDetailTitleLogo(item,{id:62002,images:{logos:[]}},item.title);});
  assert.equal(await art.locator('#detailTitle').isVisible(),true);assert.equal(await art.locator('#detailLogoImg').isVisible(),false);
  const failure=await art.evaluate(async()=>{const Original=window.Image;window.Image=class {set src(v){this.naturalWidth=10;Promise.resolve().then(()=>this.onload());}decode(){return Promise.reject(Error('fixture decode'));}};const item={mediaType:'movie',tmdbId:63000,logo:'/decode-failure.png'};const asset=testBrowse.artLogoResource(item,null);const first=await testBrowse.prepareArtLogo(asset);const second=await testBrowse.prepareArtLogo(asset);window.Image=Original;return {first,second,failed:asset.failed};});
  assert.deepEqual(failure,{first:false,second:false,failed:true});
  if(process.env.WEBHOME_TEST_SCREENSHOT) await art.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-detail.png')});
  await art.close();console.log('ROUND5_FILTER_CANCEL_RETURN_SHARED_ARTWORK = PASS (Chromium fixtures)');
}


async function round5ArtworkLimits() {
  const p=await pageAt(true);await p.waitForTimeout(300);let requests=0;
  await p.route('**/tmdb/movie/64001?*',async r=>{requests++;await r.fulfill({contentType:'application/json',body:JSON.stringify({id:64001,overview:'直接详情简介',images:{logos:[{file_path:'/direct-art.png',iso_639_1:'en'},{file_path:'/direct-art-zh.png',iso_639_1:'zh'}]}})});});
  await p.route('**/direct-art*.png',async r=>{await new Promise(resolve=>setTimeout(resolve,90));await r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="600" height="100"><text x="0" y="70" font-size="65" fill="white">DIRECT ART</text></svg>'});});
  await p.evaluate(()=>testBrowse.openDetail({tmdbId:64001,mediaType:'movie',title:'直接进入的中文标题',source:'tmdb'}));
  await p.waitForFunction(()=>!document.querySelector('#detailLogoImg').hidden && document.querySelector('#detailLogoImg').src.endsWith('/direct-art-zh.png'));
  assert.equal(requests,1);assert.equal(await p.locator('#detailTitle').isVisible(),false);
  const anchor=await p.locator('.actions').first().boundingBox();
  await p.route('**/direct-tall.png',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="80" height="480"><rect width="80" height="480" fill="white"/></svg>'}));
  await p.evaluate(()=>{const item={tmdbId:64002,mediaType:'tv',title:'高标题',logo:'/direct-tall.png'};testBrowse.state.selected=item;testBrowse.renderDetailTitleLogo(item,null,item.title);});
  await p.waitForFunction(()=>!document.querySelector('#detailLogoImg').hidden && document.querySelector('#detailLogoImg').src.endsWith('/direct-tall.png'));
  const tall=await p.locator('#detailLogoImg').boundingBox();assert.ok(tall.height<=96 && tall.width<tall.height);assert.deepEqual(await p.locator('.actions').first().boundingBox(),anchor);
  const stale=await p.evaluate(async()=>{
    const Original=window.Image, pending=[];window.Image=class {constructor(){this.naturalWidth=100;pending.push(this);}};
    const old={tmdbId:64100,mediaType:'movie',title:'旧详情',logo:'/old-detail.png'};testBrowse.state.selected=old;testBrowse.renderDetailTitleLogo(old,null,old.title);
    const oldLoad=pending.find(i=>i.src.endsWith('/old-detail.png')).onload;
    const next={tmdbId:64100,mediaType:'tv',title:'新详情',logo:'/new-detail.png'};testBrowse.state.selected=next;testBrowse.renderDetailTitleLogo(next,null,next.title);
    pending.find(i=>i.src.endsWith('/new-detail.png')).onload();await Promise.resolve();oldLoad();await Promise.resolve();window.Image=Original;
    return {src:document.querySelector('#detailLogoImg').src,title:document.querySelector('#detailTitle').textContent};
  });assert.ok(stale.src.endsWith('/new-detail.png'));assert.equal(stale.title,'新详情');
  await p.evaluate(()=>{
    window.originalArtImage=window.Image;window.Image=class {};
    window.waitingArtItem={tmdbId:64200,mediaType:'movie',title:'有界文字兜底'};testBrowse.state.selected=waitingArtItem;
    testBrowse.renderDetailTitleLogo(waitingArtItem,null,waitingArtItem.title);
  });
  assert.equal(await p.locator('#detailTitle').isVisible(),false);
  await p.waitForTimeout(180);assert.equal(await p.locator('#detailTitle').isVisible(),true);
  await p.evaluate(()=>{testBrowse.renderDetailTitleLogo(waitingArtItem,{id:64200,images:{logos:[{file_path:'/still-pending.png',iso_639_1:'zh'}]}},waitingArtItem.title);window.Image=originalArtImage;});
  assert.equal(await p.locator('#detailTitle').isVisible(),true,'late resource discovery never restarts the waiting window');
  await p.close();assert.deepEqual(errors,[]);console.log('ROUND5_DIRECT_DETAIL_TALL_STALE_BOUNDED_TITLE = PASS (Chromium fixtures)');
}


async function filterBackAcceptance() {
  for (const zone of ['filter','card','empty']) {
    const p=await pageAt(true);await p.waitForTimeout(300);
    await p.evaluate(()=>{testBrowse.seed('movie',12).hasMore=false;testBrowse.tvBrowseSelectColumn('movie');testBrowse.state.tvFullscreen=true;window.nativeBackCalls=0;window.fm={back:()=>{nativeBackCalls++;}};});
    const railBefore=await p.locator('#tvBrowseRail').boundingBox();
    await focus(p,'#tvColumn-movie');await press(p,'Enter');await press(p,'Enter');
    assert.equal(await p.evaluate(()=>location.hash),'#tv-filters');assert.equal(await p.locator('#tvBrowseColumns').isVisible(),false);
    assert.equal(await p.evaluate(()=>document.querySelector('#tvBrowseColumns button').tabIndex),-1);
    await p.evaluate(()=>{window.columnNode=document.querySelector('#tvColumn-movie');window.initialQuery=testBrowse.secondaryActiveQuery('movie').requestSeq;});
    if(zone==='card') {
      await focus(p,'#tvBrowseFilters button[data-group="sort"][data-value="rating"]');
      await press(p,'ArrowDown');await press(p,'ArrowRight');
      await p.evaluate(()=>testBrowse.focusRemoteTarget(document.querySelectorAll('#tvBrowseRail .card')[9]));
      await p.waitForFunction(()=>!testBrowse.tvBrowseState().railScroll?.frame,{},{timeout:5000});
      await p.evaluate(()=>{window.returnCard=document.activeElement;window.returnScroll=tvBrowseRailCurrentPosition(document.querySelector('#tvBrowseRail'));window.returnIndex=testBrowse.tvBrowseState().positions[testBrowse.secondaryActiveQuery('movie').key].index;});
      await press(p,'ArrowUp');assert.equal(await p.evaluate(()=>document.activeElement.dataset.value),'rating');await press(p,'ArrowDown');
    } else if(zone==='empty') {
      await p.evaluate(()=>{const q=testBrowse.secondaryActiveQuery('movie');q.items=[];q.hasMore=false;testBrowse.renderTvBrowse();});
      await focus(p,'#tvBrowseFilters button[data-group="sort"][data-value="hot"]');await press(p,'ArrowDown');assert.equal(await p.evaluate(()=>document.activeElement.dataset.group),'sort');
    }
    await p.waitForTimeout(75);
    // Empty results intentionally show status/retry and reserve feedback space.
    // Closing filters must preserve that current layout, not the old full pool.
    const railAtClose=await p.locator('#tvBrowseRail').boundingBox();
    if(zone!=='empty')assert.deepEqual(railAtClose,railBefore);
    if(zone==='card') await p.evaluate(()=>{returnScroll=tvBrowseRailCurrentPosition(document.querySelector('#tvBrowseRail'));});
    // Native HomeWebController uses WebView.goBack(), not HTML keydown.
    await p.evaluate(()=>history.back());await p.waitForFunction(()=>!testBrowse.tvBrowseState().filterOpen);
    assert.equal(await p.locator('#tvBrowseColumns').isVisible(),true);assert.equal(await p.evaluate(()=>nativeBackCalls),0);assert.equal(await p.evaluate(()=>testBrowse.state.tvFullscreen),true);
    assert.equal(await p.evaluate(()=>columnNode===document.querySelector('#tvColumn-movie')),true);
    assert.equal(await p.evaluate(()=>testBrowse.secondaryActiveQuery('movie').requestSeq===initialQuery),true);
    assert.deepEqual(await p.locator('#tvBrowseRail').boundingBox(),railAtClose);
    assert.equal(await p.evaluate(()=>!!document.activeElement.closest('[hidden]')),false);
    if(zone==='card') {
      assert.equal(await p.evaluate(()=>document.activeElement===returnCard),true);
      assert.equal(await p.evaluate(()=>tvBrowseRailCurrentPosition(document.querySelector('#tvBrowseRail'))===returnScroll),true);
      assert.equal(await p.evaluate(()=>testBrowse.tvBrowseState().positions[testBrowse.secondaryActiveQuery('movie').key].index===returnIndex),true);
    } else assert.equal(await active(p),'tvColumn-movie');
    assert.equal(await p.evaluate(()=>location.hash),'');
    await press(p,'Escape');assert.equal(await p.evaluate(()=>nativeBackCalls),1);assert.equal(await p.evaluate(()=>testBrowse.state.tvFullscreen),false);
    await p.close();
  }
  const p=await pageAt(true);await p.waitForTimeout(300);await p.evaluate(()=>{testBrowse.seed('movie',3).hasMore=false;testBrowse.tvBrowseSelectColumn('movie');});
  await focus(p,'#tvColumn-movie');await press(p,'Enter');await press(p,'Enter');
  await press(p,'Escape');assert.equal(await active(p),'tvColumn-movie');assert.equal(await p.evaluate(()=>location.hash),'');
  await press(p,'Enter');await press(p,'Enter');
  await focus(p,'#tvBrowseFilters button[data-group="sort"][data-value="hot"]');await press(p,'ArrowDown');const saved=await active(p);await press(p,'Escape');assert.equal(await active(p),saved);
  await focus(p,'#connectionToggle');await press(p,'Enter');assert.equal(await p.evaluate(()=>location.hash),'#connection');await p.evaluate(()=>history.back());await p.waitForTimeout(200);assert.equal(await p.locator('#connectionBody').evaluate(el=>el.classList.contains('open')),false);assert.equal(await active(p),'connectionToggle');
  await p.close();assert.deepEqual(errors,[]);console.log('FILTER_NATIVE_HISTORY_BACK_AND_KEY_BACK = PASS (browser simulation; Native device boundary NOT_RUN)');
}

try {
  if(process.env.WEBHOME_TEST_CASE === "filter-back") { await filterBackAcceptance(); } else {
  if (process.env.WEBHOME_TEST_CASE !== "artwork-limits") await filterBackAcceptance();
  await round5ArtworkLimits();
  if (process.env.WEBHOME_TEST_CASE !== "artwork-limits") {
  await round5Checks();
  await round5InteractionAndArtwork();
  for (const mode of ['records', 'empty', 'failure', 'user']) {
    const initial = await pageAt(true, undefined, false);
    await initial.evaluate(() => {
      testBrowse.setup(); testBrowse.state.recent.loaded = false; testBrowse.state.recent.items = [];
      const historyResult = new Promise((resolve, reject) => { window.resolveHistory = resolve; window.rejectHistory = reject; });
      window.fm = Object.assign({}, testBrowse.sdk(), { history: () => historyResult });
      testBrowse.tvBrowseBeginStartup(testBrowse.homeFocusUserEpoch()); testBrowse.loadRecentList();
    });
    await initial.waitForFunction(() => window.resolveHistory);
    assert.equal(await initial.evaluate(() => testBrowse.tvBrowseState().column), 'recommendation', 'history never owns startup');
    if (mode === 'user') { await focus(initial, '#tvColumn-movie'); await press(initial, 'Enter'); }
    await initial.evaluate(mode => {
      if (mode === 'failure') rejectHistory(new Error('history fixture failed'));
      else resolveHistory(mode === 'records' || mode === 'user' ? [{ key: 'fixture@@@1', vodName: '有效最近观看', vodPic: '/poster.jpg', vodId: '1', createTime: Date.now() }] : []);
    }, mode);
    await initial.waitForFunction(() => !testBrowse.state.recent.loading);
    assert.equal(await initial.evaluate(() => testBrowse.tvBrowseState().column), mode === 'user' ? 'movie' : 'recommendation');
    if (mode === 'records') assert.equal(await initial.evaluate(() => document.activeElement.closest('#tvBrowseRail')?.id), 'tvBrowseRail');
    if (mode === 'failure') assert.equal(await initial.locator('#tvBrowseRetry').isVisible(), false, 'history failure does not replace recommendation');
    if (mode === 'user') assert.equal(await active(initial), 'tvColumn-movie');
    await initial.close();
  }
  const cold = await pageAt(true, undefined, false);
  await cold.evaluate(() => { window.bootTask = testBrowse.bootWithIdentityGate(); });
  await cold.waitForFunction(() => document.querySelectorAll('#tvBrowseRail .card').length > 1 && window.releaseIdentity);
  await cold.locator('#tvBrowseRail .card').nth(1).focus(); await press(cold, 'ArrowRight');
  const coldUserKey = await active(cold);
  await cold.evaluate(async () => { releaseIdentity(); await bootTask; }); await cold.waitForTimeout(300);
  assert.equal(await active(cold), coldUserKey, 'actual boot completion never steals user navigation focus');
  await cold.evaluate(() => testBrowse.tvBrowseOpenHistory());
  await cold.locator('#recentManageBtn').click();
  assert.equal(await cold.locator('#recentManageActions').isVisible(), true, 'boot binds shared history controls before first render');
  await cold.close();
  const tv = await pageAt(true);
  await tv.evaluate(() => { testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); });
  assert.equal(await tv.locator("#homeHero").count(), 0, "old Home is not instantiated on TV");
  assert.equal(await tv.locator("#homeRecentRail,#homeRecommendationRail,#homeWeeklyRail,#listStack").count(), 0);
  assert.equal(await tv.locator("#tvBrowseRail .card").count(), 18);
  assert.equal(await tv.evaluate(() => document.activeElement.closest("#tvBrowseRail")?.id), "tvBrowseRail");
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.heroTimer), 0);
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.heroFeed.loading), false);
  assert.equal(await tv.evaluate(() => Object.keys(testBrowse.state.homeV14.categoryFeeds).length), 0);
  await press(tv, "ArrowUp"); assert.equal(await active(tv), "tvColumn-recommendation");
  await press(tv, "ArrowUp"); assert.equal(await active(tv), "tvFunction-search");
  const functions = await tv.locator('#tvBrowseFunctions button').evaluateAll((buttons) => buttons.map(b => ({id:b.id, label:b.getAttribute('aria-label') || b.textContent.trim()})));
  assert.deepEqual(functions.map(b=>b.label), ['搜索','直播','历史','设置','基础设置']);
  assert.equal(await tv.locator('#connectionToggle').innerText(), '');
  for (const id of ['tvFunction-live','tvFunction-history','tvFunction-settings','connectionToggle']) {
    await press(tv, 'ArrowRight'); assert.equal(await active(tv), id);
  }
  await tv.waitForTimeout(250);
  const glass = await tv.locator('#connectionToggle').evaluate(el=>({bg:getComputedStyle(el).backgroundColor, outline:getComputedStyle(el).outlineStyle}));
  assert.equal(glass.bg, 'rgba(0, 0, 0, 0)'); assert.equal(glass.outline, 'none');
  await press(tv, "ArrowDown"); assert.equal(await active(tv), "tvColumn-recommendation");
  await press(tv, "ArrowRight"); assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "now-playing", "category focus immediately selects its content");
  await focus(tv, "#tvColumn-movie"); await press(tv, "Enter");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "movie");
  assert.equal(await tv.evaluate(() => location.hash), "");
  const normalColumnRect = await tv.locator("#tvBrowseColumns").boundingBox();
  await press(tv, "Enter");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().filterOpen), true);
  assert.equal(await tv.locator("#tvBrowseFunctions").isVisible(), false);
  assert.equal(await tv.locator("#tvBrowseInfo").isVisible(), false);
  assert.equal(await tv.evaluate(() => document.querySelector('#tvBrowseRail .card')?.tabIndex), 0);
  const filterStyle = await tv.locator('#tvBrowseFilters').evaluate(el=>({bg:getComputedStyle(el).backgroundColor, shadow:getComputedStyle(el).boxShadow}));
  assert.deepEqual(filterStyle, {bg:'rgba(0, 0, 0, 0)', shadow:'none'});
  const filterOption=await tv.locator('#tvBrowseFilters button').last().evaluate(el=>({bg:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderTopColor,blur:getComputedStyle(el).backdropFilter}));
  assert.deepEqual(filterOption,{bg:'rgba(0, 0, 0, 0)',border:'rgba(0, 0, 0, 0)',blur:'none'});
  const railRect = await tv.locator('#tvBrowseRail').boundingBox();
  const columnRect = normalColumnRect;
  assert.equal(await tv.locator('#tvBrowseColumns').isVisible(),false);
  const filterBefore = await tv.evaluate(() => document.activeElement.dataset.value);
  await press(tv, "ArrowRight");
  assert.notEqual(await tv.evaluate(() => document.activeElement.dataset.value), filterBefore);
  const railBox = await tv.locator("#tvBrowseRail").boundingBox();
  await press(tv, "Escape");
  assert.equal(await active(tv), "tvColumn-movie");
  assert.deepEqual(await tv.locator("#tvBrowseRail").boundingBox(), railBox);
  await tv.keyboard.down("Enter"); await tv.keyboard.down("Enter"); await tv.keyboard.up("Enter");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().filterOpen), false, "repeat is not double confirm");
  await tv.evaluate(() => { testBrowse.tvBrowseState().confirm = null; document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { keyCode: 23, bubbles: true })); document.activeElement.dispatchEvent(new KeyboardEvent("keyup", { keyCode: 23, bubbles: true })); });
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().filterOpen), false);
  await tv.waitForFunction(() => testBrowse.secondaryActiveQuery("movie").loaded);
  await focus(tv, "#tvColumn-movie");
  await tv.waitForTimeout(450); await press(tv, "Enter"); await press(tv, "Enter");
  await tv.locator('#tvBrowseFilters button[data-group="sort"][data-value="rating"]').click();
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.secondaryFilters.movie.sort), "rating");
  await tv.waitForFunction(() => testBrowse.secondaryActiveQuery("movie").loaded);
  assert.equal(await tv.evaluate(() => document.activeElement.dataset.value), "rating", "filter DOM focus survives result commit");
  assert.ok(await tv.locator("#tvBrowseRail .card").count(), JSON.stringify(await tv.evaluate(() => ({ query: testBrowse.secondaryActiveQuery("movie"), status: document.querySelector("#tvBrowseStatus").textContent }))));
  await press(tv, "Escape");
  assert.deepEqual(await tv.locator('#tvBrowseRail').boundingBox(), railRect);
  assert.deepEqual(await tv.locator('#tvBrowseColumns').boundingBox(), columnRect);
  await press(tv, "ArrowDown");
  // Paging uses the actual shared TMDB loader and appends without replacing the prefix.
  await tv.evaluate(() => { window.firstPoster = document.querySelector("#tvBrowseRail .card"); document.querySelector("#tvBrowseRail .card:last-child").focus(); });
  await tv.waitForFunction(() => testBrowse.secondaryActiveQuery('movie').items.length >= 40);
  // Whole pages stay in the query cache; bounded TV DOM batches are exposed
  // as focus advances. Verify every next card remains reachable, not just a count.
  for (let index = 18; index < 36; index += 1) {
    await tv.locator('#tvBrowseRail .card').nth(index).focus();
    assert.equal(await tv.evaluate(() => Number(document.activeElement.dataset.cardIndex)), index);
  }
  assert.ok(await tv.locator('#tvBrowseRail .card').count() >= 40);
  assert.equal(await tv.evaluate(() => firstPoster === document.querySelector("#tvBrowseRail .card")), true);
  await tv.evaluate(() => { document.querySelectorAll("#tvBrowseRail .card")[22].focus(); testBrowse.rememberHomeReturn(document.activeElement.__mediaItem, document.activeElement); });
  const returnKey = await active(tv);
  await tv.evaluate(() => testBrowse.restoreHomeReturn());
  assert.equal(await active(tv), returnKey);
  // The same Home return snapshot is used by real detail/native handoffs.
  const saved = await tv.evaluate(() => testBrowse.buildUiSnapshot());
  await tv.evaluate((saved) => { testBrowse.restoreTvBrowseSnapshot(saved.tvBrowse); testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); }, saved);
  assert.equal(await active(tv), returnKey);
  assert.equal(await tv.locator('#homeSidebar,#homeSidebarBackdrop,#homeMenuLauncher,#tvFunction-menu').count(), 0);
  assert.equal(await tv.evaluate(() => testBrowse.openSidebar()), false);
  await tv.evaluate(() => { window.liveCalls = 0; window.settingCalls = 0; window.fm = { openLive: () => { liveCalls++; }, openSetting: () => { settingCalls++; }, history: async () => [] }; });
  await focus(tv, '#tvFunction-live'); await press(tv, 'Enter');
  assert.equal(await tv.evaluate(() => liveCalls), 1);
  await tv.evaluate(() => testBrowse.handleWebHomeResume({ force: true })); await tv.waitForTimeout(100);
  assert.equal(await active(tv), 'tvFunction-live');
  await press(tv, 'Enter'); await press(tv, 'ArrowDown');
  await tv.evaluate(() => testBrowse.handleWebHomeResume({ force: true })); await tv.waitForTimeout(100);
  assert.equal(await active(tv), 'tvColumn-movie', 'user navigation cancels a stale Native focus return');
  await focus(tv, '#tvFunction-settings'); await press(tv, 'Enter'); assert.equal(await tv.evaluate(() => settingCalls), 1);
  assert.equal(await tv.locator('#tvFunction-keep,#tvFunction-menu').count(), 0);
  assert.equal(await tv.locator('#tvFunction-search').innerText(), '搜索');
  assert.equal(await tv.locator('#tvFunction-search svg').count(), 1);
  await tv.evaluate(() => { delete window.fm; });
  await focus(tv, '#connectionToggle'); await press(tv, 'Enter');
  assert.equal(await tv.locator('#connectionBody').evaluate(el=>el.classList.contains('open')), true);
  await press(tv, 'Escape'); await tv.waitForTimeout(150);
  assert.equal(await tv.locator('#connectionBody').evaluate(el=>el.classList.contains('open')), false);
  await focus(tv, '#tvColumn-movie');
  await tv.evaluate(() => document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true, keyCode:38, which:38})));
  assert.equal(await active(tv), 'tvFunction-search');
  await tv.waitForTimeout(75);
  await press(tv, 'Enter');
  assert.equal(await tv.locator("#searchPage").isVisible(), true);
  await tv.evaluate(() => testBrowse.closeSearchPage()); await tv.waitForTimeout(50);
  assert.equal(await active(tv), "tvFunction-search");
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "movie");
  await tv.evaluate(() => { testBrowse.state.recent.loaded = true; testBrowse.state.recent.items = [{ source: 'history', recentWatching: true, title: '无海报历史', mediaType: 'movie', tmdbId: 123, nativeHistoryKey: 'history-123' }]; testBrowse.tvBrowseOpenHistory(); });
  assert.equal(await tv.locator('#tvBrowseRail .recent-watching-card').count(), 1, "history without poster remains accessible");
  await tv.locator('#recentManageBtn').click();
  assert.equal(await tv.locator('#recentManageActions').isVisible(), true);
  await press(tv, 'Escape');
  assert.equal(await tv.locator('#recentManageActions').isVisible(), false);
  await tv.evaluate(() => testBrowse.tvBrowseSelectColumn('movie'));
  const sizes = await tv.evaluate(() => ({ doc: document.documentElement.scrollHeight, height: innerHeight, functions: document.querySelector("#tvBrowseFunctions").getBoundingClientRect().toJSON(), columns: document.querySelector("#tvBrowseColumns").getBoundingClientRect().toJSON() }));
  assert.ok(sizes.doc <= sizes.height + 1, "no whole-page vertical overflow");
  assert.ok(sizes.functions.left > 600 && sizes.columns.top >= 300 && sizes.columns.top < 420);
  if (process.env.WEBHOME_TEST_SCREENSHOT) {
    await tv.evaluate(() => document.querySelector('#tvBrowseRail .card').focus());
    await tv.waitForTimeout(200);
    await tv.screenshot({ path: process.env.WEBHOME_TEST_SCREENSHOT });
  }
  // Deliberately finish the first image decode after the second selection.
  await tv.evaluate(() => {
    const OriginalImage = window.Image; const images = [];
    window.Image = class { constructor() { images.push(this); } };
    testBrowse.tvBrowsePreview({ tmdbId: 9001, mediaType: 'movie', title: 'older', landscape: '/older.jpg' });
    const oldCommit = images[0].onload;
    testBrowse.tvBrowsePreview({ tmdbId: 9002, mediaType: 'movie', title: 'newer', landscape: '/newer.jpg' });
    images[1].onload(); oldCommit(); window.Image = OriginalImage;
  });
  assert.equal(await tv.locator('#tvBrowseTitle').textContent(), 'newer');
  assert.ok(await tv.evaluate(() => testBrowse.tvBrowseState().backdropUrl.includes('newer.jpg')));
  // Late old-query completion cannot publish into a different column.
  await tv.evaluate(() => { testBrowse.tvBrowseSelectColumn("tv"); testBrowse.tvBrowseSelectColumn("recommendation"); });
  await tv.waitForTimeout(250);
  assert.equal(await tv.evaluate(() => testBrowse.tvBrowseState().column), "recommendation");
  assert.ok((await tv.locator("#tvBrowseTitle").innerText()).startsWith("推荐"));
  // Reload-style restore rehydrates required pages before consuming media focus.
  const reloaded = await pageAt(true);
  await reloaded.evaluate(async (saved) => { await testBrowse.restoreUiSnapshot(saved); }, saved);
  await reloaded.waitForFunction((key) => document.activeElement.dataset.mediaKey === key, returnKey);
  assert.equal(await reloaded.evaluate(() => testBrowse.state.homeV14.secondaryFilters.movie.sort), "rating");
  await reloaded.evaluate(async () => { await testBrowse.restoreUiSnapshot({ version: 1, route: 'home', homeRoute: 'secondary', secondaryListId: 'cn-tv', activeList: 'all' }); });
  assert.equal(await reloaded.evaluate(() => testBrowse.tvBrowseState().column), 'tv');
  assert.equal(await reloaded.locator('#secondaryCatalog').count(), 0, 'legacy snapshot maps to the new TV browser');
  await reloaded.evaluate(() => { testBrowse.tvBrowseSelectColumn('now-playing'); testBrowse.state.homeLatest.items = [{ tmdbId: 99, mediaType: 'movie', title: 'weekly', pic: '/poster.jpg', weeklyUpdateText: '本周上映' }]; testBrowse.state.homeLatest.loaded = true; testBrowse.state.homeLatest.loading = false; testBrowse.publishHomeWeeklySnapshot('fixture', { final: true }); });
  assert.equal(await reloaded.locator('#tvBrowseRail .card').count(), 1);
  assert.equal(await reloaded.evaluate(() => testBrowse.secondaryActiveQuery('now-playing').hasMore), false);
  // Cold pending -> user navigation -> late Nostr must not take focus.
  await tv.evaluate(() => { testBrowse.state.hot.ready = false; testBrowse.state.hot.items = []; testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); });
  await press(tv, "ArrowUp"); const userTarget = await active(tv);
  await tv.evaluate(() => { testBrowse.state.hot.ready = true; testBrowse.state.hot.items = [{ id: 9, tmdbId: 9, title: "late", source: "nostr-hot", mediaType: "movie", pic: "/poster.jpg", people: 1 }]; testBrowse.renderAll(); });
  assert.equal(await active(tv), userTarget);
  // Metadata fields and the existing type-specific detail caches share media identity.
  await tv.evaluate(() => {
    testBrowse.storeMovieDetailCache({tmdbId: 7001}, {id: 7001, overview: '电影缓存简介', vote_average: 9});
    testBrowse.storeTvDetailCache({tmdbId: 7001}, {id: 7001, overview: '同号电视剧简介'});
    testBrowse.tvBrowsePreview({tmdbId: 7001, mediaType: 'movie', title: '电影'});
  });
  assert.equal(await tv.locator('#tvBrowseOverview').innerText(), '电影缓存简介');
  await tv.evaluate(() => testBrowse.tvBrowsePreview({tmdbId: 7002, mediaType: 'movie', title: '另一部', description: 'description 简介'}));
  assert.equal(await tv.locator('#tvBrowseOverview').innerText(), 'description 简介');
  await tv.evaluate(() => testBrowse.tvBrowsePreview({tmdbId: 7003, mediaType: 'movie', title: '无简介'}));
  assert.equal(await tv.locator('#tvBrowseOverview').innerText(), '');

  // Title artwork reuses typed caches, the language chooser and the existing request budget.
  const artwork = await pageAt(true);
  await artwork.waitForTimeout(300);
  let logoRequests = 0;
  await artwork.route('**/tmdb/movie/9100?*', async route => {
    logoRequests++; await new Promise(resolve=>setTimeout(resolve,100));
    await route.fulfill({contentType:'application/json',body:JSON.stringify({id:9100, overview:'缓存艺术标题', images:{logos:[{file_path:'/art-en.png',iso_639_1:'en',vote_average:10},{file_path:'/art-zh.png',iso_639_1:'zh',vote_average:1}]}})});
  });
  await artwork.route('**/art-*.png', async route => {
    if (route.request().url().includes('fail')) return route.abort();
    await route.fulfill({contentType:'image/svg+xml',body:route.request().url().includes('tall') ? '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="480"><path fill="white" d="M10 10h60v400H10z"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="90"><text x="5" y="60" fill="white" font-size="56">作品艺术标题</text></svg>'});
  });
  await artwork.evaluate(() => {
    const item={id:9100,tmdbId:9100,mediaType:'movie',title:'即时文字标题'};
    testBrowse.tvBrowsePreview(item); testBrowse.tvBrowsePreview(item);
    window.joinLogo = testBrowse.requestMovieDetailShared(item,testBrowse.homeEnrichmentRequest);
  });
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),true,'the readable text title remains visible while its artwork is not ready');
  assert.equal(await artwork.locator('#tvBrowseLogo').evaluate(img=>getComputedStyle(img).animationDuration),'0s','TV Browse artwork adds no reveal delay after preparation');
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),false);
  assert.ok(await artwork.locator('#tvBrowseLogo').getAttribute('src').then(src=>src.endsWith('/art-zh.png')));
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({tmdbId:9100,mediaType:'movie',title:'即时文字标题'}));
  await artwork.waitForTimeout(250); assert.equal(logoRequests,1,'shared cache and pending request prevent duplicate queries');
  await artwork.evaluate(() => {
    testBrowse.storeTvDetailCache({tmdbId:9100},{id:9100,images:{logos:[{file_path:'/art-tv.png',iso_639_1:'zh'}]}});
    testBrowse.tvBrowsePreview({id:9100,tmdbId:9100,mediaType:'tv',title:'电视剧艺术标题'});
  });
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden && document.querySelector('#tvBrowseLogo').src.endsWith('/art-tv.png'));
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),false,'same ID across movie and TV never shares artwork');
  await artwork.evaluate(() => {
    testBrowse.storeMovieDetailCache({tmdbId:9101},{id:9101,images:{logos:[]}});
    testBrowse.tvBrowsePreview({tmdbId:9101,mediaType:'movie',title:'没有艺术标题'});
  });
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),true);
  assert.equal(await artwork.locator('#tvBrowseLogo').isVisible(),false);
  await artwork.evaluate(() => testBrowse.tvBrowsePreview({tmdbId:9101,mediaType:'movie',title:'加载失败',logo:'/art-fail.png'}));
  await artwork.waitForTimeout(150);
  assert.equal(await artwork.locator('#tvBrowseTitle').isVisible(),true);
  assert.equal(await artwork.locator('#tvBrowseLogo').isVisible(),false);
  const staleArtwork = await artwork.evaluate(async () => {
    const OriginalImage=window.Image, pending=[];
    window.Image=class { constructor(){this.naturalWidth=100;pending.push(this);} };
    testBrowse.tvBrowsePreview({id:9101,tmdbId:9101,mediaType:'movie',title:'旧片',logo:'/art-old.png'});
    const stale=pending.find(i=>i.src && i.src.endsWith('/art-old.png')).onload;
    testBrowse.tvBrowsePreview({id:9101,tmdbId:9101,mediaType:'tv',title:'新片',logo:'/art-new.png'});
    pending.find(i=>i.src && i.src.endsWith('/art-new.png')).onload(); await Promise.resolve();
    stale(); await Promise.resolve(); window.Image=OriginalImage;
    return {src:document.querySelector('#tvBrowseLogo').src,title:document.querySelector('#tvBrowseTitle').textContent};
  });
  assert.ok(staleArtwork.src.endsWith('/art-new.png')); assert.equal(staleArtwork.title,'新片');
  assert.equal(await artwork.evaluate(()=>testBrowse.bestDetailLogo({images:{logos:[{file_path:'/en.png',iso_639_1:'en'},{file_path:'/tw.png',iso_639_1:'zh-TW'},{file_path:'/cn.png',iso_639_1:'zh-CN'}]}}).file_path),'/cn.png');
  let lateRequests=0;
  await artwork.route('**/tmdb/movie/9104?*',async route=>{
    lateRequests++; await new Promise(resolve=>setTimeout(resolve,350));
    await route.fulfill({contentType:'application/json',body:JSON.stringify({id:9104,images:{logos:[{file_path:'/art-late.png',iso_639_1:'zh'}]}})});
  });
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({id:9104,tmdbId:9104,mediaType:'movie',title:'迟到旧片'}));
  await artwork.waitForFunction(()=>testBrowse.tvBrowseState().previewDetailRequestKey==='movie:9104');
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({id:9105,tmdbId:9105,mediaType:'tv',title:'当前新片',logo:'/art-current.png'}));
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  await artwork.waitForTimeout(500);
  assert.equal(lateRequests,1); assert.equal(await artwork.locator('#tvBrowseTitle').textContent(),'当前新片');
  assert.ok((await artwork.locator('#tvBrowseLogo').getAttribute('src')).endsWith('/art-current.png'),'late detail response cannot repaint a different selected title');
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({tmdbId:9103,mediaType:'tv',title:'窄长标题',logo:'/art-tall.png'}));
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  const tall=await artwork.locator('#tvBrowseLogo').boundingBox();
  const logoSlot=await artwork.locator('.tv-browse-title').boundingBox();
  assert.ok(tall.height<=logoSlot.height+.1 && tall.width<tall.height,'portrait artwork fits the unified title slot');
  await artwork.evaluate(()=>{testBrowse.tvBrowseClearPreview();testBrowse.tvBrowsePreview({tmdbId:9103,mediaType:'tv',title:'窄长标题',logo:'/art-tall.png'});});
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  await artwork.evaluate(()=>testBrowse.tvBrowsePreview({tmdbId:9100,mediaType:'movie',title:'即时文字标题',overview:'明亮和深色背景下的作品信息可读性验证。',releaseDate:'2025-01-01'}));
  await artwork.waitForFunction(()=>!document.querySelector('#tvBrowseLogo').hidden);
  if (process.env.WEBHOME_TEST_SCREENSHOT) {
    for (const [name,color] of [['bright','#dbd7bb'],['dark','#152433']]) {
      await artwork.evaluate(color=>{
        const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect fill="'+color+'" width="1280" height="720"/></svg>';
        document.querySelector('#tvBrowseBackdrop').style.backgroundImage='url("data:image/svg+xml,'+encodeURIComponent(svg)+'")';
        document.querySelector('#tvBrowseBackdrop').classList.add('visible'); document.querySelector('#tvBrowseBackdropNext').classList.remove('visible');
      },color);
      await artwork.waitForTimeout(300);
      await artwork.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-'+name+'.png')});
    }
  }
  await artwork.evaluate(()=>{testBrowse.tvBrowseSelectColumn('movie');});
  await focus(artwork,'#tvColumn-movie'); await press(artwork,'Enter'); await press(artwork,'Enter');
  if (process.env.WEBHOME_TEST_SCREENSHOT) await artwork.screenshot({path:process.env.WEBHOME_TEST_SCREENSHOT.replace('.png','-filters.png')});
  await artwork.close();

  const mobile = await pageAt(false, { width: 390, height: 844 });
  await mobile.evaluate(() => testBrowse.renderAll());
  assert.equal(await mobile.locator("#homeHero").count(), 1);
  assert.equal(await mobile.locator("#tvBrowse").isVisible(), false);
  await mobile.locator('#homeRecommendationMore').click();
  assert.equal(await mobile.locator('#secondaryCatalog').isVisible(), true);
  await mobile.locator('#secondaryCatalogBack').click(); await mobile.waitForTimeout(100);
  await mobile.locator('#homeMenuLauncher').click();
  assert.equal(await mobile.locator('#homeSidebar').isVisible(), true);
  assert.equal(await mobile.locator('#homeSidebarBackdrop').isVisible(), true);
  await press(mobile, 'Escape'); await mobile.waitForTimeout(250);
  assert.equal(await mobile.locator('#homeSidebar').isVisible(), false);
  await mobile.evaluate(() => testBrowse.openSearchPage()); assert.equal(await mobile.locator("#searchPage").isVisible(), true);
  assert.equal(await mobile.evaluate(() => document.documentElement.classList.contains("tv-browse-active")), false);
  for (const viewport of [{ width:1280,height:720 }, { width: 1920, height: 1080 }, { width: 960, height: 540 }]) {
    const sized = await pageAt(true, viewport);
    await sized.evaluate(() => { testBrowse.renderAll(); testBrowse.tvBrowseFocusIntent(); });
    assert.ok(await sized.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
    assert.equal(await sized.locator('#homeHero,#secondaryCatalog').count(), 0);
    await sized.evaluate(() => testBrowse.tvBrowsePreview({ mediaType:'movie', tmdbId:8000, title:'这是一部用来验证长标题和多行简介布局的影片名称', releaseDate:'2025-01-01', description:'多行简介应显示在更高的左侧资料区，保留与中部栏目之间的空间。'.repeat(8) }));
    const geometry = await sized.evaluate(() => ({info:document.querySelector('#tvBrowseInfo').getBoundingClientRect().toJSON(), columns:document.querySelector('#tvBrowseColumns').getBoundingClientRect().toJSON(), height:innerHeight}));
    assert.ok(geometry.info.top < geometry.height*.13 && geometry.info.bottom < geometry.columns.top, 'raised information remains clear of fixed columns');
    assert.equal(await sized.locator('#tvFunction-search').innerText(), '搜索');
    const controls=await sized.locator('#tvBrowseFunctions button').evaluateAll(bs=>bs.map(b=>({id:b.id,r:b.getBoundingClientRect().toJSON()})));
    assert.ok(controls.every(b=>Math.abs(b.r.height-controls[0].r.height)<.1),'one external height for all controls');
    assert.ok(controls[0].r.width/controls[0].r.height>3 && controls[0].r.width/controls[0].r.height<5,'short horizontal search box');
    const icon=await sized.locator('#tvFunction-search svg').boundingBox();
    assert.ok(icon.x>controls[0].r.x+controls[0].r.width/2);
    console.log('CONTROL_DIMENSIONS '+viewport.width+'x'+viewport.height+' = '+JSON.stringify(controls));
    await sized.close();
  }
  // Actual Detail DOM/history/close chain, using a poster whose fixture requires no Native playback.
  await tv.evaluate(() => { testBrowse.tvBrowseSelectColumn('movie'); document.querySelector('#tvBrowseRail .card').focus(); testBrowse.openDetail(document.activeElement.__mediaItem, { returnTarget: document.activeElement }); });
  await tv.waitForTimeout(160);
  assert.equal(await tv.locator('#detailSheet').evaluate((el) => el.classList.contains('active')), true);
  await focus(tv, '#detailSearchBtn'); await tv.waitForTimeout(250);
  for (const action of ['detailContinueBtn','detailSearchBtn','panSearchBtn']) {
    await focus(tv,'#'+action); await tv.waitForTimeout(250);
    const style=await tv.locator('#'+action).evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,shadow:getComputedStyle(el).boxShadow}));
    assert.deepEqual(style,{bg:'rgb(247, 247, 247)',color:'rgb(23, 23, 23)',shadow:'none'});
  }
  await tv.evaluate(() => testBrowse.closeDetail(false)); await tv.waitForTimeout(650);
  assert.equal(await tv.evaluate(() => document.activeElement.closest('#tvBrowseRail')?.id), 'tvBrowseRail');
  await tv.evaluate(() => { testBrowse.openSearchPage(); testBrowse.openDetail({ tmdbId: 88, mediaType: 'movie', title: 'search-detail', source: 'tmdb', pic: '/poster.jpg' }, { returnTarget: document.querySelector('#searchPageBack') }); });
  await tv.waitForTimeout(160); await tv.evaluate(() => testBrowse.closeDetail(false)); await tv.waitForTimeout(650);
  assert.equal(await tv.locator('#searchPage').isVisible(), true, 'Search -> Detail -> Back stays on Search');
  assert.equal(await tv.evaluate(() => testBrowse.state.homeV14.route), 'search');
  assert.deepEqual(errors, [], "no browser runtime errors");
  console.log("TV_IMMERSIVE_BROWSE = PASS (real Chromium DOM / keyboard / query fixtures)");
  console.log("NATIVE_DEVICE_PLAYBACK_AND_RESUME = NOT_RUN (real device required)");
  }
  }
} finally { await browser.close(); }
