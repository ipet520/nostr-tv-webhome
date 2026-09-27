    function scheduleHomeContentRender(options) {
      const opts = options || {};
      const seq = ++state.homeContentSeq;
      if (state.homeContentTimer) {
        cancelAnimationFrame(state.homeContentTimer);
        state.homeContentTimer = 0;
      }
      const run = () => {
        if (seq !== state.homeContentSeq) return;
        state.homeContentTimer = 0;
        renderHomeContent();
        if (typeof opts.after === "function") opts.after();
      };
      if (!opts.afterPaint) {
        run();
        return;
      }
      state.homeContentTimer = requestAnimationFrame(() => {
        if (seq !== state.homeContentSeq) return;
        state.homeContentTimer = requestAnimationFrame(run);
      });
    }

    function scheduleRender() {
      clearTimeout(state.renderTimer);
      const delay = Date.now() < state.scrollingUntil ? 700 : 160;
      state.renderTimer = setTimeout(() => {
        if (Date.now() < state.scrollingUntil) {
          scheduleRender();
          return;
        }
        renderAll({ deferContent: uiSnapshotRoute() === "home" });
      }, delay);
    }

    function homeSectionDomId(listId) {
      return `homeSection-${String(listId || "section").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    }

    function isSearchHistoryEntry() {
      const current = window.history && window.history.state;
      return location.hash === "#search" && !!(current && current.sheet === "search");
    }

    function openSearchPage() {
      const form = $("searchForm");
      const host = $("searchPageFormHost");
      if (!form || !host) return false;
      if (isRecentManagePage() && recentManageRuntime().deleting) {
        toast("正在删除，请稍候");
        return true;
      }
      if (isRecentManagePage()) resetRecentManageState();
      if (homeUiRoute() === "search" && isSearchHistoryEntry()) return true;
      if (!isSearchHistoryEntry()) {
        if (location.hash === "#search" || history.state && history.state.sheet === "search") {
          history.replaceState({ sheet: "search" }, "", "#search");
        } else {
          history.pushState({ sheet: "search" }, "", "#search");
        }
      }
      state.homeV14.searchReturn = {
        scrollY: homeScrollTop(),
        focusId: "searchSubmitBtn",
        route: homeUiRoute(),
        activeList: state.activeList,
        searchRailScrollLeft: Number(($('searchRail') || {}).scrollLeft || 0),
        searchHotRailScrollLeft: Number(($('searchHotRail') || {}).scrollLeft || 0)
      };
      state.homeV14.route = "search";
      state.homeV14.searchHistoryBackPending = false;
      if (form.parentElement !== host) host.appendChild(form);
      form.hidden = false;
      ensureSearchPageOrder();
      setHomeOnlyPresentationVisible(false);
      if ($("listSection")) $("listSection").hidden = true;
      syncHomeRoutePresentation();
      renderSearch();
      scheduleUiSnapshotSave();
      requestAnimationFrame(() => {
        const input = $("searchInput");
        if (input) focusRemoteTarget(input);
        else focusRemoteTarget($("searchPageBack"));
      });
      return true;
    }

    function closeSearchPage() {
      if (homeUiRoute() !== "search") return false;
      state.homeV14.searchHistoryBackPending = false;
      const form = $("searchForm");
      const saved = state.homeV14.searchReturn || {};
      if (form) form.hidden = true;
      // Search is a presentation route over the single Home model. Older
      // snapshots could carry the removed live/recent Home routes; never
      // revive those routes when returning from Search.
      state.homeV14.route = "home";
      state.activeList = "all";
      state.homeV14.searchReturn = null;
      renderAll({ deferContent: false });
      const restore = () => {
        applyHomeScrollTop(Math.max(0, Number(saved.scrollY || 0)));
        const searchRail = $("searchRail");
        if (searchRail) searchRail.scrollLeft = Math.max(0, Number(saved.searchRailScrollLeft || 0));
        const searchHotRail = $("searchHotRail");
        if (searchHotRail) searchHotRail.scrollLeft = Math.max(0, Number(saved.searchHotRailScrollLeft || 0));
        const target = isVisibleFocusable($("homeSearchLauncher"))
          ? $("homeSearchLauncher")
          : isVisibleFocusable($("searchSubmitBtn")) ? $("searchSubmitBtn") : initialHomeFocus();
        if (target) focusRemoteTarget(target);
      };
      requestAnimationFrame(restore);
      scheduleUiSnapshotSave();
      return true;
    }

    function requestCloseSearchPage() {
      if (homeUiRoute() !== "search") return false;
      const homeV14 = state.homeV14;
      if (!homeV14) return false;
      if (homeV14.searchHistoryBackPending) return true;
      if (isSearchHistoryEntry()) {
        homeV14.searchHistoryBackPending = true;
        try {
          history.back();
          return true;
        } catch (e) {
          homeV14.searchHistoryBackPending = false;
        }
      }
      homeV14.searchHistoryBackPending = false;
      const closed = closeSearchPage();
      if (closed && (location.hash === "#search" || history.state && history.state.sheet === "search")) {
        history.replaceState({ sheet: "home" }, "", location.pathname + location.search);
      }
      return closed;
    }

