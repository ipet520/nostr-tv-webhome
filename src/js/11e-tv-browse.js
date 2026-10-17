    const TV_BROWSE_BACKDROP_TIMEOUT_MS = 8000;
    const TV_BROWSE_RAIL_READY_TIMEOUT_MS = 5000;

    // TV presentation owns only selection, focus and viewport position. Catalog
    // results and filters remain owned by the shared catalog query service.
    function syncBrowseDevicePresentation() {
      const mount = $("mobileHomeMount"), template = $("mobileHomeTemplate");
      if (!mount || !template) return;
      const sidebarMount = $("sidebarMount");
      if (!isTvLikeDevice() && sidebarMount && !sidebarMount.children.length) {
        sidebarMount.appendChild($("sidebarTemplate").content.cloneNode(true));
        $("homeSearchLauncher").addEventListener("click", openSearchPage);
        $("homeMenuLauncher").addEventListener("click", () => isSidebarOpen() ? closeSidebar() : openSidebar());
        $("homeSidebarBackdrop").addEventListener("click", () => {
          if (isConnectionPanelOpen()) closeConnectionPanel();
          else closeSidebar();
        });
      }
      if (isTvLikeDevice() && sidebarMount && sidebarMount.children.length) {
        const dock = $("connectionDock");
        if (dock) $("tvBrowseFunctions").appendChild(dock);
        closeSidebar({ restore: false, fromPopState: true });
        sidebarMount.replaceChildren();
      }
      const controlsTemplate = $("recentManageTemplate");
      let controls = $("recentManageControls");
      if (!controls && controlsTemplate) {
        const fragment = controlsTemplate.content.cloneNode(true);
        controls = fragment.querySelector("#recentManageControls");
        $("tvBrowseRecentTools").appendChild(fragment);
      }
      if (isTvLikeDevice()) {
        if (controls) $("tvBrowseRecentTools").appendChild(controls);
        clearHomeHeroAutoplayResume();
        stopHomeHeroAutoplay();
        if (mount.children.length) {
          mount.replaceChildren();
          state.homeV14.heroFeed.requestSeq += 1; state.homeV14.heroBackdropSeq += 1;
          state.homeV14.loadQueue = [];
          Object.keys(state.homeV14.categoryFeeds || {}).forEach((id) => { state.homeV14.categoryFeeds[id].requestSeq += 1; });
        }
        if (state.homeV14.sectionObserver) state.homeV14.sectionObserver.disconnect();
      } else if (!mount.children.length) {
        mount.appendChild(template.content.cloneNode(true));
        bindHomeHeroSwipe();
        const secondaryBack = $("secondaryCatalogBack"), secondaryMenu = $("secondaryMenuLauncher");
        if (secondaryBack) secondaryBack.addEventListener("click", requestCloseSecondaryCatalog);
        if (secondaryMenu) secondaryMenu.addEventListener("click", () => isSidebarOpen() ? closeSidebar() : openSidebar());
        ["Recent", "Recommendation", "Weekly"].forEach((name) => {
          const button = $("home" + name + "More");
          if (button) button.addEventListener("click", () => openSecondaryCatalog(name === "Recent" ? "recent" : name === "Weekly" ? "now-playing" : "recommendation", { originTarget: button }));
        });
      }
      if (!isTvLikeDevice() && controls && $("mobileRecentManageMount")) $("mobileRecentManageMount").appendChild(controls);
    }

    function tvBrowseState() {
      const ui = state.tvBrowse || (state.tvBrowse = {
        column: "recommendation", view: "home", historyReturnFocus: null, positions: {}, filterOpen: false, filterFocusGroup: "",
        confirm: null, enterHeld: false, suppressClickUntil: 0,
        previewKey: "", presentedKey: "", backdropToken: 0, backdropSlot: 0, backdropUrl: "", backdropMediaKey: "",
        pendingImage: null, pendingPreview: null, warmBackdrops: [],
        focusIntent: null, retryFocusIntent: null, railCache: {}, railCacheOrder: [], railReadyByQuery: {}, railReadyOrder: [], railReadiness: null, railReadinessToken: 0, coldRailQueryKey: "", initialized: false,
        railScroll: { frame: 0, target: null, targetKey: "", lastFrameAt: 0 }, posterWarmTargetKey: "", navigationDirection: 0, previewDirection: 1
      });
      if (!ui.wallpaper) ui.wallpaper = { active: false, timer: 0, timerToken: 0, moveToken: 0, infoFrame: 0, movePending: false, paused: false, lastActivityAt: 0, historyEntry: false, pendingHistoryAction: null, currentKey: "", currentItem: null, consumeUntilKeyup: {}, detailPending: false, clickSinkPrepared: false, clickSinkTabIndex: null, clickSinkOutline: "", phase: "idle" };
      if (!ui.railReadyByQuery || typeof ui.railReadyByQuery !== "object") ui.railReadyByQuery = {};
      if (!Array.isArray(ui.railReadyOrder)) ui.railReadyOrder = [];
      return ui;
    }

    function tvBrowseFocusLabel() {
      const active = document.activeElement;
      return active && (active.id || active.dataset && (active.dataset.mediaKey || active.dataset.column) || active.tagName || "") || "";
    }

    function recordTvBrowseDiagnostic(kind, details) {
      if (!isTvDiagnosticEnabled()) return;
      const ui = tvBrowseState();
      ui.diagnostics = Array.isArray(ui.diagnostics) ? ui.diagnostics : [];
      const event = Object.assign({ at: Date.now(), kind, view: ui.view, column: ui.column, focus: tvBrowseFocusLabel() }, details || {});
      ui.diagnostics.push(event);
      if (ui.diagnostics.length > 120) ui.diagnostics.splice(0, ui.diagnostics.length - 120);
      try { console.debug("[Nostr TV][BROWSE_DIAG]", event); } catch (e) {}
    }

    function tvBrowseMaybePreloadCategories(reason) {
      const ui = tvBrowseState(), home = state.homeV14;
      if (!tvBrowseActive() || ui.view !== "home" || !home || !home.tvRecommendationPresented || !state.hot || !state.hot.ready) return false;
      // This is a Leanback directory optimization. Mobile Home categories use
      // their own feed/cache identity and remain on their existing scheduler.
      if (!isNativeLeanbackClient() && state.deviceMode !== "leanback") return false;
      if (home.tvSecondaryPreloadStarted) return false;
      home.tvSecondaryPreloadStarted = true;
      const queued = [];
      TV_SECONDARY_PRELOAD_IDS.forEach((id) => {
        const query = secondaryGetQuery(id, secondaryDefaultQueryFilters());
        if (query.loading || query.loaded && !secondaryQueryNeedsRefresh(query)) return;
        const refresh = !!(query.loaded && secondaryQueryNeedsRefresh(query));
        const isVisibleQuery = ui.column === id && secondaryActiveQuery(id) === query;
        queued.push({ listId: id, queryKey: query.key, requestSeq: Number(query.requestSeq || 0) + 1 });
        loadSecondaryPage(id, query, 1, {
          requestClass: isVisibleQuery ? "foreground" : "prefetch", refresh,
          reason: isVisibleQuery ? "tv-category-focused" : reason || "tv-cold-start-preload"
        }).catch(() => {});
      });
      recordTvBrowseDiagnostic("TV_CATEGORY_PRELOAD_SCHEDULED", { requestReason: reason || "tv-cold-start-preload", categories: queued });
      return true;
    }

    function releaseTvBrowseNativeInput() {
      const ui = state.tvBrowse;
      if (!ui) return;
      ui.enterHeld = false; ui.confirm = null;
      ui.suppressClickUntil = Date.now() + 120;
      if (ui.view === "history") cancelRecentDeleteArm();
    }

    function completeTvBrowseNativeReturn() {
      releaseTvBrowseNativeInput();
      // A resumed Native activity ends the handoff even if its SDK reply was
      // suspended with the WebView. The old finally is identity guarded.
      if (state.recent) state.recent.nativeHandoff = null;
    }

    function tvBrowseBeginStartup(epoch) {
      const ui = tvBrowseState();
      if (!tvBrowseActive() || homeFocusUserEpoch() !== epoch) return;
      ui.column = "recommendation"; ui.view = "home";
      if (state.homeV14) state.homeV14.tvRecommendationPresented = true;
      renderTvBrowse(); tvBrowseFocusIntent();
    }

    function tvBrowseActive() {
      return isTvLikeDevice() && homeUiRoute() === "home" && state.activeList === "all";
    }

    function tvBrowseColumns() {
      return browseColumnItems().filter((entry) => entry.listId !== "recent");
    }

    function tvBrowseQueryKey() {
      const ui = tvBrowseState();
      return ui.view === "history" ? "native-history" : secondaryFilterKey(ui.column, secondaryFilterState(ui.column));
    }

    function tvWallpaperState() { return tvBrowseState().wallpaper; }

    function tvWallpaperIsActive() { return !!tvWallpaperState().active; }

    function tvWallpaperCurrentItems(query) {
      const ui = tvBrowseState();
      const activeQuery = query || secondaryGetQuery(ui.column);
      if (ui.view !== "home" || !activeQuery) return [];
      const source = ui.column === "recommendation"
        ? filterBlocked(activeQuery.items || [])
        : secondaryFilterItems(ui.column, activeQuery.items || []);
      return (source || []).filter(hasPoster);
    }

    function tvWallpaperCurrentSelection() {
      const ui = tvBrowseState(), position = tvBrowsePosition(), wall = tvWallpaperState();
      const query = secondaryGetQuery(ui.column), items = tvWallpaperCurrentItems(query);
      if (!items.length) return { query, items, index: -1, item: null, key: "" };
      const preferredKey = wall.active ? position.key : ui.previewKey || position.key;
      let index = preferredKey ? items.findIndex((item) => mediaDomKey(item) === preferredKey) : -1;
      if (index < 0) index = items.findIndex((item) => mediaDomKey(item) === position.key);
      if (index < 0) index = Math.max(0, Math.min(items.length - 1, Number(position.index) || 0));
      const item = items[index] || null;
      return { query, items, index, item, key: item ? mediaDomKey(item) : "" };
    }

    function tvWallpaperCardFor(selection) {
      if (!selection || !selection.item) return null;
      const rail = $("tvBrowseRail");
      return rail && Array.from(rail.children).find((card) => card.__mediaItem
        && mediaDomKey(card.__mediaItem) === selection.key
        && Number(card.dataset.cardIndex) === selection.index) || null;
    }

    function tvWallpaperFocusClickSink() {
      const wall = tvWallpaperState(), root = $("tvBrowse");
      if (!wall.active || !root) return false;
      if (!wall.clickSinkPrepared) {
        wall.clickSinkTabIndex = root.hasAttribute("tabindex") ? root.getAttribute("tabindex") : null;
        wall.clickSinkOutline = root.style.outline;
        wall.clickSinkPrepared = true;
      }
      // The TV host calls document.activeElement.click() for OK. Focus the
      // persistent Browse root so rail reconciliation cannot detach its sink;
      // the click handler resolves the current resource from the active query.
      root.setAttribute("tabindex", "-1");
      root.style.outline = "none";
      if (document.activeElement !== root) {
        try { root.focus({ preventScroll: true }); }
        catch (e) { root.focus(); }
      }
      return document.activeElement === root;
    }

    function tvWallpaperRestoreClickSink() {
      const wall = tvWallpaperState(), root = $("tvBrowse");
      if (!wall.clickSinkPrepared) return;
      if (root) {
        if (wall.clickSinkTabIndex === null) root.removeAttribute("tabindex");
        else root.setAttribute("tabindex", wall.clickSinkTabIndex);
        root.style.outline = wall.clickSinkOutline;
      }
      wall.clickSinkPrepared = false; wall.clickSinkTabIndex = null; wall.clickSinkOutline = "";
    }

    function tvWallpaperRouteReady() {
      const ui = tvBrowseState(), root = $("tvBrowse"), detail = $("detailSheet"), sync = $("syncSheet");
      const search = $("searchPage"), secondary = $("secondaryCatalog");
      return isTvLikeDevice() && tvBrowseActive() && homeUiRoute() === "home"
        && ui.view === "home" && !ui.filterOpen && !isSidebarOpen() && !isConnectionPanelOpen()
        && !(detail && detail.classList.contains("active")) && !(sync && sync.classList.contains("active"))
        && !(search && !search.hidden) && !(secondary && !secondary.hidden)
        && !(typeof isPanSearchActive === "function" && isPanSearchActive())
        && !(typeof isSearchSuggestOpen === "function" && isSearchSuggestOpen())
        && !(state.blocked && state.blocked.selecting)
        && !(typeof recentManageRuntime === "function" && recentManageRuntime().active)
        && !!(root && !root.hidden);
    }

    function tvWallpaperCanEnter() {
      const wall = tvWallpaperState();
      if (wall.paused || document.visibilityState === "hidden" || !tvWallpaperRouteReady()) return false;
      const selection = tvWallpaperCurrentSelection();
      return !!(selection.item && selection.key && tvBrowseState().previewKey === selection.key
        && tvWallpaperCardFor(selection));
    }

    function tvWallpaperCanContinue() {
      return tvWallpaperIsActive() && !tvWallpaperState().paused
        && document.visibilityState !== "hidden" && tvWallpaperRouteReady();
    }

    function tvWallpaperStopTimer() {
      const wall = tvWallpaperState();
      if (wall.timer) clearTimeout(wall.timer);
      wall.timer = 0; wall.timerToken += 1; wall.phase = wall.active ? "wallpaper" : "idle";
    }

    function tvWallpaperScheduleIdle(resetActivity) {
      const wall = tvWallpaperState(), prefs = sanitizeUiPrefs(state.uiPrefs || {});
      if (resetActivity) {
        wall.lastActivityAt = Date.now();
        tvWallpaperStopTimer();
      }
      if (wall.active || wall.paused || document.visibilityState === "hidden" || prefs.tvWallpaperEnterSeconds <= 0) {
        tvWallpaperStopTimer();
        return false;
      }
      if (!tvWallpaperCanEnter()) {
        if (wall.timer) tvWallpaperStopTimer();
        return false;
      }
      if (wall.timer) return true;
      if (!wall.lastActivityAt) wall.lastActivityAt = Date.now();
      const waitMs = prefs.tvWallpaperEnterSeconds * 1000;
      const delay = Math.max(0, wall.lastActivityAt + waitMs - Date.now());
      const token = ++wall.timerToken;
      wall.phase = "idle";
      wall.timer = setTimeout(() => {
        if (token !== wall.timerToken) return;
        wall.timer = 0;
        wall.phase = "idle";
        if (tvWallpaperCanEnter()) tvWallpaperEnter();
        else if (tvWallpaperRouteReady()) {
          wall.lastActivityAt = Date.now();
          tvWallpaperScheduleIdle(false);
        }
      }, delay);
      return true;
    }

    function tvWallpaperHistoryPush() {
      const wall = tvWallpaperState();
      try {
        const baseState = history.state;
        wall.historyBaseState = baseState;
        wall.historyBaseUrl = location.href;
        // Preserve null exactly for the return check. A fresh page commonly
        // starts with history.state === null even though pushState needs an
        // object for the transient wallpaper marker.
        wall.historyBaseSerialized = JSON.stringify(baseState == null ? null : baseState);
        // Use the same URL-changing transient marker as TV filters. Native
        // Back checks the WebView URL before it calls goBack(); a same-URL
        // pushState is treated as the home boundary and falls through to the
        // host's full-screen Back behavior without dispatching popstate here.
        const markerHash = location.hash === "#tv-wallpaper" ? "#tv-wallpaper-active" : "#tv-wallpaper";
        wall.historyEntry = ensureTvPanelHistoryEntry("wallpaper", markerHash);
      } catch (e) { wall.historyEntry = false; }
    }

    function tvWallpaperInfoTargetTop(root, infoRect) {
      const rootRect = root.getBoundingClientRect();
      const foreground = root.querySelector(".tv-browse-foreground");
      if (!rootRect.height || !infoRect.height || !foreground) return null;
      const rootStyle = getComputedStyle(root);
      const visibleHeight = parseFloat(rootStyle.getPropertyValue("--tv-visible-height")) || rootRect.height;
      const titleBottomGap = parseFloat(rootStyle.getPropertyValue("--tv-rail-title-bottom-gap"));
      const bottomPadding = parseFloat(getComputedStyle(foreground).paddingBottom);
      if (!Number.isFinite(titleBottomGap) || !Number.isFinite(bottomPadding)) return null;
      return Math.max(0, visibleHeight - bottomPadding - titleBottomGap - infoRect.height);
    }

    function tvWallpaperUpdateInfoShift() {
      if (!tvWallpaperIsActive()) return;
      const root = $("tvBrowse"), info = $("tvBrowseInfo");
      if (!root || !info) return;
      const rootRect = root.getBoundingClientRect(), infoRect = info.getBoundingClientRect();
      if (!rootRect.height || !infoRect.height) return;
      const targetTop = tvWallpaperInfoTargetTop(root, infoRect);
      if (targetTop === null) return;
      const offsetParent = info.offsetParent;
      if (!offsetParent || offsetParent !== root && !root.contains(offsetParent)) return;
      const parentRect = offsetParent.getBoundingClientRect();
      // offsetTop excludes the info element's in-flight transform. Measuring
      // its visual rect and subtracting the target CSS variable is incorrect
      // while the 400ms transition is still interpolating.
      const baseTop = info.offsetTop + parentRect.top + offsetParent.clientTop - rootRect.top;
      const shift = Math.round(targetTop - baseTop) + "px";
      if (root.style.getPropertyValue("--tv-wallpaper-info-shift") !== shift) {
        root.style.setProperty("--tv-wallpaper-info-shift", shift);
      }
    }

    function tvWallpaperScheduleInfoShift(expectedKey, expectedMoveToken) {
      const wall = tvWallpaperState(), root = $("tvBrowse");
      if (!wall.active || !root) return false;
      const key = expectedKey || wall.currentKey;
      const token = expectedMoveToken == null ? wall.moveToken : expectedMoveToken;
      if (wall.infoFrame) cancelAnimationFrame(wall.infoFrame);
      wall.infoFrame = requestAnimationFrame(() => {
        wall.infoFrame = 0;
        if (!wall.active || wall.paused || wall.moveToken !== token || wall.currentKey !== key || !root.isConnected) return;
        if (tvWallpaperCurrentSelection().key !== key) return;
        tvWallpaperUpdateInfoShift();
      });
      return true;
    }

    function tvWallpaperEnter() {
      const wall = tvWallpaperState(), ui = tvBrowseState(), root = $("tvBrowse");
      if (wall.active || !root || !tvWallpaperCanEnter()) return false;
      tvWallpaperStopTimer();
      tvBrowseCancelRailScroll();
      tvBrowseCancelRailReadiness(); ui.coldRailQueryKey = "";
      const selection = tvWallpaperCurrentSelection();
      if (!selection.item) return false;
      const position = tvBrowsePosition();
      position.key = selection.key; position.index = selection.index;
      wall.active = true; wall.phase = "wallpaper"; wall.currentKey = selection.key; wall.currentItem = selection.item;
      wall.pendingHistoryAction = null; wall.detailPending = false; wall.movePending = false; wall.moveToken += 1;
      ui.focusIntent = null; ui.retryFocusIntent = null;
      // The native TV host routes OK through activeElement.click(). Keep a
      // persistent sink focused while the rail is hidden and reconciled.
      tvWallpaperFocusClickSink();
      tvWallpaperHistoryPush();
      const info = $("tvBrowseInfo");
      if (info) {
        root.style.setProperty("--tv-wallpaper-info-shift", "0px");
        root.classList.add("wallpaper-mode");
        tvWallpaperScheduleInfoShift(selection.key, wall.moveToken);
      } else root.classList.add("wallpaper-mode");
      // Re-evaluate the existing Home visibility observers at this logical
      // position; image loading and metadata work remain on their normal paths.
      observeHomeImages($("tvBrowseRail")); observeMovieCardEnrichment($("tvBrowseRail"));
      tvBrowseWarmNextBackground(selection.item);
      tvWallpaperScheduleRotation();
      return true;
    }

    function tvWallpaperMaterialize(selection) {
      if (!selection || !selection.item) return null;
      let card = tvWallpaperCardFor(selection);
      if (!card) {
        renderTvBrowse({ append: true, ensureIndex: selection.index, reason: "wallpaper-target" });
        card = tvWallpaperCardFor(selection);
      }
      return card;
    }

    function tvWallpaperFocusCurrent(selection) {
      const ui = tvBrowseState();
      const current = selection || tvWallpaperCurrentSelection();
      const position = tvBrowsePosition();
      if (current.item) { position.key = current.key; position.index = current.index; }
      const card = tvWallpaperMaterialize(current);
      if (card && mediaDomKey(card.__mediaItem) === current.key && isVisibleFocusable(card)) {
        focusRemoteTarget(card);
        return true;
      }
      const fallback = tvBrowseColumnButton(ui.column) || $("tvFunction-search");
      if (fallback && isVisibleFocusable(fallback)) focusRemoteTarget(fallback);
      return false;
    }

    function tvWallpaperExit(options) {
      const opts = options || {}, wall = tvWallpaperState(), root = $("tvBrowse"), ui = tvBrowseState();
      if (!wall.active) return false;
      const selection = tvWallpaperCurrentSelection();
      const selectedCard = tvWallpaperCardFor(selection);
      // Resolve the wallpaper position against the centered Browse anchor
      // while the rail is still visually hidden. Revealing it therefore never
      // flashes the pre-wallpaper card position first.
      if (selectedCard) tvBrowseSetRailAnchor(selectedCard);
      tvWallpaperStopTimer();
      wall.moveToken += 1; wall.movePending = false;
      if (wall.infoFrame) cancelAnimationFrame(wall.infoFrame);
      wall.infoFrame = 0;
      wall.active = false; wall.phase = "idle"; wall.currentKey = selection.key; wall.currentItem = selection.item;
      ui.focusIntent = null; ui.retryFocusIntent = null;
      if (selection.item) {
        const position = tvBrowsePosition();
        position.key = selection.key; position.index = selection.index;
      }
      tvWallpaperRestoreClickSink();
      if (root) {
        root.classList.remove("wallpaper-mode");
        root.style.setProperty("--tv-wallpaper-info-shift", "0px");
      }
      if (opts.reason !== "detail" && opts.deferFocus !== true) tvWallpaperFocusCurrent(selection);
      if (opts.userExit) wall.lastActivityAt = Date.now();
      const historyAction = opts.reason === "detail"
        ? { type: "detail", item: selection.item, returnTarget: null }
        : { type: "exit" };
      wall.pendingHistoryAction = wall.historyEntry && opts.historyAlreadyPopped !== true ? historyAction : null;
      if (historyAction.type === "detail") historyAction.returnTarget = tvWallpaperMaterialize(selection);
      if (wall.historyEntry && opts.historyAlreadyPopped !== true) {
        try { history.back(); }
        catch (e) {
          clearTvPanelHistoryEntry("wallpaper", location.hash);
          wall.historyEntry = false; wall.pendingHistoryAction = null;
          wall.historyBaseState = null; wall.historyBaseUrl = ""; wall.historyBaseSerialized = "";
          if (historyAction.type === "detail") tvWallpaperOpenDetailAction(historyAction);
        }
      } else {
        wall.historyEntry = false;
        wall.pendingHistoryAction = null;
        wall.historyBaseState = null; wall.historyBaseUrl = ""; wall.historyBaseSerialized = "";
        if (historyAction.type === "detail") tvWallpaperOpenDetailAction(historyAction);
      }
      if (historyAction.type !== "detail") tvWallpaperScheduleIdle(!!opts.userExit);
      return true;
    }

    function tvWallpaperHandleKey(event, key) {
      const wall = tvWallpaperState();
      const consumed = wall.consumeUntilKeyup || (wall.consumeUntilKeyup = {});
      if (consumed[key]) {
        event.preventDefault(); event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        return true;
      }
      if (!wall.active) return false;
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape", "Backspace", "Enter"].includes(key)) return false;
      event.preventDefault(); event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (key === "ArrowUp" || key === "ArrowDown") {
        consumed[key] = true;
        tvWallpaperExit({ reason: "user", userExit: true });
      } else if (key === "Escape" || key === "Backspace") {
        consumed[key] = true;
        tvWallpaperExit({ reason: "user", userExit: true });
      } else if (key === "Enter") {
        consumed.Enter = true;
        tvWallpaperOpenCurrentDetail();
      } else {
        const direction = key === "ArrowRight" ? 1 : -1;
        tvWallpaperStopTimer();
        tvWallpaperMove(direction, false).finally(() => tvWallpaperScheduleRotation());
      }
      return true;
    }

    function tvWallpaperOpenCurrentDetail() {
      const wall = tvWallpaperState();
      if (!wall.active || wall.detailPending) return false;
      const selection = tvWallpaperCurrentSelection();
      if (!selection.item) return false;
      wall.detailPending = true;
      return tvWallpaperExit({ reason: "detail", deferFocus: true });
    }

    function tvWallpaperOpenDetailAction(action) {
      const wall = tvWallpaperState();
      if (!action || !action.item) {
        wall.detailPending = false;
        return false;
      }
      try {
        openDetail(action.item, { returnTarget: action.returnTarget });
      } catch (e) {
        const sheet = $("detailSheet");
        if (!sheet || !sheet.classList.contains("active")) {
          wall.detailPending = false; wall.pendingHistoryAction = null;
          wall.historyEntry = false; wall.historyBaseState = null;
          wall.historyBaseUrl = ""; wall.historyBaseSerialized = "";
          wall.lastActivityAt = Date.now();
          tvWallpaperScheduleIdle(true);
        }
        recordTvBrowseDiagnostic("TV_WALLPAPER_DETAIL_OPEN_FAILED", { error: String(e && e.message || e) });
        return false;
      }
      const sheet = $("detailSheet");
      if (!sheet || !sheet.classList.contains("active")) {
        wall.detailPending = false; wall.pendingHistoryAction = null;
        wall.lastActivityAt = Date.now();
        tvWallpaperScheduleIdle(true);
        recordTvBrowseDiagnostic("TV_WALLPAPER_DETAIL_OPEN_FAILED", { reason: "detail-sheet-not-active" });
        return false;
      }
      recordTvBrowseDiagnostic("TV_WALLPAPER_DETAIL_OPEN", { mediaKey: mediaDomKey(action.item) });
      return true;
    }

    function tvWallpaperHandleClick(event) {
      const wall = tvWallpaperState();
      if (!wall.active && !wall.detailPending) return false;
      event.preventDefault(); event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (wall.active) tvWallpaperOpenCurrentDetail();
      return true;
    }

    async function tvWallpaperMove(direction, automatic) {
      const wall = tvWallpaperState();
      if (!wall.active || wall.movePending || !tvWallpaperCanContinue()) return false;
      const token = ++wall.moveToken;
      wall.movePending = true;
      let moved = false;
      try {
        let selection = tvWallpaperCurrentSelection(), query = selection.query, items = selection.items;
        if (!selection.item || items.length < 1) return false;
        let currentIndex = selection.index;
        if (direction > 0 && currentIndex + 1 >= items.length && query.hasMore) {
          if (query.loading) return false;
          let before = items.length;
          while (query.hasMore && !query.loading && items.length <= currentIndex + 1) {
            await loadSecondaryPage(tvBrowseState().column, query, query.page + 1, { reason: automatic ? "tv-wallpaper-rotation" : "tv-wallpaper-manual" });
            if (token !== wall.moveToken || !wall.active || wall.paused) return false;
            query = secondaryGetQuery(tvBrowseState().column);
            items = tvWallpaperCurrentItems(query);
            selection = tvWallpaperCurrentSelection();
            currentIndex = selection.index;
            if (items.length <= currentIndex + 1 && query.loading) break;
            if (items.length === before && !query.hasMore) break;
            before = items.length;
          }
        }
        if (token !== wall.moveToken || !wall.active || wall.paused) return false;
        selection = tvWallpaperCurrentSelection();
        items = selection.items; currentIndex = selection.index; query = selection.query;
        if (!selection.item || items.length <= 1) return false;
        let nextIndex = currentIndex + direction;
        if (nextIndex < 0) return false;
        if (nextIndex >= items.length) {
          if (!automatic || query.hasMore || query.loading) return false;
          nextIndex = 0;
        }
        const nextItem = items[nextIndex], nextKey = mediaDomKey(nextItem);
        if (!nextItem || !nextKey || nextKey === selection.key) return false;
        const position = tvBrowsePosition();
        position.key = nextKey; position.index = nextIndex;
        const next = { query, items, index: nextIndex, item: nextItem, key: nextKey };
        tvWallpaperMaterialize(next);
        if (token !== wall.moveToken || !wall.active || wall.paused) return false;
        wall.currentKey = nextKey; wall.currentItem = nextItem;
        tvBrowsePreview(nextItem, { direction, wrap: automatic });
        tvWallpaperFocusClickSink();
        tvBrowseSyncRailImagePreparation(); observeMovieCardEnrichment($("tvBrowseRail"));
        tvBrowseMaybeLoadMore(nextIndex);
        moved = true;
        tvWallpaperScheduleInfoShift(nextKey, token);
        return true;
      } finally {
        if (token === wall.moveToken) wall.movePending = false;
        if (moved && !automatic) tvWallpaperScheduleRotation();
      }
    }

    function tvWallpaperScheduleRotation() {
      const wall = tvWallpaperState(), prefs = sanitizeUiPrefs(state.uiPrefs || {});
      if (!wall.active || wall.paused || document.visibilityState === "hidden" || prefs.tvWallpaperIntervalSeconds <= 0 || wall.movePending) {
        if (wall.timer && wall.active) tvWallpaperStopTimer();
        return false;
      }
      if (!tvWallpaperCanContinue()) {
        tvWallpaperExit({ reason: "blocked" });
        return false;
      }
      const selection = tvWallpaperCurrentSelection();
      if (!selection.item || selection.items.length <= 1 && !selection.query.hasMore) return false;
      if (wall.timer) return true;
      const token = ++wall.timerToken;
      wall.phase = "rotation";
      wall.timer = setTimeout(() => {
        if (token !== wall.timerToken) return;
        wall.timer = 0; wall.phase = "rotation";
        if (!tvWallpaperCanContinue()) {
          if (document.visibilityState === "hidden") tvWallpaperPause();
          else tvWallpaperExit({ reason: "blocked" });
          return;
        }
        tvWallpaperMove(1, true).finally(() => {
          if (wall.active && !wall.paused) tvWallpaperScheduleRotation();
        });
      }, prefs.tvWallpaperIntervalSeconds * 1000);
      return true;
    }

    function tvWallpaperNoteUserActivity() {
      if (!isTvLikeDevice()) return;
      const wall = tvWallpaperState();
      if (wall.active) return;
      wall.lastActivityAt = Date.now();
      tvWallpaperScheduleIdle(true);
    }

    function tvWallpaperAfterHomeReturn() {
      const wall = tvWallpaperState();
      if (wall.active) tvWallpaperExit({ reason: "blocked" });
      wall.detailPending = false;
      wall.lastActivityAt = Date.now();
      tvWallpaperScheduleIdle(true);
    }

    function tvWallpaperPreferencesChanged() {
      const wall = tvWallpaperState(), prefs = sanitizeUiPrefs(state.uiPrefs || {});
      if (!isTvLikeDevice() || prefs.tvWallpaperEnterSeconds <= 0) {
        if (!wall.active) tvWallpaperStopTimer();
        return;
      }
      if (wall.active) {
        tvWallpaperStopTimer();
        tvWallpaperScheduleRotation();
      }
      else {
        wall.lastActivityAt = Date.now();
        tvWallpaperScheduleIdle(true);
      }
    }

    function tvWallpaperOnBrowseRendered(selected, items) {
      const wall = tvWallpaperState(), ui = tvBrowseState();
      if (!selected) {
        if (wall.active) tvWallpaperExit({ reason: "blocked" });
        else { wall.lastActivityAt = 0; tvWallpaperStopTimer(); }
        return;
      }
      if (wall.active) {
        const index = (items || []).indexOf(selected), position = tvBrowsePosition();
        position.key = mediaDomKey(selected); position.index = Math.max(0, index);
        wall.currentKey = position.key; wall.currentItem = selected;
        tvWallpaperScheduleInfoShift(position.key, wall.moveToken);
        if (!wall.timer && !wall.movePending) tvWallpaperScheduleRotation();
      } else if (ui.view === "home" && !(wall.pendingHistoryAction && wall.pendingHistoryAction.type === "detail")) {
        tvWallpaperScheduleIdle(false);
      }
    }

    function tvWallpaperReconcile() {
      const wall = tvWallpaperState(), prefs = sanitizeUiPrefs(state.uiPrefs || {});
      if (!isTvLikeDevice()) {
        if (wall.active) tvWallpaperExit({ reason: "blocked" });
        else tvWallpaperStopTimer();
        return;
      }
      if (wall.paused || document.visibilityState === "hidden") { tvWallpaperStopTimer(); return; }
      if (wall.active) {
        if (!tvWallpaperCanContinue()) { tvWallpaperExit({ reason: "blocked" }); return; }
        if (!wall.timer && !wall.movePending) tvWallpaperScheduleRotation();
      } else if (prefs.tvWallpaperEnterSeconds > 0) {
        tvWallpaperScheduleIdle(false);
      } else tvWallpaperStopTimer();
    }

    function handleTvWallpaperPopState(event) {
      const wall = tvWallpaperState();
      const matchesBase = () => {
        if (!wall.historyBaseSerialized) return true;
        let serialized = "";
        try { serialized = JSON.stringify(event && event.state == null ? null : event.state); } catch (e) { return false; }
        return location.href === wall.historyBaseUrl && serialized === wall.historyBaseSerialized;
      };
      if (wall.pendingHistoryAction) {
        if (!matchesBase()) {
          if (wall.pendingHistoryAction.type === "detail") {
            const action = wall.pendingHistoryAction;
            // The marker may have been displaced before its Back traversal
            // completed. Open the captured current resource from this state;
            // do not leave Native OK locked behind an unreachable popstate.
            if (location.hash === "#tv-wallpaper" || location.hash === "#tv-wallpaper-active") clearTvPanelHistoryEntry("wallpaper", location.hash);
            wall.pendingHistoryAction = null; wall.historyEntry = false;
            wall.historyBaseState = null; wall.historyBaseUrl = ""; wall.historyBaseSerialized = "";
            return tvWallpaperOpenDetailAction(action);
          }
          try { history.forward(); } catch (e) {}
          return true;
        }
        const action = wall.pendingHistoryAction;
        wall.pendingHistoryAction = null; wall.historyEntry = false;
        wall.historyBaseState = null; wall.historyBaseUrl = ""; wall.historyBaseSerialized = "";
        if (action.type === "detail") tvWallpaperOpenDetailAction(action);
        return true;
      }
      if (wall.active) {
        if (!matchesBase()) {
          try { history.forward(); } catch (e) {}
          return true;
        }
        wall.historyEntry = false;
        wall.historyBaseState = null; wall.historyBaseUrl = ""; wall.historyBaseSerialized = "";
        tvWallpaperExit({ reason: "native-back", historyAlreadyPopped: true, userExit: true });
        return true;
      }
      return false;
    }

    function tvWallpaperPause() {
      const wall = tvWallpaperState();
      wall.paused = true; wall.moveToken += 1; wall.movePending = false;
      tvWallpaperStopTimer();
    }

    function tvWallpaperResume() {
      const wall = tvWallpaperState();
      wall.paused = false; wall.moveToken += 1; wall.movePending = false;
      if (wall.active) {
        tvWallpaperFocusClickSink();
        observeHomeImages($("tvBrowseRail")); observeMovieCardEnrichment($("tvBrowseRail"));
        tvWallpaperScheduleInfoShift(wall.currentKey, wall.moveToken);
        tvWallpaperScheduleRotation();
      }
      else {
        wall.lastActivityAt = Date.now();
        tvWallpaperScheduleIdle(true);
      }
    }

    function tvBrowseOpenHistory() {
      const ui = tvBrowseState();
      if (!tvBrowseActive() || ui.view === "history") return;
      tvBrowseSavePosition();
      ui.historyReturnFocus = homeFocusSnapshot(document.activeElement);
      if (ui.filterOpen) clearTvPanelHistoryEntry("filters", "#tv-filters");
      ui.view = "history"; ui.filterOpen = false; ui.previewKey = ""; ui.confirm = null;
      ensureTvPanelHistoryEntry("tvHistory", "#tv-history");
      renderTvBrowse(); tvBrowseFocusIntent();
      loadRecentList({ refresh: shouldRefreshRecentList(), silent: true }).catch(() => {});
      renderTvBrowse();
    }

    function tvBrowseCloseHistory(options) {
      const ui = tvBrowseState();
      if (!tvBrowseActive() || ui.view !== "history") return false;
      if (recentManageRuntime().deleting) { toast("正在删除，请稍候"); return true; }
      tvBrowseSavePosition(); resetRecentManageState();
      if (!(options && options.fromPopState)) clearTvPanelHistoryEntry("tvHistory", "#tv-history");
      ui.view = "home"; ui.previewKey = ""; ui.focusIntent = null;
      const saved = ui.historyReturnFocus; ui.historyReturnFocus = null;
      renderTvBrowse(); tvBrowseFocusIntent(saved);
      scheduleUiSnapshotSave();
      return true;
    }

    function tvBrowseContinueHistory(item, button) {
      const ui = tvBrowseState(), position = tvBrowsePosition();
      // Resolve the live Native list on every activation; never play a deleted object.
      const target = (state.recent.items || []).find((entry) => mediaDomKey(entry) === (item ? mediaDomKey(item) : position.key));
      if (ui.view !== "history" || !target || !nativeHistoryRecordCanPlayExact(target)
        || !target.siteKey || !target.vodId) { toast("该记录暂不支持原生续播"); return Promise.resolve(false); }
      if (state.recent.nativeHandoff) return state.recent.nativeHandoff;
      if (localStorage.getItem("fm_pan_playing") === "1") return Promise.resolve(true);
      const task = playNativeHistoryExact(target, { returnTarget: button || $("tvHistoryContinue") })
        .catch((error) => { toast("续播失败：" + (error.message || "unknown")); return false; })
        .finally(() => { if (state.recent.nativeHandoff === task) state.recent.nativeHandoff = null; });
      state.recent.nativeHandoff = task;
      return task;
    }

    function tvBrowseRenderContinue(item) {
      const ui = tvBrowseState(), host = $("tvHistoryResume");
      host.hidden = ui.view !== "history" || !item;
      if (host.hidden) return;
      const raw = item.nativeHistoryRaw || {};
      const rawPosition = historyNestedValue(raw, ["position", "playbackPosition", "playback_position"]);
      const position = validHistoryMs(rawPosition);
      const duration = validHistoryMs(historyNestedValue(raw, ["duration", "durationMs", "duration_ms"]));
      const positionKnown = rawPosition !== "" && Number.isFinite(Number(rawPosition)) && Number(rawPosition) >= 0 && (position > 0 || Number(rawPosition) === 0);
      const progressKnown = positionKnown && duration > 0 && position <= duration;
      $("tvHistoryContinue").disabled = !nativeHistoryRecordCanPlayExact(item) || !item.siteKey || !item.vodId;
      const title = String(item.title || "").trim() || "作品名称不可用";
      const mediaType = String(item.mediaType || "").toLowerCase();
      const seasonNumber = item.seasonNumber, episodeNumber = item.episodeNumber;
      const episodeLabels = [];
      if (mediaType === "tv") {
        if (Number.isInteger(seasonNumber) && seasonNumber >= 0) episodeLabels.push("第 " + seasonNumber + " 季");
        if (Number.isInteger(episodeNumber) && episodeNumber > 0) episodeLabels.push("第 " + episodeNumber + " 集");
      }
      $("tvHistoryEpisode").textContent = [title].concat(episodeLabels).join(" · ");
      $("tvHistoryTime").textContent = progressKnown ? `${formatHistoryTime(position)} / ${formatHistoryTime(duration)}` : positionKnown && position > 0 && !duration ? `${formatHistoryTime(position)} / 时长未知` : "暂无有效播放进度";
      const progress = $("tvHistoryProgress");
      progress.hidden = !progressKnown;
      progress.firstElementChild.style.width = progress.hidden ? "0%" : position / duration * 100 + "%";
    }

    function tvBrowseColumnButton(id) {
      return $("tvBrowseColumns") && Array.from($("tvBrowseColumns").children).find((el) => el.dataset.column === id) || null;
    }

    function tvBrowsePosition() {
      const ui = tvBrowseState(), key = tvBrowseQueryKey();
      return ui.positions[key] || (ui.positions[key] = { key: "", index: 0, scrollLeft: 0 });
    }

    function tvBrowseRailTargetScrollLeft(card, rail) {
      const target = card && card.closest && card.closest("#tvBrowseRail");
      const container = rail || target;
      if (!card || !container || !container.clientWidth || !card.getBoundingClientRect) return null;
      const rect = container.getBoundingClientRect(), cardRect = card.getBoundingClientRect();
      const style = getComputedStyle(container);
      const paddingLeft = parseFloat(style.paddingLeft) || 0, paddingRight = parseFloat(style.paddingRight) || 0;
      const contentLeft = rect.left + (container.clientLeft || 0);
      const usableWidth = Math.max(0, container.clientWidth - paddingLeft - paddingRight);
      const contentCenter = cardRect.left + cardRect.width / 2 - contentLeft + Number(container.scrollLeft || 0);
      const desired = contentCenter - paddingLeft - usableWidth / 2;
      const max = Math.max(0, Number(container.scrollWidth || 0) - Number(container.clientWidth || 0));
      return Math.max(0, Math.min(max, desired));
    }

    function tvBrowseExpectedRailScrollLeft(rail) {
      const container = rail || $("tvBrowseRail"), ui = tvBrowseState(), scroll = ui.railScroll || {};
      if (!container) return 0;
      if (tvWallpaperIsActive()) {
        const selection = tvWallpaperCurrentSelection(), card = tvWallpaperCardFor(selection);
        const target = card && tvBrowseRailTargetScrollLeft(card, container);
        return target == null ? Number(container.scrollLeft || 0) : target;
      }
      if (Number.isFinite(Number(scroll.target)) && scroll.frame) return Number(scroll.target);
      return Number(container.scrollLeft || 0);
    }

    function tvBrowseCancelRailScroll() {
      const scroll = tvBrowseState().railScroll || (tvBrowseState().railScroll = { frame: 0, target: null, targetKey: "", lastFrameAt: 0 });
      if (scroll.frame) cancelAnimationFrame(scroll.frame);
      scroll.frame = 0; scroll.target = null; scroll.targetKey = ""; scroll.lastFrameAt = 0;
      return true;
    }

    function tvBrowseScheduleRailAnchor(card) {
      const rail = $("tvBrowseRail"), ui = tvBrowseState();
      if (!tvBrowseActive() || tvWallpaperIsActive() || !card || !rail || !rail.contains(card) || !card.classList.contains("card")) return false;
      const scroll = ui.railScroll || (ui.railScroll = { frame: 0, target: null, targetKey: "", lastFrameAt: 0 });
      const target = tvBrowseRailTargetScrollLeft(card, rail);
      if (target == null) return false;
      scroll.target = target; scroll.targetKey = card.dataset.mediaKey || "";
      if (scroll.frame) return true;
      const step = (now) => {
        const currentRail = $("tvBrowseRail"), state = tvBrowseState(), runtime = state.railScroll;
        if (!runtime || !currentRail || !tvBrowseActive() || tvWallpaperIsActive() || runtime.target == null) {
          if (runtime) { runtime.frame = 0; runtime.lastFrameAt = 0; }
          return;
        }
        const activeCard = document.activeElement && document.activeElement.closest("#tvBrowseRail .card");
        if (activeCard && activeCard.isConnected) {
          const latest = tvBrowseRailTargetScrollLeft(activeCard, currentRail);
          if (latest != null) { runtime.target = latest; runtime.targetKey = activeCard.dataset.mediaKey || ""; }
        }
        const goal = Math.max(0, Math.min(Math.max(0, currentRail.scrollWidth - currentRail.clientWidth), Number(runtime.target || 0)));
        const before = Number(currentRail.scrollLeft || 0), delta = goal - before;
        // Some WebViews quantize scrollLeft to whole CSS pixels. Snap the
        // final couple of pixels so an exponential step cannot stall forever
        // below the browser's scroll precision.
        if (Math.abs(delta) <= 2.5) {
          currentRail.scrollLeft = goal;
          runtime.frame = 0; runtime.target = null; runtime.targetKey = ""; runtime.lastFrameAt = 0;
          tvBrowseSyncRailImagePreparation();
          return;
        }
        const elapsed = runtime.lastFrameAt ? Math.max(1, Math.min(48, now - runtime.lastFrameAt)) : 16;
        runtime.lastFrameAt = now;
        const fraction = 1 - Math.exp(-elapsed / 72);
        currentRail.scrollLeft = before + delta * fraction;
        runtime.frame = requestAnimationFrame(step);
      };
      scroll.frame = requestAnimationFrame(step);
      tvBrowseSyncRailImagePreparation();
      return true;
    }

    function tvBrowseSetRailAnchor(card) {
      const rail = $("tvBrowseRail");
      if (!rail || !card || !rail.contains(card)) return false;
      const target = tvBrowseRailTargetScrollLeft(card, rail);
      if (target == null) return false;
      tvBrowseCancelRailScroll();
      rail.scrollLeft = target;
      tvBrowseState().railScroll.target = null;
      return true;
    }

    function tvBrowseInitialVisibleCardCount(rail, itemCount) {
      if (!rail) return Math.min(Math.max(1, Number(itemCount) || 1), 8);
      const root = $("tvBrowse"), style = getComputedStyle(rail), rootStyle = root && getComputedStyle(root);
      const width = Number(rail.clientWidth || root && root.clientWidth || window.innerWidth || 0);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const cardWidth = parseFloat(rootStyle && rootStyle.getPropertyValue("--tv-poster-width"))
        || Number(rail.querySelector(".card") && rail.querySelector(".card").offsetWidth) || 140;
      const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
      const stride = Math.max(1, cardWidth + gap);
      const count = Math.max(1, Math.ceil(Math.max(cardWidth, width - padding) / stride));
      return Math.min(Math.max(1, Number(itemCount) || 1), count);
    }

    function tvBrowseSetRailLoading(visible, message, busy) {
      const rail = $("tvBrowseRail"), host = $("tvBrowsePosters"), loader = $("tvBrowseRailLoader");
      if (!rail || !host) return false;
      const shown = !!visible, isBusy = busy == null ? shown : !!busy;
      host.classList.toggle("rail-loading", shown);
      host.classList.toggle("rail-unavailable", shown && !isBusy);
      rail.setAttribute("aria-busy", String(isBusy));
      if (loader) {
        loader.hidden = !shown || !isBusy;
        loader.setAttribute("aria-label", message || "正在准备首屏内容");
      }
      const status = $("tvBrowseStatus"), root = $("tvBrowse"), feedback = root && root.querySelector(".tv-browse-feedback");
      if (status && isBusy && status.textContent.trim() === "加载中…") status.textContent = "";
      if (status && shown && !isBusy && message) {
        status.textContent = message;
        if (feedback) feedback.hidden = false;
      } else if (status && !shown && status.textContent.trim() === "首屏暂不可用") {
        status.textContent = "";
      }
      return true;
    }

    function tvBrowsePosterSource(image) {
      if (!image) return "";
      const deferred = image.getAttribute("data-src");
      const source = deferred || image.getAttribute("src") || image.src || "";
      return /^data:image\/gif;base64,R0lGODlhAQABAAD/i.test(source) ? "" : source;
    }

    function tvBrowseMarkPosterState(card, image, stateName) {
      if (image) image.dataset.tvBrowsePosterState = stateName;
      if (card) {
        card.dataset.posterState = stateName;
        card.classList.toggle("poster-unavailable", stateName === "failed");
      }
    }

    function tvBrowseRememberRailReady(queryKey, signature, imageNodes) {
      const ui = tvBrowseState();
      if (!queryKey || !signature) return;
      ui.railReadyByQuery[queryKey] = { signature, imageNodes: Array.from(imageNodes || []) };
      ui.railReadyOrder = (ui.railReadyOrder || []).filter((key) => key !== queryKey).concat(queryKey);
      while (ui.railReadyOrder.length > 6) delete ui.railReadyByQuery[ui.railReadyOrder.shift()];
    }

    function tvBrowseCancelRailReadiness() {
      const ui = tvBrowseState(), gate = ui.railReadiness;
      if (gate && gate.timeoutId) clearTimeout(gate.timeoutId);
      if (gate && gate.pending) gate.pending.forEach((entry) => {
        entry.image.removeEventListener("load", entry.onLoad);
        entry.image.removeEventListener("error", entry.onError);
      });
      ui.railReadiness = null;
      ui.railReadinessToken = Number(ui.railReadinessToken || 0) + 1;
      tvBrowseSetRailLoading(false);
      return !!gate;
    }

    function tvBrowseFinishRailReadiness(gate, timedOut) {
      const ui = tvBrowseState();
      if (!gate || gate.settled || ui.railReadiness !== gate || gate.token !== ui.railReadinessToken
        || gate.queryKey !== tvBrowseQueryKey()) return false;
      gate.settled = true;
      if (gate.timeoutId) clearTimeout(gate.timeoutId);
      if (gate.pending) gate.pending.forEach((entry) => {
        entry.image.removeEventListener("load", entry.onLoad);
        entry.image.removeEventListener("error", entry.onError);
        if (timedOut) tvBrowseMarkPosterState(entry.card, entry.image, "failed");
      });
      gate.pending = [];
      ui.railReadiness = null;
      const dataTimedOut = timedOut && gate.dataPending;
      ui.coldRailQueryKey = dataTimedOut ? gate.queryKey : "";
      ui.railReadinessTimedOutKey = timedOut ? gate.queryKey + "|" + gate.signature : "";
      if (!dataTimedOut) tvBrowseRememberRailReady(gate.queryKey, gate.signature, gate.imageNodes);
      if (dataTimedOut) tvBrowseSetRailLoading(true, "首屏暂不可用", false);
      else {
        tvBrowseSetRailLoading(false);
        tvBrowseSyncRailImagePreparation();
      }
      return true;
    }

    function tvBrowseEnsureRailReadiness(query, items, cards, visibleCount, allowGate) {
      const ui = tvBrowseState(), wall = tvWallpaperState(), queryKey = query && query.key || tvBrowseQueryKey();
      const rail = $("tvBrowseRail"), expectedCount = tvBrowseInitialVisibleCardCount(rail, Number.MAX_SAFE_INTEGER);
      const dataPending = !!(query && (
        (items.length < expectedCount && query.hasMore)
        || (!items.length && (query.loading || !query.loaded))
      ));
      const visibleCards = (cards || []).slice(0, Math.max(0, Number(visibleCount) || 0));
      const signature = dataPending
        ? "data-pending:" + String(items.length) + ":" + String(query.page || 0)
        : visibleCards.map((card) => [card.dataset.mediaKey || "", tvBrowsePosterSource(card.querySelector("img.poster"))].join("\u001f")).join("\u001e")
          || (!items.length ? "no-visible-cards" : "no-visible-cards");
      const shouldManage = !!allowGate || !!(ui.coldRailQueryKey && ui.coldRailQueryKey === queryKey)
        || !!(ui.railReadiness && ui.railReadiness.queryKey === queryKey);
      if (!shouldManage) return false;
      if (ui.view !== "home" || wall.active || historyViewUnavailable(query)) {
        tvBrowseCancelRailReadiness(); ui.coldRailQueryKey = ""; return false;
      }
      if (dataPending) {
        if (ui.railReadiness && ui.railReadiness.queryKey === queryKey && ui.railReadiness.signature === signature) return true;
        const signatureKey = queryKey + "|" + signature;
        if (ui.railReadinessTimedOutKey === signatureKey) {
          ui.coldRailQueryKey = queryKey; tvBrowseSetRailLoading(true, "首屏暂不可用", false); return true;
        }
        if (ui.railReadiness) tvBrowseCancelRailReadiness();
        const gate = { queryKey, signature, dataPending: true, imageNodes: [], token: ++ui.railReadinessToken, pending: [], timeoutId: 0, settled: false };
        ui.railReadiness = gate; ui.coldRailQueryKey = queryKey; ui.railReadinessTimedOutKey = "";
        tvBrowseSetRailLoading(true);
        gate.timeoutId = setTimeout(() => tvBrowseFinishRailReadiness(gate, true), TV_BROWSE_RAIL_READY_TIMEOUT_MS);
        if (query.hasMore && !query.loading && !query.error && !query.retryableError) {
          loadSecondaryPage(ui.column, query, query.page + 1, { reason: "tv-browse-first-screen" }).catch(() => {});
        }
        return true;
      }
      if (!visibleCards.length) {
        tvBrowseCancelRailReadiness(); ui.coldRailQueryKey = ""; return false;
      }
      const signatureKey = queryKey + "|" + signature;
      const readyByImages = visibleCards.every((card) => {
        const image = card.querySelector("img.poster"), stateName = image && image.dataset.tvBrowsePosterState;
        if (stateName === "ready" || stateName === "failed") return true;
        if (!image || !tvBrowsePosterSource(image)) { tvBrowseMarkPosterState(card, image, "failed"); return true; }
        if (image.hasAttribute("data-src") || image.hasAttribute("data-home-deferred")) return false;
        if (!image.complete) return false;
        if (image.naturalWidth === 0) { tvBrowseMarkPosterState(card, image, "failed"); return true; }
        return typeof image.decode !== "function" && (tvBrowseMarkPosterState(card, image, "ready"), true);
      });
      const imageNodes = visibleCards.map((card) => card.querySelector("img.poster"));
      if (ui.railReadiness && ui.railReadiness.queryKey === queryKey && ui.railReadiness.signature === signature
        && imageNodes.length === ui.railReadiness.imageNodes.length
        && imageNodes.every((image, index) => image === ui.railReadiness.imageNodes[index])) return true;
      if (ui.railReadiness) tvBrowseCancelRailReadiness();
      const cachedReady = ui.railReadyByQuery[queryKey];
      const cachedNodesMatch = !!cachedReady && cachedReady.signature === signature
        && Array.isArray(cachedReady.imageNodes) && imageNodes.length === cachedReady.imageNodes.length
        && imageNodes.every((image, index) => image === cachedReady.imageNodes[index]);
      if (cachedNodesMatch || readyByImages) {
        tvBrowseRememberRailReady(queryKey, signature, imageNodes);
        ui.coldRailQueryKey = ""; ui.railReadinessTimedOutKey = "";
        tvBrowseSetRailLoading(false);
        return false;
      }
      if (ui.railReadinessTimedOutKey === signatureKey) {
        ui.coldRailQueryKey = ""; tvBrowseSetRailLoading(false); return false;
      }
      const gate = { queryKey, signature, imageNodes, dataPending: false, token: ++ui.railReadinessToken, pending: [], timeoutId: 0, settled: false, initializing: true };
      ui.railReadinessTimedOutKey = "";
      ui.railReadiness = gate; ui.coldRailQueryKey = queryKey; tvBrowseSetRailLoading(true);
      const settleImage = (entry, ready) => {
        if (gate.settled || ui.railReadiness !== gate || !gate.pending.includes(entry)) return;
        tvBrowseMarkPosterState(entry.card, entry.image, ready ? "ready" : "failed");
        entry.image.removeEventListener("load", entry.onLoad);
        entry.image.removeEventListener("error", entry.onError);
        gate.pending = gate.pending.filter((candidate) => candidate !== entry);
        if (!gate.pending.length && !gate.initializing) tvBrowseFinishRailReadiness(gate, false);
      };
      const imageLoaded = (entry) => {
        const image = entry.image;
        if (image.naturalWidth === 0) return settleImage(entry, false);
        image.dataset.tvBrowseDecodePrepared = entry.card.dataset.mediaKey || "";
        if (typeof image.decode !== "function") return settleImage(entry, true);
        let decoding;
        try { decoding = image.decode(); } catch (error) { return settleImage(entry, true); }
        if (!decoding || typeof decoding.then !== "function") return settleImage(entry, true);
        decoding.then(() => settleImage(entry, true), () => settleImage(entry, true));
      };
      visibleCards.forEach((card) => {
        const image = card.querySelector("img.poster"), source = tvBrowsePosterSource(image);
        if (!image || !source) { tvBrowseMarkPosterState(card, image, "failed"); return; }
        if (image.dataset.tvBrowsePosterState === "ready" || image.dataset.tvBrowsePosterState === "failed") return;
        image.loading = "eager";
        if (image.hasAttribute("data-src")) activateHomeDeferredImage(image, { proactive: true, decode: false });
        const entry = { card, image, onLoad: null, onError: null };
        entry.onLoad = () => imageLoaded(entry);
        entry.onError = () => settleImage(entry, false);
        if (image.complete) {
          if (image.naturalWidth > 0) { gate.pending.push(entry); imageLoaded(entry); }
          else tvBrowseMarkPosterState(card, image, "failed");
          return;
        }
        gate.pending.push(entry);
        image.addEventListener("load", entry.onLoad);
        image.addEventListener("error", entry.onError);
      });
      gate.initializing = false;
      if (!gate.pending.length) tvBrowseFinishRailReadiness(gate, false);
      else gate.timeoutId = setTimeout(() => tvBrowseFinishRailReadiness(gate, true), TV_BROWSE_RAIL_READY_TIMEOUT_MS);
      return true;
    }

    function historyViewUnavailable(query) {
      return !query || !query.key || tvBrowseState().view !== "home";
    }

    function tvBrowseDecodePoster(image) {
      if (!image || typeof image.decode !== "function") return false;
      const card = image.closest && image.closest(".card"), key = card && card.dataset.mediaKey || "";
      if (image.dataset.tvBrowseDecodePrepared === key) return false;
      image.dataset.tvBrowseDecodePrepared = key;
      try {
        const decoding = image.decode();
        if (decoding && typeof decoding.then === "function") {
          const markReady = () => {
            if (image.dataset.tvBrowseDecodePrepared !== key || image.dataset.tvBrowsePosterState === "failed") return;
            if (card && card.isConnected) tvBrowseMarkPosterState(card, image, "ready");
          };
          decoding.then(markReady, markReady);
        } else if (image.complete && image.naturalWidth > 0 && card) tvBrowseMarkPosterState(card, image, "ready");
      } catch (error) {
        if (image.complete && image.naturalWidth > 0 && card) tvBrowseMarkPosterState(card, image, "ready");
      }
      return true;
    }

    function tvBrowseSyncRailImagePreparation() {
      if (!tvBrowseActive() || tvBrowseState().view !== "home") return false;
      const ui = tvBrowseState(), rail = $("tvBrowseRail");
      if (!rail || rail.dataset.queryKey !== tvBrowseQueryKey()) return false;
      observeHomeImages(rail);
      const cards = Array.from(rail.children).filter((card) => card.classList && card.classList.contains("card"));
      if (!cards.length) return false;
      const style = getComputedStyle(rail), rect = rail.getBoundingClientRect();
      const left = rect.left + (rail.clientLeft || 0) + (parseFloat(style.paddingLeft) || 0);
      const right = rect.left + (rail.clientLeft || 0) + rail.clientWidth - (parseFloat(style.paddingRight) || 0);
      const expectedScroll = tvBrowseExpectedRailScrollLeft(rail), liveScroll = Number(rail.scrollLeft || 0);
      const visible = cards.filter((card) => {
        const cardRect = card.getBoundingClientRect();
        const shift = expectedScroll - liveScroll;
        const projectedLeft = cardRect.left - shift, projectedRight = cardRect.right - shift;
        return projectedRight > left + 0.5 && projectedLeft < right - 0.5;
      });
      visible.forEach((card) => {
        const image = card.querySelector("img.poster");
        if (!image) return;
        if (image.hasAttribute("data-home-deferred") && image.getAttribute("data-src")) activateHomeDeferredImage(image);
        if (!(ui.railReadiness && ui.railReadiness.queryKey === tvBrowseQueryKey())) tvBrowseDecodePoster(image);
      });
      if (ui.railReadiness && ui.railReadiness.queryKey === tvBrowseQueryKey()) return false;
      const lastVisibleIndex = visible.reduce((last, card) => Math.max(last, cards.indexOf(card)), -1);
      const targetIndex = lastVisibleIndex + 1;
      let target = cards[targetIndex] || null;
      if (!target && lastVisibleIndex >= cards.length - 1) {
        const query = secondaryActiveQuery(tvBrowseState().column);
        const rawItems = tvBrowseState().column === "recommendation" ? recommendationPoolItems()
          : query && secondaryFilterItems(tvBrowseState().column, query.items || []);
        if (rawItems && targetIndex < rawItems.length && !ui.railRangeExpansion) {
          ui.railRangeExpansion = true;
          try {
            if (tvBrowseState().column === "recommendation") renderTvBrowse({ append: true, ensureIndex: targetIndex, reason: "browse-viewport-preparation" });
            else tvBrowseMaybeLoadMore(cards.length - 1);
          } finally { ui.railRangeExpansion = false; }
          return tvBrowseSyncRailImagePreparation();
        }
        if (lastVisibleIndex >= cards.length - 1) tvBrowseMaybeLoadMore(lastVisibleIndex);
      }
      const image = target && target.querySelector("img.poster");
      const targetKey = target && target.dataset.mediaKey || "";
      ui.posterWarmTargetKey = image && targetKey ? targetKey : "";
      if (!image) return false;
      const isPlaceholder = image.hasAttribute("data-home-deferred") && image.getAttribute("data-src");
      if (isPlaceholder) activateHomeDeferredImage(image, { proactive: true });
      else if (image.complete && image.naturalWidth) tvBrowseDecodePoster(image);
      return true;
    }

    function tvBrowseReconcileRailNodes(rail, nextNodes, queryChanged) {
      const previous = Array.from(rail.children);
      if (queryChanged) {
        const fragment = document.createDocumentFragment();
        nextNodes.forEach((card) => fragment.appendChild(card));
        rail.replaceChildren(fragment);
        return true;
      }
      const sharedLength = Math.min(previous.length, nextNodes.length);
      const sameKeyOrder = previous.slice(0, sharedLength).every((card, index) =>
        String(card.dataset.mediaKey || "") === String(nextNodes[index].dataset.mediaKey || ""));
      if (!sameKeyOrder) {
        const fragment = document.createDocumentFragment();
        nextNodes.forEach((card) => fragment.appendChild(card));
        rail.replaceChildren(fragment);
        return true;
      }
      let changed = previous.length !== nextNodes.length;
      for (let index = 0; index < sharedLength; index += 1) {
        if (previous[index] === nextNodes[index]) continue;
        tvBrowseReuseCardPoster(previous[index], nextNodes[index]);
        rail.replaceChild(nextNodes[index], previous[index]);
        changed = true;
      }
      while (rail.children.length > nextNodes.length) {
        rail.removeChild(rail.lastElementChild);
        changed = true;
      }
      for (let index = previous.length; index < nextNodes.length; index += 1) {
        rail.appendChild(nextNodes[index]);
        changed = true;
      }
      return changed;
    }

    function tvBrowseReuseCardPoster(previous, next) {
      if (!previous || !next || previous.dataset.mediaKey !== next.dataset.mediaKey) return false;
      const oldImage = previous.querySelector("img.poster"), newImage = next.querySelector("img.poster");
      const oldSource = tvBrowsePosterSource(oldImage), newSource = tvBrowsePosterSource(newImage);
      if (!oldImage || !newImage || !oldSource || oldSource !== newSource || !newImage.parentNode) return false;
      const oldDeferred = oldImage.getAttribute("data-src"), newDeferred = newImage.getAttribute("data-src");
      if (newDeferred && oldDeferred) {
        oldImage.setAttribute("data-src", newDeferred);
        oldImage.setAttribute("data-home-deferred", "1");
      } else if (newDeferred && !oldDeferred) {
        oldImage.removeAttribute("data-src"); oldImage.removeAttribute("data-home-deferred");
      } else if (!newDeferred && oldDeferred) {
        oldImage.loading = newImage.loading || "eager";
        oldImage.removeAttribute("data-src"); oldImage.removeAttribute("data-home-deferred");
        oldImage.src = newSource;
      }
      oldImage.className = newImage.className;
      oldImage.alt = newImage.alt;
      ["loading", "decoding", "fetchpriority"].forEach((name) => {
        if (newImage.hasAttribute(name)) oldImage.setAttribute(name, newImage.getAttribute(name));
        else oldImage.removeAttribute(name);
      });
      newImage.parentNode.replaceChild(oldImage, newImage);
      return true;
    }

    function tvBrowseSavePosition() {
      const rail = $("tvBrowseRail");
      if (!rail || rail.dataset.queryKey !== tvBrowseQueryKey()) return;
      const position = tvBrowsePosition();
      position.scrollLeft = Math.max(0, rail.scrollLeft || 0);
      const wall = tvWallpaperState();
      // Wallpaper selection is owned by the active-query position. Its DOM
      // click sink intentionally is not a card, and a stale focused card must
      // not replace the position while handing off to Detail.
      if (wall.active || wall.detailPending) return;
      const card = document.activeElement && document.activeElement.closest("#tvBrowseRail .card");
      if (card) { position.key = card.dataset.mediaKey || ""; position.index = Number(card.dataset.cardIndex || 0); }
    }

    function tvBrowsePosterTarget() {
      const rail = $("tvBrowseRail"), position = tvBrowsePosition();
      // Down immediately after a column focus must enter the current query,
      // even if its coalesced after-paint render has not run yet.
      if (rail && tvBrowseActive() && rail.dataset.queryKey !== tvBrowseQueryKey()) renderTvBrowse();
      const cards = rail ? Array.from(rail.querySelectorAll(".card")) : [];
      return cards.find((card) => card.dataset.mediaKey === position.key) || cards[Math.min(position.index, cards.length - 1)] || (tvBrowseState().view === "history" ? tvBrowseHistoryToolsTarget() : tvBrowseColumnButton(tvBrowseState().column));
    }

    function tvBrowseHistoryToolsTarget() {
      return Array.from($("tvBrowseRecentTools").querySelectorAll("button")).find(isVisibleFocusable) || null;
    }

    function tvBrowseFocusIntent(focus) {
      tvBrowseState().focusIntent = { epoch: homeFocusUserEpoch(), focus: focus || null };
      tvBrowseTryFocus();
    }

    function tvBrowseTryFocus() {
      const ui = tvBrowseState(), intent = ui.focusIntent;
      if (!intent || tvWallpaperIsActive() || !tvBrowseActive() || isSidebarOpen() || focusScopeRoot() !== document) return;
      if (intent.epoch !== homeFocusUserEpoch()) { ui.focusIntent = null; return; }
      const query = ui.view === "history" ? state.recent : secondaryActiveQuery(ui.column);
      const position = tvBrowsePosition();
      if (query && query.loaded && query.hasMore && !query.error && !query.retryableError && position.index >= query.items.length) {
        if (!query.loading) loadSecondaryPage(ui.column, query, query.page + 1).catch(() => {});
        return;
      }
      const saved = intent.focus;
      const requested = saved && saved.type === "id" ? $(saved.key) : null;
      const target = requested && isVisibleFocusable(requested) ? requested : tvBrowsePosterTarget();
      if (!target || !isVisibleFocusable(target)) return;
      focusRemoteTarget(target);
      state.remoteInitialFocused = true;
      // A loading column is an interim cold-start target, not a completed
      // media restore. The existing user epoch cancels this intent on input.
      if ((ui.view !== "history" || query.loaded && !query.loading)
        && (target.closest("#tvBrowseRail") || saved && saved.type === "id" || query && query.loaded && (ui.view === "history" || ui.column !== "recommendation" || state.hot.ready))) ui.focusIntent = null;
    }

    function tvBrowseSelectColumn(id, options) {
      if (!tvBrowseColumns().some((entry) => entry.listId === id)) return false;
      const ui = tvBrowseState(), opts = options || {};
      tvBrowseSavePosition();
      if (ui.column !== id && recentManageRuntime().deleting) return false;
      if (ui.column !== id) resetRecentManageState();
      if (ui.filterOpen) clearTvPanelHistoryEntry("filters", "#tv-filters");
      ui.view = "home"; ui.column = id;
      ui.filterOpen = false;
      ui.previewKey = "";
      const focusedQuery = secondaryActiveQuery(id);
      if (focusedQuery && focusedQuery.loading) promoteSecondaryQueryRequests(focusedQuery, "category-focus");
      if (!opts.keepConfirm) ui.confirm = null;
      if (opts.afterPaint) {
        syncTvBrowseColumns();
        const queryKey = focusedQuery && focusedQuery.key || tvBrowseQueryKey();
        const hasReadyCache = !!(ui.railCache && ui.railCache[queryKey] && ui.railReadyByQuery && ui.railReadyByQuery[queryKey]);
        if (hasReadyCache) renderTvBrowse();
        else {
          const host = $("tvBrowsePosters");
          if (host) host.classList.add("rail-switch-pending");
          scheduleHomeContentRender({ afterPaint: true });
        }
      } else renderTvBrowse();
      scheduleUiSnapshotSave();
      return true;
    }

    function tvBrowseActivateColumn(id) {
      const ui = tvBrowseState(), now = Date.now();
      const doubleConfirm = ui.confirm && ui.confirm.id === id && now - ui.confirm.at <= 400;
      if (ui.column !== id) tvBrowseSelectColumn(id, { keepConfirm: true });
      ui.confirm = doubleConfirm ? null : { id, at: now };
      if (doubleConfirm && secondaryFilterGroups(id, secondaryCatalogBaseItems(id)).length) tvBrowseOpenFilters();
    }

    function tvBrowseOpenFilters() {
      const ui = tvBrowseState();
      if (!tvBrowseActive() || ui.view === "history" || !secondaryFilterGroups(ui.column, secondaryCatalogBaseItems(ui.column)).length) return false;
      ui.filterOpen = true;
      renderTvBrowseFilters();
      syncTvBrowseVisibility();
      layoutTvBrowse();
      const host = $("tvBrowseFilters");
      focusRemoteTarget(tvBrowseFilterTarget() || host.querySelector("button"));
      return true;
    }

    function tvBrowseFilterTarget() {
      const ui = tvBrowseState(), host = $("tvBrowseFilters"), filters = secondaryFilterState(ui.column);
      const buttons = Array.from(host.querySelectorAll("button"));
      return buttons.find((button) => button.dataset.group === ui.filterFocusGroup && button.dataset.value === filters.lastFocused[ui.filterFocusGroup])
        || host.querySelector(".selected") || buttons[0] || null;
    }

    function tvBrowseCloseFilters(options) {
      const ui = tvBrowseState();
      if (!ui.filterOpen) return false;
      const opts = options || {}, active = document.activeElement;
      const card = active && active.closest("#tvBrowseRail .card");
      tvBrowseSavePosition();
      if (!opts.fromPopState) clearTvPanelHistoryEntry("filters", "#tv-filters");
      ui.filterOpen = false;
      ui.confirm = null; ui.focusIntent = null;
      syncTvBrowseVisibility();
      if (tvBrowseActive()) {
        const poster = tvBrowsePosterTarget();
        if (poster && poster.__mediaItem) tvBrowsePreview(poster.__mediaItem);
        if (!isVisibleFocusable(card)) focusRemoteTarget(tvBrowseColumnButton(ui.column));
        scheduleUiSnapshotSave();
      }
      return true;
    }

    function renderTvBrowseFilters() {
      const ui = tvBrowseState(), host = $("tvBrowseFilters");
      const groups = secondaryFilterGroups(ui.column, secondaryCatalogBaseItems(ui.column));
      const filters = secondaryNormalizeFilterValues(ui.column, groups);
      const signature = ui.column + secondaryFilterSchemaSignature(groups);
      if (host.dataset.schema !== signature) {
        host.dataset.schema = signature;
        host.innerHTML = groups.map((group) => `<div class="secondary-filter-row" data-group="${escapeAttr(group.key)}"><span class="secondary-filter-label">${escapeHtml(group.label)}</span><div class="secondary-filter-options">${group.options.map((option) => `<button type="button" class="focusable tv-browse-control tv-browse-pill secondary-filter-option" data-group="${escapeAttr(group.key)}" data-value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</button>`).join("")}</div></div>`).join("");
        host.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
          tvBrowseSavePosition();
          const current = secondaryFilterState(ui.column);
          const group = button.dataset.group, value = button.dataset.value;
          const next = current[group] === value ? secondaryFilterDefaultValue(group) : value;
          if (next === current[group]) return;
          current[group] = next;
          current.lastFocused[group] = value;
          ui.previewKey = "";
          renderTvBrowse();
          scheduleUiSnapshotSave();
        }));
      }
      host.querySelectorAll("button").forEach((button) => {
        button.onfocus = () => {
          ui.filterFocusGroup = button.dataset.group;
          secondaryFilterState(ui.column).lastFocused[button.dataset.group] = button.dataset.value;
        };
        const selected = filters[button.dataset.group] === button.dataset.value;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    }

    function syncTvBrowseFilterOverview() {
      const overview = $("tvBrowseFilterOverview");
      if (!overview) return;
      overview.textContent = $("tvBrowseOverview").textContent;
      overview.hidden = !tvBrowseState().filterOpen || !overview.textContent.trim()
        || Number($("tvBrowse").style.getPropertyValue("--tv-filter-overview-lines")) < 1;
    }

    function syncTvBrowseVisibility() {
      const root = $("tvBrowse"), ui = tvBrowseState();
      if (!root) return;
      root.hidden = !tvBrowseActive();
      if (!tvBrowseActive()) { tvBrowseCancelLogo(); ui.enterHeld = false; ui.confirm = null; }
      root.classList.toggle("filter-open", ui.filterOpen);
      root.classList.toggle("history-open", ui.view === "history");
      if (tvBrowseActive() && ui.view === "history" && uiSnapshotRoute() === "home" && !isConnectionPanelOpen()
        && (!location.hash || location.hash === "#tv-history")) ensureTvPanelHistoryEntry("tvHistory", "#tv-history");
      const hideFunctions = ui.filterOpen || ui.view === "history";
      $("tvBrowseFunctions").hidden = hideFunctions;
      $("tvBrowseFunctions").querySelectorAll("button").forEach((button) => button.tabIndex = hideFunctions ? -1 : 0);
      $("tvBrowseRecentTools").hidden = ui.filterOpen;
      $("tvBrowseInfo").hidden = ui.filterOpen;
      $("tvBrowseFilters").hidden = !ui.filterOpen;
      // Visibility reserves the column row so filter toggles never move the rail.
      $("tvBrowseColumns").setAttribute("aria-hidden", String(ui.filterOpen || ui.view === "history"));
      if (tvBrowseActive() && ui.filterOpen && location.hash !== "#detail" && uiSnapshotRoute() === "home") ensureTvPanelHistoryEntry("filters", "#tv-filters");
      root.querySelectorAll("#tvBrowseColumns button").forEach((button) => button.setAttribute("tabindex", ui.filterOpen || ui.view === "history" ? "-1" : "0"));
      document.documentElement.classList.toggle("tv-browse-active", tvBrowseActive());
    }

    function layoutTvBrowse() {
      const root = $("tvBrowse"), rail = $("tvBrowseRail");
      if (!tvBrowseActive() || !root || !rail) return;
      const rect = root.getBoundingClientRect(), viewport = window.visualViewport;
      const height = Math.min(rect.height, (viewport ? viewport.offsetTop + viewport.height : innerHeight) - rect.top);
      if (height <= 0) return;
      const clamp = (min, value, max) => Math.max(min, Math.min(value, max));
      const set = (name, value) => {
        const property = "--tv-" + name;
        if (root.style.getPropertyValue(property) !== String(value)) root.style.setProperty(property, value);
      };
      const px = (name, value) => set(name, value + "px");
      const gap = clamp(4, height * .01, 12), infoGap = clamp(2, height * .004, 5);
      const top = clamp(8, height * .03, 32);
      const foreground = root.querySelector(".tv-browse-foreground");
      const captionFont = clamp(13, height * 21 / 1080, 21), metaFont = clamp(13, height * 22 / 1080, 22);
      const overviewFont = clamp(14, height * 24 / 1080, 24), titleFont = clamp(24, height * .05, 54);
      px("visible-height", height); px("safe-top", top);
      px("gap", gap); px("info-gap", infoGap); px("caption-font", captionFont);
      px("meta-font", metaFont); px("overview-font", overviewFont); px("title-font", titleFont);
      px("filter-height", clamp(28, height * 34 / 1080, 36));
      px("control-height", clamp(36, height * .045, 50)); px("control-icon", clamp(21, height * .025, 28));
      px("column-font", clamp(16, height * 24 / 1080, 24));
      px("preview-gap", clamp(12, height * .03, 40));
      const feedback = root.querySelector(".tv-browse-feedback");
      // Feedback shares the upper row; loading cannot change the rail baseline.
      feedback.hidden = !Array.from(feedback.children).some((child) => !child.hidden && child.textContent.trim());
      // A single title line has the same footprint in every browse mode.
      const caption = Math.max(15, captionFont * 1.2) + 13;
      let core;
      let poster, focusSpace, railSlot, upper, compact;
      // Two bounded profiles coordinate the entire screen; neither depends on
      // filter visibility or the currently selected media's synopsis length.
      for (let profile = 0; profile < 2; profile += 1) {
        compact = profile === 1;
        core = metaFont * (compact ? 1.2 : 2.4) + infoGap * 4;
        set("core-columns", compact ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)");
        px("column-pad-y", compact ? 4 : 8); px("column-pad-x", clamp(10, height * 12 / 1080, 12));
        px("column-gap", clamp(10, height * 12 / 1080, 12)); px("function-gap", compact ? 6 : clamp(8, rect.width * .008, 16));
        px("resume-gap", compact ? 12 : 18);
        px("card-gap", clamp(12, rect.width * .014, 28));
        const minWidth = compact ? 96 : Math.max(96, captionFont * 6 + 16);
        poster = Math.max(minWidth * 1.5, height * .33);
        // Each edge owns half the 4% centered scale plus rounding safety.
        // Rail padding consumes these same edges; do not scale the slot again.
        focusSpace = Math.ceil((poster + caption) * .02) + 2;
        railSlot = Math.ceil(poster + caption) + focusSpace * 2;
        // Project the real 1.04-scaled title edge into the visible viewport.
        // CSS resolves system safe-area insets on this one foreground.
        const titleEdge = railSlot - focusSpace - (poster + caption) * 1.02 + 6 * 1.04;
        px("rail-title-bottom-gap", titleEdge);
        px("safe-bottom", Math.max(2, Math.max(8, height * .019) - titleEdge));
        const bottom = parseFloat(getComputedStyle(foreground).paddingBottom);
        upper = height - top - bottom - $("tvBrowseColumns").offsetHeight - railSlot - gap;
        if (upper >= height * .15 + core + overviewFont * 4.5 || compact) break;
      }
      const logoHeight = Math.min(height * (compact ? .11 : .15), Math.max(titleFont * 1.1, upper - core));
      const lines = Math.max(0, Math.min(3, Math.floor((upper - logoHeight - core) / (overviewFont * 1.5))));
      px("logo-height", logoHeight); px("info-offset", Math.min(height * .04, Math.max(0, upper - logoHeight - core - lines * overviewFont * 1.5)));
      set("title-lines", compact ? "1" : "2"); set("overview-lines", String(lines));
      set("overview-display", lines ? "-webkit-box" : "none");
      px("poster-height", poster); px("poster-width", poster * 2 / 3);
      px("focus-space", focusSpace); px("rail-slot", railSlot);
      // Filters occupy the flexible upper row; synopsis owns its bottom row.
      // Neither can resize the fixed poster row or the reserved navigation row.
      const filters = $("tvBrowseFilters"), upperHost = root.querySelector(".tv-browse-upper");
      const used = Array.from(filters.querySelectorAll(".secondary-filter-row")).reduce((sum, row) =>
        sum + row.offsetHeight + parseFloat(getComputedStyle(row).marginBottom), 4);
      const spare = upperHost.clientHeight - used - gap - parseFloat(root.style.getPropertyValue("--tv-preview-gap"));
      set("filter-overview-lines", String(height < 450 ? 0 : clamp(0, Math.floor(spare / (overviewFont * 1.5)), height >= 720 ? 3 : 2)));
      syncTvBrowseFilterOverview();
      if (tvWallpaperIsActive()) {
        tvWallpaperScheduleInfoShift();
        observeHomeImages(rail); observeMovieCardEnrichment(rail);
      } else {
        const focusedCard = document.activeElement && document.activeElement.closest("#tvBrowseRail .card");
        if (focusedCard) tvBrowseScheduleRailAnchor(focusedCard);
      }
    }

    function initTvBrowse() {
      const ui = tvBrowseState();
      if (ui.initialized) return;
      ui.initialized = true;
      // One environment observer drives the foreground budget. Child grids
      // and filter transitions do not create competing size writers.
      const resizeBrowse = () => { layoutTvBrowse(); tvBrowseSyncRailImagePreparation(); };
      if (typeof ResizeObserver === "function") new ResizeObserver(resizeBrowse).observe($("tvBrowse"));
      else window.addEventListener("resize", resizeBrowse);
      if (window.visualViewport) window.visualViewport.addEventListener("resize", resizeBrowse);
      const controls = $("recentManageControls");
      if (controls) $("tvBrowseRecentTools").appendChild(controls);
      const columns = $("tvBrowseColumns");
      tvBrowseColumns().forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button"; button.className = "focusable tv-browse-control tv-browse-pill tv-browse-column";
        button.id = "tvColumn-" + entry.listId; button.dataset.column = entry.listId; button.textContent = entry.label;
        button.addEventListener("focus", () => {
          // Focus selects content; Enter only owns the existing double-confirm
          // filter gesture. Returning to the active column keeps its position.
          if (ui.view === "home" && !ui.filterOpen && ui.column !== entry.listId) {
            tvBrowseSelectColumn(entry.listId, { afterPaint: true });
          }
        });
        button.addEventListener("click", (event) => {
          // Native WebViews may emit a click after the handled physical key.
          if (ui.enterHeld || Date.now() < ui.suppressClickUntil) { event.preventDefault(); return; }
          markHomeUserNavigation();
          tvBrowseActivateColumn(entry.listId);
        });
        button.addEventListener("blur", () => { ui.confirm = null; });
        columns.appendChild(button);
      });
      const actions = [
        ["search", "搜索", openSearchPage], ["live", "直播", openLiveHome], ["history", "历史", tvBrowseOpenHistory], ["settings", "设置", openSettingHome]
      ];
      actions.forEach(([id, label, action]) => {
        const button = document.createElement("button");
        button.id = "tvFunction-" + id; button.type = "button";
        button.className = "focusable tv-browse-control"; button.tabIndex = 0;
        button.setAttribute("aria-label", label);
        if (id === "search") {
          button.classList.add("tv-browse-search");
          button.innerHTML = '<span>搜索</span><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4 4"></path></svg>';
        } else button.innerHTML = `<span>${escapeHtml(label)}</span>`;
        button.addEventListener("click", () => {
          markHomeUserNavigation(); tvBrowseSavePosition();
          if (id === "live") rememberFocusReturn();
          scheduleUiSnapshotSave(); action();
        });
        $("tvBrowseFunctions").appendChild(button);
      });
      const dock = $("connectionDock"), toggle = $("connectionToggle");
      toggle.classList.remove("home-sidebar-item"); toggle.classList.add("tv-browse-control");
      toggle.setAttribute("aria-label", "基础设置"); toggle.removeAttribute("data-sidebar-key"); toggle.removeAttribute("data-sidebar-action");
      $("tvBrowseFunctions").appendChild(dock);
      window.addEventListener("blur", () => { ui.enterHeld = false; ui.confirm = null; if (ui.view === "history") cancelRecentDeleteArm(); });
      $("tvBrowse").addEventListener("click", (event) => {
        if (tvWallpaperHandleClick(event)) return;
        if ((ui.enterHeld || Date.now() < ui.suppressClickUntil) && event.detail === 0) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      }, true);
      $("tvBrowseRetry").addEventListener("click", () => {
        const id = ui.column, query = secondaryActiveQuery(id);
        if (ui.view === "history") {
          if (state.recent.loading) return;
          ui.retryFocusIntent = { epoch: homeFocusUserEpoch(), fallbackId: "" };
          loadRecentList({ refresh: true }).catch(() => {}); return;
        }
        if (id === "recommendation") { forceRefreshNostrRanking().catch(() => {}); return; }
        if (query && !query.loading) loadSecondaryPage(id, query, query.failedPage || query.page + 1 || 1, {
          refresh: !!(query.loaded && secondaryQueryNeedsRefresh(query)), reason: "tv-category-retry"
        }).catch(() => {});
      });
      $("tvHistoryContinue").addEventListener("click", () => tvBrowseContinueHistory());
      $("tvBrowseRail").addEventListener("scroll", () => {
        tvBrowseSavePosition(); tvBrowseSyncRailImagePreparation(); scheduleUiSnapshotSave();
      }, { passive: true });
    }

    function syncTvBrowseColumns() {
      const ui = tvBrowseState();
      $("tvBrowseColumns").querySelectorAll("button").forEach((button) => {
        const selected = button.dataset.column === ui.column;
        button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected));
      });
    }

    function renderTvBrowse(options) {
      if (!tvBrowseActive()) return;
      // Direct restores supersede a pending focus-driven render in the same
      // shared Home scheduler. It must not rebuild this query a second time.
      if (state.homeContentTimer) {
        cancelAnimationFrame(state.homeContentTimer); state.homeContentTimer = 0; state.homeContentSeq += 1;
      }
      initTvBrowse();
      syncTvBrowseVisibility();
      const postersHost = $("tvBrowsePosters");
      if (postersHost) postersHost.classList.remove("rail-switch-pending");
      const ui = tvBrowseState(), rail = $("tvBrowseRail");
      const focusBefore = tvBrowseFocusLabel();
      const historyView = ui.view === "history";
      const query = historyView ? { key: tvBrowseQueryKey(), items: state.recent.items || [], loaded: state.recent.loaded, loading: state.recent.loading, error: state.recent.error } : secondaryGetQuery(ui.column);
      if (!historyView && ui.column !== "recommendation" && query.loading) promoteSecondaryQueryRequests(query, "category-focused-render");
      $("tvBrowse").classList.toggle("empty-history", historyView && !(query.items || []).length);
      // Finite sources can change independently of the catalog page loader.
      if (!historyView && ui.column === "recommendation") {
        const pool = recommendationPoolItems();
        const ensureIndex = Number(options && options.ensureIndex);
        query.renderedCount = Math.max(18, Number(query.renderedCount || 0),
          tvWallpaperIsActive() ? tvBrowsePosition().index + 8 : 0,
          Number.isFinite(ensureIndex) ? ensureIndex + 8 : 0);
        query.items = pool.slice(0, query.renderedCount);
        query.hasMore = query.renderedCount < pool.length;
        query.loaded = !!state.hot.ready; query.loading = !state.hot.ready; query.page = Math.ceil(query.renderedCount / query.batchSize);
      }
      const items = (historyView ? query.items : ui.column === "recommendation"
        ? filterBlocked(query.items || []) : secondaryFilterItems(ui.column, query.items || [])).filter((item) => historyView || hasPoster(item));
      // Measure the actual TV rail before deciding which poster requests are
      // part of the first viewport. A fixed index misses cards on wide screens.
      layoutTvBrowse();
      const eagerPosterCount = tvBrowseInitialVisibleCardCount(rail, items.length);
      const queryChanged = rail.dataset.queryKey !== query.key;
      const previousKey = rail.dataset.queryKey || "";
      if (queryChanged) {
        tvBrowseCancelRailScroll();
        tvBrowseCancelRailReadiness();
        if (previousKey && ui.view === "home" && !tvWallpaperIsActive()) ui.coldRailQueryKey = query.key;
      }
      if (queryChanged && previousKey) {
        ui.railCache = ui.railCache && typeof ui.railCache === "object" ? ui.railCache : {};
        ui.railCacheOrder = Array.isArray(ui.railCacheOrder) ? ui.railCacheOrder : [];
        ui.railCache[previousKey] = { keys: (rail.__renderKeys || []).slice(), nodes: Array.from(rail.children) };
        ui.railCacheOrder = ui.railCacheOrder.filter((key) => key !== previousKey).concat(previousKey);
        while (ui.railCacheOrder.length > 6) delete ui.railCache[ui.railCacheOrder.shift()];
      }
      const cachedRail = queryChanged && ui.railCache && ui.railCache[query.key] || null;
      const oldNodes = queryChanged ? cachedRail && cachedRail.nodes || [] : Array.from(rail.children);
      const oldKeys = queryChanged ? cachedRail && cachedRail.keys || [] : rail.__renderKeys || [];
      // Keep catalog data whole; materialize the visible batch and saved focus
      // first. Further cards append when DPAD approaches the current DOM end.
      const limit = historyView ? items.length : Math.max(18, tvBrowsePosition().index + 8,
        queryChanged ? 0 : oldKeys.length + (options && options.append ? 18 : 0));
      const keys = items.slice(0, limit).map((item, index) => mediaRenderKey(item, index));
      const focused = rail.contains(document.activeElement) ? document.activeElement.dataset.mediaKey : "";
      const priorByKey = new Map();
      oldNodes.forEach((card) => {
        const key = card && card.__mediaItem && mediaDomKey(card.__mediaItem);
        if (key) priorByKey.set(String(key), card);
      });
      let createdCards = 0, reusedCards = 0;
      const nextNodes = keys.map((key, index) => {
        const item = items[index], identity = String(mediaDomKey(item) || "");
        const signature = tvBrowseCardSignature(item);
        let card = identity && priorByKey.get(identity);
        if (!card || card.__tvBrowseRenderSignature !== signature) {
          card = mediaCard(item, index, {
            home: true, history: historyView, homeLazy: index >= eagerPosterCount,
            homePriority: index < eagerPosterCount, weeklyHome: !historyView && ui.column === "now-playing"
          });
          card.addEventListener("focus", () => {
            const position = tvBrowsePosition(); position.key = card.dataset.mediaKey; position.index = Number(card.dataset.cardIndex || 0);
            const direction = ui.navigationDirection < 0 ? -1 : 1;
            ui.navigationDirection = 0; ui.previewDirection = direction;
            tvBrowsePreview(card.__mediaItem, { direction });
            tvBrowseScheduleRailAnchor(card);
            tvBrowseMaybeLoadMore(position.index);
            tvBrowseSyncRailImagePreparation();
            scheduleUiSnapshotSave();
          });
          card.__tvBrowseRenderSignature = signature;
          createdCards += 1;
        } else {
          reusedCards += 1;
        }
        card.dataset.cardIndex = String(index);
        card.__mediaItem = item;
        return card;
      });
      const sequenceUnchanged = !queryChanged && nextNodes.length === rail.children.length
        && nextNodes.every((card, index) => card === rail.children[index]);
      const railChanged = queryChanged || !sequenceUnchanged;
      if (queryChanged) {
        rail.dataset.queryKey = query.key;
        rail.scrollLeft = tvBrowsePosition().scrollLeft;
      }
      if (railChanged) {
        tvBrowseReconcileRailNodes(rail, nextNodes, queryChanged);
      }
      if (queryChanged && ui.railCache) {
        delete ui.railCache[query.key];
        ui.railCacheOrder = (ui.railCacheOrder || []).filter((key) => key !== query.key);
      }
      rail.__renderKeys = keys;
      const tracked = state.recentDelete && (state.recentDelete.armedCard || state.recentDelete.pendingCard || state.recentDelete.remotePressCard);
      if (historyView && tracked && (!tracked.isConnected || !recentWatchingPressKey(tracked))) cancelRecentDeleteArm();
      syncTvBrowseVisibility();
      if (queryChanged) rail.scrollLeft = tvBrowsePosition().scrollLeft;
      syncTvBrowseColumns();
      updateRecentManageUi();
      updateBlockSelectUi();
      $("tvBrowseBlockHint").hidden = !state.blocked.selecting;
      const status = query.error || query.retryableError || (query.loading && !items.length ? "加载中…" : !items.length ? "暂无内容" : "");
      $("tvBrowseStatus").textContent = status;
      const retry = $("tvBrowseRetry");
      retry.hidden = !!query.loading || !(query.error || query.retryableError || !items.length && query.loaded);
      if (document.activeElement === retry && retry.hidden) {
        const fallback = historyView
          ? tvBrowseHistoryToolsTarget() || Array.from($("tvBrowseFunctions").querySelectorAll("button")).find(isVisibleFocusable)
          : tvBrowseColumnButton(ui.column);
        if (fallback && isVisibleFocusable(fallback)) {
          focusRemoteTarget(fallback);
          if (ui.retryFocusIntent) ui.retryFocusIntent.fallbackId = fallback.id || "";
        }
      }
      if (ui.filterOpen) renderTvBrowseFilters();
      layoutTvBrowse();
      const position = tvBrowsePosition();
      const selected = (historyView ? historyRecordFocusItem(items, position.key)
        : items.find((item) => mediaDomKey(item) === position.key)) || items[Math.min(position.index, items.length - 1)];
      if (historyView) { position.key = selected ? mediaDomKey(selected) : ""; position.index = selected ? items.indexOf(selected) : 0; }
      if (selected) tvBrowsePreview(selected);
      else tvBrowseClearPreview();
      tvWallpaperOnBrowseRendered(selected, items);
      if (historyView && !selected) {
        ui.backdropUrl = "";
        [$("tvBrowseBackdrop"), $("tvBrowseBackdropNext")].forEach((layer) => { layer.style.backgroundImage = ""; layer.classList.remove("visible"); });
        if (document.activeElement === $("tvHistoryContinue")) focusRemoteTarget(tvBrowsePosterTarget());
      }
      // observeHomeImages already registers TV episode enrichment.
      observeHomeImages(rail); observeMovieCardEnrichment(rail);
      tvBrowseEnsureRailReadiness(query, items, nextNodes, eagerPosterCount, queryChanged);
      tvBrowseSyncRailImagePreparation();
      if (tvWallpaperIsActive()) {
        tvWallpaperFocusClickSink();
      }
      if (focused && railChanged && !tvWallpaperIsActive() && focusScopeRoot() === document && !isSidebarOpen()) {
        const target = Array.from(rail.children).find((card) => card.dataset.mediaKey === focused) || (ui.filterOpen ? Array.from(rail.children).find(isVisibleFocusable) || tvBrowseFilterTarget() : tvBrowsePosterTarget());
        if (target) focusRemoteTarget(target);
      }
      tvBrowseTryFocus();
      if (historyView && ui.retryFocusIntent) {
        const intent = ui.retryFocusIntent;
        if (intent.epoch !== homeFocusUserEpoch()) ui.retryFocusIntent = null;
        else if (intent.fallbackId && document.activeElement.id !== intent.fallbackId) ui.retryFocusIntent = null;
        else if (!query.loading) {
          if (items.length) {
            const target = Array.from(rail.children).find(isVisibleFocusable);
            if (target) focusRemoteTarget(target);
            ui.retryFocusIntent = null;
          } else if (query.loaded || query.error) ui.retryFocusIntent = null;
        }
      }
      if (!historyView && ui.column !== "recommendation") {
        if (query.loading) promoteSecondaryQueryRequests(query, "category-focused-render");
        else if (query.loaded && secondaryQueryNeedsRefresh(query)) {
          loadSecondaryPage(ui.column, query, 1, { refresh: true, reason: "tv-category-cache-expired" }).catch(() => {});
        } else if (!query.loaded && !query.error) {
          loadSecondaryPage(ui.column, query, 1, { reason: "tv-category-first-entry" }).catch(() => {});
        }
      }
      if (!historyView && state.hot && state.hot.ready) tvBrowseMaybePreloadCategories("tv-recommendation-ready");
      recordTvBrowseDiagnostic("TV_BROWSE_RENDER", {
        queryKey: query.key, requestSeq: Number(query.requestSeq || 0), dataVersion: Number(query.dataVersion || 0),
        itemCount: items.length, renderedCount: rail.children.length, renderReason: options && options.reason || (queryChanged ? "query-change" : "state-update"),
        queryChanged, railChanged, createdCards, reusedCards, focusBefore, focusAfter: tvBrowseFocusLabel()
      });
    }

    function tvBrowseCardSignature(item) {
      let source;
      try { source = JSON.stringify(item || {}); }
      catch (e) { source = mediaRenderKey(item); }
      const type = String(item && (item.mediaType || item.media_type) || "").toLowerCase();
      let status = "";
      if (type === "tv") status = tvPresentationStatus(item, tvDetailCacheValue(item) || item.tvDetail || item.weeklyDetail || item.heroDetail || null);
      else if (type === "movie") status = movieReleaseStatusText(item, movieDetailCacheValue(item) || null);
      return [source, isBlocked(item) ? "blocked" : "", status].join("\u001f");
    }

    function tvBrowseMaybeLoadMore(index) {
      const ui = tvBrowseState(), query = secondaryActiveQuery(ui.column);
      const rail = $("tvBrowseRail");
      if (ui.view !== "history" && query && rail.children.length < query.items.length && index >= rail.children.length - 5) {
        renderTvBrowse({ append: true });
      }
      if (ui.view === "history" || !query || query.loading || query.error || query.retryableError || !query.hasMore || index < query.items.length - 5) return false;
      loadSecondaryPage(ui.column, query, query.page + 1).catch(() => {});
      return true;
    }

    function tvBrowseClearPreview() {
      const ui = tvBrowseState();
      ui.previewKey = ""; ui.presentedKey = ""; ui.backdropToken += 1; tvBrowseCancelLogo(); ui.logoKey = "";
      tvBrowseCancelPendingPreview(); tvBrowseCancelWarmBackdrop();
      $("tvBrowseTitle").textContent = ""; $("tvBrowseMeta").textContent = "";
      $("tvBrowseOverview").textContent = ""; $("tvBrowseUpdate").textContent = "";
      syncTvBrowseFilterOverview();
      $("tvBrowseLogo").hidden = true; $("tvBrowseTitle").hidden = false;
      $("tvHistoryResume").hidden = true;
      // Keep the last decoded backdrop until a valid replacement is ready.
    }

    function tvBrowseCancelLogo() {
      const ui = tvBrowseState();
      cancelArtTitle($("tvBrowseLogo"));
    }

    function tvBrowseRenderLogo(item, detail) {
      const ui = tvBrowseState();
      const type = String(item.mediaType || item.media_type || "").toLowerCase();
      const key = (type === "movie" ? movieDetailCacheKey(item) : type === "tv" ? tvDetailCacheKey(item) : "") || String(mediaDomKey(item));
      if (ui.logoKey !== key) { tvBrowseCancelLogo(); ui.logoKey = key; }
      renderArtTitle(item, detail, $("tvBrowseLogo"), $("tvBrowseTitle"), null, () => tvBrowseActive() && ui.logoKey === key);
    }

    function tvBrowsePrepareLogo(item, foreground) {
      const ui = tvBrowseState(), session = tvBrowseQueryKey();
      const type = String(item.mediaType || item.media_type || "").toLowerCase();
      const id = movieDetailCacheId(item), key = type + ":" + id;
      if (!/^(movie|tv)$/.test(type) || !id) return Promise.resolve(false);
      const runtime = type === "movie" ? state.movieDetail : state.tvDetail;
      const cached = type === "movie" ? movieDetailCacheValue(item) : tvDetailCacheValue(item);
      const asset = artLogoResource(item, cached);
      if (asset) prepareArtLogo(asset);
      if (cached) return prepareArtLogo(asset);
      const entry = runtime.cache[key];
      if (entry && entry.logoMetadataFailedAt && Date.now() - entry.logoMetadataFailedAt < 60000) return Promise.resolve(false);
      if (foreground) { ui.previewDetailRequestKey = key; promoteHomeBudgetRequests(key, "foreground", "focus"); }
      const shared = type === "movie" ? requestMovieDetailShared : requestTvDetailShared;
      return shared(item, (url, timeout) => scheduleHomeBudgetRequest(foreground ? "foreground" : "enrichment", () => {
        if (foreground && (!tvBrowseActive() || tvBrowseQueryKey() !== session || ui.logoKey !== key)) {
          const stale = new Error("Stale artwork preview"); stale.staleArtwork = true; throw stale;
        }
        if (!foreground) {
          const cards = Array.from($("tvBrowseRail").children), at = cards.findIndex((card) => mediaDomKey(card.__mediaItem) === ui.previewKey);
          if (!tvBrowseActive() || tvBrowseQueryKey() !== session || !cards.slice(Math.max(0, at - 1), at + 2).some((card) => mediaDomKey(card.__mediaItem) === mediaDomKey(item))) {
            const stale = new Error("Stale artwork candidate"); stale.staleArtwork = true; throw stale;
          }
        }
        return requestJson(url, timeout);
      }, key)).then((detail) => {
        if (!tvBrowseActive() || tvBrowseQueryKey() !== session || String(detail && detail.id || "") !== id) return false;
        const ready = prepareArtLogo(artLogoResource(item, detail));
        const cards = Array.from($("tvBrowseRail").children);
        const current = cards.find((card) => mediaDomKey(card.__mediaItem) === mediaDomKey(item));
        if (foreground && ui.logoKey === key && ui.previewKey === mediaDomKey(item)) tvBrowsePreview(current ? current.__mediaItem : item);
        if (!foreground && ui.previewKey) {
          const previewIndex = cards.findIndex((card) => mediaDomKey(card.__mediaItem) === ui.previewKey);
          const detailIndex = cards.findIndex((card) => mediaDomKey(card.__mediaItem) === mediaDomKey(item));
          if (previewIndex >= 0 && detailIndex >= 0 && Math.abs(previewIndex - detailIndex) <= 1) {
            tvBrowseWarmNextBackground(cards[previewIndex].__mediaItem);
          }
        }
        return ready;
      }).catch((error) => { const failed = runtime.cache[key]; if (failed && !error.staleArtwork) failed.logoMetadataFailedAt = Date.now(); return false; });
    }

    function tvBrowseEnsurePreviewDetail(item, detail) {
      if (!detail) tvBrowsePrepareLogo(item, true);
    }

    function tvBrowsePreviewDetail(item) {
      const type = String(item.mediaType || item.media_type || "").toLowerCase();
      const cached = (type === "movie" ? movieDetailCacheValue(item) || item.movieDetail : type === "tv" ? tvDetailCacheValue(item) || item.tvDetail : null) || item.weeklyDetail || item.heroDetail || null;
      return cached && String(cached.id || cached.tmdbId || "") === String(item.tmdbId || item.id || "") && (!cached.media_type || cached.media_type === type) ? cached : null;
    }

    function tvBrowsePreviewBackgrounds(item, detail) {
      const backdrop = item.landscape || item.backdrop || item.backdrop_path || detail && detail.backdrop_path;
      const preferred = displayImage(backdrop || item.image || item.pic, { size: backdrop ? "w1280" : "w780" });
      const fallback = backdrop ? displayImage(item.image || item.pic, { size: "w780" }) : "";
      return { preferred, urls: [preferred, fallback].filter((url, index, list) => !!url && list.indexOf(url) === index) };
    }

    function tvBrowseCommitPreviewInfo(item, detail, key) {
      const ui = tvBrowseState();
      if (!item || key !== ui.previewKey) return false;
      $("tvBrowseTitle").textContent = item.title || item.name || "";
      const year = String(detail && (detail.release_date || detail.first_air_date) || item.releaseDate || item.first_air_date || item.release_date || "").slice(0, 4);
      const genres = homeHeroPresentationGenres(item, detail);
      const rating = Number(detail && detail.vote_average || item.voteAverage || item.vote_average || 0);
      $("tvBrowseMeta").textContent = [year, genres.join(" · "), rating > 0 ? rating.toFixed(1) + " 分" : ""].filter(Boolean).join("  /  ");
      $("tvBrowseUpdate").textContent = homeHeroPresentationStatus(item, detail) || "";
      tvBrowseRenderContinue(item);
      const desc = String(item.description || item.desc || "").trim();
      const labelOnly = item.source === "tmdb" && desc === (item.listTitle || "搜索") + " · " + (item.title || "");
      $("tvBrowseOverview").textContent = homeHeroPresentationOverview(item, detail) || (labelOnly || ui.view === "history" ? "" : desc);
      syncTvBrowseFilterOverview();
      const wall = tvWallpaperState();
      if (wall.active && wall.currentKey === key) tvWallpaperScheduleInfoShift(key, wall.moveToken);
      tvBrowseRenderLogo(item, detail);
      ui.presentedKey = key;
      return true;
    }

    function tvBrowseCancelPendingPreview() {
      const ui = tvBrowseState(), image = ui.pendingImage, pending = ui.pendingPreview;
      if (pending && pending.timeoutId) clearTimeout(pending.timeoutId);
      if (image) image.onload = image.onerror = null;
      if (pending && image) {
        const url = pending.sources[pending.sourceIndex] || pending.preferredUrl || "";
        let warm = pending.warmBackdrop;
        if (!warm && url) warm = { key: pending.key, url, image, state: "loading", pendingPreview: null, cancelled: false };
        if (warm) {
          warm.key = pending.key; warm.url = url || warm.url; warm.pendingPreview = null; warm.cancelled = false;
          if ((ui.warmBackdrops || []).indexOf(warm) < 0) ui.warmBackdrops.push(warm);
          tvBrowseStartWarmBackdrop(warm);
          tvBrowseTrimWarmBackdrops([warm.url]);
        }
      }
      ui.pendingImage = null; ui.pendingPreview = null;
    }

    function tvBrowseTrimWarmBackdrops(preferredUrls) {
      const ui = tvBrowseState(), warms = ui.warmBackdrops || [], preferred = new Set(preferredUrls || []);
      while (warms.length > 2) {
        let index = warms.findIndex((warm) => !preferred.has(warm.url) && (warm.state === "failed" || warm.state === "presented"));
        if (index < 0) index = warms.findIndex((warm) => !preferred.has(warm.url) && warm.state === "ready");
        if (index < 0) index = warms.findIndex((warm) => !preferred.has(warm.url) && !warm.pendingPreview);
        if (index < 0) break;
        const [warm] = warms.splice(index, 1);
        warm.cancelled = true; warm.pendingPreview = null;
        if (warm.image) warm.image.onload = warm.image.onerror = null;
      }
      ui.warmBackdrops = warms;
    }

    function tvBrowseCancelWarmBackdrop() {
      const ui = tvBrowseState(), warms = ui.warmBackdrops || [];
      ui.warmBackdrops = [];
      warms.forEach((warm) => {
        warm.cancelled = true;
        warm.pendingPreview = null;
        if (warm.image) { warm.image.onload = warm.image.onerror = null; warm.image.src = ""; }
      });
    }

    function tvBrowseClearDisplayedBackdrop() {
      const ui = tvBrowseState();
      [$("tvBrowseBackdrop"), $("tvBrowseBackdropNext")].forEach((layer) => {
        layer.style.backgroundImage = "";
        layer.classList.remove("visible");
        delete layer.dataset.tvBrowseBackdropUrl;
        delete layer.dataset.tvBrowseBackdropKey;
      });
      ui.backdropUrl = ""; ui.backdropMediaKey = "";
    }

    function tvBrowseSetDisplayedBackdrop(url, mediaKey) {
      const ui = tvBrowseState();
      if (!url) return false;
      if (url === ui.backdropUrl) {
        if (mediaKey) {
          ui.backdropMediaKey = mediaKey;
          const visible = ui.backdropSlot ? $("tvBrowseBackdrop") : $("tvBrowseBackdropNext");
          if (visible) visible.dataset.tvBrowseBackdropKey = mediaKey;
        }
        return false;
      }
      const next = ui.backdropSlot ? $("tvBrowseBackdrop") : $("tvBrowseBackdropNext");
      const previous = ui.backdropSlot ? $("tvBrowseBackdropNext") : $("tvBrowseBackdrop");
      const previousUrl = previous.dataset.tvBrowseBackdropUrl || "";
      const cleanupToken = Number(previous.__tvBrowseCleanupToken || 0) + 1;
      previous.__tvBrowseCleanupToken = cleanupToken;
      next.style.backgroundImage = "url(" + JSON.stringify(url) + ")";
      next.dataset.tvBrowseBackdropUrl = url;
      next.dataset.tvBrowseBackdropKey = mediaKey || "";
      next.classList.add("visible"); previous.classList.remove("visible");
      if (previousUrl) {
        const cleanup = (event) => {
          if (event && (event.target !== previous || event.propertyName !== "opacity")) return;
          previous.removeEventListener("transitionend", cleanup);
          if (previous.__tvBrowseCleanupToken !== cleanupToken || previous.classList.contains("visible")
            || previous.dataset.tvBrowseBackdropUrl !== previousUrl) return;
          previous.style.backgroundImage = "";
          delete previous.dataset.tvBrowseBackdropUrl;
          delete previous.dataset.tvBrowseBackdropKey;
        };
        previous.addEventListener("transitionend", cleanup);
        const transition = getComputedStyle(previous).transitionDuration.split(",").map((value) => parseFloat(value) || 0);
        if (!previous.classList.contains("visible") && !transition.some((value) => value > 0)) cleanup();
      }
      ui.backdropSlot = ui.backdropSlot ? 0 : 1; ui.backdropUrl = url; ui.backdropMediaKey = mediaKey || ui.backdropMediaKey;
      return true;
    }

    function tvBrowseCardPosterSource(item) {
      const key = mediaDomKey(item), card = Array.from($("tvBrowseRail").children)
        .find((candidate) => candidate.__mediaItem && mediaDomKey(candidate.__mediaItem) === key);
      const image = card && card.querySelector("img.poster");
      if (!image || image.dataset.tvBrowsePosterState === "failed") return "";
      if (image.complete && image.naturalWidth === 0 && !image.hasAttribute("data-src")) return "";
      return tvBrowsePosterSource(image);
    }

    function tvBrowseReadyCardPoster(item) {
      const key = mediaDomKey(item), card = Array.from($("tvBrowseRail").children)
        .find((candidate) => candidate.__mediaItem && mediaDomKey(candidate.__mediaItem) === key);
      const image = card && card.querySelector("img.poster");
      if (!image || !image.complete || !image.naturalWidth) return "";
      const url = image.currentSrc || image.src || "";
      return /^data:image\//i.test(url) ? "" : url;
    }

    function tvBrowseWarmBackdropTracked(warm) {
      const ui = tvBrowseState(), pending = warm && warm.pendingPreview;
      return !!warm && !warm.cancelled && ((ui.warmBackdrops || []).indexOf(warm) >= 0
        || !!(pending && ui.pendingPreview === pending && pending.warmBackdrop === warm));
    }

    function tvBrowseWarmBackdropSettled(warm, ready) {
      if (!tvBrowseWarmBackdropTracked(warm)) return false;
      const ui = tvBrowseState();
      warm.state = ready ? "ready" : "failed";
      if (warm.image) warm.image.onload = warm.image.onerror = null;
      const pending = warm.pendingPreview;
      if (pending && ui.pendingPreview === pending && pending.warmBackdrop === warm) {
        if (ready) tvBrowseFinishPreviewImage(pending, warm.url, pending.sourceToken);
        else tvBrowseAdvancePreviewSource(pending, warm.image, pending.sourceToken);
      }
      return true;
    }

    function tvBrowseStartWarmBackdrop(warm) {
      if (!warm || !warm.image) return false;
      if (warm.state === "ready" || warm.state === "decoding") return true;
      const image = warm.image;
      const loaded = () => {
        if (!tvBrowseWarmBackdropTracked(warm)) return;
        warm.state = "loaded";
        if (typeof image.decode !== "function") return tvBrowseWarmBackdropSettled(warm, true);
        let decoding;
        try { decoding = image.decode(); } catch (error) { return tvBrowseWarmBackdropSettled(warm, true); }
        if (!decoding || typeof decoding.then !== "function") return tvBrowseWarmBackdropSettled(warm, true);
        warm.state = "decoding";
        decoding.then(
          () => tvBrowseWarmBackdropSettled(warm, true),
          () => tvBrowseWarmBackdropSettled(warm, true)
        );
      };
      image.onload = loaded;
      image.onerror = () => tvBrowseWarmBackdropSettled(warm, false);
      const currentSource = String(image.currentSrc || image.src || "");
      if (image.complete && image.naturalWidth > 0) loaded();
      else if (image.complete && currentSource && image.naturalWidth === 0) tvBrowseWarmBackdropSettled(warm, false);
      else if (currentSource !== warm.url) image.src = warm.url;
      return true;
    }

    function tvBrowseTakeWarmBackdrop(url) {
      const ui = tvBrowseState(), warms = ui.warmBackdrops || [];
      const index = warms.findIndex((warm) => !warm.cancelled && warm.url === url);
      if (index < 0) return null;
      return warms.splice(index, 1)[0];
    }

    function tvBrowseFinishPreviewImage(pending, url, sourceToken) {
      const ui = tvBrowseState();
      if (ui.pendingPreview !== pending || pending.token !== ui.backdropToken || pending.key !== ui.previewKey
        || sourceToken !== pending.sourceToken) return false;
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      if (pending.image) pending.image.onload = pending.image.onerror = null;
      if (pending.warmBackdrop) {
        pending.warmBackdrop.pendingPreview = null;
        pending.warmBackdrop.state = "presented";
        pending.warmBackdrop = null;
      }
      ui.pendingImage = null; ui.pendingPreview = null;
      tvBrowseSetDisplayedBackdrop(url, pending.key);
      tvBrowseWarmNextBackground(pending.item, { direction: pending.direction, wrap: pending.wrap });
      return true;
    }

    function tvBrowseFailPreviewImage(pending) {
      const ui = tvBrowseState();
      if (ui.pendingPreview !== pending || pending.token !== ui.backdropToken || pending.key !== ui.previewKey) return false;
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      if (pending.image) pending.image.onload = pending.image.onerror = null;
      if (pending.warmBackdrop) {
        pending.warmBackdrop.pendingPreview = null;
        pending.warmBackdrop.cancelled = true;
        pending.warmBackdrop = null;
      }
      ui.pendingImage = null; ui.pendingPreview = null;
      // Text was committed at selection time. Reuse a same-resource poster if
      // available; otherwise keep a neutral base instead of the previous item.
      const poster = tvBrowseReadyCardPoster(pending.item) || tvBrowseCardPosterSource(pending.item);
      if (poster) tvBrowseSetDisplayedBackdrop(poster, pending.key);
      else tvBrowseClearDisplayedBackdrop();
      tvBrowseWarmNextBackground(pending.item, { direction: pending.direction, wrap: pending.wrap });
      return true;
    }

    function tvBrowseWaitForPreviewDecode(pending, image, url, sourceToken) {
      const isCurrent = () => {
        const ui = tvBrowseState();
        return ui.pendingPreview === pending && pending.token === ui.backdropToken
          && pending.key === ui.previewKey && pending.sourceToken === sourceToken;
      };
      const finish = () => { if (isCurrent()) tvBrowseFinishPreviewImage(pending, url, sourceToken); };
      if (typeof image.decode !== "function") return finish();
      let decoding;
      try { decoding = image.decode(); } catch (error) { return finish(); }
      if (!decoding || typeof decoding.then !== "function") return finish();
      decoding.then(finish, finish);
    }

    function tvBrowseAdvancePreviewSource(pending, image, sourceToken) {
      const ui = tvBrowseState();
      if (ui.pendingPreview !== pending || pending.token !== ui.backdropToken || pending.key !== ui.previewKey
        || pending.sourceToken !== sourceToken) return false;
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.timeoutId = null;
      if (image) image.onload = image.onerror = null;
      if (pending.warmBackdrop) {
        pending.warmBackdrop.pendingPreview = null;
        pending.warmBackdrop = null;
      }
      pending.sourceIndex += 1;
      if (!pending.sources[pending.sourceIndex]) return tvBrowseFailPreviewImage(pending);
      return tvBrowseLoadPreviewSource(pending, image);
    }

    function tvBrowseLoadPreviewSource(pending, image) {
      const ui = tvBrowseState(), url = pending.sources[pending.sourceIndex];
      if (!url) return tvBrowseFailPreviewImage(pending);
      const sourceToken = ++pending.sourceToken;
      const target = image || new Image();
      pending.image = target; ui.pendingImage = target;
      if (url === ui.backdropUrl) return tvBrowseFinishPreviewImage(pending, url, sourceToken);
      target.onload = () => tvBrowseWaitForPreviewDecode(pending, target, url, sourceToken);
      target.onerror = () => tvBrowseAdvancePreviewSource(pending, target, sourceToken);
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.timeoutId = setTimeout(() => tvBrowseAdvancePreviewSource(pending, target, sourceToken), TV_BROWSE_BACKDROP_TIMEOUT_MS);
      if (target.src !== url) target.src = url;
      return true;
    }

    function tvBrowseWarmNextBackground(item, options) {
      const ui = tvBrowseState();
      if (!tvBrowseActive() || !item || ui.view !== "home") { tvBrowseCancelWarmBackdrop(); return false; }
      const opts = options || {}, direction = Number(opts.direction) < 0 ? -1 : Number(opts.direction) > 0 ? 1 : (Number(ui.previewDirection) < 0 ? -1 : 1);
      const query = secondaryGetQuery(ui.column), items = tvWallpaperCurrentItems(query);
      const index = items.findIndex((candidate) => mediaDomKey(candidate) === mediaDomKey(item));
      if (index < 0 || !items.length) { tvBrowseCancelWarmBackdrop(); return false; }
      let nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= items.length) {
        if (!opts.wrap || query.hasMore || query.loading || items.length < 2) nextIndex = -1;
        else nextIndex = (nextIndex + items.length) % items.length;
      }
      const candidate = nextIndex >= 0 ? items[nextIndex] : null;
      const nextDetail = candidate && tvBrowsePreviewDetail(candidate);
      const nextUrl = candidate && tvBrowsePreviewBackgrounds(candidate, nextDetail).preferred;
      const currentPreviewUrl = ui.pendingPreview && ui.pendingPreview.sources[0] || "";
      const wanted = candidate && nextUrl && nextUrl !== ui.backdropUrl && nextUrl !== currentPreviewUrl
        ? { key: mediaDomKey(candidate), url: nextUrl } : null;
      const previous = ui.warmBackdrops || [], next = [];
      if (wanted) {
        const existing = previous.find((warm) => !warm.cancelled && warm.url === wanted.url);
        const warm = existing || { key: wanted.key, url: wanted.url, image: new Image(), state: "loading", pendingPreview: null, cancelled: false };
        warm.key = wanted.key; warm.cancelled = false;
        if (!warm.image.decoding) warm.image.decoding = "async";
        next.push(warm);
      }
      previous.forEach((warm) => {
        if (next.indexOf(warm) >= 0) return;
        warm.cancelled = true; warm.pendingPreview = null;
        // Retire callbacks without resetting an in-flight request just because
        // focus moved. The browser can finish it into its normal URL cache.
        if (warm.image) warm.image.onload = warm.image.onerror = null;
      });
      ui.warmBackdrops = next;
      next.forEach((warm) => { if (warm.state === "loading" && !warm.image.src) tvBrowseStartWarmBackdrop(warm); });
      return next.length > 0;
    }

    function tvBrowsePreview(item, options) {
      if (!item) return;
      const ui = tvBrowseState(), opts = options || {}, key = mediaDomKey(item);
      const direction = Number(opts.direction) < 0 ? -1 : Number(opts.direction) > 0 ? 1 : (Number(ui.previewDirection) < 0 ? -1 : 1);
      ui.previewDirection = direction;
      const detail = tvBrowsePreviewDetail(item), background = tvBrowsePreviewBackgrounds(item, detail);
      const url = background.preferred;
      if (ui.previewKey === key && ui.pendingPreview && ui.pendingPreview.sources[0] === url) {
        ui.pendingPreview.item = item; ui.pendingPreview.detail = detail;
        ui.pendingPreview.direction = direction; ui.pendingPreview.wrap = !!opts.wrap;
        tvBrowseCommitPreviewInfo(item, detail, key);
        tvBrowseWarmNextBackground(item, { direction, wrap: !!opts.wrap });
        return;
      }
      ui.previewKey = key;
      const token = ++ui.backdropToken;
      tvBrowseCancelPendingPreview();
      const type = String(item.mediaType || item.media_type || "").toLowerCase();
      const logoKey = (type === "movie" ? movieDetailCacheKey(item) : type === "tv" ? tvDetailCacheKey(item) : "") || String(key);
      if (ui.logoKey !== logoKey) { tvBrowseCancelLogo(); ui.logoKey = logoKey; }
      tvBrowseEnsurePreviewDetail(item, detail);
      tvBrowsePrepareAdjacentLogos(item);
      const wall = tvWallpaperState();
      if (wall.active && wall.currentKey === key) tvWallpaperScheduleInfoShift(key, wall.moveToken);
      tvBrowseCommitPreviewInfo(item, detail, key);
      if (!url) {
        tvBrowseCancelWarmBackdrop();
        if (ui.backdropMediaKey !== key) {
          tvBrowseClearDisplayedBackdrop();
          const poster = tvBrowseReadyCardPoster(item) || tvBrowseCardPosterSource(item);
          if (poster) tvBrowseSetDisplayedBackdrop(poster, key);
        }
        return;
      }
      if (url === ui.backdropUrl) {
        tvBrowseSetDisplayedBackdrop(url, key);
        tvBrowseWarmNextBackground(item, { direction, wrap: !!opts.wrap });
        return;
      }
      const warm = tvBrowseTakeWarmBackdrop(url);
      if (warm && warm.state === "ready") {
        const readyPending = { key, token, item, detail, preferredUrl: url, sources: background.urls, sourceIndex: 0, sourceToken: 1, image: warm.image, warmBackdrop: warm, direction, wrap: !!opts.wrap };
        ui.pendingPreview = readyPending; warm.pendingPreview = readyPending;
        tvBrowseFinishPreviewImage(readyPending, url, readyPending.sourceToken);
        return;
      }
      const poster = tvBrowseReadyCardPoster(item) || tvBrowseCardPosterSource(item);
      if (ui.backdropMediaKey !== key) {
        // An unprepared selection immediately drops the previous resource image.
        // Its own card poster is the first fallback; otherwise the base is neutral.
        tvBrowseClearDisplayedBackdrop();
        if (poster) tvBrowseSetDisplayedBackdrop(poster, key);
      }
      const pending = { key, token, item, detail, preferredUrl: url, sources: background.urls, sourceIndex: 0, sourceToken: 0, image: null, warmBackdrop: warm || null, direction, wrap: !!opts.wrap };
      ui.pendingPreview = pending;
      if (warm && warm.url === url) {
        pending.image = warm.image; pending.warmBackdrop = warm; pending.sourceToken = 1;
        ui.pendingImage = warm.image; warm.pendingPreview = pending;
        const sourceToken = pending.sourceToken;
        pending.timeoutId = setTimeout(() => tvBrowseAdvancePreviewSource(pending, warm.image, sourceToken), TV_BROWSE_BACKDROP_TIMEOUT_MS);
        if (warm.state === "failed") tvBrowseAdvancePreviewSource(pending, warm.image, pending.sourceToken);
      } else tvBrowseLoadPreviewSource(pending);
      tvBrowseWarmNextBackground(item, { direction, wrap: !!opts.wrap });
    }

    function tvBrowsePrepareAdjacentLogos(item) {
      const cards = Array.from($("tvBrowseRail").children), index = cards.findIndex((card) => mediaDomKey(card.__mediaItem) === mediaDomKey(item));
      // Two neighbours only; shared typed metadata and image promises.
      [index - 1, index + 1].forEach((at) => {
        const adjacent = cards[at] && cards[at].__mediaItem;
        if (adjacent) tvBrowsePrepareLogo(adjacent, false);
      });
    }

    function tvBrowseDirectionalTarget(key, active) {
      const ui = tvBrowseState();
      if (ui.view === "history") {
        const cards = Array.from($("tvBrowseRail").children).filter(isVisibleFocusable);
        if (active === $("tvHistoryContinue")) return key === "ArrowDown" ? tvBrowsePosterTarget() : key === "ArrowUp" ? tvBrowseHistoryToolsTarget() || active : active;
        if (active && active.closest("#tvBrowseRail")) {
          if (key === "ArrowUp") return !recentManageRuntime().active && isVisibleFocusable($("tvHistoryContinue")) ? $("tvHistoryContinue") : tvBrowseHistoryToolsTarget() || active;
          if (key === "ArrowDown") return active;
          return cards[Math.max(0, Math.min(cards.length - 1, cards.indexOf(active) + (key === "ArrowRight" ? 1 : -1)))] || active;
        }
      }
      if (ui.filterOpen && !(active && active.closest("#tvBrowseRail"))) {
        const rows = Array.from($("tvBrowseFilters").querySelectorAll(".secondary-filter-row"));
        const row = active && active.closest(".secondary-filter-row");
        if (!row) return tvBrowseFilterTarget();
        const buttons = Array.from(row.querySelectorAll("button")), index = buttons.indexOf(active);
        if (key === "ArrowLeft" || key === "ArrowRight") return buttons[Math.max(0, Math.min(buttons.length - 1, index + (key === "ArrowRight" ? 1 : -1)))];
        const rowIndex = rows.indexOf(row);
        if (key === "ArrowUp" && rowIndex === 0) return active;
        if (key === "ArrowDown" && rowIndex === rows.length - 1) {
          const poster = tvBrowsePosterTarget();
          return poster && poster.closest("#tvBrowseRail") && isVisibleFocusable(poster) ? poster : active;
        }
        const next = rows[rowIndex + (key === "ArrowDown" ? 1 : -1)];
        return next.querySelector(".selected") || next.querySelector("button");
      }
      const rail = $("tvBrowseRail"), columns = $("tvBrowseColumns"), functions = $("tvBrowseFunctions");
      if (active === $("tvBrowseRetry")) return key === "ArrowUp"
        ? tvBrowsePosterTarget()
        : key === "ArrowDown" && ui.view === "history" ? tvBrowseHistoryToolsTarget() || active : active;
      let host = active && active.closest("#tvBrowseRail,#tvBrowseColumns,#tvBrowseFunctions,#tvBrowseRecentTools");
      if (!host) return tvBrowsePosterTarget();
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const buttons = Array.from(host.querySelectorAll("button")).filter(isVisibleFocusable), index = buttons.indexOf(active);
        if (host === rail) tvBrowseMaybeLoadMore(index);
        return buttons[Math.max(0, Math.min(buttons.length - 1, index + (key === "ArrowRight" ? 1 : -1)))];
      }
      if (host === rail && ui.filterOpen) return key === "ArrowUp" ? tvBrowseFilterTarget() : active;
      if (host === rail) return key === "ArrowDown" && !$("tvBrowseRetry").hidden ? $("tvBrowseRetry") : tvBrowseColumnButton(ui.column);
      if (host === columns) return key === "ArrowDown" ? tvBrowsePosterTarget() : $("tvFunction-search");
      if (ui.view === "history") {
        if (host === $("tvBrowseRecentTools") && key === "ArrowDown") {
          const manageActive = recentManageRuntime().active;
          const poster = tvBrowsePosterTarget();
          if (manageActive && poster && poster.closest("#tvBrowseRail") && isVisibleFocusable(poster)) return poster;
          if ((!poster || !poster.closest("#tvBrowseRail")) && !$("tvBrowseRetry").hidden && isVisibleFocusable($("tvBrowseRetry"))) return $("tvBrowseRetry");
          if (!manageActive && isVisibleFocusable($("tvHistoryContinue"))) return $("tvHistoryContinue");
          return poster && isVisibleFocusable(poster) ? poster : active;
        }
        if (host === functions && key === "ArrowDown" && isVisibleFocusable($("recentManageBtn"))) return $("recentManageBtn");
        if (host === $("tvBrowseRecentTools") && key === "ArrowUp") return active;
        return isVisibleFocusable($("tvHistoryContinue")) ? $("tvHistoryContinue") : tvBrowsePosterTarget();
      }
      return ui.view === "history" ? tvBrowsePosterTarget() : tvBrowseColumnButton(ui.column);
    }

    function handleTvBrowseKey(event, key, active) {
      const scope = focusScopeRoot();
      if (!tvBrowseActive() || isSidebarOpen() || scope !== document || isConnectionPanelOpen()) return false;
      const column = active && active.closest("#tvBrowseColumns button");
      const ui = tvBrowseState();
      if (key === "Enter" && ui.view === "history" && active === $("tvHistoryContinue")) {
        event.preventDefault(); event.stopPropagation();
        if (!event.repeat && !ui.enterHeld) {
          ui.enterHeld = true; ui.suppressClickUntil = Date.now() + 200;
          cancelRecentDeleteArm(); tvBrowseContinueHistory(null, active);
        }
        return true;
      }
      if (key === "Enter" && !event.repeat) {
        markHomeUserNavigation();
        if (!column) tvBrowseState().suppressClickUntil = 0;
      }
      if (key === "Enter" && column) {
        event.preventDefault(); event.stopPropagation();
        const ui = tvBrowseState();
        if (event.repeat || ui.enterHeld) return true;
        ui.enterHeld = true; ui.suppressClickUntil = Date.now() + 200;
        tvBrowseActivateColumn(column.dataset.column);
        return true;
      }
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) return false;
      event.preventDefault(); event.stopPropagation();
      const target = tvBrowseDirectionalTarget(key, active);
      if (active && active.closest("#tvBrowseRail .card") && target && target !== active && target.closest("#tvBrowseRail .card")) {
        ui.navigationDirection = key === "ArrowLeft" ? -1 : 1;
      }
      focusRemoteTarget(target);
      return true;
    }

    function tvBrowseSnapshot() {
      tvBrowseSavePosition();
      const ui = tvBrowseState();
      return { view: ui.view, historyReturnFocus: ui.historyReturnFocus, column: ui.column, positions: JSON.parse(JSON.stringify(ui.positions)), filterOpen: ui.filterOpen, filterFocusGroup: ui.filterFocusGroup || "", filters: JSON.parse(JSON.stringify(state.homeV14.secondaryFilters || {})) };
    }

    function restoreTvBrowseSnapshot(saved, legacyColumn) {
      const ui = tvBrowseState(), value = saved || {};
      const id = value.column || legacyColumn || "recommendation";
      ui.view = value.view === "history" ? "history" : "home";
      ui.historyReturnFocus = value.historyReturnFocus || null;
      ui.column = tvBrowseColumns().some((entry) => entry.listId === id) ? id : "recommendation";
      ui.positions = value.positions && typeof value.positions === "object" ? value.positions : {};
      if (value.filters && typeof value.filters === "object") state.homeV14.secondaryFilters = value.filters;
      ui.filterOpen = ui.view !== "history" && !!value.filterOpen && secondaryFilterGroups(ui.column, secondaryCatalogBaseItems(ui.column)).length > 0; ui.filterFocusGroup = value.filterFocusGroup || ""; ui.confirm = null; ui.previewKey = "";
    }

    function renderCatalogQuery(id) {
      if (tvBrowseActive()) {
        const ui = tvBrowseState();
        if (ui.view === "home" && ui.column === id || id === "recent" && ui.view === "history") renderTvBrowse();
      } else if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
    }
