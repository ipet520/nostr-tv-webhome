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
  tvBrowseRailAnchorMetrics, tvBrowseScheduleRailAnchor, tvBrowseSetRailAnchor, tvBrowseRailCards,
  tvBrowseRailCurrentPosition, tvBrowseSetRailPosition: tvBrowseWriteRailPosition, focusRemoteTarget, renderTvBrowse,
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
  const rail = document.querySelector('#tvBrowseRail'), card = document.activeElement && document.activeElement.closest('#tvBrowseRail .tv-browse-rail-track > .card');
  const ui = tvBrowseState(), runtime = ui.railScroll || {}, position = tvBrowsePosition();
  if (!rail) return null;
  const railRect = rail.getBoundingClientRect(), style = getComputedStyle(rail), cardRect = card && card.getBoundingClientRect();
  const padLeft = Number(style.paddingLeft.replace('px', '')) || 0, padRight = Number(style.paddingRight.replace('px', '')) || 0;
  const anchorX = railRect.left + rail.clientLeft + padLeft + (rail.clientWidth - padLeft - padRight) / 2;
  const metrics = card && tvBrowseRailAnchorMetrics(card, rail);
  const scaleOf = node => { const transform = getComputedStyle(node).transform; if (transform === 'none') return 1; const matrix = transform.match(/^matrix\(([^,]+)/) || transform.match(/^matrix3d\(([^,]+)/); return matrix ? Number(matrix[1]) : 1; };
  const focusVisuals = Array.from(tvBrowseRailCards(rail)).filter(node => node.classList.contains('tv-browse-focus-interpolated')).map(node => {
    const rect = node.getBoundingClientRect(), wrap = node.querySelector('.poster-wrap');
    return {key: node.dataset.mediaKey || '', centerX: rect.left + rect.width / 2, scale: scaleOf(node), opacity: wrap ? Number(getComputedStyle(wrap, '::after').opacity) : 0};
  });
  return {
    scrollLeft: tvBrowseRailCurrentPosition(rail), actualScrollLeft: rail.scrollLeft,
    logicalPos: Number(runtime.logicalPos || 0),
    trackTransform: rail.querySelector('.tv-browse-rail-track').style.transform,
    motionMode: runtime.motionMode,
    target: runtime.frame && Number.isFinite(Number(runtime.target)) ? Number(runtime.target) : metrics ? metrics.target : tvBrowseRailCurrentPosition(rail),
    targetKey: runtime.frame ? runtime.targetKey : card && card.dataset.mediaKey || '',
    anchorX, cardCenterX: cardRect ? cardRect.left + cardRect.width / 2 : null,
    domFocusKey: card && card.dataset.mediaKey || '', selectedKey: position.key || '', selectedIndex: Number(position.index || 0),
    mediaId: card && card.__mediaItem && card.__mediaItem.id || null,
    targetMetrics: metrics && {desired: metrics.desired, max: metrics.max, canCenter: metrics.canCenter},
    spatialMode: rail.classList.contains('tv-browse-spatial-focus'),
    transform: card ? getComputedStyle(card).transform : '',
    scale: card ? scaleOf(card) : 1,
    ringOpacity: card ? Number(getComputedStyle(card.querySelector('.poster-wrap'), '::after').opacity) : 0,
    focusVisuals
  };
};
window.testBrowse.setMotionMode = mode => { window.__TV_BROWSE_RAIL_MOTION__ = mode; renderTvBrowse(); };
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
  await page.waitForFunction(() => document.querySelectorAll("#tvBrowseRail .tv-browse-rail-track > .card").length === 18);
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
  spatialFrames: trace.filter(x => x.spatialMode).length,
  intermediateFocusFrames: trace.filter(x => x.focusVisuals.some(item => item.opacity > 0.02 && item.opacity < 0.98)).length,
  tailTarget: trace.at(-1).target
} : null;

const waitForFullCenterTreatment = page => page.waitForFunction(() => {
  const card = document.activeElement && document.activeElement.closest('#tvBrowseRail .tv-browse-rail-track > .card');
  if (!card) return false;
  const transform = getComputedStyle(card).transform;
  const matrix = transform.match(/^matrix\(([^,]+)/) || transform.match(/^matrix3d\(([^,]+)/);
  const scale = matrix ? Number(matrix[1]) : 1;
  return Math.abs(scale - 1.04) < 0.001 && Number(getComputedStyle(card.querySelector('.poster-wrap'), '::after').opacity) > 0.999;
}, null, { timeout: 1200 });

const report = { viewport: { width: 1280, height: 720 }, phases: {}, trace: {} };
try {
  const page = await pageAt();
  await page.locator("#tvBrowseRail .tv-browse-rail-track > .card").first().focus();
  await waitForScrollIdle(page);
  await page.waitForTimeout(190);
  const start = await page.evaluate(() => testBrowse.sample());
  assert.equal(start.motionMode, "transform", "the formal TV Browse rail defaults to original B Transform");
  assert.equal(start.scrollLeft, 0, "first card remains at the natural rail start");
  assert.equal(start.actualScrollLeft, 0, "B Transform leaves native scrollLeft at zero");
  assert.match(start.trackTransform, /^translate3d\(/, "the inner track is the single visual position authority");
  assert.equal(start.domFocusKey, start.selectedKey, "start DOM focus and current resource agree");
  assert.equal(start.spatialMode, false, "the natural start edge retains ordinary focus presentation");
  assert.ok(Math.abs(start.scale - 1.04) < 0.001 && start.ringOpacity > 0.999, "start edge retains the ordinary focused card treatment");
  report.phases.start = start;

  await page.evaluate(() => testBrowse.beginTrace());
  const forwardKeys = [];
  for (let index = 0; index < 7; index++) { await pressAndWait(page, "ArrowRight", 30); forwardKeys.push((await page.evaluate(() => testBrowse.sample())).selectedIndex); }
  await waitForScrollIdle(page);
  await page.waitForTimeout(80);
  const centerTrace = await page.evaluate(() => testBrowse.endTrace());
  await waitForFullCenterTreatment(page);
  const centerEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(centerEnd.domFocusKey, centerEnd.selectedKey, "center selection is the actual DOM focus");
  assert.equal(centerEnd.spatialMode, false, "B uses the experiment's ordinary DOM focus styling");
  assert.ok(Math.abs(centerEnd.cardCenterX - centerEnd.anchorX) <= 1.5, "settled card center matches the stable visual anchor");
  assert.ok(Math.abs(centerEnd.scale - 1.04) < 0.001, "existing 1.04 card scale appears at the center");
  assert.ok(centerEnd.ringOpacity > 0.999, "existing focus ring reaches full opacity at the center");
  assert.ok(forwardKeys.every((value, index) => index === 0 || value > forwardKeys[index - 1]), "every right input advances to the next resource");
  assert.ok(centerTrace.every(frame => Math.abs(frame.anchorX - centerEnd.anchorX) < 0.1), "center anchor remains fixed during rail motion");
  for (let index = 1; index < centerTrace.length; index++) {
    assert.ok(centerTrace[index].scrollLeft + 0.1 >= centerTrace[index - 1].scrollLeft, "forward-only segment never reverses its rail position");
    assert.equal(centerTrace[index].focusVisuals.length, 0, "B does not run D2's spatial focus interpolator");
  }
  assert.ok(centerTrace.every(frame => frame.domFocusKey === frame.selectedKey), "ordinary focus presentation remains on the selected resource");
  report.phases.center = { end: centerEnd, forwardKeys, summary: summarize(centerTrace) };
  report.trace.center = centerTrace;

  await page.evaluate(() => testBrowse.beginTrace());
  await pressAndWait(page, "ArrowRight", 44);
  const beforeReverse = await page.evaluate(() => testBrowse.sample());
  await pressAndWait(page, "ArrowLeft", 90);
  await waitForScrollIdle(page);
  const reverseTrace = await page.evaluate(() => testBrowse.endTrace());
  await waitForFullCenterTreatment(page);
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
  for (const key of ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowLeft"]) await pressAndWait(page, key, 22);
  await waitForScrollIdle(page);
  const rapidTrace = await page.evaluate(() => testBrowse.endTrace());
  await waitForFullCenterTreatment(page);
  const rapidEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(rapidEnd.domFocusKey, rapidEnd.selectedKey, "rapid alternating input ends on the authoritative resource");
  assert.equal(rapidEnd.spatialMode, false, "rapid B motion keeps the experiment's ordinary DOM focus styling");
  assert.ok(Math.abs(rapidEnd.cardCenterX - rapidEnd.anchorX) <= 1.5, "rapid alternation settles at the same anchor");
  assert.ok(rapidTrace.every(frame => frame.focusVisuals.length === 0 && frame.domFocusKey === frame.selectedKey), "rapid movement keeps one semantic DOM focus without a second spatial visual system");
  report.phases.rapidAlternation = { end: rapidEnd, summary: summarize(rapidTrace) };
  report.trace.rapidAlternation = rapidTrace;

  await page.evaluate(() => testBrowse.beginTrace());
  const longForwardKeys = [];
  for (let index = 0; index < 8; index++) { await pressAndWait(page, "ArrowRight", 22); longForwardKeys.push((await page.evaluate(() => testBrowse.sample())).selectedIndex); }
  await waitForScrollIdle(page);
  const longForwardTrace = await page.evaluate(() => testBrowse.endTrace());
  const longForwardEnd = await page.evaluate(() => testBrowse.sample());
  assert.ok(longForwardKeys.every((value, index) => index === 0 || value > longForwardKeys[index - 1]), "long continuous right input preserves every selection");
  assert.equal(longForwardEnd.domFocusKey, longForwardEnd.selectedKey, "long movement ends on the latest selected resource");
  assert.ok(longForwardTrace.every(frame => frame.focusVisuals.length <= 4 && frame.domFocusKey === frame.selectedKey), "long movement keeps focus visual work bounded and semantic focus current");
  report.phases.longForward = { end: longForwardEnd, keys: longForwardKeys, summary: summarize(longForwardTrace) };
  report.trace.longForward = longForwardTrace;

  const tail = await page.evaluate(() => {
    const card = document.querySelector("#tvBrowseRail .tv-browse-rail-track > .card:last-child");
    focusRemoteTarget(card);
    return testBrowse.sample();
  });
  await waitForScrollIdle(page);
  const tailEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(tailEnd.selectedIndex, 17, "tail selection reaches the final card");
  assert.ok(Math.abs(tailEnd.scrollLeft - tailEnd.targetMetrics.max) <= 1.5, "rail stops at its natural maximum without overscroll");
  assert.ok(tailEnd.scale >= 1.035 && tailEnd.ringOpacity >= 0.9, "clamped tail keeps a strong, continuous focus treatment");
  assert.equal(tailEnd.domFocusKey, tailEnd.selectedKey, "tail DOM focus and selected resource agree");
  report.phases.tail = { initial: tail, end: tailEnd };

  const migration = await page.evaluate(() => {
    const rail = document.querySelector("#tvBrowseRail"), card = document.activeElement;
    const rect = () => { const r=card.getBoundingClientRect(); return {left:r.left,right:r.right,center:r.left+r.width/2}; };
    const before = { position:tvBrowseRailCurrentPosition(rail), rect:rect() };
    testBrowse.setMotionMode("baseline");
    const baseline = { mode:tvBrowseState().railScroll.motionMode, scrollLeft:rail.scrollLeft,
      transform:tvBrowseRailCards(rail).length ? document.querySelector("#tvBrowseRailTrack").style.transform : "missing", rect:rect() };
    testBrowse.setMotionMode("transform");
    const transform = { mode:tvBrowseState().railScroll.motionMode, logical:tvBrowseRailCurrentPosition(rail),
      scrollLeft:rail.scrollLeft, transform:document.querySelector("#tvBrowseRailTrack").style.transform, rect:rect(),
      controllers:tvBrowseState().railScroll.frame ? 1 : 0 };
    return { before, baseline, transform };
  });
  await waitForScrollIdle(page);
  assert.equal(migration.baseline.mode, "baseline", "the explicit rollback mode takes sole control");
  assert.equal(migration.baseline.transform, "", "baseline mode removes the B track transform");
  assert.ok(Math.abs(migration.baseline.scrollLeft-migration.before.position)<=1.5, "B logical position migrates to native position without a jump");
  assert.ok(Math.abs(migration.baseline.rect.center-migration.before.rect.center)<=1.5, "the card remains visually stationary during B to baseline migration");
  assert.equal(migration.transform.mode, "transform", "switching back restores the original B controller");
  assert.equal(migration.transform.scrollLeft, 0, "B resets physical scroll before accepting control");
  assert.ok(Math.abs(migration.transform.logical-migration.baseline.scrollLeft)<=1.5, "baseline position migrates back to B logical position");
  assert.ok(Math.abs(migration.transform.rect.center-migration.baseline.rect.center)<=1.5, "the reverse migration does not move the selected card on screen");
  assert.ok(migration.transform.controllers<=1, "mode migration never leaves concurrent rail controllers");
  report.phases.motionMigration = migration;

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
