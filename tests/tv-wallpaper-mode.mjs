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
function installHook() {
  window.testWallpaper = {
    state, tvBrowseState, tvBrowsePosition, tvBrowseQueryKey, secondaryGetQuery, renderTvBrowse,
    syncBrowseDevicePresentation, bindActions, installRemoteKeys, tvBrowseBeginStartup, homeFocusUserEpoch,
    tvWallpaperState, tvWallpaperScheduleIdle, tvWallpaperEnter, tvWallpaperMove, tvWallpaperPause,
    tvWallpaperResume, tvWallpaperPreferencesChanged, tvWallpaperStopTimer, tvWallpaperCurrentSelection,
    tvWallpaperHandleKey, tvWallpaperUpdateInfoShift, handleTvWallpaperPopState, renderUiPrefsControls, sanitizeUiPrefs, normalizeRemoteKey,
    setTvWallpaperPreference, toggleConnectionPanel, closeConnectionPanel,
    tvBrowsePreview, tvBrowseWarmNextBackground, tvBrowseCancelWarmBackdrop, tvBrowsePrepareCardResources,
    openDetail, closeDetail, isVisibleFocusable
  };
  window.testWallpaper.setup = () => { syncBrowseDevicePresentation(); bindActions(); installRemoteKeys(); };
  window.testWallpaper.seed = (count = 8, index = 0) => {
    state.deviceMode = "leanback"; state.previewMode = true; state.activeList = "all";
    state.homeV14.route = "home"; state.hot.ready = true;
    document.documentElement.classList.add("tv-preview", "tv-mode");
    state.hot.items = Array.from({ length: count }, (_, i) => ({
      id: "wallpaper-" + i, tmdbId: 7000 + i, title: "壁纸影片" + i, mediaType: "movie",
      source: "nostr-hot", people: 9, pic: "/poster-" + i + ".jpg",
      landscape: "/backdrop-" + i + ".jpg", overview: ("用于检查壁纸模式信息区安全边界的长剧情简介。".repeat(18)) + i, releaseDate: "2025-01-01"
    }));
    state.recent.loaded = true; state.recent.items = [];
    state.uiPrefs = { loaded: true, homeFullscreenEnabled: true, tvWallpaperEnterSeconds: 10, tvWallpaperIntervalSeconds: 10 };
    const ui = tvBrowseState(); ui.view = "home"; ui.column = "recommendation"; ui.filterOpen = false;
    ui.positions = {}; ui.previewKey = ""; ui.focusIntent = null; ui.retryFocusIntent = null;
    window.testWallpaper.setup();
    renderTvBrowse();
    const query = secondaryGetQuery("recommendation");
    query.loading = false; query.loaded = true; query.hasMore = count > query.items.length;
    const items = query.items.slice();
    const pos = tvBrowsePosition(); pos.key = items[index] && (items[index].id || ""); pos.index = index;
    renderTvBrowse({ ensureIndex: index });
    const current = query.items[index];
    if (current) {
      tvBrowsePreview(current);
      const card = Array.from(document.querySelectorAll("#tvBrowseRail .card")).find(node => node.__mediaItem && node.__mediaItem.id === current.id);
      if (card) card.focus();
    }
    renderUiPrefsControls();
    tvWallpaperStopTimer();
  };
  window.testWallpaper.installFakeLongTimers = () => {
    const realSet = window.setTimeout.bind(window), realClear = window.clearTimeout.bind(window);
    const entries = new Map(); let nextId = 100000;
    window.setTimeout = (fn, ms, ...args) => {
      if (Number(ms) >= 9000) { const id = ++nextId; entries.set(id, { fn, ms: Number(ms), args }); return id; }
      return realSet(fn, ms, ...args);
    };
    window.clearTimeout = id => { if (entries.delete(id)) return; realClear(id); };
    return {
      pending: () => Array.from(entries.values()).map(entry => entry.ms),
      fire: async ms => {
        const match = Array.from(entries.entries()).find(([, entry]) => ms == null || entry.ms === ms);
        if (!match) throw new Error("No fake timer for " + ms + "; pending=" + Array.from(entries.values()).map(entry => entry.ms).join(","));
        const [id, entry] = match; entries.delete(id); entry.fn(...entry.args);
        await Promise.resolve(); await Promise.resolve();
        await new Promise(resolve => realSet(resolve, 0));
        await Promise.resolve();
      }
    };
  };
  window.testWallpaper.installVisibilityProbe = () => {
    const observers = [];
    window.IntersectionObserver = class {
      constructor(callback, options) {
        this.callback = callback; this.options = options || {}; this.targets = new Set();
        observers.push(this);
      }
      observe(target) { this.targets.add(target); }
      unobserve(target) { this.targets.delete(target); }
      disconnect() { this.targets.clear(); }
      emitOutsideViewport() {
        const parts = String(this.options.rootMargin || "0px").trim().split(/\s+/);
        const horizontalMargin = parseFloat(parts[1] || parts[0]) || 0;
        const width = window.visualViewport && window.visualViewport.width || window.innerWidth;
        const rootBounds = { left: -horizontalMargin, right: width + horizontalMargin };
        this.callback(Array.from(this.targets).map(target => ({ target, isIntersecting: false, rootBounds })), this);
      }
    };
    window.testWallpaper.visibilityObservers = observers;
  };
  window.testWallpaper.emitOutsideViewport = () => {
    (window.testWallpaper.visibilityObservers || []).forEach(observer => observer.emitOutsideViewport());
  };
  window.testWallpaper.stubDetail = () => {
    prepareDetailPlaybackForDetail = () => Promise.resolve(null);
    window.testWallpaper.detailRenderCount = 0;
    renderDetailBase = () => { window.testWallpaper.detailRenderCount += 1; };
    clearDetailExtras = () => {};
    loadDetail = () => {};
    setNativeToolbarVisible = () => {};
    shouldRefreshRecentList = () => false;
  };
  window.testWallpaper.mockCache = () => {
    const writes = [];
    sdk = () => ({ cache: { set: async (key, value) => writes.push([key, value]) } });
    return writes;
  };
}
const hook = "(" + installHook.toString() + ")();";
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output, "test hook must replace production boot");
const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.WEBHOME_BROWSER_EXECUTABLE
    ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE }
    : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" })
});
const pageErrors = [];
async function pageAt(count = 8, index = 0, imageOptions = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.wallpaperTestRequests = { images: [], details: [] };
  page.on("request", request => {
    const url = new URL(request.url());
    if (request.resourceType() === "image") page.wallpaperTestRequests.images.push(url.pathname);
    if (url.pathname.startsWith("/tmdb/movie/")) page.wallpaperTestRequests.details.push(url.pathname);
  });
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    const parsedUrl = new URL(url);
    const movieDetail = parsedUrl.pathname.match(/^\/tmdb\/movie\/(\d+)$/);
    if (imageOptions.movieDetails && parsedUrl.origin === "http://fixture.local" && movieDetail) {
      const id = movieDetail[1];
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({
        id: Number(id), media_type: "movie", title: `壁纸测试影片${id}`, overview: `同一资源详情${id}`,
        release_date: "2025-01-01", images: { logos: [{ file_path: `/wallpaper-logo-${id}.png`, iso_639_1: "zh-CN", vote_average: 10 }] }
      }) });
    }
    if (route.request().resourceType() === "image") {
      const pathname = new URL(url).pathname;
      const delay = Number(imageOptions.delays && imageOptions.delays[pathname] || 0);
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if ((imageOptions.failures || []).some(fragment => pathname.includes(fragment))) return route.abort();
      return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#274538"/></svg>' });
    }
    return route.abort();
  });
  await page.goto("http://fixture.local/?_tv=1");
  if (imageOptions.movieDetails) {
    await page.evaluate(() => { window.WEBHOME_CONFIG.tmdb.apiBase = "http://fixture.local/tmdb"; });
  }
  if (imageOptions.visibilityProbe) await page.evaluate(() => testWallpaper.installVisibilityProbe());
  await page.evaluate(([seedCount, seedIndex]) => testWallpaper.seed(seedCount, seedIndex), [count, index]);
  await page.waitForTimeout(100);
  return page;
}

try {
  const sharedLogoPath = await pageAt(8, 0, { movieDetails: true, delays: { "/t/p/w1280/backdrop-0.jpg": 5000 } });
  await sharedLogoPath.waitForFunction(() => {
    const logo = document.querySelector("#tvBrowseLogo");
    return logo && !logo.hidden && logo.classList.contains("loaded") && logo.src.includes("wallpaper-logo-7000.png");
  }, null, { timeout: 3000 });
  const ordinaryLogoReady = await sharedLogoPath.evaluate(() => {
    const selection = testWallpaper.tvWallpaperCurrentSelection();
    const ui = testWallpaper.tvBrowseState();
    const warm = ui.warmBackdrops.find(entry => entry.url.includes("/backdrop-0.jpg"));
    return { key: selection.key, previewKey: ui.previewKey, warmState: warm && warm.state,
      logoVisible: !document.querySelector("#tvBrowseLogo").hidden };
  });
  assert.equal(ordinaryLogoReady.key, ordinaryLogoReady.previewKey, "ordinary Browse Logo belongs to the currently selected resource");
  assert.equal(ordinaryLogoReady.logoVisible, true, "the Logo is visible as soon as its own image preparation completes");
  assert.equal(ordinaryLogoReady.warmState === "ready" || ordinaryLogoReady.warmState === "presented", false,
    "Logo presentation does not wait for the same resource's deliberately held background");
  const sharedLogoRequestCount = sharedLogoPath.wallpaperTestRequests.images.filter(path => path.includes("wallpaper-logo-7000.png")).length;
  const sharedBackdropRequestCount = sharedLogoPath.wallpaperTestRequests.images.filter(path => path.includes("/backdrop-0.jpg")).length;
  const sharedDetailRequestCount = sharedLogoPath.wallpaperTestRequests.details.filter(path => path === "/tmdb/movie/7000").length;
  const wallpaperReuse = await sharedLogoPath.evaluate(async () => {
    testWallpaper.tvWallpaperStopTimer();
    const entered = testWallpaper.tvWallpaperEnter();
    const selection = testWallpaper.tvWallpaperCurrentSelection();
    const item = selection.item;
    const before = !document.querySelector("#tvBrowseLogo").hidden;
    const prepared = testWallpaper.tvBrowsePrepareCardResources(item, { requestClass: "foreground" });
    await Promise.resolve(); await Promise.resolve();
    const during = !document.querySelector("#tvBrowseLogo").hidden;
    testWallpaper.tvBrowsePreview(item);
    const immediatePreview = !document.querySelector("#tvBrowseLogo").hidden;
    testWallpaper.sharedWallpaperPreparation = prepared;
    return { entered, key: selection.key, previewKey: testWallpaper.tvBrowseState().previewKey,
      before, during, immediatePreview };
  });
  assert.equal(wallpaperReuse.entered, true, "the same resource can enter wallpaper presentation without rebuilding its resource preparation");
  assert.equal(wallpaperReuse.key, wallpaperReuse.previewKey, "wallpaper retains the ordinary Browse resource identity");
  assert.equal(wallpaperReuse.before && wallpaperReuse.during && wallpaperReuse.immediatePreview, true,
    "a previously prepared Logo is consumed immediately in wallpaper mode and by the existing preview renderer");
  assert.equal(sharedLogoPath.wallpaperTestRequests.images.filter(path => path.includes("wallpaper-logo-7000.png")).length, sharedLogoRequestCount,
    "re-entering the same resource in wallpaper mode does not reload its cached Logo");
  assert.equal(sharedLogoPath.wallpaperTestRequests.details.filter(path => path === "/tmdb/movie/7000").length, sharedDetailRequestCount,
    "wallpaper reuses the same TMDB detail result as ordinary Browse");
  assert.equal(sharedLogoPath.wallpaperTestRequests.images.filter(path => path.includes("/backdrop-0.jpg")).length, sharedBackdropRequestCount,
    "wallpaper reuses the pending same-resource background preparation instead of starting another image request");
  await sharedLogoPath.close();

  const page = await pageAt();
  assert.equal(await page.evaluate(() => normalizeRemoteKey({ key: "DPAD_CENTER" })), "Enter", "DPAD_CENTER key values normalize to OK");
  assert.equal(await page.evaluate(() => normalizeRemoteKey({ key: "Enter" })), "Enter", "Enter remains the normalized OK key");
  assert.equal(await page.evaluate(() => normalizeRemoteKey({ key: "", keyCode: 23 })), "Enter", "Android keyCode 23 normalizes to OK");
  assert.equal(await page.evaluate(() => normalizeRemoteKey({ key: "", keyCode: 66 })), "Enter", "Android keyCode 66 normalizes to OK");
  const labels = await page.locator("[data-wallpaper-enter]").allTextContents();
  assert.deepEqual(labels.map(text => text.trim()), ["关闭", "10 秒", "30 秒", "60 秒"]);
  assert.deepEqual((await page.locator("[data-wallpaper-interval]").allTextContents()).map(text => text.trim()), ["10 秒", "20 秒", "无限"]);
  assert.equal(await page.locator(".tv-wallpaper-setting").first().evaluate(node => !node.hidden && node.style.display !== "none"), true);
  assert.equal(await page.locator('[data-wallpaper-enter="10"]').getAttribute("aria-pressed"), "true");
  assert.equal(await page.locator('[data-wallpaper-interval="10"]').getAttribute("aria-pressed"), "true");

  const persisted = await page.evaluate(async () => {
    const writes = testWallpaper.mockCache();
    await testWallpaper.setTvWallpaperPreference("tvWallpaperEnterSeconds", 30);
    await testWallpaper.setTvWallpaperPreference("tvWallpaperEnterSeconds", 10);
    return writes.map(([key, value]) => [key, JSON.parse(value)]);
  });
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0][0], "fish2018_home_v1_ui_prefs");
  assert.equal(persisted[0][1].tvWallpaperEnterSeconds, 30);
  assert.equal(persisted[0][1].tvWallpaperIntervalSeconds, 10);
  await page.evaluate(() => { testWallpaper.clock = testWallpaper.installFakeLongTimers(); testWallpaper.tvWallpaperScheduleIdle(true); });
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [10000], "default idle wait is 10 seconds");
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), false, "home stays normal before the full idle wait");
  const lastActivityBefore = await page.evaluate(() => testWallpaper.tvWallpaperState().lastActivityAt);
  await page.keyboard.press("ArrowLeft");
  assert.ok(await page.evaluate(() => testWallpaper.tvWallpaperState().lastActivityAt) > lastActivityBefore, "a physical remote key resets inactivity timing");

  const before = await page.evaluate(() => {
    const selection = testWallpaper.tvWallpaperCurrentSelection();
    selection.item.overview = "进入前已渲染的当前资源简介。";
    testWallpaper.tvBrowsePreview(selection.item);
    return {
      key: testWallpaper.tvBrowsePosition().key,
      index: testWallpaper.tvBrowsePosition().index,
      title: document.querySelector("#tvBrowseTitle").textContent,
      overview: document.querySelector("#tvBrowseOverview").textContent,
      backdrop: testWallpaper.tvBrowseState().backdropUrl,
      infoTop: document.querySelector("#tvBrowseInfo").getBoundingClientRect().top
    };
  });
  const lateOverview = "异步补全后用于复测壁纸模式信息区高度和底部安全边界的长剧情简介。".repeat(18);
  await page.evaluate(() => testWallpaper.clock.fire(10000));
  await page.evaluate(() => {
    const item = testWallpaper.tvWallpaperCurrentSelection().item;
    window.setTimeout(() => {
      item.overview = "异步补全后用于复测壁纸模式信息区高度和底部安全边界的长剧情简介。".repeat(18);
      testWallpaper.tvBrowsePreview(item);
    }, 80);
  });
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), true);
  const firstEntry = await page.evaluate(() => {
    const info = document.querySelector("#tvBrowseInfo"), title = document.querySelector("#tvBrowseTitle");
    const overview = document.querySelector("#tvBrowseOverview"), logo = document.querySelector("#tvBrowseLogo");
    return {
      key: testWallpaper.tvWallpaperCurrentSelection().key,
      title: title.textContent,
      titleVisible: !title.hidden && getComputedStyle(title).visibility !== "hidden" || !logo.hidden && getComputedStyle(logo).visibility !== "hidden",
      overview: overview.textContent,
      overviewVisible: !overview.hidden && getComputedStyle(overview).display !== "none" && overview.getBoundingClientRect().height > 0,
      infoVisible: !info.hidden && getComputedStyle(info).visibility !== "hidden" && Number(getComputedStyle(info).opacity) > 0
    };
  });
  assert.equal(firstEntry.key, before.key, "first wallpaper frame keeps resource A before rotation");
  assert.equal(firstEntry.title, before.title, "resource A title remains rendered on first wallpaper entry");
  assert.equal(firstEntry.titleVisible, true, "resource A title or its current logo is visible before rotation");
  assert.equal(firstEntry.overview, lateOverview, "asynchronous synopsis enrichment completes on resource A before rotation");
  assert.equal(firstEntry.overviewVisible, true, "resource A synopsis remains visible before rotation");
  assert.equal(firstEntry.infoVisible, true, "the wallpaper information area remains visible before rotation");
  await page.waitForFunction(() => {
    const root=document.querySelector("#tvBrowse"),info=document.querySelector("#tvBrowseInfo"),foreground=root.querySelector(".tv-browse-foreground");
    const rootStyle=getComputedStyle(root),visibleHeight=parseFloat(rootStyle.getPropertyValue("--tv-visible-height"));
    const referenceBottom=visibleHeight-parseFloat(getComputedStyle(foreground).paddingBottom)-parseFloat(rootStyle.getPropertyValue("--tv-rail-title-bottom-gap"));
    return Math.abs(info.getBoundingClientRect().bottom-root.getBoundingClientRect().top-referenceBottom)<=1.5;
  },{},{timeout:1500});
  const wallpaperInfoBounds = await page.evaluate(() => {
    const root = document.querySelector("#tvBrowse"), info = document.querySelector("#tvBrowseInfo");
    const foreground = root.querySelector(".tv-browse-foreground"), rootRect = root.getBoundingClientRect();
    const infoRect = info.getBoundingClientRect(), rootStyle = getComputedStyle(root);
    const visibleHeight = parseFloat(rootStyle.getPropertyValue("--tv-visible-height"));
    const titleBottomGap = parseFloat(rootStyle.getPropertyValue("--tv-rail-title-bottom-gap"));
    const bottomPadding = parseFloat(getComputedStyle(foreground).paddingBottom);
    return {
      infoBottom: infoRect.bottom - rootRect.top,
      referenceBottom: visibleHeight - bottomPadding - titleBottomGap,
      visibleHeight,
      overviewLineClamp: getComputedStyle(document.querySelector("#tvBrowseOverview")).webkitLineClamp,
      overviewScrollHeight: document.querySelector("#tvBrowseOverview").scrollHeight,
      overviewClientHeight: document.querySelector("#tvBrowseOverview").clientHeight
    };
  });
  assert.ok(Math.abs(wallpaperInfoBounds.infoBottom - wallpaperInfoBounds.referenceBottom) <= 1.5,
    "wallpaper info bottom aligns with the normal rail title's safe lower edge: " + JSON.stringify(wallpaperInfoBounds));
  assert.ok(wallpaperInfoBounds.infoBottom <= wallpaperInfoBounds.visibleHeight,
    "wallpaper info remains inside the measured visible viewport");
  assert.equal(wallpaperInfoBounds.overviewLineClamp, "3", "long overview keeps the existing three-line clamp");
  assert.ok(wallpaperInfoBounds.overviewScrollHeight > wallpaperInfoBounds.overviewClientHeight,
    "long overview remains ellipsized by its existing line clamp");
  await page.evaluate(() => {
    document.querySelector("#tvBrowse").style.setProperty("--tv-visible-height", "680px");
    testWallpaper.tvWallpaperUpdateInfoShift();
  });
  await page.waitForTimeout(450);
  const resizedInfoBounds = await page.evaluate(() => {
    const root = document.querySelector("#tvBrowse"), info = document.querySelector("#tvBrowseInfo");
    const foreground = root.querySelector(".tv-browse-foreground"), rootRect = root.getBoundingClientRect();
    const rootStyle = getComputedStyle(root);
    return info.getBoundingClientRect().bottom - rootRect.top
      - (parseFloat(rootStyle.getPropertyValue("--tv-visible-height"))
        - parseFloat(getComputedStyle(foreground).paddingBottom)
        - parseFloat(rootStyle.getPropertyValue("--tv-rail-title-bottom-gap")));
  });
  assert.ok(Math.abs(resizedInfoBounds) <= 1.5, "wallpaper position follows the measured WebView visible height");
  await page.evaluate(() => {
    document.querySelector("#tvBrowse").style.setProperty("--tv-visible-height", "720px");
    testWallpaper.tvWallpaperUpdateInfoShift();
  });
  await page.waitForTimeout(450);
  assert.equal(await page.evaluate(() => testWallpaper.tvBrowsePosition().key), before.key, "entering keeps current resource position");
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), before.title);
  assert.equal(await page.evaluate(() => testWallpaper.tvBrowseState().backdropUrl), before.backdrop, "entering preserves the current backdrop");
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [10000], "first rotation waits a full 10 seconds");
  const transition = await page.evaluate(() => ({
    info: getComputedStyle(document.querySelector("#tvBrowseInfo")).transitionDuration,
    functions: getComputedStyle(document.querySelector("#tvBrowseFunctions")).opacity,
    columns: getComputedStyle(document.querySelector("#tvBrowseColumns")).opacity,
    rail: getComputedStyle(document.querySelector("#tvBrowseRail")).opacity
  }));
  assert.equal(transition.info, "0.4s");
  assert.equal(transition.functions, "0");
  assert.equal(transition.columns, "0");
  assert.equal(transition.rail, "0");
  await page.evaluate(() => testWallpaper.tvWallpaperPause());
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [], "pause stops rotation");
  await page.evaluate(() => testWallpaper.tvWallpaperResume());
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [10000], "resume starts a full interval");

  await page.evaluate(() => testWallpaper.clock.fire(10000));
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片1", "automatic switch follows the active Browse order");
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => !testWallpaper.tvWallpaperState().movePending);
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片2", "manual RIGHT selects the next resource");
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [10000], "manual RIGHT restarts the interval");
  await page.evaluate(async () => testWallpaper.setTvWallpaperPreference("tvWallpaperIntervalSeconds", 20));
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [20000]);
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片2", "20 second interval does not switch immediately");
  await page.evaluate(() => testWallpaper.clock.fire(20000));
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片3");
  await page.evaluate(async () => testWallpaper.setTvWallpaperPreference("tvWallpaperIntervalSeconds", 10));
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [10000]);
  await page.evaluate(() => testWallpaper.clock.fire(10000));
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片4");
  await page.evaluate(async () => testWallpaper.setTvWallpaperPreference("tvWallpaperIntervalSeconds", 0));
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [], "infinite interval schedules no rotation");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片3", "LEFT selects the previous resource");
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [], "infinite remains nonrotating after manual navigation");

  const wallBeforeExit = await page.evaluate(() => ({
    key: testWallpaper.tvBrowsePosition().key,
    title: document.querySelector("#tvBrowseTitle").textContent,
    backdrop: testWallpaper.tvBrowseState().backdropUrl,
    backdropKey: testWallpaper.tvBrowseState().backdropMediaKey,
    top: document.querySelector("#tvBrowseInfo").getBoundingClientRect().top
  }));
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(450);
  const exit = await page.evaluate(() => ({
    active: testWallpaper.tvWallpaperState().active,
    key: testWallpaper.tvBrowsePosition().key,
    focusKey: document.activeElement.dataset.mediaKey || "",
    title: document.querySelector("#tvBrowseTitle").textContent,
    backdrop: testWallpaper.tvBrowseState().backdropUrl,
    backdropKey: testWallpaper.tvBrowseState().backdropMediaKey,
    top: document.querySelector("#tvBrowseInfo").getBoundingClientRect().top,
    marker: history.state ? history.state.wallpaperTransient : undefined,
    hash: location.hash
  }));
  assert.equal(exit.active, false, "DOWN exits wallpaper mode");
  assert.equal(exit.key, wallBeforeExit.key);
  assert.equal(exit.focusKey, wallBeforeExit.key, "exit focuses the currently displayed resource card");
  assert.equal(exit.title, wallBeforeExit.title);
  assert.equal(exit.backdropKey, wallBeforeExit.key, "the displayed backdrop remains associated with the current resource");
  assert.ok(Math.abs(exit.top - before.infoTop) < 2, "info reverses to its original position");
  assert.equal(exit.marker, undefined, "exit consumes only the wallpaper history entry");
  assert.equal(exit.hash, "", "exit returns to the exact Home URL marker");

  await page.evaluate(() => { testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter(); });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), false, "BACK exits the wallpaper layer");
  assert.equal(await page.evaluate(() => history.state ? history.state.wallpaperTransient : undefined), undefined);
  await page.evaluate(() => { testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter(); });
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), false, "UP exits wallpaper mode");

  await page.evaluate(() => { testWallpaper.stubDetail(); testWallpaper.tvWallpaperEnter(); });
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片4");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await page.evaluate(() => testWallpaper.state.selected.id), "wallpaper-4", "OK opens the resource displayed at key time");
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), false);
  await page.evaluate(() => testWallpaper.closeDetail());
  await page.waitForFunction(() => !document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), false, "detail return restores normal Home");
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [10000], "detail return restarts the idle wait");
  await page.close();

  const nativeOkInitial = await pageAt();
  await nativeOkInitial.evaluate(() => {
    testWallpaper.clock = testWallpaper.installFakeLongTimers();
    testWallpaper.stubDetail();
    testWallpaper.tvWallpaperEnter();
    document.activeElement.click();
  });
  await nativeOkInitial.waitForFunction(() => document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await nativeOkInitial.evaluate(() => testWallpaper.state.selected.id), "wallpaper-0",
    "native synthetic OK opens the first displayed wallpaper resource");
  assert.equal(await nativeOkInitial.evaluate(() => testWallpaper.detailRenderCount), 1,
    "first wallpaper OK opens one detail");
  await nativeOkInitial.evaluate(() => testWallpaper.closeDetail());
  await nativeOkInitial.waitForFunction(() => !document.querySelector("#detailSheet").classList.contains("active"));
  await nativeOkInitial.close();

  const nativeOk = await pageAt();
  await nativeOk.evaluate(() => {
    testWallpaper.clock = testWallpaper.installFakeLongTimers();
    testWallpaper.stubDetail();
    testWallpaper.tvWallpaperEnter();
  });
  assert.equal(await nativeOk.evaluate(() => document.activeElement.id), "tvBrowse",
    "wallpaper entry focuses the persistent Browse root as the native OK click sink");
  await nativeOk.evaluate(async () => testWallpaper.clock.fire(10000));
  assert.equal(await nativeOk.locator("#tvBrowseTitle").textContent(), "壁纸影片1");
  await nativeOk.evaluate(() => {
    renderTvBrowse({ append: true, reason: "wallpaper-test-batch-render" });
    // The Android host dispatches OK as activeElement.click(), rather than a
    // WebView keydown. A Browse reconciliation must leave the stable sink live.
    if (document.activeElement.id !== "tvBrowse") throw new Error("wallpaper click sink lost focus during render");
    document.activeElement.click();
    document.activeElement.click();
  });
  await nativeOk.waitForFunction(() => document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await nativeOk.evaluate(() => testWallpaper.state.selected.id), "wallpaper-1",
    "native synthetic OK opens the currently displayed resource, not the focused card's old item");
  assert.equal(await nativeOk.evaluate(() => testWallpaper.detailRenderCount), 1,
    "duplicate native OK clicks open the detail once");
  assert.equal(await nativeOk.evaluate(() => testWallpaper.tvWallpaperState().active), false);
  await nativeOk.evaluate(() => testWallpaper.closeDetail());
  await nativeOk.waitForFunction(() => !document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await nativeOk.evaluate(() => testWallpaper.tvWallpaperState().active), false);
  assert.deepEqual(await nativeOk.evaluate(() => testWallpaper.clock.pending()), [10000],
    "detail return starts a fresh wallpaper idle interval");
  await nativeOk.close();

  const nativeBack = await pageAt();
  const nativeBackBase = await nativeBack.evaluate(() => location.href);
  await nativeBack.evaluate(() => { testWallpaper.clock = testWallpaper.installFakeLongTimers(); testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter(); });
  assert.equal(await nativeBack.evaluate(() => location.hash), "#tv-wallpaper",
    "wallpaper history entry changes the WebView URL like the filter panel marker");
  assert.equal(await nativeBack.evaluate(() => history.state && history.state.wallpaperTransient), true);
  await nativeBack.evaluate(() => history.back());
  await nativeBack.waitForFunction(() => !testWallpaper.tvWallpaperState().active);
  assert.equal(await nativeBack.evaluate(() => history.state ? history.state.wallpaperTransient : undefined), undefined, "Native popstate exits one wallpaper layer");
  assert.equal(await nativeBack.evaluate(() => location.href), nativeBackBase, "Native popstate returns exactly one layer to Home");
  await nativeBack.close();

  const batch = await pageAt(25, 0, { visibilityProbe: true });
  await batch.evaluate(() => {
    const query = secondaryGetQuery("recommendation");
    const position = testWallpaper.tvBrowsePosition();
    position.key = query.items[17].id; position.index = 17;
    testWallpaper.tvBrowseState().previewKey = "";
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    testWallpaper.tvBrowsePreview(query.items[17]);
    testWallpaper.renderTvBrowse();
    const currentCard = Array.from(document.querySelectorAll("#tvBrowseRail .card"))
      .find(node => node.__mediaItem && node.__mediaItem.id === query.items[17].id);
    if (currentCard) currentCard.focus();
    testWallpaper.tvWallpaperStopTimer();
    testWallpaper.tvWallpaperEnter();
  });
  assert.equal(await batch.evaluate(() => testWallpaper.tvWallpaperState().active), true, "batch fixture enters at item 17");
  await batch.evaluate(() => testWallpaper.emitOutsideViewport());
  const nearbyImages = await batch.evaluate(() => Array.from(document.querySelectorAll("#tvBrowseRail .card")).map(card => ({
    index: Number(card.dataset.cardIndex), deferred: !!card.querySelector("img[data-src]")
  })));
  assert.equal(nearbyImages.find(card => card.index === 17).deferred, false,
    "the existing image observer loads the current logical Browse item while the rail is hidden");
  assert.equal(nearbyImages.find(card => card.index === 15).deferred, false,
    "the existing image observer loads a previous item inside its viewport margin");
  assert.equal(nearbyImages.find(card => card.index === 19).deferred, false,
    "the existing image observer loads a next item inside its viewport margin");
  assert.equal(nearbyImages.find(card => card.index === 24).deferred, true,
    "logical visibility does not bypass the existing observer's viewport range");
  await batch.evaluate(async () => testWallpaper.tvWallpaperMove(1, false));
  await batch.evaluate(() => testWallpaper.emitOutsideViewport());
  const batchTarget = await batch.evaluate(() => ({
    key: testWallpaper.tvBrowsePosition().key,
    items: secondaryGetQuery("recommendation").items.length,
    rendered: Array.from(document.querySelectorAll("#tvBrowseRail > .card")).some(card => card.__mediaItem.id === "wallpaper-18")
  }));
  assert.equal(batchTarget.key, "wallpaper-18");
  assert.equal(batchTarget.items, 25, "wallpaper movement extends the current recommendation batch");
  assert.equal(batchTarget.rendered, true, "next resource card is materialized from the current Browse query");
  assert.equal(await batch.locator('#tvBrowseRail > .card[data-card-index="20"] img').getAttribute("data-src"), null,
    "a changed logical Browse position applies the existing focus-reveal viewport to newly adjacent posters");
  assert.notEqual(await batch.locator('#tvBrowseRail > .card[data-card-index="24"] img').getAttribute("data-src"), null,
    "poster loading remains bounded by the ordinary observer viewport after a logical position change");
  await batch.evaluate(() => {
    testWallpaper.stubDetail();
    testWallpaper.batchCardBefore = Array.from(document.querySelectorAll("#tvBrowseRail .card"))
      .find(card => card.__mediaItem && card.__mediaItem.id === "wallpaper-18");
    testWallpaper.batchPosterBefore = testWallpaper.batchCardBefore && testWallpaper.batchCardBefore.querySelector("img");
    state.hot.items.push({ id: "wallpaper-extra", tmdbId: 7999, title: "追加资源", mediaType: "movie",
      source: "nostr-hot", people: 9, pic: "/poster-extra.jpg", landscape: "/backdrop-extra.jpg", overview: "追加的批次资源" });
    renderTvBrowse({ append: true, reason: "wallpaper-test-append" });
    const card = Array.from(document.querySelectorAll("#tvBrowseRail .card"))
      .find(entry => entry.__mediaItem && entry.__mediaItem.id === "wallpaper-18");
    testWallpaper.batchCardReused = !!card && card === testWallpaper.batchCardBefore
      && card.querySelector("img") === testWallpaper.batchPosterBefore;
  });
  assert.equal(await batch.evaluate(() => document.activeElement.id), "tvBrowse",
    "batch extension and card reconciliation preserve the Native OK sink");
  assert.equal(await batch.evaluate(() => testWallpaper.batchCardReused), true,
    "batch extension reuses the current card and poster node");
  await batch.evaluate(() => document.activeElement.click());
  await batch.waitForFunction(() => document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await batch.evaluate(() => testWallpaper.state.selected.id), "wallpaper-18",
    "Native OK resolves the active-query resource after batch extension");
  const returnSnapshot = await batch.evaluate(() => testWallpaper.state.homeReturn.tvBrowse.positions[testWallpaper.tvBrowseQueryKey()]);
  assert.equal(returnSnapshot.key, "wallpaper-18", "the detail snapshot keeps the wallpaper position, not the stale card focus");
  await batch.evaluate(() => testWallpaper.closeDetail());
  await batch.waitForFunction(() => !document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await batch.evaluate(() => document.activeElement.dataset.mediaKey), "wallpaper-18",
    "detail return focuses the currently displayed batch resource");
  assert.equal(await batch.evaluate(() => testWallpaper.tvBrowsePosition().key), "wallpaper-18",
    "detail return retains the same Browse preview position");
  await batch.close();

  const quickSwitch = await pageAt();
  await quickSwitch.waitForFunction(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/backdrop-0.jpg"));
  await quickSwitch.evaluate(() => {
    testWallpaper.tvBrowseCancelWarmBackdrop();
    const OriginalImage = window.Image, images = [];
    window.Image = function () {
      let source = "";
      const image = { onload: null, onerror: null };
      Object.defineProperty(image, "src", { get: () => source, set: value => { source = String(value || ""); } });
      images.push(image);
      return image;
    };
    testWallpaper.previewImages = images;
    testWallpaper.restoreImageConstructor = () => { window.Image = OriginalImage; };
    testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter();
  });
  await quickSwitch.evaluate(async () => {
    await testWallpaper.tvWallpaperMove(1, false);
    const b = testWallpaper.previewImages.find(image => image.src.endsWith("/backdrop-1.jpg"));
    testWallpaper.staleWallpaperImageOnload = b && b.onload;
    testWallpaper.firstPendingFrame = {
      key: testWallpaper.tvWallpaperState().currentKey,
      title: document.querySelector("#tvBrowseTitle").textContent,
      overview: document.querySelector("#tvBrowseOverview").textContent,
      backdrop: testWallpaper.tvBrowseState().backdropUrl,
      rootFocused: document.activeElement.id === "tvBrowse"
    };
    await testWallpaper.tvWallpaperMove(1, false);
  });
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.firstPendingFrame.key), "wallpaper-1");
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.firstPendingFrame.title), "壁纸影片1",
    "title updates in the selection turn without waiting for the background");
  assert.ok(await quickSwitch.evaluate(() => testWallpaper.firstPendingFrame.overview.includes("安全边界")),
    "the selected item's existing synopsis is immediate while its background is pending");
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.firstPendingFrame.backdrop.includes("/backdrop-0.jpg")), false,
    "the prior resource background is cleared instead of appearing under the new text");
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.firstPendingFrame.backdrop.endsWith("/poster-1.jpg")), true,
    "while B's backdrop loads, its already-loaded poster is shown instead of a neutral frame or A's background");
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.firstPendingFrame.rootFocused), true,
    "immediate text/background handling leaves the Native OK sink focused");
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.tvWallpaperState().currentKey), "wallpaper-2",
    "resource identity updates immediately while a backdrop is pending");
  assert.equal(await quickSwitch.locator("#tvBrowseTitle").textContent(), "壁纸影片2",
    "latest title is immediate while the latest background is pending");
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/poster-2.jpg")), true,
    "rapid selection uses only C's already-loaded poster while C's background is pending");
  await quickSwitch.evaluate(() => {
    const c = testWallpaper.previewImages.find(image => image.src.endsWith("/backdrop-2.jpg"));
    if (!c || !c.onload) throw new Error("current wallpaper backdrop was not staged for decode");
    c.onload();
  });
  assert.equal(await quickSwitch.locator("#tvBrowseTitle").textContent(), "壁纸影片2",
    "decoded background completion does not delay or revert the title");
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/backdrop-2.jpg")), true,
    "the current resource background is presented after its load fallback completes");
  await quickSwitch.evaluate(() => { if (testWallpaper.staleWallpaperImageOnload) testWallpaper.staleWallpaperImageOnload(); });
  assert.equal(await quickSwitch.evaluate(() => testWallpaper.tvBrowseState().presentedKey), "wallpaper-2",
    "a stale earlier image cannot replace the latest resource presentation");
  await quickSwitch.close();

  const adjacentPreparation = await pageAt(8, 2);
  const adjacentPreparedUrls = await adjacentPreparation.evaluate(() => testWallpaper.tvBrowseState().warmBackdrops.map(warm => warm.url));
  assert.equal(adjacentPreparedUrls.length, 1, "normal Browse prepares only one directional adjacent background");
  assert.equal(adjacentPreparedUrls.some(url => url.endsWith("/backdrop-1.jpg")), false,
    "normal Browse does not spend an additional preparation slot behind the active direction");
  assert.equal(adjacentPreparedUrls.some(url => url.endsWith("/backdrop-3.jpg")), true,
    "normal Browse prepares the next item's background");
  await adjacentPreparation.close();

  const prepared = await pageAt();
  await prepared.evaluate(() => {
    testWallpaper.tvBrowseCancelWarmBackdrop();
    const images = [];
    window.Image = function () {
      let source = "";
      const image = {
        onload: null, onerror: null, complete: false, sourceAssignments: 0,
        decode() {
          return new Promise(resolve => {
            this.finishDecode = () => { this.complete = true; resolve(); };
          });
        }
      };
      Object.defineProperty(image, "src", {
        get: () => source,
        set: value => { source = String(value || ""); if (source) image.sourceAssignments += 1; }
      });
      images.push(image);
      return image;
    };
    testWallpaper.previewImages = images;
    testWallpaper.tvBrowseWarmNextBackground(testWallpaper.tvWallpaperCurrentSelection().item);
    testWallpaper.preparedNextWarm = testWallpaper.tvBrowseState().warmBackdrops.find(warm => warm.url.endsWith("/backdrop-1.jpg"));
    testWallpaper.preparedNextImage = testWallpaper.preparedNextWarm.image;
    if (!testWallpaper.preparedNextImage.onload) throw new Error("neighbor backdrop was not started");
    testWallpaper.preparedNextImage.onload();
    testWallpaper.preparedStateAfterLoad = testWallpaper.preparedNextWarm.state;
    testWallpaper.tvWallpaperStopTimer();
    testWallpaper.tvWallpaperEnter();
  });
  assert.equal(await prepared.evaluate(() => testWallpaper.preparedStateAfterLoad), "decoding",
    "Image.onload alone does not count as completed decode preparation");
  await prepared.evaluate(() => testWallpaper.preparedNextImage.finishDecode());
  assert.equal(await prepared.evaluate(() => testWallpaper.preparedNextWarm.state), "ready",
    "a prepared neighbor becomes reusable after Image.decode resolves");
  await prepared.evaluate(() => testWallpaper.tvWallpaperMove(1, false));
  assert.equal(await prepared.locator("#tvBrowseTitle").textContent(), "壁纸影片1",
    "a prepared neighbor updates text immediately on selection");
  assert.equal(await prepared.evaluate(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/backdrop-1.jpg")), true,
    "a decoded neighbor background is presented in the same selection turn");
  assert.equal(await prepared.evaluate(() => testWallpaper.preparedNextImage.sourceAssignments), 1,
    "selection reuses the prepared image without assigning its source a second time");
  assert.equal(await prepared.evaluate(() => testWallpaper.preparedNextWarm.state === "presented"
    && testWallpaper.tvBrowseState().pendingPreview === null), true,
  "prepared image load/decode is reused without another foreground image request");
  await prepared.close();

  const decodeFallback = await pageAt();
  await decodeFallback.waitForFunction(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/backdrop-0.jpg"));
  await decodeFallback.evaluate(() => {
    testWallpaper.tvBrowseCancelWarmBackdrop();
    const images = [];
    window.Image = function () {
      let source = "";
      const image = { onload: null, onerror: null, decode: () => Promise.reject(new Error("decode unavailable")) };
      Object.defineProperty(image, "src", { get: () => source, set: value => { source = String(value || ""); } });
      images.push(image);
      return image;
    };
    testWallpaper.previewImages = images;
    testWallpaper.tvWallpaperStopTimer();
    testWallpaper.tvWallpaperEnter();
  });
  await decodeFallback.evaluate(() => testWallpaper.tvWallpaperMove(1, false));
  assert.equal(await decodeFallback.locator("#tvBrowseTitle").textContent(), "壁纸影片1",
    "decode rejection does not delay the selected resource title");
  await decodeFallback.evaluate(async () => {
    const image = testWallpaper.previewImages.find(candidate => candidate.src.endsWith("/backdrop-1.jpg"));
    image.onload();
    await Promise.resolve(); await Promise.resolve();
  });
  assert.equal(await decodeFallback.evaluate(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/backdrop-1.jpg")), true,
    "decode rejection falls back to the existing successful load event");
  await decodeFallback.close();

  const imageFallback = await pageAt(8, 0, { failures: ["/backdrop-1.jpg"] });
  await imageFallback.waitForFunction(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/backdrop-0.jpg"));
  await imageFallback.evaluate(() => { testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter(); });
  await imageFallback.evaluate(() => testWallpaper.tvWallpaperMove(1, false));
  assert.equal(await imageFallback.locator("#tvBrowseTitle").textContent(), "壁纸影片1",
    "the target title does not wait for the failed backdrop request or poster fallback");
  await imageFallback.waitForFunction(() => testWallpaper.tvBrowseState().backdropMediaKey === "wallpaper-1"
    && testWallpaper.tvBrowseState().backdropUrl.endsWith("/poster-1.jpg"));
  assert.equal(await imageFallback.evaluate(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/poster-1.jpg")), true,
    "a failed landscape backdrop falls back to the same resource poster");
  assert.equal(await imageFallback.locator("#tvBrowseTitle").textContent(), "壁纸影片1");
  await imageFallback.close();

  const neutralFallback = await pageAt(8, 0, { failures: ["/backdrop-1.jpg", "/poster-1.jpg"] });
  await neutralFallback.waitForFunction(() => testWallpaper.tvBrowseState().backdropUrl.endsWith("/backdrop-0.jpg"));
  await neutralFallback.evaluate(() => { testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter(); });
  await neutralFallback.evaluate(() => testWallpaper.tvWallpaperMove(1, false));
  assert.equal(await neutralFallback.locator("#tvBrowseTitle").textContent(), "壁纸影片1",
    "all background failure paths preserve the selected item's immediate text");
  await neutralFallback.waitForFunction(() => !testWallpaper.tvBrowseState().pendingPreview);
  assert.equal(await neutralFallback.evaluate(() => testWallpaper.tvBrowseState().backdropUrl), "",
    "a failed backdrop and failed same-item poster leave the neutral background");
  assert.equal(await neutralFallback.locator("#tvBrowseTitle").textContent(), "壁纸影片1",
    "image failure never delays or reverts title and synopsis");
  await neutralFallback.close();

  const empty = await pageAt();
  await empty.evaluate(() => {
    state.hot.items = []; renderTvBrowse(); testWallpaper.tvWallpaperScheduleIdle(true);
  });
  assert.equal(await empty.evaluate(() => testWallpaper.tvWallpaperState().active), false, "an empty home cannot enter wallpaper mode");
  await empty.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mobile.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="192"/>' });
    return route.abort();
  });
  await mobile.goto("http://fixture.local/");
  await mobile.evaluate(() => {
    state.deviceMode = "mobile"; state.previewMode = false; state.activeList = "all"; state.homeV14.route = "home";
    document.documentElement.classList.remove("tv-preview", "tv-mode", "tv-browse-active");
    state.uiPrefs = { loaded: true, tvWallpaperEnterSeconds: 10, tvWallpaperIntervalSeconds: 10 };
    renderUiPrefsControls();
  });
  assert.equal(await mobile.locator(".tv-wallpaper-setting").first().isVisible(), false, "Mobile never displays TV wallpaper settings");
  assert.equal(await mobile.evaluate(() => testWallpaper.tvWallpaperEnter()), false, "Mobile cannot enter wallpaper mode");
  await mobile.close();

  assert.deepEqual(pageErrors, [], "browser reported no uncaught exceptions");
  console.log("TV_WALLPAPER_MODE = PASS");
  console.log("SETTINGS_DEFAULTS_AND_PERSISTENCE = PASS");
  console.log("IDLE_AND_FIRST_ROTATION_INTERVALS = PASS");
  console.log("AUTOMATIC_INTERVALS_10_20_INFINITE = PASS");
  console.log("KEYS_EXIT_FOCUS_DETAIL_AND_NATIVE_BACK = PASS");
  console.log("ANIMATION_AND_CURRENT_BACKDROP_PRESERVED = PASS");
  console.log("EMPTY_HOME_AND_MOBILE_GUARDS = PASS");
} finally {
  await browser.close();
}
