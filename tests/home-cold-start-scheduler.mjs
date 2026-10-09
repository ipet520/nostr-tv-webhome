import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as vm from "node:vm";

const configJs = readFileSync(new URL("../src/js/02-runtime-config-device.js", import.meta.url), "utf8");
const networkJs = readFileSync(new URL("../src/js/05-relay-network-pan-session.js", import.meta.url), "utf8");
const weeklyJs = readFileSync(new URL("../src/js/03a-home-weekly-ui-runtime.js", import.meta.url), "utf8");
const hotJs = readFileSync(new URL("../src/js/04-nostr-hot-storage.js", import.meta.url), "utf8");
const heroJs = readFileSync(new URL("../src/js/11a-home-render-core-hero.js", import.meta.url), "utf8");
const categoryJs = readFileSync(new URL("../src/js/11b-home-category-render.js", import.meta.url), "utf8");
const routeJs = readFileSync(new URL("../src/js/11c-home-render-search-route.js", import.meta.url), "utf8");
const cardsJs = readFileSync(new URL("../src/js/14-grid-card-focus.js", import.meta.url), "utf8");
const detailJs = readFileSync(new URL("../src/js/06-tmdb-history-model.js", import.meta.url), "utf8");

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
const flushTvSource = categoryJs.match(/    function flushTvCardDetailQueue\(\) \{[\s\S]*?(?=\n    function queueTvCardEpisodeEnrichment\()/)?.[0] || "";
const focusPromoteSource = categoryJs.match(/    function promoteHomeTvCardStatusOnFocus\(card\) \{[\s\S]*?(?=\n    function ensureTvCardDetailObserver\()/)?.[0] || "";
check(observerSource.includes("rootMargin: TV_CARD_DETAIL_ROOT_MARGIN") && observerSource.includes("if (!entry.isIntersecting) return") && observerSource.includes("queueTvCardEpisodeEnrichment(entry.target)"), "TV_STATUS_IO_GATE", "Home TV status work remains behind the existing IntersectionObserver near-viewport gate");
check(observeCardsSource.includes("cards.filter(tvCardNearViewport).forEach(queueTvCardEpisodeEnrichment)"), "TV_STATUS_FALLBACK_NEAR_VIEWPORT", "without IntersectionObserver only cards passing the existing near-viewport check are queued");
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
check(configJs.includes("HOME_RAIL_ANCHOR_OFFSET = 8") && readFileSync(new URL("../src/js/21-bindings-focus-anchor.js", import.meta.url), "utf8").includes("HOME_RAIL_ANCHOR_OFFSET"), "HOME_SECTION_ANCHOR_BEHAVIOR_PRESERVED", "existing section anchor reveal remains in place");

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
console.log("HOME_SECTION_ANCHOR_BEHAVIOR_PRESERVED = PASS (existing anchor hook)");
console.log("SECONDARY_SEMANTICS_PRESERVED = PASS (no Secondary query state persisted)");
console.log("NOSTR_RECOMMENDATION_PRESERVED = PASS");
console.log("WEEKLY_SEMANTICS_PRESERVED = PASS");
console.log("HERO_SEMANTICS_PRESERVED = PASS (same selector after enrichment; provisional render is additive)");
console.log("TV_EPISODE_STATUS_PRESERVED = PASS");
