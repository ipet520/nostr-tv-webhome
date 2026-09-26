    function shouldRefreshRecentList() {
      return !state.recent.loaded || Date.now() - Number(state.recent.refreshedAt || 0) > RECENT_UI_TTL_MS;
    }

    async function loadRecentList(options) {
      const opts = options || {};
      const recent = state.recent;
      if (recent.loading) {
        if (opts.refresh) {
          const activeRun = recent.activeRun;
          if (activeRun && !activeRun.invalidated) {
            activeRun.invalidated = true;
            try { console.debug("RECENT_LOAD_INVALIDATED", activeRun.id); } catch (e) {}
          }
          if (!recent.pendingRefresh) {
            recent.pendingRefresh = true;
            recent.pendingRefreshSilent = !!opts.silent;
            recent.pendingRefreshReconcileDetail = opts.reconcileDetail !== false;
            try { console.debug("RECENT_REFRESH_QUEUED"); } catch (e) {}
          } else {
            recent.pendingRefreshSilent = recent.pendingRefreshSilent && !!opts.silent;
            recent.pendingRefreshReconcileDetail = recent.pendingRefreshReconcileDetail && opts.reconcileDetail !== false;
          }
        }
        return recent.loadingPromise || Promise.resolve();
      }
      if (recent.loaded && !opts.refresh) return;
      recent.loading = true;
      recent.error = "";
      if (state.activeList === "recent") renderActiveGrid();
      const task = (async () => {
        let runSilent = !!opts.silent;
        let runReconcileDetail = opts.reconcileDetail !== false;
        let trailing = false;
        try {
          while (true) {
            const run = { id: ++recent.runSeq, invalidated: false, reconcileDetail: runReconcileDetail };
            recent.activeRun = run;
            if (trailing) {
              try { console.debug("RECENT_TRAILING_REFRESH_START", run.id); } catch (e) {}
            }
            if (!runSilent) setStatus("tmdb", "读取最近观看");
            try { console.debug("RECENT_LOAD_START", run.id); } catch (e) {}
            let error = null;
            let normalized = null;
            try {
              await loadHistoryContextIndex();
              if (!state.watch || !state.watch.item) await loadPendingWatch();
              const list = await sdk().history();
              normalized = normalizeHistoryList(list);
              normalized.forEach((item) => recordRecentNativeKeyFlow("RECENT_NATIVE_KEY_AT_LOAD", item));
              normalized.forEach((item) => { item.recentWatching = true; });
            } catch (e) {
              error = e;
            }
            if (!run.invalidated) {
              if (error) {
                recent.items = [];
                recent.loaded = true;
                recent.error = error.message || "unknown";
                if (!runSilent) setStatus("tmdb", "最近观看读取失败");
              } else {
                recent.items = normalized || [];
                recent.loaded = true;
                recent.error = "";
                recent.refreshedAt = Date.now();
                if (!runSilent) setStatus("tmdb", "最近观看 " + recent.items.length + " 条");
              }
              try { console.debug("RECENT_LOAD_COMMIT", run.id); } catch (e) {}
              if (state.activeList === "recent") renderActiveGrid();
              if (state.activeList === "all") renderHome();
              if (run.reconcileDetail !== false
                && !error
                && $("detailSheet")
                && $("detailSheet").classList.contains("active")
                && state.selected) {
                const winner = recentNativeHistoryWinnerFor(state.selected);
                const history = winner
                  && detailHasAuthoritativeNativeHistory(winner)
                  && detailHistoryMatches(state.selected, winner)
                  ? winner
                  : null;
                syncDetailMode(state.selected, history, { freshNative: true });
                updateDetailContinueButton();
              }
            }
            if (recent.activeRun === run) recent.activeRun = null;
            if (!recent.pendingRefresh) break;
            runSilent = recent.pendingRefreshSilent;
            runReconcileDetail = recent.pendingRefreshReconcileDetail;
            recent.pendingRefresh = false;
            recent.pendingRefreshSilent = true;
            recent.pendingRefreshReconcileDetail = true;
            trailing = true;
          }
        } finally {
          recent.loading = false;
          recent.activeRun = null;
          recent.pendingRefresh = false;
          recent.pendingRefreshSilent = true;
          recent.pendingRefreshReconcileDetail = true;
        }
      })();
      recent.loadingPromise = task;
      try {
        return await task;
      } finally {
        if (recent.loadingPromise === task) recent.loadingPromise = null;
      }
    }

    async function loadInfo() {
      try {
        await detectDeviceMode();
        state.config = await sdk().config();
        state.pan.checkEnabled = !!(state.config && state.config.driveCheck);
        setStatus("sdk", window.fm ? "App SDK 已连接" : "浏览器预览模式");
        setPanStatus(state.pan.checkEnabled ? "检测已开启" : "检测关闭");
        state.pan.renderKeys = "";
        renderPanResults();
      } catch (e) {
        state.pan.checkEnabled = false;
        setStatus("sdk", "SDK 获取失败：" + (e.message || "unknown"));
      }
    }

    async function loadCatalog() {
      setStatus("tmdb", "等待按需请求");
      loadRecentList({ silent: true }).catch(() => {});
      renderAll({ deferContent: true });
    }

    function prefetchRecommendationFallback() {
      if (preferenceItems().length) {
        useNostrRecommendationsIfReady();
        return;
      }
      if (state.fallbackPage.loading || state.fallbackPage.loaded || state.fallbackPage.done) return;
      loadRecommendationFallback().catch((e) => {
        state.fallbackPage.loading = false;
        state.fallbackPage.loaded = true;
        state.fallbackPage.done = true;
        setStatus("tmdb", "推荐加载失败");
        if (state.recommendationSource === "fallback") renderActiveGrid();
      });
    }

    function ensureRecommendationFallback() {
      if (!nostrReadyForFallback()) return;
      prefetchRecommendationFallback();
    }

    function armFallbackTimers() {
      clearTimeout(state.relay.fallbackTimer);
      clearTimeout(state.relay.fallbackPrefetchTimer);
      const elapsed = Date.now() - PAGE_OPENED_AT;
      state.relay.fallbackPrefetchTimer = setTimeout(() => {
        if (!preferenceItems().length) prefetchRecommendationFallback();
      }, Math.max(0, FALLBACK_PREFETCH_MS - elapsed));
      state.relay.fallbackTimer = setTimeout(() => {
        if (!preferenceItems().length) useFallbackRecommendations();
      }, Math.max(0, FALLBACK_SHOW_MS - elapsed));
    }

    async function loadCatalogList(id) {
      const list = getList(id);
      const page = state.catalogPage[id];
      if (!list || page && page.loading) return;
      if (page && page.loaded) return;
      state.catalogPage[id] = { page: 0, total: 1, loading: true, loaded: false };
      setStatus("tmdb", `请求 ${list.title}`);
      if (state.activeList === id) renderActiveGrid();
      // 多数据源混合加载
      if (list.sources && list.sources.length) {
        try {
          const fetches = list.sources.map((src) => {
            const srcList = Object.assign({}, list, { endpoint: src.endpoint, params: src.params, mediaType: src.mediaType || list.mediaType });
            return requestJson(tmdbUrl(srcList, 1), 18)
              .then((body) => ({ items: filterReleasedCatalogItems(id, (body.results || []).map((item, i) => normalizeTmdb(item, srcList, i)).filter(hasPoster)), total: body.total_pages || 1 }))
              .catch(() => ({ items: [], total: 1 }));
          });
          const results = await Promise.all(fetches);
          // 交叉混排：依次从每个来源取一条，循环直到取完
          const mixed = [];
          const iters = results.map((r) => r.items[Symbol.iterator]());
          let anyLeft = true;
          while (anyLeft) {
            anyLeft = false;
            for (const iter of iters) {
              const { value, done } = iter.next();
              if (!done) { mixed.push(value); anyLeft = true; }
            }
          }
          state.catalog[id] = uniqueMedia(mixed);
          const maxTotal = Math.max(...results.map((r) => r.total));
          state.catalogPage[id] = { page: 1, total: maxTotal, loading: false, loaded: true, multiSrc: true };
          setStatus("tmdb", `${list.title} 已加载 ${state.catalog[id].length} 条`);
        } catch (e) {
          state.catalog[id] = [];
          state.catalogPage[id] = { page: 1, total: 1, loading: false, loaded: true, error: e.message || "unknown" };
          setStatus("tmdb", `${list.title} 加载失败`);
        }
        if (state.activeList === id) renderActiveGrid();
        return;
      }
      try {
        const body = await requestJson(tmdbUrl(list, 1), 18);
        const results = body.results || [];
        state.catalog[id] = uniqueMedia(filterReleasedCatalogItems(id, results.map((item, index) => normalizeTmdb(item, list, index)).filter(hasPoster)));
        state.catalogPage[id] = { page: 1, total: body.total_pages || 1, loading: false, loaded: true };
        setStatus("tmdb", `${list.title} 已加载 ${state.catalog[id].length} 条`);
      } catch (e) {
        state.catalog[id] = [];
        state.catalogPage[id] = { page: 1, total: 1, loading: false, loaded: true, error: e.message || "unknown" };
        setStatus("tmdb", `${list.title} 加载失败`);
      }
      if (state.activeList === id) renderActiveGrid();
    }

    async function loadRecommendationFallback() {
      const sources = [
        { type: "trending", id: "tmdb-trending", title: "今日趋势" },
        { type: "airing", id: "tv-airing-today", title: "今日播出", mediaType: "tv" }
      ];
      if (preferenceItems().length) {
        useNostrRecommendationsIfReady();
        return;
      }
      state.fallback = [];
      state.fallbackPage = { sourceIndex: 0, page: 0, loading: true, loaded: false, done: false };
      setStatus("tmdb", "请求推荐兜底");
      if (state.recommendationSource === "fallback") renderActiveGrid();
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index];
        try {
          const body = await requestJson(tmdbFallbackUrl(source.type, 1), 18);
          const items = (body.results || [])
            .filter((item) => item.poster_path && (item.media_type === "movie" || item.media_type === "tv" || source.mediaType))
            .map((item, index) => normalizeTmdb(item, source, index))
            .filter(hasPoster)
            .filter(isReleasedAsOfToday);
          if (preferenceItems().length) {
            useNostrRecommendationsIfReady();
            return;
          }
          if (items.length) {
            state.fallback = uniqueMedia(items);
            state.fallbackPage = { sourceIndex: index, page: 1, total: body.total_pages || 1, loading: false, loaded: true, done: false };
            setStatus("tmdb", "推荐兜底已加载");
            if (state.recommendationSource === "fallback") renderActiveGrid();
            return;
          }
        } catch (e) {}
      }
      state.fallback = ranked(allItems());
      state.fallbackPage.loaded = true;
      state.fallbackPage.loading = false;
      state.fallbackPage.done = true;
      setStatus("tmdb", state.fallback.length ? "本地兜底已加载" : "推荐为空");
      if (state.recommendationSource === "fallback") renderActiveGrid();
    }

    async function loadMoreCatalog(id) {
      const list = getList(id);
      const page = state.catalogPage[id];
      if (!page || !page.loaded) return loadCatalogList(id);
      if (!list || page.loading || page.page >= page.total) return;
      page.loading = true;
      state.catalogPage[id] = page;
      try {
        const next = page.page + 1;
        // 多源列表：并发请求所有来源的下一页，交叉混排追加
        if (page.multiSrc && list.sources && list.sources.length) {
          const fetches = list.sources.map((src) => {
            const srcList = Object.assign({}, list, { endpoint: src.endpoint, params: src.params, mediaType: src.mediaType || list.mediaType });
            return requestJson(tmdbUrl(srcList, next), 18)
              .then((body) => ({ items: filterReleasedCatalogItems(id, (body.results || []).map((item, i) => normalizeTmdb(item, srcList, (next - 1) * 20 + i)).filter(hasPoster)), total: body.total_pages || page.total }))
              .catch(() => ({ items: [], total: page.total }));
          });
          const results = await Promise.all(fetches);
          const mixed = [];
          const iters = results.map((r) => r.items[Symbol.iterator]());
          let anyLeft = true;
          while (anyLeft) {
            anyLeft = false;
            for (const iter of iters) {
              const { value, done } = iter.next();
              if (!done) { mixed.push(value); anyLeft = true; }
            }
          }
          const maxTotal = Math.max(...results.map((r) => r.total));
          state.catalog[id] = uniqueMedia((state.catalog[id] || []).concat(filterReleasedCatalogItems(id, mixed)));
          state.catalogPage[id] = { page: next, total: maxTotal, loading: false, loaded: true, multiSrc: true };
          renderActiveGrid();
          return;
        }
        const body = await requestJson(tmdbUrl(list, next), 18);
        const items = filterReleasedCatalogItems(id, (body.results || []).map((item, index) => normalizeTmdb(item, list, (next - 1) * 20 + index)).filter(hasPoster));
        state.catalog[id] = uniqueMedia((state.catalog[id] || []).concat(items));
        state.catalogPage[id] = { page: next, total: body.total_pages || page.total || next, loading: false, loaded: true };
        renderActiveGrid();
      } catch (e) {
        page.loading = false;
      }
    }

    async function loadMoreFallback() {
      const sources = [
        { type: "trending", id: "tmdb-trending", title: "今日趋势" },
        { type: "airing", id: "tv-airing-today", title: "今日播出", mediaType: "tv" }
      ];
      if (preferenceItems().length) {
        useNostrRecommendationsIfReady();
        return;
      }
      const page = state.fallbackPage;
      if (page.loading || page.done) return;
      const source = sources[page.sourceIndex] || sources[0];
      if (page.total && page.page >= page.total) {
        page.done = true;
        return;
      }
      page.loading = true;
      try {
        const next = page.page + 1;
        const body = await requestJson(tmdbFallbackUrl(source.type, next), 18);
        const items = (body.results || [])
          .filter((item) => item.poster_path && (item.media_type === "movie" || item.media_type === "tv" || source.mediaType))
          .map((item, index) => normalizeTmdb(item, source, (next - 1) * 20 + index))
          .filter(hasPoster)
          .filter(isReleasedAsOfToday);
        state.fallback = uniqueMedia(state.fallback.concat(items));
        state.fallbackPage = { sourceIndex: page.sourceIndex, page: next, total: body.total_pages || page.total || next, loading: false, loaded: true, done: !items.length };
        renderActiveGrid();
      } catch (e) {
        page.loading = false;
      }
    }

    function loadMoreVisible() {
      if (homeUiRoute() === "secondary" && state.activeList === "all") {
        if (appendActiveGridBatch()) return;
        if (secondaryCanLoadMore()) secondaryLoadNextPage();
        return;
      }
      if (appendActiveGridBatch()) return;
      if (state.loadingMore || state.activeList === "recent" || state.activeList === "live") return;
      if (state.activeList === "all") {
        if (preferenceItems().length) {
          useNostrRecommendationsIfReady();
          return;
        }
        if (!nostrReadyForFallback()) return;
        state.recommendationSource = "fallback";
      }
      if (state.infiniteObserver) state.infiniteObserver.unobserve($("infiniteSentinel"));
      state.loadingMore = true;
      Promise.resolve(state.activeList === "all" ? loadMoreFallback() : loadMoreCatalog(state.activeList))
        .finally(() => {
          state.loadingMore = false;
          observeInfiniteScroll();
        });
    }

    async function loadEvents() {
      try {
        await sdk().cache.del(cacheKey("events"));
      } catch (e) {}
      scheduleRender();
    }

    async function clearLocalEvents(onlyMine) {
      await sdk().cache.del(cacheKey("events"));
      await hotClearIndex(onlyMine);
      scheduleRender();
    }

    async function forceRefreshNostrRanking() {
      if (forceRefreshNostrRanking.busy) return;
      forceRefreshNostrRanking.busy = true;
      const button = $("refreshNostrBtn");
      const oldText = button && button.textContent || "";
      if (button) button.textContent = "刷新中";
      try {
        setStatus("nostr", "刷新榜单中");
        toast("开始刷新 Nostr 榜单");
        updateNostrRefreshProgress({ active: true, phase: "清理索引", startedAt: Date.now(), finishedAt: 0, connected: 0, subscribeDone: 0, subEvents: 0, recentPages: 0, recentEvents: 0, historyPages: 0, historyEvents: 0, indexed: 0, relay: "" });
        const generation = resetRelaySubscribeState();
        clearRelayBackfillTimers();
        const ingestBarrier = state.hot.ingestQueue;
        await ingestBarrier.catch(() => {});
        await hotClearRankingIndexForRefresh();
        state.recommendationSource = "pending";
        renderMetrics();
        if (state.activeList === "all") renderActiveGrid();
        updateNostrRefreshProgress({ phase: "连接 relay", indexed: state.hot.items.length });
        subscribeNostr(generation);
      } catch (e) {
        setStatus("nostr", "刷新榜单失败");
        updateNostrRefreshProgress({ active: false, phase: "刷新失败", finishedAt: Date.now(), indexed: state.hot.items.length });
        toast(e.message || "刷新榜单失败");
      } finally {
        forceRefreshNostrRanking.busy = false;
        renderConnection();
      }
    }

    function allItems() {
      return Object.values(state.catalog).flat().filter(hasPoster);
    }

    function scoreItem(item) {
      return Math.max(0, 18 - item.baseRank) + (item.voteAverage || 0) * 1.2 + Math.min(item.popularity || 0, 200) * .04;
    }

    function watchedTenMinutes(content) {
      if (!content || content.action !== "watch") return false;
      const watchMs = Math.max(0, Number(content.watchMs || content.position || 0));
      return watchMs >= WATCH_HEAT_MS;
    }

    function hasHeatIntent(content) {
      const intent = String(content.intentAction || content.intent || "");
      return intent === "view" || intent === "search" || content.clicked === true || content.searched === true;
    }

    function eventUserKey(event) {
      if (event.pubkey) return event.pubkey;
      if (event.local && state.identity && state.identity.pubkey) return state.identity.pubkey;
      return "local";
    }

    function ranked(items) {
      return items.filter(hasPoster).slice().sort((a, b) => scoreItem(b) - scoreItem(a));
    }

    function uniqueMedia(items) {
      const map = new Map();
      items.filter(hasPoster).forEach((item) => {
        const key = mediaDomKey(item);
        if (key && !map.has(key)) map.set(key, item);
      });
      return Array.from(map.values());
    }

    function uniqueHistoryMedia(items) {
      const map = new Map();
      (Array.isArray(items) ? items : []).forEach((item, index) => {
        if (!item) return;
        const key = item.historyStableKey || item.historyKey || historyStableKey(item, historyKeyParts(item), index);
        if (key && !map.has(key)) map.set(key, item);
      });
      return Array.from(map.values());
    }

    async function loadBlockedRecommend() {
      try {
        const saved = safeJson(await sdk().cache.get(cacheKey("blockedRecommend")), null);
        const items = saved && saved.items && typeof saved.items === "object" ? saved.items : {};
        state.blocked.items = items;
      } catch (e) {
        state.blocked.items = {};
      }
      state.blocked.loaded = true;
    }

    async function saveBlockedRecommend() {
      const items = state.blocked.items || {};
      await sdk().cache.set(cacheKey("blockedRecommend"), JSON.stringify({ version: 1, items }));
    }

    function blockedKey(item) {
      return mediaHeatKey(item) || mediaDomKey(item);
    }

    function isBlocked(item) {
      const key = blockedKey(item);
      return !!(key && state.blocked.items && state.blocked.items[key]);
    }

    function filterBlocked(items) {
      if (state.blocked.selecting) return items || [];
      return (items || []).filter((item) => !isBlocked(item));
    }

    function blockableRecommendCard(el) {
      if (state.activeList !== "all" || uiSnapshotRoute() !== "home") return null;
      const card = el && el.closest && el.closest("#recommendRail .card");
      if (!card || !card.__mediaItem || card.__mediaItem.source === "history") return null;
      return card;
    }

    function currentRecommendationRail() {
      return $("recommendRail");
    }

    function updateBlockSelectUi() {
      document.body.classList.toggle("block-select-active", !!state.blocked.selecting);
      document.querySelectorAll("#recommendRail .card").forEach((card) => {
        card.classList.toggle("blocked", isBlocked(card.__mediaItem));
      });
      if ($("blockSelectHint")) {
        const count = Object.keys(state.blocked.items || {}).length;
        $("blockSelectHint").textContent = `屏蔽选择模式：按 OK 切换屏蔽，按返回退出${count ? ` · 已屏蔽 ${count} 个` : ""}`;
      }
      document.querySelectorAll(".home-block-select-hint").forEach((hint) => {
        const count = Object.keys(state.blocked.items || {}).length;
        hint.textContent = `屏蔽选择模式：按 OK 切换屏蔽，按返回退出${count ? ` · 已屏蔽 ${count} 个` : ""}`;
      });
    }

    function enterBlockSelectMode(card) {
      if (state.activeList !== "all" || uiSnapshotRoute() !== "home") return false;
      state.blocked.selecting = true;
      updateBlockSelectUi();
      renderActiveGrid();
      toast("屏蔽选择模式");
      requestAnimationFrame(() => {
        const key = card && (card.dataset.blockKey || card.dataset.mediaKey);
        const rail = currentRecommendationRail();
        const target = rail && (key && findByDataset(rail, "blockKey", key) || rail.querySelector(".card"));
        if (target) focusRemoteTarget(target);
      });
      return true;
    }

    function exitBlockSelectMode() {
      if (!state.blocked.selecting) return false;
      state.blocked.selecting = false;
      clearBlockLongPress();
      updateBlockSelectUi();
      renderActiveGrid();
      toast("已退出屏蔽选择");
      return true;
    }

    function clearBlockLongPress() {
      if (state.blocked.holdTimer) clearTimeout(state.blocked.holdTimer);
      state.blocked.holdTimer = 0;
      state.blocked.holdTarget = null;
      state.blocked.pointer = null;
    }

    function armBlockLongPress(card) {
      if (!card || state.blocked.selecting || state.blocked.holdTimer) return false;
      state.blocked.holdTarget = card;
      state.blocked.longPressFired = false;
      state.blocked.holdTimer = setTimeout(() => {
        state.blocked.holdTimer = 0;
        state.blocked.longPressFired = true;
        enterBlockSelectMode(card);
      }, 650);
      return true;
    }

    function consumeBlockCardEnterDown(card, event) {
      if (!card) return false;
      event.preventDefault();
      event.stopPropagation();
      if (state.blocked.selecting) {
        toggleBlockedCard(card);
        return true;
      }
      armBlockLongPress(card);
      return true;
    }

    function handleBlockCardEnterUp(event) {
      const card = state.blocked.holdTarget;
      if (!card) return false;
      event.preventDefault();
      event.stopPropagation();
      const longPressed = state.blocked.longPressFired;
      clearBlockLongPress();
      if (longPressed) {
        state.blocked.longPressFired = false;
        return true;
      }
      if (!state.blocked.selecting) card.click();
      return true;
    }

    function handleBlockPointerDown(card, event) {
      if (!card || state.blocked.selecting) return false;
      if (event.pointerType === "mouse" && event.button !== 0) return false;
      state.blocked.pointer = { id: event.pointerId, x: event.clientX || 0, y: event.clientY || 0 };
      armBlockLongPress(card);
      return true;
    }

    function handleBlockPointerMove(event) {
      const pointer = state.blocked.pointer;
      if (!pointer || pointer.id !== event.pointerId) return;
      const dx = Math.abs((event.clientX || 0) - pointer.x);
      const dy = Math.abs((event.clientY || 0) - pointer.y);
      if (dx > 12 || dy > 12) clearBlockLongPress();
    }

    function handleBlockPointerUp(event) {
      const pointer = state.blocked.pointer;
      if (!pointer || pointer.id !== event.pointerId) return false;
      const longPressed = state.blocked.longPressFired;
      clearBlockLongPress();
      if (longPressed) {
        state.blocked.longPressFired = false;
        state.blocked.suppressClickUntil = Date.now() + 700;
        event.preventDefault();
        event.stopPropagation();
        return true;
      }
      return false;
    }

    function recentWatchingCard(el) {
      const card = el && el.closest && el.closest(".recent-watching-card");
      return card && card.__mediaItem && card.__mediaItem.recentWatching ? card : null;
    }

    function clearRecentSinglePressPending() {
      const recentDelete = state.recentDelete;
      if (!recentDelete) return;
      if (recentDelete.pendingTimer) clearTimeout(recentDelete.pendingTimer);
      recentDelete.pendingTimer = 0;
      recentDelete.pendingKey = "";
      recentDelete.pendingCard = null;
    }

    function cancelRecentDeleteArm() {
      const recentDelete = state.recentDelete;
      if (!recentDelete) return false;
      const hadState = !!(recentDelete.armedKey || recentDelete.pendingKey || recentDelete.remotePressLocked);
      if (recentDelete.armedCard) recentDelete.armedCard.classList.remove("recent-delete-armed");
      clearRecentSinglePressPending();
      recentDelete.armedKey = "";
      recentDelete.armedCard = null;
      recentDelete.remotePressLocked = false;
      recentDelete.remotePressCard = null;
      recentDelete.remotePressKey = "";
      return hadState;
    }

    function armRecentDelete(card) {
      const item = card && card.__mediaItem;
      const key = recentWatchingMediaKey(item);
      if (!card || !key) return false;
      const recentDelete = state.recentDelete;
      if (recentDelete.armedCard && recentDelete.armedCard !== card) cancelRecentDeleteArm();
      clearRecentSinglePressPending();
      recentDelete.armedKey = key;
      recentDelete.armedCard = card;
      card.classList.add("recent-delete-armed");
      toast("再次按 OK 删除，按方向键取消");
      return true;
    }

    function openRecentWatchingDetail(card) {
      const source = card && card.__mediaItem;
      if (!source) return false;
      recordRecentNativeKeyFlow("RECENT_NATIVE_KEY_AT_DETAIL", source);
      if (source.continueContext && source.historyContextEntry) {
        if (openContinueWatchingContext(source, { returnTarget: card, autoResume: false })) return true;
      }
      if (source.source === "history") {
        openRecentItem(source, { returnTarget: card });
        return true;
      }
      const mediaType = normalizeHistoryMediaType(source.mediaType || source.media_type);
      const tmdbId = String(source.tmdbId || source.tmdb_id || "").trim();
      if (!tmdbId || (mediaType !== "movie" && mediaType !== "tv")) return false;
      // Recent Watching's short press is a normal Detail entry.  Keep the
      // stable media identity and presentation data, but do not carry any
      // Continue/History recovery context into openDetail().
      const item = Object.assign({}, source, {
        id: source.id || `tmdb:${mediaType}:${tmdbId}`,
        source: "tmdb",
        mediaType,
        tmdbId,
        nativeHistoryRaw: source.nativeHistoryRaw,
        nativeHistoryKey: source.nativeHistoryKey,
        nativeCid: source.nativeCid,
        nativeSiteKey: source.nativeSiteKey,
        nativeVodId: source.nativeVodId,
        recentWatching: false
      });
      delete item.continueContext;
      delete item.historyContextEntry;
      delete item.historyContextTarget;
      delete item.historyResume;
      delete item.historyPlayback;
      delete item.playbackContext;
      delete item.historyContext;
      delete item.resume;
      openDetail(item, { returnTarget: card });
      return true;
    }

    function beginRecentWatchingSinglePress(card) {
      const recentDelete = state.recentDelete;
      const key = recentWatchingMediaKey(card && card.__mediaItem);
      if (!card || !recentDelete || !key) return false;
      clearRecentSinglePressPending();
      recentDelete.pendingKey = key;
      recentDelete.pendingCard = card;
      recentDelete.pendingTimer = setTimeout(() => {
        const target = recentDelete.pendingCard;
        const targetKey = recentDelete.pendingKey;
        clearRecentSinglePressPending();
        if (!target || !target.__mediaItem || !target.isConnected) return;
        if (recentWatchingMediaKey(target.__mediaItem) !== targetKey) return;
        openRecentWatchingDetail(target);
      }, RECENT_DOUBLE_PRESS_WINDOW_MS);
      return true;
    }

    function consumeRecentWatchingPress(card) {
      const recentDelete = state.recentDelete;
      const key = recentWatchingMediaKey(card && card.__mediaItem);
      if (!card || !recentDelete || !key) return false;
      if (recentManageCard(card)) return toggleRecentManageSelection(card);
      if (recentDelete.armedKey) {
        if (recentDelete.armedKey === key) {
          deleteRecentWatchingMedia(card.__mediaItem, card).catch(() => {});
          return true;
        }
        cancelRecentDeleteArm();
        return beginRecentWatchingSinglePress(card);
      }
      if (recentDelete.pendingKey) {
        if (recentDelete.pendingKey === key) {
          clearRecentSinglePressPending();
          return armRecentDelete(card);
        }
        cancelRecentDeleteArm();
      }
      return beginRecentWatchingSinglePress(card);
    }

    function consumeRecentCardEnterDown(card, event) {
      if (!card) return false;
      const recentDelete = state.recentDelete;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      // A held OK may emit repeat keydowns.  They are not new press cycles.
      if (event.repeat || recentDelete.remotePressLocked) return true;
      recentDelete.remotePressLocked = true;
      recentDelete.remotePressCard = card;
      recentDelete.remotePressKey = recentWatchingMediaKey(card.__mediaItem);
      return true;
    }

    function handleRecentCardEnterUp(event) {
      const recentDelete = state.recentDelete;
      if (!recentDelete || !recentDelete.remotePressLocked || !recentDelete.remotePressCard) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      const card = recentDelete.remotePressCard;
      recentDelete.remotePressLocked = false;
      recentDelete.remotePressCard = null;
      recentDelete.remotePressKey = "";
      return consumeRecentWatchingPress(card);
    }

    function consumeRecentWatchingClick(card) {
      return consumeRecentWatchingPress(card);
    }

    function isRecentManagePage() {
      return homeUiRoute() === "secondary"
        && state.homeV14 && state.homeV14.secondaryListId === "recent";
    }

    function recentManageRuntime() {
      if (!state.recentManage) state.recentManage = { active: false, selectedKeys: {}, deleting: false, deleteArmed: false, deleteArmTimer: 0 };
      if (!state.recentManage.selectedKeys || typeof state.recentManage.selectedKeys !== "object") state.recentManage.selectedKeys = {};
      return state.recentManage;
    }

    function recentManageItems() {
      const recentState = state.recent || {};
      const recentItems = Array.isArray(recentState.items) ? recentState.items : [];
      const query = secondaryActiveQuery("recent");
      const source = recentState.loaded === true
        ? recentItems
        : query && Array.isArray(query.items) ? query.items : [];
      return uniqueRecentWatchingMedia(source);
    }

    function recentManageCard(card) {
      return !!(card
        && card.__mediaItem
        && card.closest
        && card.closest("#secondaryCatalogGrid")
        && isRecentManagePage()
        && recentManageRuntime().active
        && card.classList.contains("recent-watching-card"));
    }

    function recentManageSelectedCount() {
      return Object.keys(recentManageRuntime().selectedKeys || {}).length;
    }

    function recentManageSelectedItems() {
      const selected = recentManageRuntime().selectedKeys || {};
      return recentManageItems().filter((item) => !!selected[recentWatchingMediaKey(item)]).map((item) => Object.assign({}, item));
    }

    function cancelRecentManageDeleteArm() {
      const manage = recentManageRuntime();
      if (manage.deleteArmTimer) clearTimeout(manage.deleteArmTimer);
      manage.deleteArmTimer = 0;
      manage.deleteArmed = false;
    }

    function syncRecentManageCardStates() {
      const grid = $("secondaryCatalogGrid");
      const manage = recentManageRuntime();
      if (!grid) return;
      Array.from(grid.querySelectorAll(".recent-watching-card")).forEach((card) => {
        const key = recentWatchingMediaKey(card.__mediaItem);
        const selected = !!(manage.active && key && manage.selectedKeys[key]);
        card.classList.toggle("recent-batch-selected", selected);
        if (manage.active) card.setAttribute("aria-pressed", selected ? "true" : "false");
        else card.removeAttribute("aria-pressed");
      });
    }

    function updateRecentManageUi() {
      const page = $("secondaryCatalog");
      const head = page && page.querySelector(".secondary-page-head");
      const controls = $("recentManageControls");
      const manageButton = $("recentManageBtn");
      const actions = $("recentManageActions");
      const count = $("recentManageSelectedCount");
      const selectAll = $("recentManageSelectAll");
      const deleteButton = $("recentManageDelete");
      const cancel = $("recentManageCancel");
      const onRecent = isRecentManagePage();
      const manage = recentManageRuntime();
      const items = onRecent ? recentManageItems() : [];
      const availableKeys = {};
      items.forEach((item) => {
        const key = recentWatchingMediaKey(item);
        if (key) availableKeys[key] = true;
      });
      Object.keys(manage.selectedKeys).forEach((key) => {
        if (!availableKeys[key]) delete manage.selectedKeys[key];
      });
      const selectedCount = recentManageSelectedCount();
      const allSelected = !!items.length && selectedCount === items.length;
      if (head) head.classList.toggle("recent-manage-head", onRecent);
      if (page) page.classList.toggle("recent-manage-active", onRecent && manage.active);
      if (controls) controls.hidden = !onRecent;
      if (manageButton) manageButton.hidden = !onRecent || manage.active;
      if (actions) actions.hidden = !onRecent || !manage.active;
      if (count) count.textContent = `已选择 ${selectedCount} 项`;
      if (selectAll) {
        selectAll.textContent = allSelected ? "取消全选" : "全选";
        selectAll.disabled = !items.length || manage.deleting;
        selectAll.setAttribute("aria-pressed", allSelected ? "true" : "false");
      }
      if (deleteButton) {
        deleteButton.textContent = manage.deleting
          ? "正在删除…"
          : manage.deleteArmed ? `确认删除（${selectedCount}）` : selectedCount ? `删除所选（${selectedCount}）` : "删除所选";
        deleteButton.disabled = !selectedCount || manage.deleting;
      }
      if (cancel) cancel.disabled = manage.deleting;
      syncRecentManageCardStates();
    }

    function enterRecentManageMode() {
      if (!isRecentManagePage()) return false;
      const manage = recentManageRuntime();
      if (manage.deleting) return true;
      cancelRecentDeleteArm();
      cancelRecentManageDeleteArm();
      manage.active = true;
      manage.selectedKeys = {};
      manage.deleting = false;
      updateRecentManageUi();
      return true;
    }

    function exitRecentManageMode(options) {
      const opts = options || {};
      const manage = recentManageRuntime();
      if (!manage.active) return false;
      if (manage.deleting) {
        if (!opts.silent) toast("正在删除，请稍候");
        return true;
      }
      cancelRecentManageDeleteArm();
      manage.active = false;
      manage.selectedKeys = {};
      updateRecentManageUi();
      if (opts.focus && isTvLikeDevice() && isRecentManagePage()) {
        requestAnimationFrame(() => {
          if (isRecentManagePage() && !recentManageRuntime().active) focusRemoteTarget($("recentManageBtn"));
        });
      }
      return true;
    }

    function resetRecentManageState() {
      const manage = recentManageRuntime();
      cancelRecentManageDeleteArm();
      manage.active = false;
      manage.selectedKeys = {};
      manage.deleting = false;
      const page = $("secondaryCatalog");
      if (page) page.classList.remove("recent-manage-active");
      const head = page && page.querySelector(".secondary-page-head");
      if (head) head.classList.remove("recent-manage-head");
      const controls = $("recentManageControls");
      if (controls) controls.hidden = true;
      syncRecentManageCardStates();
    }

    function toggleRecentManageSelection(card) {
      const manage = recentManageRuntime();
      const item = card && card.__mediaItem;
      const key = recentWatchingMediaKey(item);
      if (!recentManageCard(card) || !key) return false;
      if (manage.deleting) return true;
      cancelRecentManageDeleteArm();
      if (manage.selectedKeys[key]) delete manage.selectedKeys[key];
      else manage.selectedKeys[key] = true;
      updateRecentManageUi();
      return true;
    }

    function toggleRecentManageSelectAll() {
      if (!isRecentManagePage()) return false;
      const manage = recentManageRuntime();
      if (manage.deleting) return true;
      const items = recentManageItems();
      cancelRecentManageDeleteArm();
      const selectedCount = recentManageSelectedCount();
      if (items.length && selectedCount === items.length) manage.selectedKeys = {};
      else {
        manage.selectedKeys = {};
        items.forEach((item) => {
          const key = recentWatchingMediaKey(item);
          if (key) manage.selectedKeys[key] = true;
        });
      }
      updateRecentManageUi();
      return true;
    }

    function armRecentManageDelete() {
      if (!isRecentManagePage()) return false;
      const manage = recentManageRuntime();
      const count = recentManageSelectedCount();
      if (manage.deleting || !count) return true;
      if (manage.deleteArmed) {
        cancelRecentManageDeleteArm();
        deleteRecentWatchingBatch(recentManageSelectedItems()).catch(() => {
          const current = recentManageRuntime();
          current.deleting = false;
          updateRecentManageUi();
        });
        return true;
      }
      manage.deleteArmed = true;
      if (manage.deleteArmTimer) clearTimeout(manage.deleteArmTimer);
      manage.deleteArmTimer = setTimeout(() => {
        manage.deleteArmTimer = 0;
        manage.deleteArmed = false;
        updateRecentManageUi();
      }, 2800);
      updateRecentManageUi();
      toast(`再次确认删除 ${count} 项最近观看`);
      return true;
    }

    function handleRecentManageCancel() {
      if (!isRecentManagePage()) return false;
      return exitRecentManageMode({ focus: true });
    }

    function nativeHistoryDeleteCandidates(item, mediaKey, sourceItems) {
      const nativeItems = Array.isArray(sourceItems)
        ? sourceItems
        : state.recent && Array.isArray(state.recent.items) ? state.recent.items : [];
      if (!nativeItems.length || !mediaKey) return [];
      return nativeItems.filter((nativeItem) => recentWatchingMediaKey(nativeItem) === mediaKey);
    }

    function nativeHistoryHttpOrigin(value) {
      let candidate = String(value || "").trim();
      if (!candidate) return "";
      if (!/^https?:\/\//i.test(candidate)) {
        if (!/^[^\s/]+(?::\d+)?$/.test(candidate)) return "";
        candidate = "http://" + candidate;
      }
      try {
        if (typeof URL === "function") {
          const parsed = new URL(candidate);
          if (/^https?:$/i.test(parsed.protocol)) return parsed.origin;
        }
      } catch (e) {}
      const match = candidate.match(/^(https?:\/\/[^/]+)/i);
      return match ? match[1].replace(/\/+$/, "") : "";
    }

    function nativeHistoryDeleteBaseUrl(device) {
      const envelope = device && typeof device === "object" ? device : {};
      let body = envelope.body;
      if (typeof body === "string") body = safeJson(body, null);
      const source = body && typeof body === "object"
        ? Object.assign({}, envelope, body)
        : envelope.info && typeof envelope.info === "object"
          ? Object.assign({}, envelope, envelope.info)
          : device || {};
      const candidates = [source.ip, source.baseUrl, source.baseURL, source.httpUrl, source.http]
        .map((value) => nativeHistoryHttpOrigin(value))
        .filter(Boolean);
      if (candidates.length) return candidates[0];
      return nativeHistoryHttpOrigin(envelope.url);
    }

    async function nativeHistoryLocalRequestContext(path) {
      const native = window.fm || null;
      const api = native || sdk();
      let request = null;
      if (native && typeof native.req === "function") {
        request = (url, options) => native.req.call(native, url, options);
      } else if (native && native.net && typeof native.net.request === "function") {
        request = (url, options) => native.net.request.call(native.net, url, options);
      } else if (api && typeof api.req === "function") {
        request = (url, options) => api.req.call(api, url, options);
      } else if (api && api.net && typeof api.net.request === "function") {
        request = (url, options) => api.net.request.call(api.net, url, options);
      }
      if (!request) return { error: "REQUEST_UNAVAILABLE" };
      let device = null;
      try {
        if (native && typeof native.device === "function") device = await native.device.call(native);
        else if (native && native.device && typeof native.device.info === "function") device = await native.device.info.call(native.device);
        else if (native && native.device && typeof native.device.info === "object") device = native.device.info;
        else if (api && typeof api.device === "function") device = await api.device.call(api);
        else if (api && api.device && typeof api.device.info === "function") device = await api.device.info.call(api.device);
        else if (api && api.device && typeof api.device.info === "object") device = api.device.info;
      } catch (e) {
        return { error: "DEVICE_INFO_FAILED", message: String(e && e.message || e || "") };
      }
      const baseUrl = nativeHistoryDeleteBaseUrl(device);
      if (!baseUrl) return { error: "LOCAL_API_ADDRESS_UNAVAILABLE" };
      return { request, endpoint: baseUrl + String(path || "") };
    }

    function nativeHistoryDeleteBody(response) {
      const hasNestedBody = !!(response && (response.body != null || response.data != null));
      const body = response && response.body != null ? response.body : response && response.data;
      if (body && typeof body === "object") return body;
      if (typeof body === "string") return safeJson(body, {});
      if (!hasNestedBody && response && typeof response === "object") {
        const resultKeys = ["total", "deleted", "skipped", "failed", "items", "success", "action", "affected", "message"];
        if (resultKeys.some((key) => Object.prototype.hasOwnProperty.call(response, key))) return response;
      }
      return {};
    }

    function nativeHistoryDeleteRawResponse(response) {
      if (response && response.body != null) return response.body;
      if (response && response.data != null) return response.data;
      return response;
    }

    function nativeHistoryDeleteDiagnosticText(value) {
      if (value == null) return "";
      if (typeof value === "string") return value.slice(0, 500);
      try { return JSON.stringify(value).slice(0, 500); } catch (e) { return String(value).slice(0, 500); }
    }

    function isNativeHistoryDeleteProbeRequested() {
      const search = String(window.location && window.location.search || "");
      try {
        return new URLSearchParams(search).get("_native_delete_probe") === "1";
      } catch (e) {
        return /(?:^|[?&])_native_delete_probe=1(?:&|$)/.test(search);
      }
    }

    async function probeNativeHistoryDeleteRoutes() {
      const paths = [
        "/api/playback/progress",
        "/api/playback/progress/delete",
        "/playback/progress/delete"
      ];
      const probes = [];
      for (const path of paths) {
        const requestContext = await nativeHistoryLocalRequestContext(path);
        const probe = {
          PROBE_URL: String(requestContext && requestContext.endpoint || ""),
          PROBE_STATUS: 0,
          PROBE_BODY: "",
          PROBE_ERROR: "",
          PROBE_HEADERS: {}
        };
        if (!requestContext || typeof requestContext.request !== "function") {
          probe.PROBE_ERROR = String(requestContext && requestContext.message || requestContext && requestContext.error || "REQUEST_UNAVAILABLE");
          probes.push(probe);
          continue;
        }
        try {
          const response = await requestContext.request(requestContext.endpoint, {
            method: "OPTIONS",
            responseType: "text",
            timeout: 24,
            headers: { Accept: "application/json" }
          });
          probe.PROBE_STATUS = Number(response && (response.status || response.code) || 0);
          probe.PROBE_BODY = nativeHistoryDeleteDiagnosticText(nativeHistoryDeleteRawResponse(response)).slice(0, 300);
          probe.PROBE_HEADERS = response && response.headers && typeof response.headers === "object" ? response.headers : {};
        } catch (e) {
          probe.PROBE_ERROR = String(e && e.message || e || "REQUEST_FAILED");
        }
        probes.push(probe);
      }
      const diag = { requestedAt: Date.now(), probes };
      state.tvDiag.nativeHistoryDeleteProbe = diag;
      try { console.debug("[Nostr TV][NATIVE_DELETE_ROUTE_PROBE]", diag); } catch (e) {}
      if (isTvDiagnosticEnabled()) updateTvDiagnostic();
      return probes;
    }

    function recordNativeHistoryDeleteDiag(payload, status, data, rawResponse, endpoint) {
      const body = data && typeof data === "object" ? data : {};
      const items = Array.isArray(body.items) ? body.items : [];
      const item = items[0] && typeof items[0] === "object" ? items[0] : {};
      const rawText = nativeHistoryDeleteDiagnosticText(rawResponse);
      const diag = {
        NATIVE_DELETE_ENDPOINT: String(endpoint || ""),
        NATIVE_DELETE_REQUEST: {
          historyKey: String(payload && payload.historyKey || ""),
          siteKey: String(payload && payload.siteKey || ""),
          vodId: String(payload && payload.vodId || ""),
          cid: payload && payload.cid != null ? payload.cid : ""
        },
        NATIVE_DELETE_HTTP_STATUS: Number(status || 0),
        NATIVE_DELETE_BATCH_TOTAL: Number(body.total || 0),
        NATIVE_DELETE_BATCH_APPLIED: Number(body.applied || 0),
        NATIVE_DELETE_BATCH_CREATED: Number(body.created || 0),
        NATIVE_DELETE_BATCH_UPDATED: Number(body.updated || 0),
        NATIVE_DELETE_BATCH_DELETED: Number(body.deleted || 0),
        NATIVE_DELETE_BATCH_SKIPPED: Number(body.skipped || 0),
        NATIVE_DELETE_BATCH_FAILED: Number(body.failed || 0),
        NATIVE_DELETE_ITEM_ACTION: String(item.action || ""),
        NATIVE_DELETE_ITEM_MESSAGE: String(item.message || ""),
        NATIVE_DELETE_ITEM_HISTORY_KEY: String(item.historyKey || ""),
        NATIVE_DELETE_ITEM_SITE_KEY: String(item.siteKey || ""),
        NATIVE_DELETE_ITEM_VOD_ID: String(item.vodId || ""),
        NATIVE_DELETE_RAW_RESPONSE: rawText,
        NATIVE_DELETE_PARSED_BODY: body,
        NATIVE_DELETE_RESPONSE: body
      };
      state.tvDiag.nativeHistoryDelete = diag;
      try { console.debug("NATIVE_DELETE_RAW_RESPONSE =", rawResponse); } catch (e) {}
      try { console.debug("NATIVE_DELETE_PARSED_BODY =", body); } catch (e) {}
      try { console.debug("[Nostr TV][NATIVE_DELETE_DIAG]", JSON.stringify(diag)); } catch (e) {}
      if (isTvDiagnosticEnabled()) updateTvDiagnostic();
      return diag;
    }

    async function deleteNativeHistoryViaLocalApi(history) {
      const requestContext = await nativeHistoryLocalRequestContext("/api/playback/progress/delete");
      if (!requestContext || typeof requestContext.request !== "function") {
        return { ok: false, status: 0, reason: requestContext && requestContext.error || "REQUEST_UNAVAILABLE", message: requestContext && requestContext.message || "" };
      }
      const request = requestContext.request;
      const endpoint = requestContext.endpoint;
      const parts = historyKeyParts(history);
      const context = historyPlaybackContext(history) || {};
      const historyKey = String(history && (history.nativeHistoryKey || history.historyKey || history.key) || parts.key || "").trim();
      const siteKey = String(history && history.siteKey || parts.siteKey || context.siteKey || "").trim();
      const vodId = String(history && history.vodId || parts.vodId || context.vodId || "").trim();
      const cid = String(history && history.cid != null && String(history.cid).trim() ? history.cid : parts.cid || context.cid || "").trim();
      const payload = {};
      if (historyKey) payload.historyKey = historyKey;
      if (siteKey) payload.siteKey = siteKey;
      if (vodId) payload.vodId = vodId;
      if (cid) payload.cid = /^\d+$/.test(cid) ? Number(cid) : cid;
      if (!payload.historyKey && (!payload.siteKey || !payload.vodId)) {
        return { ok: false, status: 0, reason: "NATIVE_HISTORY_KEY_UNAVAILABLE" };
      }
      let response;
      try {
        response = await request(endpoint, {
          method: "POST",
          responseType: "json",
          timeout: 24,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        const message = String(e && e.message || e || "");
        recordNativeHistoryDeleteDiag(payload, 0, { message }, { message }, endpoint);
        return { ok: false, status: 0, reason: "REQUEST_FAILED", endpoint, payload, message: String(e && e.message || e || "") };
      }
      const rawResponse = nativeHistoryDeleteRawResponse(response);
      const data = nativeHistoryDeleteBody(response);
      const status = Number(response && (response.status || response.code) || 0);
      const apiCode = Number(data && data.code);
      const effectiveStatus = status || (apiCode >= 100 ? apiCode : 0);
      const result = { ok: false, status: effectiveStatus, endpoint, payload, data };
      recordNativeHistoryDeleteDiag(payload, effectiveStatus, data, rawResponse, endpoint);
      if (effectiveStatus === 404 || apiCode === 404) {
        result.reason = "ENDPOINT_NOT_FOUND";
        return result;
      }
      if (effectiveStatus === 403 || apiCode === 403) {
        result.reason = "FORBIDDEN";
        result.message = String(data && (data.message || data.error) || "本机 API 修改未开启");
        return result;
      }
      if (response && response.error) {
        result.reason = "REQUEST_ERROR";
        result.message = String(response.error);
        return result;
      }
      if (response && response.ok === false || effectiveStatus >= 400) {
        result.reason = "HTTP_ERROR";
        result.message = String(data && (data.message || data.error) || "HTTP " + effectiveStatus);
        return result;
      }
      const items = Array.isArray(data && data.items) ? data.items : [];
      const deleted = Number(data && data.deleted || 0);
      const skipped = Number(data && data.skipped || 0);
      const failed = Number(data && data.failed || 0);
      const singleAction = String(data && data.action || "").toLowerCase();
      const singleAffected = Number(data && data.affected || 0);
      const singleSuccess = data && data.success === true && singleAction === "deleted" && singleAffected > 0;
      const singleFailure = data && data.success === false || singleAction === "skipped" || singleAction === "failed";
      const hasFailedItem = items.some((item) => String(item && item.action || "").toLowerCase() === "failed");
      const hasSkippedItem = items.some((item) => String(item && item.action || "").toLowerCase() === "skipped");
      const hasDeletedItem = items.some((item) => String(item && item.action || "").toLowerCase() === "deleted" && Number(item && item.affected || 0) > 0);
      const confirmed = !singleFailure && !hasFailedItem && failed <= 0
        && !hasSkippedItem && skipped <= 0
        && (deleted > 0 || hasDeletedItem || singleSuccess);
      if (!confirmed) {
        result.reason = singleFailure || hasFailedItem || failed > 0 ? "DELETE_FAILED" : hasSkippedItem || skipped > 0 ? "DELETE_SKIPPED" : "DELETE_NOT_CONFIRMED";
        const firstItem = items[0] && typeof items[0] === "object" ? items[0] : {};
        const message = String(firstItem.message || data && (data.message || data.error) || "");
        result.message = message || ("原生历史删除未确认｜HTTP:" + effectiveStatus + "｜BODY:" + nativeHistoryDeleteDiagnosticText(rawResponse));
        return result;
      }
      result.ok = true;
      result.reason = "DELETED";
      return result;
    }

    function nativeHistoryDeleteFailureText(result) {
      const item = result || {};
      if (item.reason === "FORBIDDEN") return "原生历史删除受 App 设置限制：" + (item.message || "本机 API 修改未开启");
      if (item.reason === "ENDPOINT_NOT_FOUND") return "当前 App 未提供原生历史删除接口";
      if (item.reason === "LOCAL_API_ADDRESS_UNAVAILABLE" || item.reason === "REQUEST_UNAVAILABLE") return "当前 App 未暴露可用的原生历史删除接口";
      if (["DELETE_FAILED", "DELETE_SKIPPED", "DELETE_NOT_CONFIRMED"].includes(item.reason) && item.message) return item.message;
      return "最近观看删除失败" + (item.message ? "：" + item.message : "");
    }

    async function readFreshNativeHistoryItemsForDeletion() {
      const list = await sdk().history();
      const rawItems = (Array.isArray(list) ? list : [])
        .map((history, index) => ({ history, index }))
        .filter((entry) => entry.history && typeof entry.history === "object");
      return rawItems.map((entry) => normalizeHistoryItem(entry.history, entry.index));
    }

    function nativeHistoryDeleteIdentityKey(item) {
      const raw = item && item.nativeHistoryRaw && typeof item.nativeHistoryRaw === "object"
        ? item.nativeHistoryRaw
        : item || {};
      const parts = historyKeyParts(raw);
      const historyKey = String(raw.key || raw.historyKey || item && (item.nativeHistoryKey || item.historyKey) || parts.key || "").trim();
      if (historyKey) return "key:" + historyKey;
      const siteKey = String(raw.siteKey || item && (item.nativeSiteKey || item.siteKey) || parts.siteKey || "").trim();
      const vodId = String(raw.vodId || item && (item.nativeVodId || item.vodId) || parts.vodId || "").trim();
      const cid = String(raw.cid != null ? raw.cid : item && item.nativeCid != null ? item.nativeCid : parts.cid || "").trim();
      return "identity:" + siteKey + "\u001f" + vodId + "\u001f" + cid;
    }

    function uniqueNativeHistoryDeleteCandidates(items) {
      const seen = new Set();
      return (Array.isArray(items) ? items : []).filter((item) => {
        const identity = nativeHistoryDeleteIdentityKey(item);
        if (!identity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
    }

    function freezeNativeHistoryDeleteIdentity(item) {
      const raw = item && item.nativeHistoryRaw && typeof item.nativeHistoryRaw === "object"
        ? item.nativeHistoryRaw
        : item || {};
      const parts = historyKeyParts(raw);
      const historyKey = String(raw.key || raw.historyKey || item && (item.nativeHistoryKey || item.historyKey) || parts.key || "").trim();
      const siteKey = String(raw.siteKey || raw.site || item && (item.nativeSiteKey || item.siteKey) || parts.siteKey || "").trim();
      const vodId = String(raw.vodId || raw.videoId || item && (item.nativeVodId || item.vodId) || parts.vodId || "").trim();
      const cid = String(raw.cid != null
        ? raw.cid
        : item && item.nativeCid != null
          ? item.nativeCid
          : parts.cid || "").trim();
      return Object.freeze({
        identityKey: nativeHistoryDeleteIdentityKey(item),
        nativeHistoryRaw: Object.assign({}, raw),
        key: historyKey,
        historyKey,
        nativeHistoryKey: historyKey,
        cid,
        nativeCid: cid,
        siteKey,
        nativeSiteKey: siteKey,
        vodId,
        nativeVodId: vodId
      });
    }

    function nativeHistoryDeleteFrozenPresent(snapshot, frozenIdentities) {
      const frozen = Array.isArray(frozenIdentities) ? frozenIdentities : [];
      const present = new Set((Array.isArray(snapshot) ? snapshot : [])
        .map((item) => nativeHistoryDeleteIdentityKey(item))
        .filter(Boolean));
      return frozen.filter((identity) => identity && present.has(identity.identityKey));
    }

    async function deleteNativeHistoryMediaGroupVerified(item, mediaKey) {
      const maxRounds = 3;
      const retryDelay = 220;
      let memberCountBefore = 0;
      let lastMessage = "";
      let frozenNativeIdentities = null;
      for (let round = 0; round < maxRounds; round++) {
        let snapshot;
        try {
          snapshot = await readFreshNativeHistoryItemsForDeletion();
        } catch (e) {
          return {
            ok: false,
            reason: "HISTORY_READ_FAILED",
            message: String(e && e.message || e || "最近观看刷新失败"),
            rounds: round + 1,
            memberCountBefore,
            frozenNativeIdentities: frozenNativeIdentities || []
          };
        }
        if (!frozenNativeIdentities) {
          const groupedCandidates = uniqueNativeHistoryDeleteCandidates(nativeHistoryDeleteCandidates(item, mediaKey, snapshot));
          frozenNativeIdentities = groupedCandidates.map(freezeNativeHistoryDeleteIdentity);
          memberCountBefore = frozenNativeIdentities.length;
        }
        const candidates = nativeHistoryDeleteFrozenPresent(snapshot, frozenNativeIdentities);
        if (!frozenNativeIdentities.length || !candidates.length) {
          return { ok: true, rounds: round + 1, memberCountBefore, remaining: 0, frozenNativeIdentities };
        }
        for (const nativeIdentity of candidates) {
          const result = await deleteNativeHistoryViaLocalApi(nativeIdentity);
          if (!result.ok) {
            return {
              ok: false,
              reason: result.reason || "DELETE_FAILED",
              message: result.message || "",
              rounds: round + 1,
              memberCountBefore,
              remaining: candidates.length,
              frozenNativeIdentities
            };
          }
          lastMessage = String(result.message || lastMessage || "");
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        let verification;
        try {
          verification = await readFreshNativeHistoryItemsForDeletion();
        } catch (e) {
          return {
            ok: false,
            reason: "HISTORY_READ_FAILED",
            message: String(e && e.message || e || "最近观看刷新失败"),
            rounds: round + 1,
            memberCountBefore,
            frozenNativeIdentities
          };
        }
        const remaining = nativeHistoryDeleteFrozenPresent(verification, frozenNativeIdentities);
        if (!remaining.length) {
          return { ok: true, rounds: round + 1, memberCountBefore, remaining: 0, frozenNativeIdentities };
        }
        if (round === maxRounds - 1) {
          return {
            ok: false,
            reason: "DELETE_NOT_CONFIRMED",
            message: lastMessage || "原生历史删除未确认",
            rounds: maxRounds,
            memberCountBefore,
            remaining: remaining.length,
            frozenNativeIdentities
          };
        }
      }
      return {
        ok: false,
        reason: "DELETE_NOT_CONFIRMED",
        message: "原生历史删除未确认",
        memberCountBefore,
        frozenNativeIdentities: frozenNativeIdentities || []
      };
    }

    async function deleteRecentWatchingBatch(items) {
      if (!isRecentManagePage()) return false;
      const manage = recentManageRuntime();
      if (manage.deleting) return true;
      const frozenItems = (Array.isArray(items) ? items : [])
        .map((item) => Object.assign({}, item))
        .filter((item) => !!recentWatchingMediaKey(item));
      if (!frozenItems.length) {
        updateRecentManageUi();
        return false;
      }
      manage.deleting = true;

      try {
        cancelRecentManageDeleteArm();
        cancelRecentDeleteArm();
        updateRecentManageUi();
        let historyContextReady = false;
        let continueIndexReady = false;
        let initialSnapshot = null;
        let fatalReason = "";
        try {
          await loadContinueIndex();
          await loadHistoryContextIndex();
          historyContextReady = !(state.historyContexts && state.historyContexts.diag && state.historyContexts.diag.error);
          continueIndexReady = !(state.continueIndex && state.continueIndex.diag && state.continueIndex.diag.error);
          if (!historyContextReady || !continueIndexReady) fatalReason = "LOCAL_CONTEXT_READ_FAILED";
          else initialSnapshot = await readFreshNativeHistoryItemsForDeletion();
        } catch (e) {
          fatalReason = "HISTORY_READ_FAILED";
        }

        const previousContexts = historyContextReady && state.historyContexts && Array.isArray(state.historyContexts.entries)
          ? state.historyContexts.entries.slice() : [];
        const previousContinue = continueIndexReady && state.continueIndex && Array.isArray(state.continueIndex.entries)
          ? state.continueIndex.entries.slice() : [];
        const groups = frozenItems.map((item) => {
          const key = recentWatchingMediaKey(item);
          const frozenNativeIdentities = initialSnapshot
            ? uniqueNativeHistoryDeleteCandidates(nativeHistoryDeleteCandidates(item, key, initialSnapshot)).map(freezeNativeHistoryDeleteIdentity)
            : [];
          const nativeExpected = !!String(item.nativeHistoryKey || "").trim() || frozenNativeIdentities.length > 0;
          const localMatch = previousContexts.some((entry) => recentContextMediaKey(entry) === key)
            || previousContinue.some((entry) => String(entry && entry.mediaKey || recentContextMediaKey(entry)) === key);
          return {
            key,
            item,
            frozenNativeIdentities,
            nativeExpected,
            nativeVerified: !nativeExpected || !frozenNativeIdentities.length,
            localMatch,
            failed: !!fatalReason,
            message: fatalReason
          };
        });

        let localCleanupFailed = false;
        let renderFailed = false;
        const finish = async (refreshAllowed) => {
        const successfulKeys = {};
        groups.forEach((group) => {
          if (!group.failed && group.nativeVerified && (group.nativeExpected || group.localMatch)) successfulKeys[group.key] = true;
          if (!group.nativeExpected && !group.localMatch) group.failed = true;
        });
        const successfulList = Object.keys(successfulKeys);
        if (historyContextReady && successfulList.length) {
          const nextContexts = previousContexts.filter((entry) => !successfulKeys[recentContextMediaKey(entry)]);
          if (nextContexts.length !== previousContexts.length) {
            try {
              await persistHistoryContextEntries(nextContexts);
              if (state.historyContexts) state.historyContexts.entries = nextContexts;
            } catch (e) {
              localCleanupFailed = true;
            }
          }
        }
        if (continueIndexReady && successfulList.length) {
          const nextContinue = previousContinue.filter((entry) => !successfulKeys[String(entry && entry.mediaKey || recentContextMediaKey(entry))]);
          if (nextContinue.length !== previousContinue.length) {
            try {
              await persistContinueIndexEntries(nextContinue);
              if (state.continueIndex) state.continueIndex.entries = nextContinue;
            } catch (e) {
              localCleanupFailed = true;
            }
          }
        }
        let refreshFailed = false;
        const recentBeforeRefresh = state.recent && Array.isArray(state.recent.items) ? state.recent.items.slice() : [];
        if (refreshAllowed) {
          try {
            await loadRecentList({ refresh: true, silent: true });
            if (state.recent && state.recent.error) {
              refreshFailed = true;
              state.recent.items = recentBeforeRefresh;
            }
          } catch (e) {
            refreshFailed = true;
            if (state.recent) state.recent.items = recentBeforeRefresh;
          }
        }
        if (refreshFailed && successfulList.length && state.recent && Array.isArray(state.recent.items)) {
          state.recent.items = state.recent.items.filter((item) => !successfulKeys[recentWatchingMediaKey(item)]);
        }
        if (isRecentManagePage()) {
          const query = secondaryActiveQuery("recent") || secondaryGetQuery("recent");
          query.items = state.recent && Array.isArray(state.recent.items) ? state.recent.items.slice() : [];
          query.loaded = true;
          query.loading = false;
          query.error = refreshFailed ? "最近观看刷新失败" : "";
          query.page = 1;
          query.totalPages = 1;
          query.totalResults = query.items.length;
          query.hasMore = false;
          try {
            renderSecondaryCatalog();
          } catch (e) {
            renderFailed = true;
          }
        }
        successfulList.forEach((key) => { delete manage.selectedKeys[key]; });
        manage.deleting = false;
        manage.deleteArmed = false;
        updateRecentManageUi();
        const failedGroups = groups.filter((group) => group.failed);
        let resultMessage = "";
        if (successfulList.length && failedGroups.length) resultMessage = `已删除 ${successfulList.length} 项，${failedGroups.length} 项删除失败`;
        else if (successfulList.length) resultMessage = `已删除 ${successfulList.length} 项`;
        else if (failedGroups.length) resultMessage = `删除失败，${failedGroups.length} 项未删除`;
        if (localCleanupFailed) resultMessage += resultMessage ? "，但本地续播状态清理失败" : "本地续播状态清理失败";
        if (resultMessage) toast(resultMessage);
        if (refreshFailed) toast("最近观看刷新失败");
        if (renderFailed) toast("最近观看界面刷新失败");
        requestAnimationFrame(() => {
          if (!isRecentManagePage()) return;
          const grid = $("secondaryCatalogGrid");
          const cards = grid ? Array.from(grid.querySelectorAll(".recent-watching-card")).filter(canFastHomeFocus) : [];
          const failedKeys = failedGroups.map((group) => group.key);
          let target = failedKeys.length
            ? cards.find((card) => failedKeys.indexOf(recentWatchingMediaKey(card.__mediaItem)) >= 0)
            : cards[0];
          if (!target) target = $("secondaryCatalogBack");
          if (target && isTvLikeDevice()) focusRemoteTarget(target);
        });
        return successfulList.length > 0;
        };

        if (fatalReason) return await finish(false);
        const maxRounds = 3;
        const retryDelay = 220;
        let snapshot = initialSnapshot || [];
        for (let round = 0; round < maxRounds; round++) {
          const pendingGroups = groups.filter((group) => !group.failed && group.nativeExpected && !group.nativeVerified);
          if (!pendingGroups.length) break;
          for (const group of pendingGroups) {
            const present = nativeHistoryDeleteFrozenPresent(snapshot, group.frozenNativeIdentities);
            for (const nativeIdentity of present) {
              try {
                await deleteNativeHistoryViaLocalApi(nativeIdentity);
              } catch (e) {
                group.message = String(e && e.message || e || "DELETE_FAILED");
              }
            }
          }
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          try {
            snapshot = await readFreshNativeHistoryItemsForDeletion();
          } catch (e) {
            pendingGroups.forEach((group) => {
              group.failed = true;
              group.message = "HISTORY_READ_FAILED";
            });
            break;
          }
          pendingGroups.forEach((group) => {
            const remaining = nativeHistoryDeleteFrozenPresent(snapshot, group.frozenNativeIdentities);
            if (!remaining.length) group.nativeVerified = true;
            else if (round === maxRounds - 1) {
              group.failed = true;
              group.message = "DELETE_NOT_CONFIRMED";
            }
          });
        }
        groups.forEach((group) => {
          if (group.nativeExpected && !group.nativeVerified && !group.failed) {
            group.failed = true;
            group.message = "DELETE_NOT_CONFIRMED";
          }
        });
        return await finish(true);
      } catch (e) {
        toast("最近观看批量删除未完成，请重试");
        return false;
      } finally {
        manage.deleting = false;
        manage.deleteArmed = false;
        cancelRecentManageDeleteArm();
        try { updateRecentManageUi(); } catch (e) {}
      }
    }

    async function deleteRecentWatchingMedia(item, card) {
      if (isRecentManagePage() && recentManageRuntime().active) return false;
      const key = recentWatchingMediaKey(item);
      if (!key) return false;
      const grid = card && card.closest && card.closest("#homeRecentRail, #secondaryCatalogGrid, .list-panel:not([hidden]) .media-grid");
      const beforeCards = grid ? Array.from(grid.querySelectorAll(".recent-watching-card")) : [];
      const focusIndex = Math.max(0, beforeCards.indexOf(card));
      cancelRecentDeleteArm();
      await loadContinueIndex();
      await loadHistoryContextIndex();
      const historyContextReady = !(state.historyContexts && state.historyContexts.diag && state.historyContexts.diag.error);
      const continueIndexReady = !(state.continueIndex && state.continueIndex.diag && state.continueIndex.diag.error);
      const previous = historyContextReady && state.historyContexts && Array.isArray(state.historyContexts.entries)
        ? state.historyContexts.entries
        : [];
      const entries = historyContextReady
        ? previous.filter((entry) => recentContextMediaKey(entry) !== key)
        : previous;
      const previousIndex = continueIndexReady && state.continueIndex && Array.isArray(state.continueIndex.entries)
        ? state.continueIndex.entries
        : [];
      const indexEntries = continueIndexReady
        ? previousIndex.filter((entry) => String(entry && entry.mediaKey || recentContextMediaKey(entry)) !== key)
        : previousIndex;
      const nativeHistoryKey = String(item && item.nativeHistoryKey || "").trim();
      const hasNativeHistory = !!nativeHistoryKey;
      let nativeVerification = null;
      if (hasNativeHistory) {
        nativeVerification = await deleteNativeHistoryMediaGroupVerified(item, key);
        if (!nativeVerification.ok) {
          toast(nativeHistoryDeleteFailureText(nativeVerification));
          return false;
        }
      } else {
        if (!historyContextReady || !continueIndexReady) {
          toast("最近观看删除失败");
          return false;
        }
        if (entries.length === previous.length && indexEntries.length === previousIndex.length) return false;
      }
      if (historyContextReady && entries.length !== previous.length) await persistHistoryContextEntries(entries);
      if (continueIndexReady && indexEntries.length !== previousIndex.length) await persistContinueIndexEntries(indexEntries);
      if (historyContextReady && state.historyContexts) state.historyContexts.entries = entries;
      if (continueIndexReady && state.continueIndex) state.continueIndex.entries = indexEntries;
      if (hasNativeHistory) {
        try {
          await loadRecentList({ refresh: true, silent: true });
        } catch (e) {
          toast("最近观看刷新失败");
          return false;
        }
        const nativeResidual = nativeHistoryDeleteFrozenPresent(
          state.recent.items || [],
          nativeVerification && nativeVerification.frozenNativeIdentities
        ).length > 0;
        if (nativeResidual) {
          toast(nativeHistoryDeleteFailureText({
            reason: "DELETE_NOT_CONFIRMED",
            message: "原生历史删除未确认"
          }));
          return false;
        }
      }
      if (isHomeRouteActive()) renderHomeRecent();
      if (state.activeList === "recent") renderRecentList();
      if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === "recent") {
        const query = secondaryActiveQuery("recent") || secondaryGetQuery("recent");
        query.items = state.recent.items.slice();
        query.loaded = true;
        query.loading = false;
        query.error = "";
        query.page = 1;
        query.totalPages = 1;
        query.totalResults = query.items.length;
        query.hasMore = false;
        renderSecondaryCatalog();
      }
      toast("已删除最近观看");
      requestAnimationFrame(() => {
        let targetGrid = grid;
        if (grid && grid.id === "homeRecentRail") targetGrid = $("homeRecentRail");
        else if (grid && grid.id === "secondaryCatalogGrid") targetGrid = $("secondaryCatalogGrid");
        const cards = targetGrid ? Array.from(targetGrid.querySelectorAll(".recent-watching-card")).filter(canFastHomeFocus) : [];
        let target = cards.length ? cards[Math.min(focusIndex, cards.length - 1)] : null;
        if (!target && targetGrid && targetGrid.id === "secondaryCatalogGrid") target = $("secondaryCatalogBack");
        if (!target && targetGrid && targetGrid.id === "homeRecentRail") target = $("homeHotMore") || homeFirstTarget();
        if (!target && state.activeList === "recent") target = initialHomeFocus();
        if (target) focusRemoteTarget(target);
      });
      scheduleUiSnapshotSave();
      return true;
    }

    async function toggleBlockedCard(card) {
      const item = card && card.__mediaItem;
      const key = blockedKey(item);
      if (!item || !key) return;
      if (state.blocked.items[key]) {
        delete state.blocked.items[key];
        toast("已解除屏蔽");
      } else {
        state.blocked.items[key] = {
          title: item.title || "",
          mediaType: item.mediaType || "",
          tmdbId: item.tmdbId || "",
          pic: item.pic || "",
          blockedAt: Date.now()
        };
        toast("已屏蔽");
      }
      updateBlockSelectUi();
      try { await saveBlockedRecommend(); } catch (e) { toast("屏蔽保存失败"); }
      scheduleUiSnapshotSave();
    }

    // Older snapshots can still point at categories that were consolidated in
    // V1.4.5.6.  Keep this map as a one-way compatibility boundary; the
    // removed IDs must never reach the current config, DOM, route, or query
    // builders.
    const LEGACY_CATEGORY_MIGRATION = Object.freeze({
      "cn-tv": "tv",
      "hk-tw-tv": "tv",
      "jp-kr-tv": "tv",
      "us-tv": "tv",
      "variety-cn": "now-playing",
      "variety-global": "now-playing",
      "concert": "now-playing"
    });
    const HOME_PRESENTATION_ROUTES = Object.freeze(["home", "search", "secondary"]);
    const LEGACY_HOME_PRESENTATION_ROUTES = Object.freeze(["history", "continue", "live", "recent", "catalog"]);

