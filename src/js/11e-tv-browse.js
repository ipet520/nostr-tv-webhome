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
      return state.tvBrowse || (state.tvBrowse = {
        column: "recent", positions: {}, filterOpen: false,
        startupEpoch: null,
        confirm: null, enterHeld: false, suppressClickUntil: 0,
        previewKey: "", backdropToken: 0, backdropSlot: 0, backdropUrl: "",
        focusIntent: null, initialized: false
      });
    }

    function tvBrowseBeginStartup(epoch) {
      const ui = tvBrowseState();
      if (!tvBrowseActive() || homeFocusUserEpoch() !== epoch) return;
      ui.column = "recent"; ui.startupEpoch = epoch;
      renderTvBrowse(); tvBrowseFocusIntent();
      loadRecentList({ silent: true }).catch(() => {});
    }

    function tvBrowseResolveStartup() {
      const ui = tvBrowseState();
      if (ui.startupEpoch == null) return;
      if (homeFocusUserEpoch() !== ui.startupEpoch) { ui.startupEpoch = null; return; }
      const recent = state.recent;
      if (!recent.loaded || recent.loading) return;
      // Failure stays on Recent with its existing retry UI; it is not an empty history result.
      if (!recent.error && !uniqueRecentWatchingMedia(state.recent.items || []).length) ui.column = "recommendation";
      ui.startupEpoch = null;
      ui.focusIntent = { epoch: homeFocusUserEpoch(), focus: null };
    }

    function tvBrowseActive() {
      return isTvLikeDevice() && homeUiRoute() === "home" && state.activeList === "all";
    }

    function tvBrowseColumns() {
      return browseColumnItems();
    }

    function tvBrowseColumnButton(id) {
      return $("tvBrowseColumns") && Array.from($("tvBrowseColumns").children).find((el) => el.dataset.column === id) || null;
    }

    function tvBrowsePosition() {
      const ui = tvBrowseState(), key = secondaryFilterKey(ui.column, secondaryFilterState(ui.column));
      return ui.positions[key] || (ui.positions[key] = { key: "", index: 0, scrollLeft: 0 });
    }

    function tvBrowseSavePosition() {
      const rail = $("tvBrowseRail");
      if (!rail || rail.dataset.queryKey !== secondaryFilterKey(tvBrowseState().column, secondaryFilterState(tvBrowseState().column))) return;
      const position = tvBrowsePosition();
      position.scrollLeft = Math.max(0, rail.scrollLeft || 0);
      const card = document.activeElement && document.activeElement.closest("#tvBrowseRail .card");
      if (card) { position.key = card.dataset.mediaKey || ""; position.index = Number(card.dataset.cardIndex || 0); }
    }

    function tvBrowsePosterTarget() {
      const rail = $("tvBrowseRail"), position = tvBrowsePosition();
      const cards = rail ? Array.from(rail.querySelectorAll(".card")) : [];
      return cards.find((card) => card.dataset.mediaKey === position.key) || cards[Math.min(position.index, cards.length - 1)] || tvBrowseColumnButton(tvBrowseState().column);
    }

    function tvBrowseFocusIntent(focus) {
      tvBrowseState().focusIntent = { epoch: homeFocusUserEpoch(), focus: focus || null };
      tvBrowseTryFocus();
    }

    function tvBrowseTryFocus() {
      const ui = tvBrowseState(), intent = ui.focusIntent;
      if (!intent || !tvBrowseActive() || isSidebarOpen() || focusScopeRoot() !== document) return;
      if (intent.epoch !== homeFocusUserEpoch()) { ui.focusIntent = null; return; }
      const query = secondaryActiveQuery(ui.column);
      const position = tvBrowsePosition();
      if (query && query.loaded && query.hasMore && !query.error && !query.retryableError && position.index >= query.items.length) {
        if (!query.loading) loadSecondaryPage(ui.column, query, query.page + 1).catch(() => {});
        return;
      }
      const saved = intent.focus;
      const target = saved && saved.type === "id" ? $(saved.key) : tvBrowsePosterTarget();
      if (!target || !isVisibleFocusable(target)) return;
      focusRemoteTarget(target);
      state.remoteInitialFocused = true;
      // A loading column is an interim cold-start target, not a completed
      // media restore. The existing user epoch cancels this intent on input.
      if (target.closest("#tvBrowseRail") || saved && saved.type === "id" || query && query.loaded && (ui.column !== "recommendation" || state.hot.ready)) ui.focusIntent = null;
    }

    function tvBrowseSelectColumn(id, options) {
      if (!tvBrowseColumns().some((entry) => entry.listId === id)) return false;
      const ui = tvBrowseState(), opts = options || {};
      tvBrowseSavePosition();
      if (ui.column !== id && recentManageRuntime().deleting) return false;
      if (ui.column !== id) resetRecentManageState();
      ui.column = id;
      ui.filterOpen = false;
      ui.previewKey = "";
      if (!opts.keepConfirm) ui.confirm = null;
      renderTvBrowse();
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
      if (!tvBrowseActive() || !secondaryFilterGroups(ui.column, secondaryCatalogBaseItems(ui.column)).length) return false;
      ui.filterOpen = true;
      renderTvBrowseFilters();
      syncTvBrowseVisibility();
      const host = $("tvBrowseFilters");
      focusRemoteTarget(host.querySelector(".selected") || host.querySelector("button"));
      return true;
    }

    function tvBrowseCloseFilters() {
      const ui = tvBrowseState();
      if (!ui.filterOpen) return false;
      ui.filterOpen = false;
      ui.confirm = null;
      syncTvBrowseVisibility();
      if (tvBrowseActive()) focusRemoteTarget(tvBrowseColumnButton(ui.column));
      return true;
    }

    function renderTvBrowseFilters() {
      const ui = tvBrowseState(), host = $("tvBrowseFilters");
      const groups = secondaryFilterGroups(ui.column, secondaryCatalogBaseItems(ui.column));
      const filters = secondaryNormalizeFilterValues(ui.column, groups);
      const signature = ui.column + secondaryFilterSchemaSignature(groups);
      if (host.dataset.schema !== signature) {
        host.dataset.schema = signature;
        host.innerHTML = groups.map((group) => `<div class="secondary-filter-row" data-group="${escapeAttr(group.key)}"><span class="secondary-filter-label">${escapeHtml(group.label)}</span><div class="secondary-filter-options">${group.options.map((option) => `<button type="button" class="focusable tv-glass-button secondary-filter-option" data-group="${escapeAttr(group.key)}" data-value="${escapeAttr(option.value)}">${escapeHtml(option.label)}</button>`).join("")}</div></div>`).join("");
        host.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
          tvBrowseSavePosition();
          const current = secondaryFilterState(ui.column);
          current[button.dataset.group] = button.dataset.value;
          current.lastFocused[button.dataset.group] = button.dataset.value;
          ui.previewKey = "";
          renderTvBrowse();
          scheduleUiSnapshotSave();
        }));
      }
      host.querySelectorAll("button").forEach((button) => {
        const selected = filters[button.dataset.group] === button.dataset.value;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });
    }

    function syncTvBrowseVisibility() {
      const root = $("tvBrowse"), ui = tvBrowseState();
      if (!root) return;
      root.hidden = !tvBrowseActive();
      if (!tvBrowseActive()) { ui.enterHeld = false; ui.confirm = null; ui.filterOpen = false; }
      root.classList.toggle("filter-open", ui.filterOpen);
      $("tvBrowseFunctions").hidden = ui.filterOpen;
      $("tvBrowseRecentTools").hidden = ui.filterOpen;
      $("tvBrowseInfo").hidden = ui.filterOpen;
      $("tvBrowseFilters").hidden = !ui.filterOpen;
      root.querySelectorAll("#tvBrowseColumns button,#tvBrowseRail button").forEach((button) => button.setAttribute("tabindex", ui.filterOpen ? "-1" : "0"));
      document.documentElement.classList.toggle("tv-browse-active", tvBrowseActive());
    }

    function initTvBrowse() {
      const ui = tvBrowseState();
      if (ui.initialized) return;
      ui.initialized = true;
      const controls = $("recentManageControls");
      if (controls) $("tvBrowseFunctions").appendChild(controls);
      const columns = $("tvBrowseColumns");
      tvBrowseColumns().forEach((entry) => {
        const button = document.createElement("button");
        button.type = "button"; button.className = "focusable tv-glass-button tv-browse-column";
        button.id = "tvColumn-" + entry.listId; button.dataset.column = entry.listId; button.textContent = entry.label;
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
        ["live", "直播", openLiveHome], ["search", "搜索", openSearchPage], ["settings", "设置", openSettingHome]
      ];
      actions.forEach(([id, label, action]) => {
        const button = document.createElement("button");
        button.id = "tvFunction-" + id; button.type = "button";
        button.className = "focusable tv-glass-button"; button.tabIndex = 0;
        button.setAttribute("aria-label", label);
        if (id === "search") {
          button.classList.add("tv-browse-search");
          button.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m16.5 16.5 4 4"></path></svg>';
        } else button.textContent = label;
        button.addEventListener("click", () => {
          markHomeUserNavigation(); tvBrowseSavePosition();
          if (id === "live") rememberFocusReturn();
          scheduleUiSnapshotSave(); action();
        });
        $("tvBrowseFunctions").appendChild(button);
      });
      const dock = $("connectionDock"), toggle = $("connectionToggle");
      toggle.classList.remove("home-sidebar-item"); toggle.classList.add("tv-glass-button");
      toggle.setAttribute("aria-label", "基础设置"); toggle.removeAttribute("data-sidebar-key"); toggle.removeAttribute("data-sidebar-action");
      $("tvBrowseFunctions").appendChild(dock);
      window.addEventListener("blur", () => { ui.enterHeld = false; ui.confirm = null; });
      $("tvBrowse").addEventListener("click", (event) => {
        if ((ui.enterHeld || Date.now() < ui.suppressClickUntil) && event.detail === 0) {
          event.preventDefault(); event.stopImmediatePropagation();
        }
      }, true);
      $("tvBrowseRetry").addEventListener("click", () => {
        const id = ui.column, query = secondaryActiveQuery(id);
        if (id === "recent") { loadRecentList({ refresh: true }).catch(() => {}); return; }
        if (id === "recommendation") { forceRefreshNostrRanking().catch(() => {}); return; }
        if (query && !query.loading) loadSecondaryPage(id, query, query.failedPage || query.page + 1 || 1).catch(() => {});
      });
      $("tvBrowseRail").addEventListener("scroll", () => { tvBrowseSavePosition(); scheduleUiSnapshotSave(); }, { passive: true });
    }

    function renderTvBrowse() {
      if (!tvBrowseActive()) return;
      initTvBrowse();
      syncTvBrowseVisibility();
      const ui = tvBrowseState(), rail = $("tvBrowseRail");
      tvBrowseResolveStartup();
      const query = secondaryGetQuery(ui.column);
      // Finite sources can change independently of the catalog page loader.
      if (ui.column === "recommendation") {
        const pool = recommendationPoolItems();
        query.renderedCount = Math.max(18, Number(query.renderedCount || 0));
        query.items = pool.slice(0, query.renderedCount);
        query.hasMore = query.renderedCount < pool.length;
        query.loaded = !!state.hot.ready; query.loading = !state.hot.ready; query.page = Math.ceil(query.renderedCount / query.batchSize);
      } else if (ui.column === "recent") {
        query.items = uniqueRecentWatchingMedia(state.recent.items || []); query.loaded = !!state.recent.loaded; query.loading = !!state.recent.loading; query.error = state.recent.error || "";
      }
      const items = (ui.column === "recommendation" || ui.column === "recent"
        ? filterBlocked(query.items || []) : secondaryFilterItems(ui.column, query.items || [])).filter((item) => ui.column === "recent" || hasPoster(item));
      const keys = items.map((item, index) => mediaRenderKey(item, index)), oldKeys = rail.__renderKeys || [];
      const queryChanged = rail.dataset.queryKey !== query.key;
      const prefix = !queryChanged && oldKeys.length <= keys.length && oldKeys.every((key, index) => key === keys[index]);
      const focused = rail.contains(document.activeElement) ? document.activeElement.dataset.mediaKey : "";
      if (!prefix) { rail.replaceChildren(); oldKeys.length = 0; }
      if (queryChanged) { rail.dataset.queryKey = query.key; rail.scrollLeft = tvBrowsePosition().scrollLeft; }
      for (let index = oldKeys.length; index < items.length; index += 1) {
        const item = items[index], card = mediaCard(item, index, { home: true, homeLazy: index > 7, weeklyHome: ui.column === "now-playing" });
        card.addEventListener("focus", () => {
          const position = tvBrowsePosition(); position.key = card.dataset.mediaKey; position.index = index;
          tvBrowsePreview(card.__mediaItem);
          tvBrowseMaybeLoadMore(index);
          scheduleUiSnapshotSave();
        });
        rail.appendChild(card);
      }
      rail.__renderKeys = keys;
      syncTvBrowseVisibility();
      if (queryChanged) rail.scrollLeft = tvBrowsePosition().scrollLeft;
      $("tvBrowseColumns").querySelectorAll("button").forEach((button) => {
        const selected = button.dataset.column === ui.column;
        button.classList.toggle("selected", selected); button.setAttribute("aria-pressed", String(selected));
      });
      updateRecentManageUi();
      updateBlockSelectUi();
      $("tvBrowseBlockHint").hidden = !state.blocked.selecting;
      const status = query.error || query.retryableError || (query.loading && !items.length ? "加载中…" : !items.length ? "暂无内容" : "");
      $("tvBrowseStatus").textContent = status;
      $("tvBrowseRetry").hidden = !(query.error || query.retryableError || !items.length && query.loaded);
      if (ui.filterOpen) renderTvBrowseFilters();
      const position = tvBrowsePosition();
      const selected = items.find((item) => mediaDomKey(item) === position.key) || items[Math.min(position.index, items.length - 1)];
      if (selected) tvBrowsePreview(selected);
      else tvBrowseClearPreview();
      observeHomeImages(rail); observeTvCardEnrichment(rail); observeMovieCardEnrichment(rail);
      if (focused && !prefix && focusScopeRoot() === document && !isSidebarOpen()) {
        const target = Array.from(rail.children).find((card) => card.dataset.mediaKey === focused) || tvBrowsePosterTarget();
        if (target) focusRemoteTarget(target);
      }
      tvBrowseTryFocus();
      if (!query.loaded && !query.loading && !query.error && !["recommendation", "recent"].includes(ui.column)) loadSecondaryPage(ui.column, query, 1).catch(() => {});
    }

    function tvBrowseMaybeLoadMore(index) {
      const ui = tvBrowseState(), query = secondaryActiveQuery(ui.column);
      if (!query || query.loading || query.error || query.retryableError || !query.hasMore || index < query.items.length - 5) return false;
      loadSecondaryPage(ui.column, query, query.page + 1).catch(() => {});
      return true;
    }

    function tvBrowseClearPreview() {
      const ui = tvBrowseState();
      ui.previewKey = ""; ui.backdropToken += 1;
      if (ui.pendingImage) { ui.pendingImage.onload = ui.pendingImage.onerror = null; ui.pendingImage.src = ""; ui.pendingImage = null; }
      $("tvBrowseTitle").textContent = ""; $("tvBrowseMeta").textContent = "";
      $("tvBrowseOverview").textContent = ""; $("tvBrowseUpdate").textContent = "";
      $("tvBrowseLogo").hidden = true;
      // Keep the last decoded backdrop until a valid replacement is ready.
    }

    function tvBrowsePreview(item) {
      const ui = tvBrowseState(), key = mediaDomKey(item);
      const detail = (String(item.mediaType || item.media_type || "").toLowerCase() === "movie" ? movieDetailCacheValue(item) : tvDetailCacheValue(item)) || item.tvDetail || item.weeklyDetail || item.heroDetail || null;
      $("tvBrowseTitle").textContent = item.title || item.name || "";
      const year = String(item.releaseDate || item.first_air_date || item.release_date || "").slice(0, 4);
      const genres = homeHeroPresentationGenres(item, detail);
      const rating = Number(detail && detail.vote_average || item.voteAverage || item.vote_average || 0);
      $("tvBrowseMeta").textContent = [year, genres.join(" · "), rating > 0 ? rating.toFixed(1) + " 分" : ""].filter(Boolean).join("  /  ");
      $("tvBrowseUpdate").textContent = item.weeklyUpdateText || homeHeroPresentationStatus(item, detail) || "";
      const desc = String(item.description || item.desc || "").trim();
      const labelOnly = item.source === "tmdb" && desc === (item.listTitle || "搜索") + " · " + (item.title || "");
      $("tvBrowseOverview").textContent = homeHeroPresentationOverview(item, detail) || (labelOnly ? "" : desc);
      const logo = $("tvBrowseLogo"), logoUrl = item.logo || item.logoUrl || item.logoPath || item.logo_path || "";
      logo.hidden = !logoUrl;
      if (logoUrl && logo.getAttribute("src") !== logoUrl) { logo.src = displayImage(logoUrl, { size: "w500" }); logo.onerror = () => { logo.hidden = true; }; }
      const source = item.landscape || item.backdrop || item.backdrop_path || detail && detail.backdrop_path || item.image || item.pic;
      const url = displayImage(source, { size: item.landscape || item.backdrop || item.backdrop_path ? "w1280" : "w780" });
      if (ui.previewKey === key && (url === ui.backdropUrl || ui.pendingImage && ui.pendingImage.src === url)) return;
      ui.previewKey = key;
      const token = ++ui.backdropToken;
      if (!url || url === ui.backdropUrl) return;
      // One pending decode, two resident layers, no unbounded image cache.
      if (ui.pendingImage) { ui.pendingImage.onload = ui.pendingImage.onerror = null; ui.pendingImage.src = ""; }
      const image = new Image(); ui.pendingImage = image;
      image.onload = () => {
        if (token !== ui.backdropToken || key !== ui.previewKey) return;
        ui.pendingImage = null;
        const next = ui.backdropSlot ? $("tvBrowseBackdrop") : $("tvBrowseBackdropNext");
        const previous = ui.backdropSlot ? $("tvBrowseBackdropNext") : $("tvBrowseBackdrop");
        next.style.backgroundImage = "url(" + JSON.stringify(url) + ")";
        next.classList.add("visible"); previous.classList.remove("visible");
        ui.backdropSlot = ui.backdropSlot ? 0 : 1; ui.backdropUrl = url;
      };
      image.onerror = () => { if (token === ui.backdropToken) ui.pendingImage = null; };
      image.src = url;
    }

    function tvBrowseDirectionalTarget(key, active) {
      const ui = tvBrowseState();
      if (ui.filterOpen) {
        const rows = Array.from($("tvBrowseFilters").querySelectorAll(".secondary-filter-row"));
        const row = active && active.closest(".secondary-filter-row");
        if (!row) return $("tvBrowseFilters").querySelector("button");
        const buttons = Array.from(row.querySelectorAll("button")), index = buttons.indexOf(active);
        if (key === "ArrowLeft" || key === "ArrowRight") return buttons[Math.max(0, Math.min(buttons.length - 1, index + (key === "ArrowRight" ? 1 : -1)))];
        const next = rows[Math.max(0, Math.min(rows.length - 1, rows.indexOf(row) + (key === "ArrowDown" ? 1 : -1)))];
        return next.querySelector(".selected") || next.querySelector("button");
      }
      const rail = $("tvBrowseRail"), columns = $("tvBrowseColumns"), functions = $("tvBrowseFunctions");
      if (active === $("tvBrowseRetry")) return key === "ArrowUp" ? tvBrowsePosterTarget() : active;
      let host = active && active.closest("#tvBrowseRail,#tvBrowseColumns,#tvBrowseFunctions,#tvBrowseRecentTools");
      if (!host) return tvBrowsePosterTarget();
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const buttons = Array.from(host.querySelectorAll("button")).filter(isVisibleFocusable), index = buttons.indexOf(active);
        if (host === rail) tvBrowseMaybeLoadMore(index);
        return buttons[Math.max(0, Math.min(buttons.length - 1, index + (key === "ArrowRight" ? 1 : -1)))];
      }
      if (host === rail) return key === "ArrowDown" && !$("tvBrowseRetry").hidden ? $("tvBrowseRetry") : tvBrowseColumnButton(ui.column);
      if (host === columns) return key === "ArrowDown" ? tvBrowsePosterTarget() : $("tvFunction-live");
      return tvBrowseColumnButton(ui.column);
    }

    function handleTvBrowseKey(event, key, active) {
      const scope = focusScopeRoot();
      if (!tvBrowseActive() || isSidebarOpen() || scope !== document && scope !== $("tvBrowseFilters") || isConnectionPanelOpen()) return false;
      const column = active && active.closest("#tvBrowseColumns button");
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
      focusRemoteTarget(tvBrowseDirectionalTarget(key, active));
      return true;
    }

    function tvBrowseSnapshot() {
      tvBrowseSavePosition();
      const ui = tvBrowseState();
      return { column: ui.column, positions: JSON.parse(JSON.stringify(ui.positions)), filters: JSON.parse(JSON.stringify(state.homeV14.secondaryFilters || {})) };
    }

    function restoreTvBrowseSnapshot(saved, legacyColumn) {
      const ui = tvBrowseState(), value = saved || {};
      const id = value.column || legacyColumn || "recommendation";
      ui.startupEpoch = null;
      ui.column = tvBrowseColumns().some((entry) => entry.listId === id) ? id : "recommendation";
      ui.positions = value.positions && typeof value.positions === "object" ? value.positions : {};
      if (value.filters && typeof value.filters === "object") state.homeV14.secondaryFilters = value.filters;
      ui.filterOpen = false; ui.confirm = null; ui.previewKey = "";
    }

    function renderCatalogQuery(id) {
      if (tvBrowseActive()) {
        if (tvBrowseState().column === id) renderTvBrowse();
      } else if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === id) renderSecondaryCatalog();
    }
