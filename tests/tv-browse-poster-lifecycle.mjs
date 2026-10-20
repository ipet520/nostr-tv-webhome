import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const source = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
assert.match(source, /const TV_BROWSE_RAIL_READY_TIMEOUT_MS = 15000;/, "the first-screen Gate retains a 15-second upper bound");

function extract(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `source function ${name} is available`);
  return source.slice(start, end);
}

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  contains(name) { return this.values.has(name); }
  toggle(name, enabled) {
    if (enabled) this.values.add(name);
    else this.values.delete(name);
  }
}

class FakeImage {
  constructor(card) {
    this.card = card;
    this.dataset = {};
    this.complete = false;
    this.naturalWidth = 0;
    this.loading = "lazy";
    this.decoding = "async";
    this.listeners = new Map();
    this.requestCount = 1;
    this._src = "/poster.jpg";
    this.attributes = new Set(["src"]);
    this.decodeResults = [];
  }
  get src() { return this._src; }
  set src(value) {
    this._src = String(value);
    this.attributes.add("src");
    this.requestCount += 1;
    this.complete = false;
    this.naturalWidth = 0;
  }
  get currentSrc() { return this._src; }
  getAttribute(name) { return name === "src" ? this.attributes.has("src") ? this._src : null : null; }
  hasAttribute(name) { return this.attributes.has(name); }
  setAttribute(name, value) {
    if (name === "src") this.src = value;
    else this.attributes.add(name);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
    if (name === "src") {
      this._src = "";
      this.complete = false;
      this.naturalWidth = 0;
    }
  }
  addEventListener(name, callback) {
    const callbacks = this.listeners.get(name) || [];
    callbacks.push(callback);
    this.listeners.set(name, callbacks);
  }
  removeEventListener(name, callback) {
    this.listeners.set(name, (this.listeners.get(name) || []).filter((item) => item !== callback));
  }
  emit(name) { (this.listeners.get(name) || []).slice().forEach((callback) => callback({ type: name, target: this })); }
  closest() { return this.card; }
  decode() {
    const result = this.decodeResults.shift();
    return result ? result.promise : Promise.resolve();
  }
}

function createHarness() {
  let now = 1000;
  const ui = {
    view: "home", column: "movie", railReadiness: null, railReadinessToken: 1,
    railReadyByQuery: {}, railReadyOrder: [], coldRailPresentPreview: false
  };
  const card = {
    dataset: { mediaKey: "movie-1" },
    __mediaItem: { id: "movie-1", mediaType: "movie" },
    isConnected: true,
    classList: new FakeClassList(),
    getBoundingClientRect() { return { left: 0, right: 200, width: 200 }; },
    querySelector() { return this.image; }
  };
  const image = new FakeImage(card);
  card.image = image;
  const rail = {
    dataset: { queryKey: "query-movie" }, children: [card], clientLeft: 0, clientWidth: 1000,
    scrollLeft: 0, scrollWidth: 1000,
    getBoundingClientRect() { return { left: 0, right: 1000, width: 1000 }; }
  };
  class TestDate extends Date { static now() { return now; } }
  const context = {
    Date: TestDate,
    Promise,
    tvBrowseState: () => ui,
    tvBrowseQueryKey: () => "query-movie",
    tvBrowseActive: () => true,
    tvWallpaperIsActive: () => false,
    tvBrowseEnsureRailMotionMode() {},
    tvBrowsePosterSource: (candidate) => candidate.getAttribute("data-src") || candidate.getAttribute("src") || candidate.src || "",
    tvBrowseRailCards: (candidateRail) => candidateRail && candidateRail.children || [],
    tvBrowseRailCurrentPosition: () => 0,
    tvBrowseExpectedRailScrollLeft: () => 0,
    tvBrowseSetRailLoading() {},
    tvBrowseRememberRailReady(queryKey, signature, resources) {
      ui.railReadyByQuery[queryKey] = { signature, resources, completedAt: now };
    },
    tvBrowseReleaseInitialColumns() {},
    tvBrowsePreview() {},
    tvWallpaperCurrentItems() { return []; },
    secondaryGetQuery() { return {}; },
    tvBrowseExpireLogoAsset() {},
    tvBrowseExpireWarmBackdrop() {},
    movieDetailCacheId() { return ""; },
    state: { movieDetail: { cache: {} }, tvDetail: { cache: {} } },
    mediaDomKey: (item) => item.id,
    tvBrowsePrepareLogo() {},
    secondaryActiveQuery() { return null; },
    secondaryFilterItems() { return []; },
    recommendationPoolItems() { return []; },
    tvBrowseMaybeLoadMore() {},
    getComputedStyle() { return { paddingLeft: "0", paddingRight: "0" }; },
    $(id) { return id === "tvBrowseRail" ? rail : null; },
    activateHomeDeferredImage() {}
  };
  context.tvBrowseMarkPosterState = (targetCard, targetImage, stateName, sourceUrl) => {
    if (targetImage) {
      targetImage.dataset.tvBrowsePosterState = stateName;
      if (sourceUrl != null) targetImage.dataset.tvBrowsePosterReadySource = sourceUrl;
      if (stateName === "failed" || stateName === "decode-failed") targetImage.dataset.tvBrowsePosterFailedAt = String(now);
      else if (["ready", "pending", "timed-out"].includes(stateName)) delete targetImage.dataset.tvBrowsePosterFailedAt;
    }
    if (targetCard) {
      targetCard.dataset.posterState = stateName;
      targetCard.classList.toggle("poster-unavailable", stateName === "failed" || stateName === "decode-failed" || stateName === "absent");
    }
  };
  const sandbox = createContext(context);
  runInContext([
    extract("tvBrowseMarkPosterState", "tvBrowseRailReadinessSignature"),
    extract("tvBrowseFinishRailReadiness", "tvBrowseTrackRailReadinessTask"),
    extract("tvBrowsePrepareGatePoster", "tvBrowseEnsureRailReadiness"),
    extract("tvBrowseDecodePoster", "tvBrowseSyncRailImagePreparation"),
    extract("tvBrowseSyncRailImagePreparation", "tvBrowseReconcileRailNodes")
  ].join("\n"), sandbox);
  function makeGate() {
    const record = {
      key: "movie-1", card, image, posterUrl: "/poster.jpg", posterState: "pending", posterDecodeState: "pending",
      detailState: "absent", logoState: "absent", logoDecodeState: "absent", backgroundState: "absent",
      backgroundDecodeState: "absent", warmBackdrops: []
    };
    const gate = {
      queryKey: "query-movie", signature: "first-screen", token: 1, settled: false, pending: 1,
      cleanup: [], timeoutId: 0, presentPreview: false, dataPending: false, resources: [record]
    };
    ui.railReadiness = gate;
    return { gate, record };
  }
  function deferDecode() {
    let resolve, reject;
    const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
    image.decodeResults.push({ promise });
    return { resolve, reject };
  }
  return {
    sandbox, ui, card, image, rail, makeGate, deferDecode,
    setNow(value) { now = value; },
    async flush() { await Promise.resolve(); await Promise.resolve(); await new Promise((resolve) => setImmediate(resolve)); }
  };
}

function makeRecord(harness) {
  return {
    key: harness.card.dataset.mediaKey, card: harness.card, image: harness.image, posterUrl: "/poster.jpg",
    posterState: "pending", posterDecodeState: "pending", detailState: "absent", logoState: "absent",
    logoDecodeState: "absent", backgroundState: "absent", backgroundDecodeState: "absent", warmBackdrops: []
  };
}

// A normal poster completes before the 15-second Gate and is decoded once.
{
  const h = createHarness(), { gate, record } = h.makeGate();
  const prepared = h.sandbox.tvBrowsePrepareGatePoster(h.card, record, gate);
  h.setNow(2000); h.image.complete = true; h.image.naturalWidth = 240; h.image.emit("load");
  assert.equal((await prepared).posterState, "ready");
  assert.equal(h.image.dataset.tvBrowsePosterState, "ready");
  assert.equal(h.card.classList.contains("poster-unavailable"), false);
}

// Load before the 15-second Gate boundary, but decode resolves later. The Gate
// timeout must not swallow the resource completion callback.
{
  const h = createHarness(), { gate, record } = h.makeGate();
  const prepared = h.sandbox.tvBrowsePrepareGatePoster(h.card, record, gate);
  const delayedDecode = h.deferDecode();
  h.setNow(14999); h.image.complete = true; h.image.naturalWidth = 240; h.image.emit("load");
  assert.equal(h.image.dataset.tvBrowseDecodePrepared, "movie-1");
  h.setNow(15000); h.sandbox.tvBrowseFinishRailReadiness(gate, true);
  const atGate = { posterState: h.image.dataset.tvBrowsePosterState, recordState: record.posterState,
    placeholder: h.card.classList.contains("poster-unavailable") };
  h.setNow(18000); delayedDecode.resolve(); await h.flush();
  const afterDecode = { posterState: h.image.dataset.tvBrowsePosterState,
    placeholder: h.card.classList.contains("poster-unavailable") };
  console.log("load-before-gate/decode-after-gate", JSON.stringify({ atGate, afterDecode }));
  assert.equal(atGate.recordState, "timed-out");
  assert.equal(atGate.placeholder, false, "loaded pixels are not hidden while decode is still pending");
  assert.equal(afterDecode.posterState, "ready", "a late decode completion recovers the current poster");
  assert.equal(afterDecode.placeholder, false, "a late decode completion clears the temporary unavailable state");
  await prepared;
}

// An eight-second image remains inside the 15-second Gate and never receives
// an unavailable placeholder.
{
  const h = createHarness(), { gate, record } = h.makeGate();
  const prepared = h.sandbox.tvBrowsePrepareGatePoster(h.card, record, gate);
  h.setNow(8000); h.image.complete = true; h.image.naturalWidth = 240; h.image.emit("load"); await h.flush();
  assert.equal(gate.settled, false, "an eight-second poster does not prematurely release the 15-second Gate");
  assert.equal(h.image.dataset.tvBrowsePosterState, "ready");
  assert.equal(h.card.classList.contains("poster-unavailable"), false);
  await prepared;
}

// At the 15-second deadline the original request continues. Gate cleanup does
// not change src, and the existing visible-image path observes its late load.
{
  const h = createHarness(), { gate, record } = h.makeGate();
  h.sandbox.tvBrowsePrepareGatePoster(h.card, record, gate);
  const requestsBeforeTimeout = h.image.requestCount;
  h.setNow(15000); h.sandbox.tvBrowseFinishRailReadiness(gate, true);
  assert.equal(h.image.dataset.tvBrowsePosterState, "timed-out");
  assert.equal(h.card.classList.contains("poster-unavailable"), false, "a preparation timeout is not an image failure");
  assert.equal(h.image.requestCount, requestsBeforeTimeout, "Gate release does not issue a duplicate poster request");
  assert.equal(h.ui.railReadinessTimedOutKey || "", "", "a resource timeout does not permanently block same-query readiness checks");
  h.setNow(18000); h.image.complete = true; h.image.naturalWidth = 240; h.image.emit("load"); await h.flush();
  assert.equal(h.image.dataset.tvBrowsePosterState, "ready", "a late load automatically clears the temporary state");
  assert.equal(h.card.classList.contains("poster-unavailable"), false);
  assert.equal(h.image.requestCount, requestsBeforeTimeout, "late recovery reuses the original request");
}

// A real failure after the Gate deadline still gets the unavailable treatment.
{
  const h = createHarness(), { gate, record } = h.makeGate();
  h.sandbox.tvBrowsePrepareGatePoster(h.card, record, gate);
  h.setNow(15000); h.sandbox.tvBrowseFinishRailReadiness(gate, true);
  h.image.complete = true; h.image.emit("error"); await h.flush();
  assert.equal(h.image.dataset.tvBrowsePosterState, "failed");
  assert.equal(h.card.classList.contains("poster-unavailable"), true, "only the confirmed load failure gets the unavailable treatment");
}

// A cached category card may be detached while its decode finishes. Retain
// the result on that same keyed node so a later reattach does not stay failed.
{
  const h = createHarness(), { gate, record } = h.makeGate();
  h.sandbox.tvBrowsePrepareGatePoster(h.card, record, gate);
  const delayedDecode = h.deferDecode();
  h.setNow(14999); h.image.complete = true; h.image.naturalWidth = 240; h.image.emit("load");
  h.setNow(15000); h.sandbox.tvBrowseFinishRailReadiness(gate, true);
  h.card.isConnected = false;
  h.setNow(18000); delayedDecode.resolve(); await h.flush();
  h.card.isConnected = true;
  assert.equal(h.image.dataset.tvBrowsePosterState, "ready", "a detached but identity-matching cached card retains late decode success");
  assert.equal(h.card.classList.contains("poster-unavailable"), false);
}

// Explicit request failure and decode failure remain terminal failures.
{
  const network = createHarness(), networkRecord = makeRecord(network), networkGate = network.makeGate().gate;
  const failedRequest = network.sandbox.tvBrowsePrepareGatePoster(network.card, networkRecord, networkGate);
  network.image.complete = true; network.image.emit("error");
  assert.equal((await failedRequest).posterState, "failed");
  assert.equal(network.card.classList.contains("poster-unavailable"), true);

  const decode = createHarness(), decodeRecord = makeRecord(decode), decodeGate = decode.makeGate().gate;
  const failedDecode = decode.sandbox.tvBrowsePrepareGatePoster(decode.card, decodeRecord, decodeGate);
  decode.image.decode = () => Promise.reject(new Error("decode failed"));
  decode.image.complete = true; decode.image.naturalWidth = 240; decode.image.emit("load");
  await decode.flush();
  assert.equal((await failedDecode).posterState, "decode-failed");
  assert.equal(decode.image.dataset.tvBrowsePosterState, "decode-failed", "decode failure remains distinct from request failure");
  assert.equal(decode.card.classList.contains("poster-unavailable"), true);
}

// Re-entering the visible range after the 60-second failure TTL must trigger
// an actual retry. This calls the production visibility sync and decode path.
{
  const h = createHarness();
  h.sandbox.tvBrowseSyncRailImagePreparation();
  h.image.complete = true;
  h.image.emit("error");
  const requestCountAtFailure = h.image.requestCount;
  assert.equal(h.image.dataset.tvBrowsePosterState, "failed");
  h.setNow(60999);
  h.sandbox.tvBrowseSyncRailImagePreparation();
  assert.equal(h.image.requestCount, requestCountAtFailure, "a visible failure is not retried before its 60-second backoff expires");
  h.setNow(61001);
  h.sandbox.tvBrowseSyncRailImagePreparation();
  console.log("reenter-after-ttl", JSON.stringify({ requestCountAtFailure, requestCountAfterReentry: h.image.requestCount,
    state: h.image.dataset.tvBrowsePosterState }));
  assert.equal(h.image.requestCount, requestCountAtFailure + 1, "expired failures are retried when the card becomes visible again");
}

// A request may fail after its card is detached in the bounded category
// cache. Preserve the true failure on that keyed node for its next attach.
{
  const h = createHarness();
  h.sandbox.tvBrowseSyncRailImagePreparation();
  h.card.isConnected = false;
  h.image.complete = true;
  h.image.emit("error");
  h.card.isConnected = true;
  assert.equal(h.image.dataset.tvBrowsePosterState, "failed", "an offscreen node records the actual request failure");
  assert.equal(h.card.classList.contains("poster-unavailable"), true, "the reattached card keeps the true-failure placeholder");
}

// A timed-out decode from an old media source must not paint onto a reused card.
{
  const h = createHarness(), { gate, record } = h.makeGate();
  h.sandbox.tvBrowsePrepareGatePoster(h.card, record, gate);
  const delayedDecode = h.deferDecode();
  h.image.complete = true; h.image.naturalWidth = 240; h.image.emit("load");
  h.setNow(15000); h.sandbox.tvBrowseFinishRailReadiness(gate, true);
  h.image.src = "/replacement-poster.jpg";
  h.card.dataset.mediaKey = "replacement";
  h.setNow(18000); delayedDecode.resolve(); await h.flush();
  assert.notEqual(h.image.dataset.tvBrowsePosterState, "ready", "a stale decode cannot mark a different media key ready");
}

console.log("TV Browse poster lifecycle checks passed: 15-second Gate, pending timeout, late decode/load, true failure, decode failure, TTL retry, stale media guard.");
