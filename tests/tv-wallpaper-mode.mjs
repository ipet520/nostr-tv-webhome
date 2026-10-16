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
    tvBrowsePreview, openDetail, closeDetail, isVisibleFocusable
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
async function pageAt(count = 8, index = 0) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#274538"/></svg>' });
    return route.abort();
  });
  await page.goto("http://fixture.local/?_tv=1");
  await page.evaluate(([seedCount, seedIndex]) => testWallpaper.seed(seedCount, seedIndex), [count, index]);
  await page.waitForTimeout(100);
  return page;
}

try {
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
    "wallpaper info bottom aligns with the normal rail title's safe lower edge");
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
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片2", "LEFT selects the previous resource");
  assert.deepEqual(await page.evaluate(() => testWallpaper.clock.pending()), [], "infinite remains nonrotating after manual navigation");

  const wallBeforeExit = await page.evaluate(() => ({
    key: testWallpaper.tvBrowsePosition().key,
    title: document.querySelector("#tvBrowseTitle").textContent,
    backdrop: testWallpaper.tvBrowseState().backdropUrl,
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
    top: document.querySelector("#tvBrowseInfo").getBoundingClientRect().top,
    marker: history.state && history.state.wallpaperTransient,
    hash: location.hash
  }));
  assert.equal(exit.active, false, "DOWN exits wallpaper mode");
  assert.equal(exit.key, wallBeforeExit.key);
  assert.equal(exit.focusKey, wallBeforeExit.key, "exit focuses the currently displayed resource card");
  assert.equal(exit.title, wallBeforeExit.title);
  assert.equal(exit.backdrop, wallBeforeExit.backdrop);
  assert.ok(Math.abs(exit.top - before.infoTop) < 2, "info reverses to its original position");
  assert.equal(exit.marker, undefined, "exit consumes only the wallpaper history entry");
  assert.equal(exit.hash, "", "exit returns to the exact Home URL marker");

  await page.evaluate(() => { testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter(); });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), false, "BACK exits the wallpaper layer");
  assert.equal(await page.evaluate(() => history.state && history.state.wallpaperTransient), undefined);
  await page.evaluate(() => { testWallpaper.tvWallpaperStopTimer(); testWallpaper.tvWallpaperEnter(); });
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => testWallpaper.tvWallpaperState().active), false, "UP exits wallpaper mode");

  await page.evaluate(() => { testWallpaper.stubDetail(); testWallpaper.tvWallpaperEnter(); });
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#tvBrowseTitle").textContent(), "壁纸影片3");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#detailSheet").classList.contains("active"));
  assert.equal(await page.evaluate(() => testWallpaper.state.selected.id), "wallpaper-3", "OK opens the resource displayed at key time");
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
  assert.equal(await nativeOk.evaluate(() => document.activeElement.matches("#tvBrowseRail .card")), true,
    "wallpaper entry preserves a focused card as the native OK click sink");
  await nativeOk.evaluate(async () => testWallpaper.clock.fire(10000));
  assert.equal(await nativeOk.locator("#tvBrowseTitle").textContent(), "壁纸影片1");
  await nativeOk.evaluate(() => {
    // The Android host dispatches OK as activeElement.click(), rather than a
    // WebView keydown. This deliberately clicks the original card after the
    // wallpaper resource has moved to B.
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
  assert.equal(await nativeBack.evaluate(() => history.state && history.state.wallpaperTransient), undefined, "Native popstate exits one wallpaper layer");
  assert.equal(await nativeBack.evaluate(() => location.href), nativeBackBase, "Native popstate returns exactly one layer to Home");
  await nativeBack.close();

  const batch = await pageAt(25, 0);
  await batch.evaluate(() => {
    const query = secondaryGetQuery("recommendation");
    const position = testWallpaper.tvBrowsePosition();
    position.key = query.items[17].id; position.index = 17;
    testWallpaper.tvBrowseState().previewKey = "";
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    testWallpaper.tvBrowsePreview(query.items[17]);
    testWallpaper.renderTvBrowse();
    testWallpaper.tvWallpaperStopTimer();
    testWallpaper.tvWallpaperEnter();
  });
  assert.equal(await batch.evaluate(() => testWallpaper.tvWallpaperState().active), true, "batch fixture enters at item 17");
  await batch.evaluate(async () => testWallpaper.tvWallpaperMove(1, false));
  const batchTarget = await batch.evaluate(() => ({
    key: testWallpaper.tvBrowsePosition().key,
    items: secondaryGetQuery("recommendation").items.length,
    rendered: Array.from(document.querySelectorAll("#tvBrowseRail > .card")).some(card => card.__mediaItem.id === "wallpaper-18")
  }));
  assert.equal(batchTarget.key, "wallpaper-18");
  assert.equal(batchTarget.items, 25, "wallpaper movement extends the current recommendation batch");
  assert.equal(batchTarget.rendered, true, "next resource card is materialized from the current Browse query");
  await batch.keyboard.press("ArrowDown");
  await batch.waitForFunction(() => !testWallpaper.tvWallpaperState().active);
  assert.equal(await batch.evaluate(() => document.activeElement.dataset.mediaKey), "wallpaper-18", "exit focuses the materialized batch target");
  await batch.close();

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
