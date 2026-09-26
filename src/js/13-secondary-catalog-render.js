    function secondaryFilterItems(id, baseItems) {
      id = normalizeLegacyCategoryId(id);
      if (id === "now-playing") return filterBlocked(Array.isArray(baseItems) ? baseItems : []);
      const filters = secondaryFilterState(id);
      const query = secondaryActiveQuery(id);
      const serverFilters = new Set(query && query.listId === id ? query.serverSideFilters || [] : []);
      const base = query && query.nostrHot
        ? uniqueMedia((query.nostrHotItems || []).concat(Array.isArray(baseItems) ? baseItems : []))
        : (Array.isArray(baseItems) ? baseItems : []);
      const result = filterReleasedCatalogItems(id, base).filter((item) => {
        const nostrItem = item && item.source === "nostr-hot";
        return (filters.mediaType === "all" || (!nostrItem && serverFilters.has("mediaType")) || secondaryItemMediaType(item) === filters.mediaType)
        && (filters.genre === "all" || (!nostrItem && serverFilters.has("genre")) || secondaryItemGenreIds(item).includes(filters.genre))
        && (filters.region === "all" || (!nostrItem && serverFilters.has("region")) || secondaryRegionMatches(item, filters.region))
        && (filters.year === "all" || (!nostrItem && serverFilters.has("year")) || secondaryYearMatches(item, filters.year));
      });
      const metric = (item, key) => Number(item && (key ? item[key] : item.popularity || item.people || item.count) || 0);
      if (query && query.nostrHot && filters.sort === "hot") {
        const nostrItems = result.filter((item) => item && item.source === "nostr-hot");
        const fallbackItems = result.filter((item) => !item || item.source !== "nostr-hot");
        if (!serverFilters.has("sort")) fallbackItems.sort((a, b) => metric(b) - metric(a));
        return nostrItems.concat(fallbackItems);
      }
      if (!serverFilters.has("sort") && filters.sort === "hot") return result.slice().sort((a, b) => metric(b) - metric(a));
      if (!serverFilters.has("sort") && filters.sort === "rating") return result.slice().sort((a, b) => metric(b, "voteAverage") - metric(a, "voteAverage"));
      if (!serverFilters.has("sort") && filters.sort === "latest") return result.slice().sort((a, b) => String(b.releaseDate || b.first_air_date || "").localeCompare(String(a.releaseDate || a.first_air_date || "")) || metric(b, "latest") - metric(a, "latest"));
      return result;
    }
    function secondaryFilterFocusTarget(row, fromX) {
      const options = row ? Array.from(row.querySelectorAll(".secondary-filter-option")).filter(canFastHomeFocus) : [];
      if (!options.length) return null;
      const group = row.dataset.secondaryFilterGroup || "";
      const filters = secondaryFilterState(state.homeV14.secondaryListId);
      const preferred = filters.lastFocused[group] || filters[group] || (group === "sort" ? "hot" : "all");
      const exact = options.find((button) => button.dataset.secondaryFilterValue === preferred);
      if (exact) return exact;
      const x = Number(fromX);
      if (Number.isFinite(x)) return options.slice().sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.getBoundingClientRect().width / 2 - x) - Math.abs(b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2 - x))[0];
      return options[0];
    }
    function syncSecondaryFilterControls(id, host) {
      const filters = secondaryFilterState(id);
      if (!host) return;
      host.querySelectorAll(".secondary-filter-option").forEach((button) => {
        const selected = (filters[button.dataset.secondaryFilterGroup] || secondaryFilterDefaultValue(button.dataset.secondaryFilterGroup)) === button.dataset.secondaryFilterValue;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", selected ? "true" : "false");
      });
    }

    function renderSecondaryFilters(id, baseItems) {
      const host = $("secondaryCatalogFilters"); if (!host) return [];
      const groups = secondaryFilterGroups(id, baseItems);
      const filters = secondaryNormalizeFilterValues(id, groups);
      const signature = secondaryFilterSchemaSignature(groups);
      host.hidden = !groups.length;
      if (host.dataset.secondaryFilterSchema === signature && (!groups.length || host.querySelector(".secondary-filter-row"))) {
        // Value changes update the existing controls in place.  This is the
        // key focus-stability boundary: grid/status rendering must not
        // destroy the currently focused filter button.
        syncSecondaryFilterControls(id, host);
        return groups;
      }
      const active = document.activeElement;
      const activeFilter = active && host.contains(active) && active.dataset && active.dataset.secondaryFilterGroup ? active : null;
      const pending = state.homeV14 && state.homeV14.secondaryFocusRestore;
      if (activeFilter && (!pending || pending.id !== id)) {
        state.homeV14.secondaryFocusRestore = { id, group: activeFilter.dataset.secondaryFilterGroup, value: activeFilter.dataset.secondaryFilterValue, frame: 0 };
      }
      host.innerHTML = groups.map((group) => `<div class="secondary-filter-row" data-secondary-filter-group="${escapeAttr(group.key)}"><span class="secondary-filter-label">${escapeHtml(group.label)}</span><div class="secondary-filter-options">${group.options.map((option) => { const selected = (filters[group.key] || secondaryFilterDefaultValue(group.key)) === option.value; return `<button class="secondary-filter-option focusable${selected ? " selected" : ""}" type="button" tabindex="0" data-secondary-filter-group="${escapeAttr(group.key)}" data-secondary-filter-value="${escapeAttr(option.value)}" aria-pressed="${selected ? "true" : "false"}">${escapeHtml(option.label)}</button>`; }).join("")}</div></div>`).join("");
      host.dataset.secondaryFilterSchema = signature;
      host.querySelectorAll(".secondary-filter-option").forEach((button) => {
        button.addEventListener("focus", () => { filters.lastFocused[button.dataset.secondaryFilterGroup] = button.dataset.secondaryFilterValue; });
        button.addEventListener("click", () => applySecondaryFilter(id, button.dataset.secondaryFilterGroup, button.dataset.secondaryFilterValue));
      });
      syncSecondaryFilterControls(id, host);
      return groups;
    }
    async function loadSecondaryPage(id, query, pageNumber) {
      id = normalizeLegacyCategoryId(id);
      if (!query || query.listId !== id || query.loading) return query;
      const page = Math.max(1, Number(pageNumber || 1));
      if (id === "recent") {
        const items = state.recent && Array.isArray(state.recent.items) ? state.recent.items : [];
        query.loading = false;
        query.loaded = true;
        query.error = "";
        query.page = 1;
        query.totalPages = 1;
        query.totalResults = items.length;
        query.hasMore = false;
        query.items = items;
        query.serverSideFilters = [];
        query.clientSideFilters = [];
        query.endpointMap = [];
        query.sourceStates = [];
        state.homeV14.secondaryPage = 1;
        if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
        return query;
      }
      if (id === "now-playing") {
        query.loading = true;
        query.error = "";
        const requestSeq = ++query.requestSeq;
        const latest = state.homeLatest;
        const snapshotIsCurrent = homeLatestSnapshotIsCurrent(latest);
        if (!snapshotIsCurrent || !homeLatestHasItems(latest)) {
          query.items = [];
          query.loaded = false;
          query.snapshotReady = false;
        }
        const refreshPromise = Promise.resolve(loadHomeLatest());
        const refreshStillRunning = !!(latest && (latest.loading || latest.promise));
        if (snapshotIsCurrent && homeLatestHasItems(latest)) {
          publishHomeWeeklySnapshot(latest.cacheHydrated ? "cache" : "memory", { refreshing: refreshStillRunning });
        } else if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) {
          renderSecondaryCatalog();
        }
        refreshPromise.then(() => {
          if (query.requestSeq !== requestSeq) return;
          const published = publishHomeWeeklySnapshot("network-final", { final: true, refreshing: false });
          if (!published && homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) {
            query.loading = false;
            query.loaded = true;
            query.error = state.homeLatest && state.homeLatest.error || "";
            query.hasMore = false;
            query.snapshotReady = false;
            renderSecondaryCatalog();
          }
        }).catch(() => {
          if (query.requestSeq !== requestSeq) return;
          if (homeLatestHasItems(state.homeLatest)) {
            publishHomeWeeklySnapshot("network-final", { final: true, refreshing: false });
            return;
          }
          query.loading = false;
          query.loaded = true;
          query.error = "加载失败";
          query.hasMore = false;
          query.snapshotReady = false;
          if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
        });
        return query;
      }
      if (page > 1 && !query.hasMore && !query.error) return query;
      query.loading = true;
      query.error = "";
      query.failedPage = 0;
      const requestSeq = ++query.requestSeq;
      if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
      const filters = secondaryFilterState(id);
      const plan = buildSecondaryQueryPlan(id, filters, query);
      const pending = plan.sources.map((source, index) => ({ source, state: plan.sourceStates[index] }))
        .filter((entry) => entry.state && !entry.state.done && !entry.state.error);
      if (page === 1 && query.nostrHot) secondaryLoadNostrHotItems(id, filters, query).catch(() => {});
      if (!pending.length) {
        query.items = uniqueMedia((query.nostrHotItems || []).concat(query.items || []));
        query.loading = false;
        query.loaded = true;
        query.hasMore = false;
        state.homeV14.secondaryPage = query.page;
        if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
        return query;
      }
      pending.forEach((entry) => { entry.state.loading = true; });
      const results = await Promise.all(pending.map(({ source, state: sourceState }) => Promise.resolve()
        .then(() => requestJson(tmdbUrl(source, page), 18))
        .then((body) => ({ source, sourceState, body: body || {}, error: null }))
        .catch((error) => ({ source, sourceState, body: null, error }))));
      if (query.requestSeq !== requestSeq) return query;
      const incoming = [];
      let goodCount = 0;
      results.forEach((result) => {
        const sourceState = result.sourceState;
        sourceState.loading = false;
        sourceState.page = page;
        if (result.error || !result.body) {
          sourceState.error = String(result.error && result.error.message || "加载失败");
          sourceState.done = true;
          return;
        }
        goodCount += 1;
        const body = result.body || {};
        sourceState.totalPages = Math.max(page, Number(body.total_pages || page));
        sourceState.totalResults = Number.isFinite(Number(body.total_results)) ? Number(body.total_results) : 0;
        sourceState.done = page >= sourceState.totalPages;
        (Array.isArray(body.results) ? body.results : []).forEach((item, index) => {
          const normalized = normalizeTmdb(item, result.source, (page - 1) * 20 + index);
          if (hasPoster(normalized) && (!isReleaseFilteredCatalogId(id) || isReleasedAsOfToday(normalized))) incoming.push(normalized);
        });
      });
      if (!goodCount && !(Array.isArray(query.nostrHotItems) && query.nostrHotItems.length)) {
        query.loading = false;
        query.loaded = query.page > 0;
        query.error = "加载失败";
        query.failedPage = page;
        query.hasMore = false;
        if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
        return query;
      }
      query.items = uniqueMedia((query.nostrHotItems || []).concat(query.items || [], incoming));
      query.page = Math.max(page, ...plan.sourceStates.map((sourceState) => Number(sourceState.page || 0)));
      query.totalPages = Math.max(page, ...plan.sourceStates.map((sourceState) => Number(sourceState.totalPages || 0)));
      const totals = plan.sourceStates.map((sourceState) => Number(sourceState.totalResults)).filter(Number.isFinite);
      query.totalResults = totals.length ? totals.reduce((sum, value) => sum + value, 0) : 0;
      query.loading = false;
      query.loaded = true;
      query.hasMore = plan.sourceStates.some((sourceState) => !sourceState.done && !sourceState.error);
      query.error = "";
      state.homeV14.secondaryPage = query.page;
      if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
      observeInfiniteScroll();
      return query;
    }
    function secondaryLoadNextPage() {
      const query = secondaryActiveQuery(state.homeV14.secondaryListId);
      if (!query || !secondaryCanLoadMore()) return false;
      loadSecondaryPage(query.listId, query, query.page + 1).catch(() => {});
      return true;
    }
    function secondaryCanLoadMore() {
      const query = secondaryActiveQuery(state.homeV14.secondaryListId);
      if (state.homeV14.secondaryListId === "recent") return false;
      // Failed pages stay visible for an explicit retry/filter action; the
      // infinite-scroll observer must never turn an error into a retry loop.
      return !!(query && !query.loading && !query.error && query.hasMore);
    }
    function applySecondaryFilter(id, group, value) {
      id = normalizeLegacyCategoryId(id);
      if (homeUiRoute() !== "secondary" || state.homeV14.secondaryListId !== id) return false;
      cancelSecondaryMediaFocusRestore();
      const filters = secondaryFilterState(id), grid = $("secondaryCatalogGrid");
      filters[group] = value || (group === "sort" ? "hot" : "all");
      filters.lastFocused[group] = filters[group];
      state.homeV14.secondaryFocusRestore = { id, group, value: filters[group], frame: 0 };
      state.homeV14.secondaryPage = 1;
      state.homeV14.secondaryActiveQueryKey = "";
      if (grid) { delete state.gridRender[gridRenderId(grid)]; grid.dataset.renderKeys = ""; grid.dataset.itemKeys = ""; grid.scrollTop = grid.scrollLeft = 0; }
      const query = secondaryGetQuery(id);
      renderSecondaryCatalog();
      if (!query.loaded && !query.loading) loadSecondaryPage(id, query, 1).catch(() => {});
      scheduleUiSnapshotSave();
      return true;
    }

    function scheduleSecondaryFilterFocusRestore() {
      const pending = state.homeV14 && state.homeV14.secondaryFocusRestore;
      if (!pending || pending.frame) return;
      pending.frame = requestAnimationFrame(() => {
        pending.frame = 0;
        if (homeUiRoute() !== "secondary" || state.homeV14.secondaryListId !== pending.id) {
          state.homeV14.secondaryFocusRestore = null;
          return;
        }
        const host = $("secondaryCatalogFilters");
        const selected = host && Array.from(host.querySelectorAll(".secondary-filter-option")).find((button) => button.dataset.secondaryFilterGroup === pending.group && button.dataset.secondaryFilterValue === pending.value);
        if (!selected || !selected.isConnected || selected.disabled || !isVisibleFocusable(selected)) return;
        focusRemoteTarget(selected);
        // Clear only after the semantic target has actually received DOM
        // focus. Loading, empty, and error states must not consume a pending
        // restore merely because the query stopped spinning.
        if (document.activeElement === selected) state.homeV14.secondaryFocusRestore = null;
      });
    }

    function secondaryMediaFocusReturnMatches(pending, saved) {
      if (!pending || !saved || saved.route !== "secondary") return false;
      const focus = saved.focus || {};
      return normalizeLegacyCategoryId(saved.secondaryListId) === pending.listId
        && String(saved.secondaryQueryKey || "") === pending.queryKey
        && String(focus.key || saved.mediaKey || "") === pending.mediaKey;
    }

    function cancelSecondaryMediaFocusRestore() {
      const home = state.homeV14;
      const pending = home && home.secondaryMediaFocusRestore;
      if (!pending) return false;
      home.secondaryMediaFocusRestore = null;
      const saved = normalizeLegacySavedState(state.homeReturn);
      if (secondaryMediaFocusReturnMatches(pending, saved)) state.homeReturn = null;
      return true;
    }

    function secondaryMediaFocusRestoreQueryTerminal(query) {
      return !!(query && query.loaded && !query.loading && !query.error && !query.hasMore && !query.nostrHotLoading);
    }

    function secondaryMediaFocusCardForKey(grid, mediaKey) {
      if (!grid || !mediaKey) return null;
      return Array.from(grid.querySelectorAll(".card[data-media-key], .card")).find((card) => String(card.dataset.mediaKey || mediaDomKey(card.__mediaItem) || "") === String(mediaKey)) || null;
    }

    function tryRestoreSecondaryMediaFocus() {
      const home = state.homeV14;
      const pending = home && home.secondaryMediaFocusRestore;
      if (!pending) return false;
      if (homeFocusUserEpoch() !== Number(pending.focusUserEpoch || 0)) {
        cancelSecondaryMediaFocusRestore();
        return false;
      }
      if (homeUiRoute() !== "secondary" || normalizeLegacyCategoryId(home.secondaryListId) !== pending.listId) return false;
      const query = secondaryActiveQuery(pending.listId) || secondaryGetQuery(pending.listId);
      if (pending.queryKey && query && String(query.key || "") !== pending.queryKey) {
        cancelSecondaryMediaFocusRestore();
        return false;
      }
      const grid = $("secondaryCatalogGrid");
      if (!grid) return false;
      let target = secondaryMediaFocusCardForKey(grid, pending.mediaKey);
      const info = state.gridRender[gridRenderId(grid)];
      if (!target && info && Array.isArray(info.items)) {
        const index = info.items.findIndex((item) => String(mediaDomKey(item) || "") === pending.mediaKey);
        if (index >= 0 && Number(info.rendered || 0) <= index) {
          appendGridItems(grid, info.items, index + 1);
          target = secondaryMediaFocusCardForKey(grid, pending.mediaKey);
        }
      }
      if (!target && secondaryMediaFocusRestoreQueryTerminal(query)) {
        const cards = Array.from(grid.querySelectorAll(".card")).filter((card) => isVisibleFocusable(card));
        if (cards.length) {
          const index = Number.isFinite(Number(pending.cardIndex)) ? Math.max(0, Number(pending.cardIndex)) : 0;
          target = cards[Math.min(index, cards.length - 1)] || cards[0];
        }
      }
      if (!target || !isVisibleFocusable(target)) return false;
      grid.scrollTop = pending.gridScrollTop;
      grid.scrollLeft = pending.gridScrollLeft;
      focusRemoteTarget(target);
      if (document.activeElement !== target) return false;
      home.secondaryMediaFocusRestore = null;
      const saved = normalizeLegacySavedState(state.homeReturn);
      if (secondaryMediaFocusReturnMatches(pending, saved)) state.homeReturn = null;
      scheduleUiSnapshotSave();
      return true;
    }

    function scheduleSecondaryMediaFocusRestore() {
      const pending = state.homeV14 && state.homeV14.secondaryMediaFocusRestore;
      if (!pending || pending.frame) return;
      pending.frame = requestAnimationFrame(() => {
        pending.frame = 0;
        tryRestoreSecondaryMediaFocus();
      });
    }

    function openSecondaryCatalog(listId, options) {
      const opts = options || {};
      listId = normalizeLegacyCategoryId(listId);
      if (!listId || !getList(listId) && !["now-playing", "recent"].includes(listId)) return false;
      if (!isHomeRouteActive() && homeUiRoute() !== "home") return false;
      if (isRecentManagePage() && recentManageRuntime().deleting) {
        toast("正在删除，请稍候");
        return true;
      }
      if (listId !== "recent" || !isRecentManagePage()) resetRecentManageState();
      cancelSecondaryMediaFocusRestore();
      const enteringFromHome = homeUiRoute() === "home";
      if (enteringFromHome && !isSecondaryHistoryEntry()) {
        if (location.hash === "#secondary" || history.state && history.state.sheet === "secondary") {
          history.replaceState({ sheet: "secondary" }, "", "#secondary");
        } else {
          history.pushState({ sheet: "secondary" }, "", "#secondary");
        }
      }
      const active = document.activeElement;
      const returnTarget = opts.returnTarget && opts.returnTarget.isConnected
        ? opts.returnTarget
        : opts.originTarget && opts.originTarget.isConnected
        ? opts.originTarget
        : active;
      state.homeV14.secondaryReturn = {
        scrollY: opts.returnScrollY == null ? homeScrollTop() : Math.max(0, Number(opts.returnScrollY || 0)),
        focusId: returnTarget && returnTarget.id || "",
        focus: opts.returnFocus || homeFocusSnapshot(returnTarget, returnTarget && returnTarget.__mediaItem || null),
        originSection: opts.originSection || listId,
        fromSidebar: !!opts.fromSidebar
      };
      state.homeV14.secondaryListId = listId;
      state.homeV14.secondaryFocusRestore = null;
      state.homeV14.secondaryMediaFocusRestore = null;
      state.homeV14.secondaryWeeklyInitialFocusPending = listId === "now-playing";
      state.homeV14.secondaryHistoryBackPending = false;
      secondaryFilterState(listId);
      state.homeV14.secondaryPage = 1;
      state.homeV14.route = "secondary";
      setHomeOnlyPresentationVisible(false);
      syncHomeRoutePresentation();
      // The Weekly route is a full-screen presentation on the existing
      // Secondary page node.  Start that page at its own top while the
      // existing return snapshot keeps the Home scroll position intact.
      if (listId === "now-playing") applyHomeScrollTop(0);
      const query = secondaryGetQuery(listId);
      if (listId === "now-playing" && !homeLatestSnapshotIsCurrent(state.homeLatest)) {
        query.items = [];
        query.loaded = false;
        query.snapshotReady = false;
        query.loading = false;
      }
      renderSecondaryCatalog();
      if (listId === "recent") {
        if (state.recent.loaded) {
          query.items = state.recent.items.slice();
          query.loaded = true;
          query.loading = false;
          query.error = "";
          query.page = 1;
          query.totalPages = 1;
          query.totalResults = query.items.length;
          query.hasMore = false;
          renderSecondaryCatalog();
        } else if (!query.loading) {
          query.loading = true;
          query.loaded = false;
          renderSecondaryCatalog();
          loadRecentList({ silent: true }).then(() => {
            query.items = state.recent.items.slice();
            query.loading = false;
            query.loaded = true;
            query.error = "";
            query.page = 1;
            query.totalPages = 1;
            query.totalResults = query.items.length;
            query.hasMore = false;
            renderSecondaryCatalog();
          }).catch(() => {
            query.loading = false;
            query.loaded = true;
            query.error = "最近观看读取失败";
            renderSecondaryCatalog();
          });
        }
      } else if (listId === "now-playing" && !query.loading) {
        loadSecondaryPage(listId, query, 1).catch(() => {});
      } else if (!query.loaded && !query.loading) loadSecondaryPage(listId, query, 1).catch(() => {});
      requestAnimationFrame(() => {
        if (listId === "now-playing") {
          if (!focusWeeklySecondaryInitial()) focusRemoteTarget($("secondaryCatalogBack"));
        } else focusRemoteTarget($("secondaryCatalogBack"));
      });
      scheduleUiSnapshotSave();
      return true;
    }

    function weeklyBackgroundValue(url) {
      const value = String(url || "").trim();
      if (!value) return "";
      return `url("${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"").replace(/\)/g, "%29")}")`;
    }

    function updateWeeklySecondaryHero(item) {
      const title = $("weeklySecondaryTitle");
      const meta = $("weeklySecondaryMeta");
      const update = $("weeklySecondaryUpdate");
      const overview = $("weeklySecondaryOverview");
      if (!item) {
        if (title) title.textContent = "本周更新";
        if (meta) meta.textContent = "";
        if (update) update.textContent = "";
        if (overview) overview.textContent = "";
        return;
      }
      if (title) title.textContent = item.title || "未命名";
      if (meta) meta.textContent = item.weeklyMetaText || weeklyMetaText(item);
      if (update) update.textContent = item.weeklyUpdateText || weeklyUpdateText(item, state.homeLatest && state.homeLatest.range || weeklyDateRange());
      if (overview) overview.textContent = item.desc || "";
      const current = $("weeklySecondaryBackdrop");
      const next = $("weeklySecondaryBackdropNext");
      if (!current) return;
      const source = displayImage(item.landscape || item.image || item.pic, { size: "w1920" });
      const fallback = displayImage(item.pic, { size: "w780" });
      const firstImage = current.style.backgroundImage;
      if (!firstImage && fallback) current.style.backgroundImage = weeklyBackgroundValue(fallback);
      if (!source) return;
      const token = ++state.homeV14.weeklyBackdropToken;
      const apply = () => {
        if (token !== Number(state.homeV14.weeklyBackdropToken || 0)) return;
        if (!next) {
          current.style.backgroundImage = weeklyBackgroundValue(source);
          return;
        }
        next.style.backgroundImage = weeklyBackgroundValue(source);
        next.classList.add("is-visible");
        setTimeout(() => {
          if (token !== Number(state.homeV14.weeklyBackdropToken || 0)) return;
          current.style.backgroundImage = next.style.backgroundImage;
          next.classList.remove("is-visible");
        }, 240);
      };
      const image = new Image();
      image.onload = apply;
      image.onerror = () => {
        if (!firstImage && fallback && token === Number(state.homeV14.weeklyBackdropToken || 0)) current.style.backgroundImage = weeklyBackgroundValue(fallback);
      };
      image.src = source;
    }

    function weeklySecondaryFocusableCards(grid) {
      return grid && grid.classList.contains("weekly-secondary-rail")
        ? Array.from(grid.querySelectorAll(".weekly-card")).filter(isVisibleFocusable)
        : [];
    }

    function weeklySecondaryFocusSnapshot(grid) {
      if (!grid || !grid.classList.contains("weekly-secondary-rail")) return null;
      const active = document.activeElement;
      if (!active || !grid.contains(active) || !active.classList.contains("weekly-card")) return null;
      const cards = Array.from(grid.querySelectorAll(".weekly-card"));
      const index = cards.indexOf(active);
      if (index < 0) return null;
      return {
        mediaKey: String(active.dataset.mediaKey || mediaDomKey(active.__mediaItem) || ""),
        index
      };
    }

    function restoreWeeklySecondaryFocus(snapshot) {
      if (!snapshot || homeUiRoute() !== "secondary" || state.homeV14.secondaryListId !== "now-playing") return false;
      const grid = $("secondaryCatalogGrid");
      if (!grid || !grid.classList.contains("weekly-secondary-rail")) return false;
      const cards = Array.from(grid.querySelectorAll(".weekly-card"));
      const visibleCards = weeklySecondaryFocusableCards(grid);
      if (!visibleCards.length) return false;
      const mediaKey = String(snapshot.mediaKey || "");
      let target = mediaKey
        ? visibleCards.find((card) => String(card.dataset.mediaKey || mediaDomKey(card.__mediaItem) || "") === mediaKey)
        : null;
      const index = Number(snapshot.index);
      if (!target && Number.isFinite(index) && index >= 0) {
        const indexed = cards[index];
        target = isVisibleFocusable(indexed)
          ? indexed
          : visibleCards[Math.min(Math.floor(index), visibleCards.length - 1)];
      }
      if (!target) target = visibleCards[visibleCards.length - 1];
      if (!target) return false;
      focusRemoteTarget(target);
      updateWeeklySecondaryHero(target.__mediaItem || null);
      return true;
    }

    function focusWeeklySecondaryInitial() {
      if (homeUiRoute() !== "secondary" || state.homeV14.secondaryListId !== "now-playing") return false;
      const grid = $("secondaryCatalogGrid");
      const card = weeklySecondaryFocusableCards(grid)[0] || null;
      if (!card) return false;
      state.homeV14.secondaryWeeklyInitialFocusPending = false;
      focusRemoteTarget(card);
      updateWeeklySecondaryHero(card.__mediaItem || null);
      return true;
    }

    function syncSecondaryCatalogPresentation(listId) {
      const page = $("secondaryCatalog");
      const grid = $("secondaryCatalogGrid");
      const weekly = listId === "now-playing";
      if (page) {
        page.classList.toggle("weekly-secondary-page", weekly);
        page.dataset.secondaryKind = weekly ? "weekly" : "catalog";
      }
      if (!grid) return weekly;
      if (weekly) {
        grid.classList.remove("media-grid");
        grid.classList.add("rail", "weekly-secondary-rail");
        grid.dataset.railKey = "secondary:weekly";
      } else {
        grid.classList.remove("rail", "weekly-secondary-rail");
        grid.classList.add("media-grid");
        grid.dataset.railKey = `secondary:${listId}`;
      }
      return weekly;
    }

    function renderWeeklySecondaryCatalog(query, items) {
      const grid = $("secondaryCatalogGrid");
      const status = $("secondaryCatalogLoadStatus");
      if (!grid) return;
      syncSecondaryCatalogPresentation("now-playing");
      const focusSnapshot = weeklySecondaryFocusSnapshot(grid);
      grid.dataset.listId = "secondary:now-playing";
      grid.dataset.secondaryQueryKey = query && query.key || "";
      const hasItems = items.length > 0;
      if (status) status.textContent = hasItems && query && query.loading ? "正在更新…" : query && query.error ? "本周更新加载失败" : hasItems ? "" : query && query.loaded ? "暂无本周更新" : "";
      if (hasItems) {
        fillRail(grid, items, { weekly: true, railKey: "secondary:weekly" });
        const restored = restoreWeeklySecondaryFocus(focusSnapshot);
        const active = grid.querySelector(".weekly-card:focus") || (!restored && grid.querySelector(".weekly-card"));
        if (active) updateWeeklySecondaryHero(active.__mediaItem || null);
        if (!restored && state.homeV14.secondaryWeeklyInitialFocusPending) requestAnimationFrame(() => focusWeeklySecondaryInitial());
      } else if (query && query.loading) {
        showGridStatus(grid, "本周更新加载中…");
      } else if (query && query.error) {
        showGridStatus(grid, "本周更新加载失败");
      } else if (!query || !query.loaded) {
        showGridStatus(grid, "本周更新加载中…");
      } else {
        showGridStatus(grid, "暂无本周更新");
      }
    }

    function renderSecondaryCatalog() {
      if (homeUiRoute() !== "secondary") return;
      const listId = state.homeV14.secondaryListId;
      updateRecentManageUi();
      const list = getList(listId);
      const isRecent = listId === "recent";
      const isWeekly = listId === "now-playing";
      const title = isRecent ? "最近观看" : isWeekly ? "本周更新" : list && list.title || "分类";
      const query = secondaryActiveQuery(listId) || secondaryGetQuery(listId);
      const grid = $("secondaryCatalogGrid");
      const baseItems = isRecent
        ? (state.recent && Array.isArray(state.recent.items) ? state.recent.items : [])
        : isWeekly
        ? filterBlocked(query.items || [])
        : query.loaded ? filterBlocked(query.items || []) : secondaryCatalogBaseItems(listId);
      if (isWeekly) {
        syncSecondaryCatalogPresentation(listId);
        renderWeeklySecondaryCatalog(query, baseItems);
        if ($("secondaryCatalogTitle")) $("secondaryCatalogTitle").textContent = title;
        if ($("secondaryCatalogCount")) $("secondaryCatalogCount").textContent = query.snapshotReady || query.loaded ? `${baseItems.length} 部` : "";
        scheduleSecondaryMediaFocusRestore();
        return;
      }
      syncSecondaryCatalogPresentation(listId);
      if (isRecent && query.loaded) query.items = baseItems.slice();
      const items = isRecent ? uniqueRecentWatchingMedia(baseItems) : secondaryFilterItems(listId, baseItems);
      const activeClientFilter = (query.clientSideFilters || []).some((key) => {
        const value = secondaryFilterState(listId)[key];
        return value && value !== "all";
      });
      if ($("secondaryCatalogTitle")) $("secondaryCatalogTitle").textContent = title;
      renderSecondaryFilters(listId, baseItems);
      if ($("secondaryCatalogCount")) {
        const loadedCount = query.loaded ? baseItems.length : 0;
        $("secondaryCatalogCount").textContent = isRecent
          ? query.loaded ? `${items.length} 条` : ""
          : activeClientFilter
          ? `${items.length} 条`
          : query.totalResults > 0 ? `共 ${query.totalResults} 条 · 已加载 ${loadedCount} 条` : query.loaded ? `${items.length} 条` : "";
      }
      if (!grid) return;
      grid.dataset.listId = `secondary:${listId}`;
      grid.dataset.secondaryQueryKey = query.key;
      const status = $("secondaryCatalogLoadStatus");
      if (status) {
        status.textContent = isRecent
          ? query.loading ? "正在读取最近观看…" : query.error ? query.error : query.loaded ? items.length ? "已加载全部" : "暂无最近观看" : ""
          : query.loading ? (query.page > 0 ? "正在加载下一页…" : "加载中…") : query.error ? "加载失败，请重试或调整筛选" : query.loaded && !query.hasMore ? "已加载全部" : "";
      }
      const progressiveNostrAnime = listId === "anime" && query.nostrHot && query.nostrHotItems && query.nostrHotItems.length;
      if (query.loading && !query.page && !progressiveNostrAnime) {
        showGridStatus(grid, "加载中...");
      } else if (query.error && !query.page) {
        showGridStatus(grid, "加载失败，请重试或调整筛选");
      } else if (!query.loaded) {
        showGridStatus(grid, "加载中...");
      } else if (!items.length && !query.hasMore) {
        showGridStatus(grid, isRecent ? "暂无最近观看" : "暂无符合条件的内容，请调整筛选");
      } else {
        fillGrid(grid, items);
      }
      updateRecentManageUi();
      observeInfiniteScroll();
      requestAnimationFrame(ensureScrollablePage);
      scheduleSecondaryFilterFocusRestore();
      scheduleSecondaryMediaFocusRestore();
    }

    function isSecondaryHistoryEntry() {
      const current = window.history && window.history.state;
      return location.hash === "#secondary" && !!(current && current.sheet === "secondary");
    }

    function requestCloseSecondaryCatalog() {
      if (homeUiRoute() !== "secondary") return false;
      cancelSecondaryMediaFocusRestore();
      const homeV14 = state.homeV14;
      if (!homeV14) return false;
      const manage = recentManageRuntime();
      if (manage.active && manage.deleting) {
        toast("正在删除，请稍候");
        return true;
      }
      if (manage.active) {
        exitRecentManageMode({ focus: true });
        return true;
      }
      if (homeV14.secondaryHistoryBackPending) return true;
      if (isSecondaryHistoryEntry()) {
        homeV14.secondaryHistoryBackPending = true;
        try {
          history.back();
          return true;
        } catch (e) {
          homeV14.secondaryHistoryBackPending = false;
        }
      }
      homeV14.secondaryHistoryBackPending = false;
      const closed = closeSecondaryCatalog();
      if (closed && (location.hash === "#secondary" || history.state && history.state.sheet === "secondary")) {
        history.replaceState({ sheet: "home" }, "", location.pathname + location.search);
      }
      return closed;
    }

    function closeSecondaryCatalog() {
      if (homeUiRoute() !== "secondary") return false;
      resetRecentManageState();
      const saved = state.homeV14.secondaryReturn || {};
      state.homeV14.secondaryHistoryBackPending = false;
      state.homeV14.route = "home";
      state.homeV14.secondaryListId = "";
      state.homeV14.secondaryFocusRestore = null;
      state.homeV14.secondaryMediaFocusRestore = null;
      state.homeV14.secondaryWeeklyInitialFocusPending = false;
      state.homeV14.secondaryReturn = null;
      state.activeList = "all";
      renderAll({ deferContent: false });
      const restore = () => {
        applyHomeScrollTop(Math.max(0, Number(saved.scrollY || 0)));
        let target = saved.focus ? findHomeReturnTarget({ focus: saved.focus }) : null;
        if (!target && saved.focusId) target = $(saved.focusId);
        if (!target && saved.originSection === "now-playing") target = $("homeHotMore");
        if (!target && saved.originSection === "recent") target = $("homeRecentMore");
        if (!target && saved.originSection) target = document.querySelector(`[data-home-more-id="${String(saved.originSection).replace(/"/g, "\\\"")}"]`);
        if (!target) target = initialHomeFocus();
        if (target) focusRemoteTarget(target);
      };
      requestAnimationFrame(restore);
      scheduleUiSnapshotSave();
      return true;
    }

    function renderHomeHot(options) {
      const opts = options || {};
      const section = $("recommendSection");
      const rail = $("recommendRail");
      if (!section || !rail) return;
      if (!isHomeRouteActive()) {
        section.hidden = true;
        return;
      }
      section.hidden = false;
      const resolved = resolveHomeLatestItems();
      const previousSource = rail.dataset.hotSource || "";
      section.dataset.hotSource = resolved.source;
      rail.dataset.hotSource = resolved.source;
      rail.dataset.hotDataPath = resolved.path;
      rail.dataset.weeklyDataPath = resolved.path;
      if (previousSource && previousSource !== resolved.source) {
        rail.dataset.homeRenderKeys = "";
        replaceHomeRailChildren(rail, [], captureHomeRailFocus(rail));
      }
      rail.dataset.homeVariant = "portrait";
      ensureHomeLatestData();
      const page = resolved.page;
      if (page && page.loading && !resolved.items.length) {
        showHomeRailStatus(rail, "本周更新加载中...", { variant: "portrait" });
        return;
      }
      if (page && page.error && !resolved.items.length) {
        showHomeRailStatus(rail, "本周更新加载失败", { variant: "portrait" });
        return;
      }
      const items = resolved.items;
      if (items.length) fillHomeRail(rail, items, { variant: "portrait", limit: homeRailLimit("portrait"), homeMore: true, weeklyHome: true, railKey: "home:hot" });
      else showHomeRailStatus(rail, page && page.loaded ? "暂无本周更新" : "本周更新加载中...", { variant: "portrait" });
      updateBlockSelectUi();
      if (opts.hotOnly) recordHomeV14Diag();
    }

    // Compatibility alias for the existing Nostr recommendation refresh path.
    // The Home presentation now exposes one Hot rail, while the underlying
    // preference/heat engine remains unchanged.
    function renderActiveGrid() {
      if (state.activeList === "all") renderHome();
      else renderLists();
      observeInfiniteScroll();
      requestAnimationFrame(ensureScrollablePage);
    }

    function renderLists() {
      if (state.activeList === "recent") {
        renderRecentList();
        return;
      }
      if (state.activeList === "live") {
        renderLiveEntry();
        return;
      }
      const lists = visibleTmdbLists().filter((list) => list.id === state.activeList);
      if (!lists.length) {
        activateListPanel("");
        return;
      }
      const list = lists[0];
      const panel = ensureListPanel(list.id, list.title, list.hint || "");
      const grid = panel.querySelector(".media-grid");
      activateListPanel(list.id);
      const page = state.catalogPage[list.id];
      if (page && page.loading) {
        if (!grid.dataset.renderKeys) showGridStatus(grid, "加载中...");
      } else if (page && page.error) {
        showGridStatus(grid, "加载失败");
      } else if (!page || !page.loaded) {
        showGridStatus(grid, "点击后加载片单");
      } else {
        fillGrid(grid, filterReleasedCatalogItems(list.id, state.catalog[list.id] || []));
      }
    }

    function renderLiveEntry() {
      const panel = ensureListPanel("live", "直播", "电视台与直播源", { grid: false });
      activateListPanel("live");
      if (panel.dataset.liveReady === "1") return;
      panel.dataset.liveReady = "1";
      const body = document.createElement("div");
      const card = document.createElement("button");
      card.className = "live-entry-card focusable";
      card.type = "button";
      card.innerHTML = `
        <span class="live-icon" aria-hidden="true">
          <svg class="icon" viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 19v2"/><path d="m9 3 3 3 3-3"/></svg>
        </span>
        <div class="live-copy">
          <h5>观看直播</h5>
          <p>频道分组、节目单、收藏频道和多线路已接入。</p>
          <div class="live-tags"><span class="live-tag">频道分组</span><span class="live-tag">节目单</span><span class="live-tag">收藏</span></div>
        </div>
        <span class="live-action">继续观看</span>
      `;
      card.addEventListener("click", openLiveHome);
      body.appendChild(card);
      panel.appendChild(body);
    }

    function renderRecentList() {
      const panel = ensureListPanel("recent", "最近观看", "选择媒体进入详情");
      const grid = panel.querySelector(".media-grid");
      activateListPanel("recent");
      if (state.recent.loading && !state.recent.loaded) {
        showGridStatus(grid, "读取最近观看…");
      } else if (state.recent.error) {
        showGridStatus(grid, "最近观看读取失败");
      } else if (!state.recent.loaded) {
        showGridStatus(grid, "点击后读取最近观看");
      } else if (!(state.recent.items || []).length) {
        showGridStatus(grid, "暂无最近观看");
      } else {
        fillGrid(grid, state.recent.items || []);
      }
    }

    function ensureListPanel(id, title, hint, options) {
      const stack = $("listStack");
      Array.from(stack.children).forEach((child) => {
        if (!child.classList || !child.classList.contains("list-panel")) child.remove();
      });
      let panel = Array.from(stack.querySelectorAll(".list-panel")).find((item) => item.dataset.listId === id);
      if (panel) return panel;
      panel = document.createElement("div");
      panel.className = "list-block list-panel";
      panel.dataset.listId = id;
      panel.hidden = true;
      panel.innerHTML = `
        <div class="subsection-head">
          <h4>${escapeHtml(title || "")}</h4>
          <span>${escapeHtml(hint || "")}</span>
        </div>
      `;
      if (!options || options.grid !== false) {
        const grid = document.createElement("div");
        grid.className = "media-grid";
        grid.dataset.listId = id;
        panel.appendChild(grid);
      }
      stack.appendChild(panel);
      return panel;
    }
