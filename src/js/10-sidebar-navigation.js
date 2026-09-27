    function isHomeRouteActive() {
      return state.activeList === "all" && homeUiRoute() === "home";
    }

    function isSidebarRouteActive() {
      return state.activeList === "all" && (homeUiRoute() === "home" || homeUiRoute() === "secondary");
    }

    function isSidebarOpen() {
      const sidebar = $("homeSidebar");
      return !!(sidebar && state.homeV14 && state.homeV14.sidebarOpen && !sidebar.hidden && isSidebarRouteActive());
    }

    function isMobileSidebarDevice() {
      if (isTvLikeDevice()) return false;
      const coarse = window.matchMedia ? window.matchMedia("(pointer: coarse)").matches : false;
      return isNativeMobileClient() || coarse || isBrowserPhoneClient();
    }

    function syncSidebarMobilePresentation() {
      const home = $("home");
      const sidebar = $("homeSidebar");
      const backdrop = $("homeSidebarBackdrop");
      const menu = $("homeMenuLauncher");
      const secondaryMenu = $("secondaryMenuLauncher");
      const open = !!(sidebar && state.homeV14 && state.homeV14.sidebarOpen && !sidebar.hidden && isSidebarRouteActive());
      const mobileOpen = open && isMobileSidebarDevice();
      const mobileConnectionOpen = mobileOpen && isConnectionPanelOpen();
      if (home) home.classList.toggle("mobile-sidebar-open", mobileOpen);
      if (home) home.classList.toggle("mobile-connection-open", mobileConnectionOpen);
      if (sidebar) sidebar.classList.toggle("mobile-connection-open", mobileConnectionOpen);
      if (backdrop) {
        if (mobileOpen) {
          clearTimeout(backdrop.__closeTimer || 0);
          backdrop.__closeTimer = 0;
          backdrop.hidden = false;
          backdrop.setAttribute("aria-hidden", "false");
          backdrop.classList.remove("is-closing");
          if (!backdrop.classList.contains("is-open")) {
            requestAnimationFrame(() => {
              if (state.homeV14 && state.homeV14.sidebarOpen && isSidebarRouteActive()) backdrop.classList.add("is-open");
            });
          }
        } else if (!backdrop.hidden) {
          backdrop.classList.remove("is-open");
          backdrop.classList.add("is-closing");
          backdrop.setAttribute("aria-hidden", "true");
          clearTimeout(backdrop.__closeTimer || 0);
          backdrop.__closeTimer = setTimeout(() => {
            if (state.homeV14 && state.homeV14.sidebarOpen && isSidebarRouteActive()) return;
            backdrop.hidden = true;
            backdrop.classList.remove("is-closing");
          }, 190);
        }
      }
      if (menu) menu.setAttribute("aria-expanded", open ? "true" : "false");
      if (secondaryMenu) secondaryMenu.setAttribute("aria-expanded", open ? "true" : "false");
    }

    function beginMobileSidebarHistoryEntry() {
      const home = state.homeV14;
      if (!home || !isMobileSidebarDevice() || home.sidebarHistoryEntry || home.sidebarHistoryBackPending) return false;
      try {
        history.pushState(Object.assign({}, history.state || {}, { homeSidebar: true }), "", location.href);
        home.sidebarHistoryEntry = true;
        home.sidebarHistoryBackPending = false;
        return true;
      } catch (e) {
        home.sidebarHistoryEntry = false;
        return false;
      }
    }

    function clearMobileSidebarHistoryEntry() {
      const home = state.homeV14;
      if (!home) return false;
      const hadEntry = !!home.sidebarHistoryEntry;
      home.sidebarHistoryEntry = false;
      home.sidebarHistoryBackPending = false;
      if (hadEntry && history.state && history.state.homeSidebar) {
        try { history.replaceState(Object.assign({}, history.state, { homeSidebar: false }), "", location.href); } catch (e) {}
      }
      return hadEntry;
    }

    function settleMobileSidebarHistory(options) {
      const home = state.homeV14;
      if (!home || !home.sidebarHistoryEntry || home.sidebarHistoryBackPending) return false;
      const opts = options || {};
      home.sidebarHistoryEntry = false;
      if (opts.fromPopState) {
        home.sidebarHistoryBackPending = false;
        if (history.state && history.state.homeSidebar) {
          try { history.replaceState(Object.assign({}, history.state, { homeSidebar: false }), "", location.href); } catch (e) {}
        }
        return true;
      }
      home.sidebarHistoryBackPending = true;
      try {
        history.back();
      } catch (e) {
        home.sidebarHistoryBackPending = false;
        if (history.state && history.state.homeSidebar) {
          try { history.replaceState(Object.assign({}, history.state, { homeSidebar: false }), "", location.href); } catch (ignore) {}
        }
      }
      return true;
    }

    function performSidebarNavigation(action) {
      if (!action || !action.type) return false;
      if (action.type === "live") return !!openLiveHome();
      if (action.type === "keep") return !!openKeepHome();
      if (action.type === "settings") return !!openSettingHome();
      if (action.type === "secondary") {
        const currentListId = normalizeLegacyCategoryId(state.homeV14 && state.homeV14.secondaryListId || "");
        const targetListId = normalizeLegacyCategoryId(action.listId || "");
        if (homeUiRoute() === "secondary" && currentListId === targetListId) return true;
        const context = action.context || {};
        return openSecondaryCatalog(targetListId, {
          originSection: targetListId,
          originTarget: context.target || null,
          returnTarget: context.target || null,
          returnFocus: context.focus || null,
          returnScrollY: context.scrollY || 0,
          fromSidebar: true
        });
      }
      return false;
    }

    function requestSidebarNavigation(action) {
      const home = state.homeV14;
      if (!action || !home) return false;
      if (!isMobileSidebarDevice()) {
        const currentListId = normalizeLegacyCategoryId(home.secondaryListId || "");
        const targetListId = normalizeLegacyCategoryId(action.listId || "");
        const sameSecondary = action.type === "secondary"
          && homeUiRoute() === "secondary"
          && currentListId === targetListId;
        if (!sameSecondary && home.sidebarOpen && isSidebarRouteActive()) {
          home.sidebarReturnInvalidated = true;
          home.sidebarReturnTarget = null;
          home.sidebarReturnFocus = null;
        }
        return performSidebarNavigation(action);
      }
      if (home.sidebarHistoryBackPending) return true;
      if (!home.sidebarOpen) return false;
      if (!home.sidebarHistoryEntry) {
        closeSidebar({ restore: false });
        return performSidebarNavigation(action);
      }
      home.sidebarDeferredAction = action;
      const closed = closeSidebar({ restore: false });
      if (!closed || !home.sidebarHistoryBackPending) {
        if (home.sidebarDeferredAction === action) home.sidebarDeferredAction = null;
        return false;
      }
      return true;
    }

    function sidebarConfiguredList(preferredId) {
      const wanted = normalizeLegacyCategoryId(preferredId);
      return visibleTmdbLists().find((list) => normalizeLegacyCategoryId(list && list.id) === wanted) || null;
    }

    function sidebarIconMarkup(key) {
      const shapes = {
        live: '<circle cx="12" cy="12" r="2"/><path d="M7.8 7.8a6 6 0 0 0 0 8.4"/><path d="M16.2 7.8a6 6 0 0 1 0 8.4"/><path d="M5.6 5.6a9 9 0 0 0 0 12.8"/><path d="M18.4 5.6a9 9 0 0 1 0 12.8"/>',
        recent: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 7v5l3 2"/>',
        recommendation: '<path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 18l-1.8-5.2L5 10l5.2-1.8L12 3Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
        latest: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3 10h18"/><path d="M8 14h3"/><path d="M14 14h2"/><path d="M8 18h2"/>',
        movie: '<path d="M4 5h16v14H4z"/><path d="m4 9 16 0"/><path d="m8 5 3 4"/><path d="m14 5 3 4"/><path d="M10 13.5 15 16l-5 2.5v-5Z"/>',
        tv: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m8 3 4 2 4-2"/><path d="M8 19v2h8v-2"/>',
        anime: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4V8Z"/><path d="M5 5 3 3"/><path d="m19 5 2-2"/>',
        documentary: '<path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 0-4 0V4Z"/><path d="M5 4v16"/><path d="M9 8h6"/><path d="M9 12h6"/>',
        variety: '<path d="M4 7h16v10H4z"/><path d="m8 7 1.5-3h5L16 7"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/>',
        keep: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
        settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
        generic: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>'
      };
      return '<svg class="icon home-sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">' + (shapes[key] || shapes.generic) + "</svg>";
    }

    function sidebarNavigationItems() {
      const items = [
        { key: "live", label: "直播", action: "live" },
        { key: "recent", label: "最近观看", action: "secondary", listId: "recent" },
        { key: "recommendation", label: "推荐", action: "secondary", listId: "recommendation" },
        { key: "latest", label: "本周更新", action: "secondary", listId: "now-playing" },
        { key: "movie", label: "电影", action: "secondary", listId: "movie" },
        { key: "tv", label: "电视剧", action: "secondary", listId: "tv" },
        { key: "anime", label: "动画", action: "secondary", listId: "anime" },
        { key: "documentary", label: "纪录片", action: "secondary", listId: "documentary" },
        { key: "variety", label: "综艺", action: "secondary", listId: "variety" },
        { key: "keep", label: "收藏", action: "keep" }
      ];
      return items.map((item) => {
        if (item.action !== "secondary" || item.listId === "recent" || item.listId === "recommendation") return item;
        const configured = sidebarConfiguredList(item.listId);
        return configured ? Object.assign({}, item, { listId: configured.id }) : null;
      }).filter(Boolean);
    }

    function sidebarFocusableItems() {
      const sidebar = $("homeSidebar");
      return sidebar ? Array.from(sidebar.querySelectorAll(".home-sidebar-item")).filter(isVisibleFocusable) : [];
    }

    function renderSidebar() {
      const nav = $("homeSidebarNav");
      const tools = $("homeSidebarTools");
      if (!nav || !tools) return false;
      // Do not replace a live Sidebar while its button owns DOM focus.  Home
      // data renders can happen while a native action is in flight; replacing
      // the focused node would create a focus island and lose the session.
      if (isSidebarOpen() && nav.children.length) return true;
      const makeItem = (item) => {
        const button = document.createElement("button");
        button.className = "home-sidebar-item focusable";
        button.type = "button";
        if (item.action === "settings") button.id = "sidebarSettings";
        button.dataset.sidebarKey = item.key;
        button.dataset.sidebarAction = item.action;
        if (item.listId) button.dataset.sidebarListId = item.listId;
        const icon = sidebarIconMarkup(item.key);
        if (item.action === "settings") {
          button.setAttribute("aria-label", item.label);
          button.title = item.label;
          button.innerHTML = icon + '<span class="home-sidebar-label">' + escapeHtml(item.label) + '</span>';
        } else {
          button.innerHTML = icon + '<span class="home-sidebar-label">' + escapeHtml(item.label) + '</span>';
        }
        button.addEventListener("focus", () => {
          if (state.homeV14) state.homeV14.sidebarFocusId = item.key;
        });
        if (item.action === "live") button.addEventListener("click", () => requestSidebarNavigation({ type: "live" }));
        else if (item.action === "settings") button.addEventListener("click", () => requestSidebarNavigation({ type: "settings" }));
        else button.addEventListener("click", () => activateSidebarItem(button));
        return button;
      };
      nav.replaceChildren(...sidebarNavigationItems().map(makeItem));
      const connectionDock = $("connectionDock");
      const connectionToggle = $("connectionToggle");
      tools.replaceChildren();
      if (connectionDock && connectionToggle) {
        const title = connectionDock.querySelector(".connection-title");
        if (title) title.textContent = "基础设置";
        connectionToggle.classList.add("home-sidebar-item");
        connectionToggle.setAttribute("aria-label", "基础设置");
        connectionToggle.dataset.sidebarKey = "grid";
        connectionToggle.dataset.sidebarAction = "grid";
      }
      tools.appendChild(makeItem({ key: "settings", label: "设置", action: "settings" }));
      if (connectionDock && connectionToggle) tools.appendChild(connectionDock);
      return true;
    }

    function sidebarReturnContext() {
      const home = state.homeV14 || {};
      return {
        target: home.sidebarReturnTarget && home.sidebarReturnTarget.isConnected ? home.sidebarReturnTarget : null,
        focus: home.sidebarReturnFocus || null,
        scrollY: Math.max(0, Number(home.sidebarReturnScrollY || 0)),
        gridScrollTop: Math.max(0, Number(home.sidebarReturnGridScrollTop || 0)),
        gridScrollLeft: Math.max(0, Number(home.sidebarReturnGridScrollLeft || 0)),
        route: home.sidebarReturnRoute || homeUiRoute(),
        invalidated: !!home.sidebarReturnInvalidated
      };
    }

    function focusSidebarCurrentPageDefault() {
      if (!isSidebarRouteActive()) return false;
      if (homeUiRoute() === "secondary") {
        if (typeof focusWeeklySecondaryInitial === "function" && focusWeeklySecondaryInitial()) return true;
        const back = $("secondaryCatalogBack");
        const filters = $("secondaryCatalogFilters");
        const row = filters && filters.querySelector(".secondary-filter-row");
        const firstFilter = row && Array.from(row.querySelectorAll(".secondary-filter-option")).find(isVisibleFocusable);
        const grid = $("secondaryCatalogGrid");
        const firstCard = grid && Array.from(grid.querySelectorAll(".card,.weekly-card")).find(isVisibleFocusable);
        const target = firstFilter || firstCard || back;
        if (target) {
          focusRemoteTarget(target);
          return true;
        }
        return false;
      }
      const target = initialHomeFocus();
      if (target) {
        focusRemoteTarget(target);
        return true;
      }
      return false;
    }

    function restoreSidebarFocus(context) {
      const saved = context || {};
      const focusEpoch = homeFocusUserEpoch();
      const restore = () => {
        if (homeFocusUserEpoch() !== focusEpoch) return;
        if (!isSidebarRouteActive() || saved.route !== homeUiRoute()) return;
        applyHomeScrollTop(Math.max(0, Number(saved.scrollY || 0)));
        if (saved.route === "secondary") {
          const grid = $("secondaryCatalogGrid");
          if (grid) {
            grid.scrollTop = Math.max(0, Number(saved.gridScrollTop || 0));
            grid.scrollLeft = Math.max(0, Number(saved.gridScrollLeft || 0));
          }
        }
        let target = isVisibleFocusable(saved.target) ? saved.target : null;
        if (!target && saved.focus) target = findHomeReturnTarget({ focus: saved.focus });
        if (target) focusHomeReturnTarget(target);
        else focusSidebarCurrentPageDefault();
      };
      requestAnimationFrame(restore);
    }

    function finishSidebarClose(sidebar) {
      if (!sidebar || state.homeV14 && state.homeV14.sidebarOpen) return;
      clearTimeout(sidebar.__closeTimer || 0);
      sidebar.__closeTimer = 0;
      if (sidebar.__closeHandler) {
        sidebar.removeEventListener("transitionend", sidebar.__closeHandler);
        sidebar.__closeHandler = null;
      }
      sidebar.hidden = true;
      sidebar.setAttribute("aria-hidden", "true");
      sidebar.classList.remove("is-open", "is-closing");
    }

    function scheduleSidebarClose(sidebar) {
      if (!sidebar) return;
      clearTimeout(sidebar.__closeTimer || 0);
      if (sidebar.__closeHandler) sidebar.removeEventListener("transitionend", sidebar.__closeHandler);
      const finish = (event) => {
        if (event && event.target !== sidebar) return;
        if (event && event.propertyName !== "opacity" && event.propertyName !== "transform") return;
        finishSidebarClose(sidebar);
      };
      sidebar.__closeHandler = finish;
      sidebar.addEventListener("transitionend", finish);
      sidebar.__closeTimer = setTimeout(() => finishSidebarClose(sidebar), 210);
    }

    function openSidebar() {
      if (state.homeV14 && state.homeV14.sidebarHistoryBackPending) return false;
      if (!isSidebarRouteActive() || isConnectionPanelOpen() || isSearchSuggestOpen()) return false;
      const sidebar = $("homeSidebar");
      if (!sidebar) return false;
      renderSidebar();
      if (!state.homeV14.sidebarOpen) {
        const active = document.activeElement;
        const current = homeUiRoute() === "secondary"
          ? active && isVisibleFocusable(active) && !sidebar.contains(active) ? active : $("secondaryCatalogBack")
          : currentHomeFocus() || initialHomeFocus();
        const target = isVisibleFocusable(active) && !sidebar.contains(active) ? active : current;
        state.homeV14.sidebarReturnTarget = target && target.isConnected ? target : null;
        state.homeV14.sidebarReturnFocus = target ? homeFocusSnapshot(target, target.__mediaItem || null) : null;
        state.homeV14.sidebarReturnScrollY = homeScrollTop();
        const grid = homeUiRoute() === "secondary" ? $("secondaryCatalogGrid") : null;
        state.homeV14.sidebarReturnGridScrollTop = grid ? Math.max(0, Number(grid.scrollTop || 0)) : 0;
        state.homeV14.sidebarReturnGridScrollLeft = grid ? Math.max(0, Number(grid.scrollLeft || 0)) : 0;
        state.homeV14.sidebarReturnRoute = homeUiRoute();
        state.homeV14.sidebarReturnInvalidated = false;
      }
      state.homeV14.sidebarOpen = true;
      sidebar.hidden = false;
      sidebar.setAttribute("aria-hidden", "false");
      clearTimeout(sidebar.__closeTimer || 0);
      sidebar.__closeTimer = 0;
      if (sidebar.__closeHandler) {
        sidebar.removeEventListener("transitionend", sidebar.__closeHandler);
        sidebar.__closeHandler = null;
      }
      sidebar.classList.remove("is-closing");
      if (!sidebar.classList.contains("is-open")) {
        sidebar.offsetWidth;
        requestAnimationFrame(() => {
          if (state.homeV14 && state.homeV14.sidebarOpen && isSidebarRouteActive()) sidebar.classList.add("is-open");
        });
      }
      const mobile = isMobileSidebarDevice();
      if (mobile) beginMobileSidebarHistoryEntry();
      syncSidebarMobilePresentation();
      const remembered = state.homeV14.sidebarFocusId;
      const target = sidebarFocusableItems().find((item) => item.dataset.sidebarKey === remembered) || sidebarFocusableItems()[0];
      if (!mobile && target) requestAnimationFrame(() => focusRemoteTarget(target));
      return true;
    }

    function closeSidebar(options) {
      const opts = options || {};
      if (state.homeV14 && state.homeV14.sidebarHistoryBackPending) return false;
      const sidebar = $("homeSidebar");
      if (!sidebar || !state.homeV14 || !state.homeV14.sidebarOpen) return false;
      if (isConnectionPanelOpen()) closeConnectionPanel();
      const context = sidebarReturnContext();
      const mobile = isMobileSidebarDevice();
      const restore = opts.restore !== false && !context.invalidated && isSidebarRouteActive() && !mobile;
      state.homeV14.sidebarOpen = false;
      sidebar.setAttribute("aria-hidden", "true");
      sidebar.classList.remove("is-open");
      sidebar.classList.add("is-closing");
      scheduleSidebarClose(sidebar);
      state.homeV14.sidebarReturnTarget = null;
      state.homeV14.sidebarReturnFocus = null;
      state.homeV14.sidebarReturnScrollY = 0;
      state.homeV14.sidebarReturnGridScrollTop = 0;
      state.homeV14.sidebarReturnGridScrollLeft = 0;
      state.homeV14.sidebarReturnRoute = "";
      state.homeV14.sidebarReturnInvalidated = false;
      syncSidebarMobilePresentation();
      if (restore) restoreSidebarFocus(context);
      else if (opts.restore !== false && !mobile && isSidebarRouteActive()) requestAnimationFrame(focusSidebarCurrentPageDefault);
      settleMobileSidebarHistory({
        fromPopState: opts.fromPopState === true
      });
      return context;
    }

    function activateSidebarItem(button) {
      if (!button || !button.dataset) return false;
      const action = button.dataset.sidebarAction || "";
      if (action === "live") {
        rememberFocusReturn();
        return requestSidebarNavigation({ type: "live" });
      }
      if (action === "settings") {
        return requestSidebarNavigation({ type: "settings" });
      }
      if (action === "keep") {
        return requestSidebarNavigation({ type: "keep" });
      }
      if (action === "secondary") {
        const listId = normalizeLegacyCategoryId(button.dataset.sidebarListId || "");
        if (!listId) return false;
        const context = sidebarReturnContext();
        return requestSidebarNavigation({ type: "secondary", listId, context });
      }
      return false;
    }

    function handleSidebarDirectionalKey(key, event) {
      if (!isSidebarOpen()) return false;
      const sidebar = $("homeSidebar");
      const active = document.activeElement;
      if (!sidebar || !active || !sidebar.contains(active)) return false;
      if (isConnectionPanelOpen()) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      const items = sidebarFocusableItems();
      const index = items.indexOf(active);
      if (key === "ArrowRight") {
        closeSidebar();
        return true;
      }
      if (key === "ArrowLeft") return true;
      if (key !== "ArrowUp" && key !== "ArrowDown") return true;
      const delta = key === "ArrowDown" ? 1 : -1;
      const target = items[Math.max(0, Math.min(items.length - 1, index + delta))];
      if (target && target !== active) focusRemoteTarget(target);
      return true;
    }

    function handleSidebarBackKey(event) {
      if (state.homeV14 && state.homeV14.sidebarHistoryBackPending) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        return true;
      }
      if (!isSidebarOpen()) return false;
      if (isConnectionPanelOpen()) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      closeSidebar();
      return true;
    }

    function handleSidebarMenuKey(event) {
      if (normalizeRemoteKey(event) !== "Menu") return false;
      if (isSidebarOpen()) {
        if (isConnectionPanelOpen()) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          closeConnectionPanel();
          return true;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        closeSidebar();
        return true;
      }
      if (!isHomeRouteActive() || focusScopeRoot() !== document || isConnectionPanelOpen() || isSearchSuggestOpen() || isTextEditingElement(document.activeElement)) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      return openSidebar();
    }

    function isHomeLeftBoundary(active) {
      if (!active || !isHomeRouteActive() || focusScopeRoot() !== document) return false;
      if (active.closest && active.closest("#homeSidebar")) return false;
      const rail = active.closest && active.closest(".home-rail");
      if (rail && active.classList && active.classList.contains("card")) {
        const cards = Array.from(rail.children || []).filter((item) => item.classList && item.classList.contains("card") && canFastHomeFocus(item));
        return cards[0] === active;
      }
      if (active === $("homeHero") || active === $("homeSearchLauncher")) return true;
      return !nearestFocusable("ArrowLeft", active);
    }

    function syncSidebarVisibility() {
      const sidebar = $("homeSidebar");
      if (!sidebar || !state.homeV14) return;
      const routeActive = isSidebarRouteActive();
      const visible = routeActive && !!state.homeV14.sidebarOpen;
      if (!routeActive && state.homeV14.sidebarOpen) {
        closeSidebar({ restore: false });
        return;
      }
      if (!visible && isConnectionPanelOpen()) closeConnectionPanel();
      if (visible) {
        sidebar.hidden = false;
        sidebar.setAttribute("aria-hidden", "false");
      } else if (!sidebar.classList.contains("is-closing")) {
        sidebar.hidden = true;
        sidebar.setAttribute("aria-hidden", "true");
      }
      if (!visible && !routeActive) {
        state.homeV14.sidebarOpen = false;
        if (!state.homeV14.sidebarHistoryBackPending) clearMobileSidebarHistoryEntry();
      }
      syncSidebarMobilePresentation();
    }

    function syncHomeRoutePresentation() {
      const isHome = isHomeRouteActive();
      const route = homeUiRoute();
      const root = $("home");
      const searchPage = $("searchPage");
      const secondary = $("secondaryCatalog");
      if (root) {
        root.classList.toggle("home-route-active", isHome);
        root.classList.toggle("home-secondary-active", route === "secondary");
        root.classList.toggle("search-route-active", route === "search");
      }
      if (searchPage) searchPage.hidden = route !== "search";
      if (secondary) secondary.hidden = route !== "secondary";
      const form = $("searchForm");
      if (form && route !== "search") form.hidden = true;
      const launcher = $("homeSearchLauncherWrap");
      if (launcher) launcher.hidden = !isHome;
      if (!isHome) stopHomeHeroAutoplay();
      syncSidebarVisibility();
      return isHome;
    }

    function homeOnlyPresentationNodes() {
      const nodes = [$("homeHero"), $("homeRecentSection"), $("homeRecommendationSection"), $("homeWeeklySection")];
      const stack = $("listStack");
      if (stack) Array.from(stack.children || []).forEach((node) => {
        if (node.classList && node.classList.contains("home-dynamic-section")) nodes.push(node);
      });
      return nodes.filter(Boolean);
    }

    function setHomeOnlyPresentationVisible(isHome) {
      const visible = !!isHome;
      if (!visible) stopHomeHeroAutoplay();
      const hero = $("homeHero");
      const recent = $("homeRecentSection");
      const recommendation = $("homeRecommendationSection");
      const weekly = $("homeWeeklySection");
      if (hero) hero.hidden = !visible;
      if (recommendation) recommendation.hidden = !visible;
      if (weekly) weekly.hidden = !visible;
      // Recent visibility still depends on the loaded history list.  The
      // Home renderer decides that part; this gate only closes it off-page.
      if (recent && !visible) recent.hidden = true;
      homeOnlyPresentationNodes().forEach((node) => {
        if (node.classList && node.classList.contains("home-dynamic-section")) node.hidden = !visible;
      });
      return visible;
    }
