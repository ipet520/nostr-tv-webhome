    function keepFocusInView(target, options) {
      if (!target) return;
      if (isTvLikeDevice()) {
        revealFocusedTarget(target, options);
        return;
      }
      const rect = target.getBoundingClientRect();
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const width = window.innerWidth || document.documentElement.clientWidth || 0;
      if (!height || !width) return;
      if (rect.top >= 54 && rect.bottom <= height - 54 && rect.left >= 8 && rect.right <= width - 8) return;
      try {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      } catch (e) {
        target.scrollIntoView(false);
      }
    }

    function isVisibleFocusable(el) {
      if (!el || !el.matches || !el.matches(".focusable,button,input,textarea")) return false;
      if (el.disabled || el.getAttribute("tabindex") === "-1" || el.closest('[aria-hidden="true"]')) return false;
      const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
      if (style && (style.visibility === "hidden" || style.display === "none" || style.pointerEvents === "none")) return false;
      return !!(el.offsetParent !== null || el.getClientRects().length);
    }

    function rememberFocusReturn() {
      const active = document.activeElement;
      if (isVisibleFocusable(active)) state.focusReturnEl = active;
    }

    function restoreFocusReturn(fallback) {
      const target = isVisibleFocusable(state.focusReturnEl)
        ? state.focusReturnEl
        : isVisibleFocusable(fallback) ? fallback : firstContentFocus();
      state.focusReturnEl = null;
      if (target) requestAnimationFrame(() => focusRemoteTarget(target));
    }

    function visibleFocusable() {
      const root = focusScopeRoot();
      return Array.from(root.querySelectorAll(".focusable,button,input,textarea"))
        .filter(isVisibleFocusable);
    }

    function focusScopeRoot() {
      if ($("syncSheet") && $("syncSheet").classList.contains("active")) return $("syncSheet");
      if ($("detailSheet") && $("detailSheet").classList.contains("active")) return $("detailSheet");
      if (isConnectionPanelOpen() && $("connectionBody")) return $("connectionBody");
      if (isSidebarOpen()) return $("homeSidebar");
      return document;
    }

    function nearestFocusable(key, fromEl) {
      const active = document.activeElement;
      const current = fromEl || (isVisibleFocusable(active) ? active : null);
      const list = visibleFocusable();
      if (!list.length) return null;
      if (!current) return firstContentFocus() || list[0];
      const from = center(current.getBoundingClientRect());
      const vertical = key === "ArrowUp" || key === "ArrowDown";
      const forward = key === "ArrowRight" || key === "ArrowDown";
      let best = null;
      let bestScore = Infinity;
      for (const el of list) {
        if (el === current) continue;
        const to = center(el.getBoundingClientRect());
        const main = vertical ? to.y - from.y : to.x - from.x;
        const cross = vertical ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
        if (forward ? main <= 4 : main >= -4) continue;
        const score = Math.abs(main) * 1.25 + cross * 1.9;
        if (score < bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return best;
    }

    function firstContentFocus() {
      const root = focusScopeRoot();
      const selectors = ["#homeHero", "#home .home-rail .card", "#recommendRail .card", "#listStack .card", "#searchRail .card", "#searchHotRail .card", ".focusable:not(#searchInput)"];
      for (const selector of selectors) {
        const target = Array.from(root.querySelectorAll(selector)).find(isVisibleFocusable);
        if (target) return target;
      }
      return null;
    }

    function center(rect) {
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }

    function uiSnapshotRoute() {
      if ($("syncSheet") && $("syncSheet").classList.contains("active")) return "sync";
      if ($("detailSheet") && $("detailSheet").classList.contains("active")) return "detail";
      if (homeUiRoute() === "search" || homeUiRoute() === "secondary") return homeUiRoute();
      return "home";
    }

    function compactPanResults(items) {
      return (items || []).slice(0, 400).map((item) => ({
        key: item.key,
        diskType: item.diskType,
        url: item.url,
        normalizedUrl: item.normalizedUrl || "",
        password: item.password || "",
        title: item.title || "",
        source: item.source || "",
        provider: item.provider || "",
        fileName: item.fileName || "",
        fileId: item.fileId || "",
        resourceId: item.resourceId || "",
        datetime: item.datetime || "",
        index: item.index || 0
      }));
    }

    function buildUiSnapshot() {
      const panList = $("panResultList");
      const detail = $("detailSheet");
      const snapshotFocus = isSidebarOpen() ? state.homeV14.sidebarReturnTarget : document.activeElement;
      return {
        version: 1,
        savedAt: Date.now(),
        route: uiSnapshotRoute(),
        hash: location.hash || "",
        activeList: state.activeList,
        scrollY: Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0),
        connectionOpen: !!($("connectionDock") && $("connectionDock").classList.contains("open")),
        selected: state.selected ? normalizeSnapshot(state.selected) : null,
        detailEpisodeTarget: state.detailEpisodeTarget || null,
        detailScrollTop: detail ? Math.round(detail.scrollTop || 0) : 0,
        detailReturn: state.detailReturn || null,
        homeReturn: state.homeReturn || null,
        homeRoute: homeUiRoute(),
        homeRailScroll: homeRailScrollSnapshot(),
        homeFocus: ["home", "search", "secondary"].includes(uiSnapshotRoute()) ? homeFocusSnapshot(snapshotFocus, snapshotFocus && snapshotFocus.__mediaItem) : null,
        search: {
          keyword: currentSearchKeyword(),
          items: (state.searchItems || []).slice(0, 18).map(normalizeSnapshot),
          scrollLeft: Math.max(0, Math.round(Number(($('searchRail') || {}).scrollLeft || 0)))
        },
        pan: {
          visible: !!($("panSearchBlock") && $("panSearchBlock").classList.contains("active")),
          keyword: state.pan.keyword || "",
          activeType: state.pan.activeType || "",
          results: compactPanResults(state.pan.results),
          health: state.pan.health || {},
          listScrollTop: panList ? Math.round(panList.scrollTop || 0) : 0,
          focusKey: state.pan.focusKey || "",
          focusMode: state.pan.focusMode || "",
          playbackReturn: state.pan.playbackReturn || null
        }
      };
    }

    function scheduleUiSnapshotSave() {
      clearTimeout(scheduleUiSnapshotSave.timer);
      scheduleUiSnapshotSave.timer = setTimeout(saveUiSnapshotNow, 260);
    }

    async function saveUiSnapshotNow() {
      try {
        await sdk().cache.set(cacheKey("ui"), JSON.stringify(buildUiSnapshot()));
      } catch (e) {}
    }

    async function readUiSnapshot() {
      try {
        const snapshot = safeJson(await sdk().cache.get(cacheKey("ui")), null);
        if (!snapshot || snapshot.version !== 1) return null;
        if (Date.now() - Number(snapshot.savedAt || 0) > UI_SNAPSHOT_TTL_MS) return null;
        return snapshot;
      } catch (e) {
        return null;
      }
    }

    function shouldRestoreUiSnapshot() {
      try {
        return new URLSearchParams(location.search || "").get("_fm_restore") === "1";
      } catch (e) {
        return /(?:^|[?&])_fm_restore=1(?:&|$)/.test(location.search || "");
      }
    }

    function restorePanSnapshot(pan) {
      if (!pan || !pan.keyword && !(pan.results || []).length) return;
      state.pan.loading = false;
      state.pan.keyword = pan.keyword || "";
      state.pan.sessionItemKey = "";
      state.pan.sessionTerminal = true;
      state.pan.initialResultState = pan.results && pan.results.length ? "restored" : "restored_empty";
      state.pan.activeType = pan.activeType || "";
      state.pan.results = Array.isArray(pan.results) ? pan.results.map((item, index) => Object.assign({ index }, item)) : [];
      state.pan.health = pan.health && typeof pan.health === "object" ? pan.health : {};
      state.pan.focusKey = pan.focusKey || "";
      state.pan.focusMode = pan.focusMode || "";
      state.pan.playbackReturn = pan.playbackReturn || null;
      if (state.pan.playbackReturn && state.pan.playbackReturn.episodeTarget && state.selected) {
        state.detailEpisodeTarget = normalizePlaybackTarget(state.selected, state.pan.playbackReturn.episodeTarget);
      }
      state.pan.pending = {};
      state.pan.queued.clear();
      state.pan.inFlight.clear();
      state.pan.renderKeys = "";
      state.pan.viewToken = `restore-${Date.now()}`;
      if ($("panSearchBlock")) {
        $("panSearchBlock").classList.add("active");
        $("panSearchBlock").style.display = "";
      }
      renderPanResults();
      updatePostPanFocusState();
      requestAnimationFrame(() => {
        if ($("panResultList")) $("panResultList").scrollTop = Number(pan.listScrollTop || 0);
      });
    }

    function restoreSearchSnapshot(snapshot) {
      const data = snapshot && typeof snapshot === "object" ? snapshot : {};
      const keyword = String(data.keyword || "").trim();
      const items = Array.isArray(data.items) ? data.items.map((item) => Object.assign({}, item)).filter(Boolean) : [];
      const live = searchLiveState();
      if (live.timer) clearTimeout(live.timer);
      live.timer = 0;
      live.composing = false;
      live.keyword = keyword;
      live.inputVersion = Number(live.inputVersion || 0) + 1;
      live.requestSeq = Number(live.requestSeq || 0) + 1;
      live.activeKeyword = keyword;
      live.activeVersion = Number(live.inputVersion || 0);
      live.lastRequestedKeyword = keyword;
      live.lastRequestedVersion = Number(live.inputVersion || 0);
      live.lastCompletedKeyword = keyword;
      live.lastCompletedVersion = Number(live.inputVersion || 0);
      live.resultKeyword = keyword;
      live.loading = false;
      live.requestInFlight = false;
      live.error = false;
      state.searchSubmittedKeyword = keyword;
      if ($("searchInput")) $("searchInput").value = keyword;
      state.searchItems = items;
      hideSearchSuggest();
      renderSearch();
      requestAnimationFrame(() => {
        const rail = $("searchRail");
        if (rail) rail.scrollLeft = Math.max(0, Number(data.scrollLeft || 0));
      });
    }

    async function restoreUiSnapshot(snapshot) {
      if (!snapshot) return false;
      state.detailReturn = snapshot.detailReturn || null;
      state.detailEpisodeTarget = snapshot.detailEpisodeTarget && normalizePlaybackTarget(snapshot.selected || state.selected, snapshot.detailEpisodeTarget) || null;
      state.homeReturn = normalizeLegacySavedState(snapshot.homeReturn || null);
      if (snapshot.homeRailScroll && typeof snapshot.homeRailScroll === "object") {
        Object.keys(snapshot.homeRailScroll).forEach((key) => {
          if (String(key).indexOf("home:") === 0) state.railScroll[key] = Math.max(0, Number(snapshot.homeRailScroll[key] || 0));
        });
      }
      restoreSearchSnapshot(snapshot.search);
      const rawHomeRoute = String(snapshot.homeRoute || "").trim().toLowerCase();
      const legacyHomeRoute = isLegacyHomePresentationRoute(rawHomeRoute);
      const restoredHomeRoute = normalizeHomePresentationRoute(rawHomeRoute);
      if (restoredHomeRoute === "search") {
        state.activeList = "all";
        state.homeV14.route = "search";
        // Snapshot restore is not a new user navigation. Rebind the current
        // same-document entry so a restored Search page cannot have a Search
        // UI with a Home URL.
        if (!isSearchHistoryEntry()) history.replaceState({ sheet: "search" }, "", "#search");
      } else if (restoredHomeRoute === "secondary") {
        state.activeList = "all";
        state.homeV14.route = "secondary";
      } else {
        state.homeV14.route = "home";
        state.homeV14.lastHomeFocusedRail = "";
      }
      if (legacyHomeRoute) state.activeList = "all";
      else if (snapshot.activeList) state.activeList = normalizeLegacyCategoryId(snapshot.activeList);
      normalizeActiveListForViewport();
      const snapshotFocusEpoch = homeFocusUserEpoch();
      renderAll({ deferContent: snapshot.route === "home" });
      if (snapshot.connectionOpen && $("connectionDock") && $("connectionBody")) {
        setConnectionPanelOpen(true);
      }
      if (snapshot.route === "detail" && snapshot.selected) {
        if (location.hash !== "#detail" && snapshot.route === "detail") history.replaceState({ sheet: "detail" }, "", "#detail");
        openDetail(snapshot.selected, {
          restore: true,
          skipHistory: true,
          playerReturnRestore: !!(snapshot.pan && snapshot.pan.playbackReturn),
          panSnapshot: snapshot.pan || null
        });
        restorePanSnapshot(snapshot.pan);
        requestAnimationFrame(() => {
          if ($("detailSheet")) $("detailSheet").scrollTop = Number(snapshot.detailScrollTop || 0);
        });
      } else if (snapshot.route === "sync") {
        history.replaceState({ sheet: "sync" }, "", "#sync");
        openSync({ restore: true, skipHistory: true });
      } else {
        requestAnimationFrame(() => {
          if (homeFocusUserEpoch() !== snapshotFocusEpoch) return;
          window.scrollTo(0, Number(snapshot.scrollY || 0));
          if (snapshot.homeFocus) {
            const savedHome = {
              activeList: snapshot.activeList || state.activeList,
              mediaKey: snapshot.homeFocus.key || "",
              focus: snapshot.homeFocus
            };
            const target = findHomeReturnTarget(savedHome);
            if (target) focusHomeReturnTarget(target);
          }
        });
        setTimeout(() => {
          if (homeFocusUserEpoch() !== snapshotFocusEpoch) return;
          if (snapshot.homeFocus && ["home", "search", "secondary"].includes(uiSnapshotRoute())) {
            const savedHome = {
              activeList: snapshot.activeList || state.activeList,
              mediaKey: snapshot.homeFocus.key || "",
              focus: snapshot.homeFocus
            };
            const target = findHomeReturnTarget(savedHome);
            if (target) focusHomeReturnTarget(target);
          }
        }, 180);
      }
      return true;
    }

    // 从 Emby/vod 播放器返回后恢复详情页。
    // 两种情况：
    //   1. WebView 挂起后恢复（内存存活）：detailSheet 仍有 .active，state.selected 存在
    //      → 直接走 handleWebHomeResume 刷新即可
    //   2. WebView 被系统回收后重建（内存丢失）：DOM 重置，state.selected = null
    //      → 从 sdk.cache 读 snapshot，找到 selected 后 openDetail 重新打开
    function schedulePlayerReturn(options) {
      const incomingOptions = options || {};
      if (schedulePlayerReturn._pending || schedulePlayerReturn._running) {
        // marker 可能在普通返回 timer 已排队后才被观察到；合并意图，
        // 不创建第二个 transaction，也不让 native-search 语义在去重时丢失。
        if (incomingOptions.nativeSearchReturn === true) {
          schedulePlayerReturn._nativeSearchReturnPending = true;
        }
        try { console.debug("PLAYER_RETURN_DUPLICATE_IGNORED"); } catch (e) {}
        return;
      }
      const returnOptions = {
        nativeSearchReturn: incomingOptions.nativeSearchReturn === true
      };
      schedulePlayerReturn._nativeSearchReturnPending = false;
      clearTimeout(schedulePlayerReturn._timer);
      clearTimeout(state.resume.timer);
      schedulePlayerReturn._pending = true;
      schedulePlayerReturn._timer = setTimeout(async () => {
        schedulePlayerReturn._pending = false;
        if (schedulePlayerReturn._nativeSearchReturnPending || nativeSearchReturnMarkerFor()) {
          returnOptions.nativeSearchReturn = true;
          schedulePlayerReturn._nativeSearchReturnPending = false;
        }
        if (schedulePlayerReturn._running) return;
        schedulePlayerReturn._running = true;
        let nativeSearchReturnHandled = false;
        try { console.debug("PLAYER_RETURN_TRANSACTION_START"); } catch (e) {}
        try {
          // 情况1：detail 仍然打开且 state 完好（WebView 内存存活）
          if ($("detailSheet") && $("detailSheet").classList.contains("active") && state.selected) {
            // Native Search 返回只刷新 History/UI，不重新启动旧的自动准备。
            if (returnOptions.nativeSearchReturn === true) {
              await handleWebHomeResume({ force: true, playerReturn: true, nativeSearchReturn: true });
              nativeSearchReturnHandled = true;
            // 盘搜播放返回：panSearchBlock 已 active，直接走盘搜恢复，不重渲染整个 detail
            } else if (state.pan.playbackReturn && $("panSearchBlock") && $("panSearchBlock").classList.contains("active")) {
              restorePanPlaybackReturn({});
              await settlePlayerReturnHistory();
              await loadRecentList({ refresh: true, silent: true, reconcileDetail: false });
              reconcileDetailAfterNativeReturn(state.selected, "pan-play");
            } else {
              await handleWebHomeResume({ force: true, playerReturn: true, nativeSearchReturn: false });
            }
            return;
          }
          if (isRecentNativeHomeReturn()) {
            await handleWebHomeResume({ force: true, playerReturn: true, restoreRecentNativeHome: true, nativeSearchReturn: returnOptions.nativeSearchReturn === true });
            nativeSearchReturnHandled = returnOptions.nativeSearchReturn === true;
            return;
          }
          // 情况2：尝试从 snapshot 恢复（WebView 被系统回收后重建）
          try {
            const snapshot = await readUiSnapshot();
            if (snapshot && snapshot.homeReturn) state.homeReturn = normalizeLegacySavedState(snapshot.homeReturn);
            if (snapshot && snapshot.selected && snapshot.route === "detail") {
              if (snapshot.detailReturn) state.detailReturn = snapshot.detailReturn;
              state.detailEpisodeTarget = snapshot.detailEpisodeTarget && normalizePlaybackTarget(snapshot.selected, snapshot.detailEpisodeTarget) || null;
              if (location.hash !== "#detail") history.replaceState({ sheet: "detail" }, "", "#detail");
              openDetail(snapshot.selected, {
                restore: true,
                skipHistory: true,
                playerReturnRestore: !!(snapshot.pan && snapshot.pan.playbackReturn),
                panSnapshot: snapshot.pan || null
              });
              if (snapshot.pan) restorePanSnapshot(snapshot.pan);
              requestAnimationFrame(() => {
                if ($("detailSheet")) $("detailSheet").scrollTop = Number(snapshot.detailScrollTop || 0);
              });
              // 恢复后刷新内容
              await new Promise((resolve) => setTimeout(resolve, 120));
              await handleWebHomeResume({ force: true, playerReturn: true, nativeSearchReturn: returnOptions.nativeSearchReturn === true });
              nativeSearchReturnHandled = returnOptions.nativeSearchReturn === true;
              return;
            }
          } catch (e) {}
          if (isRecentNativeHomeReturn()) {
            await handleWebHomeResume({ force: true, playerReturn: true, restoreRecentNativeHome: true, nativeSearchReturn: returnOptions.nativeSearchReturn === true });
            nativeSearchReturnHandled = returnOptions.nativeSearchReturn === true;
            return;
          }
          // 兜底：走正常首页恢复
          await handleWebHomeResume({ force: true, playerReturn: true, nativeSearchReturn: returnOptions.nativeSearchReturn === true });
          nativeSearchReturnHandled = returnOptions.nativeSearchReturn === true;
        } finally {
          if (!nativeSearchReturnHandled
            && (schedulePlayerReturn._nativeSearchReturnPending || nativeSearchReturnMarkerFor())) {
            schedulePlayerReturn._nativeSearchReturnPending = false;
            try {
              await handleWebHomeResume({ force: true, playerReturn: true, nativeSearchReturn: true });
              nativeSearchReturnHandled = true;
            } catch (e) {}
          } else if (nativeSearchReturnHandled) {
            schedulePlayerReturn._nativeSearchReturnPending = false;
          }
          // 保留原有返回事件 grace window；_pending 负责覆盖 80ms 延迟期间的竞态。
          setTimeout(() => {
            schedulePlayerReturn._running = false;
            if (schedulePlayerReturn._nativeSearchReturnPending || nativeSearchReturnMarkerFor()) {
              schedulePlayerReturn({ nativeSearchReturn: true });
            }
          }, 2000);
        }
      }, 80);
    }
    schedulePlayerReturn._timer = 0;
    schedulePlayerReturn._pending = false;
    schedulePlayerReturn._running = false;
    schedulePlayerReturn._nativeSearchReturnPending = false;

    function scheduleWebHomeResume(options) {
      const opts = options || {};
      if (nativeSearchReturnMarkerFor()) {
        schedulePlayerReturn({ nativeSearchReturn: true });
        return;
      }
      if (schedulePlayerReturn._pending || schedulePlayerReturn._running) {
        try { console.debug("PLAYER_RETURN_DUPLICATE_IGNORED"); } catch (e) {}
        return;
      }
      clearTimeout(state.resume.timer);
      state.resume.timer = setTimeout(() => {
        if (schedulePlayerReturn._pending || schedulePlayerReturn._running) {
          try { console.debug("PLAYER_RETURN_DUPLICATE_IGNORED"); } catch (e) {}
          return;
        }
        handleWebHomeResume(opts);
      }, opts.delay == null ? 80 : opts.delay);
    }

    async function rearmDetailPlaybackAfterPlayerReturn(options) {
      const opts = options || {};
      if (opts.playerReturn !== true || opts.manualPanPlaybackReturn === true) return false;
      const detail = $("detailSheet");
      if (!detail || !detail.classList.contains("active") || !state.selected) return false;
      const item = state.selected;
      const previousHistory = state.detailHistory
        || state.detailPlayback && state.detailPlayback.history
        || null;
      const playbackReturn = state.pan && state.pan.playbackReturn;
      await loadRecentList({ refresh: true, silent: true, reconcileDetail: false }).catch(() => {});
      await Promise.all([
        loadHistoryContextIndex(),
        loadContinueIndex()
      ]).catch(() => {});
      if (state.selected !== item || !$("detailSheet") || !$("detailSheet").classList.contains("active")) return false;

      const nativeHistory = findDetailContinueHistory(item);
      const resource = detailContinueResourceContextFor(item, nativeHistory);
      const nativeReady = detailContinueHistoryIsValid(nativeHistory);
      const playbackReturnHistory = !nativeReady && resource && resource.source === "playback-return"
        && detailContinueHistoryIsValid(previousHistory) ? previousHistory : null;
      const effectiveHistory = nativeHistory || playbackReturnHistory;
      const reusableResource = resource && !isPanHealthBad(resource.candidate) ? resource : null;

      // REARM 只恢复动作和上下文；它不再把“播放器返回”解释成“重新搜源”。
      cancelDetailPlaybackPreparation("player_return_rearm");
      cancelPendingDirectPlay("player_return_rearm");
      state.detailHistoryHandoff = null;
      state.historyResume = null;
      if (reusableResource && effectiveHistory) {
        if (reusableResource.target) setDetailPlaybackTarget(item, reusableResource.target);
        if (state.pan) {
          state.pan.directReady = null;
          state.pan.directFailure = null;
        }
        recordDetailPlaybackDecision("PLAYER_RETURN_PLAYBACK_DECISION", item, {
          playbackReturnFound: !!playbackReturn,
          continueContextFound: reusableResource.source === "continue-context",
          lastPlayUrlFound: true,
          nativeHistoryFound: !!nativeHistory,
          nativeProgress: historyPlaybackPositionValue(effectiveHistory),
          decision: "REARM_HISTORY_ONLY",
          curatedStarted: false
        });
        return true;
      }

      const target = nativeHistory ? detailContinuePlaybackTargetFor(item, nativeHistory) : null;
      if (target) setDetailPlaybackTarget(item, target);
      else state.detailEpisodeTarget = null;
      resetPanSearchState(false, { reason: "player_return_rearm_fallback", preserveHealth: true });
      recordDetailPlaybackDecision("PLAYER_RETURN_PLAYBACK_DECISION", item, {
        playbackReturnFound: !!playbackReturn,
        continueContextFound: !!(resource && resource.contextFound),
        lastPlayUrlFound: !!(resource && resource.target && resource.target.lastPlayUrl),
        nativeHistoryFound: !!nativeHistory,
        nativeProgress: nativeHistory ? historyPlaybackPositionValue(nativeHistory) : 0,
        decision: "REARM_FALLBACK_PREPARE",
        curatedStarted: true
      });
      prepareDetailPlayback(item, { reason: "player_return_rearm_fallback" }).catch(() => {});
      return true;
    }

    async function handleWebHomeResume(options) {
      const opts = options || {};
      const now = Date.now();
      if (!opts.force && now - Number(state.resume.lastAt || 0) < 650) return;
      state.resume.lastAt = now;
      const nativeHomeReturnTarget = state.focusReturnEl;
      const nativeHomeReturn = nativeHomeReturnTarget === $("connectionToggle") || !!(nativeHomeReturnTarget && nativeHomeReturnTarget.closest && nativeHomeReturnTarget.closest("#homeSidebar"));
      const restoreRecentNativeHome = opts.restoreRecentNativeHome === true && !($("detailSheet") && $("detailSheet").classList.contains("active")) && isRecentNativeHomeReturn();
      const isPanPlaybackReturn = !!(state.pan.playbackReturn && $("detailSheet") && $("detailSheet").classList.contains("active") && $("panSearchBlock") && $("panSearchBlock").classList.contains("active"));
      const isPlayerReturn = opts.playerReturn === true;
      lockViewportWidth();
      fitConnectionPanel();
      renderConnection();
      if (isPlayerReturn) await settlePlayerReturnHistory();
      let detailRearmed = false;
      if (isPlayerReturn && !isPanPlaybackReturn && opts.nativeSearchReturn !== true) {
        detailRearmed = await rearmDetailPlaybackAfterPlayerReturn({ playerReturn: true });
      }
      if (restoreRecentNativeHome) await loadRecentList({ refresh: true, silent: true });
      if (!isPanPlaybackReturn) {
        if ($("detailSheet") && $("detailSheet").classList.contains("active") && state.selected) refreshActiveDetailView();
        if ($("panSearchBlock") && $("panSearchBlock").classList.contains("active")) renderPanResults();
        renderAll({ deferContent: restoreRecentNativeHome ? false : uiSnapshotRoute() === "home" });
        normalizeRails();
      }
      if (!restorePanPlaybackReturn({ skipRender: isPanPlaybackReturn })) restoreDetailReturn();
      if (restoreRecentNativeHome) restoreHomeReturn();
      updateBackTopButton();
      scheduleHistorySettlement();
      if (restoreRecentNativeHome) {
        // The awaited refresh above rendered the new Recent list before the
        // saved Home target was restored.  Do not start a competing sampler.
      } else if (isPlayerReturn) {
        if (!detailRearmed) await loadRecentList({ refresh: true, silent: true, reconcileDetail: false });
      } else {
        loadRecentList({ refresh: true, silent: true, reconcileDetail: false })
          .then(() => {
            reconcileDetailAfterNativeReturn(state.selected, "app-resume");
          })
          .catch(() => {});
        sampleWatchStatus();
      }
      if (isPlayerReturn) {
        const reconciled = reconcileDetailAfterNativeReturn(
          state.selected,
          opts.nativeSearchReturn === true ? "native-search" : (isPanPlaybackReturn ? "pan-play" : "main-play")
        );
        if (opts.nativeSearchReturn === true && !(state.recent && state.recent.error)) {
          const marker = nativeSearchReturnMarkerFor();
          const detail = $("detailSheet");
          const detailContextGone = !detail
            || !detail.classList.contains("active")
            || !state.selected
            || !marker
            || marker.itemKey !== panSearchItemKey(state.selected);
          if (reconciled || detailContextGone) clearNativeSearchReturnMarker();
        }
      }
      if (!isPanPlaybackReturn) {
        const home = $("home");
        if (home) {
          home.style.transform = "translateZ(0)";
          requestAnimationFrame(() => home.style.transform = "");
        }
      }
      if (nativeHomeReturn && isVisibleFocusable(nativeHomeReturnTarget)) restoreFocusReturn(nativeHomeReturnTarget);
      scheduleUiSnapshotSave();
    }

    function refreshActiveDetailView() {
      if (state.detail && state.selected) {
        renderDetailExtras(state.selected, state.detail);
        return;
      }
      if (state.detailCover.images && state.detailCover.images.length) {
        updateDetailCoverControls();
        syncDetailCoverFrame($("detailImage"));
        return;
      }
      renderDetailBase(state.selected);
    }

    function safeJson(text, fallback) {
      try { return JSON.parse(text || ""); } catch (e) { return fallback; }
    }

    function escapeHtml(value) {
      return String(value || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    function escapeAttr(value) {
      return escapeHtml(value).replace(/`/g, "&#96;");
    }

    function shortKey(value) {
      if (!value) return "";
      return value.length > 14 ? value.slice(0, 8) + "..." + value.slice(-4) : value;
    }

    function toast(message) {
      const el = $("toast");
      el.textContent = message || "";
      el.classList.add("show");
      clearTimeout(toast.timer);
      toast.timer = setTimeout(() => {
        el.classList.remove("show");
        el.textContent = "";
      }, 2200);
    }

    function updateBackTopButton() {
      const top = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      $("backTopBtn").classList.toggle("show", top > window.innerHeight);
    }

    function updateMobileDetailBackButton() {
      const sheet = $("detailSheet");
      const button = $("mobileDetailBackBtn");
      if (!sheet || !button) return;
      const hide = document.documentElement.classList.contains("native-mobile-app") && sheet.classList.contains("active") && !sheet.classList.contains("detail-large") && sheet.scrollTop > 120;
      button.classList.toggle("is-hidden", hide);
    }

    window.addEventListener("popstate", (event) => {
      const detailSheet = $("detailSheet");
      if (state.homeV14 && state.homeV14.sidebarHistoryBackPending) {
        const deferredAction = state.homeV14.sidebarDeferredAction;
        state.homeV14.sidebarDeferredAction = null;
        state.homeV14.sidebarHistoryBackPending = false;
        state.homeV14.sidebarHistoryEntry = false;
        if (history.state && history.state.homeSidebar) {
          try { history.replaceState(Object.assign({}, history.state, { homeSidebar: false }), "", location.href); } catch (e) {}
        }
        syncSidebarMobilePresentation();
        if (deferredAction) performSidebarNavigation(deferredAction);
        return;
      }
      if (isMobileSidebarDevice() && isSidebarOpen()) {
        if (isConnectionPanelOpen()) {
          closeConnectionPanel();
          // The transient Sidebar entry was already traversed by browser
          // Back. Restore that existing entry so the next Back still closes
          // Sidebar instead of leaving Home; no new entry is created.
          if (state.homeV14 && state.homeV14.sidebarHistoryEntry
            && !(event && event.state && event.state.homeSidebar)) {
            try { history.forward(); } catch (e) {}
          }
          return;
        }
        if (event && event.state && event.state.homeSidebar
          && state.homeV14 && state.homeV14.sidebarHistoryEntry) {
          syncSidebarMobilePresentation();
          return;
        }
        closeSidebar({ restore: false, fromPopState: true });
        return;
      }
      if (isTvLikeDevice() && isConnectionPanelOpen() && location.hash !== "#connection") {
        closeConnectionPanel({ fromPopState: true });
        return;
      }
      // 正在关闭动画中，忽略重复触发
      const isClosing = detailSheet && detailSheet.classList.contains("sheet-closing");
      if (isClosing) return;

      // Native Back 可能绕过 keydown 直接改变 history；Pan 是 Detail 的子态，
      // 先消费这一次返回并恢复 #detail，不能继续落入 closeDetail()。
      if (isTvLikeDevice() && location.hash !== "#detail" && detailSheet && detailSheet.classList.contains("active") && isPanSearchActive()) {
        // Pan 没有自己的 history entry。若 WebView 先退到了 Search 或
        // Secondary 父页面，保留该父 entry，再 push 一个新的 Detail entry；
        // 否则下一次 Back 会错误地跳过父页面。直接从 Home 进入 Detail
        // 的既有 replaceState 行为保持不变。
        if (isSearchHistoryEntry() || isSecondaryHistoryEntry()) {
          history.pushState({ sheet: "detail", panClosed: true }, "", "#detail");
        } else {
          history.replaceState(Object.assign({}, history.state || {}, { sheet: "detail", panClosed: true }), "", "#detail");
        }
        closePanSearchToDetail();
        return;
      }
      if (location.hash !== "#detail" && detailSheet && detailSheet.classList.contains("active")) {
        // 系统返回键路径：history.back() 已发生，scrollY 可能已被重置为 0
        // 先暂存（可能是 0），closeDetail 动画结束后再还原
        _pendingHomeScrollY = _pendingHomeScrollY || Math.round(window.scrollY || document.documentElement.scrollTop || 0);
        closeDetail(true);
        return;
      }
      if (location.hash !== "#sync" && $("syncSheet").classList.contains("active")) {
        closeSync(true);
        return;
      }
      // Secondary is a real same-document history route.  Once a back
      // transition has left #secondary, close only the UI route here; never
      // call history.back() again from popstate.
      if (homeUiRoute() === "secondary" && location.hash !== "#secondary"
        && $("secondaryCatalog") && !$("secondaryCatalog").hidden) {
        if (isRecentManagePage() && recentManageRuntime().active) {
          if (recentManageRuntime().deleting) toast("正在删除，请稍候");
          else exitRecentManageMode({ focus: true });
          try { history.forward(); } catch (e) {}
          return;
        }
        state.homeV14.secondaryHistoryBackPending = false;
        closeSecondaryCatalog();
        if (!location.hash && (!history.state || history.state.sheet !== "home")) {
          history.replaceState({ sheet: "home" }, "", location.pathname + location.search);
        }
        return;
      }
      // Search is a real same-document history route. A native WebView Back
      // may arrive here without a JavaScript key event; close only the Search
      // UI after history has already moved to its parent Home entry.
      if (homeUiRoute() === "search" && location.hash !== "#search"
        && $("searchPage") && !$("searchPage").hidden) {
        state.homeV14.searchHistoryBackPending = false;
        closeSearchPage();
        if (!location.hash && (!history.state || history.state.sheet !== "home")) {
          history.replaceState({ sheet: "home" }, "", location.pathname + location.search);
        }
        return;
      }
      // 主页面：所有 sheet 都已关闭。
      // 如果 hash 是空（说明用户 back 到了主页根路由），推入新哨兵，防止再 back 退出 App
      if (!location.hash) {
        const anySheetActive = (
          ($("detailSheet") && $("detailSheet").classList.contains("active")) ||
          $("syncSheet") && $("syncSheet").classList.contains("active")
        );
        if (!anySheetActive) {
          const _sy = _pendingHomeScrollY || Math.round(window.scrollY || document.documentElement.scrollTop || 0);
          _pendingHomeScrollY = 0;
          history.pushState({ sheet: "home" }, "", location.pathname + location.search);
          if (_sy > 0) {
            window.scrollTo(0, _sy);
            document.documentElement.scrollTop = _sy;
            document.body.scrollTop = _sy;
          }
        }
      }
    });

    window.addEventListener("fmviewport", () => {
      state.gridColumnCache = {};
      document.body.style.minHeight = getComputedStyle(document.documentElement).getPropertyValue("--fm-web-height");
      lockViewportWidth();
      fitConnectionPanel();
      const detailLayoutChanged = syncDetailLayout();
      if (detailLayoutChanged && $("detailSheet") && $("detailSheet").classList.contains("active") && state.selected) refreshActiveDetailView();
      renderAll({ deferContent: uiSnapshotRoute() === "home" });
      syncSidebarMobilePresentation();
      scheduleDetailTextClamp();
      scheduleHistorySettlement();
    });

    window.addEventListener("resize", () => {
      state.gridColumnCache = {};
      lockViewportWidth();
      fitConnectionPanel();
      const detailLayoutChanged = syncDetailLayout();
      if (detailLayoutChanged && $("detailSheet") && $("detailSheet").classList.contains("active") && state.selected) refreshActiveDetailView();
      renderAll({ deferContent: uiSnapshotRoute() === "home" });
      syncSidebarMobilePresentation();
      scheduleDetailTextClamp();
    });
    window.addEventListener("scroll", () => {
      state.scrollingUntil = Date.now() + 900;
      updateBackTopButton();
      scheduleUiSnapshotSave();
      if ("IntersectionObserver" in window) return;
      const doc = document.documentElement;
      if ((window.scrollY || doc.scrollTop || 0) + window.innerHeight < doc.scrollHeight - 900) return;
      clearTimeout(state.scrollLoadTimer);
      state.scrollLoadTimer = setTimeout(loadMoreVisible, 80);
    }, { passive: true });
    window.addEventListener("pagehide", () => {
      clearDirectPlayStatusOnNativeTakeover("pagehide");
      saveUiSnapshotNow();
      clearRelayBackfillTimers();
      pauseDetailCoverCarousel();
      stopWatchTracking(true);
    });
    window.addEventListener("pageshow", () => {
      const panWasPlaying = localStorage.getItem("fm_pan_playing") === "1";
      if (panWasPlaying) {
        clearDirectPlayStatus(0, "player_return");
        localStorage.removeItem("fm_pan_playing");
        state.pan.isPlaying = false;
        // 从播放器返回：主动恢复详情页（内存存活则刷新，WebView 重建则从 snapshot 重开）
        schedulePlayerReturn();
        return;
      }
      scheduleWebHomeResume();
    });
    window.addEventListener("fmsdk", () => {
      syncClientModeClasses();
      Promise.all([
        initUiPrefs({ timeout: 0 }),
        initTmdbConfig({ preserveDirty: true, timeout: 0 }),
        initPanConfig({ preserveDirty: true, timeout: 0 })
      ])
        .then(loadInfo)
        .then(() => scheduleWebHomeResume({ force: true }))
        .catch(() => {});
    });
    window.addEventListener("fmresume", () => {
      const panWasPlaying = localStorage.getItem("fm_pan_playing") === "1";
      if (panWasPlaying) {
        clearDirectPlayStatus(0, "player_return");
        localStorage.removeItem("fm_pan_playing");
        state.pan.isPlaying = false;
        // 从播放器返回：先立即恢复 UI，loadInfo 在后台静默刷新
        schedulePlayerReturn();
        loadInfo().catch(() => {});
        return;
      }
      loadInfo().finally(() => scheduleWebHomeResume());
    });
    window.addEventListener("fmpause", saveUiSnapshotNow);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        clearDirectPlayStatusOnNativeTakeover("visibility_hidden");
        saveUiSnapshotNow();
        state.detailCover.swipe = null;
        pauseDetailCoverCarousel();
      }
      if (document.visibilityState === "visible") {
        restartDetailCoverCarousel();
        updateDetailCoverControls();
        syncDetailCoverFrame($("detailImage"));

        // 从播放器返回检测：用 localStorage 而非内存（WebView 挂起后内存丢失）
        const panWasPlaying = localStorage.getItem("fm_pan_playing") === "1";
        if (panWasPlaying) {
          clearDirectPlayStatus(0, "player_return");
          localStorage.removeItem("fm_pan_playing");
          state.pan.isPlaying = false;
          // 从播放器返回：主动恢复详情页
          schedulePlayerReturn();
          return;
        }

        scheduleWebHomeResume();
      }
    });

    function lockViewportWidth() {
      // TV 端不需要锁定视口宽度（无软键盘视口压缩问题），避免固定像素宽度干扰遥控器布局
      if (isTvLikeDevice()) return;
      const width = Math.floor(window.innerWidth || document.documentElement.clientWidth || 0);
      if (!width) return;
      document.documentElement.style.width = width + "px";
      document.body.style.width = width + "px";
      document.body.style.maxWidth = width + "px";
    }

    async function boot() {
      lockViewportWidth();
      bindActions();
      installRemoteKeys();
      // 确保主页始终有一个 history 哨兵条目，防止返回键直接退出 App
      if (history.scrollRestoration) history.scrollRestoration = "manual";
      if (!location.hash) ensureHomeHistoryEntry();
      await initTmdbConfig();
      await initPanConfig();
      await initUiPrefs({ timeout: 0 });
      setupRelayMirrorDefaults();
      await loadBlockedRecommend();
      renderConnection();
      armFallbackTimers();
      hotLoadIndex().catch(() => {});
      await loadInfo();
      if (isNativeHistoryDeleteProbeRequested()) probeNativeHistoryDeleteRoutes().catch((e) => {
        try { console.debug("[Nostr TV][NATIVE_DELETE_ROUTE_PROBE_FAILED]", e); } catch (e2) {}
      });
      await loadCatalog();
      if (isTvDiagnosticEnabled()) loadTvDiagnostics().catch(() => {});
      const canRestoreUi = shouldRestoreUiSnapshot();
      const restored = canRestoreUi ? await restoreUiSnapshot(await readUiSnapshot()) : false;
      await ensureIdentity();
      await loadEvents();
      scheduleHistorySettlement();
      setTimeout(subscribeNostr, 600);
      renderMetrics();
      if (restored) scheduleWebHomeResume({ force: true });
      if (!canRestoreUi) scheduleUiSnapshotSave();
      updateBackTopButton();
      if (!restored) {
        if (isHomeRouteActive() && isTvLikeDevice()) {
          state.homeV14.coldHomeFocusPending = true;
          state.homeV14.coldHomeFocusEpoch = homeFocusUserEpoch();
          state.homeV14.coldHomeFallbackTarget = null;
          focusColdHomeHeroIfReady();
        } else {
          state.homeV14.coldHomeFocusPending = false;
          state.homeV14.coldHomeFallbackTarget = null;
        }
        setTimeout(() => ensureRemoteInitialFocus({ allowHomeFallback: false }), 80);
        setTimeout(() => ensureRemoteInitialFocus({ allowHomeFallback: true }), 260);
      } else if (uiSnapshotRoute() !== "home") {
        state.homeV14.coldHomeFocusPending = false;
        state.homeV14.coldHomeFallbackTarget = null;
        setTimeout(ensureRemoteInitialFocus, 80);
      }
    }

    // 根据 chromeMode 调整顶部安全区：只在确实全屏/融合接管（edge/immersive/tv-full/tv-toolbar-hidden）时
    // 才预留状态栏高度；普通 normal/tv-normal（有原生 Toolbar）或未知 mode 都不留顶部空白，
    // 避免非全屏时搜索框与状态栏之间出现一条多余的空白区域。
    function _applySafeTop(mode) {
      const isFullscreenChrome = /^(edge|immersive|tv-full|tv-toolbar-hidden)$/.test(mode || "");
      document.documentElement.style.setProperty(
        "--safe-t",
        isFullscreenChrome ? "max(var(--fm-safe-top,0px),env(safe-area-inset-top,0px))" : "0px"
      );
    }
    window.addEventListener("fmviewport", function(e) {
      _applySafeTop(((e.detail) || {}).chromeMode || "");
    });
    // 初始化时主动读一次，避免首帧 fmviewport 尚未触发时顶部间距偏大
    (function() {
      if (!window.fm) return;
      try {
        fm.ui.getViewport().then(function(vp) { _applySafeTop((vp || {}).chromeMode || ""); }).catch(function() {});
      } catch(e) {}
    })();

    boot().catch(function(e) {
      try { renderAll(); } catch(e2) {}
      try { renderConnection(); } catch(e2) {}
      try { console.error("boot failed:", e); } catch(e2) {}
    });
  