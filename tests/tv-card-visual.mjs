import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";
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
const hook = `window.testBrowse = { state, tvBrowseSelectColumn, syncBrowseDevicePresentation,
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
`;
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output);
const currentCss=readFileSync(new URL('../src/css/05-home-tv.css',import.meta.url),'utf8');
const baselineCss=execFileSync('git',['show','6b029a86e69b5a2ac04c4e2a3aa3021bd56e2653:src/css/05-home-tv.css'],{encoding:'utf8'});
const baselineHtml=html.replace(currentCss,baselineCss);
assert.notEqual(baselineHtml,html,'baseline fixture uses the actual pre-refinement CSS');
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.WEBHOME_BROWSER_EXECUTABLE ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE } : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" }) });
const errors = [];
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

try {
 const capture=async p=>{
  const values=[];
  for(const target of ['#tvColumn-movie','#tvColumn-tv','#tvBrowseRail .card']) {
   await p.locator(target).first().focus();await p.waitForTimeout(350);
   values.push(await p.evaluate(()=>{
    const style=el=>{const s=getComputedStyle(el);return Object.fromEntries(['backgroundColor','color','fontSize','fontWeight','border','borderRadius','boxShadow','outline','padding','width','height','transform','textOverflow','whiteSpace','overflow'].map(k=>[k,s[k]]));};
    const column=document.querySelector('#tvColumn-movie'),normal=document.querySelector('#tvColumn-documentary'),focused=document.querySelector('#tvColumn-tv');
    const line=getComputedStyle(column,'::after');
    const card=document.querySelector('#tvBrowseRail .card'),title=card.querySelector('.card-title');
    return {column:style(column),normal:style(normal),focused:style(focused),line:[line.width,line.height,line.backgroundColor],card:style(card),poster:style(card.querySelector('.poster-wrap')),title:style(title),body:style(card.querySelector('.card-body')),rating:style(card.querySelector('.rating-badge'))};
   }));
  }
  return values;
 };
 const screenshots=process.env.WEBHOME_VISUAL_DIR;
 if(screenshots) mkdirSync(screenshots,{recursive:true});
 for (const viewport of [{width:1920,height:1080},{width:1280,height:720},{width:960,height:540}]) {
  const p=await pageAt(true,viewport); await p.waitForTimeout(300);
  await p.evaluate(()=>{const q=testBrowse.seed('movie',3);q.hasMore=false;q.items[0].title='短标题';q.items[1].title='这是一个需要截断省略的很长很长的影片标题';testBrowse.tvBrowseSelectColumn('movie');document.querySelector('#tvColumn-movie').focus();});
  const inspect=()=>p.locator('#tvBrowseRail .card').first().evaluate(card=>{
   const style=el=>{const s=getComputedStyle(el);return {align:s.textAlign,outline:s.outline,shadow:s.boxShadow,border:s.borderTop,background:s.backgroundColor,width:s.width,padding:s.padding,overflow:s.overflow,whiteSpace:s.whiteSpace,ellipsis:s.textOverflow,transform:s.transform};};
   return {active:document.activeElement.className,card:style(card),poster:style(card.querySelector('.poster-wrap')),body:style(card.querySelector('.card-body')),title:style(card.querySelector('.card-title'))};
  });
  await p.waitForTimeout(350);const normal=await inspect(); await p.locator('#tvBrowseRail .card').first().focus();await p.waitForTimeout(350);const focused=await inspect();
  assert.ok(focused.active.includes('card focusable'));
  for(const state of [normal,focused]) {assert.equal(state.title.align,'center');assert.equal(state.title.whiteSpace,'nowrap');assert.equal(state.title.ellipsis,'ellipsis');assert.ok(state.card.outline.includes('none'));assert.ok(state.title.outline.includes('none'));}
  assert.equal(normal.title.width,focused.title.width);assert.ok(focused.card.transform.includes('1.04'));
  assert.equal(await p.locator('#tvBrowseRail .card-title').nth(1).evaluate(el=>el.scrollWidth>el.clientWidth),true);
  for(const card of await p.locator('#tvBrowseRail .card').all()) {
   await card.focus();await p.waitForTimeout(160);
   const offset=await card.evaluate(el=>{const a=el.getBoundingClientRect(),b=el.querySelector('.card-title').getBoundingClientRect();return Math.abs((a.left+a.right-b.left-b.right)/2);});
   assert.ok(offset<.1,'title box remains centered on its card');
  }
  const ref=await pageAt(true,viewport,true,true);await ref.waitForTimeout(300);
  await ref.evaluate(()=>{const q=testBrowse.seed('movie',3);q.hasMore=false;testBrowse.tvBrowseSelectColumn('movie');});
  const before=await capture(ref),after=await capture(p);
  for(let i=0;i<after.length;i++) {
   assert.deepEqual(after[i].column,before[i].column,'selected column style unchanged');
   if(i===1) assert.deepEqual(after[i].focused,before[i].focused,'focused capsule unchanged');
   assert.deepEqual(after[i].line,before[i].line);assert.deepEqual(after[i].line.slice(0,2),['18px','2px']);
   for(const region of ['poster','title','body','rating']) assert.deepEqual(after[i][region],before[i][region],region+' geometry and styles unchanged apart from alignment');
   for(const key of ['width','height','padding','transform']) assert.equal(after[i].card[key],before[i].card[key]);
   assert.equal(after[i].normal.backgroundColor,'rgba(40, 40, 40, 0.1)');assert.equal(after[i].normal.boxShadow,'none');
  }
  await ref.close();
  for(const shade of ['#dedede','#151515']) {
   await p.evaluate(color=>document.querySelectorAll('.tv-browse-backdrop').forEach(el=>el.style.backgroundImage=`linear-gradient(${color},${color})`),shade);
   for(const [name,target] of [['selected','#tvColumn-movie'],['focused','#tvColumn-tv'],['card','#tvBrowseRail .card']]) {
    await p.locator(target).first().focus();await p.waitForTimeout(350);
    if(screenshots) await p.screenshot({path:join(screenshots,`${viewport.width}-${shade==='#dedede'?'bright':'dark'}-${name}.png`)});
   }
  }
  await focus(p,'#tvColumn-movie');await press(p,'Enter');await press(p,'Enter');
  assert.equal(await p.locator('#tvBrowseColumns').isVisible(),false);
  assert.equal(await p.locator('#tvBrowseColumns button[tabindex="0"]').count(),0);
  await press(p,'Escape');assert.equal(await p.locator('#tvBrowseColumns').isVisible(),true);
  console.log(`TV_CARD_COLUMN_VISUAL ${viewport.width}x${viewport.height} = PASS`);
  await p.close();
 }
 const mobile=await pageAt(false,{width:390,height:844});assert.equal(await mobile.locator('#tvBrowse').isVisible(),false);await mobile.close();
 assert.deepEqual(errors,[]);
} finally { await browser.close(); }
