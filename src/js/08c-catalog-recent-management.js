    function recentSecondaryDeleteFocusPlan(card, beforeCards) {
      const cards = Array.isArray(beforeCards) ? beforeCards : [];
      const deletedIndex = Math.max(0, cards.indexOf(card));
      const deletedKey = recentHistoryItemKey(card && card.__mediaItem);
      const keys = cards.map((candidate) => recentHistoryItemKey(candidate && candidate.__mediaItem));
      return {
        deletedKey,
        deletedIndex,
        nextKey: keys.slice(deletedIndex + 1).find((value) => !!value) || "",
        previousKey: keys.slice(0, deletedIndex).reverse().find((value) => !!value) || ""
      };
    }

    function recentSecondaryDeleteFocusTarget(grid, plan) {
      if (!grid || !plan) return null;
      const visibleCards = () => Array.from(grid.querySelectorAll(".recent-watching-card")).filter(canFastHomeFocus);
      const findByKey = (cards, key) => {
        if (!key) return null;
        return cards.find((candidate) => recentHistoryItemKey(candidate && candidate.__mediaItem) === String(key)) || null;
      };
      let cards = visibleCards();
      let target = findByKey(cards, plan.nextKey) || findByKey(cards, plan.previousKey);
      if (!target) {
        const info = state.gridRender[gridRenderId(grid)];
        const items = info && Array.isArray(info.items) ? info.items : [];
        const preferredKeys = [plan.nextKey, plan.previousKey].filter(Boolean);
        for (const preferredKey of preferredKeys) {
          const itemIndex = items.findIndex((item) => recentHistoryItemKey(item) === String(preferredKey));
          if (itemIndex >= 0 && Number(info.rendered || 0) <= itemIndex) {
            appendGridItems(grid, items, itemIndex + 1);
            cards = visibleCards();
            target = findByKey(cards, preferredKey);
            if (target) break;
          }
        }
      }
      if (target) return target;
      cards = visibleCards();
      return cards[Math.min(Math.max(0, Number(plan.deletedIndex || 0)), cards.length - 1)] || null;
    }

    function refreshHistoryAfterDelete() {
      if (isHomeRouteActive()) renderHomeRecent();
      if (state.activeList === "recent") renderRecentList();
      if (isRecentManagePage()) {
        const query = secondaryActiveQuery("recent") || secondaryGetQuery("recent");
        Object.assign(query, { items: state.recent.items.slice(), loaded: true, loading: false,
          error: "", page: 1, totalPages: 1, totalResults: state.recent.items.length, hasMore: false });
        renderCatalogQuery("recent");
      }
      if (tvBrowseActive() && tvBrowseState().view === "history") renderTvBrowse();
      updateRecentManageUi(); scheduleUiSnapshotSave();
    }

    async function deleteRecentWatchingBatch(items) {
      if (!isRecentManagePage()) return false;
      const manage = recentManageRuntime();
      if (manage.deleting) return true;
      const frozen = uniqueHistoryRecords(items || []).map((item) => Object.assign({}, item));
      if (!frozen.length) return false;
      manage.deleting = true;
      try {
        cancelRecentManageDeleteArm(); cancelRecentDeleteArm(); updateRecentManageUi();
        const results = await deleteHistoryRecords(frozen);
        const success = results.filter((result) => result.status === "DELETED" || result.status === "NOT_FOUND");
        success.forEach((result) => { delete manage.selectedKeys[result.displayId]; });
        state.recent.lastDeleteResults = results;
        refreshHistoryAfterDelete();
        const failed = results.length - success.length;
        toast(failed ? '已删除或确认不存在 ' + success.length + ' 项，' + failed + ' 项删除失败或不支持'
          : '已删除 ' + success.length + ' 项');
        requestAnimationFrame(() => {
          if (!isRecentManagePage()) return;
          const grid = recentManageGrid();
          const cards = grid ? Array.from(grid.querySelectorAll(".recent-watching-card")).filter(canFastHomeFocus) : [];
          const failedKeys = results.filter((result) => !success.includes(result)).map((result) => result.displayId);
          const target = cards.find((card) => failedKeys.includes(recentHistoryItemKey(card.__mediaItem)))
            || cards[0] || (tvBrowseActive() ? tvBrowsePosterTarget() : $("secondaryCatalogBack"));
          if (target) focusRemoteTarget(target);
        });
        return success.length > 0;
      } catch (error) {
        toast("最近观看删除失败：" + (error.message || "无法验证原生结果")); return false;
      } finally {
        manage.deleting = false; manage.deleteArmed = false;
        cancelRecentManageDeleteArm(); updateRecentManageUi();
      }
    }

    async function deleteRecentWatchingMedia(item, card) {
      if (isRecentManagePage() && recentManageRuntime().active) return false;
      const grid = card && card.closest && card.closest("#homeRecentRail,#secondaryCatalogGrid,#tvBrowseRail,.media-grid");
      const cards = grid ? Array.from(grid.querySelectorAll(".recent-watching-card")) : [];
      const plan = recentSecondaryDeleteFocusPlan(card, cards);
      const secondaryRecentDelete = !!(grid && grid.id === "secondaryCatalogGrid"
        && homeUiRoute() === "secondary" && state.homeV14.secondaryListId === "recent");
      const focusIndex = Math.max(0, cards.indexOf(card));
      if (secondaryRecentDelete) cancelSecondaryMediaFocusRestore();
      cancelRecentDeleteArm();
      try {
        const results = await deleteHistoryRecords([item]);
        state.recent.lastDeleteResults = results;
        const result = results[0];
        if (!result || !["DELETED", "NOT_FOUND"].includes(result.status)) {
          toast("删除失败：" + (result && result.message || "记录未删除")); return false;
        }
        refreshHistoryAfterDelete();
        toast(result.status === "DELETED" ? "已删除这条历史" : "该历史记录已不存在");
        requestAnimationFrame(() => {
          if (grid && grid.id === "tvBrowseRail" && tvBrowseState().view !== "history") return;
          if (secondaryRecentDelete && homeUiRoute() !== "secondary") return;
          let targetGrid = grid && grid.id ? $(grid.id) : grid;
          if (grid && grid.id === "homeRecentRail") targetGrid = $("homeRecentRail");
          const cards = targetGrid ? Array.from(targetGrid.querySelectorAll(".recent-watching-card")).filter(canFastHomeFocus) : [];
          let target = secondaryRecentDelete || grid && grid.id === "tvBrowseRail"
            ? recentSecondaryDeleteFocusTarget(targetGrid, plan) : cards[Math.min(focusIndex, cards.length - 1)];
          if (!target && secondaryRecentDelete) target = $("secondaryCatalogBack");
          if (!target) target = tvBrowseActive() ? tvBrowsePosterTarget() : initialHomeFocus();
          if (target) focusRemoteTarget(target);
        });
        return true;
      } catch (error) { toast("删除失败：" + (error.message || "无法验证原生结果")); return false; }
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
