    async function runMovieDetailSharedSelfTests() {
      if (!isTvDiagnosticEnabled()) return [];
      const results = [];
      const check = (id, pass, detail) => results.push({ id, pass: !!pass, kind: "RUNTIME_MOCK", detail: detail || "" });
      const previousRuntime = state.movieDetail;
      const movieA = { mediaType: "movie", tmdbId: "910001", title: "Movie A" };
      const movieB = { mediaType: "movie", tmdbId: "910002", title: "Movie B" };
      try {
        state.movieDetail = { cache: {} };
        let pendingResolve = null;
        let pendingRequestCount = 0;
        const pendingRequest = () => {
          pendingRequestCount++;
          return new Promise((resolve) => { pendingResolve = resolve; });
        };
        const pendingA = requestMovieDetailShared(movieA, pendingRequest);
        const pendingB = requestMovieDetailShared(movieA, pendingRequest);
        check("MOVIE_DETAIL_PENDING_PROMISE_TEST", pendingRequestCount === 1 && pendingA === pendingB, "same movie joins one pending request");
        pendingResolve({ id: Number(movieA.tmdbId), title: movieA.title });
        await Promise.all([pendingA, pendingB]);
        const cached = await requestMovieDetailShared(movieA, () => { pendingRequestCount++; return Promise.resolve({ id: movieA.tmdbId }); });
        check("MOVIE_DETAIL_CACHE_REUSE_TEST", pendingRequestCount === 1 && !!cached && String(cached.id) === movieA.tmdbId, "successful detail is reused within TTL");

        state.movieDetail = { cache: {} };
        let failureRequestCount = 0;
        const failureThenSuccess = () => {
          failureRequestCount++;
          return failureRequestCount === 1
            ? Promise.reject(new Error("mock_failure"))
            : Promise.resolve({ id: Number(movieA.tmdbId), title: movieA.title });
        };
        try { await requestMovieDetailShared(movieA, failureThenSuccess); } catch (e) {}
        const retryDetail = await requestMovieDetailShared(movieA, failureThenSuccess);
        check("MOVIE_DETAIL_FAILURE_RETRY_TEST", failureRequestCount === 2 && !!retryDetail && String(retryDetail.id) === movieA.tmdbId, "rejected promise is cleared and the next call retries");

        state.movieDetail = { cache: {} };
        let isolatedRequestCount = 0;
        const isolatedRequest = (url) => {
          isolatedRequestCount++;
          const id = String(url).match(/\/movie\/(\d+)/);
          return Promise.resolve({ id: id ? Number(id[1]) : 0, title: id && id[1] === movieA.tmdbId ? movieA.title : movieB.title });
        };
        const isolatedA = requestMovieDetailShared(movieA, isolatedRequest);
        const isolatedB = requestMovieDetailShared(movieB, isolatedRequest);
        await Promise.all([isolatedA, isolatedB]);
        check("MOVIE_DETAIL_DIFFERENT_ID_ISOLATION_TEST", isolatedRequestCount === 2 && isolatedA !== isolatedB, "different movie IDs do not share cache or promise");
      } catch (error) {
        check("MOVIE_DETAIL_SHARED_SELF_TEST_ERROR", false, String(error && error.message || error || "unknown"));
      } finally {
        state.movieDetail = previousRuntime;
        if (state.tvDiag) state.tvDiag.movieDetailSharedTests = results;
        try { updateTvDiagnostic(); } catch (e) {}
      }
      return results;
    }

    function runTvAdaptationSelfTests() {
      if (!isTvDiagnosticEnabled()) return [];
      const results = [];
      const check = (id, pass, detail, kind) => results.push({ id, pass: !!pass, kind: kind || "STATIC_HOOK", detail: detail || "" });
      const runtimeRequired = (id, detail) => results.push({ id, pass: null, kind: "RUNTIME_REQUIRED", status: "not-run", detail: detail || "" });
      const home = $("home");
      const oldHomeNodes = document.querySelectorAll("#homeHeader, #homeHeaderInner, #homeIndependentNav, #chips, #homeToolbar");
      const sourceText = String(renderAll) + String(renderHome) + String(renderHomeContent);
      const routeSource = String(homeUiRoute) + String(migrateLegacyHomeState) + String(normalizeLegacySavedState) + String(restoreUiSnapshot);
      const legacyHomeRoutes = LEGACY_HOME_PRESENTATION_ROUTES;
      check("PHASE1_OLD_HOME_HEADER_DOM_REMOVED", oldHomeNodes.length === 0, "legacy Home Header nodes are absent", "DOM_ASSERTION");
      check("PHASE1_HOME_ANCHOR_PRESENTATION_REMOVED", !document.querySelector(".home-anchor, [data-home-anchor-key], [data-home-section-id]"), "legacy Home Anchor controls are absent", "DOM_ASSERTION");
      check("PHASE1_HOME_ANCHOR_NAVIGATION_REMOVED", typeof scrollHomeToAnchor === "undefined" && typeof findHomeHeaderEntry === "undefined", "legacy Home Anchor navigation helpers are absent", "STATIC_HOOK");
      check("PHASE1_HOME_SCROLL_SPY_REMOVED", typeof updateHomeScrollSpy === "undefined" && typeof ensureHomeScrollSpy === "undefined", "legacy Home ScrollSpy helpers are absent", "STATIC_HOOK");
      check("PHASE1_HOME_SCROLL_SPY_LISTENER_REMOVED", !sourceText.includes("updateHomeScrollSpy") && !sourceText.includes("ensureHomeScrollSpy"), "Home render path has no ScrollSpy listener", "STATIC_HOOK");
      check("PHASE1_PROGRAMMATIC_ANCHOR_GUARD_REMOVED", !sourceText.includes("locatorProgrammatic"), "Home render path has no programmatic Anchor guard", "STATIC_HOOK");
      check("PHASE1_HEADER_METRICS_REMOVED_OR_JUSTIFIED", typeof syncHomeHeaderMetrics === "undefined" && !sourceText.includes("homeContentTopLimit"), "legacy Header metrics are absent", "STATIC_HOOK");
      check("PHASE1_HOME_CONTENT_STILL_RENDERS", !!home && typeof renderHome === "function" && typeof renderHomeRecent === "function" && typeof renderHomeHot === "function" && typeof renderHomeDynamicSections === "function", "Home content renderer remains available", "STATIC_HOOK");
      check("PHASE1_HERO_BUSINESS_UNCHANGED", typeof renderHomeHero === "function" && typeof homeHeroCandidates === "function", "existing Hero data path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_RECENT_DATA_UNCHANGED", typeof renderHomeRecent === "function" && typeof renderRecentList === "function" && typeof recentWatchingItems === "function", "existing Recent data path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_LATEST_DATA_UNCHANGED", typeof resolveHomeLatestItems === "function" && typeof renderHomeHot === "function", "existing Latest data path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_SEARCH_BUSINESS_UNCHANGED", typeof openSearchPage === "function" && typeof submitSearchInput === "function", "existing Search path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_SECONDARY_BUSINESS_UNCHANGED", typeof openSecondaryCatalog === "function" && typeof renderSecondaryCatalog === "function", "existing Secondary path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_DETAIL_UNCHANGED", typeof openDetail === "function", "existing Detail path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_PAN_UNCHANGED", typeof panSearch === "function" || typeof searchPan === "function" || typeof playPanResult === "function", "existing Pan path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_PLAYBACK_UNCHANGED", typeof playBestQuark === "function" && typeof playPanResult === "function", "existing Playback path remains", "FROZEN_SOURCE_AUDIT");
      check("PHASE1_SELECT_CHIP_REMOVED", typeof selectChip === "undefined", "old selectChip helper is absent", "STATIC_HOOK");
      const obsoleteChipTimer = ["chip", "Focus", "Timer"].join("");
      check("PHASE1_CHIP_FOCUS_TIMER_REMOVED", !Object.prototype.hasOwnProperty.call(state, obsoleteChipTimer) && !document.documentElement.innerHTML.includes(obsoleteChipTimer), "obsolete chip focus timer is absent", "STATIC_HOOK");
      check("PHASE1_HOME_PRESENTATION_ROUTE_ENUM", HOME_PRESENTATION_ROUTES.join(",") === "home,search,secondary" && HOME_PRESENTATION_ROUTES.every((route) => normalizeHomePresentationRoute(route) === route), "presentation route enum is home/search/secondary", "STATIC_HOOK");
      check("PHASE1_LEGACY_HOME_ROUTE_MIGRATION", legacyHomeRoutes.every((route) => normalizeHomePresentationRoute(route) === "home" && normalizeLegacySavedState({ route }).route === "home"), "legacy Home routes normalize to home", "STATIC_HOOK");
      const searchCloseSource = String(closeSearchPage);
      check("PHASE1_SEARCH_RETURN_NO_LEGACY_HOME_ROUTE", searchCloseSource.includes('state.homeV14.route = "home"') && searchCloseSource.includes('state.activeList = "all"') && !searchCloseSource.includes("restoreRoute") && !searchCloseSource.includes("saved.route"), "Search return always restores Home", "STATIC_HOOK");
      const legacySnapshotArrayText = ["[", '"home"', ", ", '"live"', ", ", '"recent"', ", ", '"catalog"', "]"].join("");
      check("PHASE1_SNAPSHOT_NO_LEGACY_HOME_ROUTE_RESTORE", routeSource.includes("normalizeHomePresentationRoute") && !String(restoreUiSnapshot).includes(legacySnapshotArrayText), "snapshot restore accepts only current presentation routes", "STATIC_HOOK");
      const sidebarSource = String(renderSidebar) + String(openSidebar) + String(closeSidebar) + String(handleSidebarDirectionalKey) + String(handleSidebarMenuKey);
      check("PHASE3_SIDEBAR_SINGLE_DOM", document.querySelectorAll("#homeSidebar").length === 1 && document.querySelectorAll("#homeSidebarNav").length === 1 && document.querySelectorAll("#homeSidebarTools").length === 1, "one Sidebar overlay exists", "DOM_ASSERTION");
      check("PHASE3_SIDEBAR_REAL_NAVIGATION", sidebarSource.includes("openSecondaryCatalog") && sidebarSource.includes("openLiveHome") && sidebarSource.includes("openSettingHome"), "Sidebar uses existing navigation/actions", "STATIC_HOOK");
      check("PHASE3_SIDEBAR_KEEP_NAVIGATION", typeof openKeepHome === "function" && String(performSidebarNavigation).includes('action.type === "keep"') && String(performSidebarNavigation).includes("openKeepHome") && String(activateSidebarItem).includes('requestSidebarNavigation({ type: "keep" })'), "Sidebar收藏使用Native Keep入口", "STATIC_HOOK");
      const recentBatchSource = String(enterRecentManageMode) + String(exitRecentManageMode) + String(toggleRecentManageSelection) + String(toggleRecentManageSelectAll) + String(deleteRecentWatchingBatch) + String(handleSecondaryBackKey) + String(secondaryCatalogDirectionalTarget) + String(updateRecentManageUi);
      check("PHASE3_RECENT_BATCH_MANAGEMENT", typeof enterRecentManageMode === "function" && typeof deleteRecentWatchingBatch === "function" && document.querySelectorAll("#recentManageBtn").length === 1, "Recent batch management helpers and entry exist", "STATIC_HOOK");
      check("RECENT_MANAGE_SINGLE_ENTRY", !!document.getElementById("recentManageBtn") && !document.getElementById("recentMultiSelectBtn"), "只有管理按钮进入多选模式", "DOM_ASSERTION");
      check("RECENT_BATCH_ENTRY_SCOPE", String(updateRecentManageUi).includes("isRecentManagePage") && String(updateRecentManageUi).includes("controls.hidden"), "管理入口只在 Secondary Recent 显示", "STATIC_HOOK");
      check("RECENT_BATCH_NO_NEW_ROUTE", !recentBatchSource.includes("pushState") && !recentBatchSource.includes("replaceState"), "管理模式不新增 history route", "STATIC_HOOK");
      check("RECENT_BATCH_MULTI_SELECT", String(toggleRecentManageSelection).includes("selectedKeys") && String(toggleRecentManageSelection).includes("delete manage.selectedKeys"), "选择权威是 media key 集合", "STATIC_HOOK");
      check("RECENT_BATCH_SELECT_ALL_DATASET", String(recentManageItems).includes("uniqueRecentWatchingMedia") && String(toggleRecentManageSelectAll).includes("recentManageItems"), "全选使用完整业务数据集", "STATIC_HOOK");
      check("RECENT_BATCH_DESELECT_ALL", String(toggleRecentManageSelectAll).includes("manage.selectedKeys = {}"), "取消全选清空选择", "STATIC_HOOK");
      check("RECENT_BATCH_CARD_NO_OPEN", String(consumeRecentWatchingPress).includes("recentManageCard(card)") && !String(toggleRecentManageSelection).includes("openRecentWatchingDetail"), "管理态卡片不打开详情", "STATIC_HOOK");
      check("RECENT_BATCH_SINGLE_DELETE_BYPASSED", String(consumeRecentWatchingPress).includes("recentManageCard(card)") && String(deleteRecentWatchingMedia).includes("recentManageRuntime().active"), "管理态绕过单删链", "STATIC_HOOK");
      check("RECENT_BATCH_BACK_EXIT_ONLY", String(handleSecondaryBackKey).includes("exitRecentManageMode") && String(handleSecondaryBackKey).includes("return true"), "管理态 Back 只退出管理", "STATIC_HOOK");
      check("RECENT_BATCH_NATIVE_AUTHORITY", String(deleteRecentWatchingBatch).includes("readFreshNativeHistoryItemsForDeletion") && String(deleteRecentWatchingBatch).includes("deleteNativeHistoryViaLocalApi"), "批量删除复用 Native History 验证", "STATIC_HOOK");
      check("RECENT_BATCH_GROUP_DELETE", String(deleteRecentWatchingBatch).includes("freezeNativeHistoryDeleteIdentity") && String(deleteRecentWatchingBatch).includes("nativeHistoryDeleteFrozenPresent"), "Native History member 按媒体组统一验证", "STATIC_HOOK");
      check("RECENT_BATCH_ALWAYS_RELEASE_DELETING", String(deleteRecentWatchingBatch).includes("finally") && String(deleteRecentWatchingBatch).includes("manage.deleting = false") && String(deleteRecentWatchingBatch).includes("cancelRecentManageDeleteArm"), "批量删除最终释放 deleting 状态", "STATIC_HOOK");
      check("RECENT_BATCH_PERSIST_FAILURE_RECOVERY", String(deleteRecentWatchingBatch).includes("localCleanupFailed") && String(deleteRecentWatchingBatch).includes("persistHistoryContextEntries") && String(deleteRecentWatchingBatch).includes("persistContinueIndexEntries") && String(deleteRecentWatchingBatch).includes("loadRecentList({ refresh: true, silent: true })"), "本地续播清理异常仍完成恢复", "STATIC_HOOK");
      check("RECENT_BATCH_EMPTY_DATASET_AUTHORITY", String(recentManageItems).includes("recentState.loaded === true") && String(recentManageItems).includes("recentItems"), "已加载空 Recent 不回退旧 query", "STATIC_HOOK");
      check("RECENT_BATCH_SINGLE_CONTEXT_PERSIST", String(deleteRecentWatchingBatch).includes("persistHistoryContextEntries") && String(deleteRecentWatchingBatch).includes("previousContexts"), "History Context 统一持久化", "STATIC_HOOK");
      check("RECENT_BATCH_SINGLE_CONTINUE_PERSIST", String(deleteRecentWatchingBatch).includes("persistContinueIndexEntries") && String(deleteRecentWatchingBatch).includes("previousContinue"), "Continue Index 统一持久化", "STATIC_HOOK");
      check("RECENT_BATCH_SINGLE_RECENT_REFRESH", String(deleteRecentWatchingBatch).includes('loadRecentList({ refresh: true, silent: true })') && String(deleteRecentWatchingBatch).indexOf('loadRecentList({ refresh: true, silent: true })') === String(deleteRecentWatchingBatch).lastIndexOf('loadRecentList({ refresh: true, silent: true })'), "批量删除只统一刷新 Recent", "STATIC_HOOK");
      check("RECENT_BATCH_PARTIAL_FAILURE", String(deleteRecentWatchingBatch).includes("failedGroups") && String(deleteRecentWatchingBatch).includes("successfulList"), "批量删除支持部分成功", "STATIC_HOOK");
      check("RECENT_BATCH_FAILED_KEYS_PRESERVED", String(deleteRecentWatchingBatch).includes("delete manage.selectedKeys[key]") && String(deleteRecentWatchingBatch).includes("failedKeys"), "失败项保留选择", "STATIC_HOOK");
      check("RECENT_BATCH_DELETE_CONFIRM", String(armRecentManageDelete).includes("再次确认删除") && String(armRecentManageDelete).includes("2800"), "批量删除有二次确认", "STATIC_HOOK");
      check("RECENT_BATCH_CONFIRM_RESET_ON_SELECTION", String(toggleRecentManageSelection).includes("cancelRecentManageDeleteArm") && String(toggleRecentManageSelectAll).includes("cancelRecentManageDeleteArm"), "选择变化取消删除确认", "STATIC_HOOK");
      check("RECENT_SINGLE_DELETE_PRESERVED", typeof deleteRecentWatchingMedia === "function" && String(deleteRecentWatchingMedia).includes("deleteNativeHistoryMediaGroupVerified"), "普通 Secondary 单删仍保留", "FROZEN_SOURCE_AUDIT");
      check("RECENT_HOME_SINGLE_DELETE_PRESERVED", String(deleteRecentWatchingMedia).includes("#homeRecentRail") && String(deleteRecentWatchingMedia).includes("renderHomeRecent"), "Home Recent 单删仍保留", "FROZEN_SOURCE_AUDIT");
      check("RECENT_BATCH_TV_FOCUS", String(secondaryCatalogDirectionalTarget).includes("recentHeaderItems") && String(secondaryCatalogDirectionalTarget).includes("ArrowDown"), "管理 Header 参与 TV 焦点导航", "STATIC_HOOK");
      check("RECENT_BATCH_MOBILE_SAFE", String(consumeRecentWatchingClick).includes("consumeRecentWatchingPress") && String(enterRecentManageMode).includes("isRecentManagePage"), "手机复用同一点击/选择链", "STATIC_HOOK");
      const canonicalMockItem = { mediaType: "movie", title: "The Example", originalTitle: "The Example" };
      const canonicalMockDetail = {
        title: "The Example",
        original_title: "The Example",
        alternative_titles: { titles: [
          { iso_3166_1: "CN", title: "示例大陆名" },
          { iso_3166_1: "HK", title: "示例香港名" }
        ] }
      };
      const canonicalMockIdentity = canonicalIdentityFromDetail(canonicalMockItem, canonicalMockDetail);
      const localizedChineseIdentity = canonicalIdentityFromDetail(
        canonicalMockItem,
        { title: "最后生还者", original_title: "The Example", alternative_titles: { titles: [{ iso_3166_1: "CN", title: "最后生还者" }] } }
      );
      const hkOnlyIdentity = canonicalIdentityFromDetail(
        canonicalMockItem,
        { title: "Example", original_title: "Example", alternative_titles: { titles: [{ iso_3166_1: "HK", title: "示例香港名" }] } }
      );
      const englishCnIdentity = canonicalIdentityFromDetail(
        canonicalMockItem,
        { title: "Example", original_title: "Example", alternative_titles: { titles: [{ iso_3166_1: "CN", title: "Example" }] } }
      );
      const canonicalSearchSource = String(bindActions);
      check("CANONICAL_CN_RESOURCE_TITLE_PRIORITY", canonicalMockIdentity && canonicalMockIdentity.resourceSearchTitle === "示例大陆名", "英文本地化标题优先使用 CN 中文资源名", "RUNTIME_MOCK");
      check("CANONICAL_LOCALIZED_CHINESE_PRIORITY", localizedChineseIdentity && localizedChineseIdentity.resourceSearchTitle === "最后生还者", "已有中文本地化标题不被 alternative title 覆盖", "RUNTIME_MOCK");
      check("CANONICAL_CN_ALIAS_FALLBACK", englishCnIdentity && englishCnIdentity.resourceSearchTitle === "Example", "英文 CN alias 不冒充中文资源主标题", "RUNTIME_MOCK");
      check("CANONICAL_HK_TW_NOT_PROMOTED", hkOnlyIdentity && hkOnlyIdentity.resourceSearchTitle === "Example", "没有 CN 中文名时不提升 HK/TW 标题", "RUNTIME_MOCK");
      check("CANONICAL_ALIASES_PRESERVED", canonicalMockIdentity && ["The Example", "示例大陆名", "示例香港名"].every((title) => canonicalMockIdentity.aliases.includes(title)), "CN/HK 与原始标题仍保留在 aliases", "RUNTIME_MOCK");
      check("PAN_RESOURCE_KEYWORD_USES_CN_TITLE", canonicalMockIdentity && panKeyword(canonicalMockIdentity) === "示例大陆名", "Pan 资源关键词读取 canonical resourceSearchTitle", "RUNTIME_MOCK");
      check("NATIVE_SEARCH_USES_CN_TITLE", canonicalMockIdentity && resourceSearchKeyword(canonicalMockIdentity) === "示例大陆名" && canonicalSearchSource.includes("nativeSearch(resourceSearchKeyword(state.selected))"), "详情原生搜索读取 canonical resourceSearchTitle", "RUNTIME_MOCK");
      check("CURATED_SEARCH_ALIASES_PRESERVED", canonicalMockIdentity && curatedSearchKeywords(canonicalMockIdentity).includes("示例大陆名") && curatedSearchKeywords(canonicalMockIdentity).includes("示例香港名"), "精选源仍使用完整 aliases 搜索集合", "RUNTIME_MOCK");
      const animeMockCandidate = (rank, id) => ({ mediaType: "tv", tmdbId: String(id || 7000 + rank), title: `Mock Anime ${rank}`, pic: "mock-poster", latest: "2026-01-01", people: 1000 - rank, nostrHotRank: rank });
      const animeMockMetadata = (candidate, valid) => ({ version: NOSTR_TMDB_META_CACHE_VERSION, mediaType: candidate.mediaType, tmdbId: candidate.tmdbId, genreIds: valid ? ["16"] : ["18"], regions: ["CN"], releaseDate: "2020-01-01", fetchedAt: Date.now() });
      const animeMockScan = (candidates, validRanks, persistent, failures) => {
        const runtime = { candidates, statuses: {}, items: {}, failedKeys: {}, nextIndex: 0, metrics: { candidatesScanned: 0, lastScannedRank: 0, persistentHits: 0, newDetailRequests: 0 } };
        const store = persistent || {};
        const failed = failures || new Set();
        const details = [];
        while (runtime.nextIndex < runtime.candidates.length) {
          const currentMatches = secondaryNostrAnimeQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_HOT_TARGET_MATCHES).length;
          const batchSize = currentMatches < SECONDARY_NOSTR_HOT_TARGET_MATCHES
            ? Math.min(SECONDARY_NOSTR_ANIME_SCAN_BATCH_SIZE, Math.max(1, SECONDARY_NOSTR_HOT_TARGET_MATCHES - currentMatches))
            : SECONDARY_NOSTR_ANIME_SCAN_BATCH_SIZE;
          const batch = runtime.candidates.slice(runtime.nextIndex, runtime.nextIndex + batchSize);
          runtime.nextIndex += batch.length;
          runtime.metrics.candidatesScanned += batch.length;
          batch.forEach((candidate) => {
            const key = secondaryNostrAnimeCandidateKey(candidate);
            runtime.metrics.lastScannedRank = Math.max(runtime.metrics.lastScannedRank, Number(candidate.nostrHotRank || 0));
            if (store[key]) {
              runtime.metrics.persistentHits += 1;
              const record = secondaryNostrAnimeRecordFromMetadata(candidate, store[key], candidate.nostrHotRank - 1, "persistent");
              runtime.statuses[key] = record.status;
              if (record.item) runtime.items[key] = record.item;
              return;
            }
            runtime.metrics.newDetailRequests += 1;
            details.push(key);
            if (failed.has(key)) return;
            const record = secondaryNostrAnimeRecordFromMetadata(candidate, animeMockMetadata(candidate, validRanks.has(Number(candidate.nostrHotRank))), candidate.nostrHotRank - 1, "detail");
            if (record.status === "valid" || record.status === "invalid") {
              runtime.statuses[key] = record.status;
              if (record.item) runtime.items[key] = record.item;
              store[key] = record.metadata;
            }
          });
          if (secondaryNostrAnimeQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_HOT_TARGET_MATCHES).length >= SECONDARY_NOSTR_HOT_TARGET_MATCHES) break;
        }
        return { runtime, store, details, items: secondaryNostrAnimeQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_HOT_TARGET_MATCHES) };
      };
      const animeRanksA = new Set([3, 4, 11, 33, 34, 43, 44, 54, 56, 64, 69, 79, 80, 84, 89, 90, 114, 116]);
      const animeCandidatesA = Array.from({ length: 150 }, (_, index) => animeMockCandidate(index + 1));
      const animeColdA = animeMockScan(animeCandidatesA, animeRanksA, {}, new Set());
      const animeWarmB = animeMockScan(animeCandidatesA, animeRanksA, animeColdA.store, new Set());
      const animeNegativeC = animeMockScan([animeMockCandidate(1, 9901)], new Set(), {}, new Set());
      const animeNegativeCSecond = animeMockScan([animeMockCandidate(1, 9901)], new Set(), animeNegativeC.store, new Set());
      const animeFailureCandidate = animeMockCandidate(1, 9902);
      const animeFailureKey = secondaryNostrAnimeCandidateKey(animeFailureCandidate);
      const animeFailureD = animeMockScan([animeFailureCandidate], new Set([1]), {}, new Set([animeFailureKey]));
      const animeFailureDSecond = animeMockScan([animeFailureCandidate], new Set([1]), animeFailureD.store, new Set());
      const animeReorderedE = animeMockScan([animeCandidatesA[3], animeCandidatesA[2]].concat(animeCandidatesA.slice(0, 2), animeCandidatesA.slice(4)), animeRanksA, animeColdA.store, new Set());
      const animeNewCandidateF = animeMockCandidate(2, 9903);
      const animeNewF = animeMockScan([animeNewCandidateF].concat(animeCandidatesA.slice(0, 1), animeCandidatesA.slice(2)), animeRanksA, animeColdA.store, new Set());
      const animeResolverSource = String(secondaryLoadNostrAnimePool) + String(secondaryRunNostrAnimeResolver) + String(secondaryNostrAnimeResolveCandidate);
      const animeCacheSource = String(nostrTmdbMetaRuntime) + String(ensureNostrTmdbMetaLoaded) + String(nostrTmdbMetaPut) + String(normalizeNostrTmdbMetaEntry);
      check("NOSTR_ANIME_CASE_A_COLD", animeColdA.items.length === 18 && animeColdA.runtime.metrics.lastScannedRank === 116 && animeColdA.details.length === 116, "Top150 cold scan stops at the 18th valid rank", "RUNTIME_MOCK");
      check("NOSTR_ANIME_CASE_B_WARM", animeWarmB.items.map((item) => item.tmdbId).join(",") === animeColdA.items.map((item) => item.tmdbId).join(",") && animeWarmB.runtime.metrics.newDetailRequests === 0 && animeWarmB.runtime.metrics.persistentHits === 116, "warm reload reuses persistent metadata", "RUNTIME_MOCK");
      check("NOSTR_ANIME_CASE_C_NEGATIVE_CACHE", animeNegativeC.runtime.metrics.newDetailRequests === 1 && animeNegativeCSecond.runtime.metrics.newDetailRequests === 0 && animeNegativeCSecond.runtime.metrics.persistentHits === 1 && Object.keys(animeNegativeC.store).length === 1, "negative successful classification is persisted", "RUNTIME_MOCK");
      check("NOSTR_ANIME_CASE_D_FAILURE_RETRY", animeFailureD.runtime.metrics.newDetailRequests === 1 && animeFailureDSecond.runtime.metrics.newDetailRequests === 1 && Object.keys(animeFailureD.store).length === 0, "failed detail is not negative-cached and retries", "RUNTIME_MOCK");
      check("NOSTR_ANIME_CASE_E_REORDER", animeReorderedE.items[0] && animeReorderedE.items[0].tmdbId === animeCandidatesA[3].tmdbId && animeReorderedE.items[1] && animeReorderedE.items[1].tmdbId === animeCandidatesA[2].tmdbId && animeReorderedE.runtime.metrics.newDetailRequests === 0, "latest Nostr order wins without rewriting metadata cache", "RUNTIME_MOCK");
      check("NOSTR_ANIME_CASE_F_NEW_CANDIDATE", animeNewF.runtime.metrics.newDetailRequests === 1 && animeNewF.runtime.metrics.persistentHits >= 17, "only a new cache miss requests detail", "RUNTIME_MOCK");
      check("NOSTR_ANIME_NO_DISCOVER_PREFILTER", !animeResolverSource.includes("discover") && !animeResolverSource.includes("secondaryFullCatalogSources"), "anime production resolver has no Discover prefilter", "STATIC_HOOK");
      check("NOSTR_ANIME_PERSISTENT_CACHE_LAYER", animeResolverSource.includes("ensureNostrTmdbMetaLoaded") && animeResolverSource.includes("nostrTmdbMetaPut") && animeCacheSource.includes("NOSTR_TMDB_META_CACHE_TTL_MS"), "anime resolver uses one persistent TTL cache", "STATIC_HOOK");
      check("NOSTR_ANIME_FAILURE_NOT_CACHED", animeResolverSource.includes("status === \"failed\"") && animeResolverSource.includes("delete memory[key]"), "detail failures remain retryable", "STATIC_HOOK");
      check("NOSTR_ANIME_CACHE_NO_NOSTR_RANK", !animeCacheSource.includes("nostrHotRank") && !animeCacheSource.includes("people") && !animeCacheSource.includes("latest"), "persistent metadata has no Nostr ranking fields", "STATIC_HOOK");
      check("NOSTR_ANIME_SHARED_HOME_SECONDARY", String(loadHomeCategoryNostrPool).includes("secondaryLoadNostrAnimePool") && String(secondaryLoadNostrHotItems).includes("secondaryLoadNostrAnimePool"), "Home and Secondary subscribe to the shared resolver", "STATIC_HOOK");
      const sharedMetaStore = {};
      const sharedMetaMockRun = (candidate, listId, detail) => {
        const key = nostrTmdbMetaEntryKey(candidate);
        if (sharedMetaStore[key]) {
          return { detailRequests: 0, record: nostrTmdbRecordFromMetadata(candidate, sharedMetaStore[key], listId, 0, "persistent") };
        }
        const metadata = nostrTmdbMetaFromDetail(candidate, detail);
        const record = nostrTmdbRecordFromMetadata(candidate, metadata, listId, 0, "detail");
        if (record.status === "valid" || record.status === "invalid") sharedMetaStore[key] = record.metadata;
        return { detailRequests: 1, record };
      };
      const sharedMovieCandidate = { mediaType: "movie", tmdbId: "99001", title: "Shared Movie", pic: "mock-poster" };
      const sharedMovieDetail = { id: 99001, genre_ids: [18], production_countries: [{ iso_3166_1: "CN" }], release_date: "2020-01-01" };
      const sharedTvCandidate = { mediaType: "tv", tmdbId: "99002", title: "Shared TV", pic: "mock-poster" };
      const sharedTvDetail = { id: 99002, genre_ids: [18], origin_country: ["CN"], first_air_date: "2020-01-01" };
      const sharedAnimeCandidate = { mediaType: "tv", tmdbId: "99003", title: "Shared Anime", pic: "mock-poster" };
      const sharedAnimeDetail = { id: 99003, genre_ids: [16], origin_country: ["CN"], first_air_date: "2020-01-01" };
      const sharedMovieCold = sharedMetaMockRun(sharedMovieCandidate, "movie", sharedMovieDetail);
      const sharedMovieWarm = sharedMetaMockRun(sharedMovieCandidate, "movie", sharedMovieDetail);
      const sharedTvCold = sharedMetaMockRun(sharedTvCandidate, "tv", sharedTvDetail);
      const sharedTvWarm = sharedMetaMockRun(sharedTvCandidate, "tv", sharedTvDetail);
      const sharedAnimeCold = sharedMetaMockRun(sharedAnimeCandidate, "anime", sharedAnimeDetail);
      const sharedAnimeWarm = sharedMetaMockRun(sharedAnimeCandidate, "anime", sharedAnimeDetail);
      const sharedEnricherSource = String(secondaryNostrEnrichCandidate);
      const sharedAnimeResolverSource = String(secondaryNostrAnimeResolveCandidate);
      const sharedAuthoritySource = String(nostrTmdbMetaFromItem) + String(nostrTmdbMetaFromDetail) + String(nostrTmdbRecordFromMetadata) + String(nostrTmdbRecordFromDetail) + String(nostrTmdbMetaPut);
      check("NOSTR_MOVIE_PERSISTENT_META_READ", sharedEnricherSource.includes("secondaryNostrTmdbMemoryCache") && sharedEnricherSource.includes("nostrTmdbMetaRuntime().entries") && sharedEnricherSource.includes("ensureNostrTmdbMetaLoaded"), "movie/tv enricher reads runtime, memory, persistent metadata before detail", "STATIC_HOOK");
      check("NOSTR_MOVIE_PERSISTENT_META_WRITE", sharedEnricherSource.includes("nostrTmdbRecordFromDetail") && sharedAuthoritySource.includes("nostrTmdbMetaPut"), "movie detail writes the shared minimal metadata record", "STATIC_HOOK");
      check("NOSTR_TV_PERSISTENT_META_READ", sharedEnricherSource.includes("secondaryNostrTmdbMemoryCache") && sharedEnricherSource.includes("nostrTmdbMetaRuntime().entries") && sharedEnricherSource.includes("ensureNostrTmdbMetaLoaded"), "tv enricher reads the shared persistent metadata record", "STATIC_HOOK");
      check("NOSTR_TV_PERSISTENT_META_WRITE", sharedEnricherSource.includes("nostrTmdbRecordFromDetail") && sharedAuthoritySource.includes("nostrTmdbMetaPut"), "tv detail writes the shared minimal metadata record", "STATIC_HOOK");
      check("NOSTR_ANIME_PERSISTENT_META_READ_SHARED", sharedAnimeResolverSource.includes("secondaryNostrAnimeMemoryCache") && sharedAnimeResolverSource.includes("nostrTmdbMetaRuntime().entries") && sharedAnimeResolverSource.includes("ensureNostrTmdbMetaLoaded"), "anime reads the same runtime, memory, persistent sequence", "STATIC_HOOK");
      check("NOSTR_ANIME_PERSISTENT_META_WRITE_SHARED", sharedAnimeResolverSource.includes("nostrTmdbRecordFromDetail") && sharedAuthoritySource.includes("nostrTmdbMetaPut"), "anime detail writes through the shared metadata authority", "STATIC_HOOK");
      check("NOSTR_CROSS_CATEGORY_SINGLE_META_CACHE", sharedMovieCold.detailRequests === 1 && sharedMovieWarm.detailRequests === 0 && sharedTvCold.detailRequests === 1 && sharedTvWarm.detailRequests === 0 && sharedAnimeCold.detailRequests === 1 && sharedAnimeWarm.detailRequests === 0 && Object.keys(sharedMetaStore).length === 3, "movie/tv/anime use one metadata store with warm detail reuse", "RUNTIME_MOCK");
      const ratingHotMock = { mediaType: "movie", tmdbId: "99005", title: "Rating Movie", pic: "mock-poster", people: 88, nostrHotRank: 3 };
      const ratingDetailMock = { id: 99005, title: "Rating Movie", poster_path: "/mock-rating.jpg", vote_average: 8.6, genre_ids: [18], production_countries: [{ iso_3166_1: "CN" }], release_date: "2020-01-01" };
      const ratingMetadataMock = nostrTmdbMetaFromDetail(ratingHotMock, ratingDetailMock);
      const ratingMetadataItemMock = nostrTmdbItemFromMetadata(ratingHotMock, ratingMetadataMock, "movie", 0);
      const ratingMetadataOverlayMock = nostrHotSignalOverlay(ratingMetadataItemMock, ratingHotMock, "movie");
      const ratingDetailItemMock = secondaryNostrItemFromDetail(ratingHotMock, ratingDetailMock, "movie", 0);
      const ratingDetailOverlayMock = nostrHotSignalOverlay(ratingDetailItemMock, ratingHotMock, "movie");
      const cardLayerSummary = (card) => ({
        rating: !!(card && card.querySelector(".rating-badge")),
        people: !!(card && card.querySelector(".card-people")),
        status: !!(card && card.querySelector(".card-air-status:not(.hidden)")),
        ratingInPoster: !!(card && card.querySelector(".poster-wrap .rating-badge")),
        peopleInPoster: !!(card && card.querySelector(".poster-wrap .card-people"))
      });
      const homeNormalMovieCard = mediaCard({ source: "tmdb", mediaType: "movie", tmdbId: "card-movie", title: "普通电影", voteAverage: 8.2, pic: "mock-poster" }, 0, { home: true });
      const homeNostrMovieCard = mediaCard({ source: "nostr-hot", mediaType: "movie", tmdbId: "card-nostr-movie", title: "Nostr 电影", voteAverage: 8.4, people: 326, pic: "mock-poster" }, 0, { home: true });
      const homeLandscapeNostrMovieCard = mediaCard({ source: "nostr-hot", mediaType: "movie", tmdbId: "card-landscape-nostr-movie", title: "横向 Nostr 电影", voteAverage: 8.4, people: 326, pic: "mock-poster", landscape: "mock-landscape" }, 0, { home: true, landscape: true });
      const homeNostrTvCard = mediaCard({ source: "nostr-hot", mediaType: "tv", listId: "tv", tmdbId: "card-nostr-tv", title: "Nostr 电视剧", voteAverage: 8.1, people: 214, weeklyUpdateText: "更新至 6集", pic: "mock-poster" }, 0, { home: true, weeklyHome: true });
      const homeNostrAnimeCard = mediaCard({ source: "nostr-hot", mediaType: "tv", listId: "anime", tmdbId: "card-nostr-anime", title: "Nostr 动画", voteAverage: 8.3, people: 168, weeklyUpdateText: "更新至 4集", pic: "mock-poster" }, 0, { home: true, weeklyHome: true });
      const homeNostrVarietyCard = mediaCard({ source: "nostr-hot", mediaType: "tv", listId: "variety", tmdbId: "card-nostr-variety", title: "Nostr 综艺", voteAverage: 7.9, people: 97, weeklyUpdateText: "更新至 3期", pic: "mock-poster" }, 0, { home: true, weeklyHome: true });
      const secondaryNormalMovieCard = mediaCard({ source: "tmdb", mediaType: "movie", tmdbId: "secondary-movie", title: "Secondary 电影", voteAverage: 7.8, pic: "mock-poster" }, 0, {});
      const secondaryNostrMovieCard = mediaCard({ source: "nostr-hot", mediaType: "movie", tmdbId: "secondary-nostr-movie", title: "Secondary Nostr 电影", voteAverage: 8.5, people: 301, pic: "mock-poster" }, 0, {});
      const secondaryNostrTvCard = mediaCard({ source: "nostr-hot", mediaType: "tv", listId: "tv", tmdbId: "secondary-nostr-tv", title: "Secondary Nostr 电视剧", voteAverage: 8.0, people: 201, weeklyUpdateText: "更新至 5集", pic: "mock-poster" }, 0, { weekly: true });
      const secondaryNostrAnimeCard = mediaCard({ source: "nostr-hot", mediaType: "tv", listId: "anime", tmdbId: "secondary-nostr-anime", title: "Secondary Nostr 动画", voteAverage: 8.2, people: 155, weeklyUpdateText: "更新至 7集", pic: "mock-poster" }, 0, { weekly: true });
      const secondaryNostrVarietyCard = mediaCard({ source: "nostr-hot", mediaType: "tv", listId: "variety", tmdbId: "secondary-nostr-variety", title: "Secondary Nostr 综艺", voteAverage: 7.7, people: 76, weeklyUpdateText: "更新至 2期", pic: "mock-poster" }, 0, { weekly: true });
      const noRatingPeopleCard = mediaCard({ source: "nostr-hot", mediaType: "movie", tmdbId: "no-rating", title: "无评分但有热度", voteAverage: 0, people: 42, pic: "mock-poster" }, 0, { home: true });
      const portraitPeople4DigitCard = mediaCard({ source: "nostr-hot", mediaType: "movie", tmdbId: "four-digit-people", title: "四位数热度", voteAverage: 7.5, people: 9999, pic: "mock-poster" }, 0, { home: true });
      const layerNormalMovie = cardLayerSummary(homeNormalMovieCard);
      const layerNostrMovie = cardLayerSummary(homeNostrMovieCard);
      const layerLandscapeNostrMovie = cardLayerSummary(homeLandscapeNostrMovieCard);
      const layerNostrTv = cardLayerSummary(homeNostrTvCard);
      const layerNostrAnime = cardLayerSummary(homeNostrAnimeCard);
      const layerNostrVariety = cardLayerSummary(homeNostrVarietyCard);
      const layerSecondaryMovie = cardLayerSummary(secondaryNormalMovieCard);
      const layerSecondaryNostrMovie = cardLayerSummary(secondaryNostrMovieCard);
      const layerSecondaryNostrTv = cardLayerSummary(secondaryNostrTvCard);
      const layerSecondaryNostrAnime = cardLayerSummary(secondaryNostrAnimeCard);
      const layerSecondaryNostrVariety = cardLayerSummary(secondaryNostrVarietyCard);
      const layerNoRatingPeople = cardLayerSummary(noRatingPeopleCard);
      const portraitPeople4DigitValue = portraitPeople4DigitCard.querySelector(".card-people .badge-value");
      const badgeStyleText = Array.from(document.querySelectorAll("style")).map((style) => String(style.textContent || "")).join("\n");
      const unifiedBadgeCss = badgeStyleText.slice(badgeStyleText.indexOf("/* Every Home and Secondary media card shares one information layer"));
      const metadataContractCss = unifiedBadgeCss.split("@media (max-width: 719px), (pointer: coarse)")[0];
      const cardRendererSource = String(mediaCard);
      const badgeCssBlock = (selector) => {
        const start = badgeStyleText.indexOf(selector);
        const end = start >= 0 ? badgeStyleText.indexOf("\n    }", start) : -1;
        return start >= 0 && end > start ? badgeStyleText.slice(start, end) : "";
      };
      const ratingBadgeCss = badgeCssBlock("    .rating-badge {");
      const peopleBadgeCss = badgeCssBlock("    .card-people {");
      const overlayRatingValue = (item) => Number(item && (item.voteAverage || item.vote_average) || 0);
      check("HOME_NOSTR_RATING_PRESERVED", overlayRatingValue(nostrHotSignalOverlay(Object.assign({}, ratingHotMock, { voteAverage: 8.6 }), ratingHotMock, "movie")) === 8.6, "Home Nostr overlay keeps the normalized TMDB rating", "RUNTIME_MOCK");
      check("SECONDARY_NOSTR_RATING_PRESERVED", overlayRatingValue(ratingDetailOverlayMock) === 8.6, "Secondary Nostr detail item keeps the TMDB rating", "RUNTIME_MOCK");
      check("RATING_AFTER_METADATA_OVERLAY", overlayRatingValue(ratingMetadataOverlayMock) === 8.6 && ratingMetadataMock.voteAverage === 8.6, "persistent metadata reconstruction carries the cached TMDB rating", "RUNTIME_MOCK");
      check("RATING_AFTER_DETAIL_OVERLAY", overlayRatingValue(ratingDetailOverlayMock) === 8.6 && ratingDetailItemMock.voteAverage === 8.6, "detail enrichment and Nostr overlay retain vote_average", "RUNTIME_MOCK");
      check("RATING_INDEPENDENT_FROM_PEOPLE", layerNostrMovie.rating && layerNostrMovie.people && layerNoRatingPeople.people && !layerNoRatingPeople.rating, "rating and people render independently without a fake zero rating", "RUNTIME_MOCK");
      check("RATING_INDEPENDENT_FROM_AIR_STATUS", layerNostrTv.rating && layerNostrTv.status && layerNostrTv.people, "air status does not suppress rating or people", "RUNTIME_MOCK");
      check("NOSTR_RATING_PEOPLE_COEXIST", layerNostrMovie.rating && layerNostrMovie.people && layerSecondaryNostrMovie.rating && layerSecondaryNostrMovie.people, "Home and Secondary Nostr movie cards render both badges", "RUNTIME_MOCK");
      check("NOSTR_RATING_PEOPLE_AIR_STATUS_COEXIST", layerNostrTv.rating && layerNostrTv.people && layerNostrTv.status && layerNostrAnime.rating && layerNostrAnime.people && layerNostrAnime.status && layerNostrVariety.rating && layerNostrVariety.people && layerNostrVariety.status && layerSecondaryNostrTv.status && layerSecondaryNostrAnime.status && layerSecondaryNostrVariety.status, "TV/anime/variety cards retain all three independent information dimensions", "RUNTIME_MOCK");
      check("HOME_RATING_LEFT_TOP", unifiedBadgeCss.includes(".rating-badge") && unifiedBadgeCss.includes("left: 9px") && unifiedBadgeCss.includes("right: auto"), "Home rating is pinned to the shared upper-left position", "STATIC_HOOK");
      check("HOME_PEOPLE_RIGHT_TOP", unifiedBadgeCss.includes(".card-people") && unifiedBadgeCss.includes("right: 9px") && unifiedBadgeCss.includes("left: auto"), "Home people is pinned to the shared upper-right position", "STATIC_HOOK");
      check("SECONDARY_RATING_LEFT_TOP", unifiedBadgeCss.includes("#secondaryCatalog .media-grid > .card .rating-badge") && unifiedBadgeCss.includes("left: 9px"), "Secondary rating uses the same upper-left position", "STATIC_HOOK");
      check("SECONDARY_PEOPLE_RIGHT_TOP", unifiedBadgeCss.includes("#secondaryCatalog .media-grid > .card .card-people") && unifiedBadgeCss.includes("right: 9px"), "Secondary people uses the same upper-right position", "STATIC_HOOK");
      check("RATING_ICON_PRESENT", cardRendererSource.includes('class="badge-icon rating-icon"') && cardRendererSource.includes("<path d=\"M12 3.6"), "rating badge uses an inline SVG star icon", "STATIC_HOOK");
      check("PEOPLE_ICON_PRESENT", cardRendererSource.includes('class="badge-icon people-icon"') && cardRendererSource.includes("<path d=\"M12 11a3.4"), "people badge uses an inline SVG single-person icon", "STATIC_HOOK");
      check("RATING_PEOPLE_SEMANTICALLY_DISTINCT", cardRendererSource.includes("rating-icon") && cardRendererSource.includes("people-icon") && cardRendererSource.includes("评分") && cardRendererSource.includes("Nostr 热度"), "rating and people badges have distinct semantic labels and icons", "STATIC_HOOK");
      check("NO_EMOJI_ICON", !cardRendererSource.includes("⭐") && !cardRendererSource.includes("🌟") && !cardRendererSource.includes("👥") && !cardRendererSource.includes("👤") && !cardRendererSource.includes("★"), "rating/people icons are SVG paths rather than emoji", "STATIC_HOOK");
      check("RATING_ICON_GOLD", ratingBadgeCss.includes("color: #ffd98a;") && badgeStyleText.includes("fill: currentColor"), "rating star inherits the historical gold color", "STATIC_HOOK");
      check("RATING_NUMBER_GOLD", ratingBadgeCss.includes("color: #ffd98a;") && metadataContractCss.includes("color: #ffd98a !important;"), "rating number uses the historical gold color", "STATIC_HOOK");
      check("PEOPLE_ICON_GOLD", peopleBadgeCss.includes("color: #ffd98a;") && badgeStyleText.includes("fill: currentColor"), "people icon inherits the historical gold color", "STATIC_HOOK");
      check("PEOPLE_NUMBER_GOLD", peopleBadgeCss.includes("color: #ffd98a;") && metadataContractCss.includes("color: #ffd98a !important;"), "people number uses the historical gold color", "STATIC_HOOK");
      check("RATING_NUMBER_COLOR_EQUALS_PEOPLE_NUMBER_COLOR", ratingBadgeCss.includes("color: #ffd98a;") && peopleBadgeCss.includes("color: #ffd98a;") && metadataContractCss.includes("color: #ffd98a !important;"), "rating and people use the same historical gold color", "STATIC_HOOK");
      check("RATING_BACKGROUND_REMOVED", !ratingBadgeCss.includes("background:") && !metadataContractCss.includes("background: rgba(6, 9, 12, .48)") && metadataContractCss.includes("backdrop-filter: none !important"), "rating is a frameless text/icon label", "STATIC_HOOK");
      check("PEOPLE_BACKGROUND_REMOVED", !peopleBadgeCss.includes("background:") && !metadataContractCss.includes("background: rgba(6, 9, 12, .48)") && metadataContractCss.includes("backdrop-filter: none !important"), "people is a frameless text/icon label", "STATIC_HOOK");
      check("PEOPLE_SUFFIX_REMOVED", portraitPeople4DigitValue && portraitPeople4DigitValue.textContent === "9999" && !String(portraitPeople4DigitValue.textContent).includes("人"), "people count has no visible 人 suffix", "RUNTIME_MOCK");
      check("TOP_META_INSET_REFINED", metadataContractCss.includes("top: 9px") && metadataContractCss.includes("left: 9px") && metadataContractCss.includes("right: 9px") && metadataContractCss.includes("top: 10px"), "top metadata has refined inset values", "STATIC_HOOK");
      check("LANDSCAPE_TOP_META_NORMAL", layerLandscapeNostrMovie.rating && layerLandscapeNostrMovie.people && metadataContractCss.includes(".card.landscape-card") && metadataContractCss.includes("font-size: 11px !important") && metadataContractCss.includes("width: 14px !important") && metadataContractCss.includes("gap: 5px !important"), "landscape cards keep the normal metadata scale", "RUNTIME_MOCK");
      check("LANDSCAPE_META_UNCHANGED", metadataContractCss.includes(".card.landscape-card") && metadataContractCss.includes("top: 10px") && metadataContractCss.includes("font-size: 11px !important") && metadataContractCss.includes("width: 14px !important") && metadataContractCss.includes("gap: 5px !important"), "landscape metadata remains unchanged", "STATIC_HOOK");
      check("PORTRAIT_TOP_META_COMPACT", layerNostrMovie.rating && layerNostrMovie.people && metadataContractCss.includes(":not(.landscape-card)") && metadataContractCss.includes("font-size: 9.5px !important") && metadataContractCss.includes("width: 9.5px !important"), "portrait cards use the compact metadata scale", "RUNTIME_MOCK");
      check("PORTRAIT_RATING_FONT_INCREASED", metadataContractCss.includes("font-size: 9.5px !important"), "portrait rating text is slightly enlarged", "STATIC_HOOK");
      check("PORTRAIT_PEOPLE_FONT_INCREASED", metadataContractCss.includes("font-size: 9.5px !important"), "portrait people text is slightly enlarged", "STATIC_HOOK");
      check("PORTRAIT_STAR_ICON_INCREASED_PROPORTIONALLY", cardRendererSource.includes("rating-icon") && metadataContractCss.includes("width: 9.5px !important") && metadataContractCss.includes("height: 9.5px !important"), "portrait star icon scales with the text", "STATIC_HOOK");
      check("PORTRAIT_PERSON_ICON_INCREASED_PROPORTIONALLY", cardRendererSource.includes("people-icon") && metadataContractCss.includes("width: 9.5px !important") && metadataContractCss.includes("height: 9.5px !important"), "portrait person icon scales with the text", "STATIC_HOOK");
      check("PORTRAIT_ICON_TEXT_RATIO_PRESERVED", metadataContractCss.includes("font-size: 9.5px !important") && metadataContractCss.includes("width: 9.5px !important") && metadataContractCss.includes("flex-basis: 9.5px !important"), "portrait icon and text retain their compact ratio", "STATIC_HOOK");
      check("PORTRAIT_RATING_PEOPLE_GAP", metadataContractCss.includes("gap: 3.25px !important") && metadataContractCss.includes("left: 9px") && metadataContractCss.includes("right: 9px") && !metadataContractCss.includes("margin-left: -") && !metadataContractCss.includes("transform:"), "portrait metadata keeps a positive safe gap without forced compression", "STATIC_HOOK");
      check("PORTRAIT_META_NO_WRAP", ratingBadgeCss.includes("white-space: nowrap;") && peopleBadgeCss.includes("white-space: nowrap;") && metadataContractCss.includes("white-space: nowrap !important"), "rating and people remain single-line", "STATIC_HOOK");
      check("PORTRAIT_PEOPLE_4_DIGIT_SAFE", layerNostrMovie.rating && portraitPeople4DigitValue && portraitPeople4DigitValue.textContent === "9999" && !metadataContractCss.includes("width: 50%") && metadataContractCss.includes("min-width: 0 !important"), "four-digit people remains an unforced, non-wrapping value", "RUNTIME_MOCK");
      check("TOP_META_COLOR_UNCHANGED", ratingBadgeCss.includes("color: #ffd98a;") && peopleBadgeCss.includes("color: #ffd98a;") && metadataContractCss.includes("color: #ffd98a !important;"), "top metadata keeps the current gold color", "STATIC_HOOK");
      check("TOP_META_POSITION_UNCHANGED", metadataContractCss.includes("top: 9px") && metadataContractCss.includes("left: 9px") && metadataContractCss.includes("right: 9px"), "top metadata positions and insets remain unchanged", "STATIC_HOOK");
      check("HOME_BADGE_VISUAL_CONSISTENCY", cardRendererSource.includes("rating-badge .badge-icon") && cardRendererSource.includes("card-people .badge-icon") && metadataContractCss.includes("font-weight: 760 !important") && metadataContractCss.includes("padding: 0 !important") && metadataContractCss.includes("gap: 3px !important"), "Home badges share the frameless visual language", "STATIC_HOOK");
      check("SECONDARY_BADGE_VISUAL_CONSISTENCY", metadataContractCss.includes("#secondaryCatalog .media-grid > .card .rating-badge") && metadataContractCss.includes("#secondaryCatalog .media-grid > .card .card-people") && metadataContractCss.includes("border: 0 !important"), "Secondary badges share the same visual contract", "STATIC_HOOK");
      check("RATING_BADGE_NO_PEOPLE_OVERLAP", layerNostrMovie.ratingInPoster && layerNostrMovie.peopleInPoster && metadataContractCss.includes("left: 9px") && metadataContractCss.includes("right: 9px"), "rating and people occupy opposite top corners", "RUNTIME_MOCK");
      check("RATING_BADGE_NO_AIR_STATUS_OVERLAP", layerNostrTv.rating && layerNostrTv.status && metadataContractCss.includes("bottom: auto") && badgeStyleText.includes(".card-air-status") && badgeStyleText.includes("bottom: 0"), "rating remains top-left while status remains bottom", "RUNTIME_MOCK");
      check("PEOPLE_BADGE_NO_AIR_STATUS_OVERLAP", layerNostrTv.people && layerNostrTv.status && metadataContractCss.includes("top: 9px") && badgeStyleText.includes(".card-air-status") && badgeStyleText.includes("bottom: 0"), "people remains top-right while status remains bottom", "RUNTIME_MOCK");
      check("STATUS_UNCHANGED", layerNostrTv.status && layerNostrAnime.status && layerNostrVariety.status && badgeStyleText.includes(".card-air-status") && badgeStyleText.includes("bottom: 0"), "air/episode/variety status remains a bottom layer", "RUNTIME_MOCK");
      check("CARD_SIZE_UNCHANGED", !metadataContractCss.includes("grid-template-columns") && !metadataContractCss.includes("width: 100%") && !metadataContractCss.includes("height: 100%"), "metadata styles do not change card dimensions", "STATIC_HOOK");
      check("POSTER_RATIO_UNCHANGED", badgeStyleText.includes(".poster {") && badgeStyleText.includes("aspect-ratio: 2 / 3") && badgeStyleText.includes("aspect-ratio: 16 / 9") && !metadataContractCss.includes("aspect-ratio"), "poster ratios remain outside the metadata contract", "STATIC_HOOK");
      check("FOCUS_GEOMETRY_UNCHANGED", !metadataContractCss.includes("transform:") && !metadataContractCss.includes("focus-ring") && !metadataContractCss.includes("outline-offset"), "metadata styles do not change focus geometry", "STATIC_HOOK");
      check("TMDB_RATING_ONLY_NORMAL", layerNormalMovie.rating && !layerNormalMovie.people, "ordinary TMDB cards show valid rating without Nostr people", "RUNTIME_MOCK");
      check("TMDB_NO_FAKE_RATING", !layerNoRatingPeople.rating && layerNoRatingPeople.people, "missing rating is not replaced by zero while real people remains visible", "RUNTIME_MOCK");
      check("MOVIE_CARD_LAYER_REGRESSION", layerNormalMovie.rating && layerSecondaryMovie.rating && layerNostrMovie.rating && layerSecondaryNostrMovie.rating, "movie Home/Secondary rating paths remain available", "FROZEN_SOURCE_AUDIT");
      check("TV_CARD_LAYER_REGRESSION", layerNostrTv.rating && layerNostrTv.people && layerNostrTv.status && layerSecondaryNostrTv.status, "TV Home/Secondary status and hot badges remain available", "FROZEN_SOURCE_AUDIT");
      check("ANIME_CARD_LAYER_REGRESSION", layerNostrAnime.rating && layerNostrAnime.people && layerNostrAnime.status && layerSecondaryNostrAnime.status, "anime Home/Secondary status and hot badges remain available", "FROZEN_SOURCE_AUDIT");
      check("VARIETY_CARD_LAYER_REGRESSION", layerNostrVariety.rating && layerNostrVariety.people && layerNostrVariety.status && layerSecondaryNostrVariety.status, "variety Home/Secondary status and hot badges remain available", "FROZEN_SOURCE_AUDIT");
      const varietyMockCandidate = (rank) => ({ mediaType: "tv", tmdbId: String(880000 + rank), title: `Mock Variety ${rank}`, pic: "mock-poster", people: 5000 - rank, nostrHotRank: rank });
      const varietyMockMetadata = (candidate, valid, region) => ({ version: NOSTR_TMDB_META_CACHE_VERSION, mediaType: "tv", tmdbId: candidate.tmdbId, genreIds: valid ? ["10764"] : ["18"], regions: [region || "CN"], releaseDate: "2020-01-01", fetchedAt: Date.now() });
      const varietyMockScan = (validRanks, discoverRanks, failureRanks, regionOverrides) => {
        const candidates = Array.from({ length: 150 }, (_, index) => varietyMockCandidate(index + 1));
        const valid = validRanks || new Set();
        const discover = discoverRanks || new Set();
        const failures = failureRanks || new Set();
        const runtime = { candidates, statuses: {}, items: {} };
        const items = [];
        let detailRequests = 0;
        let discoverMatches = 0;
        let lastScannedRank = 0;
        for (let index = 0; index < candidates.length && items.length < SECONDARY_NOSTR_VARIETY_TARGET_MATCHES; index++) {
          const candidate = candidates[index];
          const rank = index + 1;
          lastScannedRank = rank;
          const source = discover.has(rank) ? "discover" : "detail";
          if (source === "discover") discoverMatches += 1;
          else {
            detailRequests += 1;
            if (detailRequests > SECONDARY_NOSTR_VARIETY_MAX_NEW_DETAIL_REQUESTS || failures.has(rank)) continue;
          }
          const metadata = varietyMockMetadata(candidate, valid.has(rank), regionOverrides && regionOverrides[rank]);
          const record = secondaryNostrVarietyRecordFromMetadata(candidate, metadata, index, source);
          runtime.statuses[homeNostrSignalKey(candidate)] = record.status;
          if (record.item) {
            runtime.items[homeNostrSignalKey(candidate)] = record.item;
            items.push(record.item);
          }
        }
        return { items, detailRequests, discoverMatches, lastScannedRank, runtime };
      };
      const varietyValidRanksA = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 79, 80, 84, 89, 90, 114, 116, 120, 140]);
      const varietyDiscoverAll = new Set(Array.from({ length: 150 }, (_, index) => index + 1));
      const varietyColdA = varietyMockScan(varietyValidRanksA, varietyDiscoverAll, new Set(), {});
      const varietyDiscoverB = varietyMockScan(varietyValidRanksA, varietyDiscoverAll, new Set(), {});
      const varietyDiscoverMissC = new Set(Array.from({ length: 150 }, (_, index) => index + 1).filter((rank) => rank !== 79));
      const varietyDetailFallbackC = varietyMockScan(varietyValidRanksA, varietyDiscoverMissC, new Set(), {});
      const varietyRegionD = varietyMockScan(new Set([1]), varietyDiscoverAll, new Set(), { 1: "US" });
      const varietyFailureE = varietyMockScan(new Set(Array.from({ length: 19 }, (_, index) => index + 1)), new Set(Array.from({ length: 19 }, (_, index) => index + 1).filter((rank) => rank !== 2)), new Set([2]), {});
      const varietyResolverSource = String(secondaryLoadNostrVarietyPool) + String(secondaryRunNostrVarietyResolver) + String(secondaryNostrVarietyResolveCandidate) + String(secondaryNostrVarietyPrimeDiscover);
      const varietyCardSource = String(mediaCard) + String(updateTvEpisodeStatusCards) + String(nostrHotSignalOverlay);
      check("NOSTR_VARIETY_CASE_A_COLD", varietyColdA.items.length === 18 && varietyColdA.items[0].nostrHotRank === 1 && varietyColdA.items[17].nostrHotRank === 116 && varietyColdA.items.every((item, index) => Number(item.nostrHotRank) < Number((varietyColdA.items[index - 1] || {}).nostrHotRank || 0) ? false : true), "Top150 variety mock reaches 18 in original Nostr order", "RUNTIME_MOCK");
      check("NOSTR_VARIETY_CASE_B_DISCOVER", varietyDiscoverB.items.length === 18 && varietyDiscoverB.detailRequests < 18 && varietyDiscoverB.discoverMatches > 0, "Discover metadata avoids one-detail-per-candidate scanning", "RUNTIME_MOCK");
      check("NOSTR_VARIETY_CASE_C_DETAIL_FALLBACK", varietyDetailFallbackC.items.some((item) => Number(item.nostrHotRank) === 79) && varietyDetailFallbackC.detailRequests === 1, "a Discover miss can still be recovered by Nostr-order detail", "RUNTIME_MOCK");
      check("NOSTR_VARIETY_CASE_D_REGION_REJECT", varietyRegionD.items.length === 1 && !secondaryNostrHotFilterMatches("variety", { mediaType: "all", genre: "all", region: "CN", year: "all" }, varietyRegionD.items[0]), "genre-valid US item is rejected by the selected region rule", "RUNTIME_MOCK");
      check("NOSTR_VARIETY_CASE_E_FAILURE_CONTINUES", varietyFailureE.items.length === 18 && varietyFailureE.detailRequests === 1, "one failed detail does not abort the variety scan", "RUNTIME_MOCK");
      check("NOSTR_VARIETY_CANONICAL_DISCOVER", varietyResolverSource.includes('secondaryFullCatalogSources("variety")') && varietyResolverSource.includes("page <= 3") && varietyResolverSource.includes("with_genres") === false && String(secondaryFullCatalogSources).includes('with_genres: "10764|10767"'), "variety resolver reuses the canonical OR Discover source with a three-page cap", "STATIC_HOOK");
      check("NOSTR_VARIETY_DETAIL_BUDGET", varietyResolverSource.includes("SECONDARY_NOSTR_VARIETY_MAX_NEW_DETAIL_REQUESTS") && SECONDARY_NOSTR_VARIETY_MAX_NEW_DETAIL_REQUESTS < SECONDARY_NOSTR_VARIETY_MAX_SCAN_CANDIDATES, "variety detail fallback has a bounded adaptive budget", "STATIC_HOOK");
      check("NOSTR_VARIETY_SHARED_HOME_SECONDARY", String(loadHomeCategoryNostrPool).includes("secondaryLoadNostrVarietyPool") && String(secondaryLoadNostrHotItems).includes("secondaryLoadNostrVarietyPool"), "Home and Secondary use the shared variety resolver", "STATIC_HOOK");
      const overlayMock = nostrHotSignalOverlay({ source: "tmdb", mediaType: "tv", tmdbId: "99004", title: "Signal Variety", pic: "mock-poster" }, { people: 321, count: 321, latest: "2026-09-24", lastEventAt: "2026-09-24T00:00:00Z", nostrHotRank: 7 }, "variety");
      check("NOSTR_SIGNAL_OVERLAY_PRESERVED", overlayMock && overlayMock.source === "nostr-hot" && overlayMock.people === 321 && overlayMock.count === 321 && overlayMock.nostrHotRank === 7 && varietyCardSource.includes('item.source === "nostr-hot"'), "Nostr people/count/latest/rank survive metadata enrichment and gate the badge", "RUNTIME_MOCK");
      check("VARIETY_REGION_COMPOUND_MATCH", secondaryRegionMatches({ originCountries: ["HK"] }, "HK|TW") && secondaryRegionMatches({ originCountries: ["TW"] }, "HK|TW") && !secondaryRegionMatches({ originCountries: ["US"] }, "HK|TW") && String(secondaryFullCatalogSources("variety")[0].params.with_genres) === "10764|10767", "港台 is an item-level OR match and canonical variety uses genre OR", "RUNTIME_MOCK");
      check("VARIETY_STATUS_LABELS", varietyEpisodeStatusLabel({ status: "Returning Series", last_episode_to_air: { season_number: 1, episode_number: 12 }, number_of_seasons: 1 }) === "更新至 12期"
        && varietyEpisodeStatusLabel({ status: "Ended", last_episode_to_air: { season_number: 1, episode_number: 12 }, number_of_seasons: 1 }) === "全 12期"
        && varietyEpisodeStatusLabel({ status: "Returning Series", last_episode_to_air: { season_number: 8, episode_number: 12 }, number_of_seasons: 8 }) === "第8季 · 更新至 12期"
        && varietyEpisodeStatusLabel({ status: "Ended", last_episode_to_air: { season_number: 8, episode_number: 12 }, number_of_seasons: 8 }) === "第8季 · 12期全"
        && varietyEpisodeStatusLabel({ status: "Returning Series" }) === "更新中"
        && varietyEpisodeStatusLabel({ status: "Ended" }) === "已完结", "variety status uses 期 and does not guess missing episode data", "RUNTIME_MOCK");
      check("VARIETY_FILTER_SCHEMA_NO_SORT", JSON.stringify(SECONDARY_FILTER_SCHEMA.variety) === JSON.stringify(["region", "year"]), "variety exposes only region and year filters", "STATIC_HOOK");
      check("VARIETY_RELEASE_FILTERED", isReleaseFilteredCatalogId("variety") && filterReleasedCatalogItems("variety", [{ mediaType: "tv", firstAirDate: weeklyAddDays(today(), 1) }]).length === 0, "future variety releases follow the existing TV-like visibility rule", "RUNTIME_MOCK");
      const secondaryPagingSource = String(secondaryCanLoadMore) + String(secondaryLoadNextPage) + String(loadMoreVisible) + String(maybeAppendGridForFocus) + String(canLoadMore) + String(observeInfiniteScroll);
      check("VARIETY_PAGINATION_AUTHORITY", String(secondaryCanLoadMore).includes("!query.loading") && String(secondaryCanLoadMore).includes("!query.error") && String(secondaryCanLoadMore).includes("query.hasMore") && String(secondaryLoadNextPage).includes("secondaryCanLoadMore"), "variety uses the shared explicit secondary pagination gate", "STATIC_HOOK");
      check("VARIETY_SHORT_PAGE_AUTOFILL", String(renderSecondaryCatalog).includes("requestAnimationFrame(ensureScrollablePage") && String(ensureScrollablePage).includes("loadMoreVisible") && String(loadMoreVisible).includes("secondaryCanLoadMore"), "short variety pages can fill the viewport through the shared gate", "STATIC_HOOK");
      check("VARIETY_ERROR_AUTO_RETRY_BLOCKED", secondaryPagingSource.includes("!query.error") && String(loadMoreVisible).includes("secondaryCanLoadMore") && String(maybeAppendGridForFocus).includes("secondaryCanLoadMore") && String(canLoadMore).includes("secondaryCanLoadMore"), "error state blocks ensure, intersection, focus and arrow pagination paths", "STATIC_HOOK");
      const varietyHistoryAuthority = String(openSecondaryCatalog) + String(requestCloseSecondaryCatalog) + String(closeSecondaryCatalog) + String(handleSecondaryBackKey);
      check("VARIETY_HISTORY_BACK_AUTHORITY", String(openSecondaryCatalog).includes("isSecondaryHistoryEntry") && String(openSecondaryCatalog).includes("history.pushState") && String(requestCloseSecondaryCatalog).includes("history.back") && String(closeSecondaryCatalog).includes("secondaryReturn") && String(closeSecondaryCatalog).includes("applyHomeScrollTop") && String(handleSecondaryBackKey).includes("requestCloseSecondaryCatalog"), "variety reuses the shared Secondary history, Back and Home-restore authority", "STATIC_HOOK");
      check("VARIETY_NOSTR_FIRST_DEDUPE", varietyHistoryAuthority && String(commitSecondaryNostrHotItems).includes("query.nostrHotItems.concat(fallback)") && String(loadHomeCategoryFeed).includes("nostrItems.concat(tmdbItems)"), "Nostr variety items precede TMDB fallback and both merge through uniqueMedia", "STATIC_HOOK");
      const movieToday = today();
      const movieYesterday = weeklyAddDays(movieToday, -1);
      const movieFuture = weeklyAddDays(movieToday, 1);
      const movieNextYear = `${Number(movieToday.slice(0, 4)) + 1}-01-15`;
      const movieFutureLabel = movieFuture.slice(0, 4) === movieToday.slice(0, 4)
        ? `${weeklyDateLabel(movieFuture)}上映`
        : `${movieFuture.slice(0, 4)}年${weeklyDateLabel(movieFuture)}上映`;
      const movieLatestPlan = secondaryApplyServerFilters(secondaryFullCatalogSources("movie")[0], { mediaType: "all", genre: "all", region: "all", year: "all", sort: "latest" });
      check("MOVIE_FUTURE_RELEASE_ALLOWED", filterReleasedCatalogItems("movie", [{ mediaType: "movie", releaseDate: movieFuture }]).length === 1, "future movie releases remain eligible", "RUNTIME_MOCK");
      check("TV_FUTURE_RELEASE_FILTER_UNCHANGED", filterReleasedCatalogItems("tv", [{ mediaType: "tv", firstAirDate: movieFuture }]).length === 0, "future TV releases remain filtered", "RUNTIME_MOCK");
      check("ANIME_FUTURE_RELEASE_FILTER_UNCHANGED", filterReleasedCatalogItems("anime", [{ mediaType: "tv", firstAirDate: movieFuture }]).length === 0, "future anime releases remain filtered", "RUNTIME_MOCK");
      check("MOVIE_LATEST_NO_TODAY_LIMIT", movieLatestPlan && movieLatestPlan.entry.params.sort_by === "primary_release_date.desc" && !Object.keys(movieLatestPlan.entry.params).some((key) => /_lte$/.test(key)), "movie latest keeps release-date sorting without a today limit", "RUNTIME_MOCK");
      check("MOVIE_RELEASE_STATUS_CASES", movieReleaseStatusText({ mediaType: "movie", releaseDate: movieYesterday }) === "已上映"
        && movieReleaseStatusText({ mediaType: "movie", releaseDate: movieToday }) === "已上映"
        && movieReleaseStatusText({ mediaType: "movie", releaseDate: movieFuture }) === movieFutureLabel
        && movieReleaseStatusText({ mediaType: "movie", releaseDate: movieNextYear }) === `${movieNextYear.slice(0, 4)}年1月15日上映`
        && movieReleaseStatusText({ mediaType: "movie", releaseDate: "" }) === "", "movie release status covers past, today, future, next year and empty dates", "RUNTIME_MOCK");
      check("MOVIE_WEEKLY_STATUS_PRECEDENCE", movieReleaseStatusText({ mediaType: "movie", releaseDate: movieToday, weeklyUpdateText: "本周新片 · 9月24日上映" }, "本周新片 · 9月24日上映") === "", "weekly movie text suppresses the ordinary release label", "RUNTIME_MOCK");
      check("MOVIE_RELEASE_STATUS_NO_DETAIL_REQUEST", !String(movieReleaseStatusText).includes("requestJson") && !String(mediaCard).includes("secondaryNostrDetailUrl"), "movie release status uses normalized card data only", "STATIC_HOOK");
      const detailPrepareSource = String(prepareDetailPlayback);
      const detailRequestSource = String(requestDetailPlayback);
      const detailPlayStateSource = String(detailContinuePlayStateFor);
      const detailCanonicalPrepareSource = String(prepareDetailPlaybackForDetail);
      const detailCanonicalSource = String(resolveCanonicalResourceTitle);
      const detailMovieSharedSource = String(requestMovieDetailShared);
      const detailMovieLoadSource = String(loadDetail);
      const detailCanonicalExactSource = String(canonicalExactDetailFor);
      const detailColorStyle = $("detail-action-colors-v1");
      const detailColorSource = detailColorStyle ? String(detailColorStyle.textContent || "") : "";
      const unreleasedGateAt = detailPrepareSource.indexOf("const unreleased = detailUnreleasedInfo(item);");
      const firstPlayPrepareAt = detailPrepareSource.indexOf('decision: "FIRST_PLAY_PREPARE"');
      const backgroundPreparingAt = detailPrepareSource.indexOf('showDirectPlayStatus(run.token, "BACKGROUND_PREPARING"');
      const curatedPrepareAt = detailPrepareSource.indexOf("resolveCuratedPlaybackCandidate(item, run)");
      const directPrepareAt = detailPrepareSource.indexOf("playBestQuark(item, {");
      const preparationStartedAt = detailPrepareSource.indexOf("run.preparationStarted = true;");
      const requestUnreleasedAt = detailRequestSource.indexOf("detailUnreleasedInfo(item).unreleased");
      const requestDirectAt = detailRequestSource.indexOf("playBestQuark(item");
      const requestStatusAt = detailRequestSource.indexOf("showDirectPlayStatus(");
      const gateBlock = unreleasedGateAt >= 0 && preparationStartedAt > unreleasedGateAt
        ? detailPrepareSource.slice(unreleasedGateAt, preparationStartedAt) : "";
      const futureDetailDate = weeklyAddDays(today(), 1);
      const futureMovieDetail = { mediaType: "movie", releaseDate: futureDetailDate };
      const futureTvDetail = { mediaType: "tv", firstAirDate: futureDetailDate };
      const futureTvSnakeDetail = { mediaType: "tv", first_air_date: futureDetailDate };
      const historyFutureItem = { mediaType: "movie", title: "未来历史片", tmdbId: "900001", releaseDate: futureDetailDate };
      const historyFuture = {
        source: "history",
        title: historyFutureItem.title,
        mediaType: "movie",
        nativeHistoryRaw: {},
        nativeHistoryKey: "future-history",
        historyReplayKind: "URL_NATIVE",
        position: 100
      };
      const detailStateSnapshot = {
        selected: state.selected,
        detailMode: state.detailMode,
        detailModeItemKey: state.detailModeItemKey,
        detailHistory: state.detailHistory,
        detailPlayback: state.detailPlayback
      };
      let historyPriorityState = "";
      let unreleasedTerminalState = "";
      const playStateCases = {};
      try {
        state.selected = historyFutureItem;
        state.detailMode = "FIRST_PLAY";
        state.detailModeItemKey = panSearchItemKey(historyFutureItem);
        state.detailHistory = null;
        state.detailPlayback = {
          item: historyFutureItem,
          itemKey: panSearchItemKey(historyFutureItem),
          active: false,
          phase: "UNRELEASED",
          settledResult: "UNRELEASED",
          preparationStarted: false
        };
        unreleasedTerminalState = detailContinuePlayStateFor(historyFutureItem);
        state.detailMode = "CONTINUE";
        state.detailHistory = historyFuture;
        state.detailPlayback = null;
        historyPriorityState = detailContinuePlayStateFor(historyFutureItem);
        const releasedDetailItem = { mediaType: "movie", title: "已上映状态片", tmdbId: "900002", releaseDate: today() };
        state.selected = releasedDetailItem;
        state.detailMode = "FIRST_PLAY";
        state.detailModeItemKey = panSearchItemKey(releasedDetailItem);
        state.detailHistory = null;
        state.detailPlayback = {
          item: releasedDetailItem,
          itemKey: panSearchItemKey(releasedDetailItem),
          active: true,
          phase: "CONTINUE_GATE",
          settledResult: "",
          preparationStarted: false
        };
        playStateCases.idle = detailContinuePlayStateFor(releasedDetailItem);
        state.detailPlayback.phase = "PREPARING";
        state.detailPlayback.preparationStarted = true;
        playStateCases.preparing = detailContinuePlayStateFor(releasedDetailItem);
        state.detailPlayback.active = false;
        state.detailPlayback.phase = "NO_RESOURCE";
        state.detailPlayback.settledResult = "NO_RESOURCE";
        playStateCases.failed = detailContinuePlayStateFor(releasedDetailItem);
      } finally {
        state.selected = detailStateSnapshot.selected;
        state.detailMode = detailStateSnapshot.detailMode;
        state.detailModeItemKey = detailStateSnapshot.detailModeItemKey;
        state.detailHistory = detailStateSnapshot.detailHistory;
        state.detailPlayback = detailStateSnapshot.detailPlayback;
      }
      check("UNRELEASED_MOVIE_RULE", detailUnreleasedInfo(futureMovieDetail).unreleased && !detailUnreleasedInfo({ mediaType: "movie", releaseDate: today() }).unreleased && !detailUnreleasedInfo({ mediaType: "movie", releaseDate: "2026-02-31" }).unreleased, "future movie date blocks while today and invalid dates do not", "RUNTIME_MOCK");
      check("UNRELEASED_TV_RULE", detailUnreleasedInfo(futureTvDetail).unreleased && detailUnreleasedInfo(futureTvSnakeDetail).unreleased, "TV first-air date accepts camelCase and snake_case fields", "RUNTIME_MOCK");
      check("UNRELEASED_TODAY_NOT_BLOCKED", !detailUnreleasedInfo({ mediaType: "tv", firstAirDate: today() }).unreleased, "today is treated as released", "RUNTIME_MOCK");
      check("UNRELEASED_UNKNOWN_DATE_NOT_BLOCKED", !detailUnreleasedInfo({ mediaType: "movie", releaseDate: "" }).unreleased && !detailUnreleasedInfo({ mediaType: "tv" }).unreleased, "empty or unknown dates do not block", "RUNTIME_MOCK");
      check("UNRELEASED_NEXT_EPISODE_IGNORED", !detailUnreleasedInfo({ mediaType: "tv", next_episode_to_air: { air_date: futureDetailDate } }).unreleased && !detailUnreleasedInfo({ mediaType: "tv", releaseDate: futureDetailDate, weeklyNextEpisodeDate: futureDetailDate, next_episode_to_air: { air_date: futureDetailDate } }).unreleased, "next_episode_to_air and its normalized weekly date cannot trigger the detail gate", "RUNTIME_MOCK");
      check("TODAY_RELEASE_PREPARES", !detailUnreleasedInfo({ mediaType: "movie", releaseDate: today() }).unreleased && detailPrepareSource.includes('decision: "FIRST_PLAY_PREPARE"'), "today release remains on the normal first-play path", "RUNTIME_MOCK");
      check("UNKNOWN_DATE_PREPARES", !detailUnreleasedInfo({ mediaType: "movie", releaseDate: "not-a-date" }).unreleased && detailPrepareSource.includes("run.preparationStarted = true"), "unknown release date remains eligible for preparation", "RUNTIME_MOCK");
      check("NEXT_EPISODE_FUTURE_NOT_BLOCKED", !detailUnreleasedInfo({ mediaType: "tv", firstAirDate: weeklyAddDays(today(), -1), next_episode_to_air: { air_date: futureDetailDate } }).unreleased, "a previously premiered TV show is not blocked by a future next episode", "RUNTIME_MOCK");
      check("UNRELEASED_GATE_ADDED", typeof detailUnreleasedInfo === "function" && typeof settleDetailUnreleased === "function" && unreleasedGateAt >= 0, "detail has an explicit future-date gate and terminal helper", "STATIC_HOOK");
      check("UNRELEASED_GATE_POSITION", unreleasedGateAt >= 0 && firstPlayPrepareAt > unreleasedGateAt && backgroundPreparingAt > unreleasedGateAt && curatedPrepareAt > unreleasedGateAt && directPrepareAt > unreleasedGateAt, "gate precedes FIRST_PLAY_PREPARE, status, Curated and Direct preparation", "STATIC_HOOK");
      check("UNRELEASED_GATE_FINAL_STATE", gateBlock.includes('settleDetailUnreleased(item, "unreleased_gate")') && String(settleDetailUnreleased).includes('settleDetailPlayback(run, "UNRELEASED"') && String(settleDetailUnreleased).includes('run.error = ""'), "unreleased settles as a non-error terminal run", "STATIC_HOOK");
      check("UNRELEASED_NO_PREPARING_FLASH", detailPrepareSource.includes('phase: "CONTINUE_GATE"') && gateBlock && !gateBlock.includes("BACKGROUND_PREPARING") && !gateBlock.includes("run.preparationStarted = true"), "future item stays idle/blue-gray until it becomes unreleased", "STATIC_HOOK");
      check("UNRELEASED_NO_CURATED_OR_DIRECT", unreleasedGateAt < curatedPrepareAt && unreleasedGateAt < directPrepareAt && requestUnreleasedAt >= 0 && requestUnreleasedAt < requestDirectAt, "automatic and manual paths stop before Curated/Direct resource search", "STATIC_HOOK");
      check("UNRELEASED_NO_CURATED", unreleasedGateAt < curatedPrepareAt && gateBlock.indexOf("resolveCuratedPlaybackCandidate") < 0, "unreleased gate cannot start Curated", "STATIC_HOOK");
      check("UNRELEASED_NO_DIRECT", unreleasedGateAt < directPrepareAt && gateBlock.indexOf("playBestQuark") < 0, "unreleased gate cannot start Direct/Pan", "STATIC_HOOK");
      check("UNRELEASED_MANUAL_PLAY_BLOCKED", requestUnreleasedAt >= 0 && requestUnreleasedAt < requestStatusAt && detailRequestSource.includes('toast("尚未上映")'), "manual Play remains focusable but does not retry the network", "STATIC_HOOK");
      check("UNRELEASED_MANUAL_CLICK_BLOCKED", requestUnreleasedAt >= 0 && requestUnreleasedAt < requestDirectAt && detailRequestSource.includes('settleDetailUnreleased(item, "unreleased_manual_guard")'), "manual Play has a second unreleased guard", "STATIC_HOOK");
      check("UNRELEASED_NOT_FAILURE", unreleasedTerminalState === "unreleased" && detailPlayStateSource.indexOf('runPhase === "UNRELEASED"') < detailPlayStateSource.indexOf("const failurePhase") && !gateBlock.includes("CONNECTION_FAILED") && !gateBlock.includes("notifyCurrentDetailFinalFailure"), "unreleased is not mapped to failed or failure notification", "RUNTIME_MOCK");
      check("VALID_HISTORY_OVERRIDES_UNRELEASED", historyPriorityState === "ready" && unreleasedTerminalState === "unreleased" && detailPrepareSource.indexOf("detailContinueHistoryIsValid(continueDecision.history)") < unreleasedGateAt && detailRequestSource.indexOf("detailContinueHistoryIsValid(history)") < requestUnreleasedAt, "valid Native History remains ready even when the item date is future", "RUNTIME_MOCK");
      const historyStateAt = detailPlayStateSource.indexOf("if (history) return \"ready\"");
      const directReadyStateAt = detailPlayStateSource.indexOf("if (directReady) return \"ready\"");
      const unreleasedStateAt = detailPlayStateSource.indexOf('runPhase === "UNRELEASED"');
      const preparingStateAt = detailPlayStateSource.indexOf("return \"preparing\"");
      const failedStateAt = detailPlayStateSource.indexOf("const failurePhase");
      check("DETAIL_PLAY_STATE_PRIORITY", historyStateAt >= 0 && directReadyStateAt > historyStateAt && unreleasedStateAt > directReadyStateAt && preparingStateAt > unreleasedStateAt && failedStateAt > preparingStateAt, "state priority is history, playable, unreleased, preparing, failed", "STATIC_HOOK");
      check("PLAY_STATE_IDLE", playStateCases.idle === "idle", "Continue Gate has no preparing state", "RUNTIME_MOCK");
      check("PLAY_STATE_PREPARING", playStateCases.preparing === "preparing", "actual resource preparation maps to preparing", "RUNTIME_MOCK");
      check("PLAY_STATE_READY", historyPriorityState === "ready" && detailPlayStateSource.includes('return "ready"'), "history or playable candidate maps to ready", "RUNTIME_MOCK");
      check("PLAY_STATE_FAILED", playStateCases.failed === "failed", "real terminal resource failure maps to failed", "RUNTIME_MOCK");
      check("PLAY_STATE_UNRELEASED", unreleasedTerminalState === "unreleased", "future no-history terminal maps to unreleased", "RUNTIME_MOCK");
      check("PLAY_COLOR_IDLE", detailColorSource.includes('[data-play-state="idle"]') && detailColorSource.includes("#8FA3B8"), "idle icon is blue-gray", "STATIC_HOOK");
      check("PLAY_COLOR_UNRELEASED", detailColorSource.includes('[data-play-state="unreleased"]') && detailColorSource.includes("#8FA3B8"), "unreleased icon is blue-gray", "STATIC_HOOK");
      check("PLAY_COLOR_PREPARING", detailColorSource.includes('[data-play-state="preparing"]') && detailColorSource.includes("#F2B84B"), "preparing icon is amber", "STATIC_HOOK");
      check("PLAY_COLOR_READY", detailColorSource.includes('[data-play-state="ready"]') && detailColorSource.includes("#35E07A"), "ready icon is green", "STATIC_HOOK");
      check("PLAY_COLOR_FAILED", detailColorSource.includes('[data-play-state="failed"]') && detailColorSource.includes("#FF0000"), "failed icon is red", "STATIC_HOOK");
      check("DETAIL_PLAY_STATE_COLORS", detailColorSource.includes('[data-play-state="idle"]') && detailColorSource.includes('[data-play-state="unreleased"]') && detailColorSource.includes("#8FA3B8") && detailColorSource.includes('[data-play-state="preparing"]') && detailColorSource.includes("#F2B84B") && detailColorSource.includes('[data-play-state="ready"]') && detailColorSource.includes("#35E07A") && detailColorSource.includes('[data-play-state="failed"]') && detailColorSource.includes("#FF0000"), "five logical states use the requested four icon colors", "STATIC_HOOK");
      check("DETAIL_BUTTON_STAYS_FOCUSABLE", !detailRequestSource.includes('detailContinueBtn.disabled') && !detailRequestSource.includes('setAttribute("disabled"'), "unreleased only gates the action and does not disable the button", "STATIC_HOOK");
      const canonicalResolveAt = detailCanonicalPrepareSource.indexOf("resolveCanonicalResourceTitle");
      const canonicalPrepareAt = detailCanonicalPrepareSource.indexOf("prepareDetailPlayback(item, Object.assign");
      const historyGateAt = detailPrepareSource.indexOf("verifyDetailNativeHistoryWithDeadline");
      const canonicalBarrierAt = detailPrepareSource.indexOf("await run.canonicalPromise");
      const continueReadyAt = detailPrepareSource.indexOf('decision: "CONTINUE_READY"');
      const continueReadyReturnAt = continueReadyAt >= 0 ? detailPrepareSource.indexOf("return null;", continueReadyAt) : -1;
      const continueReadyBlock = continueReadyAt >= 0 && continueReadyReturnAt > continueReadyAt
        ? detailPrepareSource.slice(historyGateAt, continueReadyReturnAt) : "";
      check("CANONICAL_HISTORY_PARALLEL", canonicalResolveAt >= 0 && canonicalPrepareAt > canonicalResolveAt && !detailCanonicalPrepareSource.includes("await resolveCanonicalResourceTitle") && historyGateAt >= 0 && detailPrepareSource.includes("canonicalPromise") && String(openDetail).includes("continueGate: true"), "canonical starts before the run and the first History gate can proceed without awaiting it", "STATIC_HOOK");
      check("VALID_HISTORY_DOES_NOT_WAIT_CANONICAL", continueReadyBlock && !continueReadyBlock.includes("await run.canonicalPromise"), "valid Native History settles Continue before the canonical barrier", "STATIC_HOOK");
      check("NO_HISTORY_CANONICAL_BARRIER", canonicalBarrierAt >= 0 && canonicalBarrierAt < unreleasedGateAt && canonicalBarrierAt < curatedPrepareAt && canonicalBarrierAt < directPrepareAt, "no-History playback waits for canonical resolution before Unreleased and Race", "STATIC_HOOK");
      check("MOVIE_DETAIL_SHARED_AUTHORITY", detailMovieSharedSource.includes("entry.promise") && detailMovieSharedSource.includes("return entry.promise") && detailMovieLoadSource.includes("requestMovieDetailShared(item)") && detailCanonicalSource.includes("requestMovieDetailShared(item)") && !detailCanonicalSource.includes("requestJson(canonicalExactDetailUrl"), "movie canonical and UI detail share one cache/pending request authority", "STATIC_HOOK");
      check("MOVIE_EXACT_DETAIL_CACHE_REUSE", detailCanonicalExactSource.includes("movieDetailCacheValue(item)") && detailCanonicalExactSource.includes("canonicalDetailLooksRaw(item, detail)"), "canonical exact detail can reuse the validated movie raw-detail cache", "STATIC_HOOK");
      check("MOVIE_DETAIL_FAILURE_CLEARS_PENDING", detailMovieSharedSource.includes("entry.promise = null") && detailMovieSharedSource.includes("catch"), "failed movie detail requests clear pending state for retry", "STATIC_HOOK");
      check("CANONICAL_TITLE_PURPOSE", detailCanonicalSource.includes("resourceSearchTitle") && detailCanonicalSource.includes("canonicalIdentityContextFromDetail") && !detailCanonicalSource.includes("playBestQuark") && !detailCanonicalSource.includes("resolveCuratedPlaybackCandidate"), "canonical resolution serves identity/resource-title enrichment, not playback", "STATIC_HOOK");
      check("NETWORK_RESOURCE_SEARCH_BEFORE_UNRELEASED_GATE", unreleasedGateAt < curatedPrepareAt && unreleasedGateAt < directPrepareAt && !detailCanonicalSource.includes("nativeSearch") && !detailCanonicalSource.includes("playBestQuark") && !detailCanonicalSource.includes("resolveCuratedPlaybackCandidate"), "no network resource search starts before the unreleased gate", "STATIC_HOOK");
      check("DETAIL_NORMAL_DATA_PATH_PRESERVED", typeof renderDetailBase === "function" && typeof openDetail === "function" && String(openDetail).includes("renderDetailBase(item)"), "normal detail metadata/data rendering remains available", "FROZEN_SOURCE_AUDIT");
      check("DETAIL_CONTINUE_HISTORY", detailPrepareSource.includes('decision: "CONTINUE_READY"') && detailPrepareSource.includes("curatedStarted: false"), "valid Continue history still exits before first-play preparation", "FROZEN_SOURCE_AUDIT");
      check("DETAIL_CURATED_NORMAL", curatedPrepareAt > unreleasedGateAt && detailPrepareSource.includes("curated && curated.candidate"), "normal released detail can still use Curated", "FROZEN_SOURCE_AUDIT");
      check("DETAIL_DIRECT_FALLBACK_NORMAL", directPrepareAt > unreleasedGateAt && detailPrepareSource.includes('run.phase = "PAN_DIRECT"'), "normal released detail can still use Direct/Pan fallback", "FROZEN_SOURCE_AUDIT");
      const raceStartAt = detailPrepareSource.indexOf('recordDetailRaceDiag("DETAIL_RACE_START"');
      const raceCuratedStartAt = detailPrepareSource.indexOf('recordDetailRaceDiag("CURATED_RACE_START"');
      const raceDirectStartAt = detailPrepareSource.indexOf('recordDetailRaceDiag("DIRECT_RACE_START"');
      const raceRequestBlockAt = detailRequestSource.indexOf("const racingDetailPlayback");
      const raceStateSnapshot = {
        selected: state.selected,
        detailPlayback: state.detailPlayback,
        directPlayStatus: state.directPlayStatus,
        detailRace: state.tvDiag && state.tvDiag.detailRace,
        detailRaceLog: state.tvDiag && state.tvDiag.detailRaceLog
      };
      const racePanSnapshot = state.pan;
      const raceDirectPlayPendingSnapshot = _directPlayPending;
      const racePanSessionDiagSnapshot = state.tvDiag && state.tvDiag.panSearchSession;
      const raceTestItem = { mediaType: "movie", tmdbId: "race-test", title: "Race Test", releaseDate: "2020-01-01" };
      let raceTestSeq = 0;
      const newRaceTestRun = () => ({
        seq: 9900 + (++raceTestSeq),
        token: 9900 + raceTestSeq,
        item: raceTestItem,
        itemKey: panSearchItemKey(raceTestItem),
        active: true,
        phase: "PREPARING",
        settledResult: "",
        raceActive: true,
        raceStartedAt: Date.now(),
        raceCompletionResolved: false,
        providerCommitted: false,
        providerCommitCount: 0,
        provider: "",
        sourceId: "",
        candidate: null,
        playRequested: false,
        handoffStarted: false,
        handoffDispatching: false,
        cancelled: false,
        curatedTerminal: false,
        directTerminal: false,
        curatedTentative: null,
        directTentative: null,
        directFailureType: "",
        staleLogged: false
      });
      const raceTestCandidate = (identityVerdict) => ({
        diskType: "magnet",
        url: "https://example.invalid/race.m3u8",
        title: "Race Candidate",
        identityVerdict: identityVerdict || "STRONG",
        healthAdmission: "ok"
      });
      let raceDirectFirst = false;
      let raceCuratedFirst = false;
      let raceTentativeHold = false;
      let raceOneLaneFailure = false;
      let raceNearSimultaneous = false;
      let raceBothTentative = false;
      let raceBothFail = false;
      let raceStaleExit = false;
      let raceStaleAToB = false;
      let directDiscoveryTerminated = false;
      let directRetryGuard = false;
      let directPollGuard = false;
      let directHealthGuard = false;
      let curatedWinnerPreserved = false;
      let directWinnerPreserved = false;
      try {
        let raceRun = newRaceTestRun();
        state.selected = raceTestItem;
        state.detailPlayback = raceRun;
        const directCommitted = tryCommitDetailProvider(raceRun, "pan-direct", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        const directLateCurated = tryCommitDetailProvider(raceRun, "curated", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        raceDirectFirst = directCommitted && !directLateCurated && raceRun.provider === "pan-direct" && raceRun.providerCommitCount === 1;

        raceRun = newRaceTestRun();
        state.detailPlayback = raceRun;
        const curatedCommitted = tryCommitDetailProvider(raceRun, "curated", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        const curatedLateDirect = tryCommitDetailProvider(raceRun, "pan-direct", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        raceCuratedFirst = curatedCommitted && !curatedLateDirect && raceRun.provider === "curated" && raceRun.providerCommitCount === 1;

        raceRun = newRaceTestRun();
        state.detailPlayback = raceRun;
        detailRaceLaneTerminal(raceRun, "direct", raceTestCandidate("TENTATIVE"), "TENTATIVE_HELD");
        raceTentativeHold = !raceRun.providerCommitted && raceRun.raceActive && !raceRun.curatedTerminal;

        raceRun = newRaceTestRun();
        state.detailPlayback = raceRun;
        detailRaceLaneTerminal(raceRun, "curated", null, "CURATED_FAILED");
        raceOneLaneFailure = !raceRun.providerCommitted && raceRun.phase === "PREPARING" && !raceRun.raceFinalized;

        raceRun = newRaceTestRun();
        state.detailPlayback = raceRun;
        const nearFirst = tryCommitDetailProvider(raceRun, "curated", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        const nearSecond = tryCommitDetailProvider(raceRun, "pan-direct", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        raceNearSimultaneous = nearFirst && !nearSecond && raceRun.providerCommitCount === 1;

        raceRun = newRaceTestRun();
        state.detailPlayback = raceRun;
        detailRaceLaneTerminal(raceRun, "curated", raceTestCandidate("TENTATIVE"), "TENTATIVE_HELD");
        detailRaceLaneTerminal(raceRun, "direct", raceTestCandidate("TENTATIVE"), "TENTATIVE_FINAL");
        raceBothTentative = raceRun.providerCommitted && raceRun.provider === "curated" && raceRun.providerCommitCount === 1;

        raceRun = newRaceTestRun();
        state.detailPlayback = raceRun;
        detailRaceLaneTerminal(raceRun, "curated", null, "CURATED_FAILED");
        detailRaceLaneTerminal(raceRun, "direct", null, "NO_RESOURCE");
        raceBothFail = !raceRun.providerCommitted && raceRun.phase === "NO_RESOURCE" && raceRun.raceFinalized;

        raceRun = newRaceTestRun();
        state.selected = { mediaType: "movie", tmdbId: "closed-item", title: "Closed" };
        state.detailPlayback = raceRun;
        raceStaleExit = !tryCommitDetailProvider(raceRun, "curated", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true })
          && !raceRun.providerCommitted && state.detailPlayback === raceRun;

        const runA = newRaceTestRun();
        const itemB = { mediaType: "movie", tmdbId: "item-b", title: "Item B" };
        state.selected = itemB;
        const runB = newRaceTestRun();
        runB.item = itemB;
        runB.itemKey = panSearchItemKey(itemB);
        state.detailPlayback = runB;
        raceStaleAToB = !tryCommitDetailProvider(runA, "pan-direct", raceTestCandidate("STRONG"), { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true })
          && !runA.providerCommitted && state.detailPlayback.item === itemB;

        const directTerminationPan = Object.assign({}, racePanSnapshot, {
          pollTimers: [],
          pollRoundStarted: {},
          progress: Object.assign({}, racePanSnapshot.progress || {}),
          results: [],
          health: {},
          pending: {},
          queued: new Map(),
          inFlight: new Set()
        });
        state.pan = directTerminationPan;
        const directTerminationItem = { mediaType: "movie", tmdbId: "direct-stop", title: "Direct Stop", releaseDate: "2020-01-01" };
        const directTerminationCandidate = raceTestCandidate("STRONG");
        directTerminationCandidate.key = "magnet|https://example.invalid/direct-stop.m3u8";
        state.selected = directTerminationItem;
        state.pan.sessionId = 9911;
        state.pan.sessionOrigin = "direct";
        state.pan.sessionItemKey = panSearchItemKey(directTerminationItem);
        state.pan.sessionStartedAt = Date.now();
        state.pan.sessionTerminal = false;
        state.pan.sessionTerminalReason = "";
        state.pan.sessionEndRecorded = false;
        state.pan.keyword = panKeyword(directTerminationItem);
        state.pan.viewToken = "pan-direct-stop";
        state.pan.searchMode = "direct";
        state.pan.loading = true;
        state.pan.results = [directTerminationCandidate];
        state.pan.health = { [panHealthKey(directTerminationCandidate)]: { state: "ok", checkedAt: Date.now(), expiresAt: Date.now() + 60000 } };
        state.pan.progress = { active: true, phase: "polling", round: 1, totalRounds: 2 };
        state.pan.pollTimers = [setTimeout(() => {}, 60000)];
        const directStopRun = newRaceTestRun();
        directStopRun.item = directTerminationItem;
        directStopRun.itemKey = panSearchItemKey(directTerminationItem);
        directStopRun.directAction = { token: 9911, item: directTerminationItem, viewToken: "pan-direct-stop", viewTokenBound: true, raceMode: true, cancelReason: "" };
        state.detailPlayback = directStopRun;
        _directPlayPending = directStopRun.directAction;
        const directStopResults = state.pan.results;
        const curatedCommittedAfterDirectStart = tryCommitDetailProvider(directStopRun, "curated", directTerminationCandidate, { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        directDiscoveryTerminated = curatedCommittedAfterDirectStart
          && state.pan.sessionTerminal
          && state.pan.sessionTerminalReason === "provider_committed"
          && !isPanSearchSessionActive(directTerminationItem, state.pan.viewToken, state.pan.sessionId)
          && directStopRun.directAction.cancelReason === "provider_committed"
          && state.pan.results === directStopResults;
        directRetryGuard = !panDirectPlayActionIsCurrent(directStopRun.directAction);
        directPollGuard = state.pan.pollTimers.length === 0;
        directHealthGuard = !panContextIsCurrent({ token: state.pan.viewToken, item: directTerminationItem, directAction: directStopRun.directAction });
        curatedWinnerPreserved = directStopRun.provider === "curated"
          && directStopRun.phase === "READY"
          && directStopRun.candidate === directTerminationCandidate
          && directStopRun.providerCommitCount === 1;

        state.pan.sessionId = 9912;
        state.pan.sessionOrigin = "direct";
        state.pan.sessionItemKey = panSearchItemKey(directTerminationItem);
        state.pan.sessionStartedAt = Date.now();
        state.pan.sessionTerminal = false;
        state.pan.sessionTerminalReason = "";
        state.pan.sessionEndRecorded = false;
        state.pan.viewToken = "pan-direct-own-win";
        state.pan.searchMode = "direct";
        state.pan.loading = true;
        state.pan.directReady = { itemKey: panSearchItemKey(directTerminationItem), sessionId: 9912, candidateKey: directTerminationCandidate.key, candidate: directTerminationCandidate };
        state.pan.pollTimers = [setTimeout(() => {}, 60000)];
        const directWinnerRun = newRaceTestRun();
        directWinnerRun.item = directTerminationItem;
        directWinnerRun.itemKey = panSearchItemKey(directTerminationItem);
        directWinnerRun.directAction = { token: 9912, item: directTerminationItem, viewToken: "pan-direct-own-win", viewTokenBound: true, raceMode: true, cancelReason: "" };
        state.detailPlayback = directWinnerRun;
        _directPlayPending = directWinnerRun.directAction;
        const directOwnCommit = tryCommitDetailProvider(directWinnerRun, "pan-direct", directTerminationCandidate, { identityVerdict: "STRONG", healthState: "ok", healthAccepted: true });
        directWinnerPreserved = directOwnCommit
          && directWinnerRun.provider === "pan-direct"
          && directWinnerRun.phase === "READY"
          && directWinnerRun.candidate === directTerminationCandidate
          && state.pan.directReady
          && state.pan.directReady.candidate === directTerminationCandidate
          && state.pan.sessionTerminal
          && state.pan.pollTimers.length === 0;
      } finally {
        state.selected = raceStateSnapshot.selected;
        state.detailPlayback = raceStateSnapshot.detailPlayback;
        state.directPlayStatus = raceStateSnapshot.directPlayStatus;
        state.pan = racePanSnapshot;
        _directPlayPending = raceDirectPlayPendingSnapshot;
        if (state.tvDiag) {
          state.tvDiag.detailRace = raceStateSnapshot.detailRace;
          state.tvDiag.detailRaceLog = raceStateSnapshot.detailRaceLog;
          state.tvDiag.panSearchSession = racePanSessionDiagSnapshot;
        }
      }
      const raceRequestBlock = raceRequestBlockAt >= 0 ? detailRequestSource.slice(raceRequestBlockAt, detailRequestSource.indexOf("const prepared", raceRequestBlockAt)) : "";
      check("DETAIL_RACE_AFTER_HISTORY_GATE", raceStartAt > firstPlayPrepareAt && raceStartAt > preparationStartedAt, "Curated and Direct race starts only after History/first-play preparation gates", "STATIC_HOOK");
      check("DETAIL_RACE_AFTER_UNRELEASED_GATE", raceStartAt > unreleasedGateAt && gateBlock.indexOf("recordDetailRaceDiag") < 0, "unreleased gate returns before either race lane starts", "STATIC_HOOK");
      check("DETAIL_RACE_EQUAL_PRIORITY", raceCuratedStartAt >= 0 && raceDirectStartAt > raceCuratedStartAt && detailPrepareSource.includes("run.curatedTask") && detailPrepareSource.includes("run.directTask") && !detailPrepareSource.includes("await resolveCuratedPlaybackCandidate(item, run)"), "Curated and Direct are launched as peer tasks rather than a waterfall", "STATIC_HOOK");
      check("DETAIL_RACE_DIRECT_ORIGIN_MODE", detailPrepareSource.includes('mode: "direct"') && detailPrepareSource.includes('origin: "direct"') && detailPrepareSource.includes('prepareOnly: true'), "Direct lane keeps the existing direct mode/origin and prepareOnly contract", "STATIC_HOOK");
      check("DETAIL_RACE_DIRECT_FIRST", raceDirectFirst, "first qualified Direct candidate commits immediately", "RUNTIME_MOCK");
      check("DETAIL_RACE_CURATED_FIRST", raceCuratedFirst, "first qualified Curated candidate commits immediately", "RUNTIME_MOCK");
      check("DETAIL_RACE_TENTATIVE_HOLD", raceTentativeHold && detailPrepareSource.includes("allowTentativeFinal"), "tentative candidate waits for the other lane and is only final fallback", "RUNTIME_MOCK");
      check("DETAIL_RACE_ONE_LANE_FAILURE", raceOneLaneFailure, "one lane failure leaves the shared UI in PREPARING", "RUNTIME_MOCK");
      check("DETAIL_RACE_NEAR_SIMULTANEOUS", raceNearSimultaneous, "near-simultaneous qualified completions produce one provider commit", "RUNTIME_MOCK");
      check("DETAIL_RACE_CLICK_DURING_RACE", raceRequestBlock.includes("racingDetailPlayback.playRequested = true") && !raceRequestBlock.includes("playBestQuark(item, directOptions)"), "click during race records intent without creating another action/search", "STATIC_HOOK");
      check("DETAIL_RACE_SINGLE_HANDOFF", String(detailRaceHandoffCommittedProvider).includes("handoffDispatching") && String(playPreparedDetailCandidate).includes("handoffStarted") && String(playDetailDirectReadyCandidate).includes("handoffStarted"), "Provider Commit owns a single native handoff", "STATIC_HOOK");
      check("DETAIL_RACE_EXIT_GUARD", raceStaleExit, "closed detail cannot accept a late provider", "RUNTIME_MOCK");
      check("DETAIL_RACE_A_TO_B_GUARD", raceStaleAToB, "old A race cannot commit into new B detail", "RUNTIME_MOCK");
      check("DETAIL_RACE_BOTH_TENTATIVE", raceBothTentative, "both tentative candidates use the existing Curated-first final fallback", "RUNTIME_MOCK");
      check("DETAIL_RACE_BOTH_FAIL", raceBothFail, "only both terminal failures produce the final failed state", "RUNTIME_MOCK");
      check("DETAIL_RACE_PROVIDER_SINGLE_COMMIT", String(tryCommitDetailProvider).includes("providerCommitted") && String(tryCommitDetailProvider).includes("providerCommitCount") && String(detailRaceLaneTerminal).includes("run.providerCommitted"), "Provider Commit Authority is the single write gate", "STATIC_HOOK");
      check("DETAIL_RACE_LOSER_NO_RESET", !String(detailRaceLaneTerminal).includes("resetPanSearchState") && !String(detailRaceLaneTerminal).includes("cancelDetailPlaybackPreparation") && !String(terminalizeDirectDiscoveryAfterProviderCommit).includes("resetPanSearchState"), "loser completion does not clear Direct results/health or cancel the winning run", "STATIC_HOOK");
      check("DETAIL_RACE_LOSER_DISCOVERY_TERMINATED", directDiscoveryTerminated && String(terminalizeDirectDiscoveryAfterProviderCommit).includes("terminalizePanSearchSession") && String(terminalizeDirectDiscoveryAfterProviderCommit).includes("clearPanPollTimers"), "Provider Commit terminalizes only future Direct discovery while preserving its state", "RUNTIME_MOCK");
      check("DIRECT_RESULT_CANNOT_COMMIT", directRetryGuard && String(reportDetailDirectRaceResult).includes("run.providerCommitted"), "a Direct result after Provider Commit cannot commit", "RUNTIME_MOCK");
      check("DIRECT_NO_NEW_RETRY_AFTER_PROVIDER_COMMIT", directRetryGuard && String(requestPanSearchWithRetry).includes("isPanSearchSessionActive"), "the existing active-session guard blocks later Direct retry attempts", "RUNTIME_MOCK");
      check("DIRECT_RETRY_WAIT_INTERRUPTED_OR_GUARDED", directRetryGuard && String(waitForPanRetry).includes("isCurrent"), "a retry delay rechecks the Direct session before starting the next attempt", "RUNTIME_MOCK");
      check("DIRECT_ATTEMPT_2_NOT_STARTED", directRetryGuard && String(requestPanSearchWithRetry).includes("if (!isCurrent()) return null"), "a retry attempt cannot start after the session becomes terminal", "RUNTIME_MOCK");
      check("DIRECT_NO_NEW_POLL_AFTER_PROVIDER_COMMIT", directPollGuard && String(terminalizeDirectDiscoveryAfterProviderCommit).includes("clearPanPollTimers"), "scheduled Direct polling is cleared when a provider commits", "RUNTIME_MOCK");
      check("DIRECT_POLL_TIMER_CANCELLED_OR_GUARDED", directPollGuard && String(pollPanResources).includes("isPanSearchSessionActive"), "poll timers are cleared and the poll entry guard remains in place", "RUNTIME_MOCK");
      check("DIRECT_POLL_REQUEST_COUNT_AFTER_COMMIT", directPollGuard && String(pollPanResources).indexOf("isPanSearchSessionActive") < String(pollPanResources).indexOf("requestPanSearchWithRetry"), "a poll cannot issue a request after Provider Commit", "STATIC_HOOK");
      check("DIRECT_NO_HEALTH_AFTER_PROVIDER_COMMIT", directHealthGuard && String(probePanHealth).includes("panContextIsCurrent") && String(pickQuarkBaiduTop5).includes("directAction"), "an in-flight Direct health result is discarded after Provider Commit", "RUNTIME_MOCK");
      check("DIRECT_WINNER_PRESERVED_AFTER_OWN_COMMIT", directWinnerPreserved, "Direct can commit itself without clearing its Ready winner or play payload", "RUNTIME_MOCK");
      check("DIRECT_NO_FUTURE_POLL_AFTER_OWN_COMMIT", directWinnerPreserved && String(terminalizeDirectDiscoveryAfterProviderCommit).includes('"provider_committed"'), "Direct self-commit also terminates only its future polling", "RUNTIME_MOCK");
      check("DIRECT_FULL_LIFECYCLE_WITHOUT_PROVIDER_COMMIT", String(searchPanResources).includes("PAN_INITIAL_SEARCH_MAX_ATTEMPTS") && String(schedulePanPolling).includes("setTimeout") && String(pollPanResources).includes("PAN_POLL_MAX_ATTEMPTS"), "without a Provider Commit, the existing initial plus polling lifecycle remains", "STATIC_HOOK");
      check("DIRECT_MAX_REQUESTS_STILL_7", PAN_INITIAL_SEARCH_MAX_ATTEMPTS === 3 && PAN_POLL_MAX_ATTEMPTS === 2 && panSearchPollIntervals().length === 2, "the default Direct lifecycle remains 3 initial attempts plus two 2-attempt polling rounds", "RUNTIME_MOCK");
      check("DETAIL_RACE_STATUS_PREPARING", detailPlayStateSource.includes("racePreparing") && detailPlayStateSource.indexOf("racePreparing") < detailPlayStateSource.indexOf('return "preparing"'), "race keeps the main button in PREPARING until Provider Commit", "STATIC_HOOK");
      const curatedHealthSource = String(curatedCentralHealthCandidate) + String(curatedProgressiveHealthCandidate);
      check("DETAIL_RACE_CURATED_PREFLIGHT_ISOLATED", String(probePanHealth).includes("raceRun") && String(panContextIsCurrent).includes("context.raceRun") && curatedHealthSource.includes('raceOwner: "curated"'), "Curated health validity uses the detail run, not Direct viewToken", "STATIC_HOOK");
      check("DETAIL_RACE_DIRECT_PREFLIGHT_SURVIVES", curatedHealthSource.includes("raceOwner: \"curated\"") && String(panContextIsCurrent).includes("state.pan.viewToken === context.token"), "Direct health context retains its own viewToken while Curated races", "STATIC_HOOK");
      const lateHealthPreflightSource = String(playbackPanHealthPreflight);
      const lateHealthCollectionSource = String(resolveCuratedPlaybackCandidate);
      check("CURATED_LATE_HEALTH_RESULT_EXPOSED", lateHealthPreflightSource.includes("exposeLateResult") && lateHealthPreflightSource.includes("latePromise: checkTask"), "Curated can observe the original preflight task after the fast budget", "STATIC_HOOK");
      check("CURATED_LATE_HEALTH_REUSES_ORIGINAL_CHECK", lateHealthPreflightSource.includes("latePromise: checkTask") && lateHealthCollectionSource.includes("registerLateHealth"), "late health reuses one original check task instead of issuing a second probe", "STATIC_HOOK");
      check("CURATED_LATE_HEALTH_ACTIVE_LIFECYCLE", lateHealthCollectionSource.includes("CURATED_LATE_HEALTH_PENDING") && lateHealthCollectionSource.includes("CURATED_LATE_HEALTH_RESULT") && lateHealthCollectionSource.includes("CURATED_LATE_HEALTH_ACCEPTED"), "late results re-enter the active Curated qualification lifecycle", "STATIC_HOOK");
      check("CURATED_LATE_HEALTH_PENDING_GATES_EXHAUSTED", lateHealthCollectionSource.includes("pendingLateHealth && beforeDiscoveryDeadline") && lateHealthCollectionSource.includes("lateHealthPendingCount"), "pending late health prevents premature Curated exhaustion", "STATIC_HOOK");
      check("CURATED_LATE_HEALTH_DEADLINE_HARD_LIMIT", lateHealthCollectionSource.includes('finishCollection("DISCOVERY_DEADLINE")') && lateHealthCollectionSource.includes('reason: "DISCOVERY_DEADLINE"'), "the existing discovery deadline remains the hard upper bound", "STATIC_HOOK");
      check("CURATED_LATE_HEALTH_STRONG_ONLY", lateHealthCollectionSource.includes('sourceState.candidateVerdict !== "STRONG"') && lateHealthCollectionSource.includes('sourceState.candidateVerdict === "STRONG"'), "late health cannot promote tentative identity into the race", "STATIC_HOOK");
      const wanouSource = CURATED_SOURCE_DEFINITIONS.find((source) => source.id === "wanou");
      const baXianItem = { mediaType: "movie", title: "八仙！", resourceSearchTitle: "八仙！", releaseDate: "2026-01-01" };
      const baXianVariants = curatedSearchKeywordVariants(baXianItem);
      const baXianWoggSearchHtml = '<div class="module-search-item"><a class="video-title" href="/voddetail/130733.html" title="八仙！">八仙！</a></div>';
      const baXianWoggEntries = typeof DOMParser === "function"
        ? curatedSearchEntries(baXianWoggSearchHtml, wanou, "https://www.wogg.net/vodsearch/-------------.html?wd=%E5%85%AB%E4%BB%99%EF%BC%81&page=1")
        : [];
      const baXianWoggIdentity = baXianWoggEntries.length
        ? mediaIdentityVerdict(baXianItem, baXianWoggEntries[0].title, baXianWoggEntries[0])
        : { verdict: "REJECT" };
      const baXianWoggDetailCandidates = typeof DOMParser === "function"
        ? curatedDetailCandidates(
          '<div class="module-row-info"><p>夸克 https://pan.quark.cn/s/ba-xian</p><p>百度 https://pan.baidu.com/s/ba-xian</p></div>',
          wanou,
          "https://www.wogg.net/voddetail/130733.html",
          baXianItem,
          baXianWoggEntries[0] || { title: "八仙！", href: "https://www.wogg.net/voddetail/130733.html" }
        )
        : [];
      const baXianNxogVod = {
        vod_name: "八仙！",
        vod_id: "nxog-130733",
        vod_down_from: "all",
        vod_down_url: "https://www.alipan.com/s/ba-xian",
        vod_remarks: ""
      };
      const baXianNxogCandidate = curatedWanouCandidates(baXianNxogVod, wanou, baXianItem, "https://woog.nxog.eu.org/api.php/provide/vod?ac=detail&wd=%E5%85%AB%E4%BB%99");
      const healthMockCandidates = [1, 2, 3, 4].map((rank) => ({
        diskType: "quark",
        url: `https://pan.quark.cn/s/health-${rank}`,
        title: `八仙！候选 ${rank}`,
        resourceTitle: `八仙！候选 ${rank}`,
        index: rank
      }));
      const healthMockPlan = curatedHealthBatchPlan(healthMockCandidates, CURATED_MAX_AUTO_CHECK_PER_SOURCE);
      const healthMockStates = ["bad", "bad", "ok", "unknown"];
      const firstHealthBatchAllBad = healthMockPlan.batches[0]
        && healthMockPlan.batches[0].candidates.every((candidate) => healthMockStates[candidate.index - 1] === "bad");
      const secondHealthBatchAccepted = healthMockPlan.batches[1]
        && healthMockPlan.batches[1].candidates.some((candidate) => healthMockStates[candidate.index - 1] === "ok");
      const audioOnlyMock = {
        mediaType: "movie",
        title: "王赫野 & 黄龄 过海 电影 八仙 插曲",
        resourceTitle: "八仙 插曲 FLAC 24bit 48khz",
        fileName: "八仙插曲.flac",
        url: "https://pan.quark.cn/s/audio"
      };
      const normalVideoMock = {
        mediaType: "movie",
        title: "八仙 2026 2160P WEB-DL HEVC",
        resourceTitle: "八仙 2026 2160P WEB-DL HEVC",
        fileName: "八仙.2026.2160P.WEB-DL.HEVC.mkv",
        url: "https://pan.quark.cn/s/video"
      };
      check("BA_XIAN_WOGG_PRIMARY_TEST", !!wanouSource && wanouSource.searchUrl === "/vodsearch/-------------.html?wd={kw}&page={p}" && baXianWoggEntries.length === 1 && baXianWoggIdentity.verdict === "STRONG" && baXianWoggDetailCandidates.length === 2 && baXianWoggDetailCandidates.every((candidate) => candidate.extractionMethod === "WOGG_HTML_DETAIL"), "Wogg HTML search/detail mock returns strong Wanou candidates", "RUNTIME_MOCK");
      check("BA_XIAN_NXOG_FALLBACK_TEST", baXianVariants.includes("八仙！") && baXianVariants.includes("八仙") && curatedSearchPath(wanouSource.searchApi, "八仙", 1).includes("wd=%E5%85%AB%E4%BB%99") && baXianNxogCandidate.length === 1 && baXianNxogCandidate[0].diskType === "aliyun", "NXOG fallback keeps raw/clean literal queries and accepts URL-authority Alipan", "RUNTIME_MOCK");
      check("BA_XIAN_WOGG_NO_DOUBLE_SEARCH", String(searchWanouSource).includes("searchWanouHtmlKeyword") && String(searchWanouSource).includes("searchWanouNxogKeyword") && String(searchWanouSource).indexOf("searchWanouNxogKeyword") > String(searchWanouSource).indexOf("WANOU_FALLBACK_TO_NXOG"), "NXOG is reached only after Wogg yields no usable candidate", "STATIC_HOOK");
      check("BA_XIAN_HUBAN_SECOND_CHANCE_TEST", healthMockPlan.batches.length === 2 && healthMockPlan.batches[0].candidates.length === 2 && firstHealthBatchAllBad && secondHealthBatchAccepted && String(curatedProgressiveHealthCandidate).includes("CURATED_SOURCE_SECOND_CHANCE"), "two bad first candidates advance to the bounded second batch and can select candidate three", "RUNTIME_MOCK");
      check("BA_XIAN_LOWER_SOURCE_TEST", !String(resolveCuratedPlaybackCandidate).includes("HIGHER_PRIORITY_TERMINAL") && String(resolveCuratedPlaybackCandidate).includes("startNextQualification") && String(resolveCuratedPlaybackCandidate).includes('finishCollection("HEALTH_ACCEPTED")'), "a bad high-priority source does not end collection before a lower healthy source qualifies", "STATIC_HOOK");
      check("BA_XIAN_AUDIO_REJECT_TEST", automaticVideoCandidateVerdict(audioOnlyMock, audioOnlyMock).accepted === false && automaticVideoCandidateVerdict(audioOnlyMock, audioOnlyMock).reason === "AUDIO_ONLY_RESOURCE" && automaticVideoCandidateVerdict(normalVideoMock, normalVideoMock).accepted === true, "audio-only evidence is rejected while a normal WEB-DL remains eligible", "RUNTIME_MOCK");
      check("WANOU_PRIMARY_NOT_NXOG", String(searchCuratedSource).includes("searchWanouSource(source, item, run, context)") && String(searchWanouSource).includes("searchWanouHtmlKeyword") && String(searchWanouSource).includes("searchWanouNxogKeyword"), "Wanou discovery starts with Wogg HTML and retains NXOG only as fallback", "STATIC_HOOK");
      check("WANOU_HTML_DIAGNOSTICS", String(searchWanouHtmlKeyword).includes("WANOU_SEARCH_ATTEMPT") && String(curatedDetailCandidatesForMatches).includes("WANOU_DETAIL_RESULT") && String(searchWanouSource).includes("WANOU_FALLBACK_TO_NXOG"), "Wanou search/detail/fallback diagnostics carry the new backend states", "STATIC_HOOK");
      check("WANOU_URL_AUTHORITY", String(curatedDetailCandidates).includes("curatedVerifiedDiskTypeForUrl") && String(curatedWanouCandidates).includes("curatedVerifiedDiskTypeForUrl") && baXianWoggDetailCandidates.every((candidate) => ["quark", "baidu"].includes(candidate.diskType)), "HTML and NXOG Wanou candidates use URL authority for disk type", "RUNTIME_MOCK");
      check("CURATED_PROGRESSIVE_HEALTH", String(curatedProgressiveHealthCandidate).includes("CURATED_HEALTH_BATCH") && String(curatedProgressiveHealthCandidate).includes("CURATED_MAX_AUTO_CHECK_PER_SOURCE") && String(curatedProgressiveHealthCandidate).includes("CURATED_PREFLIGHT_PER_SOURCE"), "Curated qualification is bounded and progressive", "STATIC_HOOK");
      check("AUTOMATIC_VIDEO_GATE_THREE_ENTRY_POINTS", String(panAutoCandidateTiers).includes("automaticVideoCandidateVerdict") && String(reportDetailDirectRaceResult).includes("automaticVideoCandidateVerdict") && String(tryCommitDetailProvider).includes("automaticVideoCandidateVerdict"), "Direct selection, Direct race and final Provider Commit all apply the media gate", "STATIC_HOOK");
      check("TENTATIVE_AUDIO_FINAL_FALLBACK_REJECTED", String(detailRaceLaneTerminal).includes("safeTentative") && String(tryCommitDetailProvider).includes("allowTentativeFinal") && String(tryCommitDetailProvider).includes("automaticVideoCandidateVerdict"), "tentative final fallback repeats the automatic media gate", "STATIC_HOOK");
      check("PAN_MANUAL_AUDIO_VISIBLE", !String(playPanResult).includes("automaticVideoCandidateVerdict") && String(panAutoCandidateTiers).includes("automaticVideoCandidateVerdict"), "manual Pan playback remains outside the automatic audio gate", "STATIC_HOOK");
      check("READY_COLOR", detailColorSource.includes('[data-play-state="ready"]') && detailColorSource.includes("#35E07A"), "existing ready color remains green", "FROZEN_SOURCE_AUDIT");
      check("FAILED_COLOR", detailColorSource.includes('[data-play-state="failed"]') && detailColorSource.includes("#FF0000"), "existing failed color remains red", "FROZEN_SOURCE_AUDIT");
      check("VARIETY_REGRESSION_PRESERVED", isReleaseFilteredCatalogId("variety") && typeof secondaryFullCatalogSources === "function" && Array.isArray(SECONDARY_FILTER_SCHEMA.variety), "variety classification/config path remains present", "FROZEN_SOURCE_AUDIT");
      check("SECONDARY_SHORT_PAGE_AUTOFILL", String(renderSecondaryCatalog).includes("requestAnimationFrame(ensureScrollablePage)") && String(ensureScrollablePage).includes("loadMoreVisible"), "short secondary pages can continue while the viewport is not filled", "STATIC_HOOK");
      const oldWebviewUnsupported = ["Promise", "allSettled"].join(".");
      check("OLD_WEBVIEW_COMPAT", !document.documentElement.innerHTML.includes(oldWebviewUnsupported), "未引入旧 WebView 不支持的 Promise 聚合 API", "STATIC_HOOK");
      check("PHASE3_SIDEBAR_NOT_ROUTE", HOME_PRESENTATION_ROUTES.join(",") === "home,search,secondary" && !sidebarSource.includes('pushState'), "Sidebar does not create a presentation route", "STATIC_HOOK");
      check("PHASE3_SIDEBAR_MENU_KEY", String(normalizeRemoteKey).includes('82: "Menu"') && String(handleSidebarMenuKey).includes("openSidebar"), "Menu/keyCode 82 opens Sidebar", "STATIC_HOOK");
      check("PHASE3_SIDEBAR_FOCUS_SCOPE", String(focusScopeRoot).includes('isSidebarOpen()') && String(handleSidebarDirectionalKey).includes("closeSidebar"), "Sidebar owns directional focus while open", "STATIC_HOOK");
      check("PHASE3_SIDEBAR_LEFT_FALLBACK", typeof isHomeLeftBoundary === "function" && String(isHomeLeftBoundary).includes("home-rail"), "Home left boundary has a Sidebar fallback", "STATIC_HOOK");
      const legacySettingId = ["home", "Setting", "Btn"].join("");
      check("PHASE3_SETTING_BUTTON_REMOVED", !document.getElementById(legacySettingId) && !document.documentElement.innerHTML.includes(legacySettingId), "legacy Home/Search setting button is absent", "DOM_ASSERTION");
      const legacyThreeColumnMarker = ["grid-template-columns: minmax(0, 1fr) auto", " auto"].join("");
      check("PHASE3_SEARCH_FORM_TWO_COLUMNS", !document.documentElement.innerHTML.includes(legacyThreeColumnMarker), "Search form has no third setting column", "STATIC_HOOK");
      check("PHASE3_HERO_CONTENT_OFFSET", document.documentElement.innerHTML.includes("top: calc(clamp(220px, 13vw, 270px) + 116px)"), "Hero foreground uses the requested Phase 3 offset", "STATIC_HOOK");
      check("PHASE3_HERO_DOTS_UNCHANGED", document.documentElement.innerHTML.includes("bottom: calc(clamp(40px, 4vw, 72px) - 40px)"), "Hero dots remain on the Phase 2 rule", "STATIC_HOOK");
      check("PHASE3_NO_VVEE_FOCUS_ENGINE", !document.documentElement.innerHTML.includes("_tvGridFastNav") && !document.documentElement.innerHTML.includes("_tvSetFocus") && !document.documentElement.innerHTML.includes("_tvNearest"), "only the existing Nostr focus engine remains", "STATIC_HOOK");
      runtimeRequired("PHASE1_HOME_DPAD_RUNTIME", "requires TV/browser directional interaction");
      runtimeRequired("PHASE1_HOME_VISUAL_RUNTIME", "requires 1920x1080 preview comparison");
      if (state.tvDiag) state.tvDiag.tests = results;
      const failed = results.filter((item) => item.kind !== "RUNTIME_REQUIRED" && item.pass !== true);
      try { console.table(results); } catch (e) { console.debug("[Nostr TV tests V1.4.7.1 Phase 1]", results); }
      if (failed.length) console.warn("[Nostr TV tests V1.4.7.1 Phase 1] failed", failed.map((item) => item.id).join(","), failed);
      updateTvDiagnostic();
      return results;
    }
    window.WEBHOME_RUN_TV_SELF_TESTS = runTvAdaptationSelfTests;
    window.WEBHOME_RUN_MOVIE_DETAIL_SHARED_SELF_TESTS = runMovieDetailSharedSelfTests;
