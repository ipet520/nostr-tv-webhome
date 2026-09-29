    function homeScrollTop() {
      return Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0);
    }

    function homeFocusSnapshot(target, item) {
      const el = target && target.closest ? target : null;
      const searchHotCard = el && el.closest ? el.closest("#searchHotRail .search-hot-card[data-search-hot-query]") : null;
      if (searchHotCard) {
        return {
          type: "search-hot",
          key: String(searchHotCard.dataset.searchHotQuery || ""),
          cardIndex: Number(searchHotCard.dataset.cardIndex || -1),
          gridId: "searchHotRail",
          sectionId: "searchHotSection"
        };
      }
      const card = el && el.closest(".card[data-media-key]");
      if (card) {
        const grid = card.closest(".media-grid,.rail");
        const section = card.closest(".home-section");
        return {
          type: "media",
          key: card.dataset.mediaKey || mediaDomKey(item),
          cardIndex: Number(card.dataset.cardIndex || -1),
          gridId: grid && (grid.dataset.homeListId || grid.dataset.listId || grid.id || "") || "",
          sectionId: section && section.id || ""
        };
      }
      const itemKey = mediaDomKey(item);
      if (itemKey) return { type: "media", key: itemKey, cardIndex: -1, gridId: "" };
      if (el && el.id) return { type: "id", key: el.id };
      return { type: "", key: "" };
    }

    function homeRailScrollSnapshot() {
      return Object.keys(state.railScroll || {}).reduce((result, key) => {
        if (String(key).indexOf("home:") === 0) result[key] = Math.max(0, Math.round(Number(state.railScroll[key] || 0)));
        return result;
      }, {});
    }

    function rememberHomeReturn(item, returnTarget, options) {
      const opts = options || {};
      const target = returnTarget && returnTarget.isConnected ? returnTarget : document.activeElement;
      const secondaryGrid = homeUiRoute() === "secondary" ? $("secondaryCatalogGrid") : null;
      if (state.homeV14) state.homeV14.secondaryMediaFocusRestore = null;
      state.homeReturn = {
        scrollY: homeScrollTop(),
        activeList: state.activeList || "all",
        route: homeUiRoute(),
        secondaryListId: state.homeV14.secondaryListId || "",
        secondaryQueryKey: state.homeV14.secondaryActiveQueryKey || "",
        secondaryGridScrollTop: secondaryGrid ? Math.max(0, Number(secondaryGrid.scrollTop || 0)) : 0,
        secondaryGridScrollLeft: secondaryGrid ? Math.max(0, Number(secondaryGrid.scrollLeft || 0)) : 0,
        searchRailScrollLeft: homeUiRoute() === "search" ? Math.max(0, Number(($('searchRail') || {}).scrollLeft || 0)) : 0,
        mediaKey: mediaDomKey(item),
        focus: target && (target.id === "homeHero" || target.id === "homeHeroAction") ? { type: "id", key: "homeHero" } : homeFocusSnapshot(target, item),
        heroIndex: target && (target.id === "homeHero" || target.id === "homeHeroAction") ? Math.max(0, Number(state.homeV14.heroIndex || 0)) : null,
        origin: String(opts.origin || ""),
        searchHotRailScrollLeft: homeUiRoute() === "search" ? Math.max(0, Number(($('searchHotRail') || {}).scrollLeft || 0)) : 0,
        at: Date.now()
      };
    }

    function findHomeReturnMediaTarget(saved, focus) {
      const key = focus.key || saved.mediaKey || "";
      const section = focus.sectionId ? document.getElementById(focus.sectionId) : null;
      const sectionGrid = section && section.querySelector(".home-rail,.media-grid");
      const returnGrid = focus.gridId === "searchHotRail" ? $("searchHotRail") : sectionGrid;
      const candidates = key ? Array.from(returnGrid
        ? returnGrid.querySelectorAll(".card[data-media-key]")
        : document.querySelectorAll(".app .card[data-media-key]"))
        .filter((el) => String(el.dataset.mediaKey || "") === String(key) && isVisibleFocusable(el)) : [];
      if (focus.gridId) {
        const scoped = candidates.find((el) => {
          const grid = el.closest(".media-grid,.rail");
          return grid && String(grid.dataset.homeListId || grid.dataset.listId || grid.id || "") === String(focus.gridId);
        });
        if (scoped) return scoped;
      }
      if (candidates.length) return candidates[0];
      const grid = returnGrid || (focus.sectionId ? null : focus.gridId === "searchRail" ? $("searchRail") : activeMediaGrid());
      const index = Number(focus.cardIndex);
      if (!grid || !Number.isFinite(index) || index < 0) return null;
      let guard = 0;
      while (grid.querySelectorAll(".card").length <= index && appendGridBatch(grid) && guard < 60) guard += 1;
      const indexed = Array.from(grid.querySelectorAll(".card"))[index] || null;
      return isVisibleFocusable(indexed) ? indexed : null;
    }

    function findSearchHotReturnTarget(saved, focus) {
      const rail = $("searchHotRail");
      if (!rail || !focus) return null;
      const cards = Array.from(rail.querySelectorAll(".search-hot-card"));
      const key = String(focus.key || "");
      if (key) {
        const exact = cards.find((card) => String(card.dataset.searchHotQuery || "") === key && isVisibleFocusable(card));
        if (exact) return exact;
      }
      const index = Number(focus.cardIndex);
      if (Number.isFinite(index) && index >= 0) {
        const indexed = cards[index] || null;
        if (isVisibleFocusable(indexed)) return indexed;
      }
      const first = cards[0] || null;
      return isVisibleFocusable(first) ? first : null;
    }

    function findHomeReturnSection(saved) {
      const focus = saved && saved.focus || {};
      if (focus.sectionId) return document.getElementById(focus.sectionId);
      if (focus.gridId) {
        const grid = document.getElementById(focus.gridId);
        return grid && grid.closest(".home-section");
      }
      return null;
    }

    function findHomeReturnSectionTarget(saved) {
      const section = findHomeReturnSection(saved);
      if (!section || section.hidden || section.closest("[hidden]")) return null;
      return homeSectionCards(section)[0] || null;
    }

    function findHomeReturnTarget(saved) {
      if (!saved) return null;
      const focus = saved.focus || {};
      if (focus.type === "search-hot") return findSearchHotReturnTarget(saved, focus);
      if (focus.type === "media") return findHomeReturnMediaTarget(saved, focus);
      if (focus.type === "id" && focus.key === "homeHeroAction") return $("homeHero");
      if (focus.type === "id" && focus.key) return $(focus.key);
      return null;
    }

    function applyHomeScrollTop(y) {
      window.scrollTo(0, y);
      document.documentElement.scrollTop = y;
      document.body.scrollTop = y;
      updateBackTopButton();
    }

    function focusHomeReturnTarget(target) {
      if (!isVisibleFocusable(target)) return false;
      state.remoteInitialFocused = true;
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        target.focus();
      }
      maybeAppendGridForFocus(target);
      return true;
    }

    function captureHomeRailFocus(rail) {
      if (!rail || !isTvLikeDevice() || !isHomeRouteActive()) return null;
      const active = document.activeElement;
      if (!active || !rail.contains(active)) return null;
      const focus = homeFocusSnapshot(active, active.__mediaItem || null);
      return {
        focus,
        mediaKey: focus && focus.key || "",
        cardIndex: focus && Number(focus.cardIndex),
        sectionId: focus && focus.sectionId || rail.closest(".home-section") && rail.closest(".home-section").id || "",
        gridId: focus && focus.gridId || rail.dataset.homeListId || rail.id || ""
      };
    }

    function homeRailFallbackTarget(snapshot, rail) {
      const section = snapshot && snapshot.sectionId
        ? document.getElementById(snapshot.sectionId)
        : rail && rail.closest && rail.closest(".home-section");
      const localTarget = (candidateSection) => {
        if (!candidateSection || candidateSection.hidden || candidateSection.closest("[hidden]")) return null;
        const cards = homeSectionCards(candidateSection);
        if (cards.length) return cards[0];
        const more = candidateSection.querySelector(".home-section-more");
        if (isVisibleFocusable(more)) return more;
        const moreCard = candidateSection.querySelector(".home-more-card");
        return isVisibleFocusable(moreCard) ? moreCard : null;
      };
      const sameSection = localTarget(section);
      if (sameSection) return sameSection;
      const sections = homeRailSections();
      const index = sections.indexOf(section);
      const ordered = index >= 0
        ? sections.slice(index + 1).concat(sections.slice(0, index))
        : sections;
      for (const candidateSection of ordered) {
        const target = localTarget(candidateSection);
        if (target) return target;
      }
      const home = $("home");
      if (!home) return null;
      return Array.from(home.querySelectorAll(".focusable,button,input,textarea"))
        .find((target) => target !== $("homeHero") && isVisibleFocusable(target)) || null;
    }

    function restoreHomeRailFocus(rail, snapshot) {
      if (!rail || !snapshot || !isTvLikeDevice() || !isHomeRouteActive()) return false;
      const active = document.activeElement;
      if (isVisibleFocusable(active) && active !== document.body && active !== document.documentElement) return false;
      const focus = snapshot.focus || {};
      const saved = { mediaKey: snapshot.mediaKey || focus.key || "", focus };
      const target = findHomeReturnMediaTarget(saved, focus) || homeRailFallbackTarget(snapshot, rail);
      return target ? focusHomeReturnTarget(target) : false;
    }

    function replaceHomeRailChildren(rail, children, snapshot) {
      if (!rail) return;
      rail.replaceChildren(...(Array.isArray(children) ? children : []));
      restoreHomeRailFocus(rail, snapshot);
    }

    function restoreHomeReturn() {
      const saved = normalizeLegacySavedState(state.homeReturn);
      if (!saved) return false;
      if (state.homeV14 && saved.route === "home") state.homeV14.lastHomeFocusedRail = "";
      const focusEpoch = homeFocusUserEpoch();
      const restoreSecondary = saved.route === "secondary" && saved.secondaryListId;
      const mediaReturn = !!(saved.focus && saved.focus.type === "media");
      const restoreSecondaryMedia = !!(restoreSecondary && mediaReturn);
      if (restoreSecondaryMedia) {
        state.homeV14.secondaryMediaFocusRestore = {
          listId: normalizeLegacyCategoryId(saved.secondaryListId),
          queryKey: String(saved.secondaryQueryKey || ""),
          mediaKey: String(saved.focus.key || saved.mediaKey || ""),
          cardIndex: Number(saved.focus.cardIndex),
          gridScrollTop: Math.max(0, Number(saved.secondaryGridScrollTop || 0)),
          gridScrollLeft: Math.max(0, Number(saved.secondaryGridScrollLeft || 0)),
          focusUserEpoch: focusEpoch,
          frame: 0
        };
      } else {
        state.homeReturn = null;
      }
      if (restoreSecondary) {
        state.activeList = "all";
        state.homeV14.route = "secondary";
        state.homeV14.secondaryListId = saved.secondaryListId;
        state.homeV14.secondaryActiveQueryKey = saved.secondaryQueryKey || "";
        renderAll({ deferContent: false });
      } else if (saved.activeList && isKnownList(saved.activeList) && state.activeList !== saved.activeList) {
        state.activeList = saved.activeList;
        normalizeActiveListForViewport();
        renderAll({ deferContent: false });
      }
      const y = Math.max(0, Number(saved.scrollY || 0));
      const apply = (withFocus, allowMissingSectionFallback) => {
        if (homeFocusUserEpoch() !== focusEpoch) return false;
        if ($("detailSheet") && $("detailSheet").classList.contains("active")) return;
        if (restoreSecondaryMedia && !(state.homeV14 && state.homeV14.secondaryMediaFocusRestore)) return false;
        applyHomeScrollTop(y);
        if (restoreSecondaryMedia) {
          const grid = $("secondaryCatalogGrid");
          if (grid) {
            grid.scrollTop = Math.max(0, Number(saved.secondaryGridScrollTop || 0));
            grid.scrollLeft = Math.max(0, Number(saved.secondaryGridScrollLeft || 0));
          }
          tryRestoreSecondaryMediaFocus();
          return true;
        }
        const heroReturn = !!(saved.focus && saved.focus.type === "id" && (saved.focus.key === "homeHero" || saved.focus.key === "homeHeroAction"));
        if (heroReturn && Number.isFinite(Number(saved.heroIndex))) setHomeHeroIndex(Number(saved.heroIndex), { resetTimer: false });
        const target = withFocus ? findHomeReturnTarget(saved) : null;
        const sectionTarget = withFocus && mediaReturn ? findHomeReturnSectionTarget(saved) : null;
        if (target || sectionTarget) focusHomeReturnTarget(target || sectionTarget);
        else if (withFocus && !mediaReturn) {
          const fallback = isVisibleFocusable($("homeHero")) ? $("homeHero") : initialHomeFocus();
          if (fallback) focusHomeReturnTarget(fallback);
        } else if (withFocus && allowMissingSectionFallback && !findHomeReturnSection(saved)) {
          const fallback = isVisibleFocusable($("homeHero")) ? $("homeHero") : initialHomeFocus();
          if (fallback) focusHomeReturnTarget(fallback);
        }
        if (saved.route === "search" && $("searchRail")) $("searchRail").scrollLeft = Math.max(0, Number(saved.searchRailScrollLeft || 0));
        if (saved.route === "search" && $("searchHotRail")) $("searchHotRail").scrollLeft = Math.max(0, Number(saved.searchHotRailScrollLeft || 0));
        if (restoreSecondary && $("secondaryCatalogGrid")) {
          $("secondaryCatalogGrid").scrollTop = Math.max(0, Number(saved.secondaryGridScrollTop || 0));
          $("secondaryCatalogGrid").scrollLeft = Math.max(0, Number(saved.secondaryGridScrollLeft || 0));
        }
        return true;
      };
      requestAnimationFrame(() => apply(true, false));
      setTimeout(() => apply(true, false), 80);
      setTimeout(() => apply(true, false), 240);
      setTimeout(() => {
        if (apply(true, true)) scheduleUiSnapshotSave();
      }, 520);
      return true;
    }
