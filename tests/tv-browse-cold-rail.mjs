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
const hook = `window.testRail = {
  state, secondaryGetQuery, secondaryActiveQuery, renderTvBrowse, tvBrowseState, tvBrowseSelectColumn,
  tvBrowseInitialVisibleCardCount, tvBrowsePosition, tvBrowseQueryKey, bindActions, installRemoteKeys,
  syncBrowseDevicePresentation, focusRemoteTarget, isVisibleFocusable, observeHomeImages
};
window.testRail.setup = () => {
  state.deviceMode = "leanback"; state.previewMode = true; state.activeList = "all";
  state.homeV14.route = "home"; state.hot.ready = true;
  state.hot.items = Array.from({length: 18}, (_, i) => ({id:"recommend-"+i,title:"推荐"+i,mediaType:"other",source:"fixture",pic:"/recommend-poster-"+i+".jpg",landscape:"/recommend-backdrop-"+i+".jpg"}));
  state.recent.loaded = true; state.recent.items = [];
  document.documentElement.classList.add("tv-preview", "tv-mode");
  const ui=tvBrowseState();ui.view="home";ui.column="recommendation";ui.filterOpen=false;ui.positions={};ui.previewKey="";
  syncBrowseDevicePresentation();bindActions();installRemoteKeys();renderTvBrowse();
};
window.testRail.seed = (id, count, prefix, hasMore=false) => {
  const query=secondaryGetQuery(id);query.items=Array.from({length:count},(_,i)=>({
    id:prefix+"-"+i,title:prefix+" item "+i,mediaType:"other",source:"fixture",
    pic:"/"+prefix+"-poster-"+i+".jpg",landscape:"/"+prefix+"-backdrop-"+i+".jpg",overview:"fixture"
  }));
  query.page=1;query.loaded=true;query.loading=false;query.hasMore=hasMore;query.error="";query.retryableError="";return query;
};
window.testRail.setPageLoader = loader => { loadSecondaryPage=loader; };
window.testRail.visibleCount = () => tvBrowseInitialVisibleCardCount(document.querySelector("#tvBrowseRail"),Number.MAX_SAFE_INTEGER);
`;
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output, "test hook replaces production boot");

const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.WEBHOME_BROWSER_EXECUTABLE
    ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE }
    : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" })
});
const held = new Map();
const requested = [];
const failedPaths = new Set();
let holdPrefix = "";
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", error => { throw error; });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://fixture.local" && url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: html });
    }
    if (route.request().resourceType() === "image") {
      const path = url.pathname;
      requested.push(path);
      if (holdPrefix && path.includes(holdPrefix)) await new Promise(resolve => held.set(path, resolve));
      if (Array.from(failedPaths).some(fragment => path.includes(fragment))) return route.abort();
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#31513f"/></svg>' });
    }
    return route.abort();
  });
  await page.goto("http://fixture.local/?_tv=1");
  await page.evaluate(() => testRail.setup());
  await page.waitForFunction(() => document.querySelectorAll("#tvBrowseRail > .card").length > 0);
  return page;
}
function releaseHeld() {
  const callbacks = Array.from(held.values());
  held.clear();
  callbacks.forEach(resolve => resolve());
}
async function waitUntil(predicate, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("Timed out waiting for the expected intercepted image requests");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

try {
  const page = await openPage();
  const visibleCount = await page.evaluate(() => testRail.visibleCount());
  assert.ok(visibleCount >= 1 && visibleCount < 18, "first-screen count is measured from the rendered rail");

  testRailHoldMoviePosters();
  const coldSwitch = await page.evaluate(() => {
    testRail.seed("movie", 18, "cold-movie");
    testRail.tvBrowseSelectColumn("movie",{afterPaint:true});
    const host=document.querySelector("#tvBrowsePosters");
    return {pending:host.classList.contains("rail-switch-pending"),oldCardsHidden:Array.from(document.querySelectorAll("#tvBrowseRail > .card")).every(card=>getComputedStyle(card).visibility==="hidden"),loaderHidden:document.querySelector("#tvBrowseRailLoader").hidden};
  });
  assert.equal(coldSwitch.pending,true,"old-category cards are hidden immediately while the cold selection render is queued");
  assert.equal(coldSwitch.oldCardsHidden,true,"previous-category cards cannot masquerade as the newly selected category");
  assert.equal(coldSwitch.loaderHidden,true,"the wait animation appears only after the current first-screen gate confirms work is pending");
  await page.waitForFunction(() => testRail.tvBrowseState().railReadiness && !document.querySelector("#tvBrowseRailLoader").hidden);
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#tvBrowseRail > .card img.poster"))
    .filter(image => image.src.includes("cold-movie-poster")).length >= testRail.visibleCount());
  await waitUntil(() => held.size >= visibleCount);
  assert.equal(held.size,visibleCount,"the extra offscreen poster must wait until the first-screen gate releases");
  const coldState = await page.evaluate(() => ({
    count:testRail.visibleCount(),
    physicalVisibleCount:Array.from(document.querySelectorAll("#tvBrowseRail > .card")).filter(card=>{
      const rail=document.querySelector("#tvBrowseRail"),rr=rail.getBoundingClientRect(),cr=card.getBoundingClientRect(),style=getComputedStyle(rail);
      const left=rr.left+rail.clientLeft+parseFloat(style.paddingLeft||"0"),right=rr.left+rail.clientLeft+rail.clientWidth-parseFloat(style.paddingRight||"0");
      return cr.right>left+.5&&cr.left<right-.5;
    }).length,
    cards:Array.from(document.querySelectorAll("#tvBrowseRail > .card")).slice(0,testRail.visibleCount())
      .map(card=>({hidden:getComputedStyle(card).visibility==="hidden",src:card.querySelector("img.poster").getAttribute("src")})),
    loaderHidden:document.querySelector("#tvBrowseRailLoader").hidden,
    loaderText:document.querySelector("#tvBrowseRailLoader").textContent.trim(),
    dots:Array.from(document.querySelectorAll("#tvBrowseRailLoader .tv-browse-rail-dot")).map(dot=>({
      width:getComputedStyle(dot).width,height:getComputedStyle(dot).height,color:getComputedStyle(dot).backgroundColor,
      animation:getComputedStyle(dot).animationName
    })),
    loaderBackground:getComputedStyle(document.querySelector("#tvBrowseRailLoader")).backgroundColor,
    busy:document.querySelector("#tvBrowseRail").getAttribute("aria-busy")
  }));
  assert.equal(coldState.loaderHidden,false,"cold classification shows a stable loader until its first screen is ready");
  assert.equal(coldState.loaderText,"","the wait indicator has no explanatory text");
  assert.equal(coldState.dots.length,3,"the wait indicator contains exactly three dots");
  assert.equal(new Set(coldState.dots.map(dot=>dot.width+"/"+dot.height+"/"+dot.color+"/"+dot.animation)).size,1,
    "the three solid green dots share one restrained horizontal animation style");
  assert.equal(coldState.dots.every(dot=>dot.animation.includes("dot-bounce")&&dot.width===dot.height),true);
  assert.match(coldState.dots[0].color,/rgb\(53, 224, 122\)/);
  assert.equal(coldState.loaderBackground,"rgba(0, 0, 0, 0)","the rail wait indicator has no panel or backdrop");
  assert.equal(coldState.busy,"true");
  assert.equal(coldState.cards.length,visibleCount);
  assert.equal(coldState.physicalVisibleCount,visibleCount,"the dynamic count matches actual rail geometry");
  assert.equal(coldState.cards.every(card=>card.hidden),true,"no new-category poster is revealed one by one");
  assert.equal(coldState.cards.every(card=>!card.src.includes("recommend-poster")),true,"old-category posters are not retained as new content");

  releaseHeld();
  holdPrefix="";
  await page.waitForFunction(() => document.querySelector("#tvBrowseRailLoader").hidden
    && Array.from(document.querySelectorAll("#tvBrowseRail > .card")).slice(0,testRail.visibleCount())
      .every(card => ["ready","failed"].includes(card.querySelector("img.poster").dataset.tvBrowsePosterState)));
  const ready = await page.evaluate(() => ({
    cards:Array.from(document.querySelectorAll("#tvBrowseRail > .card")).slice(0,testRail.visibleCount()).map(card=>({
      visible:getComputedStyle(card).visibility!=="hidden",state:card.querySelector("img.poster").dataset.tvBrowsePosterState
    })),
    loading:document.querySelector("#tvBrowsePosters").classList.contains("rail-loading"),
    warmKey:testRail.tvBrowseState().posterWarmTargetKey,
    count:testRail.visibleCount()
  }));
  assert.equal(ready.loading,false,"the first screen is revealed as one stable set");
  assert.equal(ready.cards.every(card=>card.visible),true);
  assert.equal(ready.cards.every(card=>card.state==="ready"),true,
    "visible posters have completed load and decode (or the supported load fallback)");
  assert.equal(ready.warmKey,"cold-movie-"+ready.count,"one right-side offscreen poster is prepared immediately after the gate");
  assert.equal(requested.filter(path=>path.includes("cold-movie-poster-")).length,ready.count+1,
    "the extra active poster request is limited to the first offscreen card");

  await page.evaluate(() => {
    window.movieNodes=Array.from(document.querySelectorAll("#tvBrowseRail > .card"));
    testRail.tvBrowseSelectColumn("recommendation");
    testRail.tvBrowseSelectColumn("movie",{afterPaint:true});
  });
  assert.equal(await page.locator("#tvBrowseRailLoader").isHidden(),true,"a hot category restore does not replay the cold loader");
  assert.equal(await page.evaluate(() => window.movieNodes[0]===document.querySelector("#tvBrowseRail > .card")),true,
    "a hot category restore reuses the same card node");

  // The existing query/pagination path supplies only the missing first-screen
  // records. A later page must not be fetched just to release the rail.
  await page.evaluate(() => {
    testRail.seed("tv",2,"page-tv",true);
    testRail.setPageLoader(async (id, query, pageNumber) => {
      window.pageLoads=(window.pageLoads||[]).concat(pageNumber);
      query.loading=true;
      if(pageNumber===3) return new Promise(resolve=>{window.releasePage3=()=>{query.loading=false;query.page=3;query.hasMore=false;renderTvBrowse();resolve(query);};});
      await new Promise(resolve=>setTimeout(resolve,30));
      query.items=query.items.concat(Array.from({length:Math.max(0,testRail.visibleCount()-query.items.length)},(_,i)=>({
        id:"page-tv-"+(i+2),title:"page-tv item "+(i+2),mediaType:"other",source:"fixture",
        pic:"/page-tv-poster-"+(i+2)+".jpg",landscape:"/page-tv-backdrop-"+(i+2)+".jpg"
      })));
      query.page=pageNumber;query.loading=false;query.loaded=true;query.hasMore=true;
      renderTvBrowse({append:true});
      return query;
    });
    testRail.tvBrowseSelectColumn("tv");
  });
  await page.waitForFunction(() => window.pageLoads && window.pageLoads.length===2
    && document.querySelector("#tvBrowseRailLoader").hidden);
  assert.deepEqual(await page.evaluate(() => window.pageLoads),[2,3],"the existing query loads the page needed to fill the first screen, then requests only the next viewport target");
  assert.equal(await page.evaluate(() => testRail.secondaryActiveQuery("tv").loading),true,
    "the first-screen rail is revealed while later-page data remains pending");
  assert.equal(await page.evaluate(() => testRail.secondaryActiveQuery("tv").hasMore),true,
    "the first-screen gate does not wait for the rest of the category");
  await page.evaluate(() => window.releasePage3());

  // Failure is represented by stable per-card placeholders rather than an
  // indefinite rail lock.
  await page.evaluate(() => testRail.seed("anime",6,"failed-anime",false));
  const firstAnimePath="/failed-anime-poster-0.jpg";
  failedPaths.add(firstAnimePath);
  await page.evaluate(() => testRail.tvBrowseSelectColumn("anime"));
  await page.waitForFunction(() => document.querySelector("#tvBrowseRailLoader").hidden
    && document.querySelector('#tvBrowseRail .card img.poster[data-tv-browse-poster-state="failed"]'));
  assert.equal(await page.locator('#tvBrowseRail .card').first().evaluate(card=>card.classList.contains("poster-unavailable")),true,
    "a failed first-screen poster becomes an explicit unavailable placeholder");

  holdPrefix="timed-category-poster";
  await page.evaluate(() => {
    testRail.seed("documentary",10,"timed-category",false);
    testRail.tvBrowseSelectColumn("documentary");
  });
  await page.waitForFunction(() => testRail.tvBrowseState().railReadiness && !document.querySelector("#tvBrowseRailLoader").hidden);
  const timedCount=await page.evaluate(()=>testRail.visibleCount());
  await waitUntil(()=>held.size>=timedCount);
  await page.waitForFunction(() => document.querySelector("#tvBrowseRailLoader").hidden,{},{timeout:6500});
  assert.equal(await page.locator("#tvBrowsePosters").evaluate(node=>node.classList.contains("rail-loading")),false,
    "the image readiness timeout releases the whole rail instead of waiting indefinitely");
  const timedStates=await page.evaluate(() => {
    const count=testRail.visibleCount(), cards=Array.from(document.querySelectorAll("#tvBrowseRail > .card"));
    return {
      firstScreen:cards.slice(0,count).map(card=>({state:card.querySelector("img.poster").dataset.tvBrowsePosterState,unavailable:card.classList.contains("poster-unavailable")})),
      laterScreen:cards.slice(count).map(card=>card.classList.contains("poster-unavailable"))
    };
  });
  assert.equal(timedStates.firstScreen.every(card=>card.state==="failed"&&card.unavailable),true,
    "timed-out visible posters use the same explicit fallback state");
  assert.equal(timedStates.laterScreen.some(Boolean),false,
    "only timed-out first-screen images are degraded and the remainder of the rail remains normal");
  releaseHeld();holdPrefix="";

  // A new category supersedes an unfinished prior gate; late old image
  // completion cannot replace the selected category or restore its loader.
  holdPrefix="slow-category-poster";
  await page.evaluate(() => {
    testRail.tvBrowseSelectColumn("movie");
    testRail.seed("documentary",8,"slow-category",false);
    testRail.seed("variety",8,"latest-category",false);
    testRail.tvBrowseSelectColumn("documentary");
  });
  await page.waitForFunction(() => testRail.tvBrowseState().railReadiness && !document.querySelector("#tvBrowseRailLoader").hidden);
  await page.evaluate(() => testRail.tvBrowseSelectColumn("variety"));
  await page.waitForFunction(() => testRail.tvBrowseState().column==="variety" && document.querySelector("#tvBrowseRailLoader").hidden
    && document.querySelector("#tvBrowseRail .card .card-title")?.textContent.includes("latest-category"));
  releaseHeld();holdPrefix="";
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => testRail.tvBrowseState().column),"variety","the latest selected category remains authoritative after late prior images finish");
  assert.equal(await page.locator("#tvBrowseRailLoader").isHidden(),true,"an obsolete readiness result cannot restore the loading overlay");

  // All seven real TV Browse columns fit the bounded rail/readiness LRU. A
  // complete first-screen revisit should reuse its nodes and image state.
  const allColumns=["recommendation","now-playing","movie","tv","anime","documentary","variety"];
  await page.evaluate(columns=>{
    testRail.state.hot.items=Array.from({length:18},(_,i)=>({id:"roundtrip-recommendation-"+i,title:"推荐往返"+i,mediaType:"other",source:"fixture",pic:"/roundtrip-recommendation-poster-"+i+".jpg"}));
    testRail.state.hot.ready=true;
    columns.filter(id=>id!=="recommendation").forEach(id=>testRail.seed(id,12,"roundtrip-"+id,false));
  },allColumns);
  for(const column of allColumns){
    await page.evaluate(id=>testRail.tvBrowseSelectColumn(id),column);
    await page.waitForFunction(id=>{
      const rail=document.querySelector("#tvBrowseRail"),count=testRail.visibleCount();
      return testRail.tvBrowseState().column===id && rail.dataset.queryKey===testRail.tvBrowseQueryKey()
        && document.querySelector("#tvBrowseRailLoader").hidden
        && Array.from(rail.children).slice(0,count).every(card=>["ready","failed"].includes(card.querySelector("img.poster")?.dataset.tvBrowsePosterState));
    },column,{timeout:5000});
    await page.evaluate(id=>{
      window.roundtripCachedNodes=window.roundtripCachedNodes||{};
      window.roundtripCachedNodes[id]=document.querySelector("#tvBrowseRail > .card");
    },column);
  }
  for(const column of allColumns.slice().reverse()){
    await page.evaluate(id=>testRail.tvBrowseSelectColumn(id,{afterPaint:true}),column);
    const revisit=await page.evaluate(id=>({
      selected:testRail.tvBrowseState().column,
      loaderHidden:document.querySelector("#tvBrowseRailLoader").hidden,
      sameNode:window.roundtripCachedNodes[id]===document.querySelector("#tvBrowseRail > .card")
    }),column);
    assert.equal(revisit.selected,column);
    assert.equal(revisit.loaderHidden,true,"a ready category revisit never replays the cold dots");
    assert.equal(revisit.sameNode,true,"the bounded category rail node is reused on revisit");
  }
  await page.close();
  console.log("TV Browse cold rail checks passed: dynamic first screen, atomic reveal, single poster handoff, hot reuse, bounded page fill, failure placeholder, stale category guard.");
} finally {
  releaseHeld();
  await browser.close();
}

function testRailHoldMoviePosters() { holdPrefix="cold-movie-poster"; }
