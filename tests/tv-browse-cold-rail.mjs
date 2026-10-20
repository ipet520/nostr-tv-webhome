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
  tvBrowseInitialVisibleCardCount, tvBrowsePosition, tvBrowseQueryKey, tvBrowsePreview, tvBrowseSyncRailImagePreparation,
  tvBrowseRailCards, tvBrowseRailCurrentPosition, tvBrowseWriteRailPosition, tvBrowseRailTargetScrollLeft,
  tvBrowseCancelRailScroll, tvBrowsePrepareCardResources, tvBrowseReadinessCacheValid, bindActions, installRemoteKeys,
  syncBrowseDevicePresentation, focusRemoteTarget, isVisibleFocusable, observeHomeImages
};
window.testRail.setup = () => {
  state.deviceMode = "leanback"; state.previewMode = true; state.activeList = "all";
  window.WEBHOME_CONFIG.tmdb.apiBase = "http://fixture.local/tmdb";
  state.homeV14.route = "home"; state.hot.ready = true;
  state.hot.items = Array.from({length: 18}, (_, i) => ({id:"recommend-"+i,title:"推荐"+i,mediaType:"other",source:"fixture",pic:"/recommend-poster-"+i+".jpg",landscape:"/recommend-backdrop-"+i+".jpg"}));
  state.recent.loaded = true; state.recent.items = [];
  document.documentElement.classList.add("tv-preview", "tv-mode");
  const ui=tvBrowseState();ui.view="home";ui.column="recommendation";ui.filterOpen=false;ui.positions={};ui.previewKey="";
  syncBrowseDevicePresentation();bindActions();installRemoteKeys();renderTvBrowse();
};
window.testRail.installDecodeProbe = () => {
  const prototype=HTMLImageElement.prototype, original=prototype.decode;
  window.decodeRequests=[];
  if(typeof original!=="function") return false;
  prototype.decode=function(){window.decodeRequests.push(String(this.currentSrc||this.src||""));return original.apply(this,arguments);};
  return true;
};
window.testRail.clearDecodeProbe = () => { window.decodeRequests=[]; };
window.testRail.delayDecode = fragment => {
  const prototype=HTMLImageElement.prototype, original=prototype.decode;
  window.originalPosterDecode=original; window.delayedPosterDecodeRelease=null;
  prototype.decode=function(){
    const image=this,args=arguments,url=String(image.currentSrc||image.src||"");
    if(!url.includes(fragment)) return original.apply(image,args);
    return new Promise((resolve,reject)=>{
      window.delayedPosterDecodeRelease=()=>original.apply(image,args).then(resolve,reject);
    });
  };
};
window.testRail.releaseDecode = () => {
  const release=window.delayedPosterDecodeRelease;
  window.delayedPosterDecodeRelease=null;
  if(release) release();
};
window.testRail.restoreDecode = () => {
  if(window.originalPosterDecode) HTMLImageElement.prototype.decode=window.originalPosterDecode;
  window.originalPosterDecode=null;
};
window.testRail.seed = (id, count, prefix, hasMore=false) => {
  const query=secondaryGetQuery(id);query.items=Array.from({length:count},(_,i)=>({
    id:prefix+"-"+i,title:prefix+" item "+i,mediaType:"other",source:"fixture",
    pic:"/"+prefix+"-poster-"+i+".jpg",landscape:"/"+prefix+"-backdrop-"+i+".jpg",overview:"fixture"
  }));
  query.page=1;query.loaded=true;query.loading=false;query.hasMore=hasMore;query.error="";query.retryableError="";return query;
};
window.testRail.seedMovies = (id, count, prefix, firstTmdbId) => {
  const query=secondaryGetQuery(id);query.items=Array.from({length:count},(_,i)=>({
    id:prefix+"-"+i,tmdbId:firstTmdbId+i,title:prefix+" item "+i,mediaType:"movie",media_type:"movie",source:"tmdb",
    pic:"/"+prefix+"-poster-"+i+".jpg",landscape:"/"+prefix+"-backdrop-"+i+".jpg",overview:"fixture"
  }));
  query.page=1;query.loaded=true;query.loading=false;query.hasMore=false;query.error="";query.retryableError="";return query;
};
window.testRail.setPageLoader = loader => { loadSecondaryPage=loader; };
window.testRail.visibleCount = () => tvBrowseInitialVisibleCardCount(document.querySelector("#tvBrowseRail"),Number.MAX_SAFE_INTEGER);
window.testRail.cards = (rail=document.querySelector("#tvBrowseRail")) => Array.from(tvBrowseRailCards(rail));
window.testRail.positionPixels = (rail=document.querySelector("#tvBrowseRail")) => tvBrowseRailCurrentPosition(rail);
window.testRail.setPositionPixels = (value,rail=document.querySelector("#tvBrowseRail")) => tvBrowseWriteRailPosition(rail,value,{silent:true});
window.testRail.targetPosition = (card,rail=document.querySelector("#tvBrowseRail")) => tvBrowseRailTargetScrollLeft(card,rail);
window.testRail.artworkState = id => {
  const entry=state.movieDetail.cache["movie:"+id],asset=entry&&entry.logoAsset;
  return {detail:!!(entry&&entry.detail),hasLogo:!!asset,url:asset&&asset.url||"",ready:!!(asset&&asset.ready),failed:!!(asset&&asset.failed),pending:!!(asset&&asset.promise),decodeState:asset&&asset.decodeState||""};
};
window.testRail.readiness = queryKey => tvBrowseState().railReadyByQuery[queryKey]||null;
window.testRail.position = queryKey => tvBrowseState().positions[queryKey||tvBrowseQueryKey()]||null;
window.testRail.previewState = () => {
  const ui=tvBrowseState();
  return {key:ui.previewKey,presentedKey:ui.presentedKey,backdrops:Array.from(document.querySelectorAll("#tvBrowseBackdrop,#tvBrowseBackdropNext"))
    .filter(layer=>layer.classList.contains("visible")).map(layer=>({key:layer.dataset.tvBrowseBackdropKey,url:layer.dataset.tvBrowseBackdropUrl}))};
};
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
const detailRequested = [];
const logoRequested = [];
const backdropRequested = [];
const failedPaths = new Set();
let holdPrefix = "";
const holdFragments = new Set();
const noLogoIds = new Set();
async function openPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", error => { throw error; });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin === "http://fixture.local" && url.pathname === "/") {
      return route.fulfill({ contentType: "text/html", body: html });
    }
    const detailMatch = url.pathname.match(/^\/tmdb\/movie\/(\d+)$/);
    if (url.origin === "http://fixture.local" && detailMatch) {
      const id = detailMatch[1];
      detailRequested.push(id);
      const logos = noLogoIds.has(id) ? [] : [{ file_path: `/logo-${id}.png`, iso_639_1: "en", vote_average: 5 }];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({
        id: Number(id), media_type: "movie", title: `Fixture ${id}`, overview: `Overview ${id}`,
        release_date: "2024-01-01", backdrop_path: null, images: { logos }
      }) });
    }
    if (route.request().resourceType() === "image") {
      const path = url.pathname;
      requested.push(path);
      const logoMatch = path.match(/logo-(\d+)\.png/);
      if (logoMatch) logoRequested.push(logoMatch[1]);
      if (path.includes("backdrop")) backdropRequested.push(path);
      if (holdPrefix && path.includes(holdPrefix) || Array.from(holdFragments).some(fragment => path.includes(fragment))) {
        await new Promise(resolve => held.set(path, resolve));
      }
      if (Array.from(failedPaths).some(fragment => path.includes(fragment))) return route.abort();
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#31513f"/></svg>' });
    }
    return route.abort();
  });
  await page.goto("http://fixture.local/?_tv=1");
  await page.evaluate(() => testRail.installDecodeProbe());
  await page.evaluate(() => testRail.setup());
  await page.waitForFunction(() => document.querySelectorAll("#tvBrowseRail > .card").length > 0);
  return page;
}
function releaseHeld(fragment = "") {
  const callbacks = [];
  for (const [path, resolve] of held) {
    if (!fragment || path.includes(fragment)) { callbacks.push(resolve); held.delete(path); }
  }
  callbacks.forEach(resolve => resolve());
}
function heldCount(fragment) {
  return Array.from(held.keys()).filter(path => !fragment || path.includes(fragment)).length;
}
async function waitUntil(predicate, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= end) throw new Error("Timed out waiting for the expected intercepted image requests");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

try {
  holdPrefix="recommend-poster-";
  const page = await openPage();
  await page.waitForFunction(() => testRail.tvBrowseState().railReadiness
    && !document.querySelector("#tvBrowseRailLoader").hidden);
  const initialColumns = await page.evaluate(() => {
    const columns=document.querySelector("#tvBrowseColumns"),first=columns.querySelector("button"),rect=columns.getBoundingClientRect();
    return {pending:columns.classList.contains("tv-browse-columns-pending"),visibility:getComputedStyle(columns).visibility,
      ariaHidden:columns.getAttribute("aria-hidden"),tabIndex:first&&first.getAttribute("tabindex"),height:rect.height,
      focusable:first&&testRail.isVisibleFocusable(first),loaderHidden:document.querySelector("#tvBrowseRailLoader").hidden};
  });
  assert.equal(initialColumns.pending,true,"the initial TV Browse template carries its pre-paint cold-readiness marker");
  assert.equal(initialColumns.visibility,"hidden","the first-frame columns stay visually hidden while the existing first-screen gate is pending");
  assert.equal(initialColumns.ariaHidden,"true","hidden initial category controls are excluded from accessibility focus");
  assert.equal(initialColumns.tabIndex,"-1","hidden initial category controls cannot receive remote focus");
  assert.equal(initialColumns.focusable,false,"the existing focusability check rejects the hidden category control");
  assert.ok(initialColumns.height>0,"visibility hiding preserves the measured category-row layout slot");
  assert.equal(initialColumns.loaderHidden,false,"the existing rail gate, rather than a second timer, controls the initial wait state");
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())));
  assert.equal(await page.locator("#tvBrowseColumns").evaluate(node=>getComputedStyle(node).visibility),"hidden",
    "the category row remains hidden at the first animation frame after the Browse activation task");
  await page.evaluate(() => testRail.focusRemoteTarget(document.querySelector("#tvFunction-search")));
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement.id),"tvFunction-search",
    "directional input cannot move focus into the temporarily invisible category row");
  releaseHeld("recommend-poster-");
  holdPrefix="";
  await page.waitForFunction(() => !document.querySelector("#tvBrowseColumns").classList.contains("tv-browse-columns-pending")
    && document.querySelector("#tvBrowseRailLoader").hidden);
  const releasedColumns = await page.evaluate(() => {
    const columns=document.querySelector("#tvBrowseColumns"),first=columns.querySelector("button"),rect=columns.getBoundingClientRect();
    return {visibility:getComputedStyle(columns).visibility,ariaHidden:columns.getAttribute("aria-hidden"),tabIndex:first&&first.getAttribute("tabindex"),
      height:rect.height,focusId:document.activeElement.id};
  });
  assert.equal(releasedColumns.visibility,"visible","the existing gate completion reveals the category row in the same presentation phase");
  assert.equal(releasedColumns.ariaHidden,"false","category accessibility visibility is restored with the row");
  assert.equal(releasedColumns.tabIndex,"0","existing category focusability is restored after readiness");
  assert.ok(Math.abs(releasedColumns.height-initialColumns.height)<0.5,"revealing the row does not change its measured layout height");
  assert.equal(releasedColumns.focusId,"tvFunction-search","revealing columns does not steal focus after the user moves it");
  requested.length=0; detailRequested.length=0; logoRequested.length=0; backdropRequested.length=0;
  const visibleCount = await page.evaluate(() => testRail.visibleCount());
  assert.ok(visibleCount >= 1 && visibleCount < 18, "first-screen count is measured from the rendered rail");
  await page.evaluate(() => testRail.clearDecodeProbe());

  testRailHoldMoviePosters();
  holdFragments.add("logo-62000.png");
  holdFragments.add("cold-movie-backdrop-0.jpg");
  noLogoIds.add("62001");
  failedPaths.add("logo-62002.png");
  const coldSwitch = await page.evaluate(() => {
    testRail.seedMovies("movie", 18, "cold-movie", 62000);
    const previousTitle=document.querySelector("#tvBrowseTitle").textContent;
    testRail.tvBrowseSelectColumn("movie",{afterPaint:true});
    const host=document.querySelector("#tvBrowsePosters");
    return {previousTitle,presentedTitle:document.querySelector("#tvBrowseTitle").textContent,previewKey:testRail.tvBrowseState().previewKey,
      pending:host.classList.contains("rail-switch-pending"),columnsPending:document.querySelector("#tvBrowseColumns").classList.contains("tv-browse-columns-pending"),
      columnsVisible:getComputedStyle(document.querySelector("#tvBrowseColumns")).visibility==="visible",
      oldCardsHidden:Array.from(document.querySelectorAll("#tvBrowseRail > .card")).every(card=>getComputedStyle(card).visibility==="hidden"),loaderHidden:document.querySelector("#tvBrowseRailLoader").hidden};
  });
  assert.equal(coldSwitch.columnsPending,false,"ordinary category changes do not re-arm the one-time initial columns marker");
  assert.equal(coldSwitch.columnsVisible,true,"ordinary category changes keep the category row visible while their existing rail gate runs");
  assert.equal(coldSwitch.pending,true,"old-category cards are hidden immediately while the cold selection render is queued");
  assert.equal(coldSwitch.oldCardsHidden,true,"previous-category cards cannot masquerade as the newly selected category");
  assert.equal(coldSwitch.loaderHidden,true,"the wait animation appears only after the current first-screen gate confirms work is pending");
  await page.waitForFunction(() => testRail.tvBrowseState().railReadiness && !document.querySelector("#tvBrowseRailLoader").hidden);
  await page.waitForFunction(() => Array.from(document.querySelectorAll("#tvBrowseRail > .card img.poster"))
    .filter(image => image.src.includes("cold-movie-poster")).length >= testRail.visibleCount());
  await waitUntil(() => heldCount("cold-movie-poster-") >= visibleCount);
  assert.equal(heldCount("cold-movie-poster-"),visibleCount,"the extra offscreen poster must wait until the first-screen gate releases");
  await waitUntil(() => new Set(detailRequested).size >= visibleCount);
  assert.deepEqual(new Set(detailRequested),new Set(Array.from({length:visibleCount},(_,index)=>String(62000+index))),
    "Logo detail preparation follows only the dynamically measured first screen while its poster gate is pending");
  assert.equal(detailRequested.includes(String(62000+visibleCount)),false,
    "the right-side target does not start before the complete first-screen gate releases");
  await waitUntil(() => logoRequested.includes("62000"));
  await waitUntil(() => backdropRequested.includes("/cold-movie-backdrop-0.jpg"));
  const heldLogoPath = Array.from(held.keys()).find(path => path.includes("logo-62000.png"));
  assert.ok(heldLogoPath,"the first card's Logo image is independently held after its detail metadata is ready");
  assert.equal(heldCount("/cold-movie-backdrop-0.jpg"),1,"the first card backdrop is prepared alongside its poster and detail");
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
    busy:document.querySelector("#tvBrowseRail").getAttribute("aria-busy"),
    title:document.querySelector("#tvBrowseTitle").textContent,
    previewKey:testRail.tvBrowseState().previewKey,
    backdropKeys:Array.from(document.querySelectorAll("#tvBrowseBackdrop,#tvBrowseBackdropNext"))
      .filter(layer=>layer.classList.contains("visible")).map(layer=>layer.dataset.tvBrowseBackdropKey)
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
  assert.equal(coldSwitch.previewKey,"","cold preparation does not set the new category preview identity early");
  assert.equal(coldState.title,coldSwitch.previousTitle,"old preview text remains intact until the new first screen commits");
  assert.equal(coldState.previewKey,"","the target preview key is not published before all first-screen resources settle");
  assert.equal(coldState.backdropKeys.includes("cold-movie-0"),false,"no target-category background is committed while any required first-screen resource is pending");

  releaseHeld("cold-movie-poster-");
  await page.waitForTimeout(60);
  assert.equal(await page.locator("#tvBrowseRailLoader").isHidden(),false,
    "poster completion alone cannot release the rail while Logo and background work remain pending");
  releaseHeld("logo-62000.png");
  releaseHeld("cold-movie-backdrop-0.jpg");
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
    count:testRail.visibleCount(),
    queryKey:testRail.tvBrowseQueryKey(),
    resources:testRail.readiness(testRail.tvBrowseQueryKey()).resources.map(resource=>({
      poster:resource.posterState,posterDecode:resource.posterDecodeState,detail:resource.detailState,
      logo:resource.logoState,logoDecode:resource.logoDecodeState,
      background:resource.backgroundState,backgroundDecode:resource.backgroundDecodeState
    })),
    preview:testRail.previewState(),
    decodeRequests:window.decodeRequests.slice()
  }));
  assert.equal(ready.loading,false,"the first screen is revealed as one stable set");
  assert.equal(ready.cards.every(card=>card.visible),true);
  assert.equal(ready.cards.every(card=>card.state==="ready"),true,
    "visible posters have completed load and decode (or the supported load fallback)");
  assert.equal(ready.resources.length,ready.count,"the gate records a terminal resource result for every visible card");
  assert.equal(ready.resources.every(resource=>["ready","loaded-no-decode","failed","decode-failed","timed-out"].includes(resource.poster)
    && ["ready","absent","failed","timed-out"].includes(resource.detail)
    && ["ready","loaded-no-decode","absent","failed","decode-failed","timed-out"].includes(resource.logo)
    && ["ready","loaded-no-decode","absent","failed","decode-failed","timed-out"].includes(resource.background)),true,
    "each visible card stores completed or stable-degradation outcomes rather than request-start state");
  assert.equal(ready.resources.every(resource=>resource.detail==="ready"&&resource.background==="ready"),true,
    "TMDB detail and background decode are complete before the cold screen commits");
  assert.equal(ready.resources.every(resource=>["ready","loaded-no-decode","failed","decode-failed","timed-out"].includes(resource.posterDecode)
    && ["ready","loaded-no-decode","absent","failed","decode-failed","timed-out"].includes(resource.logoDecode)
    && ["ready","loaded-no-decode","absent","failed","decode-failed","timed-out"].includes(resource.backgroundDecode)),true,
    "poster, Logo and background load outcomes distinguish decode success, unsupported decode, failure and timeout");
  assert.equal(ready.resources.every(resource=>["ready","loaded-no-decode"].includes(resource.backgroundDecode)),true,
    "background load completion and decode readiness are recorded separately");
  assert.equal(ready.resources.some(resource=>resource.logo==="absent"),true,
    "a confirmed no-Logo result is a terminal resource state");
  assert.equal(ready.resources.some(resource=>resource.logo==="failed"),true,
    "a failed Logo image is a terminal resource state");
  assert.equal(ready.preview.key,"cold-movie-0","the selected preview is committed only after the full first-screen gate");
  assert.equal(ready.preview.presentedKey,"cold-movie-0","the presented resource identity matches the selected first card");
  assert.deepEqual(ready.preview.backdrops.map(layer=>layer.key),["cold-movie-0"],
    "the initial background is committed for the same first card as the text and Logo");
  assert.equal(backdropRequested.filter(path=>path==="/cold-movie-backdrop-0.jpg").length,1,
    "the background prepared for the gate is reused by presentation without another request");
  assert.equal(ready.decodeRequests.filter(url=>url.includes("/cold-movie-backdrop-0.jpg")).length,1,
    "the selected backdrop is decoded once during preparation and reused by presentation");
  assert.equal(logoRequested.filter(id=>id>=62000&&id<62000+ready.count).length,ready.count-1,
    "each Logo-bearing first-screen resource is requested once while the confirmed no-Logo resource creates none");
  assert.equal(new Set(logoRequested.filter(id=>id>=62000&&id<62000+ready.count)).size,ready.count-1,
    "Logo requests are deduplicated across the gate and the post-gate preparation pass");
  assert.equal(ready.warmKey,"cold-movie-"+ready.count,"one right-side offscreen poster is prepared immediately after the gate");
  assert.equal(requested.filter(path=>path.includes("cold-movie-poster-")).length,ready.count+1,
    "the extra active poster request is limited to the first offscreen card");

  const logoWaitState=await page.evaluate(()=>({
    title:document.querySelector("#tvBrowseTitle").textContent,
    titleVisible:!document.querySelector("#tvBrowseTitle").hidden&&getComputedStyle(document.querySelector("#tvBrowseTitle")).visibility!=="hidden",
    logoVisible:!document.querySelector("#tvBrowseLogo").hidden,
    state:testRail.artworkState(62000),
    preparationKeys:testRail.tvBrowseState().logoPreparationKeys.slice()
  }));
  assert.equal(logoWaitState.title,"cold-movie item 0","the selected first-card title remains the fallback text content after the full-screen commit");
  assert.equal(logoWaitState.titleVisible,false,"the complete cold-screen presentation can immediately use the already prepared Logo");
  assert.equal(logoWaitState.logoVisible,true,"the Logo is presented in the same commit as the first card preview");
  assert.equal(logoWaitState.state.ready,true,"the shared Logo asset records its loaded and decoded state before the gate releases");
  assert.equal(logoWaitState.state.pending,false,"the gate does not confuse an in-flight Logo Promise with readiness");
  assert.equal(logoWaitState.preparationKeys.includes("cold-movie-"+ready.count),true,
    "the one right-side poster warm target also enters the same Logo preparation window after the gate");
  await waitUntil(()=>detailRequested.includes(String(62000+ready.count)));
  await waitUntil(()=>backdropRequested.includes("/cold-movie-backdrop-"+ready.count+".jpg"));
  assert.equal(detailRequested.includes(String(62000+ready.count+1)),false,
    "complete resource preparation does not extend beyond the one right-side target");
  await waitUntil(()=>logoRequested.filter(id=>id===String(62000+ready.count)).length===1);
  assert.equal(logoRequested.filter(id=>id===String(62000+ready.count)).length,1,
    "the single offscreen card's prepared Logo is requested once");
  assert.equal(backdropRequested.filter(path=>path==="/cold-movie-backdrop-"+ready.count+".jpg").length,1,
    "the single offscreen target also prepares its background exactly once");

  const requestsBeforeFocus=logoRequested.length;
  await page.evaluate(()=>{
    const card=document.querySelectorAll("#tvBrowseRail > .card")[0];
    card.focus();tvBrowsePosition().key=card.dataset.mediaKey;tvBrowsePosition().index=0;
    tvBrowsePreview(card.__mediaItem);
  });
  assert.equal(await page.locator("#tvBrowseTitle").isVisible(),false,
    "focusing a card with a prepared Logo keeps the prepared artwork presentation");
  assert.equal(await page.locator("#tvBrowseLogo").isVisible(),true,
    "the focused prepared Logo remains visible instead of being cleared and reloaded");
  assert.equal(logoRequested.length,requestsBeforeFocus,
    "focus presentation consumes the active preparation result and does not start a second Logo request");

  const noLogoCard=await page.evaluate(()=>({
    key:document.querySelectorAll("#tvBrowseRail > .card")[1].dataset.mediaKey,
    title:document.querySelectorAll("#tvBrowseRail > .card .card-title")[1].textContent
  }));
  await page.evaluate(()=>{
    const card=document.querySelectorAll("#tvBrowseRail > .card")[1];card.focus();
    tvBrowsePosition().key=card.dataset.mediaKey;tvBrowsePosition().index=1;tvBrowsePreview(card.__mediaItem);
  });
  await page.waitForFunction(()=>testRail.artworkState(62001).detail);
  assert.equal(await page.locator("#tvBrowseTitle").textContent(),noLogoCard.title,
    "a detail response with no Logo uses the ordinary title without waiting");
  assert.equal(await page.locator("#tvBrowseLogo").isHidden(),true,
    "a media item without Logo artwork keeps the standard text title");
  assert.equal(await page.evaluate(()=>testRail.artworkState(62001).hasLogo),false,
    "no Logo URL creates no image task");

  await page.waitForFunction(()=>testRail.artworkState(62002).failed);
  await page.evaluate(()=>{
    const card=document.querySelectorAll("#tvBrowseRail > .card")[2];card.focus();
    tvBrowsePosition().key=card.dataset.mediaKey;tvBrowsePosition().index=2;tvBrowsePreview(card.__mediaItem);
  });
  assert.equal(await page.locator("#tvBrowseTitle").isVisible(),true,
    "a failed Logo request retains the ordinary title without waiting");
  assert.equal(await page.locator("#tvBrowseLogo").isHidden(),true,
    "a failed Logo image falls back to text instead of leaving an empty artwork slot");

  // A rapid viewport jump updates the shared preparation window without
  // creating a focus-direction Logo queue or widening the single-card lead.
  const quickWindow=await page.evaluate(()=>{
    const rail=document.querySelector("#tvBrowseRail"),cards=testRail.cards(rail);
    testRail.tvBrowseCancelRailScroll();
    [9,3,13,7].forEach(index=>{
      testRail.setPositionPixels(testRail.targetPosition(cards[index],rail),rail);
      testRail.tvBrowseSyncRailImagePreparation();
    });
    const style=getComputedStyle(rail),rect=rail.getBoundingClientRect();
    const left=rect.left+rail.clientLeft+(parseFloat(style.paddingLeft)||0),right=rect.left+rail.clientLeft+rail.clientWidth-(parseFloat(style.paddingRight)||0);
    const visible=cards.filter(card=>{const r=card.getBoundingClientRect();return r.right>left+.5&&r.left<right-.5;});
    return {keys:testRail.tvBrowseState().logoPreparationKeys.slice(),expected:visible.map(card=>card.dataset.mediaKey),cards:cards.length};
  });
  const expectedQuickKeys=quickWindow.expected.slice();
  const rightmostIndex=await page.evaluate(keys=>Math.max(...keys.map(key=>Array.from(document.querySelectorAll("#tvBrowseRail > .card")).findIndex(card=>card.dataset.mediaKey===key))),expectedQuickKeys);
  if(rightmostIndex+1<quickWindow.cards) expectedQuickKeys.push(await page.locator(`#tvBrowseRail > .card:nth-child(${rightmostIndex+2})`).getAttribute("data-media-key"));
  assert.deepEqual(quickWindow.keys,expectedQuickKeys,"quick scrolling prepares the current visible cards plus only the next screen-edge card");
  assert.ok(quickWindow.keys.length<=quickWindow.expected.length+1,"rapid viewport updates keep the Logo preparation window bounded");
  releaseHeld("logo-62000.png");holdFragments.clear();
  await page.waitForFunction(()=>testRail.artworkState(62000).ready,
    {},{timeout:5000});
  await page.evaluate(()=>{
    const rail=document.querySelector("#tvBrowseRail"),card=testRail.cards(rail)[0];testRail.setPositionPixels(0,rail);
    testRail.tvBrowseSyncRailImagePreparation();card.focus();testRail.tvBrowsePosition().key=card.dataset.mediaKey;
    testRail.tvBrowsePosition().index=0;testRail.tvBrowsePreview(card.__mediaItem);
  });
  await page.waitForFunction(()=>!document.querySelector("#tvBrowseLogo").hidden);
  const logoPresented=await page.evaluate(()=>({
    state:testRail.artworkState(62000),visible:!document.querySelector("#tvBrowseLogo").hidden,
    titleVisibility:getComputedStyle(document.querySelector("#tvBrowseTitle")).visibility,
    decodeSupported:typeof HTMLImageElement.prototype.decode==="function"
  }));
  assert.equal(logoPresented.state.ready,true,"the shared detail entry records its Logo only after preparation completes");
  assert.equal(logoPresented.visible,true,"the prepared Logo is presented after its decode-ready result");
  assert.equal(logoPresented.titleVisibility,"hidden","prepared artwork replaces the fallback title without a blank interval");

  await page.waitForFunction(count=>{
    for(let index=0;index<count;index++){
      const state=testRail.artworkState(62000+index);
      if(index===1){if(!state.detail||state.hasLogo)return false;}
      else if(index===2){if(!state.detail||!state.failed)return false;}
      else if(!state.ready)return false;
    }
    return testRail.artworkState(62000+count).ready;
  },ready.count);
  await page.evaluate(()=>{
    const rail=document.querySelector("#tvBrowseRail");testRail.setPositionPixels(0,rail);
    testRail.tvBrowseSyncRailImagePreparation();
  });

  const detailCountBeforeHotReturn=new Set(detailRequested).size,logoCountBeforeHotReturn=logoRequested.length;
  const sameCategoryPosition=await page.evaluate(()=>{
    const rail=document.querySelector("#tvBrowseRail"),ui=testRail.tvBrowseState(),key=testRail.tvBrowseQueryKey();
    const card=testRail.cards(rail)[5];
    ui.positions[key]={key:card.dataset.mediaKey,index:5,scrollLeft:137};
    testRail.setPositionPixels(137,rail);
    testRail.tvBrowseColumnButton("movie").focus();
    renderTvBrowse();
    return {position:testRail.position(key),scrollLeft:testRail.positionPixels(rail),actualScrollLeft:rail.scrollLeft,focusedColumn:document.activeElement.closest("#tvBrowseColumns")===document.querySelector("#tvBrowseColumns")};
  });
  assert.equal(sameCategoryPosition.position.index,5,"a same-query rerender retains the current card index");
  assert.equal(sameCategoryPosition.position.key,"cold-movie-5","a same-query rerender retains the current media key");
  assert.equal(sameCategoryPosition.scrollLeft,137,"a same-query rerender retains the current rail position");
  assert.equal(sameCategoryPosition.actualScrollLeft,137,"the original scrollLeft position is preserved on a same-query render");
  assert.equal(sameCategoryPosition.focusedColumn,true,"same-query rendering leaves remote focus on its category control");
  await page.evaluate(() => {
    window.movieNodes=Array.from(document.querySelectorAll("#tvBrowseRail > .card"));
    testRail.tvBrowseSelectColumn("recommendation");
    testRail.tvBrowseSelectColumn("movie",{afterPaint:true});
  });
  assert.equal(await page.locator("#tvBrowseRailLoader").isHidden(),true,"a hot category restore does not replay the cold loader");
  assert.equal(await page.evaluate(() => window.movieNodes[0]===document.querySelector("#tvBrowseRail > .card")),true,
    "a hot category restore reuses the same card node");
  const returnedPosition=await page.evaluate(()=>({position:testRail.position(),scrollLeft:testRail.positionPixels(),actualScrollLeft:document.querySelector("#tvBrowseRail").scrollLeft,
    preview:testRail.previewState(),activeColumn:document.activeElement.closest("#tvBrowseColumns")&&document.activeElement.dataset.column}));
  assert.equal(returnedPosition.position.index,0,"a real category change starts at the first card");
  assert.equal(returnedPosition.position.scrollLeft,0,"a real category change resets the rail to its left edge");
  assert.equal(returnedPosition.scrollLeft,0,"the rendered rail starts at the left edge after a category change");
  assert.equal(returnedPosition.preview.key,"cold-movie-0","the restored preview matches the first card of the changed category");
  assert.equal(returnedPosition.activeColumn,"movie","the category focus remains on the selected category capsule");
  assert.equal(new Set(detailRequested).size,detailCountBeforeHotReturn,
    "returning to a hot movie category does not re-request its detail metadata");
  assert.equal(logoRequested.length,logoCountBeforeHotReturn,
    "a hot category revisit does not re-request Logo images");

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
  const pageTvCommit=await page.evaluate(()=>({preview:testRail.previewState(),title:document.querySelector("#tvBrowseTitle").textContent,
    position:testRail.position()}));
  assert.equal(pageTvCommit.preview.key,"page-tv-0","a multi-page cold gate still commits the first selected card after data arrives");
  assert.equal(pageTvCommit.title,"page-tv item 0","the final preview text is committed for the selected card after page extension");
  assert.equal(pageTvCommit.position.index,0,"cold category data extension keeps the first-card selection");
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

  holdPrefix="timed-category";
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
      laterScreen:cards.slice(count).map(card=>card.classList.contains("poster-unavailable")),
      resources:testRail.readiness(testRail.tvBrowseQueryKey()).resources.map(resource=>({background:resource.backgroundState,decode:resource.backgroundDecodeState})),
      preview:testRail.previewState(),title:document.querySelector("#tvBrowseTitle").textContent
    };
  });
  assert.equal(timedStates.firstScreen.every(card=>card.state==="timed-out"&&card.unavailable),true,
    "the first-screen timeout releases the Gate while retaining a recoverable temporary poster state");
  assert.equal(timedStates.laterScreen.some(Boolean),false,
    "only timed-out first-screen images are degraded and the remainder of the rail remains normal");
  assert.equal(timedStates.resources.slice(0,timedCount).every(resource=>resource.background==="timed-out"&&resource.decode==="timed-out"),true,
    "a background request timeout is recorded separately and ends in a stable per-card fallback");
  assert.equal(timedStates.preview.key,"timed-category-0","the timed-out cold screen still commits the selected resource identity");
  assert.equal(timedStates.title,"timed-category item 0","background timeout never delays the selected card title");
  releaseHeld();holdPrefix="";
  await page.waitForFunction(count=>Array.from(document.querySelectorAll("#tvBrowseRail > .card")).slice(0,count)
    .every(card=>card.querySelector("img.poster")?.dataset.tvBrowsePosterState==="ready"&&!card.classList.contains("poster-unavailable")),timedCount,
    {timeout:3000});
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll("#tvBrowseBackdrop,#tvBrowseBackdropNext"))
    .some(layer=>layer.dataset.tvBrowseBackdropKey==="timed-category-0"));
  assert.equal(await page.evaluate(()=>testRail.previewState().key),"timed-category-0",
    "late completion after timeout cannot replace the stable degraded background or change resource identity");

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
        && testRail.cards(rail).slice(0,count).every(card=>["ready","failed"].includes(card.querySelector("img.poster")?.dataset.tvBrowsePosterState));
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

  // The poster can load before the Gate while decode resolves later. Releasing
  // the Gate at five seconds must not discard that same-resource completion.
  await page.evaluate(() => {
    testRail.seedMovies("movie",8,"decode-late",63000);
    testRail.delayDecode("decode-late-poster-0.jpg");
    testRail.tvBrowseSelectColumn("movie");
  });
  await page.waitForFunction(()=>{
    const image=document.querySelector("#tvBrowseRail > .card img.poster");
    return image&&String(image.currentSrc||image.src).includes("decode-late-poster-0.jpg")
      && image.complete&&image.naturalWidth>0&&testRail.tvBrowseState().railReadiness;
  });
  await page.waitForFunction(()=>document.querySelector("#tvBrowseRailLoader").hidden,{},{timeout:6500});
  const decodeTimedOut=await page.evaluate(()=>{
    const card=document.querySelector("#tvBrowseRail > .card"),image=card&&card.querySelector("img.poster");
    return {state:image&&image.dataset.tvBrowsePosterState,unavailable:!!(card&&card.classList.contains("poster-unavailable")),
      decodePending:typeof window.delayedPosterDecodeRelease==="function"};
  });
  assert.equal(decodeTimedOut.state,"timed-out","a slow decode is not cached as a genuine image failure");
  assert.equal(decodeTimedOut.unavailable,true,"the temporary poster state remains visible until decode completes");
  assert.equal(decodeTimedOut.decodePending,true,"the test held the poster decode across the Gate deadline");
  await page.evaluate(()=>testRail.releaseDecode());
  await page.waitForFunction(()=>{
    const card=document.querySelector("#tvBrowseRail > .card"),image=card&&card.querySelector("img.poster");
    return image&&image.dataset.tvBrowsePosterState==="ready"&&!card.classList.contains("poster-unavailable");
  });
  await page.evaluate(()=>testRail.restoreDecode());
  await page.close();
  console.log("TV Browse cold rail checks passed: dynamic first screen, atomic reveal, recoverable poster timeout, single poster handoff, hot reuse, bounded page fill, failure placeholder, stale category guard.");
} finally {
  releaseHeld();
  await browser.close();
}

function testRailHoldMoviePosters() { holdPrefix="cold-movie-poster"; }
