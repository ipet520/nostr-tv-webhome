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
  tvBrowseRailTargetScrollLeft, tvBrowseScheduleRailAnchor, tvBrowseSetRailAnchor, tvBrowseRailCards,
  tvBrowseRailCurrentPosition, focusRemoteTarget, renderTvBrowse, syncBrowseDevicePresentation,
  bindActions, installRemoteKeys, tvBrowseBeginStartup, homeFocusUserEpoch, secondaryGetQuery, openDetail };
window.testBrowse.setup = () => { syncBrowseDevicePresentation(); bindActions(); installRemoteKeys(); };
window.testBrowse.seed = (count = 18) => {
  const query = secondaryGetQuery('movie'); query.loaded = true; query.loading = false;
  query.page = 1; query.hasMore = false; query.error = ''; query.retryableError = '';
  query.items = Array.from({length: count}, (_, index) => ({
    id: 71000 + index, tmdbId: 71000 + index, title: '轨迹影片' + index,
    mediaType: 'movie', source: 'tmdb', pic: '/poster-' + index + '.jpg', landscape: '/backdrop-' + index + '.jpg',
    releaseDate: '2025-01-01', overview: 'scrollLeft 居中锚定浏览轨迹测试', voteAverage: 8.1
  }));
  return query;
};
window.testBrowse.sample = () => {
  const rail = document.querySelector('#tvBrowseRail');
  const card = document.activeElement && document.activeElement.closest('#tvBrowseRail > .card');
  const position = tvBrowsePosition(), runtime = tvBrowseState().railScroll || {};
  if (!rail) return null;
  const railRect = rail.getBoundingClientRect(), style = getComputedStyle(rail), cardRect = card && card.getBoundingClientRect();
  const padLeft = Number(style.paddingLeft.replace('px', '')) || 0, padRight = Number(style.paddingRight.replace('px', '')) || 0;
  const anchorX = railRect.left + rail.clientLeft + padLeft + (rail.clientWidth - padLeft - padRight) / 2;
  const scaleOf = node => { const value = getComputedStyle(node).transform; if (value === 'none') return 1; const match = value.match(/^matrix\\(([^,]+)/) || value.match(/^matrix3d\\(([^,]+)/); return match ? Number(match[1]) : 1; };
  const ring = card && card.querySelector('.poster-wrap');
  return {
    scrollLeft: rail.scrollLeft, maxScroll: Math.max(0, rail.scrollWidth - rail.clientWidth),
    target: Number.isFinite(Number(runtime.target)) ? Number(runtime.target) : card ? tvBrowseRailTargetScrollLeft(card, rail) : rail.scrollLeft,
    frame: !!runtime.frame,
    anchorX, cardCenterX: cardRect ? cardRect.left + cardRect.width / 2 : null,
    domFocusKey: card && card.dataset.mediaKey || '', selectedKey: position.key || '',
    selectedIndex: Number(position.index || 0), mediaId: card && card.__mediaItem && card.__mediaItem.id || null,
    scale: card ? scaleOf(card) : 1,
    ringBorderWidth: ring ? getComputedStyle(ring, '::after').borderTopWidth : '0px',
    ringOpacity: ring ? Number(getComputedStyle(ring, '::after').opacity) : 0
  };
};
window.testBrowse.beginTrace = () => {
  window.railTrace = []; window.railTraceSampling = true;
  const sample = () => {
    if (!window.railTraceSampling) return;
    const value = testBrowse.sample(); if (value) window.railTrace.push(value);
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
};
window.testBrowse.endTrace = () => { window.railTraceSampling = false; return window.railTrace || []; };
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
const press = async (page, key, wait = 34) => { await page.keyboard.press(key); await page.waitForTimeout(wait); };
const scale = value => {
  const match = String(value).match(/^matrix\(([^,]+)/) || String(value).match(/^matrix3d\(([^,]+)/);
  return match ? Number(match[1]) : value === "none" ? 1 : NaN;
};

try {
  const page = await pageAt();
  const rail = page.locator("#tvBrowseRail");
  await rail.locator(":scope > .card").first().focus();
  await waitForScrollIdle(page);
  const first = await page.evaluate(() => testBrowse.sample());
  assert.equal(first.scrollLeft, 0, "first card stays at the natural left boundary");
  assert.equal(first.domFocusKey, first.selectedKey, "the initial focused card and Browse position agree");
  assert.ok(Math.abs(first.scale - 1.04) < 0.001, "focus scale is the original immediate 1.04 treatment");
  assert.equal(first.ringBorderWidth, "2px", "the original 2px white focus ring is present");
  assert.ok(first.ringOpacity > 0.99, "the focus ring appears immediately on the DOM-focused card");

  await page.evaluate(() => testBrowse.beginTrace());
  await page.keyboard.press("ArrowRight");
  const oneStep = await page.evaluate(() => testBrowse.sample());
  assert.equal(oneStep.selectedIndex, 1, "one DPAD input immediately selects the next card");
  assert.equal(oneStep.domFocusKey, oneStep.selectedKey, "DPAD focus and selected media stay aligned");
  assert.ok(Math.abs(oneStep.scale - 1.04) < 0.001 && oneStep.ringOpacity > 0.99, "focus visuals do not wait for rail motion completion");

  for (let index = 0; index < 7; index++) await press(page, "ArrowRight", 30);
  await waitForScrollIdle(page);
  const forwardTrace = await page.evaluate(() => testBrowse.endTrace());
  const centered = await page.evaluate(() => testBrowse.sample());
  assert.equal(centered.domFocusKey, centered.selectedKey, "center selection is the real DOM focus");
  assert.ok(Math.abs(centered.cardCenterX - centered.anchorX) <= 1.5, "middle cards settle on the rail center anchor");
  assert.ok(Math.abs(centered.scrollLeft - centered.target) <= 1.5, "physical scrollLeft settles on the latest centered target");
  assert.ok(forwardTrace.length > 2 && forwardTrace.some((sample, index) => index > 0 && sample.scrollLeft !== forwardTrace[index - 1].scrollLeft), "the scrollLeft rail moves through actual browser frames");
  assert.ok(forwardTrace.every(sample => sample.domFocusKey === sample.selectedKey), "focus identity remains current during scrolling");
  assert.ok(forwardTrace.every(sample => Math.abs(sample.anchorX - centered.anchorX) < 0.1), "the visual center anchor stays fixed during movement");

  const startReverse = await page.evaluate(() => testBrowse.sample());
  await page.evaluate(() => testBrowse.beginTrace());
  await press(page, "ArrowRight", 28);
  await press(page, "ArrowLeft", 80);
  await waitForScrollIdle(page);
  const reverseTrace = await page.evaluate(() => testBrowse.endTrace());
  const reversed = await page.evaluate(() => testBrowse.sample());
  assert.equal(reversed.selectedIndex, startReverse.selectedIndex, "a right move followed by a left move returns to the latest requested selection");
  assert.equal(reversed.domFocusKey, reversed.selectedKey, "reverse input leaves one authoritative DOM focus");
  assert.ok(Math.abs(reversed.scrollLeft - reversed.target) <= 1.5, "reverse motion settles on the latest target");
  assert.ok(reverseTrace.every(sample => sample.domFocusKey === sample.selectedKey), "reverse frames do not show stale focused resources");

  await page.evaluate(() => {
    const cards = testBrowse.tvBrowseRailCards(document.querySelector("#tvBrowseRail"));
    for (let index = 5; index <= 10; index++) testBrowse.focusRemoteTarget(cards[index]);
  });
  await waitForScrollIdle(page);
  const rapid = await page.evaluate(() => testBrowse.sample());
  assert.equal(rapid.selectedIndex, 10, "rapid target updates keep the latest card selection");
  assert.ok(Math.abs(rapid.cardCenterX - rapid.anchorX) <= 1.5, "the latest rapid target settles at the center");

  const tail = await page.evaluate(() => {
    const cards = testBrowse.tvBrowseRailCards(document.querySelector("#tvBrowseRail"));
    testBrowse.focusRemoteTarget(cards[cards.length - 1]);
    return testBrowse.sample();
  });
  await waitForScrollIdle(page);
  const tailEnd = await page.evaluate(() => testBrowse.sample());
  assert.equal(tailEnd.selectedIndex, 17, "tail selection reaches the last card");
  assert.ok(Math.abs(tailEnd.scrollLeft - tailEnd.maxScroll) <= 1.5, "the tail stops at the physical scroll maximum");
  assert.equal(tailEnd.domFocusKey, tailEnd.selectedKey, "tail focus matches the selected resource");
  assert.ok(Math.abs(tailEnd.scale - 1.04) < 0.001 && tailEnd.ringOpacity > 0.99, "tail focus retains the original 1.04 scale and ring");

  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#detailSheet")?.classList.contains("active"));
  const detail = await page.evaluate(() => ({ selectedId: state.selected && state.selected.id, position: tvBrowsePosition() }));
  assert.equal(detail.selectedId, 71017, "confirm opens the currently focused last resource");
  assert.deepEqual(pageErrors, [], "fixture has no page errors");
  console.log("TV_BROWSE_SCROLLLEFT_CENTER_ANCHOR_BROWSER = PASS");
  console.log("SCROLLLEFT_TRACE_COUNTS = " + JSON.stringify({forward: forwardTrace.length, reverse: reverseTrace.length}));
  await page.close();
} finally {
  await browser.close();
}
