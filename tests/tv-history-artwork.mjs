import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
const cardSource = readFileSync(new URL("../src/js/14-grid-card-focus.js", import.meta.url), "utf8");
const names = [
  "tvBrowseHistoryTmdbIdentity", "tvBrowseHistoryPosterIsUsable", "tvBrowseHistoryPosterSource",
  "tvBrowseApplyHistoryPoster", "tvBrowsePrepareHistoryCardPoster"
];

function extract(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `production function ${name} exists`);
  const end = source.indexOf("\n    function ", start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}

function makeHarness(item) {
  const state = { recent: { items: [item] } };
  const ui = { view: "history" };
  let queryKey = "native-history";
  let detailLoader = async () => ({ state: "ready", detail: null });
  const requests = [];
  let decodes = 0;
  const imageAttrs = { src: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" };
  const image = {
    dataset: {}, loading: "lazy", decoding: "async",
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(imageAttrs, name) ? imageAttrs[name] : null; },
    setAttribute(name, value) { imageAttrs[name] = String(value); },
    removeAttribute(name) { delete imageAttrs[name]; }
  };
  Object.defineProperty(image, "src", {
    get() { return imageAttrs.src || ""; },
    set(value) { imageAttrs.src = String(value); }
  });
  const classes = new Set();
  const card = {
    dataset: { mediaKey: item.id }, __mediaItem: item, __tvBrowseRenderSignature: "old", isConnected: true,
    querySelector(selector) { return selector === "img.poster" ? image : null; },
    classList: {
      add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
      contains(name) { return classes.has(name); }
    }
  };
  image.closest = selector => selector === ".card" ? card : null;

  const stub = `
    const state = __state;
    function tvBrowseState() { return __ui; }
    function tvBrowseActive() { return true; }
    function tvBrowseQueryKey() { return __queryKey; }
    function mediaDomKey(item) { return item && item.id || ""; }
    function movieDetailCacheId(item) { return String(item && (item.tmdbId || item.id) || ""); }
    function historyPlaybackContext(raw) { return raw && raw.context || null; }
    function tvBrowsePrepareDetailResource(item, requestClass, isCurrent) {
      __requests.push({ item, requestClass, current: isCurrent() });
      return __detailLoader(item, requestClass, isCurrent);
    }
    function displayImage(path, options) {
      if (!path) return "";
      const value = String(path);
      return value.charAt(0) === "/" ? "https://image.tmdb.org/t/p/" + options.size + value : value;
    }
    function tvBrowseCardSignature(item) { return JSON.stringify(item); }
    function activateHomeDeferredImage(image) {
      const src = image.getAttribute("data-src");
      if (!src) return false;
      image.removeAttribute("data-src"); image.src = src; return true;
    }
    function tvBrowseMarkPosterState(card, image, status, source) {
      image.dataset.tvBrowsePosterState = status;
      image.dataset.tvBrowsePosterReadySource = source;
      card.classList.toggle("poster-unavailable", status === "failed" || status === "absent" || status === "timed-out");
    }
    function tvBrowseDecodePoster() { __decodes += 1; }
  `;
  const api = `globalThis.api = {
    ${names.join(", ")},
    state: __state, ui: __ui, card: __card, image: __image,
    setQueryKey: value => { __queryKey = value; },
    setDetailLoader: value => { __detailLoader = value; },
    requests: () => __requests.slice(), decodes: () => __decodes,
    classHas: name => __classes.has(name)
  };`;
  const sandbox = { __state: state, __ui: ui, __queryKey: queryKey, __card: card, __image: image,
    __requests: requests, __detailLoader: detailLoader, __decodes: decodes, __classes: classes,
    String, Number, Array, Object, Promise, Set, JSON };
  vm.runInNewContext(`${stub}\n${names.map(extract).join("\n")}\n${api}`, sandbox,
    { filename: "tv-history-artwork.vm.js" });
  return { api: sandbox.api, card, image, state, ui, requests };
}

function historyItem(overrides = {}) {
  const poster = "https://vod.example.test/images/default-poster.png";
  return Object.assign({
    id: "history:push-1", source: "history", historyKey: "push-1", historyStableKey: "push-1",
    title: "The Apothecary Diaries", mediaType: "movie", tmdbId: "9301", pic: poster, image: poster,
    landscape: "https://vod.example.test/images/wide-wall.jpg",
    nativeHistoryRaw: { vodPic: poster, wallPic: "https://vod.example.test/images/wide-wall.jpg",
      context: { title: "药屋少女的呢喃", tmdbId: "9301", mediaType: "movie" } }
  }, overrides);
}

// The TV History rail sends only visible rows through the existing shared
// detail request helper. It does not add a separate queue or request cache.
const syncStart = source.indexOf("    function tvBrowseSyncRailImagePreparation(");
const syncEnd = source.indexOf("\n    function ", syncStart + 1);
const sync = source.slice(syncStart, syncEnd);
assert.match(sync, /if \(ui\.view === "history"\)\s*\{\s*visible\.forEach\(\(card\) => tvBrowsePrepareHistoryCardPoster\(card\)\)/,
  "only cards in the measured visible History range get poster detail preparation");
assert.match(sync, /if \(ui\.view === "history" && !tvBrowseHistoryPosterSource\(card\.__mediaItem\)\) return;/,
  "an empty image placeholder is not decoded and mistaken for a real History poster");
assert.match(cardSource, /opts\.history === true && item\.source === "history" \? tvBrowseHistoryPosterSource\(item\) : item\.pic/,
  "TV History cards reject a common icon before the initial img source is chosen");

// Push History without a useful native cover obtains poster_path from the
// trusted shared detail request and patches only the in-memory HTML row.
{
  const item = historyItem();
  const harness = makeHarness(item);
  let requestCount = 0;
  harness.api.setDetailLoader(async (requested, requestClass, isCurrent) => {
    requestCount += 1;
    assert.equal(requested, item);
    assert.equal(requestClass, "foreground");
    assert.equal(isCurrent(), true);
    return { state: "ready", detail: {
      id: 9301, media_type: "movie", poster_path: "/poster-9301.jpg", backdrop_path: "/backdrop-9301.jpg"
    } };
  });
  assert.equal(harness.api.tvBrowseHistoryPosterSource(item), "", "a generic native icon is not treated as a poster");
  const changed = await harness.api.tvBrowsePrepareHistoryCardPoster(harness.card);
  assert.equal(changed, true);
  assert.equal(requestCount, 1);
  assert.equal(harness.image.src, "https://image.tmdb.org/t/p/w342/poster-9301.jpg");
  assert.equal(item.pic, harness.image.src, "the HTML model receives the poster for future rail renders");
  assert.equal(item.nativeHistoryRaw.vodPic, "https://vod.example.test/images/default-poster.png",
    "the original History object is not written back or modified");
  assert.equal(item.nativeHistoryRaw.wallPic, "https://vod.example.test/images/wide-wall.jpg",
    "the horizontal background field remains independent");
  assert.equal(harness.api.decodes(), 1, "the corrected poster reuses TV Browse poster decode handling");
  assert.equal(harness.api.classHas("poster-unavailable"), false);
  console.log("TV_HISTORY_PUSH_POSTER_FROM_SHARED_DETAIL = PASS");
}

// An absent native vodPic follows the same shared detail path as a generic icon.
{
  const item = historyItem({ pic: "", image: "", nativeHistoryRaw: {
    wallPic: "https://vod.example.test/images/wide-wall.jpg",
    context: { tmdbId: "9301", mediaType: "movie" }
  } });
  const harness = makeHarness(item);
  harness.api.setDetailLoader(async () => ({ state: "ready", detail: {
    id: 9301, media_type: "movie", poster_path: "/poster-9301.jpg"
  } }));
  assert.equal(await harness.api.tvBrowsePrepareHistoryCardPoster(harness.card), true);
  assert.equal(harness.image.src, "https://image.tmdb.org/t/p/w342/poster-9301.jpg");
  console.log("TV_HISTORY_PUSH_MISSING_VODPIC_COMPLETED = PASS");
}

// A valid native vertical poster always wins and avoids TMDB work.
{
  const item = historyItem({
    pic: "https://vod.example.test/posters/original-portrait.jpg",
    image: "https://vod.example.test/posters/original-portrait.jpg",
    nativeHistoryRaw: { vodPic: "https://vod.example.test/posters/original-portrait.jpg",
      context: { tmdbId: "9301", mediaType: "movie" } }
  });
  const harness = makeHarness(item);
  harness.api.setDetailLoader(() => { assert.fail("a valid raw vertical poster must not be replaced"); });
  assert.equal(harness.api.tvBrowseHistoryPosterSource(item), "https://vod.example.test/posters/original-portrait.jpg");
  assert.equal(await harness.api.tvBrowsePrepareHistoryCardPoster(harness.card), false);
  assert.equal(harness.api.requests().length, 0);
  console.log("TV_HISTORY_RAW_POSTER_PRESERVED = PASS");
}

// Names may differ across languages, but no title search is introduced: only
// the exact trusted id and media type authorize a detail response.
{
  const item = historyItem({ title: "The English Title" });
  const harness = makeHarness(item);
  let requestCount = 0;
  harness.api.setDetailLoader(async () => {
    requestCount += 1;
    return { state: "ready", detail: { id: 9301, media_type: "tv", poster_path: "/wrong-type.jpg" } };
  });
  assert.equal(await harness.api.tvBrowsePrepareHistoryCardPoster(harness.card), false);
  assert.equal(requestCount, 1, "the explicit trusted identity is queried without title matching");
  assert.equal(harness.image.src.startsWith("data:image/gif"), true, "a conflicting media type cannot populate this row");
  console.log("TV_HISTORY_LANGUAGE_AND_TYPE_IDENTITY_GUARD = PASS");
}

// Identity missing or conflicting means no request and no accidental title-based association.
for (const [label, context] of [
  ["missing", { title: "药屋少女的呢喃" }],
  ["conflicting", { title: "The Apothecary Diaries", tmdbId: "9302", mediaType: "movie" }]
]) {
  const item = historyItem({ nativeHistoryRaw: { wallPic: "https://vod.example.test/images/wide-wall.jpg", context } });
  const harness = makeHarness(item);
  harness.api.setDetailLoader(() => { assert.fail("untrusted History identity must not request TMDB details"); });
  assert.equal(await harness.api.tvBrowsePrepareHistoryCardPoster(harness.card), false);
  assert.equal(harness.api.requests().length, 0, `${label} identity does not start a request`);
  assert.equal(harness.api.classHas("poster-unavailable"), true, `${label} identity retains the existing placeholder state`);
}
console.log("TV_HISTORY_UNTRUSTED_IDENTITY_NO_POSTER_LOOKUP = PASS");

// An async detail that arrives after query change or deletion cannot paint a
// stale History card.
for (const mode of ["query-change", "deleted", "refresh-identity"]) {
  const item = historyItem({ nativeHistoryRaw: { wallPic: "https://vod.example.test/images/wide-wall.jpg",
    context: { tmdbId: "9301", mediaType: "movie" } } });
  const harness = makeHarness(item);
  let resolveDetail;
  harness.api.setDetailLoader(() => new Promise(resolve => { resolveDetail = resolve; }));
  const pending = harness.api.tvBrowsePrepareHistoryCardPoster(harness.card);
  if (mode === "query-change") harness.api.setQueryKey("another-history-query");
  else harness.state.recent.items = [];
  if (mode === "refresh-identity") {
    const refreshed = historyItem({ nativeHistoryRaw: { wallPic: "https://vod.example.test/images/wide-wall.jpg",
      context: { tmdbId: "9302", mediaType: "movie" } } });
    harness.state.recent.items = [refreshed];
  }
  resolveDetail({ state: "ready", detail: { id: 9301, media_type: "movie", poster_path: "/late.jpg" } });
  assert.equal(await pending, false, `${mode} invalidates the old card completion`);
  assert.equal(harness.image.src.startsWith("data:image/gif"), true);
}
console.log("TV_HISTORY_STALE_POSTER_RESULT_REJECTED = PASS");

// Missing/failed detail leaves the existing placeholder; it does not substitute
// the landscape background or a different History item's artwork.
{
  const item = historyItem({ nativeHistoryRaw: { wallPic: "https://vod.example.test/images/wide-wall.jpg",
    context: { tmdbId: "9301", mediaType: "movie" } } });
  const harness = makeHarness(item);
  harness.api.setDetailLoader(async () => ({ state: "failed", detail: null }));
  assert.equal(await harness.api.tvBrowsePrepareHistoryCardPoster(harness.card), false);
  assert.equal(harness.image.src.startsWith("data:image/gif"), true);
  assert.equal(harness.api.classHas("poster-unavailable"), true, "a failed detail lookup settles to the existing placeholder");
  assert.notEqual(harness.image.src, item.nativeHistoryRaw.wallPic, "a landscape never fills the vertical card slot");
  console.log("TV_HISTORY_POSTER_FAILURE_KEEPS_PLACEHOLDER = PASS");
}
