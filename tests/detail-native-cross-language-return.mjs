import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = (name) => fs.readFileSync(new URL('../src/js/' + name, import.meta.url), 'utf8');
const store = new Map();
const rawHistory = (siteKey, title, options = {}) => ({
  key: `${siteKey}@@@${options.vodId || 'vod-7'}@@@7`,
  cid: 7,
  vodName: title,
  vodPic: '/poster.jpg',
  mediaType: options.mediaType || 'movie',
  tmdbId: options.tmdbId == null ? null : options.tmdbId,
  position: options.position == null ? 50_000 : options.position,
  duration: options.duration == null ? 500_000 : options.duration,
  createTime: options.createTime == null ? 1_000 : options.createTime,
  exactAllowed: options.exactAllowed !== false,
  episodeUrl: options.episodeUrl || 'https://source.example/episode-1',
  ...options
});
const referenceOf = (row) => ({
  version: 1,
  kind: 'ITEM',
  historyKey: row.key,
  cid: row.cid,
  siteKey: row.key.split('@@@')[0],
  vodId: row.key.split('@@@')[1],
  mediaType: row.mediaType,
  tmdbId: Number(row.tmdbId) || 0,
  seasonNumber: -1,
  updatedAt: row.createTime,
  scopeToken: `fixture-${row.createTime}`
});

const c = vm.createContext({
  console: { debug() {}, info() {} },
  URL,
  Math,
  Date,
  Set,
  Map,
  document: { activeElement: null },
  localStorage: {
    getItem(key) { return store.has(key) ? store.get(key) : null; },
    setItem(key, value) { store.set(key, String(value)); },
    removeItem(key) { store.delete(key); }
  },
  state: {
    selected: null,
    detailClosing: false,
    detailPlayback: null,
    detailPlayerReturn: null,
    detailEpisodeTarget: null,
    recent: { items: [], detailItems: [], loaded: true, error: '', loading: false, loadingPromise: null },
    historyContexts: { loaded: true, entries: [] },
    continueIndex: { loaded: true, entries: [] },
    watch: { item: null },
    pan: { playbackReturn: null, directReady: null, directFailure: null }
  },
  normalizeTitle: (value) => String(value || '').trim().toLowerCase(),
  resolvePanProviderForHistory: () => '',
  isTvDiagnosticEnabled: () => false,
  isExpiredPosterSource: () => false,
  normalizePanUrl: (value) => String(value || ''),
  recordHistoryCompatDiag() {},
  panSearchItemKey: (item) => `${item.mediaType}:${item.tmdbId}`,
  toast() {},
  $: () => null
});

for (const name of ['06-tmdb-history-model.js', '15a-history-recent-continue.js', '08b-native-history-delete.js', '07-detail-playback-race.js']) {
  vm.runInContext(source(name), c, { filename: name });
}
const handoffSource = source('19-pan-results-handoff-return.js');
function install(startMarker, endMarker) {
  const start = handoffSource.indexOf(startMarker);
  const end = handoffSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start, `extractable production block ${startMarker}`);
  vm.runInContext(handoffSource.slice(start, end).trim(), c, { filename: '19-pan-results-handoff-return.js' });
}
install('    function nativeSearchReturnMarkerFor() {', '\n    async function nativeSearch');
install('    function retireDetailPreparedPlaybackAfterNativeSearch(item, marker, reason) {', '\n    // 滚动恢复：closeDetail(needBack)');
install('    async function nativeSearch(title) {', '\n    async function openLiveHome');

function putHistory(...rows) {
  const loaded = c.normalizeRecentWatchingItems(rows.map((row) => ({
    ...row,
    historyRecordRef: referenceOf(row),
    canPlayExact: row.exactAllowed,
    canResume: row.position > 0 && row.duration > 0,
    canDelete: true,
    sourceLabel: row.key.split('@@@')[0]
  })));
  c.state.recent.items = loaded;
  c.state.recent.detailItems = loaded;
  c.state.recent.error = '';
  return loaded;
}

function makeItem(tmdbId = '42') {
  return {
    id: `tmdb:movie:${tmdbId}`,
    source: 'tmdb',
    tmdbId,
    mediaType: 'movie',
    title: 'The English Title',
    originalTitle: 'The English Title',
    resourceSearchTitle: '可信中文名',
    aliases: ['The English Title', '可信中文名']
  };
}

function setupDetail(item, run = null) {
  const classes = { toggle() {}, remove() {} };
  const button = {
    style: {},
    dataset: {},
    classList: classes,
    closest: () => ({ classList: classes }),
    setAttribute() {}
  };
  const continueText = { textContent: '' };
  const searchText = { textContent: '' };
  const detailSheet = { classList: { contains: (name) => name === 'active' } };
  c.$ = (id) => ({ detailSheet, detailContinueBtn: button, detailContinueText: continueText, detailSearchText: searchText })[id] || null;
  c.state.selected = item;
  c.state.detailClosing = false;
  c.state.detailPlayback = run;
  c.state.detailPlayerReturn = null;
  c.state.detailEpisodeTarget = null;
  c.state.pan.directReady = run ? { itemKey: c.panSearchItemKey(item), candidate: run.candidate } : null;
  c.state.pan.directFailure = null;
  c.detailPlaybackIsCurrent = (candidate) => candidate === c.state.detailPlayback && !candidate.cancelled;
  c.clearDirectPlayStatus = () => {};
  c.cancelDetailPlaybackPreparation = () => { c.state.detailPlayback = null; };
  c.detailDirectPlayReadyFor = () => false;
  c.detailContinuePlayStateFor = (candidate) => c.detailReturnedNativeHistoryFor(candidate) ? 'ready' : 'idle';
  return { button, continueText, searchText, detailSheet };
}

function resetSearchMarker() {
  store.delete('fm_detail_native_search_return');
  c.state.detailPlayerReturn = null;
}

// The old production path failed before it could establish a return marker:
// a visible, exact, progressed Chinese History row had no English-title match.
{
  const item = makeItem();
  putHistory(rawHistory('site-a', '可信中文名'));
  const history = c.state.recent.detailItems[0];
  assert.equal(c.state.recent.items[0].title, '可信中文名', 'the HTML Recent list has already normalized and displayed the Chinese History row');
  assert.equal(history.historyCanPlayExact, true);
  assert.equal(c.detailHasAuthoritativeNativeHistory(history), true);
  assert.equal(Array.from(c.detailHistoryTitleCandidates(item)).includes('可信中文名'), false);
  assert.equal(c.detailHistoryMatches(item, history), false);
  assert.equal(c.recentNativeHistoryWinnerFor(item), null);
  console.log('baseline cross-language matcher gap = REPRODUCED');
}

async function runNativeSearchReturn(item, searchTitle, beforeRows, afterRows, run = null) {
  resetSearchMarker();
  putHistory(...beforeRows);
  const ui = setupDetail(item, run);
  const searchCalls = [];
  c.rememberDetailReturn = () => {};
  c.toast = () => {};
  c.sdk = () => ({ search: async (...args) => { searchCalls.push(args); } });
  await c.nativeSearch(searchTitle);
  assert.deepEqual(JSON.parse(JSON.stringify(searchCalls)), [[searchTitle, { direct: true }]], 'Native Search receives the same trusted title saved on its return marker');
  const marker = JSON.parse(store.get('fm_detail_native_search_return'));
  assert.equal(marker.searchTitle, searchTitle);
  putHistory(...afterRows);
  const reconciled = c.reconcileDetailAfterNativeReturn(item, 'native-search');
  return { ...ui, reconciled, marker };
}

{
  const item = makeItem();
  const { continueText, button, reconciled, marker } = await runNativeSearchReturn(
    item,
    '可信中文名',
    [],
    [rawHistory('push_agent', '可信中文名', { position: 90_000, createTime: 2_000 })]
  );
  assert.equal(marker.historySnapshot, null, 'no pre-search row was captured');
  assert.equal(reconciled, true, 'new exact Native History is linked to the originating English detail');
  assert.equal(c.state.recent.detailItems[0].historyReplayKind, 'PAN_NATIVE', 'the regression exercises the strict non-VOD title path');
  assert.equal(c.state.detailPlayerReturn.nativeHistoryKey, 'push_agent@@@vod-7@@@7');
  assert.equal(c.state.detailPlayerReturn.nativeSearchTitle, '可信中文名');
  assert.equal(c.detailReturnedNativeHistoryFor(item).title, '可信中文名');
  assert.equal(continueText.textContent, '续播');
  assert.equal(button.dataset.mode, 'CONTINUE');
  assert.equal(button.dataset.playState, 'ready');
  const playbackSource = source('07-detail-playback-race.js');
  const begin = playbackSource.indexOf('    async function requestDetailPlayback(item) {');
  const finish = playbackSource.indexOf('\n    function handleDetailPrimaryAction()', begin);
  assert.ok(begin >= 0 && finish > begin, 'production primary-action request is extractable');
  const requestPlayback = vm.runInContext(`(${playbackSource.slice(begin, finish).trim()})`, c);
  const exactCalls = [];
  c.playNativeHistoryExact = async (record) => { exactCalls.push(record); return true; };
  assert.equal(await requestPlayback(item), true);
  assert.equal(exactCalls.length, 1);
  assert.equal(exactCalls[0].nativeHistoryKey, 'push_agent@@@vod-7@@@7');
  assert.equal(exactCalls[0].historyRecordRef.historyKey, 'push_agent@@@vod-7@@@7', 'the button action uses the exact Native reference that matched the detail');
  console.log('English detail + Chinese Native Search + exact Chinese History = PASS');
}

{
  const item = { ...makeItem(), title: 'A Same Language Film', originalTitle: 'A Same Language Film', resourceSearchTitle: 'A Same Language Film', aliases: ['A Same Language Film'] };
  const { continueText, reconciled } = await runNativeSearchReturn(
    item,
    'A Same Language Film',
    [],
    [rawHistory('site-a', 'A Same Language Film', { position: 40_000, createTime: 3_000 })]
  );
  assert.equal(reconciled, true);
  assert.equal(c.detailHistoryMatches(item, c.state.recent.detailItems[0]), true, 'the original same-language identity path stays valid');
  assert.equal(continueText.textContent, '续播');
  console.log('same-language Native History = PASS');
}

{
  const item = makeItem('42');
  const conflicting = rawHistory('site-b', '可信中文名', { tmdbId: '99', position: 100_000, createTime: 4_000 });
  const run = { item, itemKey: c.panSearchItemKey(item), token: 88, phase: 'READY', candidate: { url: 'https://prepared.example/play' }, playRequested: false };
  const { continueText, reconciled } = await runNativeSearchReturn(item, '可信中文名', [], [conflicting], run);
  assert.equal(c.detailHistoryMatches(item, c.state.recent.detailItems[0], {
    nativeSearchTitle: '可信中文名', nativeSearchItemKey: c.panSearchItemKey(item)
  }), false, 'a different TMDB identity cannot pass the exact title fallback');
  assert.equal(c.detailHistoryMatches(makeItem('99'), c.state.recent.detailItems[0], {
    nativeSearchTitle: '可信中文名', nativeSearchItemKey: c.panSearchItemKey(makeItem('99'))
  }), true, 'the shared title remains usable for the matching TMDB identity');
  assert.equal(reconciled, false);
  assert.equal(c.state.detailPlayerReturn, null);
  assert.equal(c.state.detailPlayback, run);
  assert.equal(run.candidate.url, 'https://prepared.example/play', 'a rejected History identity cannot retire the prepared candidate');
  assert.equal(c.state.pan.directReady.candidate.url, 'https://prepared.example/play');
  assert.equal(continueText.textContent, '播放');
  console.log('same Chinese alias with conflicting TMDB identity; prepared candidate preserved = PASS');
}

{
  const item = makeItem();
  const old = rawHistory('site-a', '可信中文名', { position: 90_000, createTime: 5_000 });
  const { continueText, reconciled, marker } = await runNativeSearchReturn(item, '可信中文名', [old], [old]);
  assert.ok(marker.historySnapshot, 'the exact pre-search History candidate is snapshotted');
  assert.equal(reconciled, false, 'opening and cancelling Native Search without a History change is not a playback return');
  assert.equal(c.state.detailPlayerReturn, null);
  assert.equal(continueText.textContent, '播放');
  console.log('Native Search without actual playback = PASS');
}

{
  const item = makeItem();
  resetSearchMarker();
  putHistory();
  const { continueText } = setupDetail(item);
  c.rememberDetailReturn = () => {};
  c.toast = () => {};
  c.sdk = () => ({ search: async () => {} });
  await c.nativeSearch('可信中文名');
  assert.equal(c.reconcileDetailAfterNativeReturn(item, 'native-search'), false,
    'the first History read can complete before Native commits the played item');
  assert.equal(c.state.detailPlayerReturn, null);
  assert.ok(store.has('fm_detail_native_search_return'), 'the in-flight search marker remains for a delayed History commit');
  putHistory(rawHistory('push_agent', '可信中文名', { position: 95_000, createTime: 5_075 }));
  assert.equal(c.reconcileDetailAfterNativeReturn(item, 'native-search'), true,
    'a later exact Native History refresh completes the same return transaction');
  assert.equal(c.detailReturnedNativeHistoryFor(item).nativeHistoryKey, 'push_agent@@@vod-7@@@7');
  assert.equal(continueText.textContent, '续播');
  console.log('delayed Chinese Native History commit reconciles on the same detail = PASS');
}

{
  const item = makeItem();
  const old = rawHistory('site-a', '可信中文名', { position: 90_000, createTime: 5_100 });
  const timestampOnlyUpdate = { ...old, createTime: 5_200 };
  const { continueText, reconciled } = await runNativeSearchReturn(item, '可信中文名', [old], [timestampOnlyUpdate]);
  assert.equal(reconciled, false, 'a timestamp-only Native History touch does not prove playback');
  assert.equal(c.state.detailPlayerReturn, null);
  assert.equal(continueText.textContent, '播放');
  console.log('timestamp-only History update cannot manufacture a Search return = PASS');
}

{
  const item = makeItem();
  const old = rawHistory('site-a', '可信中文名', { position: 120_000, createTime: 5_250 });
  resetSearchMarker();
  putHistory(old);
  c.state.recent.loaded = false;
  setupDetail(item);
  let refreshCount = 0;
  c.shouldRefreshRecentList = () => true;
  c.nativeHistoryRefreshPending = () => false;
  c.loadRecentList = async (options) => {
    refreshCount++;
    assert.deepEqual(JSON.parse(JSON.stringify(options)), { refresh: true, silent: true, reconcileDetail: false });
    c.state.recent.loaded = true;
    c.state.recent.error = '';
  };
  c.rememberDetailReturn = () => {};
  c.toast = () => {};
  c.sdk = () => ({ search: async () => {} });
  await c.nativeSearch('可信中文名');
  const marker = JSON.parse(store.get('fm_detail_native_search_return'));
  assert.equal(refreshCount, 1, 'stale Native History is refreshed before Search starts');
  assert.equal(marker.historyBaselineReady, true);
  assert.equal(marker.historySnapshot.nativeHistoryKey, old.key);
  putHistory(old);
  assert.equal(c.reconcileDetailAfterNativeReturn(item, 'native-search'), false,
    'the refreshed old row cannot masquerade as a new Search playback');
  assert.equal(c.state.detailPlayerReturn, null);
  delete c.shouldRefreshRecentList;
  delete c.nativeHistoryRefreshPending;
  delete c.loadRecentList;
  console.log('stale Native History is refreshed before capturing the search baseline = PASS');
}

{
  const item = makeItem();
  resetSearchMarker();
  putHistory();
  c.state.recent.loaded = false;
  setupDetail(item);
  c.rememberDetailReturn = () => {};
  c.toast = () => {};
  c.sdk = () => ({ search: async () => {} });
  await c.nativeSearch('可信中文名');
  const marker = JSON.parse(store.get('fm_detail_native_search_return'));
  assert.equal(marker.historyBaselineReady, false);
  putHistory(rawHistory('site-a', '可信中文名', { position: 90_000, createTime: 5_500 }));
  c.state.recent.loaded = true;
  assert.equal(c.reconcileDetailAfterNativeReturn(item, 'native-search'), false,
    'without a pre-search Native History baseline, a first post-return read cannot prove the row is new');
  assert.equal(c.state.detailPlayerReturn, null);
  console.log('unloaded pre-search History cannot make an old row look new = PASS');
}

{
  const item = makeItem();
  const notExact = rawHistory('site-a', '可信中文名', { exactAllowed: false, position: 75_000, createTime: 6_000 });
  const { continueText, reconciled } = await runNativeSearchReturn(item, '可信中文名', [], [notExact]);
  assert.equal(reconciled, false, 'a visible progressed row without exact restore capability cannot be linked');
  assert.equal(c.state.detailPlayerReturn, null);
  assert.equal(continueText.textContent, '播放');
  console.log('Native History without history_exact capability = PASS');
}

{
  const item = makeItem();
  const { reconciled } = await runNativeSearchReturn(
    item,
    '可信中文名',
    [],
    [rawHistory('site-a', '可信中文名', { position: 110_000, createTime: 7_000 })]
  );
  assert.equal(reconciled, true);
  const snapshotSource = source('22-snapshot-resume-boot.js');
  const extractFunction = (text, start, end) => {
    const begin = text.indexOf(start);
    const finish = text.indexOf(end, begin + start.length);
    assert.ok(begin >= 0 && finish > begin, `extractable production function ${start}`);
    return text.slice(begin, finish).trim();
  };
  const buildSnapshot = vm.runInContext(`(${extractFunction(snapshotSource, '    function buildUiSnapshot() {', '\n    function scheduleUiSnapshotSave')})`, c);
  const restoreSnapshot = vm.runInContext(`(${extractFunction(snapshotSource, '    async function restoreUiSnapshot(snapshot) {', '\n    // 从 Emby/vod 播放器返回后恢复详情页。')})`, c);
  c.isSidebarOpen = () => false;
  c.isTvLikeDevice = () => false;
  c.uiSnapshotRoute = () => 'detail';
  c.homeUiRoute = () => 'home';
  c.homeRailScrollSnapshot = () => ({});
  c.homeFocusSnapshot = () => null;
  c.currentSearchKeyword = () => '';
  c.compactPanResults = () => [];
  c.location = { hash: '#detail', search: '', pathname: '/' };
  c.window = { scrollY: 0, scrollTo() {} };
  c.document.documentElement = { scrollTop: 0 };
  c.document.body = { scrollTop: 0 };
  c.state.homeV14 = { route: 'home' };
  c.state.searchItems = [];
  c.state.activeList = 'all';
  c.state.pan.results = [];
  c.state.pan.health = {};
  c.state.pan.keyword = '';
  c.state.pan.activeType = '';
  c.state.pan.focusKey = '';
  c.state.pan.focusMode = '';
  c.state.pan.playbackReturn = null;
  c.$ = (id) => ({ detailSheet: { scrollTop: 13 }, panResultList: null, connectionDock: null, searchRail: null, panSearchBlock: null })[id] || null;
  c.history = { replaceState() {} };
  c.normalizeLegacySavedState = (value) => value;
  c.normalizeLegacyCategoryId = (value) => value;
  c.normalizeHomePresentationRoute = () => 'home';
  c.isLegacyHomePresentationRoute = () => false;
  c.normalizeActiveListForViewport = () => {};
  c.restoreSearchSnapshot = () => {};
  c.homeFocusUserEpoch = () => 0;
  c.renderAll = () => {};
  c.tvBrowseActive = () => false;
  c.requestAnimationFrame = (callback) => callback();
  c.openDetail = (selected, options) => {
    c.state.selected = selected;
    c.state.detailPlayerReturn = options.detailPlayerReturn;
  };
  c.restorePanSnapshot = () => {};
  c.normalizePlaybackTarget = () => null;
  const snapshot = buildSnapshot();
  assert.equal(snapshot.selected.resourceSearchTitle, '可信中文名');
  assert.equal(snapshot.detailPlayerReturn.nativeSearchTitle, '可信中文名');
  c.state.selected = null;
  c.state.detailPlayerReturn = null;
  assert.equal(await restoreSnapshot(snapshot), true);
  assert.equal(c.state.selected.tmdbId, '42');
  assert.equal(c.state.detailPlayerReturn.nativeHistoryKey, 'site-a@@@vod-7@@@7');
  assert.equal(c.detailReturnedNativeHistoryFor(c.state.selected).title, '可信中文名');
  console.log('WebView UI snapshot restore preserves scoped cross-language Native History = PASS');
}
