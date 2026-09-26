    function activateListPanel(id) {
      const stack = $("listStack");
      Array.from(stack.querySelectorAll(".list-panel")).forEach((panel) => {
        panel.hidden = panel.dataset.listId !== id;
      });
    }

    function renderRail(id, items, options) {
      const rail = $(id);
      fillRail(rail, items, options);
    }

    function createHomeRailMoreCard(listId, landscape) {
      const button = document.createElement("button");
      const id = normalizeLegacyCategoryId(listId || "");
      if (!id) return null;
      button.className = "card focusable home-card home-more-card" + (landscape ? " landscape-card" : "");
      button.type = "button";
      button.dataset.homeMoreCard = "1";
      button.dataset.homeMoreId = id;
      button.setAttribute("aria-label", "查看更多");
      button.innerHTML = '<span class="home-more-card-body"><span class="home-more-card-icon" aria-hidden="true">›</span><span class="home-more-card-label">查看更多</span></span>';
      button.addEventListener("click", () => openSecondaryCatalog(id, { originSection: id, originTarget: button }));
      return button;
    }

    function fillRail(rail, items, options) {
      if (!rail) return;
      const opts = options || {};
      const homeFocus = opts.home === true ? captureHomeRailFocus(rail) : null;
      const sourceItems = Array.isArray(items) ? items : [];
      items = opts.allowNoPoster ? sourceItems : sourceItems.filter(hasPoster);
      if (!items.length) {
        const empty = document.createElement("div");
        empty.className = "empty";
        empty.textContent = "暂无内容";
        if (opts.home === true) replaceHomeRailChildren(rail, [empty], homeFocus);
        else rail.replaceChildren(empty);
        return;
      }
      const key = rail.dataset.railKey || rail.id || "";
      if (key && rail.dataset.scrollBound) state.railScroll[key] = rail.scrollLeft;
      const savedLeft = key ? state.railScroll[key] || 0 : 0;
      const detailRail = !!($("detailSheet") && $("detailSheet").contains(rail));
      const landscape = typeof opts.landscape === "boolean" ? opts.landscape : detailRail && useLargeDetailLayout();
      const children = items.map((item, index) => mediaCard(item, index, {
        landscape,
        home: !!opts.home,
        weeklyHome: !!opts.weeklyHome,
        weekly: !!opts.weekly,
        homeLazy: !!opts.homeLazy && isTvLikeDevice() && index >= Number(opts.homeEagerCount == null ? 4 : opts.homeEagerCount),
        searchResult: opts.searchResult === true,
        searchQuery: opts.searchQuery || ""
      }));
      if (opts.homeMore) {
        const more = createHomeRailMoreCard(opts.homeMoreListId || rail.dataset.homeListId, landscape);
        if (more) children.push(more);
      }
      if (opts.home === true) replaceHomeRailChildren(rail, children, homeFocus);
      else rail.replaceChildren(...children);
      observeTvCardEnrichment(rail);
      if (opts.weekly) children.forEach((card) => {
        if (!card || !card.classList || !card.classList.contains("weekly-card")) return;
        card.addEventListener("focus", () => updateWeeklySecondaryHero(card.__mediaItem || null));
      });
      if (savedLeft) requestAnimationFrame(() => rail.scrollLeft = savedLeft);
      if (!rail.dataset.scrollBound) {
        rail.dataset.scrollBound = "1";
        rail.addEventListener("scroll", () => {
          state.scrollingUntil = Date.now() + 900;
          const railKey = rail.dataset.railKey || rail.id || "";
          if (railKey) state.railScroll[railKey] = rail.scrollLeft;
        }, { passive: true });
      }
      if (opts.home && !rail.dataset.homeSnapshotBound) {
        rail.dataset.homeSnapshotBound = "1";
        rail.addEventListener("scroll", () => scheduleUiSnapshotSave(), { passive: true });
      }
    }

    function fillGrid(grid, items) {
      if (!grid) return;
      const rawItems = Array.isArray(items) ? items : [];
      const gridId = gridRenderId(grid);
      const cached = state.gridRender[gridId];
      if (cached && cached.source === rawItems && cached.sourceLength === rawItems.length && Number(cached.rendered || 0) > 0 && grid.children.length >= Number(cached.rendered || 0)) {
        const need = Math.min(Number(cached.total || 0), initialGridBatchSize(grid));
        if (Number(cached.rendered || 0) >= need) {
          observeTvCardEnrichment(grid);
          ensureRemoteInitialFocus();
          return;
        }
      }
      const recentGrid = gridId === "recent" || gridId === "secondary:recent";
      items = recentGrid ? uniqueRecentWatchingMedia(rawItems) : uniqueMedia(rawItems).filter(hasPoster);
      if (!items.length) {
        showGridStatus(grid, "暂无内容");
        return;
      }
      const keys = items.map(mediaDomKey);
      const renderKeys = items.map(mediaRenderKey);
      const previousKeys = grid.dataset.itemKeys ? grid.dataset.itemKeys.split("\n") : [];
      const previousRenderKeys = grid.dataset.renderKeys ? grid.dataset.renderKeys.split("\n") : [];
      const samePrefix = previousKeys.length > 0 && previousKeys.every((key, index) => key && key === keys[index]);
      let info = state.gridRender[gridId];
      const oldRendered = Number(info && info.rendered || 0);
      const oldTotal = Number(info && info.total || 0);
      const renderedCount = Math.min(oldRendered, previousRenderKeys.length, renderKeys.length);
      const sameRendered = samePrefix && renderedCount > 0 && previousRenderKeys.slice(0, renderedCount).every((key, index) => key === renderKeys[index]);
      if (!info || !samePrefix || !sameRendered) {
        info = state.gridRender[gridId] = { rendered: 0, total: 0, keys: "", items: [] };
        grid.replaceChildren();
        grid.dataset.renderKeys = "";
      }
      grid.dataset.itemKeys = keys.join("\n");
      info.total = items.length;
      info.keys = grid.dataset.itemKeys;
      info.items = items;
      info.source = rawItems;
      info.sourceLength = rawItems.length;
      let target = Math.min(items.length, Math.max(Number(info.rendered || 0), initialGridBatchSize(grid)));
      if (sameRendered && items.length > oldTotal && oldRendered >= oldTotal) target = Math.min(items.length, oldRendered + appendGridBatchSize(grid));
      appendGridItems(grid, items, target);
      observeTvCardEnrichment(grid);
      ensureRemoteInitialFocus();
    }

    function showGridStatus(grid, text) {
      if (!grid) return;
      const gridId = gridRenderId(grid);
      delete state.gridRender[gridId];
      grid.dataset.renderKeys = "";
      grid.dataset.itemKeys = "";
      grid.replaceChildren(emptyNode(text));
    }

    function gridRenderId(grid) {
      return grid && (grid.dataset.listId || grid.id) || "grid";
    }

    function gridColumns(grid) {
      const width = window.innerWidth || 0;
      const mode = isTvLikeDevice() ? "tv" : "web";
      const gridId = gridRenderId(grid);
      const value = grid ? getComputedStyle(grid).gridTemplateColumns : "";
      const cacheKey = `${gridId}|${mode}|${width}|${value}`;
      const cached = state.gridColumnCache[cacheKey];
      if (cached) return cached;
      const count = value && value !== "none" ? value.split(" ").filter(Boolean).length : 0;
      const cols = count > 0 ? count : isTvLikeDevice() ? 5 : width >= 1180 ? 6 : width >= 720 ? 4 : 3;
      state.gridColumnCache[cacheKey] = cols;
      return cols;
    }

    function initialGridBatchSize(grid) {
      const cols = gridColumns(grid);
      return Math.max(cols * GRID_INITIAL_ROWS, isTvLikeDevice() ? 18 : 12);
    }

    function appendGridBatchSize(grid) {
      const cols = gridColumns(grid);
      return Math.max(cols * GRID_APPEND_ROWS, isTvLikeDevice() ? 10 : 6);
    }

    function appendGridItems(grid, items, target) {
      const gridId = gridRenderId(grid);
      const info = state.gridRender[gridId] || (state.gridRender[gridId] = { rendered: 0, total: items.length, keys: "", items: [] });
      const start = Math.max(0, Number(info.rendered || 0));
      const end = Math.max(start, Math.min(items.length, target));
      info.items = items;
      info.total = items.length;
      if (end <= start) return;
      const fragment = document.createDocumentFragment();
      for (let index = start; index < end; index++) fragment.appendChild(mediaCard(items[index], index));
      grid.appendChild(fragment);
      info.rendered = end;
      grid.dataset.renderKeys = items.slice(0, end).map(mediaRenderKey).join("\n");
      updateBlockSelectUi();
      observeTvCardEnrichment(grid);
    }

    function appendGridBatch(grid) {
      if (!grid || grid.closest && grid.closest(".list-panel[hidden]")) return false;
      const gridId = gridRenderId(grid);
      if (gridId === "recommendRail" && state.activeList !== "all") return false;
      if (grid.dataset.listId && grid.dataset.listId !== state.activeList && !String(grid.dataset.listId).startsWith("secondary:")) return false;
      const info = state.gridRender[gridId];
      if (!info || !info.total || Number(info.rendered || 0) >= Number(info.total || 0)) return false;
      const items = Array.isArray(info.items) && info.items.length ? info.items : itemsForGrid(gridId);
      if (!items.length) return false;
      appendGridItems(grid, items, Math.min(items.length, Number(info.rendered || 0) + appendGridBatchSize(grid)));
      return true;
    }

    function appendActiveGridBatch() {
      const grid = activeMediaGrid();
      if (appendGridBatch(grid)) {
        observeInfiniteScroll();
        return true;
      }
      return false;
    }

    function canAppendActiveGrid() {
      const grid = activeMediaGrid();
      if (!grid) return false;
      const info = state.gridRender[gridRenderId(grid)];
      return !!(info && Number(info.rendered || 0) < Number(info.total || 0));
    }

    function activeMediaGrid() {
      if (state.activeList === "all" && homeUiRoute() === "secondary") return $("secondaryCatalogGrid");
      if (state.activeList === "all" && homeUiRoute() === "search") return $("searchRail");
      if (state.activeList === "all") return $("recommendRail");
      const panel = Array.from($("listStack").querySelectorAll(".list-panel")).find((item) => !item.hidden && item.dataset.listId === state.activeList);
      return panel && panel.querySelector(".media-grid");
    }

    function itemsForGrid(gridId) {
      if (gridId === "recommendRail" || gridId === "all") {
        const source = preferenceItems().length
          ? preferenceItems()
          : state.fallback.length
          ? filterReleasedCatalogItems("all", state.fallback)
          : ranked(allItems());
        return uniqueMedia(filterBlocked(source)).filter(hasPoster);
      }
      if (gridId === "recent" || gridId === "secondary:recent") return uniqueRecentWatchingMedia(state.recent.items || []);
      return uniqueMedia(state.catalog[gridId] || []).filter(hasPoster);
    }

    function maybeAppendGridForFocus(card) {
      const grid = card && card.closest && card.closest(".media-grid");
      if (!grid) return;
      let index = Number(card.dataset.cardIndex || -1);
      if (!Number.isFinite(index) || index < 0) {
        const cards = Array.from(grid.querySelectorAll(".card"));
        index = cards.indexOf(card);
      }
      if (index < 0) return;
      if (homeUiRoute() === "secondary" && grid === $("secondaryCatalogGrid") && index >= Math.max(0, grid.querySelectorAll(".card").length - gridColumns(grid) * 2)) {
        if (secondaryCanLoadMore()) secondaryLoadNextPage();
      }
      const info = state.gridRender[gridRenderId(grid)];
      if (!info || Number(info.rendered || 0) >= Number(info.total || 0)) return;
      const threshold = Math.max(0, Number(info.rendered || 0) - gridColumns(grid) * 2);
      if (index >= threshold) scheduleGridAppend(grid);
    }

    function scheduleGridAppend(grid) {
      const gridId = gridRenderId(grid);
      if (state.activeGridAppendTimer && state.activeGridAppendId === gridId) return;
      if (state.activeGridAppendTimer) cancelAnimationFrame(state.activeGridAppendTimer);
      state.activeGridAppendId = gridId;
      state.activeGridAppendTimer = requestAnimationFrame(() => {
        state.activeGridAppendTimer = 0;
        state.activeGridAppendId = "";
        if (appendGridBatch(grid)) observeInfiniteScroll();
      });
    }

    function coldHomeInitialFocus() {
      if (focusScopeRoot() !== document || !isHomeRouteActive() || !isTvLikeDevice()) return null;
      const target = $("homeHero");
      return isVisibleFocusable(target) ? target : null;
    }

    function homeFocusUserEpoch() {
      return Number(state.homeV14 && state.homeV14.focusUserEpoch || 0);
    }

    function markHomeUserNavigation() {
      const home = state.homeV14;
      if (!home) return 0;
      if (home.secondaryMediaFocusRestore) cancelSecondaryMediaFocusRestore();
      home.focusUserEpoch = Number(home.focusUserEpoch || 0) + 1;
      home.coldHomeFocusPending = false;
      home.coldHomeFallbackTarget = null;
      return home.focusUserEpoch;
    }

    function ensureRemoteInitialFocus(options) {
      const opts = options || {};
      const active = document.activeElement;
      if (state.remoteInitialFocused && isVisibleFocusable(active)) return;
      // Secondary Catalog has an explicit Back -> filters -> grid graph.  Its
      // asynchronous page renderer must never replace that graph's focus with
      // the generic first-content fallback.
      if (homeUiRoute() === "secondary" || homeUiRoute() === "search") return;
      const wantsColdHome = !state.remoteInitialFocused && isHomeRouteActive() && isTvLikeDevice();
      if (wantsColdHome && !state.homeV14.coldHomeFocusPending) {
        if (isVisibleFocusable(active)) {
          state.remoteInitialFocused = true;
          return;
        }
        const target = homeRailFallbackTarget(null, null);
        if (!target) return;
        state.remoteInitialFocused = true;
        state.homeV14.initialHomeFocusPending = true;
        const focusEpoch = homeFocusUserEpoch();
        requestAnimationFrame(() => {
          try {
            if (homeFocusUserEpoch() !== focusEpoch) return;
            if (!isVisibleFocusable(document.activeElement)) focusRemoteTarget(target);
          }
          finally { state.homeV14.initialHomeFocusPending = false; }
        });
        return;
      }
      const coldTarget = wantsColdHome ? coldHomeInitialFocus() : null;
      if (wantsColdHome && state.homeV14.coldHomeFocusPending && !coldTarget && !opts.allowHomeFallback) return;
      // Do not briefly focus a Home content target while the initial Home
      // presentation is still preparing.  A late initial-focus timer may opt
      // into a fallback only when the data source really produced no target.
      if (wantsColdHome && !coldTarget && !opts.allowHomeFallback) return;
      if (wantsColdHome && !coldTarget && opts.allowHomeFallback) {
        state.homeV14.coldHomeFallbackTarget = initialHomeFocus() || firstContentFocus() || null;
      }
      const target = coldTarget || (!state.remoteInitialFocused ? initialHomeFocus() || firstContentFocus() : firstContentFocus());
      if (!target) return;
      state.remoteInitialFocused = true;
      state.homeV14.initialHomeFocusPending = true;
      const focusEpoch = homeFocusUserEpoch();
      requestAnimationFrame(() => {
        try {
          if (homeFocusUserEpoch() !== focusEpoch) return;
          // The launcher may have become ready between the fallback timer and
          // this frame.  Never let the queued fallback overwrite it.
          if (wantsColdHome && document.activeElement === $("homeSearchLauncher")) return;
          focusRemoteTarget(target);
        }
        finally { state.homeV14.initialHomeFocusPending = false; }
      });
    }

    function ensureRemoteActiveFocus() {
      const active = document.activeElement;
      if (isVisibleFocusable(active)) return false;
      if (restoreConnectionPanelFocus()) return true;
      if (isTvLikeDevice() && isHomeRouteActive() && state.homeV14.coldHomeFocusPending) {
        if (homeFocusUserEpoch() !== Number(state.homeV14.coldHomeFocusEpoch || 0)) {
          state.homeV14.coldHomeFocusPending = false;
          state.homeV14.coldHomeFallbackTarget = null;
        }
      }
      if (isTvLikeDevice() && isHomeRouteActive() && state.homeV14.coldHomeFocusPending) {
        const coldTarget = coldHomeInitialFocus();
        if (coldTarget) {
          state.homeV14.coldHomeFocusPending = false;
          state.homeV14.coldHomeFallbackTarget = null;
          focusRemoteTarget(coldTarget);
          return true;
        }
        const fallback = state.homeV14.coldHomeFallbackTarget;
        if (isVisibleFocusable(fallback)) {
          focusRemoteTarget(fallback);
          return true;
        }
        state.homeV14.coldHomeFocusPending = false;
        state.homeV14.coldHomeFallbackTarget = null;
      }
      const homeColdPending = !!(state.homeV14 && state.homeV14.coldHomeFocusPending);
      const target = uiSnapshotRoute() === "home"
        ? homeColdPending ? coldHomeInitialFocus() || initialHomeFocus() || firstContentFocus() : homeRailFallbackTarget(null, null)
        : firstContentFocus();
      if (!target) return false;
      focusRemoteTarget(target);
      return true;
    }

    function focusInitialHomeNow(options) {
      const target = initialHomeFocus();
      state.homeV14.initialHomeFocusPending = true;
      try { focusHomeTopTarget(target, options); }
      finally { state.homeV14.initialHomeFocusPending = false; }
    }

    function focusHomeTopTarget(target, options) {
      if (!target) return;
      const opts = options || {};
      state.remoteInitialFocused = true;
      if (opts.preventScroll) {
        try {
          target.focus({ preventScroll: true });
        } catch (e) {
          target.focus();
        }
      } else {
        focusRemoteTarget(target);
      }
    }

    function initialHomeFocus() {
      if (focusScopeRoot() !== document) return null;
      if (isHomeRouteActive() && isVisibleFocusable($("homeHero"))) return $("homeHero");
      return firstContentFocus();
    }

    function currentHomeFocus() {
      if (focusScopeRoot() !== document) return null;
      return firstContentFocus() || initialHomeFocus();
    }
    function observeInfiniteScroll() {
      const sentinel = $("infiniteSentinel");
      if (!sentinel) return;
      if (!("IntersectionObserver" in window)) return;
      if (!state.infiniteObserver) {
        state.infiniteObserver = new IntersectionObserver((entries) => {
          if (entries.some((entry) => entry.isIntersecting)) loadMoreVisible();
        }, { root: null, rootMargin: "900px 0px", threshold: 0 });
      }
      state.infiniteObserver.unobserve(sentinel);
      if (canAppendActiveGrid() || canLoadMore()) state.infiniteObserver.observe(sentinel);
    }

    function canLoadMore() {
      if (state.loadingMore) return false;
      if (homeUiRoute() === "secondary" && state.activeList === "all") return secondaryCanLoadMore();
      if (state.activeList === "recent") return false;
      if (state.activeList === "live") return false;
      if (state.activeList === "all") return !preferenceItems().length && state.recommendationSource === "fallback" && !state.fallbackPage.done;
      const page = state.catalogPage[state.activeList];
      return !!(page && !page.loading && page.page < page.total);
    }

    function ensureScrollablePage() {
      const doc = document.documentElement;
      if (doc.scrollHeight > window.innerHeight + 500) return;
      loadMoreVisible();
    }

    function normalizeRails() {
      document.querySelectorAll(".rail").forEach((rail) => {
        const detail = $("detailSheet");
        const mobileDetailRail = document.documentElement.classList.contains("native-mobile-app") && detail && detail.contains(rail) && !detail.classList.contains("detail-large");
        if (mobileDetailRail) {
          rail.style.removeProperty("width");
          rail.style.removeProperty("max-width");
          rail.style.minWidth = "0";
          return;
        }
        const landscapeHomeRail = rail.classList.contains("home-rail")
          && rail.closest("#home")
          && window.matchMedia
          && window.matchMedia("(orientation: landscape) and (min-width: 901px)").matches;
        if (landscapeHomeRail) {
          // Let the TV full-bleed rule own the outer frame.  An inline
          // width:100% here would override the Hero-aligned safe gutter and
          // make the rail extend past its intended right edge.
          rail.style.removeProperty("width");
          rail.style.removeProperty("max-width");
          rail.style.minWidth = "0";
          return;
        }
        rail.style.width = "100%";
        rail.style.maxWidth = "100%";
        rail.style.minWidth = "0";
      });
    }

    function mediaCard(item, index, options) {
      const opts = options || {};
      const button = document.createElement("button");
      const people = Number(item.people || 0);
      const key = mediaDomKey(item);
      const blockKey = blockedKey(item);
      const recentWatching = !!item.recentWatching;
      const recent = item.source === "history" && !recentWatching;
      const landscape = !!opts.landscape;
      const home = !!opts.home;
      const weekly = !!opts.weekly;
      const weeklyHome = home && opts.weeklyHome === true;
      const weeklyUpdate = (weeklyHome || weekly)
        ? String(item.weeklyUpdateText || "").trim()
        : "";
      const isVarietyCard = normalizeLegacyCategoryId(item && (item.listId || item.categoryId || item.category) || "") === "variety";
      const hasNostrPeople = item && item.source === "nostr-hot" && people > 0;
      const tvEpisodeCard = String(item && item.mediaType || "").toLowerCase() === "tv" && !!tvDetailCacheId(item);
      const initialTvDetail = tvEpisodeCard ? tvDetailCacheValue(item) || item.tvDetail || item.weeklyDetail || item.heroDetail || null : null;
      const initialTvEpisodeStatus = tvEpisodeCard ? (isVarietyCard ? varietyEpisodeStatusLabel(initialTvDetail) : tvEpisodeStatusLabel(initialTvDetail)) : "";
      const movieReleaseStatus = movieReleaseStatusText(item, weeklyHome || weekly ? weeklyUpdate : undefined);
      const airStatusText = weeklyUpdate || initialTvEpisodeStatus || movieReleaseStatus;
      const airStatusClass = weeklyUpdate ? "card-air-status weekly-air-status" : "card-air-status";
      const airStatusHtml = (weeklyUpdate || tvEpisodeCard || movieReleaseStatus)
        ? `<div class="${airStatusClass}"${airStatusText ? "" : " hidden"}>${escapeHtml(airStatusText)}</div>`
        : "";
      const hasAirStatus = !!airStatusText;
      const searchResult = opts.searchResult === true;
      const searchQuery = String(opts.searchQuery || "").trim();
      button.className = "card focusable" + (hasNostrPeople ? " has-people" : "") + (hasAirStatus ? " has-air-status" : "") + (recent ? " recent-card" : "") + (recentWatching ? " recent-watching-card" : "") + (landscape ? " landscape-card" : "") + (home ? " home-card" : "") + (weeklyHome ? " home-weekly-card" : "") + (weeklyUpdate ? " has-weekly-update" : "") + (weekly ? " weekly-card" : "");
      button.type = "button";
      button.dataset.cardIndex = String(index || 0);
      if (key) button.dataset.mediaKey = key;
      if (blockKey) button.dataset.blockKey = blockKey;
      if (recentWatching) {
        button.dataset.recentWatching = "1";
        button.dataset.recentMediaKey = recentWatchingMediaKey(item);
      }
      if (weekly) button.dataset.weeklyCard = "1";
      if (searchResult && searchQuery) {
        button.dataset.searchResult = "1";
        button.dataset.searchQuery = searchQuery;
      }
      button.__mediaItem = item;
      button.__weeklyHome = weeklyHome;
      if (recentWatching) recordRecentNativeKeyFlow("RECENT_NATIVE_KEY_AT_CARD", item);
      button.classList.toggle("blocked", isBlocked(item));
      const rawRating = item && item.voteAverage != null && item.voteAverage !== ""
        ? item.voteAverage
        : item && item.vote_average;
      const ratingValue = Number(rawRating);
      const rating = Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue.toFixed(1) : "";
      const ratingBadgeHtml = rating
        ? `<span class="rating-badge" aria-label="评分 ${escapeAttr(rating)}"><svg class="badge-icon rating-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6z"></path></svg><span class="badge-value">${escapeHtml(rating)}</span></span>`
        : "";
      const peopleBadgeHtml = hasNostrPeople
        ? `<span class="card-people" aria-label="Nostr 热度 ${escapeAttr(String(people))}"><svg class="badge-icon people-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 11a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8zm-6.2 8.3c0-3 2.7-5 6.2-5s6.2 2 6.2 5v.7H5.8v-.7z"></path></svg><span class="badge-value">${escapeHtml(people)}</span></span>`
        : "";
      const poster = displayImage(landscape ? item.landscape || item.image || item.pic : item.pic, { size: landscape ? "w780" : "w342" });
      const posterSrc = poster || "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
      const imageOpt = {
        loading: index < initialGridBatchSize(null) ? "eager" : "lazy",
        fetchPriority: index < 8 ? "high" : "",
        homeLazy: !!opts.homeLazy
      };
      const progress = Math.min(100, Math.max(0, Number(item.progress || 0)));
      button.innerHTML = recent ? `
        <div class="poster-wrap recent-poster-wrap${hasAirStatus ? " has-air-status" : ""}">
          <img class="poster" alt="" ${imageAttrs(posterSrc, imageOpt)}>
          ${airStatusHtml}
        </div>
        ${item.badge ? `<span class="recent-badge">${escapeHtml(item.badge)}</span>` : ""}
        <div class="card-body">
          <div class="card-title">${escapeHtml(item.title)}</div>
          <div class="card-meta">${escapeHtml(item.remark)}</div>
        </div>
        ${progress > 0 ? `<div class="recent-progress" aria-hidden="true"><span style="--recent-progress:${escapeAttr(progress + "%")}"></span></div>` : ""}
      ` : `
        <div class="poster-wrap${hasAirStatus ? " has-air-status" : ""}">
          <img class="poster" alt="" ${imageAttrs(posterSrc, imageOpt)}>
          ${peopleBadgeHtml}
          ${recentWatching && !home && !weekly ? `<span class="recent-batch-indicator" aria-hidden="true"></span>` : ""}
          ${recentWatching ? `<span class="recent-delete-indicator" aria-hidden="true">🗑</span>` : ""}
          ${ratingBadgeHtml}
          ${airStatusHtml}
        </div>
        <div class="card-body">
          <div class="card-title">${escapeHtml(item.title)}</div>
          <div class="card-meta">${escapeHtml(item.remark)}</div>
        </div>
      `;
      button.addEventListener("pointerdown", (event) => {
        handleBlockPointerDown(blockableRecommendCard(button), event);
      });
      button.addEventListener("pointermove", (event) => {
        handleBlockPointerMove(event);
      });
      button.addEventListener("pointerup", (event) => {
        handleBlockPointerUp(event);
      });
      button.addEventListener("pointercancel", () => {
        clearBlockLongPress();
      });
      button.addEventListener("contextmenu", (event) => {
        if (Date.now() < Number(state.blocked.suppressClickUntil || 0)) event.preventDefault();
      });
      button.addEventListener("click", () => {
        if (recentWatching && consumeRecentWatchingClick(button)) return;
        if (Date.now() < Number(state.blocked.suppressClickUntil || 0)) return;
        if (state.blocked.selecting && blockableRecommendCard(button)) {
          toggleBlockedCard(button);
          return;
        }
        if (button.dataset.searchResult === "1" && String(button.dataset.searchQuery || "").trim()) {
          recordSearchHistory(button.dataset.searchQuery);
        }
        if (item.source === "history") openRecentItem(item, { returnTarget: button });
        else openDetail(item, { returnTarget: button });
      });
      return button;
    }
