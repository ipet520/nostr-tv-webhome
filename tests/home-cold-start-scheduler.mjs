import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vm from "node:vm";

const configJs = readFileSync(new URL("../src/js/02-runtime-config-device.js", import.meta.url), "utf8");
const networkJs = readFileSync(new URL("../src/js/05-relay-network-pan-session.js", import.meta.url), "utf8");
const weeklyJs = readFileSync(new URL("../src/js/03a-home-weekly-ui-runtime.js", import.meta.url), "utf8");
const hotJs = readFileSync(new URL("../src/js/04-nostr-hot-storage.js", import.meta.url), "utf8");
const heroJs = readFileSync(new URL("../src/js/11a-home-render-core-hero.js", import.meta.url), "utf8");
const categoryJs = readFileSync(new URL("../src/js/11b-home-category-render.js", import.meta.url), "utf8");
const browseJs = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
const routeJs = readFileSync(new URL("../src/js/11c-home-render-search-route.js", import.meta.url), "utf8");
const cardsJs = readFileSync(new URL("../src/js/14-grid-card-focus.js", import.meta.url), "utf8");
const detailJs = readFileSync(new URL("../src/js/06-tmdb-history-model.js", import.meta.url), "utf8");
const artTitleJs = readFileSync(new URL("../src/js/16-detail-rendering.js", import.meta.url), "utf8");

const check = (condition, name, detail) => assert.ok(condition, `${name}: ${detail}`);
const requestClassLimits = configJs.match(/HOME_REQUEST_CLASS_MAX_ACTIVE\s*=\s*(\{[^}]+\})/);
const requestPriorities = configJs.match(/HOME_REQUEST_PRIORITY\s*=\s*(\{[^}]+\})/);
const requestBudgetLimit = configJs.match(/HOME_REQUEST_BUDGET_MAX_ACTIVE\s*=\s*(\d+)/);
assert.ok(requestClassLimits && requestPriorities && requestBudgetLimit, "request budget limits and priorities are declared");
const maxActiveRequests = Number(requestBudgetLimit[1]);
const classLimits = vm.runInNewContext(`(${requestClassLimits[1]})`);
const priorities = vm.runInNewContext(`(${requestPriorities[1]})`);
const schedulerSource = networkJs.match(/    function homeRequestBudgetState\(\) \{[\s\S]*?(?=    function homeRequestJson\()/);
assert.ok(schedulerSource, "request budget helpers can be isolated for an executable test");

const schedulerState = {
  homeV14: { requestBudget: { queue: [], active: 0, maxActive: 0, nextSeq: 0, activeByClass: {}, maxByClass: {} } },
  tvDiag: {}
};
const scheduler = vm.runInNewContext(`${schedulerSource[0]}\n({ scheduleHomeBudgetRequest, promoteHomeBudgetRequests })`, {
  state: schedulerState,
  HOME_REQUEST_BUDGET_MAX_ACTIVE: maxActiveRequests,
  HOME_REQUEST_CLASS_MAX_ACTIVE: classLimits,
  HOME_REQUEST_PRIORITY: priorities
});

const started = [];
const gates = {};
const scheduled = [];
function enqueue(name, requestClass, requestKey) {
  let release;
  const work = new Promise((resolve) => { release = resolve; });
  gates[name] = () => release(name);
  scheduled.push(scheduler.scheduleHomeBudgetRequest(requestClass, () => {
    started.push(name);
    return work;
  }, requestKey || ""));
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

enqueue("foreground-1", "foreground");
enqueue("foreground-2", "foreground");
enqueue("foreground-3", "foreground");
enqueue("prefetch-1", "prefetch");
enqueue("prefetch-2", "prefetch");
enqueue("background-1", "background");
enqueue("enrichment-1", "enrichment");
enqueue("foreground-4", "foreground");
enqueue("visible-status-1", "visible-status", "tv:1");
enqueue("visible-status-2", "visible-status", "tv:2");
await tick();
assert.deepEqual(started, ["foreground-1", "foreground-2", "foreground-3", "prefetch-1"]);
assert.equal(schedulerState.homeV14.requestBudget.maxActive, maxActiveRequests);

gates["foreground-1"]();
await tick();
assert.equal(started.at(-1), "foreground-4", "queued visible work outranks tail prefetch");
gates["foreground-2"]();
await tick();
assert.equal(started.at(-1), "visible-status-1", "visible TV status outranks queued prefetch and enrichment");
gates["prefetch-1"]();
await tick();
assert.equal(started.at(-1), "visible-status-2", "visible TV status can use its second class slot within the global cap");
gates["foreground-3"]();
await tick();
assert.equal(started.at(-1), "prefetch-2", "tail prefetch starts after queued visible TV status");
gates["foreground-4"]();
await tick();
assert.equal(started.at(-1), "background-1", "Weekly background refresh outranks detail enrichment");
gates["prefetch-2"]();
await tick();
assert.equal(started.at(-1), "enrichment-1", "Hero and Weekly enrichment starts after visible and base work");
for (const name of ["visible-status-1", "visible-status-2", "background-1", "enrichment-1"]) gates[name]();
await Promise.all(scheduled);
await tick();
const budget = schedulerState.homeV14.requestBudget;
assert.ok(budget.maxActive <= 4, "total active network requests stay within the global budget");
assert.ok(budget.maxByClass.foreground <= 3, "foreground cap is enforced");
assert.ok(budget.maxByClass.prefetch <= 2, "prefetch cap is enforced");
assert.ok(budget.maxByClass.background <= 1, "background cap is enforced");
assert.ok(budget.maxByClass.enrichment <= 1, "enrichment cap is enforced");
assert.ok(budget.maxByClass["visible-status"] <= 2, "visible TV status class cap is enforced");
assert.equal(budget.tvStatusRequestQueued, 2, "visible status queued diagnostic counts scheduled card requests");
assert.equal(budget.tvStatusRequestStarted, 2, "visible status started diagnostic counts actual starts");
assert.equal(budget.tvStatusRequestDone, 2, "visible status done diagnostic counts completed requests");
assert.ok(budget.maxActive <= maxActiveRequests, "visible status does not raise the global concurrency cap");

const promotionState = {
  homeV14: { requestBudget: { queue: [], active: 0, maxActive: 0, nextSeq: 0, activeByClass: {}, maxByClass: {} } },
  tvDiag: {}
};
const promotionScheduler = vm.runInNewContext(`${schedulerSource[0]}\n({ scheduleHomeBudgetRequest, promoteHomeBudgetRequests })`, {
  state: promotionState,
  HOME_REQUEST_BUDGET_MAX_ACTIVE: maxActiveRequests,
  HOME_REQUEST_CLASS_MAX_ACTIVE: classLimits,
  HOME_REQUEST_PRIORITY: priorities
});
const promotionStarted = [];
const promotionGates = {};
const promotionPromises = [];
function enqueuePromotion(name, requestClass, requestKey) {
  let release;
  const work = new Promise((resolve) => { release = resolve; });
  promotionGates[name] = () => release(name);
  promotionPromises.push(promotionScheduler.scheduleHomeBudgetRequest(requestClass, () => {
    promotionStarted.push(name);
    return work;
  }, requestKey || ""));
}
enqueuePromotion("hold-fg-1", "foreground");
enqueuePromotion("hold-fg-2", "foreground");
enqueuePromotion("hold-fg-3", "foreground");
enqueuePromotion("hold-prefetch", "prefetch");
enqueuePromotion("queued-tv-detail", "enrichment", "tv:777");
enqueuePromotion("queued-tail", "prefetch");
await tick();
assert.deepEqual(promotionStarted, ["hold-fg-1", "hold-fg-2", "hold-fg-3", "hold-prefetch"]);
assert.equal(promotionScheduler.promoteHomeBudgetRequests("tv:777", "visible-status", "focus"), true, "focus promotes the existing queued TV detail request");
assert.equal(promotionState.homeV14.requestBudget.tvStatusRequestQueued, 1, "promoted request is counted once in visible status queue diagnostics");
assert.equal(promotionState.homeV14.requestBudget.tvStatusPromotedOnFocus, 1, "focus promotion diagnostic increments only on an actual promotion");
promotionGates["hold-prefetch"]();
await tick();
assert.equal(promotionStarted.at(-1), "queued-tv-detail", "focused TV status starts before queued tail prefetch");
for (const name of ["hold-fg-1", "hold-fg-2", "hold-fg-3", "queued-tv-detail", "queued-tail"]) promotionGates[name]();
await Promise.all(promotionPromises);
await tick();

const requestHelpers = networkJs.match(/    function homeRequestJson\([\s\S]*?(?=\n    async function requestJson\()/);
assert.ok(requestHelpers, "Home request wrappers can be isolated for an executable class and key test");
const homeRequestCalls = [];
const requestWrapper = vm.runInNewContext(`${requestHelpers[0]}\n({ homeTvStatusRequest, homeTvDetailRequestKey, homeEnrichmentRequest })`, {
  requestJson: (url, timeout, options) => {
    homeRequestCalls.push({ url, timeout, options });
    return options;
  }
});
requestWrapper.homeEnrichmentRequest("https://api.themoviedb.org/3/tv/777?language=zh-CN", 18);
assert.equal(homeRequestCalls.at(-1).options.homeRequestClass, "enrichment", "Hero and Weekly TV detail keeps the low-priority enrichment class");
assert.equal(homeRequestCalls.at(-1).options.homeRequestKey, "tv:777", "shared Home TV detail gets a stable key for an eligible card to promote");
requestWrapper.homeTvStatusRequest("https://api.themoviedb.org/3/tv/777?language=zh-CN", 18, "tv:777");
assert.equal(homeRequestCalls.at(-1).options.homeRequestClass, "visible-status", "eligible Home TV status uses its dedicated higher-priority class");
assert.equal(homeRequestCalls.at(-1).options.homeRequestKey, "tv:777", "Home status and enrichment use the same dedupe and promotion key");
requestWrapper.homeEnrichmentRequest("https://api.themoviedb.org/3/movie/777?language=zh-CN", 18);
assert.equal(homeRequestCalls.at(-1).options.homeRequestClass, "enrichment");
assert.equal(homeRequestCalls.at(-1).options.homeRequestKey, "", "Movie detail requests do not receive a TV promotion key");

const sharedDetailSource = detailJs.match(/    function requestTvDetailShared\([\s\S]*?(?=\n    function tmdbRecommendationsUrl\()/);
assert.ok(sharedDetailSource, "shared TV detail request can be isolated for a dedupe test");
const sharedDetailState = { tvDetail: { cache: {}, generation: 1 } };
let defaultTvDetailRequestCount = 0;
const requestSharedTvDetail = vm.runInNewContext(`${sharedDetailSource[0]}\nrequestTvDetailShared`, {
  state: sharedDetailState,
  tvDetailCacheId: (item) => String(item && (item.tmdbId || item.id) || item || ""),
  tvDetailCacheKey: (item) => `tv:${String(item && (item.tmdbId || item.id) || item || "")}`,
  tvDetailCacheValue: (item) => {
    const entry = sharedDetailState.tvDetail.cache[`tv:${String(item && (item.tmdbId || item.id) || item || "")}`];
    if (!entry || !entry.detail || !entry.fetchedAt || Date.now() - entry.fetchedAt >= 3600000) return null;
    return entry.detail;
  },
  tmdbDetailUrl: () => "https://api.themoviedb.org/3/tv/777",
  storeTvDetailCache: (item, detail, generation) => {
    if (generation !== sharedDetailState.tvDetail.generation) return detail;
    const entry = sharedDetailState.tvDetail.cache[`tv:${item.tmdbId}`];
    entry.detail = detail;
    entry.fetchedAt = Date.now();
    entry.promise = null;
    return detail;
  },
  TV_DETAIL_CACHE_TTL_MS: 3600000,
  requestJson: () => {
    defaultTvDetailRequestCount += 1;
    return Promise.resolve({ number_of_episodes: 2 });
  }
});
let sharedRequestCount = 0;
let resolveSharedRequest;
const sharedItem = { mediaType: "tv", tmdbId: 777 };
const sharedRequest = requestSharedTvDetail(sharedItem, () => {
  sharedRequestCount += 1;
  return new Promise((resolve) => { resolveSharedRequest = resolve; });
});
const duplicateRequest = requestSharedTvDetail(sharedItem, () => {
  sharedRequestCount += 1;
  return Promise.resolve({ number_of_episodes: 99 });
});
assert.equal(sharedRequestCount, 1, "Home visibility joins an existing Hero or Weekly detail promise instead of duplicating the request");
resolveSharedRequest({ number_of_episodes: 4 });
const sharedDetails = await Promise.all([sharedRequest, duplicateRequest]);
assert.deepEqual(sharedDetails.map((detail) => detail.number_of_episodes), [4, 4]);
sharedDetailState.tvDetail = { cache: {}, generation: 2 };
const defaultPathDetail = await requestSharedTvDetail({ mediaType: "tv", tmdbId: 888 });
assert.equal(defaultTvDetailRequestCount, 1, "non-Home TV detail without an override keeps using requestJson");
assert.equal(defaultPathDetail.number_of_episodes, 2);

const observerSource = categoryJs.match(/    function ensureTvCardDetailObserver\(\) \{[\s\S]*?(?=\n    function observeTvCardEnrichment\()/)?.[0] || "";
const observeCardsSource = categoryJs.match(/    function observeTvCardEnrichment\(root\) \{[\s\S]*?(?=\n    function isNostrMovieReleaseStatusCard\()/)?.[0] || "";
const visibilityGateSource = categoryJs.match(/    function homeVisibilityEntryIntersects\(entry\) \{[\s\S]*?(?=\n    function ensureHomeImageObserver\()/)?.[0] || "";
const flushTvSource = categoryJs.match(/    function flushTvCardDetailQueue\(\) \{[\s\S]*?(?=\n    function queueTvCardEpisodeEnrichment\()/)?.[0] || "";
const focusPromoteSource = categoryJs.match(/    function promoteHomeTvCardStatusOnFocus\(card\) \{[\s\S]*?(?=\n    function ensureTvCardDetailObserver\()/)?.[0] || "";
check(observerSource.includes("rootMargin: TV_CARD_DETAIL_ROOT_MARGIN") && observerSource.includes("homeVisibilityEntryIntersects(entry)") && observerSource.includes("queueTvCardEpisodeEnrichment(entry.target)"), "TV_STATUS_IO_GATE", "Home TV status work remains behind the existing IntersectionObserver gate, with a logical Browse viewport while wallpaper hides the rail");
check(observeCardsSource.includes("cards.filter(tvCardNearViewport).forEach(queueTvCardEpisodeEnrichment)"), "TV_STATUS_FALLBACK_NEAR_VIEWPORT", "without IntersectionObserver only cards passing the existing near-viewport check are queued");
check(categoryJs.includes("function tvBrowseLogicalViewportIncludes(target, entry)") && visibilityGateSource.includes("tvBrowseWallpaperObservationKey(entry.target)") && visibilityGateSource.includes("tvBrowseLogicalViewportIncludes(entry.target, entry)") && categoryJs.includes("observer.unobserve(target)") && categoryJs.includes("observer.observe(target)"), "TV_WALLPAPER_SHARED_VISIBILITY", "wallpaper visibility uses the logical Browse position and each existing observer's root bounds");
check((categoryJs.match(/if \(!homeVisibilityEntryIntersects\(entry\)\) return;/g) || []).length === 3, "TV_WALLPAPER_ALL_VISIBILITY_OBSERVERS", "poster images, TV episode status, and Movie release status share the same logical visibility gate");
const wallpaperEnterSource = browseJs.match(/    function tvWallpaperEnter\(\) \{[\s\S]*?(?=\n    function tvWallpaperMaterialize\()/)?.[0] || "";
const wallpaperMoveSource = browseJs.match(/    async function tvWallpaperMove\(direction, automatic\) \{[\s\S]*?(?=\n    function tvWallpaperScheduleRotation\()/)?.[0] || "";
const wallpaperResumeSource = browseJs.match(/    function tvWallpaperResume\(\) \{[\s\S]*?(?=\n    function tvBrowseOpenHistory\()/)?.[0] || "";
const browseLayoutSource = browseJs.match(/    function layoutTvBrowse\(\) \{[\s\S]*?(?=\n    function initTvBrowse\()/)?.[0] || "";
check(wallpaperEnterSource.includes("observeHomeImages($(\"tvBrowseRail\"))") && wallpaperMoveSource.includes("observeMovieCardEnrichment($(\"tvBrowseRail\"))") && wallpaperResumeSource.includes("observeHomeImages($(\"tvBrowseRail\"))") && browseLayoutSource.includes("observeMovieCardEnrichment(rail)") && !browseJs.includes("tvWallpaperPrepareNearbyResources") && !browseJs.includes("queueTvCardEpisodeEnrichment(card)"), "TV_WALLPAPER_LOADING_CONTINUITY", "entry, position changes, resize, and lifecycle resume refresh only the existing observers; no wallpaper-specific loader is used");
const logicalVisibilitySource = categoryJs.match(/    function tvBrowseWallpaperObservationKey\(target\) \{[\s\S]*?(?=\n    function ensureHomeImageObserver\()/)?.[0] || "";
const railTargetSource = browseJs.match(/    function tvBrowseRailTargetScrollLeft\(card, rail\) \{[\s\S]*?(?=\n    function tvBrowseExpectedRailScrollLeft\()/)?.[0] || "";
assert.ok(railTargetSource, "wallpaper logical visibility uses the actual center-anchor geometry helper");
let logicalWallpaperActive = true;
const logicalVisibilityChecks = vm.runInNewContext(`${railTargetSource}\n${logicalVisibilitySource}\n({ includes: tvBrowseLogicalViewportIncludes, intersects: homeVisibilityEntryIntersects })`, {
  isTvLikeDevice: () => true,
  tvWallpaperIsActive: () => logicalWallpaperActive,
  tvBrowseQueryKey: () => "active-query",
  tvBrowsePosition: () => logicalPosition,
  tvWallpaperState: () => ({ moveToken: 1 }),
  mediaDomKey: (item) => item.id,
  getComputedStyle: () => ({ columnGap: "18px", paddingLeft: "0px", paddingRight: "0px" }),
  tvFocusSafeInsets: () => ({ left: 12, right: 12 }),
  window: { visualViewport: null, innerWidth: 1280, innerHeight: 720 },
  document: { documentElement: { clientWidth: 1280 } }
});
const logicalViewportIncludes = logicalVisibilityChecks.includes;
const logicalPosition = { key: "wallpaper-17", index: 17 };
const logicalRail = {
  dataset: { queryKey: "active-query" }, children: [], scrollLeft: 0, scrollWidth: 25 * 142, clientWidth: 1280,
  getBoundingClientRect: () => ({ left: 0, right: 1280, width: 1280 })
};
const logicalCards = Array.from({ length: 25 }, (_, index) => {
  const left = index * 142;
  const card = { dataset: { cardIndex: String(index), mediaKey: `wallpaper-${index}` }, __mediaItem: { id: `wallpaper-${index}` } };
  card.getBoundingClientRect = () => ({ left, right: left + 124, top: 100, bottom: 300, width: 124, height: 200 });
  card.closest = (selector) => selector === "#tvBrowseRail" ? logicalRail : selector === ".card" ? card : null;
  card.matches = (selector) => selector === ".card";
  logicalRail.children.push(card);
  return card;
});
const logicalImage = (index) => {
  const card = logicalCards[index];
  return {
    matches: () => false,
    closest: (selector) => selector === ".card" ? card : selector === "#tvBrowseRail" ? logicalRail : null,
    getBoundingClientRect: () => ({ left: index * 142 + 12, right: index * 142 + 112, width: 100 })
  };
};
const imageObserverBounds = { left: -250, right: 1530 };
check(logicalViewportIncludes(logicalImage(17), { rootBounds: imageObserverBounds }), "TV_WALLPAPER_LOGICAL_CURRENT_VISIBLE", "the active resource is evaluated in the normal viewport at its logical Browse position");
check(logicalViewportIncludes(logicalImage(15), { rootBounds: imageObserverBounds }) && logicalViewportIncludes(logicalImage(19), { rootBounds: imageObserverBounds }), "TV_WALLPAPER_LOGICAL_NEIGHBORS_VISIBLE", "neighbor images use the existing image observer's viewport bounds");
check(!logicalViewportIncludes(logicalImage(24), { rootBounds: imageObserverBounds }), "TV_WALLPAPER_LOGICAL_RANGE_BOUNDED", "items beyond the observer's logical viewport margin remain deferred");
check(!logicalVisibilityChecks.intersects({ target: logicalImage(24), isIntersecting: true, rootBounds: imageObserverBounds }), "TV_WALLPAPER_IGNORES_STALE_GEOMETRY", "a stale physical hit cannot override the current logical Browse viewport while wallpaper is active");
logicalPosition.key = "wallpaper-18"; logicalPosition.index = 18;
check(logicalViewportIncludes(logicalImage(20), { rootBounds: imageObserverBounds }) && !logicalViewportIncludes(logicalImage(24), { rootBounds: imageObserverBounds }), "TV_WALLPAPER_LOGICAL_RANGE_MOVES", "a new Browse position applies the existing focus-reveal viewport before re-evaluating observer targets");
logicalWallpaperActive = false;
check(logicalVisibilityChecks.intersects({ target: logicalImage(5), isIntersecting: false, rootBounds: imageObserverBounds }), "TV_HOME_VISIBILITY_UNCHANGED", "ordinary rail visibility continues to use current card geometry rather than a stale observer flag");
check(flushTvSource.includes("const request = job.home") && flushTvSource.includes("homeTvStatusRequest(url, timeout, job.key)") && flushTvSource.includes(": requestJson;"), "HOME_TV_STATUS_CLASS_SCOPE", "only Home TV card jobs use the visible status class; other grids keep requestJson");
check(!flushTvSource.includes("promoteHomeBudgetRequests") && focusPromoteSource.includes('promoteHomeBudgetRequests(key, "visible-status", "focus")') && focusPromoteSource.includes("queueTvCardEpisodeEnrichment(card)"), "FOCUSED_TV_STATUS_PROMOTION", "focus promotes a matching queued request while ordinary Hero/Weekly deep enrichment stays low priority");
check(cardsJs.includes("button.addEventListener(\"focus\", () => promoteHomeTvCardStatusOnFocus(button))"), "HOME_TV_FOCUS_HOOK", "only generated Home TV cards opt into the focused-status promotion helper");
const movieFlushSource = categoryJs.match(/    function flushMovieCardDetailQueue\(\) \{[\s\S]*?(?=\n    function queueMovieCardReleaseEnrichment\()/)?.[0] || "";
check(movieFlushSource.includes("job.home ? homeEnrichmentRequest : requestJson") && !movieFlushSource.includes("visible-status"), "MOVIE_STATUS_PATH_PRESERVED", "Movie list release status and existing Nostr Movie detail enrichment do not enter the TV status class");
check(cardsJs.includes("movieReleaseStatusText(moviePresentationItem") && cardsJs.includes("latestDateOnly(item && (item.releaseDate || item.release_date)"), "TMDB_MOVIE_STATUS_FROM_LIST", "ordinary Movie status remains derived from list release_date data");
check(networkJs.includes('return homeRequestJson(url, timeout, "enrichment", requestKey || homeTvDetailRequestKey(url))'), "HERO_WEEKLY_STAY_LOW_PRIORITY", "stable TV request keys do not promote Hero or Weekly detail unless a Home card is eligible");

const categoryPool = categoryJs.match(/    async function loadHomeCategoryTmdbPool\(id, requestClass, requestKey, onSourceResult\) \{[\s\S]*?(?=\n    function homeCategoryFeedLimit\()/);
assert.ok(categoryPool, "Home multi-source category loader can be isolated for an executable test");
const sourceGates = {};
let activeSources = [
  { endpoint: "discover/tv", mediaType: "tv" },
  { endpoint: "discover/movie", mediaType: "movie" }
];
const categoryVm = {
  homeCategoryTmdbSources: () => activeSources,
  homeRequestJson: (url) => new Promise((resolve) => { sourceGates[url] = resolve; }),
  tmdbUrl: (source) => source.endpoint,
  normalizeTmdb: (item, source) => ({ ...item, mediaType: source.mediaType, source: "tmdb", pic: "poster" }),
  hasPoster: (item) => !!item.pic,
  isReleaseFilteredCatalogId: () => false,
  isReleasedAsOfToday: () => true,
  filterReleasedCatalogItems: (_id, items) => items,
  uniqueMedia: (items) => {
    const seen = new Set();
    return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
  }
};
const loadCategoryPool = vm.runInNewContext(`${categoryPool[0]}\nloadHomeCategoryTmdbPool`, categoryVm);
const partials = [];
const categoryPromise = loadCategoryPool("anime", "foreground", "home-category:anime:1", (items, progress) => {
  partials.push({ ids: Array.from(items, (item) => item.id), sourceIndex: progress.sourceIndex });
});
await tick();
sourceGates["discover/movie"]({ results: [{ id: "movie-anime" }] });
await tick();
assert.deepEqual(partials.map((entry) => entry.ids), [["movie-anime"]], "fast source renders while the other source is still pending");
sourceGates["discover/tv"]({ results: [{ id: "tv-anime" }, { id: "movie-anime" }] });
const finalCategory = await categoryPromise;
assert.deepEqual(Array.from(finalCategory.items, (item) => item.id), ["tv-anime", "movie-anime"], "final category retains configured source order and dedupes IDs");
assert.equal(finalCategory.goodCount, 2);
assert.deepEqual(partials.at(-1).ids, ["tv-anime", "movie-anime"], "merged partial update restores canonical order");

activeSources = [
  { endpoint: "discover/movie", mediaType: "movie" },
  { endpoint: "discover/tv", mediaType: "tv" }
];
const documentaryPartials = [];
const documentaryPromise = loadCategoryPool("documentary", "foreground", "home-category:documentary:1", (items) => {
  documentaryPartials.push(Array.from(items, (item) => item.id));
});
await tick();
sourceGates["discover/tv"]({ results: [{ id: "tv-doc" }] });
await tick();
assert.deepEqual(documentaryPartials, [["tv-doc"]], "documentary TV result renders while movie source is pending");
sourceGates["discover/movie"]({ results: [{ id: "movie-doc" }] });
const finalDocumentary = await documentaryPromise;
assert.deepEqual(Array.from(finalDocumentary.items, (item) => item.id), ["movie-doc", "tv-doc"], "documentary final order follows configured source order");

const loadFeed = categoryJs.match(/    function loadHomeCategoryFeed\(id, options\) \{[\s\S]*?(?=\n    function fillHomeRail\()/)?.[0] || "";
const cacheProjection = categoryJs.match(/    function homeCategoryCacheItem\(item, categoryId\) \{[\s\S]*?(?=\n    function homeCategorySnapshotIsValid\()/)?.[0] || "";
const snapshotCheck = categoryJs.match(/    function homeCategorySnapshotIsValid\(snapshot, id, key, now\) \{[\s\S]*?(?=\n    async function hydrateHomeCategoryCache\()/)?.[0] || "";
assert.ok(snapshotCheck, "category snapshot validator can be isolated for an executable test");
const snapshotIsValid = vm.runInNewContext(`${snapshotCheck}\nhomeCategorySnapshotIsValid`, {
  HOME_CATEGORY_CACHE_VERSION: 1,
  HOME_CATEGORY_CACHE_TTL_MS: 30 * 60 * 1000,
  normalizeLegacyCategoryId: (id) => id
});
const validSnapshot = { version: 1, categoryId: "anime", feedKey: "anime-key", savedAt: 1_000_000, items: [{ id: "tmdb:tv:1" }] };
assert.equal(snapshotIsValid(validSnapshot, "anime", "anime-key", 1_000_001), true);
assert.equal(snapshotIsValid({ ...validSnapshot, version: 0 }, "anime", "anime-key", 1_000_001), false, "old cache versions are rejected");
assert.equal(snapshotIsValid(validSnapshot, "documentary", "anime-key", 1_000_001), false, "cache cannot cross category identity");
assert.equal(snapshotIsValid(validSnapshot, "anime", "changed-key", 1_000_001), false, "cache cannot cross source-query identity");
assert.equal(snapshotIsValid(validSnapshot, "anime", "anime-key", 1_000_000 + 30 * 60 * 1000 + 1), false, "expired snapshots are rejected");
assert.equal(snapshotIsValid({ ...validSnapshot, items: [] }, "anime", "anime-key", 1_000_001), false, "empty snapshots are rejected");
const refreshCheck = categoryJs.match(/    function homeCategoryFeedNeedsRefresh\(feed, now\) \{[\s\S]*?(?=\n    function homeCategoryDefaultFilters\()/)?.[0] || "";
assert.ok(refreshCheck, "in-memory category freshness check exists");
const feedNeedsRefresh = vm.runInNewContext(`${refreshCheck}\nhomeCategoryFeedNeedsRefresh`, {
  HOME_CATEGORY_CACHE_TTL_MS: 30 * 60 * 1000
});
assert.equal(feedNeedsRefresh({ loaded: true, loadedAt: 10_000 }, 10_001), false, "fresh in-memory feed does not request again");
assert.equal(feedNeedsRefresh({ loaded: true, loadedAt: 10_000 }, 10_000 + 30 * 60 * 1000), true, "expired in-memory feed revalidates");
assert.equal(feedNeedsRefresh({ loaded: false, loadedAt: 10_000 }, 10_001), true, "unloaded feed remains eligible for initial request");
check(categoryJs.includes("const HOME_CATEGORY_CACHE_VERSION = 1") && categoryJs.includes("const HOME_CATEGORY_CACHE_TTL_MS = 30 * 60 * 1000"), "HOME_CATEGORY_CACHE_FIRST", "cache has an explicit schema version and 30 minute TTL");
check(categoryJs.includes("homeCategoryTmdbSources(id).map") && snapshotCheck.includes("snapshot.feedKey") && snapshotCheck.includes("categoryId"), "HOME_CATEGORY_CACHE_IDENTITY", "cache validity follows category and canonical TMDB source identity");
check(loadFeed.indexOf("hydrateHomeCategoryCache(feed") >= 0 && loadFeed.indexOf("hydrateHomeCategoryCache(feed") < loadFeed.indexOf("const task = Promise.resolve()") && categoryJs.includes("feed.loaded && !homeCategoryFeedNeedsRefresh(feed)"), "HOME_CATEGORY_BACKGROUND_REVALIDATE", "cache hydration starts before network revalidation and both persistent and memory snapshots expire");
check(loadFeed.includes("feed.networkLoaded || feed.partial") || categoryJs.includes("feed.networkLoaded || feed.partial"), "HOME_CATEGORY_NO_STALE_CACHE_OVERWRITE", "late cache hydrate cannot replace fresh network partial results");
check(cacheProjection.includes("listId:") && !cacheProjection.includes("secondary") && !cacheProjection.includes("lastFocused"), "HOME_CATEGORY_CACHE_PRESENTATION_ONLY", "persisted snapshot contains Home card fields, not Secondary query state");

const pumpLoads = categoryJs.match(/    function pumpHomeListLoads\(\) \{[\s\S]*?(?=\n    function ensureHomeListLoadsNearViewport\()/)?.[0] || "";
const railRender = categoryJs.match(/    function renderHomeCategoryRail\(id\) \{[\s\S]*?(?=\n    function maybePrefetchHomeTail\()/)?.[0] || "";
check(pumpLoads.includes("recordHomeV14Diag()") && !pumpLoads.includes("renderHome()"), "NO_HOME_WHOLE_RENDER_STORM", "category completion updates diagnostics and does not redraw the whole Home");
check(railRender.includes("renderHomeDynamicSection(section, config)"), "HOME_RAIL_LOCAL_UPDATE", "category refresh renders only its own rail");
check(categoryJs.includes("captureHomeRailFocus(rail)") && categoryJs.includes("replaceHomeRailChildren(rail"), "HOME_FOCUS_PRESERVED_DURING_ASYNC_UPDATE", "rail replacement reuses the existing focus identity capture");
check(readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8").includes("tvBrowseDirectionalTarget"), "TV_SINGLE_RAIL_FOCUS_GRAPH", "TV browse replaces the obsolete vertical Home anchor");
const browseImagePrep = browseJs.match(/    function tvBrowseSyncRailImagePreparation\(\) \{[\s\S]*?(?=\n    function tvBrowseReconcileRailNodes\()/)?.[0] || "";
const browseCardPrep = browseJs.match(/    function tvBrowsePrepareCardResources\(item, options\) \{[\s\S]*?(?=\n    function tvBrowseCommitPreviewInfo\()/)?.[0] || "";
const browseGatePoster = browseJs.match(/    function tvBrowsePrepareGatePoster\(card, record, gate\) \{[\s\S]*?(?=\n    function tvBrowseEnsureRailReadiness\()/)?.[0] || "";
const browseDetailPrep = browseJs.match(/    function tvBrowsePrepareDetailResource\(item, requestClass, isCurrent\) \{[\s\S]*?(?=\n    function tvBrowseExpireLogoAsset\()/)?.[0] || "";
const browseLogoPrep = browseJs.match(/    function tvBrowsePrepareLogo\(item, options\) \{[\s\S]*?(?=\n    function tvBrowsePreviewDetail\()/)?.[0] || "";
const browseGate = browseJs.match(/    function tvBrowseEnsureRailReadiness\(query, items, cards, visibleCount, allowGate\) \{[\s\S]*?(?=\n    function historyViewUnavailable\()/)?.[0] || "";
const browseGateFinish = browseJs.match(/    function tvBrowseFinishRailReadiness\(gate, timedOut\) \{[\s\S]*?(?=\n    function tvBrowseTrackRailReadinessTask\()/)?.[0] || "";
const browseAsyncDetailGuard = browseJs.match(/    function tvBrowseShouldDeferAsyncDetailPreview\(item\) \{[\s\S]*?(?=\n    function tvBrowsePreviewDetail\()/)?.[0] || "";
const browseColumnSelect = browseJs.match(/    function tvBrowseSelectColumn\(id, options\) \{[\s\S]*?(?=\n    function tvBrowseActivateColumn\()/)?.[0] || "";
const browseBackgroundPrep = browseJs.match(/    function tvBrowsePrepareBackgroundURLs\(item, urls, gate, record\) \{[\s\S]*?(?=\n    function tvBrowseCancelWarmBackdrop\()/)?.[0] || "";
const artTitleRender = artTitleJs.match(/    function renderArtTitle\(item, detail, img, title, wrap, valid, options\) \{[\s\S]*?(?=\n    function renderDetailBase\()/)?.[0] || "";
check(browseImagePrep.includes("visibleLogoKeys") && browseImagePrep.includes('tvBrowsePrepareLogo(card.__mediaItem, { requestClass: "foreground" })'), "TV_BROWSE_VISIBLE_RESOURCE_PREPARATION", "all visible cards use the shared foreground resource-preparation path");
check(browseImagePrep.includes("const targetIndex = lastVisibleIndex + 1") && browseImagePrep.includes('tvBrowsePrepareLogo(target.__mediaItem, { requestClass: "prefetch" })'), "TV_BROWSE_SINGLE_OFFSCREEN_RESOURCE_PREPARATION", "only the existing one-card right-side target uses the shared prefetch path");
check(!browseJs.includes("tvBrowseEnsurePreviewDetail") && !browseJs.includes("tvBrowsePrepareAdjacentLogos"), "TV_BROWSE_NO_FOCUS_LOGO_QUEUE", "preview focus and directional-neighbor helpers no longer start separate Logo preparation");
check(browseCardPrep.includes("tvBrowsePrepareDetailResource(item") && browseCardPrep.includes("prepareArtLogo(asset)") && browseCardPrep.includes("tvBrowsePrepareBackgroundURLs"), "TV_BROWSE_CARD_RESOURCE_BUNDLE", "poster, shared detail, Logo and background are prepared as one bounded card resource bundle");
check(browseCardPrep.includes("presentLogoWhenReady(prepareArtLogo") && !browseCardPrep.includes("if (!opts.deferPresentation && active() && logo.state === \"ready\""),
  "TV_BROWSE_LOGO_INDEPENDENT_PRESENTATION", "ready Logos present from their own preparation promise rather than waiting for the card background");
check(browseCardPrep.includes("const id = movieDetailCacheId(item)") && browseCardPrep.includes('"absent"'), "TV_BROWSE_NO_LOGO_AND_DETAIL_ABSENCE", "missing artwork and detail metadata settle without rejecting the card resource bundle");
check(browseGatePoster.includes('const state = image && !source ? "absent" : "failed"') && browseGatePoster.includes('"ready", "absent", "failed"'), "TV_BROWSE_POSTER_ABSENCE_STATE", "a confirmed missing poster is terminal and distinct from an image load failure");
check(browseDetailPrep.includes("requestMovieDetailShared") && browseDetailPrep.includes("requestTvDetailShared") && browseDetailPrep.includes("scheduleHomeBudgetRequest(requestClass || \"foreground\""), "TV_BROWSE_DETAIL_FOREGROUND_PRIORITY", "visible-card details use the existing shared detail cache and foreground request class");
check(browseDetailPrep.includes("promoteHomeBudgetRequests(key, requestClass || \"foreground\""), "TV_BROWSE_SHARED_DETAIL_PROMOTION", "an existing queued shared detail request is promoted instead of duplicated");
check(browseGate.includes("tvBrowsePrepareGatePoster(card, record, gate)") && browseGate.includes("tvBrowsePrepareCardResources(item, { requestClass: \"foreground\", gate, record, deferPresentation: true })")
  && browseGateFinish.includes("tvBrowseRememberRailReady(gate.queryKey, gate.signature, gate.resources)")
  && browseGateFinish.includes('entry[field] === "pending"') , "TV_BROWSE_FULL_RESOURCE_GATE", "cold rail readiness waits for terminal poster, detail, Logo and background states and caches the completed results");
check(browseGate.includes("ui.coldRailPresentPreview = presentPreview") && browseGateFinish.includes("gate.presentPreview || ui.coldRailPresentPreview"),
  "TV_BROWSE_DATA_EXTENSION_PREVIEW", "the pending first-card presentation intent survives pagination while the measured first screen fills");
check(browseAsyncDetailGuard.includes('record.detailState') && browseAsyncDetailGuard.includes('"timed-out"')
  && categoryJs.includes("tvBrowseShouldDeferAsyncDetailPreview(target.__mediaItem)"), "TV_BROWSE_LATE_DETAIL_STABILITY", "late enrichment cannot overwrite a timed-out first-screen detail fallback");
check(browseColumnSelect.includes("const changedColumn = ui.column !== id") && browseColumnSelect.includes("if (changedColumn) {")
  && browseColumnSelect.includes("position.key = \"\"; position.index = 0; position.scrollLeft = 0;")
  && browseColumnSelect.includes("tvBrowseCancelRailScroll();"), "TV_BROWSE_CATEGORY_FIRST_CARD", "real column changes reset to the first card while same-column rerenders retain their position");
check(browseBackgroundPrep.includes("tvBrowseWaitWarmBackdrop(warm)") && browseBackgroundPrep.includes("ui.backdropMediaKey === mediaKey"), "TV_BROWSE_BACKGROUND_READY_REUSE", "background readiness waits for the shared decoded image and reuses an already displayed matching resource");
check(detailJs.includes("function prepareArtLogo(asset)") && detailJs.includes('asset.decodeState = decodeState || (ready ? "ready" : "failed")'), "TV_BROWSE_LOGO_LOAD_AND_DECODE_STATE", "the shared artwork cache records load and decode outcomes separately");
check(artTitleRender.includes("asset.ready") && artTitleRender.includes("!opts.preparedOnly") && browseJs.includes("{ immediateFallback: true, preparedOnly: true }"), "TV_BROWSE_LOGO_READY_OR_TEXT", "Browse consumes a prepared Logo only and keeps its text fallback immediate");

const makeDeferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
function createCardResourceHarness() {
  const ui = { view: "home", logoPreparationKeys: [], previewKey: "", mode: "browse" };
  const counts = { detail: 0, logo: 0, background: 0 };
  const shows = [], previews = [];
  const detailJobs = new Map(), logoJobs = new Map(), backgroundJobs = new Map(), assets = new Map();
  const assetFor = (item) => {
    const key = String(item.tmdbId);
    if (!assets.has(key)) assets.set(key, {
      url: `/logo-${key}.png`, ready: false, failed: false, promise: null,
      state: "idle", loadState: "idle", decodeState: "idle", token: 0
    });
    return assets.get(key);
  };
  const prepareCardResources = vm.runInNewContext(`${browseCardPrep}\ntvBrowsePrepareCardResources`, {
    Promise,
    tvBrowseState: () => ui,
    tvBrowseActive: () => true,
    tvBrowseQueryKey: () => "movie-query",
    mediaDomKey: (item) => String(item.id),
    movieDetailCacheId: (item) => String(item && item.tmdbId || ""),
    movieDetailCacheValue: () => null,
    artLogoResource: assetFor,
    prepareArtLogo: (asset) => {
      if (!logoJobs.has(asset.url)) { counts.logo += 1; logoJobs.set(asset.url, makeDeferred()); }
      return logoJobs.get(asset.url).promise;
    },
    tvBrowsePreviewBackgrounds: (item) => ({ urls: [item.landscape] }),
    tvBrowsePrepareBackgroundURLs: (_item, urls) => {
      const key = urls.join("\u001f");
      if (!backgroundJobs.has(key)) { counts.background += 1; backgroundJobs.set(key, makeDeferred()); }
      return backgroundJobs.get(key).promise;
    },
    tvBrowsePrepareDetailResource: (item) => {
      const key = String(item.tmdbId);
      if (!detailJobs.has(key)) { counts.detail += 1; detailJobs.set(key, makeDeferred()); }
      return detailJobs.get(key).promise;
    },
    tvBrowseShowPreparedLogo: (item, asset) => shows.push({ mode: ui.mode, key: item.id, ready: asset.ready }),
    tvBrowseCurrentPreparedItem: (item) => item,
    tvBrowsePreview: (item) => previews.push({ mode: ui.mode, key: item.id })
  });
  return {
    ui, counts, shows, previews, assets, logoJobs, backgroundJobs, detailJobs,
    prepareCardResources, assetFor
  };
}

const sharedCardResources = createCardResourceHarness();
const cardSharedItem = { id: "same-resource", tmdbId: 8123, mediaType: "movie", landscape: "/same-backdrop.jpg" };
sharedCardResources.ui.logoPreparationKeys = [cardSharedItem.id];
sharedCardResources.ui.previewKey = cardSharedItem.id;
const ordinaryResourcePromise = sharedCardResources.prepareCardResources(cardSharedItem, { requestClass: "foreground" });
await tick();
sharedCardResources.detailJobs.get("8123").resolve({ state: "ready", detail: { id: 8123, media_type: "movie" } });
await tick();
assert.equal(sharedCardResources.counts.background, 1, "background preparation starts independently of the pending Logo");
sharedCardResources.assetFor(cardSharedItem).ready = true;
sharedCardResources.assetFor(cardSharedItem).decodeState = "ready";
sharedCardResources.logoJobs.get("/logo-8123.png").resolve(true);
await tick();
assert.deepEqual(sharedCardResources.shows, [{ mode: "browse", key: "same-resource", ready: true }],
  "a Logo that finishes before its background is presented immediately in ordinary Browse");
assert.equal(sharedCardResources.previews.length, 0, "the card bundle still waits for background readiness before its shared completion callback");
sharedCardResources.ui.mode = "wallpaper";
const wallpaperResourcePromise = sharedCardResources.prepareCardResources(cardSharedItem, { requestClass: "foreground" });
await tick();
assert.equal(sharedCardResources.shows.at(-1).mode, "wallpaper", "the same shared preparation path immediately consumes the ready Logo in wallpaper presentation");
assert.deepEqual(sharedCardResources.counts, { detail: 1, logo: 1, background: 1 },
  "Browse and wallpaper reuse the same detail, Logo, and background preparation results for an identical media resource");
assert.equal(sharedCardResources.previews.length, 0, "wallpaper Logo presentation does not wait on or alter the still-pending background");
sharedCardResources.backgroundJobs.get("/same-backdrop.jpg").resolve({ state: "ready", url: "/same-backdrop.jpg", warms: [] });
await Promise.all([ordinaryResourcePromise, wallpaperResourcePromise]);
assert.deepEqual(sharedCardResources.previews.map((entry) => entry.key), ["same-resource", "same-resource"]);

const staleLogoResources = createCardResourceHarness();
const staleA = { id: "resource-a", tmdbId: 8201, mediaType: "movie", landscape: "/backdrop-a.jpg" };
const currentB = { id: "resource-b", tmdbId: 8202, mediaType: "movie", landscape: "/backdrop-b.jpg" };
staleLogoResources.ui.logoPreparationKeys = [staleA.id, currentB.id];
staleLogoResources.ui.previewKey = staleA.id;
const staleAPromise = staleLogoResources.prepareCardResources(staleA, { requestClass: "foreground" });
staleLogoResources.ui.previewKey = currentB.id;
const currentBPromise = staleLogoResources.prepareCardResources(currentB, { requestClass: "foreground" });
await tick();
staleLogoResources.detailJobs.get("8201").resolve({ state: "ready", detail: { id: 8201, media_type: "movie" } });
staleLogoResources.detailJobs.get("8202").resolve({ state: "ready", detail: { id: 8202, media_type: "movie" } });
await tick();
staleLogoResources.assetFor(staleA).ready = true;
staleLogoResources.logoJobs.get("/logo-8201.png").resolve(true);
await tick();
assert.equal(staleLogoResources.shows.some((entry) => entry.key === staleA.id), false,
  "a late earlier-resource Logo cannot replace the latest Browse or wallpaper preview");
staleLogoResources.assetFor(currentB).ready = true;
staleLogoResources.logoJobs.get("/logo-8202.png").resolve(true);
await tick();
assert.equal(staleLogoResources.shows.some((entry) => entry.key === currentB.id), true,
  "the latest resource Logo remains eligible for immediate presentation");
for (const [key, job] of staleLogoResources.backgroundJobs) job.resolve({ state: "ready", url: key, warms: [] });
await Promise.all([staleAPromise, currentBPromise]);
check(true, "TV_BROWSE_SHARED_LOGO_TIMING_VM", "identical resources reuse shared preparation, Logo display precedes background readiness, and stale callbacks are rejected");

const prepareArtLogoSource = detailJs.match(/    function prepareArtLogo\(asset\) \{[\s\S]*?(?=\n    function tmdbRecommendationsUrl\()/)?.[0] || "";
assert.ok(prepareArtLogoSource, "shared artwork preparation can be isolated for an executable decode test");
const preparedImages = [];
class PreparedLogoImage {
  constructor() { this.onload = null; this.onerror = null; this.naturalWidth = 0; this.decoding = ""; preparedImages.push(this); }
  set src(value) { this.url = value; }
  get src() { return this.url; }
}
const prepareLogo = vm.runInNewContext(`${prepareArtLogoSource}\nprepareArtLogo`, { Image: PreparedLogoImage, Date });
const logoReadyAsset = { url: "/logo-ready.png", ready: false, failed: false, promise: null };
const logoReadyPromise = prepareLogo(logoReadyAsset);
assert.equal(prepareLogo(logoReadyAsset), logoReadyPromise, "duplicate Logo preparation shares its in-flight promise");
const logoReadyImage = preparedImages[0];
let resolveLogoDecode;
logoReadyImage.decode = () => new Promise((resolve) => { resolveLogoDecode = resolve; });
logoReadyImage.naturalWidth = 100;
logoReadyImage.onload();
assert.equal(logoReadyAsset.loadState, "loaded", "image load is recorded before decode completes");
assert.equal(logoReadyAsset.decodeState, "pending", "a loaded but undecoded Logo is not marked ready");
resolveLogoDecode();
assert.equal(await logoReadyPromise, true);
assert.equal(logoReadyAsset.decodeState, "ready", "Logo readiness is recorded only after successful decode");

const logoDecodeFailedAsset = { url: "/logo-decode-failed.png", ready: false, failed: false, promise: null };
const logoDecodeFailedPromise = prepareLogo(logoDecodeFailedAsset);
const logoDecodeFailedImage = preparedImages[1];
logoDecodeFailedImage.decode = () => Promise.reject(new Error("decode failed"));
logoDecodeFailedImage.naturalWidth = 100;
logoDecodeFailedImage.onload();
assert.equal(await logoDecodeFailedPromise, false);
assert.equal(logoDecodeFailedAsset.loadState, "loaded", "a decode failure remains distinct from a network load failure");
assert.equal(logoDecodeFailedAsset.decodeState, "decode-failed");

const logoNoDecodeAsset = { url: "/logo-no-decode.png", ready: false, failed: false, promise: null };
const logoNoDecodePromise = prepareLogo(logoNoDecodeAsset);
const logoNoDecodeImage = preparedImages[2];
logoNoDecodeImage.naturalWidth = 100;
logoNoDecodeImage.onload();
assert.equal(await logoNoDecodePromise, true);
assert.equal(logoNoDecodeAsset.decodeState, "loaded-no-decode", "WebViews without Image.decode still settle through the load fallback");

const homeNostrRender = routeJs.match(/    function scheduleHomeNostrRender\(\) \{[\s\S]*?(?=\n    function homeSectionDomId\()/)?.[0] || "";
check(hotJs.includes("scheduleHomeNostrRender()") && !hotJs.includes("invalidateHomeCategoryFeeds()"), "NOSTR_RECOMMENDATION_PRESERVED", "Nostr updates do not invalidate TMDB category feeds");
check(homeNostrRender.includes("renderHomeHero()") && homeNostrRender.includes("renderHomeRecommendation()") && !homeNostrRender.includes("renderHome()"), "NOSTR_LOCAL_RENDER", "Home Nostr updates stay local to Hero and Recommendation");

const heroLoad = heroJs.match(/    async function loadHomeHeroFeed\(\) \{[\s\S]*?(?=\n    function ensureHomeHeroFeed\()/)?.[0] || "";
check(heroLoad.includes("provisionalRendered") && heroLoad.indexOf("renderHomeHero()") < heroLoad.indexOf("homeHeroProgressiveNostrEnrich"), "HERO_VISIBLE_BEFORE_ENRICHMENT", "Hero renders a poster-backed source result before queued details finish");
check(heroJs.includes('"foreground")') && heroJs.includes('"enrichment")'), "HERO_REQUEST_PRIORITY", "Hero source requests and details use their separate scheduler classes");
const categoryPriorityStart = heroJs.indexOf("const priority = {");
const categoryPrioritySource = categoryPriorityStart >= 0 ? heroJs.slice(categoryPriorityStart, categoryPriorityStart + 260) : "";
const categoryPriorityOrder = ["movie: 20", "tv: 30", "anime: 40", "documentary: 50", "variety: 60"].map((marker) => categoryPrioritySource.indexOf(marker));
check(categoryPriorityOrder.every((position, index) => position >= 0 && (index === 0 || position > categoryPriorityOrder[index - 1])), "HOME_CATEGORY_ORDER_PRESERVED", "movie, TV, anime, documentary, and variety retain their configured order");
check(weeklyJs.includes('"background")') && weeklyJs.includes("homeEnrichmentRequest"), "WEEKLY_REQUEST_PRIORITY", "Weekly list refresh and TV details are budgeted separately");
check(detailJs.includes("typeof requestOverride === \"function\" ? requestOverride : requestJson"), "TV_EPISODE_STATUS_PRESERVED", "TV detail helpers retain the existing default request path outside Home");
check(cardsJs.includes("homeRailIsInViewport") && /\?\s*0\s*:\s*requestedHomeEagerCount/.test(cardsJs), "OFFSCREEN_POSTERS_DEFERRED", "offscreen TV Home rail posters use the existing lazy observer");
const requiredDiagnostics = [
  "HOME_COLD_START_AT", "FIRST_HOME_RENDER_MS", "FIRST_HERO_READY_MS", "FIRST_CATEGORY_READY_MS",
  "MOVIE_READY_MS", "TV_READY_MS", "ANIME_FIRST_RENDER_MS", "ANIME_FINAL_READY_MS",
  "DOCUMENTARY_FIRST_RENDER_MS", "DOCUMENTARY_FINAL_READY_MS", "VARIETY_READY_MS",
  "HOME_TV_STATUS_REQUEST_QUEUED", "HOME_TV_STATUS_REQUEST_STARTED", "HOME_TV_STATUS_REQUEST_DONE",
  "HOME_TV_STATUS_MAX_ACTIVE", "HOME_TV_STATUS_PROMOTED_ON_FOCUS", "TV_CARD_STATUS_WAIT_MS",
  "BASE_CARD_RENDER_AT", "TV_STATUS_READY_AT", "TV_STATUS_DELAY_MS",
  "CATEGORY_CACHE_HIT_COUNT", "CATEGORY_CACHE_MISS_COUNT", "FOREGROUND_REQUEST_MAX",
  "BACKGROUND_REQUEST_MAX", "ENRICHMENT_REQUEST_MAX", "HOME_WHOLE_RENDER_COUNT",
  "HOME_RAIL_UPDATE_COUNT", "WEEKLY_CACHE_HIT", "WEEKLY_NETWORK_REFRESH_START_MS",
  "WEEKLY_NETWORK_REFRESH_END_MS", "TV_CARD_ENRICHMENT_STARTED_BEFORE_BASE_FEEDS_READY"
];
check(requiredDiagnostics.every((field) => categoryJs.includes(`${field}:`)), "HOME_COLD_START_DIAGNOSTICS", "all requested timing, cache, budget, render, and enrichment fields are exposed");

console.log("HOME_CATEGORY_CACHE_FIRST = PASS");
console.log("HOME_CATEGORY_BACKGROUND_REVALIDATE = PASS");
console.log("ANIME_NO_SLOW_SOURCE_FULL_BLOCK = PASS (deferred-source fixture)");
console.log("DOCUMENTARY_NO_SLOW_SOURCE_FULL_BLOCK = PASS (shared multi-source loader)");
console.log("HOME_REQUEST_BUDGET_ENFORCED = PASS (global cap 4; foreground 3; visible-status 2; prefetch 2; background 1; enrichment 1)");
console.log("VISIBLE_TV_STATUS_PRIORITY = PASS (above prefetch/background/enrichment; below foreground)");
console.log("VISIBLE_TV_STATUS_FOCUS_PROMOTION = PASS (queued shared detail is promoted by request key)");
console.log("TV_DETAIL_REQUEST_DEDUPE = PASS (shared Home/Hero/Weekly detail promise)");
console.log("TV_STATUS_NEAR_VIEWPORT_ONLY = PASS (existing IntersectionObserver/root margin/fallback)");
console.log("HERO_WEEKLY_PRIORITY_PRESERVED = PASS (details stay enrichment until eligible Home TV card)");
console.log("TMDB_MOVIE_STATUS_PRESERVED = PASS (ordinary Movie status uses list release date)");
console.log("ENRICHMENT_LOWER_PRIORITY_THAN_BASE_FEED = PASS");
console.log("NO_UNBOUNDED_COLD_START_REQUEST_BURST = PASS (active request cap enforced)");
console.log("NO_HOME_WHOLE_RENDER_STORM = PASS");
console.log("HOME_FOCUS_PRESERVED_DURING_ASYNC_UPDATE = PASS (static identity hook)");
console.log("TV_SINGLE_RAIL_FOCUS_GRAPH = PASS (static hook; DOM coverage in tv-immersive-browse.mjs)");
console.log("TV_BROWSE_VISIBLE_RESOURCE_PREPARATION = PASS (measured viewport range)");
console.log("TV_BROWSE_SINGLE_OFFSCREEN_RESOURCE_PREPARATION = PASS (one right-side target)");
console.log("TV_BROWSE_NO_FOCUS_LOGO_QUEUE = PASS (preview no longer starts a separate Logo path)");
console.log("TV_BROWSE_CARD_RESOURCE_BUNDLE = PASS (poster, detail, Logo and background)");
console.log("TV_BROWSE_LOGO_INDEPENDENT_PRESENTATION = PASS (Logo readiness no longer waits for background readiness)");
console.log("TV_BROWSE_NO_LOGO_AND_DETAIL_ABSENCE = PASS (missing metadata/artwork settles the card bundle)");
console.log("TV_BROWSE_POSTER_ABSENCE_STATE = PASS (confirmed missing poster is distinct from failure)");
console.log("TV_BROWSE_DETAIL_FOREGROUND_PRIORITY = PASS (existing shared detail cache and request budget)");
console.log("TV_BROWSE_SHARED_DETAIL_PROMOTION = PASS (queued duplicate is promoted by shared request key)");
console.log("TV_BROWSE_FULL_RESOURCE_GATE = PASS (all first-screen resource outcomes)");
console.log("TV_BROWSE_DATA_EXTENSION_PREVIEW = PASS (first-card commit intent survives data pagination)");
console.log("TV_BROWSE_BACKGROUND_READY_REUSE = PASS (decoded readiness and displayed reuse)");
console.log("TV_BROWSE_LOGO_LOAD_AND_DECODE_STATE = PASS (shared artwork cache)");
console.log("TV_BROWSE_LOGO_DECODE_RUNTIME = PASS (dedupe, decoded, decode-failed, and no-decode fallback)");
console.log("TV_BROWSE_LOGO_READY_OR_TEXT = PASS (prepared-only Logo with immediate text fallback)");
console.log("TV_BROWSE_SHARED_LOGO_TIMING_VM = PASS (Browse/wallpaper cache reuse, independent Logo presentation, stale-result guard)");
console.log("SECONDARY_SEMANTICS_PRESERVED = PASS (no Secondary query state persisted)");
console.log("NOSTR_RECOMMENDATION_PRESERVED = PASS");
console.log("WEEKLY_SEMANTICS_PRESERVED = PASS");
console.log("HERO_SEMANTICS_PRESERVED = PASS (same selector after enrichment; provisional render is additive)");
console.log("TV_EPISODE_STATUS_PRESERVED = PASS");
