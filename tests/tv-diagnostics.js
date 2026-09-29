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

      const homeHotMarkSource = sourceOf(markHomeHotVersion);
      const homeHeroInputSource = sourceOf(homeHeroInputKey);
      check("HOME_CATEGORY_SOURCE_IS_TMDB_ONLY",
        homeCategoryFeedKey("movie") === JSON.stringify(["movie", "tmdb"])
          && homeHotMarkSource.includes("state.hot.version")
          && !homeHotMarkSource.includes("invalidateHomeCategoryFeeds"),
        "Home category feed identity remains TMDB-only and independent from Nostr hot version marking", "STATIC_HOOK");

      const previousHotVersionForMark = state.hot.version;
      const previousCategoryFeedsForMark = state.homeV14.categoryFeeds;
      const categoryIdsForMark = ["movie", "tv", "anime", "documentary", "variety"];
      const categoryFeedFixture = {};
      categoryIdsForMark.forEach((id, index) => {
        const key = homeCategoryFeedKey(id);
        categoryFeedFixture[id] = {
          id,
          key,
          source: "tmdb",
          items: [{ mediaKey: "home-loading-fixture-" + id }],
          loading: id === "tv",
          loaded: id !== "tv",
          error: "",
          promise: id === "tv" ? Promise.resolve("inflight-fixture") : null,
          requestSeq: 40 + index,
          dataVersion: key,
          signature: key
        };
      });
      const categoryFeedSnapshot = categoryIdsForMark.reduce((snapshot, id) => {
        const feed = categoryFeedFixture[id];
        snapshot[id] = {
          key: feed.key,
          items: feed.items,
          loading: feed.loading,
          loaded: feed.loaded,
          error: feed.error,
          promise: feed.promise,
          requestSeq: feed.requestSeq,
          dataVersion: feed.dataVersion,
          signature: feed.signature
        };
        return snapshot;
      }, {});
      try {
        state.homeV14.categoryFeeds = categoryFeedFixture;
        markHomeHotVersion();
        const loadedFeedsPreserved = categoryIdsForMark
          .filter((id) => id !== "tv")
          .every((id) => {
            const before = categoryFeedSnapshot[id];
            const after = categoryFeedFixture[id];
            return after.key === before.key
              && after.items === before.items
              && after.loading === before.loading
              && after.loaded === before.loaded
              && after.error === before.error
              && after.promise === before.promise
              && after.requestSeq === before.requestSeq
              && after.dataVersion === before.dataVersion
              && after.signature === before.signature;
          });
        const inflightFeedPreserved = (() => {
          const before = categoryFeedSnapshot.tv;
          const after = categoryFeedFixture.tv;
          return after.key === before.key
            && after.items === before.items
            && after.loading === true
            && after.loaded === false
            && after.promise === before.promise
            && after.requestSeq === before.requestSeq;
        })();
        const categoryRequestSeqUnchanged = categoryIdsForMark.every((id) =>
          categoryFeedFixture[id].requestSeq === categoryFeedSnapshot[id].requestSeq);
        check("NOSTR_MARK_VERSION_INCREMENTS",
          Number(state.hot.version) === Number(previousHotVersionForMark || 0) + 1,
          "Nostr hot updates still advance the shared hot version", "RUNTIME_MOCK");
        check("NOSTR_MARK_DOES_NOT_INVALIDATE_HOME_CATEGORY",
          loadedFeedsPreserved && inflightFeedPreserved && categoryRequestSeqUnchanged,
          "markHomeHotVersion does not clear loaded or in-flight TMDB category feeds", "RUNTIME_MOCK");
        check("LOADED_CATEGORY_FEED_PRESERVED",
          loadedFeedsPreserved,
          "loaded TMDB category items and request state survive a Nostr update", "RUNTIME_MOCK");
        check("HOME_MOVIE_FEED_SURVIVES_NOSTR_UPDATE",
          loadedFeedsPreserved && categoryFeedFixture.movie.items === categoryFeedSnapshot.movie.items
            && categoryFeedFixture.movie.loaded === true
            && categoryFeedFixture.movie.requestSeq === categoryFeedSnapshot.movie.requestSeq,
          "Home Movie TMDB feed survives a Nostr hot update", "RUNTIME_MOCK");
        check("HOME_TV_FEED_SURVIVES_NOSTR_UPDATE",
          inflightFeedPreserved && categoryFeedFixture.tv.items === categoryFeedSnapshot.tv.items
            && categoryFeedFixture.tv.loaded === false
            && categoryFeedFixture.tv.requestSeq === categoryFeedSnapshot.tv.requestSeq,
          "Home TV category feed state is not invalidated by a Nostr hot update", "RUNTIME_MOCK");
        check("HOME_ANIME_FEED_SURVIVES_NOSTR_UPDATE",
          loadedFeedsPreserved && categoryFeedFixture.anime.items === categoryFeedSnapshot.anime.items
            && categoryFeedFixture.anime.loaded === true
            && categoryFeedFixture.anime.requestSeq === categoryFeedSnapshot.anime.requestSeq,
          "Home Anime TMDB feed survives a Nostr hot update", "RUNTIME_MOCK");
        check("HOME_DOCUMENTARY_FEED_SURVIVES_NOSTR_UPDATE",
          loadedFeedsPreserved && categoryFeedFixture.documentary.items === categoryFeedSnapshot.documentary.items
            && categoryFeedFixture.documentary.loaded === true
            && categoryFeedFixture.documentary.requestSeq === categoryFeedSnapshot.documentary.requestSeq,
          "Home Documentary TMDB feed survives a Nostr hot update", "RUNTIME_MOCK");
        check("HOME_VARIETY_FEED_SURVIVES_NOSTR_UPDATE",
          loadedFeedsPreserved && categoryFeedFixture.variety.items === categoryFeedSnapshot.variety.items
            && categoryFeedFixture.variety.loaded === true
            && categoryFeedFixture.variety.requestSeq === categoryFeedSnapshot.variety.requestSeq,
          "Home Variety TMDB feed survives a Nostr hot update", "RUNTIME_MOCK");
        check("INFLIGHT_CATEGORY_FEED_PRESERVED",
          inflightFeedPreserved,
          "in-flight TMDB category promise and loading state survive a Nostr update", "RUNTIME_MOCK");
        check("INFLIGHT_TMDB_FEED_NOT_INVALIDATED_BY_NOSTR",
          inflightFeedPreserved,
          "an in-flight TMDB category request is not cancelled by a Nostr update", "RUNTIME_MOCK");
        check("CATEGORY_REQUEST_SEQ_UNCHANGED",
          categoryRequestSeqUnchanged,
          "Nostr hot updates do not create a second TMDB category request generation", "RUNTIME_MOCK");
        check("NO_DUPLICATE_TMDB_CATEGORY_RELOAD",
          !homeHotMarkSource.includes("invalidateHomeCategoryFeeds")
            && categoryRequestSeqUnchanged,
          "Nostr hot updates do not invalidate and reload TMDB Home categories", "RUNTIME_MOCK");
        check("NO_DUPLICATE_CATEGORY_REQUEST_AFTER_NOSTR_UPDATE",
          !homeHotMarkSource.includes("invalidateHomeCategoryFeeds")
            && categoryRequestSeqUnchanged,
          "Nostr hot updates do not create a duplicate TMDB category request", "RUNTIME_MOCK");
      } catch (error) {
        check("NOSTR_HOME_CATEGORY_UPDATE_FIXTURE", false, String(error && error.message || error || "unknown"), "RUNTIME_MOCK");
      } finally {
        state.hot.version = previousHotVersionForMark;
        state.homeV14.categoryFeeds = previousCategoryFeedsForMark;
      }
      check("NOSTR_UPDATE_RECOMMENDATION_REFRESH",
        sourceOf(hotRefreshItems).includes("markHomeHotVersion")
          && sourceOf(hotRefreshItems).includes("state.hot.items")
          && sourceOf(hotRefreshItems).includes("scheduleRender"),
        "Nostr hot refresh still rebuilds and renders the Recommendation surface", "STATIC_HOOK");
      check("NOSTR_UPDATE_HERO_INVALIDATION",
        homeHeroInputSource.includes("hot.version")
          && homeHotMarkSource.includes("state.hot.version"),
        "Nostr hot version remains part of Hero input invalidation", "STATIC_HOOK");
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
      const searchHotCardSource = sourceOf(searchHotCard);
      const homeFocusSnapshotSource = sourceOf(homeFocusSnapshot);
      const searchHotReturnSource = sourceOf(findSearchHotReturnTarget);
      const homeReturnTargetSource = sourceOf(findHomeReturnTarget);
      const searchHotIdentitySource = sourceOf(searchHotIdentityEvidence);
      const searchHotResolveSource = sourceOf(resolveSearchHotTmdbItem);
      const searchHotActivateSource = sourceOf(activateSearchHotItem);
      const searchHotFallbackSource = sourceOf(activateSearchHotFallback);
      const searchHotStyleText = Array.from(document.querySelectorAll("style"))
        .map((style) => String(style.textContent || ""))
        .join("\n");
      const searchHotPortraitSelectorStart = searchHotStyleText.indexOf("html:not(.tv-mode):not(.tv-preview) #searchHotRail");
      const searchHotRailStyleStart = searchHotPortraitSelectorStart >= 0
        ? searchHotStyleText.lastIndexOf("#searchHotRail {", searchHotPortraitSelectorStart)
        : -1;
      const searchHotPortraitStyleStart = searchHotPortraitSelectorStart >= 0
        ? searchHotStyleText.lastIndexOf("@media (orientation: portrait) and (max-width: 719px)", searchHotPortraitSelectorStart)
        : -1;
      const searchHotBaseStyleText = searchHotRailStyleStart >= 0 && searchHotPortraitStyleStart > searchHotRailStyleStart
        ? searchHotStyleText.slice(searchHotRailStyleStart, searchHotPortraitStyleStart)
        : "";
      const searchHotPortraitStyleText = searchHotPortraitStyleStart >= 0
        ? searchHotStyleText.slice(searchHotPortraitStyleStart, searchHotStyleText.indexOf("#searchEmptyState", searchHotPortraitStyleStart))
        : "";
      const searchHotPipelineSource = [
        searchHotUrlSource,
        searchHotRequestSource,
        sourceOf(loadSearchHot),
        sourceOf(ensureSearchHotData),
        searchHotRenderSource
      ].join("\n");
      const clearSearchSectionStyleMatch = searchHotStyleText.match(/#searchPageResultsHost\s*>\s*#searchSection\s*\{[^}]*\}/);
      const clearSearchSectionStyle = clearSearchSectionStyleMatch ? clearSearchSectionStyleMatch[0] : "";
      check("CLEAR_SEARCH_SECTION_OVERFLOW_VISIBLE",
        clearSearchSectionStyle.includes("margin-top: 0")
          && clearSearchSectionStyle.includes("overflow: visible"),
        "Search Results Section allows TV focus visuals to extend beyond its boundary", "STATIC_HOOK");
      check("CLEAR_SEARCH_FOCUS_CLIP_GUARD",
        !!$("clearSearchBtn")
          && searchHotStyleText.includes(".section")
          && searchHotStyleText.includes("overflow: hidden")
          && clearSearchSectionStyle.includes("overflow: visible"),
        "the clear-search focus clipping ancestor has a scoped overflow override", "DOM_ASSERTION");
      check("SEARCH_RAIL_OVERFLOW_UNCHANGED",
        searchHotStyleText.includes(".rail")
          && searchHotStyleText.includes("overflow-x: auto")
          && searchHotStyleText.includes("overflow-y: hidden")
          && searchHotStyleText.includes("#searchRail"),
        "Search results rail keeps its existing horizontal overflow behavior", "STATIC_HOOK");
      check("TV_SECONDARY_BUTTON_FOCUS_UNCHANGED",
        searchHotStyleText.includes("html.tv-mode .secondary-page button:focus")
          && searchHotStyleText.includes("outline: 2px solid")
          && searchHotStyleText.includes("box-shadow:")
          && searchHotStyleText.includes("transform: scale(1.06)"),
        "TV Secondary button focus visuals remain unchanged", "STATIC_HOOK");
      let searchHotReturnFixture = {
        snapshot: null,
        exact: null,
        queryFirst: null,
        indexFallback: null,
        top1Fallback: null,
        cards: []
      };
      let searchHotRankFixture = [];
      try {
        searchHotRankFixture = [1, 2, 3, 4].map((rank, index) => searchHotCard({ query: "rank-" + rank, rank }, index));
        const rail = $("searchHotRail");
        const section = $("searchHotSection");
        const page = $("searchPage");
        if (rail && section && page) {
          const previousChildren = Array.from(rail.childNodes);
          const previousPageHidden = page.hidden;
          const previousSectionHidden = section.hidden;
          const previousSectionAria = section.getAttribute("aria-hidden");
          try {
            page.hidden = false;
            section.hidden = false;
            section.setAttribute("aria-hidden", "false");
            const fixtureItems = Array.from({ length: 10 }, (_, index) => ({
              query: "hot-return-" + (index + 1),
              rank: index + 1,
              label: "fixture"
            }));
            rail.replaceChildren(...fixtureItems.map((item, index) => searchHotCard(item, index)));
            const cards = Array.from(rail.querySelectorAll(".search-hot-card"));
            const selected = cards[6] || null;
            searchHotReturnFixture.cards = cards;
            searchHotReturnFixture.snapshot = selected ? homeFocusSnapshot(selected, { tmdbId: "resolved-07" }) : null;
            searchHotReturnFixture.exact = searchHotReturnFixture.snapshot
              ? findHomeReturnTarget({ focus: searchHotReturnFixture.snapshot })
              : null;
            searchHotReturnFixture.queryFirst = findHomeReturnTarget({
              focus: { type: "search-hot", key: "hot-return-7", cardIndex: 0, gridId: "searchHotRail", sectionId: "searchHotSection" }
            });
            searchHotReturnFixture.indexFallback = findHomeReturnTarget({
              focus: { type: "search-hot", key: "missing-hot-query", cardIndex: 6, gridId: "searchHotRail", sectionId: "searchHotSection" }
            });
            searchHotReturnFixture.top1Fallback = findHomeReturnTarget({
              focus: { type: "search-hot", key: "", cardIndex: -1, gridId: "searchHotRail", sectionId: "searchHotSection" }
            });
          } finally {
            rail.replaceChildren(...previousChildren);
            page.hidden = previousPageHidden;
            section.hidden = previousSectionHidden;
            if (previousSectionAria == null) section.removeAttribute("aria-hidden");
            else section.setAttribute("aria-hidden", previousSectionAria);
          }
        }
      } catch (error) {}
      const hotFixture = {
        data: [
          { query: "热词 A", order: 3, show_image_url: "http://img.example/a.jpg", tag_content: "电影", query_label: { label_text: "荐" }, search_mark: "99", qipu_id: "qipu-a", doc_channel: "movie" },
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
          && hotJsonItems[0].qipu_id === "qipu-a"
          && hotJsonItems[0].doc_channel === "movie"
          && hotJsonItems[1].rank === 3;
      } catch (error) {}
      let searchHotStrongResolution = null;
      let searchHotAmbiguousResolution = null;
      let searchHotYearMismatchResolution = null;
      let searchHotUniqueYearResolution = null;
      let searchHotNoMatchResolution = null;
      let searchHotResolveRequestUrl = "";
      try {
        const resolveBody = {
          results: [
            { id: 920001, media_type: "tv", name: "热剧", original_name: "Hot Drama", first_air_date: "2024-02-01", popularity: 1, vote_count: 2 },
            { id: 920002, media_type: "tv", name: "热剧", original_name: "Hot Drama", first_air_date: "2023-02-01", popularity: 100, vote_count: 100 },
            { id: 920003, media_type: "movie", title: "Hot Drama", original_title: "热剧", release_date: "2024-03-01", popularity: 100, vote_count: 100 },
            { id: 920004, media_type: "tv", name: "热剧相关", original_name: "Related", first_air_date: "2024-04-01", popularity: 999, vote_count: 999 }
          ]
        };
        searchHotStrongResolution = await resolveSearchHotTmdbItem(
          { query: "热剧", meta: "2024" },
          (url) => { searchHotResolveRequestUrl = String(url || ""); return Promise.resolve(resolveBody); }
        );
        searchHotAmbiguousResolution = await resolveSearchHotTmdbItem(
          { query: "同名剧", meta: "2024" },
          () => Promise.resolve({ results: [
            { id: 920011, media_type: "tv", name: "同名剧", first_air_date: "2024-01-01", popularity: 100, vote_count: 100 },
            { id: 920012, media_type: "tv", name: "同名剧", first_air_date: "2024-01-02", popularity: 10, vote_count: 10 }
          ] })
        );
        searchHotYearMismatchResolution = await resolveSearchHotTmdbItem(
          { query: "年份剧", meta: "2026" },
          () => Promise.resolve({ results: [
            { id: 920031, media_type: "movie", title: "年份剧", release_date: "2023-01-01", popularity: 1000, vote_count: 1000 }
          ] })
        );
        searchHotUniqueYearResolution = await resolveSearchHotTmdbItem(
          { query: "年份剧", meta: "2026" },
          () => Promise.resolve({ results: [
            { id: 920041, media_type: "movie", title: "年份剧", release_date: "2023-01-01", popularity: 1000, vote_count: 1000 },
            { id: 920042, media_type: "movie", title: "年份剧", release_date: "2026-01-01", popularity: 10, vote_count: 10 }
          ] })
        );
        searchHotNoMatchResolution = await resolveSearchHotTmdbItem(
          { query: "不存在的热词" },
          () => Promise.resolve({ results: [
            { id: 920021, media_type: "movie", title: "不存在的热词外传", release_date: "2024-01-01", popularity: 999, vote_count: 999 }
          ] })
        );
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
        searchHotCardSource.includes("search-hot-card")
          && searchHotCardSource.includes("searchHotQuery")
          && !searchHotCardSource.includes("mediaCard("),
        "Search Hot uses a dedicated card while preserving the existing rail", "STATIC_HOOK");
      check("SEARCH_HOT_TEXT_ONLY",
        searchHotCardSource.includes("search-hot-copy")
          && searchHotCardSource.includes("search-hot-title")
          && searchHotCardSource.includes("search-hot-subtitle")
          && !searchHotCardSource.includes("displayImage")
          && !searchHotCardSource.includes("imageAttrs")
          && !searchHotCardSource.includes("<img"),
        "Search Hot cards are compact text-only tiles", "STATIC_HOOK");
      check("SEARCH_HOT_NO_POSTER_RENDER",
        !searchHotCardSource.includes("search-hot-poster")
          && !searchHotCardSource.includes("<img"),
        "Search Hot does not render poster markup", "STATIC_HOOK");
      check("SEARCH_HOT_NO_IMAGE_REQUEST",
        !searchHotCardSource.includes("displayImage")
          && !searchHotCardSource.includes("imageAttrs")
          && !searchHotCardSource.includes("hot.image"),
        "Search Hot presentation does not invoke image URL or image attribute helpers", "STATIC_HOOK");
      check("SEARCH_HOT_COMPACT_TILE",
        searchHotStyleText.includes("clamp(220px, 16vw, 300px)")
          && searchHotStyleText.includes("min-height: 76px")
          && searchHotStyleText.includes("max-height: 90px")
          && !searchHotStyleText.includes("#searchHotRail > .search-hot-card .search-hot-poster"),
        "Search Hot uses a compact landscape tile rather than the portrait card width", "STATIC_HOOK");
      check("SEARCH_HOT_MOBILE_PORTRAIT_GRID",
        searchHotPortraitStyleText.includes("@media (orientation: portrait) and (max-width: 719px)")
          && searchHotPortraitStyleText.includes("html:not(.tv-mode):not(.tv-preview) #searchHotRail")
          && searchHotPortraitStyleText.includes("display: grid"),
        "Mobile portrait Search Hot switches the existing rail to a responsive grid", "STATIC_HOOK");
      check("SEARCH_HOT_MOBILE_TWO_COLUMNS",
        searchHotPortraitStyleText.includes("grid-template-columns: repeat(2, minmax(0, 1fr))")
          && searchHotPortraitStyleText.includes("column-gap: 9px")
          && searchHotPortraitStyleText.includes("row-gap: 9px"),
        "Mobile portrait Search Hot uses two compact columns", "STATIC_HOOK");
      check("SEARCH_HOT_MOBILE_NO_HORIZONTAL_TRACK",
        searchHotPortraitStyleText.includes("overflow-x: visible")
          && searchHotPortraitStyleText.includes("scroll-snap-type: none")
          && !searchHotStyleText.includes("#searchHotRail { --home-card-width"),
        "Mobile portrait Search Hot does not retain a horizontal scrolling track", "STATIC_HOOK");
      check("SEARCH_HOT_MOBILE_CARD_FULL_COLUMN",
        searchHotPortraitStyleText.includes("width: 100%")
          && searchHotPortraitStyleText.includes("max-width: none")
          && searchHotPortraitStyleText.includes("min-width: 0")
          && searchHotPortraitStyleText.includes("flex: none")
          && searchHotPortraitStyleText.includes("min-height: 64px")
          && searchHotPortraitStyleText.includes("max-height: 78px"),
        "Mobile portrait Search Hot cards fill their grid columns", "STATIC_HOOK");
      check("SEARCH_HOT_MOBILE_HISTORY_UNCHANGED",
        typeof renderSearchHistory === "function"
          && sourceOf(renderSearchHistory).includes("searchHistoryRail")
          && !searchHotPortraitStyleText.includes("#searchHistoryRail"),
        "Mobile portrait changes are scoped away from Search History", "STATIC_HOOK");
      check("SEARCH_HOT_DESKTOP_HORIZONTAL",
        searchHotBaseStyleText.includes("#searchHotRail > .search-hot-card")
          && searchHotBaseStyleText.includes("flex: 0 0 clamp(220px, 16vw, 300px)"),
        "Desktop Search Hot remains a horizontal compact rail", "STATIC_HOOK");
      check("SEARCH_HOT_TV_HORIZONTAL",
        searchHotBaseStyleText.includes("#searchHotRail > .search-hot-card")
          && searchHotPortraitStyleText.includes("html:not(.tv-mode):not(.tv-preview) #searchHotRail"),
        "TV and TV Preview are excluded from the portrait grid override", "STATIC_HOOK");
      check("SEARCH_HOT_LANDSCAPE_HORIZONTAL",
        searchHotBaseStyleText.includes("flex: 0 0 clamp(220px, 16vw, 300px)")
          && !searchHotPortraitStyleText.includes("orientation: landscape"),
        "Landscape Search Hot remains on the base horizontal rail", "STATIC_HOOK");
      check("SEARCH_HOT_RANK_VISIBLE",
        searchHotCardSource.includes("search-hot-rank")
          && searchHotCardSource.includes("padStart(2, \"0\")")
          && searchHotCardSource.includes("escapeHtml(rankText)"),
        "Search Hot renders a two-digit visible rank", "STATIC_HOOK");
      check("SEARCH_HOT_TITLE_VISIBLE",
        searchHotCardSource.includes("search-hot-title")
          && searchHotCardSource.includes("escapeHtml(query)")
          && searchHotStyleText.includes("-webkit-line-clamp: 2"),
        "Search Hot renders the query as a two-line title", "STATIC_HOOK");
      check("SEARCH_HOT_CLICK_TO_TMDB",
        hasAll(searchHotActivateSource, [
          "resolveSearchHotTmdbItem",
          "openDetail(resolved.item, { returnTarget: target })",
          "activateSearchHotFallback"
        ])
          && hasAll(searchHotFallbackSource, [
            "enableSearchEditing",
            "hideSearchSuggest",
            "recordSearchHistory",
            "focusRemoteTarget",
            'searchTmdb(normalized, { source: "hot-fallback" })'
          ]),
        "Search Hot first resolves a strong TMDB detail and keeps the existing search fallback", "STATIC_HOOK");
      check("SEARCH_HOT_CLICK_DIRECT_DETAIL",
        searchHotActivateSource.includes('resolved.verdict === "STRONG"')
          && searchHotActivateSource.includes("openDetail(resolved.item, { returnTarget: target })")
          && searchHotActivateSource.includes("activateSearchHotFallback(query)"),
        "a reliable Search Hot identity opens Detail directly", "STATIC_HOOK");
      check("SEARCH_HOT_TMDB_RESOLVE",
        searchHotResolveSource.includes("tmdbSearchUrl")
          && searchHotResolveSource.includes("requestJson")
          && searchHotResolveSource.includes("media_type === \"movie\"")
          && searchHotResolveSource.includes("media_type === \"tv\"")
          && searchHotResolveRequestUrl.includes("/search/multi"),
        "Search Hot resolves only through the existing TMDB multi-search authority", "RUNTIME_MOCK");
      check("SEARCH_HOT_EXACT_TITLE_PRIORITY",
        !!searchHotStrongResolution
          && searchHotStrongResolution.verdict === "STRONG"
          && searchHotStrongResolution.item
          && String(searchHotStrongResolution.item.tmdbId) === "920001"
          && searchHotResolveSource.includes("normalizeTitle")
          && searchHotIdentitySource.includes("identityTier")
          && searchHotResolveSource.includes("searchHotIdentityEvidence"),
        "exact localized title plus year outranks original-title and weaker matches", "RUNTIME_MOCK");
      check("SEARCH_HOT_YEAR_DISAMBIGUATION",
        !!searchHotStrongResolution
          && searchHotStrongResolution.item
          && String(searchHotStrongResolution.item.tmdbId) === "920001"
          && searchHotResolveSource.includes("searchHotMetaYear")
          && searchHotResolveSource.includes("release_date")
          && searchHotResolveSource.includes("first_air_date"),
        "the hot metadata year participates in TMDB title selection", "RUNTIME_MOCK");
      check("SEARCH_HOT_POPULARITY_NOT_IDENTITY",
        !!searchHotAmbiguousResolution
          && searchHotAmbiguousResolution.verdict === "AMBIGUOUS"
          && Array.isArray(searchHotAmbiguousResolution.candidates)
          && searchHotAmbiguousResolution.candidates.length === 2
          && searchHotResolveSource.includes("highestIdentityTier")
          && !searchHotResolveSource.includes("sameTie"),
        "popularity and vote count cannot resolve an identity tie", "RUNTIME_MOCK");
      check("SEARCH_HOT_SAME_TIER_MULTI_AMBIGUOUS",
        !!searchHotAmbiguousResolution
          && searchHotAmbiguousResolution.verdict === "AMBIGUOUS"
          && searchHotAmbiguousResolution.identityTier === 4
          && searchHotAmbiguousResolution.candidates.length === 2,
        "multiple candidates at the highest identity tier remain ambiguous", "RUNTIME_MOCK");
      check("SEARCH_HOT_EXPLICIT_YEAR_MISMATCH_NOT_STRONG",
        !!searchHotYearMismatchResolution
          && searchHotYearMismatchResolution.verdict === "NO_MATCH"
          && !searchHotYearMismatchResolution.item
          && searchHotIdentitySource.includes('yearState === "mismatch"'),
        "an exact title with an explicit conflicting year cannot become STRONG", "RUNTIME_MOCK");
      check("SEARCH_HOT_EXACT_YEAR_UNIQUE_STRONG",
        !!searchHotUniqueYearResolution
          && searchHotUniqueYearResolution.verdict === "STRONG"
          && searchHotUniqueYearResolution.item
          && String(searchHotUniqueYearResolution.item.tmdbId) === "920042"
          && searchHotUniqueYearResolution.identityTier === 4,
        "the unique exact title and year candidate is STRONG even when less popular", "RUNTIME_MOCK");
      check("SEARCH_HOT_STRONG_OPENS_DETAIL",
        searchHotActivateSource.includes('resolved.verdict === "STRONG"')
          && searchHotActivateSource.includes("resolved.item")
          && searchHotActivateSource.includes("openDetail(resolved.item"),
        "only a strong resolver result can take the direct Detail path", "STATIC_HOOK");
      check("SEARCH_HOT_AMBIGUOUS_FALLBACK",
        !!searchHotAmbiguousResolution
          && searchHotAmbiguousResolution.verdict === "AMBIGUOUS"
          && searchHotActivateSource.includes("activateSearchHotFallback(query)"),
        "equally strong unresolved matches fall back to typed Search", "RUNTIME_MOCK");
      check("SEARCH_HOT_NO_MATCH_FALLBACK",
        !!searchHotNoMatchResolution
          && searchHotNoMatchResolution.verdict === "NO_MATCH"
          && searchHotActivateSource.includes("catch (error)"),
        "no exact TMDB match and transport failure use the existing fallback", "RUNTIME_MOCK");
      check("SEARCH_HOT_CLICK_DOES_NOT_MUTATE_INPUT",
        !searchHotActivateSource.includes("input.value =")
          && searchHotActivateSource.includes("openDetail(resolved.item"),
        "a strong hot click does not mutate the search input", "STATIC_HOOK");
      check("SEARCH_HOT_CLICK_DOES_NOT_RECORD_HISTORY",
        !searchHotActivateSource.includes("recordSearchHistory")
          && searchHotActivateSource.includes("openDetail(resolved.item"),
        "a strong hot click does not record search history", "STATIC_HOOK");
      check("SEARCH_HOT_DIRECT_DETAIL_RETURN_TARGET",
        searchHotActivateSource.includes("returnTarget: target")
          && sourceOf(openDetail).includes("opts.returnTarget"),
        "direct Detail retains the hot card as the return target", "STATIC_HOOK");
      check("SEARCH_HOT_DIRECT_DETAIL_BACK_TO_SEARCH",
        sourceOf(rememberHomeReturn).includes("searchHotRail")
          && sourceOf(restoreHomeReturn).includes("searchHotRail")
          && sourceOf(closeDetail).includes("restoreHomeReturn"),
        "existing Detail return restoration can return to the Search Hot rail", "STATIC_HOOK");
      check("SEARCH_HOT_RETURN_SNAPSHOT_TYPE",
        !!searchHotReturnFixture.snapshot
          && searchHotReturnFixture.snapshot.type === "search-hot"
          && searchHotReturnFixture.snapshot.gridId === "searchHotRail"
          && searchHotReturnFixture.snapshot.sectionId === "searchHotSection"
          && homeFocusSnapshotSource.includes("search-hot"),
        "Search Hot stores a dedicated return-focus snapshot type", "RUNTIME_MOCK");
      check("SEARCH_HOT_RETURN_QUERY_IDENTITY",
        !!searchHotReturnFixture.snapshot
          && searchHotReturnFixture.snapshot.key === "hot-return-7"
          && searchHotReturnFixture.exact === searchHotReturnFixture.cards[6]
          && searchHotReturnFixture.exact !== searchHotReturnFixture.cards[0]
          && searchHotReturnSource.includes("searchHotQuery"),
        "Search Hot returns to the clicked card by query identity", "RUNTIME_MOCK");
      check("SEARCH_HOT_RETURN_CARD_INDEX_FALLBACK",
        searchHotReturnFixture.indexFallback === searchHotReturnFixture.cards[6]
          && searchHotReturnSource.includes("focus.cardIndex"),
        "a refreshed Search Hot list falls back to the saved card index", "RUNTIME_MOCK");
      check("SEARCH_HOT_RETURN_TOP1_LAST_RESORT_ONLY",
        searchHotReturnFixture.top1Fallback === searchHotReturnFixture.cards[0]
          && searchHotReturnFixture.indexFallback !== searchHotReturnFixture.cards[0]
          && searchHotReturnSource.includes("cards[0]"),
        "Search Hot Top 1 is used only after identity and index recovery fail", "RUNTIME_MOCK");
      check("SEARCH_HOT_EXACT_RETURN_TARGET",
        searchHotReturnFixture.exact === searchHotReturnFixture.cards[6],
        "the exact clicked Search Hot card is the preferred return target", "RUNTIME_MOCK");
      check("SEARCH_HOT_RETURN_NOT_FIRST_ITEM",
        searchHotReturnFixture.exact && searchHotReturnFixture.exact !== searchHotReturnFixture.cards[0],
        "a non-first Search Hot card does not collapse to Top 1 on return", "RUNTIME_MOCK");
      check("SEARCH_HOT_RETURN_QUERY_FIRST",
        searchHotReturnFixture.queryFirst === searchHotReturnFixture.cards[6]
          && homeReturnTargetSource.includes('focus.type === "search-hot"'),
        "query identity takes precedence over a stale card index", "RUNTIME_MOCK");
      check("SEARCH_HOT_RETURN_INDEX_SECONDARY",
        searchHotReturnFixture.indexFallback === searchHotReturnFixture.cards[6]
          && searchHotReturnFixture.top1Fallback === searchHotReturnFixture.cards[0],
        "card index is secondary and Top 1 remains the last fallback", "RUNTIME_MOCK");
      check("SEARCH_HOT_TOP3_MARKER",
        searchHotRankFixture.length === 4
          && searchHotRankFixture.slice(0, 3).every((card, index) => card.classList.contains("search-hot-top") && card.dataset.hotRank === String(index + 1))
          && !searchHotRankFixture[3].classList.contains("search-hot-top")
          && searchHotCardSource.includes("dataset.hotRank")
          && searchHotCardSource.includes("search-hot-top"),
        "Search Hot ranks 1 through 3 receive a shared presentation marker", "RUNTIME_MOCK");
      check("SEARCH_HOT_TOP3_STYLE",
        searchHotStyleText.includes(".search-hot-card.search-hot-top .search-hot-rank")
          && searchHotStyleText.includes("rgba(191, 233, 255, .12)")
          && searchHotStyleText.includes("font-weight: 820")
          && searchHotStyleText.includes(".search-hot-card.search-hot-top .search-hot-title")
          && searchHotStyleText.includes('data-hot-rank="1"'),
        "Top 3 use a restrained shared rank/title emphasis", "STATIC_HOOK");
      check("SEARCH_HOT_RANK4_NOT_EMPHASIZED",
        searchHotRankFixture[3] && !searchHotRankFixture[3].classList.contains("search-hot-top")
          && !searchHotStyleText.includes('data-hot-rank="4"')
          && searchHotCardSource.includes("normalizedRank <= 3"),
        "rank 4 and later keep the normal Search Hot presentation", "RUNTIME_MOCK");
      check("SEARCH_HOT_TOP3_MOBILE_PRESERVED",
        searchHotStyleText.includes(".search-hot-card.search-hot-top .search-hot-rank")
          && searchHotPortraitStyleText.includes("#searchHotRail > .search-hot-card")
          && !searchHotPortraitStyleText.includes("search-hot-top"),
        "the same Top 3 marker survives the mobile grid without a second UI", "STATIC_HOOK");
      check("SEARCH_HOT_DOUBLE_CLICK_GUARD",
        searchHotActivateSource.includes("hotResolving")
          && searchHotActivateSource.includes("return false")
          && searchHotCardSource.includes("activateSearchHotItem(hot, button)"),
        "a card ignores a second click while its TMDB resolution is pending", "STATIC_HOOK");
      check("SEARCH_HOT_RESOLVE_STALE_GUARD",
        searchHotActivateSource.includes("searchHotResolveSeq")
          && searchHotActivateSource.includes("resolveSeq !== Number(state.searchHotResolveSeq || 0)"),
        "a stale hot resolver cannot navigate after a newer click", "STATIC_HOOK");
      check("SEARCH_HOT_EXISTING_RAIL_PRESERVED",
        searchHotRenderSource.includes("searchHotSection")
          && searchHotRenderSource.includes("searchHotRail")
          && searchHotCardSource.includes('className = "card focusable search-hot-card"'),
        "Search Hot keeps its existing section and rail DOM contract", "STATIC_HOOK");
      check("SEARCH_HOT_EXISTING_FOCUS_CONTRACT_PRESERVED",
        typeof firstSearchHotFocusTarget === "function"
          && sourceOf(firstSearchHotFocusTarget).includes("searchHotRail")
          && sourceOf(fastHomeSearchRailTarget).includes("searchHotRail"),
        "Search Hot remains in the existing TV rail focus contract", "STATIC_HOOK");
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
