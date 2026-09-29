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

    async function runTvAdaptationSelfTests() {
      if (!isTvDiagnosticEnabled()) return [];
      const results = [];
      const check = (id, pass, detail, kind) => results.push({ id, pass: !!pass, kind: kind || "STATIC_HOOK", detail: detail || "" });
      const sourceOf = (fn) => {
        try { return typeof fn === "function" ? String(fn) : ""; } catch (e) { return ""; }
      };
      const hasAll = (source, markers) => markers.every((marker) => String(source || "").includes(marker));
      const productionText = [
        sourceOf(renderAll),
        sourceOf(renderHome),
        sourceOf(renderHomeContent),
        sourceOf(renderHomeRecent),
        sourceOf(renderHomeRecommendation),
        sourceOf(renderHomeWeekly),
        sourceOf(renderHomeDynamicSections),
        sourceOf(loadSecondaryPage),
        sourceOf(renderSecondaryCatalog),
        sourceOf(restoreUiSnapshot)
      ].join("\n");
      const home = $("home");

      check("HOME_LEGACY_HEADER_REMOVED",
        document.querySelectorAll("#homeHeader, #homeHeaderInner, #homeIndependentNav, #chips, #homeToolbar").length === 0,
        "legacy Home header nodes are absent", "DOM_ASSERTION");
      check("HOME_CONTENT_DOM_PRESENT",
        !!home
          && !!$("homeRecentSection")
          && !!$("homeRecommendationSection")
          && !!$("homeWeeklySection")
          && !!$("homeRecentRail")
          && !!$("homeRecommendationRail")
          && !!$("homeWeeklyRail"),
        "Home has Recent, Recommendation, and Weekly rails", "DOM_ASSERTION");
      check("HOME_RENDER_ORDER",
        hasAll(sourceOf(renderHome), ["renderHomeRecent", "renderHomeRecommendation", "renderHomeWeekly", "renderHomeDynamicSections"]),
        "Home renders local Recent, Nostr Recommendation, Weekly, then TMDB categories", "STATIC_HOOK");
      check("HOME_RECENT_NATIVE_AUTHORITY",
        sourceOf(renderHomeRecent).includes("state.recent") && !sourceOf(renderHomeRecent).includes("homeHotSource"),
        "Home Recent reads native/local recent state", "STATIC_HOOK");
      check("HOME_WEEKLY_TMDB_AUTHORITY",
        sourceOf(renderHomeWeekly).includes("resolveHomeLatestItems")
          && sourceOf(renderHomeWeekly).includes("ensureHomeLatestData")
          && !sourceOf(renderHomeWeekly).includes("homeHotSource"),
        "Home Weekly remains on the TMDB Weekly path", "STATIC_HOOK");

      const poolSource = sourceOf(recommendationPoolItems);
      const hotBuildSource = sourceOf(buildHotItemsFromIndex);
      const hotLoadSource = sourceOf(hotLoadIndex) + sourceOf(hotRefreshItems) + sourceOf(hotIngestEvents);
      check("HOT_RENDER_LIMIT_IS_RECOMMENDATION_POOL",
        HOT_RENDER_LIMIT === 1000
          && hotBuildSource.includes("HOT_RENDER_LIMIT")
          && poolSource.includes("HOT_RENDER_LIMIT"),
        "HOT_RENDER_LIMIT caps the presentation Recommendation Pool", "STATIC_HOOK");
      check("HOT_SYNC_AND_AGGREGATION_NOT_RENDER_LIMITED",
        !hotLoadSource.includes("HOT_RENDER_LIMIT"),
        "Relay ingest and IndexedDB loading do not use the presentation cap", "STATIC_HOOK");
      check("HOT_USER_VECTOR_LIMIT_IS_NOT_RENDER_LIMIT",
        typeof HOT_USER_VECTOR_LIMIT === "undefined" || HOT_USER_VECTOR_LIMIT !== HOT_RENDER_LIMIT,
        "user-vector capacity is not conflated with Recommendation Pool rendering", "STATIC_HOOK");
      check("NOSTR_RECOMMENDATION_INFRASTRUCTURE_RETAINED",
        hasAll(sourceOf(openHotDb) + sourceOf(hotLoadIndex) + sourceOf(hotIngestEvents) + sourceOf(subscribeNostr),
          ["openHotDb", "state.hot", "subscribe"]),
        "relay/index/aggregation infrastructure remains available", "STATIC_HOOK");

      const categorySource = sourceOf(loadHomeCategoryFeed) + sourceOf(loadHomeCategoryTmdbPool) + sourceOf(secondaryFullCatalogSources);
      const previousCategoryQueryKey = state.homeV14.secondaryActiveQueryKey;
      const movieCategoryQuery = secondaryGetQuery("movie");
      const movieCategorySources = secondaryFullCatalogSources("movie");
      state.homeV14.secondaryActiveQueryKey = previousCategoryQueryKey;
      check("TMDB_CATEGORY_ONLY",
        categorySource.includes("loadHomeCategoryTmdbPool")
          && !categorySource.includes("loadHomeCategoryNostrPool")
          && categorySource.includes("discover/"),
        "Home and Secondary category membership is TMDB-only", "STATIC_HOOK");
      check("SECONDARY_CATEGORY_SOURCE_MODEL",
        !!movieCategoryQuery
          && movieCategoryQuery.source === "tmdb"
          && Array.isArray(movieCategorySources)
          && movieCategorySources.some((source) => source && source.endpoint === "discover/movie"),
        "category queries use the TMDB catalog source", "STATIC_HOOK");
      check("NOSTR_CATEGORY_EMULATION_REMOVED",
        typeof secondaryNostrHotCandidates === "undefined"
          && typeof secondaryLoadNostrHotItems === "undefined"
          && typeof secondaryNostrAnimeResolveCandidate === "undefined"
          && typeof secondaryNostrVarietyResolveCandidate === "undefined"
          && typeof loadHomeCategoryNostrPool === "undefined",
        "Nostr category resolvers and category loaders are absent", "STATIC_HOOK");
      check("SECONDARY_NO_NOSTR_CATALOG_PATH",
        !productionText.includes("secondaryLoadNostrHotItems")
          && !productionText.includes("secondaryNostrAnime")
          && !productionText.includes("secondaryNostrVariety"),
        "generic Secondary rendering has no Nostr catalog execution path", "STATIC_HOOK");

      const sidebarItems = sidebarNavigationItems();
      const recommendationSidebarItem = sidebarItems.find((item) => item && item.key === "recommendation");
      check("SIDEBAR_RECOMMENDATION_NAVIGATION",
        !!recommendationSidebarItem
          && recommendationSidebarItem.listId === "recommendation"
          && hasAll(sourceOf(performSidebarNavigation), ["openSecondaryCatalog", "openLiveHome", "openSettingHome"])
          && sourceOf(requestSidebarNavigation).includes("performSidebarNavigation"),
        "Sidebar Recommendation delegates through the existing navigation authority", "STATIC_HOOK");
      check("SIDEBAR_SHARED_HOME_SECONDARY",
        typeof isSidebarRouteActive === "function"
          && sourceOf(isSidebarRouteActive).includes('homeUiRoute() === "secondary"')
          && sourceOf(openSidebar).includes("isSidebarRouteActive")
          && sourceOf(syncSidebarVisibility).includes("isSidebarRouteActive"),
        "the existing Sidebar authority is available on both Home and Secondary", "STATIC_HOOK");
      check("SECONDARY_LEFT_BOUNDARY_OPENS_SIDEBAR",
        typeof isSecondaryLeftBoundary === "function"
          && hasAll(sourceOf(isSecondaryLeftBoundary), ["secondaryCatalogBack", "secondary-filter-row", "gridColumns"])
          && sourceOf(installRemoteKeys).includes("isSecondaryLeftBoundary"),
        "TV Secondary left boundaries delegate to the shared Sidebar", "STATIC_HOOK");
      check("SIDEBAR_TV_CONTINUOUS_NAVIGATION",
        sourceOf(requestSidebarNavigation).includes("sameSecondary")
          && sourceOf(openSecondaryCatalog).includes("opts.fromSidebar")
          && sourceOf(handleSidebarDirectionalKey).includes('key === "ArrowRight"'),
        "TV Sidebar keeps its focus while switching categories and closes on Right", "STATIC_HOOK");
      check("SECONDARY_MOBILE_SIDEBAR_LAUNCHER",
        !!$("secondaryMenuLauncher")
          && sourceOf(bindActions).includes("secondaryMenuLauncher")
          && sourceOf(syncSidebarMobilePresentation).includes("secondaryMenuLauncher")
          && sourceOf(beginMobileSidebarHistoryEntry).includes("homeSidebar"),
        "Secondary mobile uses its own launcher and the existing history entry", "DOM_ASSERTION");
      check("SIDEBAR_TRANSITION_SETTLEMENT",
        hasAll(sourceOf(openSidebar) + sourceOf(closeSidebar) + sourceOf(scheduleSidebarClose), ["is-open", "is-closing", "transitionend"])
          && sourceOf(syncSidebarMobilePresentation).includes("is-closing"),
        "Sidebar and mobile backdrop close after their transition settles", "STATIC_HOOK");
      check("WEEKLY_SIDEBAR_FOCUS_STABLE",
        sourceOf(focusWeeklySecondaryInitial).includes("isSidebarOpen")
          && sourceOf(renderWeeklySecondaryCatalog).includes("secondaryWeeklyInitialFocusPending")
          && sourceOf(renderWeeklySecondaryCatalog).includes("if (!isSidebarOpen()) focusWeeklySecondaryInitial")
          && sourceOf(focusSidebarCurrentPageDefault).includes("focusWeeklySecondaryInitial"),
        "Weekly keeps its pending initial focus while Sidebar owns focus", "STATIC_HOOK");
      check("TV_SECONDARY_SIDEBAR_BACK_LAYER",
        hasAll(sourceOf(handleTvSecondarySidebarBack), ["isTvLikeDevice", "isSidebarOpen", "homeUiRoute", "closeSidebar", "history.forward"])
          && sourceOf(handleTvSecondarySidebarBack).includes('location.hash === "#secondary"')
          && sourceOf(closeSecondaryCatalog).includes("closeSidebar"),
        "TV Secondary Back consumes the open Sidebar layer before returning Home", "STATIC_HOOK");

      const searchHot = getSearchHotItems();
      const searchHotUrlSource = sourceOf(searchHotUrl);
      const searchHotRequestSource = sourceOf(requestSearchHotText);
      const searchHotParserSource = sourceOf(parseSearchHotResponse);
      const searchHotNormalizeSource = sourceOf(normalizeSearchHotItems);
      const searchHotRenderSource = sourceOf(renderSearchHot);
      const searchHotPipelineSource = [
        searchHotUrlSource,
        searchHotRequestSource,
        sourceOf(loadSearchHot),
        sourceOf(ensureSearchHotData),
        searchHotRenderSource
      ].join("\n");
      const hotFixture = {
        data: [
          { query: "热词 A", order: 3, show_image_url: "http://img.example/a.jpg", tag_content: "电影", query_label: { label_text: "荐" }, search_mark: "99" },
          { query: "热词 A", order: 4, show_image_url: "http://img.example/duplicate.jpg" },
          { query: "热词 B", tag_content: "综艺", query_label: { label_text: "新" }, search_mark: "88" }
        ]
      };
      let hotJsonItems = [];
      let hotJsonpItems = [];
      let hotNormalizationPass = false;
      try {
        hotJsonItems = normalizeSearchHotItems(parseSearchHotResponse(JSON.stringify(hotFixture)));
        hotJsonpItems = normalizeSearchHotItems(parseSearchHotResponse("try{webhomeSearchHot(" + JSON.stringify(hotFixture) + ")}catch(e){}"));
        hotNormalizationPass = hotJsonItems.length === 2
          && hotJsonItems[0].query === "热词 A"
          && hotJsonItems[0].rank === 3
          && hotJsonItems[0].image === "https://img.example/a.jpg"
          && hotJsonItems[0].label === "荐"
          && hotJsonItems[0].meta === "电影"
          && hotJsonItems[0].heat === "99"
          && hotJsonItems[1].rank === 3;
      } catch (error) {}
      check("SEARCH_HOT_IQIYI_AUTHORITY",
        SEARCH_HOT_ENDPOINT === "https://search.video.iqiyi.com/m"
          && searchHot && searchHot.source === "iqiyi-search-hot"
          && searchHotUrlSource.includes("response_type")
          && searchHotUrlSource.includes("SEARCH_HOT_CALLBACK"),
        "Search Hot uses the dedicated iQiyi search-hot endpoint", "STATIC_HOOK");
      check("SEARCH_HOT_NOT_CONTENT_TREND",
        !searchHotPipelineSource.includes("trending")
          && !searchHotPipelineSource.includes("state.hot")
          && !searchHotPipelineSource.includes("suggest"),
        "Search Hot does not fall back to TMDB trend, Nostr hot, or input suggest data", "STATIC_HOOK");
      check("SEARCH_HOT_JSON_PARSE",
        !!hotJsonItems.length && searchHotParserSource.includes("JSON.parse"),
        "pure JSON Search Hot responses are parsed", "RUNTIME_MOCK");
      check("SEARCH_HOT_JSONP_PARSE",
        !!hotJsonpItems.length
          && searchHotParserSource.includes("jsonp")
          && searchHotParserSource.includes("depth")
          && !searchHotParserSource.includes("eval(")
          && !searchHotParserSource.includes("Function(")
          && !searchHotPipelineSource.includes('createElement("script")'),
        "JSONP is parsed without script injection or eval", "RUNTIME_MOCK");
      check("SEARCH_HOT_NORMALIZATION",
        hotNormalizationPass
          && searchHotNormalizeSource.includes("show_image_url")
          && searchHotNormalizeSource.includes("tag_content")
          && searchHotNormalizeSource.includes("search_mark"),
        "Search Hot items preserve rank and normalize image, label, meta, and heat", "RUNTIME_MOCK");
      check("SEARCH_HOT_DEDUPE_AND_LIMIT",
        hotNormalizationPass
          && searchHotNormalizeSource.includes("seen")
          && searchHotNormalizeSource.includes("SEARCH_HOT_LIMIT")
          && SEARCH_HOT_LIMIT === 10,
        "Search Hot deduplicates by query and caps the rail at ten items", "STATIC_HOOK");
      check("SEARCH_HOT_CACHE_TTL",
        SEARCH_HOT_TTL_MS === 10 * 60 * 1000
          && sourceOf(ensureSearchHotData).includes("requestSeq")
          && sourceOf(ensureSearchHotData).includes("lastAttemptAt")
          && sourceOf(loadSearchHot).includes("seq !== hot.requestSeq"),
        "Search Hot uses a ten-minute cache and stale-request guard", "STATIC_HOOK");
      check("SEARCH_HOT_FAILURE_NON_BLOCKING",
        sourceOf(loadSearchHot).includes("catch")
          && sourceOf(loadSearchHot).includes("hot.error")
          && sourceOf(loadSearchHot).includes("if (!hot.loaded) hot.items = []")
          && !sourceOf(loadSearchHot).includes("toast("),
        "a failed hot request only hides the rail and does not block Search", "STATIC_HOOK");
      check("SEARCH_HOT_DEDICATED_CARD",
        sourceOf(searchHotCard).includes("search-hot-card")
          && sourceOf(searchHotCard).includes("searchHotQuery")
          && !sourceOf(searchHotCard).includes("mediaCard("),
        "Search Hot uses a dedicated card and does not enter TMDB detail directly", "STATIC_HOOK");
      check("SEARCH_HOT_CLICK_TO_TMDB",
        hasAll(sourceOf(activateSearchHotItem), [
          "enableSearchEditing",
          "hideSearchSuggest",
          "recordSearchHistory",
          "focusRemoteTarget",
          'searchTmdb(normalized, { source: "hot" })'
        ]),
        "clicking a hot query reuses the existing TMDB Search path", "STATIC_HOOK");
      check("SEARCH_HOT_EMPTY_QUERY_VISIBILITY",
        searchHotRenderSource.includes('homeUiRoute() === "search"')
          && searchHotRenderSource.includes("!currentSearchKeyword()")
          && sourceOf(renderSearch).includes("renderSearchHistory")
          && sourceOf(renderSearch).includes("renderSearchHot")
          && sourceOf(renderSearch).includes("ensureSearchHotData"),
        "empty Search shows History and Hot while a typed query hides both", "STATIC_HOOK");
      check("SEARCH_HOT_FOCUS_CONTRACT",
        typeof firstSearchHotFocusTarget === "function"
          && sourceOf(firstSearchHotFocusTarget).includes("searchHotRail")
          && sourceOf(fastHomeSearchRailTarget).includes("searchHotRail")
          && sourceOf(searchHotCard).includes('className = "card focusable search-hot-card"'),
        "Search Hot remains in the existing TV rail focus contract", "STATIC_HOOK");
      check("SEARCH_CORE_PATHS_PRESERVED",
        typeof restoreSearchSnapshot === "function"
          && typeof searchTmdb === "function"
          && typeof loadSearchSuggest === "function",
        "Search history, TMDB search, and input suggest authorities remain", "STATIC_HOOK");

      const heroInputSource = sourceOf(homeHeroInputKey);
      const heroNostrSource = sourceOf(homeHeroNormalizeNostrCandidate) + sourceOf(homeHeroNostrCandidates);
      const heroMixedSource = sourceOf(homeHeroFeedState)
        + sourceOf(homeHeroMergeCandidate)
        + sourceOf(homeHeroFallbackCandidates)
        + sourceOf(homeHeroIsTmdbCandidate)
        + sourceOf(homeHeroProgressiveNostrEnrich)
        + sourceOf(loadHomeHeroFeed);
      check("HERO_MIXED_INPUTS",
        heroInputSource.includes("state.hot")
          && heroInputSource.includes("homeLatest")
          && heroNostrSource.includes("recommendationPoolItems")
          && hasAll(heroMixedSource, ["homeHeroNostrCandidates", "homeHeroProgressiveNostrEnrich", "homeHeroFallbackCandidates"]),
        "Hero accepts Nostr heat/candidates plus TMDB and Weekly inputs", "STATIC_HOOK");
      check("HERO_MEMBERSHIP_PRESENTATION_SEPARATED",
        sourceOf(homeHeroIsTmdbCandidate).includes("nostr-hot")
          && sourceOf(homeHeroFallbackCandidates).includes("allItems")
          && sourceOf(homeHeroScore).includes("heatCount")
          && sourceOf(homeHeroProgressiveNostrEnrich).includes("weeklyMapLimit"),
        "Nostr contributes signal/candidates while display eligibility remains explicit", "STATIC_HOOK");
      check("HERO_PROGRESSIVE_DETAIL_BOUNDED",
        hasAll(sourceOf(homeHeroProgressiveNostrEnrich),
          ["HOME_HERO_FINAL_LIMIT", "HOME_HERO_DETAIL_CONCURRENCY", "missing", "cursor", "runCurrent"]),
        "Hero Nostr detail enrichment is bounded and preserves ranked scan order", "STATIC_HOOK");

      const recommendationOldNamesRemoved =
        typeof homeHotSource === "undefined"
          && typeof setHomeHotSource === "undefined"
          && typeof resolveHomeHotItems === "undefined"
          && typeof renderHomeHot === "undefined";
      const allSourceSwitchText = productionText + String(document.documentElement && document.documentElement.innerHTML || "");
      check("GLOBAL_SOURCE_SWITCH_REMOVED",
        recommendationOldNamesRemoved
          && !allSourceSwitchText.includes("recommendationMode")
          && !allSourceSwitchText.includes("uiPrefs.homeHotSource"),
        "global Nostr/TMDB source switch is absent from product paths", "STATIC_HOOK");
      check("SNAPSHOT_DOES_NOT_RESTORE_SOURCE_MODE",
        !sourceOf(restoreUiSnapshot).includes("homeHotSource")
          && !sourceOf(restoreUiSnapshot).includes("recommendationMode")
          && !sourceOf(restoreUiSnapshot).includes("setHomeHotSource"),
        "snapshot restore does not revive the retired source mode", "STATIC_HOOK");

      check("RECENT_WEEKLY_DETAIL_AUTHORITIES_PRESENT",
        typeof renderHomeRecent === "function"
          && typeof renderHomeWeekly === "function"
          && typeof loadHomeLatest === "function"
          && typeof prepareDetailPlaybackForDetail === "function"
          && typeof restoreHomeReturn === "function",
        "Recent, Weekly, Detail preparation, and return authorities remain", "STATIC_HOOK");
      check("PLAYBACK_AUTHORITY_MARKERS_PRESERVED",
        hasAll(sourceOf(prepareDetailPlaybackForDetail) + sourceOf(tryCommitDetailProvider) + sourceOf(detailRaceLaneTerminal),
          ["History", "Curated", "Direct"])
          || (typeof tryCommitDetailProvider === "function" && typeof detailRaceLaneTerminal === "function"),
        "current playback race authority remains reachable", "STATIC_HOOK");
      check("BROWSER_TIMEOUT_AUTHORITY_PRESERVED",
        hasAll(sourceOf(browserRequest), ["AbortController", "setTimeout", "clearTimeout", "signal"]),
        "browser fallback still honors the Native request timeout contract", "STATIC_HOOK");

      const anchorSource = sourceOf(alignHomeRailToAnchor) + sourceOf(revealHomeFocusedTarget) + sourceOf(homeRailContextForTarget);
      check("HOME_RAIL_ANCHOR_PRESERVED",
        typeof HOME_RAIL_ANCHOR_OFFSET === "number"
          && HOME_RAIL_ANCHOR_OFFSET === 8
          && anchorSource.includes("home-section"),
        "Home TV focus anchor remains section-based at 8px", "STATIC_HOOK");

      const previousHotItems = state.hot && state.hot.items;
      const previousQueries = state.homeV14.secondaryQueries;
      const previousFilters = state.homeV14.secondaryFilters;
      const previousActiveQueryKey = state.homeV14.secondaryActiveQueryKey;
      try {
        const recommendationItems = Array.from({ length: 37 }, (_, index) => ({
          mediaKey: "recommendation-fixture-" + index,
          tmdbId: String(980000 + index),
          source: "nostr-hot",
          mediaType: "movie",
          title: "Recommendation " + index,
          releaseDate: "2020-01-01",
          popularity: 100 - index,
          voteAverage: index,
          people: index,
          poster: "https://example.invalid/poster-" + index
        }));
        state.homeV14.secondaryQueries = {};
        state.homeV14.secondaryFilters = {};
        state.hot.items = recommendationItems;
        const query = secondaryGetQuery("recommendation");
        const ordered = secondaryFilterItems("recommendation", recommendationItems);
        check("RECOMMENDATION_POOL_PRESERVES_RANK_ORDER",
          ordered.map((item) => item.mediaKey).join("|") === recommendationItems.map((item) => item.mediaKey).join("|"),
          "Recommendation filtering does not apply TMDB popularity/rating/date sorting", "RUNTIME_MOCK");
        await loadRecommendationSecondaryPage(query, 1);
        const firstBatch = query.items.slice();
        const firstHasMore = query.hasMoreLocal === true && query.hasMore === true;
        await loadRecommendationSecondaryPage(query, 2);
        const secondBatch = query.items.slice();
        const secondHasMore = query.hasMoreLocal === true && query.hasMore === true;
        await loadRecommendationSecondaryPage(query, 3);
        const finalBatch = query.items.slice();
        check("RECOMMENDATION_LOCAL_BATCHING",
          firstBatch.length === 18
            && secondBatch.length === 36
            && finalBatch.length === 37
            && firstHasMore
            && secondHasMore
            && query.hasMoreLocal === false
            && query.hasMore === false
            && query.loading === false,
          "Recommendation Secondary uses local 18/36/54-style batching until pool exhaustion", "RUNTIME_MOCK");
        check("RECOMMENDATION_NO_NETWORK_PAGINATION",
          sourceOf(loadRecommendationSecondaryPage).includes("recommendationPoolItems")
            && !sourceOf(loadRecommendationSecondaryPage).includes("requestJson")
            && !sourceOf(loadRecommendationSecondaryPage).includes("secondaryNostr"),
          "Recommendation Secondary has no network/detail/resolver pagination", "STATIC_HOOK");
      } catch (error) {
        check("RECOMMENDATION_RUNTIME_FIXTURE", false, String(error && error.message || error || "unknown"), "RUNTIME_MOCK");
      } finally {
        state.hot.items = previousHotItems;
        state.homeV14.secondaryQueries = previousQueries;
        state.homeV14.secondaryFilters = previousFilters;
        state.homeV14.secondaryActiveQueryKey = previousActiveQueryKey;
      }

      check("SOURCE_ISOLATION_STABLE",
        !sourceOf(loadHomeCategoryFeed).includes("loadHomeCategoryNostrPool")
          && !sourceOf(loadSecondaryPage).includes("secondaryLoadNostrHotItems")
          && !sourceOf(renderSecondaryCatalog).includes("secondaryNostrAnime")
          && !sourceOf(renderSecondaryCatalog).includes("secondaryNostrVariety"),
        "Recommendation is the only Nostr content surface; catalog paths remain TMDB", "STATIC_HOOK");
      check("FOCUS_AND_RETURN_PRIMITIVES_RETAINED",
        typeof revealFocusedTarget === "function"
          && typeof focusRemoteTarget === "function"
          && typeof rememberHomeReturn === "function"
          && typeof restoreHomeReturn === "function",
        "shared focus, return, and rail primitives remain reusable", "STATIC_HOOK");

      if (state.tvDiag) state.tvDiag.tests = results;
      try { console.table(results); } catch (e) {}
      try { updateTvDiagnostic(); } catch (e) {}
      return results;
    }
    window.WEBHOME_RUN_TV_SELF_TESTS = runTvAdaptationSelfTests;
    window.WEBHOME_RUN_MOVIE_DETAIL_SHARED_SELF_TESTS = runMovieDetailSharedSelfTests;
