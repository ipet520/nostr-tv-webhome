import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { renderIndex, validateRenderedArtifact } from "../scripts/build-core.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch {
  const candidates = [
    process.env.WEBHOME_PLAYWRIGHT_PATH,
    process.env.USERPROFILE && join(process.env.USERPROFILE, ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try { playwright = require(candidate); break; }
    catch (_) {}
  }
  if (!playwright) throw new Error("Playwright is unavailable; set WEBHOME_PLAYWRIGHT_PATH to the installed package path");
}

const { output } = renderIndex();
validateRenderedArtifact(output);
const hook = `window.testBrowse = { state, tvBrowseState, tvBrowsePosition, tvBrowseSelectColumn,
  tvBrowseRailAnchorMetrics, tvBrowseScheduleRailAnchor, tvBrowseSetRailAnchor, focusRemoteTarget,
  syncBrowseDevicePresentation, bindActions, installRemoteKeys, tvBrowseBeginStartup, homeFocusUserEpoch,
  secondaryGetQuery, openDetail };
window.testBrowse.setup = () => { syncBrowseDevicePresentation(); bindActions(); installRemoteKeys(); };
window.testBrowse.seed = (count = 18) => {
  const query = secondaryGetQuery('movie'); query.loaded = true; query.loading = false;
  query.page = 1; query.hasMore = false; query.error = ''; query.retryableError = '';
  query.items = Array.from({length: count}, (_, index) => ({
    id: 71000 + index, tmdbId: 71000 + index, title: '轨迹影片' + index,
    mediaType: 'movie', source: 'tmdb', pic: '/poster-' + index + '.jpg', landscape: '/backdrop-' + index + '.jpg',
    releaseDate: '2025-01-01', overview: '焦点锚定浏览轨迹测试', voteAverage: 8.1
  }));
  return query;
};
window.testBrowse.sample = () => {
  const rail = document.querySelector('#tvBrowseRail'), card = document.activeElement && document.activeElement.closest('#tvBrowseRail > .card');
  const ui = tvBrowseState(), runtime = ui.railScroll || {}, position = tvBrowsePosition();
  if (!rail) return null;
  const railRect = rail.getBoundingClientRect(), style = getComputedStyle(rail), cardRect = card && card.getBoundingClientRect();
  const padLeft = Number(style.paddingLeft.replace('px', '')) || 0, padRight = Number(style.paddingRight.replace('px', '')) || 0;
  const anchorX = railRect.left + rail.clientLeft + padLeft + (rail.clientWidth - padLeft - padRight) / 2;
  const metrics = card && tvBrowseRailAnchorMetrics(card, rail);
  const ring = card && card.querySelector('.poster-wrap');
  return {
    scrollLeft: rail.scrollLeft,
    target: runtime.frame && Number.isFinite(Number(runtime.target)) ? Number(runtime.target) : metrics ? metrics.target : Number(rail.scrollLeft || 0),
    targetKey: runtime.frame ? runtime.targetKey : card && card.dataset.mediaKey || '',
    anchorX, cardCenterX: cardRect ? cardRect.left + cardRect.width / 2 : null,
    domFocusKey: card && card.dataset.mediaKey || '', selectedKey: position.key || '', selectedIndex: Number(position.index || 0),
    mediaId: card && card.__mediaItem && card.__mediaItem.id || null,
    targetMetrics: metrics && {desired: metrics.desired, max: metrics.max, canCenter: metrics.canCenter},
    centeredClass: !!(card && card.classList.contains('tv-browse-anchor-centered')),
    centeredCount: rail.querySelectorAll('.tv-browse-anchor-centered').length,
    transform: card && getComputedStyle(card).transform || '',
    ringOpacity: ring ? getComputedStyle(ring, '::after').opacity : ''
  };
};
window.testBrowse.beginTrace = () => {
  window.centerAnchorTrace = []; window.centerAnchorKeys = [];
  const sample = () => {
    if (!window.centerAnchorSampling) return;
    const value = testBrowse.sample();
    if (value) window.centerAnchorTrace.push(value);
    requestAnimationFrame(sample);
  };
  window.centerAnchorSampling = true; requestAnimationFrame(sample);
};
window.testBrowse.endTrace = () => { window.centerAnchorSampling = false; return window.centerAnchorTrace || []; };
document.addEventListener('keydown', event => {
  if (window.centerAnchorSampling && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    window.centerAnchorKeys = window.centerAnchorKeys || [];
    window.centerAnchorKeys.push({ key: event.key, frameIndex: (window.centerAnchorTrace || []).length + 1 });
  }
}, true);
`;
const html = output.replace(/boot\(\)\.catch\(function\(e\) \{[\s\S]*?\n    \}\);/, hook);
assert.notEqual(html, output, "fixture exports must replace production boot");

const browser = await playwright.chromium.launch({
  headless: true,
  ...(process.env.WEBHOME_BROWSER_EXECUTABLE ? { executablePath: process.env.WEBHOME_BROWSER_EXECUTABLE } : { channel: process.env.WEBHOME_BROWSER_CHANNEL || "chrome" })
});
const pageErrors = [];
async function pageAt(viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/*", async route => {
    const url = route.request().url();
    if (url.startsWith("http://fixture.local/") && new URL(url).pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (route.request().resourceType() === "image") return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="360"><rect width="240" height="360" fill="#274538"/></svg>' });
    return route.abort();
  });
  await page.goto("http://fixture.local/?_tv=1");
  await page.evaluate(() => {
    const api = testBrowse;
    api.state.previewMode = true; api.state.deviceMode = "leanback"; api.state.activeList = "all"; api.state.homeV14.route = "home";
    document.documentElement.classList.add("tv-preview", "tv-mode");
    api.state.hot.ready = true; api.state.hot.items = Array.from({length: 18}, (_, i) => ({id: i + 1, tmdbId: i + 1, title: "推荐" + i, mediaType: "movie", source: "nostr-hot", pic: "/poster.jpg", landscape: "/backdrop.jpg"}));
    api.state.recent.loaded = true; api.state.recent.items = [];
    api.setup(); api.tvBrowseBeginStartup(api.homeFocusUserEpoch()); api.seed(); api.tvBrowseSelectColumn("movie");
  });
  await page.waitForFunction(() => document.querySelectorAll("#tvBrowseRail > .card").length === 18);
  await page.waitForTimeout(700);
  return page;
}
const waitForScrollIdle = page => page.waitForFunction(() => !testBrowse.tvBrowseState().railScroll.frame, null, { timeout: 3000 });
const pressAndWait = async (page, key, wait = 72) => { await page.keyboard.press(key); await page.waitForTimeout(wait); };
const summarize = trace => trace.length ? {
  frames: trace.length,
  scrollStart: Number(trace[0].scrollLeft.toFixed(2)), scrollEnd: Number(trace.at(-1).scrollLeft.toFixed(2)),
  anchorMin: Number(Math.min(...trace.map(x => x.anchorX)).toFixed(2)), anchorMax: Number(Math.max(...trace.map(x => x.anchorX)).toFixed(2)),
  selectedKey: trace.at(-1).selectedKey, focusedKey: trace.at(-1).domFocusKey,
  centeredFrames: trace.filter(x => x.centeredClass).length,
  tailTarget: trace.at(-1).target
} : null;

const report = { viewport: { width: 1280, height: 720 }, phases: {}, trace: {} };
try {
  const page = await pageAt();
  await page.locator("#tvBrowseRail > .card").first().focus();
  await waitForScrollIdle(page);
  const start = await page.evaluate(() => testBrowse.sample());
  assert.equal(start.scrollLeft, 0, "first card remains at the natural rail start");
  assert.equal(start.domFocusKey, start.selectedKey, "start DOM focus and current resource agree");
  assert.equal(start.centeredClass, true, "clamped start edge retains the ordinary focused card treatment");
  report.phases.start = start;

  await page.evaluate(() => testBrowse.beginTrace());
  const forwardKeys = [];
  for (let index = 0; index < 7; index++) { await pressAndWait(page, "ArrowRight"); forwardKeys.push((await page.evaluate(() => testBrowse.sample())).selectedIndex); }
  await waitForScrollIdle(page);
  await page.waitForTimeout(80);
  const centerTrace = await page.evaluate(() => testBrowse.endTrace());
  await page.waitForFunction(() => {
    const card = document.activeElement && document.activeElement.closest("#tvBrowseRail > .card");
    if (!card || !card.classList.contains("tv-browse-anchor-centered")) return false;
    const transform = getComputedStyle(card).transform;
    const scale = transform === "none" ? 1 : Number((transform.match(/^matrix\(([^,]+)/) || [])[1]);
    return Math.abs(scale - 1.04) < 0.001 && getComputedStyle(card.querySelector(".poster-wrap"), "::after").opacity === "1";
  }, null, { timeout: 1200 });
  const centerEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(centerEnd.domFocusKey, centerEnd.selectedKey, "center selection is the actual DOM focus");
  assert.equal(centerEnd.centeredClass, true, "settled center selection receives its focus treatment");
  assert.ok(Math.abs(centerEnd.cardCenterX - centerEnd.anchorX) <= 1.5, "settled card center matches the stable visual anchor");
  assert.ok(centerEnd.transform.includes("1.04"), "existing 1.04 card scale appears at the center");
  assert.equal(centerEnd.ringOpacity, "1", "existing focus ring appears at the center");
  assert.equal(centerEnd.centeredCount, 1, "there is never more than one center focus treatment");
  assert.ok(forwardKeys.every((value, index) => index === 0 || value > forwardKeys[index - 1]), "every right input advances to the next resource");
  assert.ok(centerTrace.every(frame => Math.abs(frame.anchorX - centerEnd.anchorX) < 0.1), "center anchor remains fixed during rail motion");
  for (let index = 1; index < centerTrace.length; index++) {
    assert.ok(centerTrace[index].scrollLeft + 0.1 >= centerTrace[index - 1].scrollLeft, "forward-only segment never reverses its rail position");
    assert.ok(centerTrace[index].centeredCount <= 1, "no duplicate focus treatment appears in a frame");
  }
  assert.ok(centerTrace.every(frame => !frame.centeredClass || !frame.targetMetrics || !frame.targetMetrics.canCenter || Math.abs(frame.cardCenterX - frame.anchorX) <= 1.5), "the focus treatment is only shown at center or at a clamped rail edge");
  assert.ok(centerTrace.every(frame => !frame.centeredClass || frame.domFocusKey === frame.selectedKey), "a focus treatment never floats away from the selected DOM card");
  report.phases.center = { end: centerEnd, forwardKeys, summary: summarize(centerTrace) };
  report.trace.center = centerTrace;

  await page.evaluate(() => testBrowse.beginTrace());
  await pressAndWait(page, "ArrowRight", 44);
  const beforeReverse = await page.evaluate(() => testBrowse.sample());
  await pressAndWait(page, "ArrowLeft", 90);
  await waitForScrollIdle(page);
  const reverseTrace = await page.evaluate(() => testBrowse.endTrace());
  await page.waitForFunction(() => {
    const card = document.activeElement && document.activeElement.closest("#tvBrowseRail > .card");
    if (!card || !card.classList.contains("tv-browse-anchor-centered")) return false;
    const transform = getComputedStyle(card).transform;
    const scale = transform === "none" ? 1 : Number((transform.match(/^matrix\(([^,]+)/) || [])[1]);
    return Math.abs(scale - 1.04) < 0.001 && getComputedStyle(card.querySelector(".poster-wrap"), "::after").opacity === "1";
  }, null, { timeout: 1200 });
  const reverseEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(reverseEnd.selectedIndex, beforeReverse.selectedIndex - 1, "immediate reversal selects the latest left input");
  assert.equal(reverseEnd.domFocusKey, reverseEnd.selectedKey, "reversal leaves DOM focus on current resource");
  assert.ok(Math.abs(reverseEnd.cardCenterX - reverseEnd.anchorX) <= 1.5, "reversed motion settles at the same center anchor");
  const reverseKeyEvent = await page.evaluate(() => (window.centerAnchorKeys || []).filter(item => item.key === "ArrowLeft").at(-1));
  const reversedSegment = reverseKeyEvent ? reverseTrace.slice(reverseKeyEvent.frameIndex) : reverseTrace;
  for (let index = 1; index < reversedSegment.length; index++) {
    assert.ok(reversedSegment[index].scrollLeft <= reversedSegment[index - 1].scrollLeft + 0.1, "latest reverse target is approached without moving back toward the stale target");
  }
  report.phases.immediateReverse = { beforeReverse, end: reverseEnd, summary: summarize(reverseTrace) };
  report.trace.immediateReverse = reverseTrace;

  await page.evaluate(() => testBrowse.beginTrace());
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowLeft"]) await pressAndWait(page, key, 68);
  await waitForScrollIdle(page);
  const rapidTrace = await page.evaluate(() => testBrowse.endTrace());
  await page.waitForFunction(() => {
    const card = document.activeElement && document.activeElement.closest("#tvBrowseRail > .card");
    if (!card || !card.classList.contains("tv-browse-anchor-centered")) return false;
    const transform = getComputedStyle(card).transform;
    const scale = transform === "none" ? 1 : Number((transform.match(/^matrix\(([^,]+)/) || [])[1]);
    return Math.abs(scale - 1.04) < 0.001 && getComputedStyle(card.querySelector(".poster-wrap"), "::after").opacity === "1";
  }, null, { timeout: 1200 });
  const rapidEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(rapidEnd.domFocusKey, rapidEnd.selectedKey, "rapid alternating input ends on the authoritative resource");
  assert.equal(rapidEnd.centeredClass, true, "latest rapid target owns the settled focus treatment");
  assert.ok(Math.abs(rapidEnd.cardCenterX - rapidEnd.anchorX) <= 1.5, "rapid alternation settles at the same anchor");
  assert.ok(rapidTrace.every(frame => frame.centeredCount <= 1 && (!frame.centeredClass || frame.domFocusKey === frame.selectedKey)), "no stale or independent focus frame survives rapid movement");
  report.phases.rapidAlternation = { end: rapidEnd, summary: summarize(rapidTrace) };
  report.trace.rapidAlternation = rapidTrace;

  const tail = await page.evaluate(() => {
    const card = document.querySelector("#tvBrowseRail > .card:last-child");
    focusRemoteTarget(card);
    return testBrowse.sample();
  });
  await waitForScrollIdle(page);
  const tailEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(tailEnd.selectedIndex, 17, "tail selection reaches the final card");
  assert.ok(Math.abs(tailEnd.scrollLeft - tailEnd.targetMetrics.max) <= 1.5, "rail stops at its natural maximum without overscroll");
  assert.equal(tailEnd.centeredClass, true, "clamped tail keeps ordinary focus treatment");
  assert.equal(tailEnd.domFocusKey, tailEnd.selectedKey, "tail DOM focus and selected resource agree");
  report.phases.tail = { initial: tail, end: tailEnd };

  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#detailSheet")?.classList.contains("active"));
  const detail = await page.evaluate(() => ({ selectedId: state.selected && state.selected.id, focusedId: document.activeElement && document.activeElement.__mediaItem && document.activeElement.__mediaItem.id, position: tvBrowsePosition() }));
  assert.equal(detail.selectedId, 71017, "confirm opens the currently focused tail resource");
  report.phases.confirm = detail;
  assert.deepEqual(pageErrors, [], "fixture has no page errors");
  console.log("TV_BROWSE_CENTER_ANCHOR_BROWSER = PASS");
  console.log("CENTER_ANCHOR_FRAME_COUNTS = " + JSON.stringify(Object.fromEntries(Object.entries(report.trace).map(([key, value]) => [key, value.length]))));
  console.log("CENTER_ANCHOR_TRACE = " + JSON.stringify(report.trace));
  await page.close();
} finally {
  await browser.close();
}
