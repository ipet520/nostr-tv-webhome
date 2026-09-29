    function recentSecondaryDeleteFocusPlan(card, beforeCards) {
      const cards = Array.isArray(beforeCards) ? beforeCards : [];
      const deletedIndex = Math.max(0, cards.indexOf(card));
      const deletedKey = recentWatchingMediaKey(card && card.__mediaItem);
      const keys = cards.map((candidate) => recentWatchingMediaKey(candidate && candidate.__mediaItem));
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
        return cards.find((candidate) => recentWatchingMediaKey(candidate && candidate.__mediaItem) === String(key)) || null;
      };
      let cards = visibleCards();
      let target = findByKey(cards, plan.nextKey) || findByKey(cards, plan.previousKey);
      if (!target) {
        const info = state.gridRender[gridRenderId(grid)];
        const items = info && Array.isArray(info.items) ? info.items : [];
        const preferredKeys = [plan.nextKey, plan.previousKey].filter(Boolean);
        for (const preferredKey of preferredKeys) {
          const itemIndex = items.findIndex((item) => recentWatchingMediaKey(item) === String(preferredKey));
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
      const secondaryRecentDelete = !!(grid
        && grid.id === "secondaryCatalogGrid"
        && homeUiRoute() === "secondary"
        && state.homeV14.secondaryListId === "recent");
      const deleteFocusPlan = secondaryRecentDelete
        ? recentSecondaryDeleteFocusPlan(card, beforeCards)
        : null;
      const focusIndex = deleteFocusPlan ? deleteFocusPlan.deletedIndex : Math.max(0, beforeCards.indexOf(card));
      if (secondaryRecentDelete) cancelSecondaryMediaFocusRestore();
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
        let target = secondaryRecentDelete
          ? recentSecondaryDeleteFocusTarget(targetGrid, deleteFocusPlan)
          : (cards.length ? cards[Math.min(focusIndex, cards.length - 1)] : null);
        if (!target && targetGrid && targetGrid.id === "secondaryCatalogGrid") target = $("secondaryCatalogBack");
        if (!target && targetGrid && targetGrid.id === "homeRecentRail") target = $("homeRecentMore") || homeFirstTarget();
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
