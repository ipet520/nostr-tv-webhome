    function normalizeLegacyCategoryId(id) {
      const value = String(id || "").trim();
      return LEGACY_CATEGORY_MIGRATION[value] || value;
    }

    function normalizeHomePresentationRoute(route) {
      const value = String(route || "").trim().toLowerCase();
      return HOME_PRESENTATION_ROUTES.includes(value) ? value : "home";
    }

    function isLegacyHomePresentationRoute(route) {
      const value = String(route || "").trim().toLowerCase();
      return LEGACY_HOME_PRESENTATION_ROUTES.includes(value) || (!!value && !HOME_PRESENTATION_ROUTES.includes(value));
    }

    function migrateLegacyHomeState() {
      const home = state.homeV14;
      if (!home) return;
      // The presentation route is intentionally smaller than the category
      // business IDs. Older snapshots may still contain removed
      // category-shaped Home routes; reopen those snapshots at Home instead
      // of reviving a parallel presentation path.
      const rawRoute = String(home.route || "").trim().toLowerCase();
      if (isLegacyHomePresentationRoute(rawRoute)) state.activeList = "all";
      home.route = normalizeHomePresentationRoute(rawRoute);
      state.activeList = normalizeLegacyCategoryId(state.activeList);
      home.secondaryListId = normalizeLegacyCategoryId(home.secondaryListId);
      const filters = home.secondaryFilters && typeof home.secondaryFilters === "object" ? home.secondaryFilters : {};
      Object.entries(LEGACY_CATEGORY_MIGRATION).forEach(([legacyId, nextId]) => {
        const legacy = filters[legacyId];
        if (!legacy) return;
        if (!filters[nextId]) filters[nextId] = Object.assign({}, legacy, { lastFocused: Object.assign({}, legacy.lastFocused || {}) });
        if (legacyId === "cn-tv" && filters[nextId].region === "all") {
          filters[nextId].region = "CN";
          filters[nextId].lastFocused.region = "CN";
        }
        delete filters[legacyId];
      });
      home.secondaryFilters = filters;
      if (home.secondaryQueries && typeof home.secondaryQueries === "object") {
        Object.keys(home.secondaryQueries).forEach((key) => {
          try {
            const parsed = JSON.parse(key);
            if (Array.isArray(parsed) && LEGACY_CATEGORY_MIGRATION[parsed[0]]) delete home.secondaryQueries[key];
          } catch (e) {}
        });
      }
    }

    function normalizeLegacySavedState(saved) {
      if (!saved || typeof saved !== "object") return saved;
      return Object.assign({}, saved, {
        activeList: normalizeLegacyCategoryId(saved.activeList),
        secondaryListId: normalizeLegacyCategoryId(saved.secondaryListId),
        originSection: normalizeLegacyCategoryId(saved.originSection),
        route: normalizeHomePresentationRoute(saved.route)
      });
    }

    function getList(id) {
      return visibleTmdbLists().find((list) => list.id === normalizeLegacyCategoryId(id));
    }

    function visibleTmdbLists() {
      return (window.WEBHOME_CONFIG.tmdb.lists || []).filter((list) => {
        if (list.hidden || list.mobileHidden && isPhoneViewport()) return false;
        return true;
      });
    }

    function isPhoneViewport() {
      const width = Math.min(window.innerWidth || 0, document.documentElement.clientWidth || 0) || window.innerWidth || 0;
      const height = Math.min(window.innerHeight || 0, document.documentElement.clientHeight || 0) || window.innerHeight || 0;
      const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;
      return width > 0 && width < 720 && (coarse || height > width);
    }

    function isBrowserPhoneClient() {
      const width = Math.min(window.innerWidth || 0, document.documentElement.clientWidth || 0) || window.innerWidth || 0;
      const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;
      const ua = String(navigator.userAgent || "");
      const mobileUa = /Android|iPhone|iPod|Mobile/i.test(ua);
      return width > 0 && width < 720 && (coarse || mobileUa);
    }

    function useLargeDetailLayout() {
      if (isTvPreviewMode() && state.deviceMode === "browser") return true;
      if (state.deviceMode === "mobile" || isNativeMobileClient()) return false;
      if (state.deviceMode === "leanback" || isNativeLeanbackClient()) return true;
      return !isBrowserPhoneClient();
    }

    function syncLegacyDetailLayout(sheet, large) {
      const root = document.documentElement;
      if (!root || !sheet) return;
      if (!large) {
        root.classList.remove("legacy-detail-layout");
        return;
      }
      requestAnimationFrame(() => {
        try {
          const style = window.getComputedStyle ? getComputedStyle(sheet) : null;
          const left = style ? parseFloat(style.paddingLeft) || 0 : 0;
          const top = style ? parseFloat(style.paddingTop) || 0 : 0;
          root.classList.toggle("legacy-detail-layout", left < 32 || top < 32);
        } catch (e) {
          root.classList.add("legacy-detail-layout");
        }
      });
    }

    function syncDetailLayout() {
      const sheet = $("detailSheet");
      if (!sheet) return false;
      const before = sheet.classList.contains("detail-large");
      const large = useLargeDetailLayout();
      sheet.classList.toggle("detail-large", large);
      // 平板横屏/大屏大布局时，detail-large 自带 ::before 背景图，
      // 隐藏独立的 hero-bg / blur-layer，避免与 detail-cover 叠加出现双海报
      document.body.classList.toggle("detail-large-active", large && !isTvLikeDevice());
      syncDetailBackFocusability(large);
      syncLegacyDetailLayout(sheet, large);
      return before !== large;
    }

    function syncDetailBackFocusability(large) {
      const close = $("closeDetailBtn");
      if (close) close.tabIndex = large ? -1 : 0;
    }

    function isKnownList(id) {
      return id === "all" || id === "recent" || id === "live" || id === "recommendation" || !!getList(id);
    }

    function normalizeActiveListForViewport() {
      migrateLegacyHomeState();
      if (state.activeList === "all" || state.activeList === "live" || state.activeList === "recent") return;
      if (!isKnownList(state.activeList)) state.activeList = "now-playing";
    }

    function hasPoster(item) {
      return !!(item && item.pic);
    }

    function ensureSearchPageOrder() {
      const page = $("searchPage");
      const formHost = $("searchPageFormHost");
      const resultsHost = $("searchPageResultsHost");
      const form = $("searchForm");
      const section = $("searchSection");
      if (resultsHost && section && section.parentElement !== resultsHost) resultsHost.appendChild(section);
      if (page && formHost && form && homeUiRoute() === "search" && form.parentElement !== formHost) formHost.appendChild(form);
      return !!(page && resultsHost && section);
    }

    const SEARCH_HISTORY_STORAGE_KEY = "fish2018_home_v1_search_history";
    const SEARCH_HISTORY_MAX = 10;

    function normalizeSearchHistoryEntries(list) {
      const entries = [];
      const seen = new Set();
      (Array.isArray(list) ? list : []).forEach((entry, index) => {
        const query = String(entry && entry.query || "").trim();
        if (!query || seen.has(query)) return;
        const updatedAtValue = Number(entry && entry.updatedAt);
        entries.push({
          query,
          updatedAt: Number.isFinite(updatedAtValue) && updatedAtValue > 0 ? updatedAtValue : 0,
          order: index
        });
        seen.add(query);
      });
      entries.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0) || a.order - b.order);
      return entries.slice(0, SEARCH_HISTORY_MAX).map(({ query, updatedAt }) => ({ query, updatedAt }));
    }

    function loadSearchHistory() {
      let parsed = [];
      try {
        const raw = window.localStorage && window.localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
        const value = raw ? JSON.parse(raw) : [];
        if (Array.isArray(value)) parsed = value;
      } catch (e) {
        parsed = [];
      }
      return normalizeSearchHistoryEntries(parsed);
    }

    function saveSearchHistory(items) {
      const safe = normalizeSearchHistoryEntries(items);
      try {
        if (window.localStorage) window.localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(safe));
      } catch (e) {}
      return safe;
    }

    function recordSearchHistory(query) {
      const normalized = String(query || "").trim();
      if (!normalized) return loadSearchHistory();
      const next = loadSearchHistory().filter((entry) => entry.query !== normalized);
      next.unshift({ query: normalized, updatedAt: Date.now() });
      const saved = saveSearchHistory(next);
      if (homeUiRoute() === "search") renderSearchHistory();
      return saved;
    }

    function clearSearchHistory() {
      try {
        if (window.localStorage) window.localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
      } catch (e) {}
      if (homeUiRoute() === "search") renderSearchHistory();
      const input = $("searchInput");
      const target = isVisibleFocusable(input) ? input : firstSearchHotFocusTarget();
      if (target) {
        const focus = () => focusRemoteTarget(target);
        if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
        else focus();
      }
      return true;
    }

    function activateSearchHistoryItem(query) {
      const input = $("searchInput");
      const normalized = String(query || "").trim();
      if (!input || !normalized) return false;
      input.value = normalized;
      enableSearchEditing();
      hideSearchSuggest();
      recordSearchHistory(normalized);
      focusRemoteTarget(input);
      searchTmdb(normalized, { source: "history" });
      return true;
    }

    function renderSearchHistory() {
      const section = $("searchHistorySection");
      const rail = $("searchHistoryRail");
      if (!section || !rail) return;
      const items = loadSearchHistory();
      const hasHistory = homeUiRoute() === "search" && items.length > 0;
      const show = hasHistory && !currentSearchKeyword();
      const clear = $("searchHistoryClear");
      if (clear) {
        clear.hidden = !hasHistory;
        clear.tabIndex = hasHistory ? 0 : -1;
        clear.setAttribute("aria-hidden", hasHistory ? "false" : "true");
      }
      section.hidden = !show;
      section.setAttribute("aria-hidden", show ? "false" : "true");
      rail.dataset.historyCount = String(show ? items.length : 0);
      rail.replaceChildren();
      if (!show) return;
      items.forEach((entry, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-history-item focusable";
        button.dataset.searchHistoryQuery = entry.query;
        button.dataset.cardIndex = String(index);
        button.textContent = entry.query;
        button.title = entry.query;
        button.addEventListener("click", () => activateSearchHistoryItem(entry.query));
        rail.appendChild(button);
      });
    }

    const SEARCH_LIVE_DEBOUNCE_MS = 350;

    function searchLiveState() {
      if (!state.searchLive) {
        state.searchLive = {
          timer: 0,
          composing: false,
          keyword: "",
          inputVersion: 0,
          requestSeq: 0,
          activeKeyword: "",
          activeVersion: 0,
          lastRequestedKeyword: "",
          lastRequestedVersion: 0,
          lastCompletedKeyword: "",
          lastCompletedVersion: 0,
          resultKeyword: "",
          loading: false,
          requestInFlight: false,
          error: false
        };
      }
      return state.searchLive;
    }

    function syncSearchLiveKeyword(keyword) {
      const live = searchLiveState();
      const kw = String(keyword || "").trim();
      if (live.keyword !== kw) {
        live.keyword = kw;
        live.inputVersion = Number(live.inputVersion || 0) + 1;
        live.error = false;
        live.resultKeyword = "";
      }
      return { keyword: kw, version: Number(live.inputVersion || 0) };
    }

    function resetSearchLiveForEmpty() {
      const live = searchLiveState();
      if (live.timer) clearTimeout(live.timer);
      live.timer = 0;
      live.requestSeq = Number(live.requestSeq || 0) + 1;
      if (live.keyword) live.inputVersion = Number(live.inputVersion || 0) + 1;
      live.keyword = "";
      live.activeKeyword = "";
      live.activeVersion = Number(live.inputVersion || 0);
      live.loading = false;
      live.requestInFlight = false;
      live.resultKeyword = "";
      live.error = false;
      state.searchSubmittedKeyword = "";
      state.searchItems = [];
    }

    function prepareSearchLiveKeyword(keyword) {
      const live = searchLiveState();
      const synced = syncSearchLiveKeyword(keyword);
      if (!synced.keyword) {
        resetSearchLiveForEmpty();
        return synced;
      }
      if (live.activeKeyword !== synced.keyword || Number(live.activeVersion || 0) !== synced.version) {
        live.activeKeyword = synced.keyword;
        live.activeVersion = synced.version;
        live.loading = true;
        live.requestInFlight = false;
        live.error = false;
        live.resultKeyword = "";
        state.searchSubmittedKeyword = synced.keyword;
        // Do not leave a previous query visible while a new keyword is being
        // resolved.  The loading state keeps Search in Search mode instead of
        // briefly flashing the Hot rail.
        state.searchItems = [];
        if (homeUiRoute() === "search") renderSearch();
      }
      return synced;
    }

    function scheduleLiveSearch() {
      const input = $("searchInput");
      const live = searchLiveState();
      if (!input) return;
      const synced = syncSearchLiveKeyword(input.value);
      if (live.composing) return;
      if (!synced.keyword) {
        resetSearchLiveForEmpty();
        if (homeUiRoute() === "search") renderSearch();
        scheduleUiSnapshotSave();
        return;
      }
      prepareSearchLiveKeyword(synced.keyword);
      if (live.timer) clearTimeout(live.timer);
      live.timer = setTimeout(() => {
        live.timer = 0;
        if (live.composing || currentSearchKeyword() !== synced.keyword || Number(live.inputVersion || 0) !== synced.version) return;
        searchTmdb(synced.keyword, { source: "live", version: synced.version });
      }, SEARCH_LIVE_DEBOUNCE_MS);
    }

    function handleSearchInputChanged() {
      scheduleSearchSuggest();
      scheduleLiveSearch();
    }

    function beginSearchComposition() {
      const live = searchLiveState();
      live.composing = true;
      if (live.timer) clearTimeout(live.timer);
      live.timer = 0;
    }

    function endSearchComposition() {
      const live = searchLiveState();
      live.composing = false;
      scheduleLiveSearch();
    }

    const SEARCH_HOT_ENDPOINT = "https://search.video.iqiyi.com/m";
    const SEARCH_HOT_LIMIT = 10;
    const SEARCH_HOT_TTL_MS = 10 * 60 * 1000;
    const SEARCH_HOT_CALLBACK = "webhomeSearchHot";

    function searchHotState() {
      if (!state.searchHot || typeof state.searchHot !== "object") {
        state.searchHot = {
          items: [],
          loading: false,
          loaded: false,
          error: "",
          fetchedAt: 0,
          lastAttemptAt: 0,
          requestSeq: 0
        };
      }
      return state.searchHot;
    }

    function searchHotUrl() {
      const url = new URL(SEARCH_HOT_ENDPOINT);
      url.searchParams.set("if", "defaultQuery");
      url.searchParams.set("is_qipu_platform", "1");
      url.searchParams.set("platform", "14");
      url.searchParams.set("pu", "");
      url.searchParams.set("response_type", "2");
      url.searchParams.set("u", "");
      url.searchParams.set("callback", SEARCH_HOT_CALLBACK);
      return url.toString();
    }

    function parseSearchHotResponse(body) {
      if (body && typeof body === "object") return body;
      const text = String(body || "").replace(/^\uFEFF/, "").trim();
      if (!text) throw new Error("empty search hot response");
      try {
        return JSON.parse(text);
      } catch (e) {}
      const open = text.indexOf("(");
      if (open < 0) throw new Error("invalid search hot response");
      let depth = 0;
      let quote = "";
      let escaped = false;
      let close = -1;
      for (let index = open; index < text.length; index += 1) {
        const char = text[index];
        if (quote) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === quote) quote = "";
          continue;
        }
        if (char === '"' || char === "'") {
          quote = char;
          continue;
        }
        if (char === "(") depth += 1;
        else if (char === ")") {
          depth -= 1;
          if (depth === 0) {
            close = index;
            break;
          }
        }
      }
      if (close < 0) throw new Error("invalid search hot jsonp response");
      const suffix = text.slice(close + 1).trim();
      if (suffix && !/^(?:;|;?}\s*catch\s*\([^)]*\)\s*\{\s*\})$/.test(suffix)) throw new Error("invalid search hot jsonp suffix");
      return JSON.parse(text.slice(open + 1, close).trim());
    }

    function searchHotRawItems(body) {
      if (Array.isArray(body)) return body;
      if (!body || typeof body !== "object") return [];
      if (Array.isArray(body.data)) return body.data;
      if (body.data && Array.isArray(body.data.data)) return body.data.data;
      if (body.data && Array.isArray(body.data.list)) return body.data.list;
      if (Array.isArray(body.result)) return body.result;
      if (Array.isArray(body.list)) return body.list;
      return [];
    }

    function normalizeSearchHotItems(body) {
      const seen = new Set();
      const normalized = [];
      searchHotRawItems(body).forEach((item, index) => {
        const query = String(item && item.query || "").trim();
        if (!query || seen.has(query)) return;
        const order = Number(item && item.order);
        const image = String(item && item.show_image_url || "").trim().replace(/^http:\/\//i, "https://");
        const labelObject = item && item.query_label;
        const label = String(labelObject && labelObject.label_text || "").trim();
        const heat = item && item.search_mark != null ? String(item.search_mark).trim() : "";
        normalized.push({
          query,
          rank: Number.isFinite(order) && order > 0 ? order : index + 1,
          image,
          meta: String(item && item.tag_content || "").trim(),
          label,
          heat
        });
        seen.add(query);
      });
      return normalized.slice(0, SEARCH_HOT_LIMIT);
    }

    async function requestSearchHotText(url, timeout) {
      const response = await sdk().req(url, { responseType: "text", timeout: timeout || 18 });
      if (response && response.error) throw new Error(String(response.error));
      if (response && response.ok === false || response && Number(response.status || 0) >= 400) {
        throw new Error("HTTP " + Number(response.status || 0));
      }
      const body = response && Object.prototype.hasOwnProperty.call(response, "body") ? response.body : response;
      if (typeof body === "string") return body;
      if (body && typeof body.text === "string") return body.text;
      if (body && typeof body.body === "string") return body.body;
      if (body && typeof body === "object") return body;
      throw new Error("invalid search hot response body");
    }

    async function loadSearchHot(seq) {
      const hot = searchHotState();
      try {
        const raw = await requestSearchHotText(searchHotUrl(), 18);
        const data = parseSearchHotResponse(raw);
        const items = normalizeSearchHotItems(data);
        if (seq !== hot.requestSeq) return false;
        hot.items = items;
        hot.loaded = true;
        hot.loading = false;
        hot.error = "";
        hot.fetchedAt = Date.now();
        if (homeUiRoute() === "search" && !currentSearchKeyword()) renderSearchHot();
        return true;
      } catch (error) {
        if (seq !== hot.requestSeq) return false;
        hot.loading = false;
        hot.error = String(error && error.message || error || "search hot request failed");
        if (!hot.loaded) hot.items = [];
        if (homeUiRoute() === "search" && !currentSearchKeyword()) renderSearchHot();
        return false;
      }
    }

    function getSearchHotItems() {
      const hot = searchHotState();
      return {
        source: "iqiyi-search-hot",
        items: Array.isArray(hot.items) ? hot.items : [],
        loading: !!hot.loading,
        loaded: !!hot.loaded,
        error: String(hot.error || ""),
        fetchedAt: Number(hot.fetchedAt || 0),
        path: SEARCH_HOT_ENDPOINT
      };
    }

    function ensureSearchHotData() {
      const hot = searchHotState();
      const now = Date.now();
      const cacheFresh = hot.loaded && hot.fetchedAt > 0 && now - hot.fetchedAt < SEARCH_HOT_TTL_MS;
      const attemptRecent = hot.lastAttemptAt > 0 && now - hot.lastAttemptAt < SEARCH_HOT_TTL_MS;
      if (hot.loading || cacheFresh || attemptRecent) return false;
      hot.loading = true;
      hot.error = "";
      hot.lastAttemptAt = now;
      hot.requestSeq = Number(hot.requestSeq || 0) + 1;
      const seq = hot.requestSeq;
      if (homeUiRoute() === "search" && !currentSearchKeyword()) renderSearchHot();
      void loadSearchHot(seq);
      return true;
    }

    function activateSearchHotItem(query) {
      const input = $("searchInput");
      const normalized = String(query || "").trim();
      if (!input || !normalized) return false;
      input.value = normalized;
      enableSearchEditing();
      hideSearchSuggest();
      recordSearchHistory(normalized);
      focusRemoteTarget(input);
      searchTmdb(normalized, { source: "hot" });
      return true;
    }

    function searchHotCard(item, index) {
      const hot = item || {};
      const query = String(hot.query || "").trim();
      const image = displayImage(hot.image, { size: "w342" });
      const rank = Number(hot.rank || index + 1);
      const rankText = Number.isFinite(rank) && rank > 0 ? String(rank) : String(index + 1);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "card focusable search-hot-card";
      button.dataset.cardIndex = String(index);
      button.dataset.searchHotQuery = query;
      button.setAttribute("aria-label", query);
      button.innerHTML = `<div class="search-hot-poster">${image ? `<img class="poster" ${imageAttrs(image, { loading: "lazy" })} alt="">` : ""}<span class="search-hot-rank" aria-hidden="true">${escapeHtml(rankText)}</span></div><div class="card-body"><div class="card-title">${escapeHtml(query)}</div>${hot.label ? `<div class="search-hot-label">${escapeHtml(hot.label)}</div>` : ""}${hot.meta || hot.heat ? `<div class="search-hot-meta">${escapeHtml([hot.meta, hot.heat].filter(Boolean).join(" · "))}</div>` : ""}</div>`;
      button.addEventListener("click", () => activateSearchHotItem(query));
      return button;
    }

    function renderSearchHot() {
      const section = $("searchHotSection");
      const rail = $("searchHotRail");
      const hot = searchHotState();
      const show = homeUiRoute() === "search" && !currentSearchKeyword() && hot.loaded && Array.isArray(hot.items) && hot.items.length > 0;
      if (section) {
        section.hidden = !show;
        section.setAttribute("aria-hidden", show ? "false" : "true");
      }
      if (rail) {
        rail.dataset.hotSource = "iqiyi-search-hot";
        rail.dataset.hotDataPath = SEARCH_HOT_ENDPOINT;
        rail.dataset.hotStatus = hot.loading ? "loading" : hot.error ? "error" : show ? "ready" : "hidden";
        rail.dataset.hotCount = String(show ? hot.items.length : 0);
        rail.replaceChildren();
        if (show) hot.items.forEach((item, index) => rail.appendChild(searchHotCard(item, index)));
      }
    }

    function renderSearch() {
      ensureSearchPageOrder();
      const section = $("searchSection");
      const page = $("searchPage");
      const live = searchLiveState();
      const keyword = currentSearchKeyword();
      const resultKeyword = String(live.resultKeyword || state.searchSubmittedKeyword || "").trim();
      const loading = homeUiRoute() === "search" && !!keyword && live.loading && live.keyword === keyword;
      const visible = !!(state.searchItems.length && homeUiRoute() === "search" && !!keyword && resultKeyword === keyword && !loading);
      const emptyState = $("searchEmptyState");
      if (section) {
        section.hidden = !visible;
        section.style.display = visible ? "" : "none";
        section.setAttribute("aria-hidden", visible ? "false" : "true");
      }
      if (emptyState) {
        const noResults = homeUiRoute() === "search" && !!keyword && !loading && !state.searchItems.length && !live.error;
        emptyState.textContent = loading ? "正在搜索…" : "未找到相关内容";
        emptyState.hidden = !(loading || noResults);
      }
      if (page) page.dataset.searchResultCount = String(state.searchItems.length || 0);
      renderSearchHistory();
      renderRail("searchRail", ranked(state.searchItems).slice(0, 18), {
        searchResult: visible,
        searchQuery: resultKeyword
      });
      renderSearchHot();
      if (homeUiRoute() === "search" && !keyword) ensureSearchHotData();
    }

    function clearSearchResults() {
      const activeBefore = document.activeElement;
      resetSearchLiveForEmpty();
      if ($("searchInput")) $("searchInput").value = "";
      hideSearchSuggest();
      renderSearch();
      // 清空后搜索区会隐藏；TV 上不能让清空按钮继续持有隐藏焦点。
      if (isTvLikeDevice() && activeBefore === $("clearSearchBtn") && !isVisibleFocusable(activeBefore)) {
        disableSearchEditing();
        const returnTarget = $("searchInput") || currentHomeFocus() || $("connectionToggle");
        if (returnTarget) focusRemoteTarget(returnTarget);
      }
      scheduleUiSnapshotSave();
    }

    function homeUiRoute() {
      return normalizeHomePresentationRoute(state.homeV14 && state.homeV14.route);
    }
