import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/js/11e-tv-browse.js", import.meta.url), "utf8");
const names = [
  "tvBrowseCancelPendingPreview", "tvBrowseTouchWarmBackdrop", "tvBrowseTrimWarmBackdrops",
  "tvBrowseEnsureWarmBackdrop", "tvBrowseWaitWarmBackdrop", "tvBrowseCancelWarmBackdrop",
  "tvBrowseBackdropLayers", "tvBrowseClearBackdropLayer", "tvBrowseBackdropTransitionMs",
  "tvBrowseFinishDisplayedBackdropTransition", "tvBrowseStartDisplayedBackdropTransition",
  "tvBrowseClearDisplayedBackdrop", "tvBrowseSetDisplayedBackdrop", "tvBrowseCardPosterSource",
  "tvBrowseReadyCardPoster", "tvBrowseWarmBackdropTracked", "tvBrowseWarmBackdropSettled",
  "tvBrowseStartWarmBackdrop", "tvBrowseTakeWarmBackdrop", "tvBrowseFinishPreviewImage",
  "tvBrowseFailPreviewImage", "tvBrowseAdvancePreviewSource", "tvBrowseLoadPreviewSource",
  "tvBrowseWarmNextBackground", "tvBrowsePreview"
];

function extract(name) {
  const start = source.indexOf(`    function ${name}(`);
  assert.notEqual(start, -1, `production function ${name} exists`);
  const end = source.indexOf("\n    function ", start + 1);
  return source.slice(start, end < 0 ? source.length : end);
}

function makeHarness(items, imagePlan = {}) {
  const ui = {
    view: "home", column: "movie", previewKey: "", presentedKey: "", backdropToken: 0,
    backdropSlot: 0, backdropUrl: "", backdropMediaKey: "", pendingImage: null,
    pendingPreview: null, warmBackdrops: [], logoKey: "", previewDirection: 1,
    logoPreparationKeys: [], backdropTransition: null, backdropQueue: null
  };
  const wall = { active: false, currentKey: "", moveToken: 0 };
  const query = { items, hasMore: false, loading: false };
  const displayWrites = [];
  const stats = { requests: new Map(), decodes: new Map(), created: 0 };

  class FakeClassList {
    constructor() { this.values = new Set(); }
    contains(value) { return this.values.has(value); }
    add(value) { this.values.add(value); }
    remove(value) { this.values.delete(value); }
  }
  class FakeStyle {
    constructor(layer) { this.layer = layer; this._backgroundImage = ""; }
    get backgroundImage() { return this._backgroundImage; }
    set backgroundImage(value) {
      this._backgroundImage = value;
      if (!value) return;
      const match = String(value).match(/^url\((.*)\)$/);
      if (match) displayWrites.push({ url: JSON.parse(match[1]), key: this.layer.dataset.tvBrowseBackdropKey || "" });
    }
  }
  class FakeLayer {
    constructor() {
      this.dataset = {};
      this.classList = new FakeClassList();
      this.style = new FakeStyle(this);
      this.listeners = new Map();
    }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name, callback) { if (this.listeners.get(name) === callback) this.listeners.delete(name); }
  }
  const rail = {
    children: items.map(item => ({
      __mediaItem: item,
      querySelector: selector => selector === "img.poster" ? {
        dataset: {}, complete: true, naturalWidth: 720, currentSrc: item.posterUrl, src: item.posterUrl,
        hasAttribute: () => false
      } : null
    }))
  };
  class FakeImage {
    constructor() {
      stats.created += 1;
      this._src = ""; this.currentSrc = ""; this.complete = false;
      this.naturalWidth = 0; this.naturalHeight = 0; this.onload = null; this.onerror = null;
    }
    get src() { return this._src; }
    set src(value) {
      this._src = String(value || ""); this.currentSrc = this._src;
      if (!this._src) return;
      const url = this._src, plan = imagePlan[url] || {};
      stats.requests.set(url, (stats.requests.get(url) || 0) + 1);
      setTimeout(() => {
        if (this._src !== url) return;
        this.complete = true;
        if (plan.fail) {
          this.naturalWidth = 0; this.naturalHeight = 0;
          if (this.onerror) this.onerror(new Error("fixture image failure"));
          return;
        }
        this.naturalWidth = plan.width || 1280; this.naturalHeight = plan.height || 720;
        if (this.onload) this.onload();
      }, Number(plan.delay) || 0);
    }
    decode() {
      stats.decodes.set(this._src, (stats.decodes.get(this._src) || 0) + 1);
      const plan = imagePlan[this._src] || {};
      return plan.decodeFail ? Promise.reject(new Error("fixture decode failure")) : Promise.resolve();
    }
  }

  const layers = { tvBrowseBackdrop: new FakeLayer(), tvBrowseBackdropNext: new FakeLayer() };
  const stub = `
    let runtimeUi = __ui, runtimeWall = __wall, runtimeQuery = __query;
    function tvBrowseState() { return runtimeUi; }
    function $(id) { const key = String(id).replace(/^#/, ""); return key === "tvBrowseRail" ? __rail : __layers[key] || null; }
    function tvBrowseInitialVisibleCardCount() { return 1; }
    function mediaDomKey(item) { return item && item.key || ""; }
    function tvBrowseActive() { return true; }
    function secondaryGetQuery() { return runtimeQuery; }
    function tvWallpaperCurrentItems(query) { return query.items; }
    function tvBrowsePreviewDetail(item) { return item.detail || null; }
    function tvBrowsePreviewBackgrounds(item) { return item.backdropUrl ? { preferred: item.backdropUrl, urls: [item.backdropUrl] } : { preferred: "", urls: [] }; }
    function tvWallpaperState() { return runtimeWall; }
    function tvWallpaperScheduleInfoShift() {}
    function tvBrowseCommitPreviewInfo(item, detail, key) { runtimeUi.presentedKey = key; }
    function movieDetailCacheKey(item) { return item.key; }
    function tvDetailCacheKey(item) { return item.key; }
    function tvBrowseCancelLogo() {}
    function tvWallpaperIsActive() { return runtimeWall.active; }
    function tvBrowsePosterSource(image) { return image.currentSrc || image.src || ""; }
  `;
  const apiNames = names.join(", ");
  const code = `${stub}\n${names.map(extract).join("\n")}\nglobalThis.api = {
    ${apiNames},
    ui: () => runtimeUi,
    setPreparationKeys: keys => { runtimeUi.logoPreparationKeys = keys.slice(); },
    setWallpaper: (active, key) => { runtimeWall.active = active; runtimeWall.currentKey = key || ""; },
    setItems: next => { runtimeQuery.items = next; },
    displayedLayers: () => [$("tvBrowseBackdrop"), $("tvBrowseBackdropNext")]
      .filter(layer => layer.classList.contains("visible"))
      .map(layer => ({ url: layer.dataset.tvBrowseBackdropUrl || "", key: layer.dataset.tvBrowseBackdropKey || "" }))
  };`;
  const sandbox = {
    __ui: ui, __wall: wall, __query: query, __layers: layers, __rail: rail,
    Image: FakeImage, Date, Math, Number, String, Array, Set, Map, Promise, Object, JSON,
    setTimeout, clearTimeout, getComputedStyle: () => ({ transitionDuration: "0s", transitionDelay: "0s" }),
    TV_BROWSE_BACKDROP_TIMEOUT_MS: 1000, displayWrites, stats
  };
  vm.runInNewContext(code, sandbox, { filename: "tv-browse-backdrop-reuse.vm.js" });
  return { api: sandbox.api, stats, displayWrites, imagePlan };
}

const waitFor = async (predicate, label, timeoutMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(`timed out waiting for ${label}`);
};
const backdrop = key => `https://img.example.test/w1280/${key}.jpg`;
const poster = key => `https://img.example.test/w780/${key}-poster.jpg`;
const makeItems = keys => keys.map(key => ({ key, title: `Title ${key}`, mediaType: "movie", backdropUrl: backdrop(key), posterUrl: poster(key) }));

async function show(harness, item, prepKeys = [item.key]) {
  harness.api.setPreparationKeys(prepKeys);
  harness.api.tvBrowsePreview(item);
  await waitFor(() => harness.api.ui().backdropUrl === item.backdropUrl
    && harness.api.ui().backdropMediaKey === item.key
    && harness.api.ui().warmBackdrops.some(warm => warm.url === item.backdropUrl && warm.state === "presented"), `presented ${item.key}`);
}

// A -> B -> A: B leaves A outside the active preparation range. A's already
// decoded URL and Image object must remain in the bounded shared warm cache.
{
  const items = makeItems(["A", "B", "C", "D", "E", "F", "G"]);
  const harness = makeHarness(items);
  harness.api.setPreparationKeys(["A", "B"]);
  harness.api.tvBrowsePreview(items[0]);
  await waitFor(() => harness.api.ui().warmBackdrops.some(warm => warm.url === backdrop("A") && warm.state === "presented"), "A displayed in HD");
  await waitFor(() => harness.api.ui().warmBackdrops.some(warm => warm.url === backdrop("B") && warm.state === "ready"), "B prewarmed");
  const originalA = harness.api.tvBrowseTakeWarmBackdrop(backdrop("A"));
  assert.ok(originalA && originalA.image.complete && originalA.image.naturalWidth === 1280, "A cache holds the decoded landscape image");
  harness.api.setPreparationKeys(["B"]);
  harness.api.tvBrowsePreview(items[1]);
  await waitFor(() => harness.api.ui().backdropUrl === backdrop("B") && harness.api.ui().backdropMediaKey === "B", "B displayed");
  assert.equal(harness.api.ui().warmBackdrops.includes(originalA), true, "recent presented A is retained when it leaves the preparation range");

  harness.displayWrites.length = 0;
  harness.api.setPreparationKeys(["A"]);
  harness.api.tvBrowsePreview(items[0]);
  assert.equal(harness.api.ui().backdropUrl, backdrop("A"), "A's HD background is committed synchronously on revisit");
  assert.deepEqual(harness.displayWrites.map(entry => entry.url), [backdrop("A")], "no blurry poster is shown before A on revisit");
  assert.equal(harness.api.ui().warmBackdrops.find(warm => warm.url === backdrop("A")).image, originalA.image, "the same decoded Image object is reused");
  assert.equal(harness.stats.requests.get(backdrop("A")), 1, "A causes no duplicate image request");
  assert.equal(harness.stats.decodes.get(backdrop("A")), 1, "A causes no duplicate decode");
  assert.equal(JSON.stringify(harness.api.displayedLayers()), JSON.stringify([{ url: backdrop("A"), key: "A" }]), "visible background layer matches A's resource identity");

  // A -> B -> C -> B -> A should continue to consume recent decoded entries.
  await show(harness, items[1]);
  await show(harness, items[2]);
  await show(harness, items[1]);
  await show(harness, items[0]);
  assert.ok(["A", "B", "C"].every(key => harness.api.ui().warmBackdrops.some(warm => warm.url === backdrop(key) && warm.state === "presented")), "recent A/B/C backgrounds remain reusable");
  assert.equal(harness.stats.requests.get(backdrop("A")), 1);
  assert.equal(harness.stats.requests.get(backdrop("B")), 1);
  assert.equal(harness.stats.requests.get(backdrop("C")), 1);

  for (const item of items.slice(3)) {
    await show(harness, item);
    assert.ok(harness.api.ui().warmBackdrops.length <= 4, "warm background cache stays within the viewport-derived capacity");
  }
  assert.equal(harness.api.ui().warmBackdrops.length, 4, "cache eviction retains a finite recent window");
  assert.equal(harness.api.ui().backdropMediaKey, "G", "cache eviction never changes the current displayed identity");
  console.log("TV_BACKDROP_REUSE_A_B_A_AND_BOUNDED_LRU = PASS");
}

// Fast switching while an older request is in flight must not let that late
// completion replace the final selected background.
{
  const items = makeItems(["slow-A", "fast-B"]);
  const harness = makeHarness(items, { [backdrop("slow-A")]: { delay: 80 } });
  harness.api.setPreparationKeys(["slow-A", "fast-B"]);
  harness.api.tvBrowsePreview(items[0]);
  harness.api.tvBrowsePreview(items[1]);
  await waitFor(() => harness.api.ui().backdropUrl === backdrop("fast-B") && harness.api.ui().backdropMediaKey === "fast-B", "fast B displayed");
  await waitFor(() => harness.api.ui().warmBackdrops.some(warm => warm.url === backdrop("slow-A") && warm.state === "ready"), "late A completes into cache");
  assert.equal(harness.api.ui().previewKey, "fast-B");
  assert.equal(JSON.stringify(harness.api.displayedLayers()), JSON.stringify([{ url: backdrop("fast-B"), key: "fast-B" }]), "stale A callback cannot overwrite B's visible layer");
  console.log("TV_BACKDROP_REUSE_STALE_CALLBACK_GUARD = PASS");
}

// Unprepared resources retain the current same-item poster fallback, while a
// failed HD image eventually settles to that same resource's poster.
{
  const [slow, failed] = makeItems(["slow", "failed"]);
  const harness = makeHarness([slow, failed], { [backdrop("failed")]: { fail: true } });
  harness.api.setPreparationKeys(["slow"]);
  harness.api.tvBrowsePreview(slow);
  assert.equal(harness.api.ui().backdropUrl, poster("slow"), "unprepared selection immediately uses its own poster");
  await waitFor(() => harness.api.ui().backdropUrl === backdrop("slow"), "slow HD image completes");
  harness.api.setPreparationKeys(["failed"]);
  harness.api.tvBrowsePreview(failed);
  await waitFor(() => harness.api.ui().backdropUrl === poster("failed"), "failed HD image reaches poster fallback");
  assert.equal(harness.api.ui().backdropMediaKey, "failed");
  assert.equal(harness.api.ui().backdropUrl, poster("failed"), "failed HD background falls back to the same item's poster");
  console.log("TV_BACKDROP_REUSE_UNPREPARED_AND_FAILURE_FALLBACK = PASS");
}

// Normal Browse and wallpaper use the same preview and warm cache functions.
{
  const items = makeItems(["normal", "wall"]);
  const harness = makeHarness(items);
  await show(harness, items[0]);
  const normalWarm = harness.api.tvBrowseTakeWarmBackdrop(backdrop("normal"));
  harness.api.setWallpaper(true, "wall");
  await show(harness, items[1]);
  assert.ok(harness.api.ui().warmBackdrops.includes(normalWarm), "wallpaper presentation keeps consuming the same TV Browse cache entries");
  assert.ok(harness.api.ui().warmBackdrops.some(warm => warm.url === backdrop("wall")), "wallpaper background uses the shared warm cache");
  assert.equal(harness.api.ui().backdropMediaKey, "wall");
  assert.equal(harness.stats.requests.get(backdrop("wall")), 1);
  console.log("TV_BACKDROP_REUSE_NORMAL_WALLPAPER_SHARED_PATH = PASS");
}
