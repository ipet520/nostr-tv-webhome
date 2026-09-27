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

