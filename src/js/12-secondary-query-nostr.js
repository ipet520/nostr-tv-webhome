    function secondaryFilterDefaults() { return { mediaType: "all", genre: "all", region: "all", year: "all", sort: "hot", lastFocused: {} }; }
    function secondaryFilterState(id) {
      id = normalizeLegacyCategoryId(id);
      const home = state.homeV14;
      home.secondaryFilters = home.secondaryFilters && typeof home.secondaryFilters === "object" ? home.secondaryFilters : {};
      const existing = home.secondaryFilters[id];
      const filters = home.secondaryFilters[id] = Object.assign(secondaryFilterDefaults(), home.secondaryFilters[id] || {});
      filters.lastFocused = Object.assign({}, filters.lastFocused || {});
      if (filters.sort === "default" || !["hot", "latest", "rating"].includes(filters.sort)) filters.sort = "hot";
      if (filters.lastFocused.sort === "default" || !["hot", "latest", "rating"].includes(filters.lastFocused.sort)) filters.lastFocused.sort = filters.sort;
      // Weekly Feed has no catalog filter rows; retain the state boundary so
      // older snapshots can still be read without reviving the old filters.
      return filters;
    }
    function secondaryCatalogBaseItems(id) {
      if (normalizeLegacyCategoryId(id) === "recent") return state.recent && Array.isArray(state.recent.items) ? state.recent.items : [];
      // now-playing is the finite Weekly Feed route.  It is populated from
      // state.homeLatest by loadSecondaryPage instead of the catalog cache.
      if (normalizeLegacyCategoryId(id) === "now-playing") return [];
      return filterBlocked(filterReleasedCatalogItems(id, state.catalog && state.catalog[id] || []));
    }
    function secondaryItemValues(item, keys) { const key = keys.find((name) => item && item[name] != null), value = key && item[key]; return Array.isArray(value) ? value.map(String).filter(Boolean) : String(value || "").split(/[|,\s]+/).filter(Boolean); }
    function secondaryItemMediaType(item) { const value = String(item && (item.mediaType || item.media_type || item.type) || "").toLowerCase(); return value === "movie" || value === "tv" ? value : ""; }
    function secondaryItemGenreIds(item) { return secondaryItemValues(item, ["genreIds", "genre_ids"]); }
    function secondaryItemRegions(item) { return secondaryItemValues(item, ["originCountries", "origin_country", "originCountry"]); }
    function secondaryItemYear(item) { const match = String(item && (item.releaseDate || item.release_date || item.first_air_date || item.year) || "").match(/(19|20)\d{2}/); return match ? match[0] : ""; }
    function secondaryYearOptions() {
      const current = new Date().getFullYear();
      const options = [{ value: "all", label: "全部" }];
      for (let offset = 0; offset < 5; offset++) options.push({ value: String(current - offset), label: String(current - offset) });
      options.push({ value: `before:${current - 5}`, label: `${current - 5}及以前` });
      return options;
    }
    function secondaryYearMatches(item, value) {
      if (!value || value === "all") return true;
      const year = Number(secondaryItemYear(item));
      if (!year) return false;
      if (String(value).indexOf("before:") === 0) return year <= Number(String(value).slice(7));
      return String(year) === String(value);
    }
    function secondaryConfigSources(id) {
      const list = getList(id);
      if (!list) return [];
      const sources = Array.isArray(list.sources) && list.sources.length ? list.sources : [list];
      return sources.map((source) => Object.assign({}, list, source, {
        id: list.id || id,
        title: list.title || id,
        params: Object.assign({}, source.params || list.params || {}),
        mediaType: source.mediaType || list.mediaType || ""
      }));
    }
    function secondaryEndpointMediaType(endpoint) {
      const value = String(endpoint || "").toLowerCase();
      if (value === "discover/movie") return "movie";
      if (value === "discover/tv") return "tv";
      return "";
    }
    function secondaryIsDiscoverSource(source) { return !!secondaryEndpointMediaType(source && source.endpoint); }
    function secondaryUniqueValues(values) { return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))); }
    function secondaryParamValues(value) { return secondaryUniqueValues(String(value || "").split(/[|,\s]+/)); }
    function secondaryMergeParamValue(existing, value) { return secondaryUniqueValues(secondaryParamValues(existing).concat([value])).join(","); }
    function secondaryRegionMatches(item, value) {
      if (!value || value === "all") return true;
      const selected = new Set(secondaryParamValues(value).map((entry) => String(entry).toUpperCase()));
      return secondaryItemRegions(item).some((entry) => selected.has(String(entry).toUpperCase()));
    }
    function secondaryFilterSchemaKeys(id) {
      id = normalizeLegacyCategoryId(id);
      if (id === "recent") return [];
      const known = SECONDARY_FILTER_SCHEMA[id];
      if (known) return known.slice();
      const list = getList(id);
      const mediaType = String(list && list.mediaType || "").toLowerCase();
      if (mediaType === "movie") return ["genre", "region", "year", "sort"];
      if (mediaType === "tv") return ["genre", "year", "sort"];
      return ["year", "sort"];
    }

    function secondaryFullCatalogSources(id) {
      id = normalizeLegacyCategoryId(id);
      const common = { sort_by: "popularity.desc" };
      if (id === "movie") {
        return [{ id, title: "电影", endpoint: "discover/movie", mediaType: "movie", params: Object.assign({}, common) }];
      }
      if (id === "tv") {
        return [{ id, title: "电视剧", endpoint: "discover/tv", mediaType: "tv", params: Object.assign({}, common, {
          include_null_first_air_dates: "false",
          with_origin_country: "CN|HK|TW|KR|JP|US|GB",
          without_genres: "16,99,10763,10764,10766,10767"
        }) }];
      }
      if (id === "variety") {
        return [{ id, title: "综艺", endpoint: "discover/tv", mediaType: "tv", params: Object.assign({}, common, {
          with_genres: "10764|10767",
          include_null_first_air_dates: "false"
        }) }];
      }
      if (id === "anime") {
        return [
          { id, title: "动画", endpoint: "discover/tv", mediaType: "tv", params: Object.assign({}, common, { with_genres: "16", with_origin_country: "CN|JP" }) },
          { id, title: "动画", endpoint: "discover/movie", mediaType: "movie", params: { with_genres: "16", with_origin_country: "CN|JP", sort_by: "popularity.desc" } }
        ];
      }
      if (id === "documentary") {
        return [
          { id, title: "纪录片", endpoint: "discover/movie", mediaType: "movie", params: Object.assign({}, common, { with_genres: "99" }) },
          { id, title: "纪录片", endpoint: "discover/tv", mediaType: "tv", params: Object.assign({}, common, { with_genres: "99" }) }
        ];
      }
      return [];
    }

    const SECONDARY_FULL_CATALOG_IDS = new Set(["movie", "tv", "anime", "documentary", "variety"]);
    function secondaryFilterDefaultValue(key) { return key === "sort" ? "hot" : "all"; }
    function secondaryNormalizeFilterValues(id, groups) {
      const filters = secondaryFilterState(id);
      const keys = new Set((groups || []).map((group) => group.key));
      ["mediaType", "genre", "region", "year", "sort"].forEach((key) => {
        if (!keys.has(key)) {
          filters[key] = secondaryFilterDefaultValue(key);
          filters.lastFocused[key] = filters[key];
        }
      });
      (groups || []).forEach((group) => {
        const allowed = new Set((group.options || []).map((option) => option.value));
        const fallback = secondaryFilterDefaultValue(group.key);
        if (!allowed.has(filters[group.key])) filters[group.key] = fallback;
        if (!allowed.has(filters.lastFocused[group.key])) filters.lastFocused[group.key] = filters[group.key];
      });
      return filters;
    }
    function secondaryFilterSchemaSignature(groups) {
      return JSON.stringify((groups || []).map((group) => [group.key, (group.options || []).map((option) => [option.value, option.label])]));
    }
    function secondaryFilterKey(id, filters) {
      id = normalizeLegacyCategoryId(id);
      const hotSource = ["movie", "tv", "anime", "variety"].includes(id) && filters.sort === "hot" ? homeHotSource() : "";
      return JSON.stringify([id, id === "now-playing" ? "weekly-feed" : id === "recent" ? "local-history" : "tmdb", hotSource, filters.mediaType, filters.genre, filters.region, filters.year, filters.sort]);
    }
    function secondaryGetQuery(id) {
      id = normalizeLegacyCategoryId(id);
      const home = state.homeV14;
      home.secondaryQueries = home.secondaryQueries && typeof home.secondaryQueries === "object" ? home.secondaryQueries : {};
      const filters = secondaryFilterState(id);
      const key = secondaryFilterKey(id, filters);
      const hotSource = ["movie", "tv", "anime", "variety"].includes(id) && filters.sort === "hot" ? homeHotSource() : "";
      let query = home.secondaryQueries[key];
      if (!query) {
        query = home.secondaryQueries[key] = {
          key,
          listId: id,
          source: id === "now-playing" ? "weekly-feed" : id === "recent" ? "local-history" : hotSource === "nostr" ? "nostr-hot" : "tmdb",
          hotSource,
          nostrHot: hotSource === "nostr",
          nostrHotItems: [],
          nostrHotLoading: false,
          nostrHotLoaded: false,
          nostrHotGeneration: 0,
          page: 0,
          totalPages: 0,
          totalResults: 0,
          loading: false,
          loaded: false,
          hasMore: false,
          items: [],
          error: "",
          failedPage: 0,
          requestSeq: 0,
          serverSideFilters: [],
          clientSideFilters: [],
          endpointMap: [],
          sourceStates: [],
          finite: false,
          snapshotReady: false,
          snapshotSource: ""
        };
      }
      query.hotSource = hotSource;
      query.nostrHot = hotSource === "nostr";
      query.source = id === "now-playing" ? "weekly-feed" : id === "recent" ? "local-history" : hotSource === "nostr" ? "nostr-hot" : "tmdb";
      if (!Array.isArray(query.nostrHotItems)) query.nostrHotItems = [];
      home.secondaryActiveQueryKey = key;
      return query;
    }
    function secondaryActiveQuery(id) {
      id = id ? normalizeLegacyCategoryId(id) : id;
      const home = state.homeV14;
      const query = home && home.secondaryQueries && home.secondaryQueries[home.secondaryActiveQueryKey];
      return query && (!id || query.listId === id) ? query : null;
    }
    function secondaryApplyServerFilters(source, filters) {
      const entry = Object.assign({}, source, { params: Object.assign({}, source && source.params || {}) });
      const params = entry.params;
      const server = [], client = [], endpointType = secondaryEndpointMediaType(entry.endpoint);
      const sourceType = String(entry.mediaType || endpointType || "").toLowerCase();
      if (filters.mediaType !== "all" && sourceType && sourceType !== filters.mediaType) return null;
      if (filters.genre !== "all") {
        if (secondaryIsDiscoverSource(entry)) { params.with_genres = secondaryMergeParamValue(params.with_genres, filters.genre); server.push("genre"); }
        else client.push("genre");
      }
      if (filters.region !== "all") {
        if (secondaryIsDiscoverSource(entry)) {
          const fixed = secondaryParamValues(params.with_origin_country).map((value) => String(value).toUpperCase());
          const selected = secondaryParamValues(filters.region).map((value) => String(value).toUpperCase());
          if (fixed.length && !selected.some((value) => fixed.includes(value))) return null;
          params.with_origin_country = filters.region;
          server.push("region");
        } else client.push("region");
      }
      if (filters.year !== "all") {
        if (secondaryIsDiscoverSource(entry)) {
          const datePrefix = (entry.mediaType || endpointType) === "tv" ? "first_air_date" : "primary_release_date";
          ["primary_release_date_gte", "primary_release_date_lte", "first_air_date_gte", "first_air_date_lte", "primary_release_year", "first_air_date_year"].forEach((key) => delete params[key]);
          if (String(filters.year).indexOf("before:") === 0) params[`${datePrefix}_lte`] = `${String(filters.year).slice(7)}-12-31`;
          else { params[`${datePrefix}_gte`] = `${filters.year}-01-01`; params[`${datePrefix}_lte`] = `${filters.year}-12-31`; }
          server.push("year");
        } else client.push("year");
      }
      if (["hot", "latest", "rating"].includes(filters.sort)) {
        if (secondaryIsDiscoverSource(entry)) {
          const dateSort = (entry.mediaType || endpointType) === "tv" ? "first_air_date.desc" : "primary_release_date.desc";
          params.sort_by = filters.sort === "hot" ? "popularity.desc" : filters.sort === "rating" ? "vote_average.desc" : dateSort;
          server.push("sort");
        } else client.push("sort");
      }
      return { entry, server, client };
    }

    function secondaryQuerySourceLists(id, filters, query) {
      id = normalizeLegacyCategoryId(id);
      const server = [], client = [], endpointMap = [];
      let configured;
      if (id === "now-playing") {
        configured = [];
      } else if (SECONDARY_FULL_CATALOG_IDS.has(id)) {
        // Home sources intentionally use recent windows.  Secondary pages
        // use dedicated canonical Discover sources so year=all means the
        // complete catalog rather than inheriting a Home date window.
        configured = secondaryFullCatalogSources(id);
      } else {
        configured = secondaryConfigSources(id);
      }
      const entries = [];
      configured.forEach((source) => {
        const result = secondaryApplyServerFilters(source, filters);
        if (!result) return;
        entries.push(result.entry);
        result.server.forEach((value) => server.push(value));
        result.client.forEach((value) => client.push(value));
        if (result.entry.endpoint) endpointMap.push(result.entry.endpoint);
      });
      query.serverSideFilters = secondaryUniqueValues(server.concat(filters.mediaType !== "all" ? ["mediaType"] : []));
      query.clientSideFilters = secondaryUniqueValues(client);
      query.endpointMap = secondaryUniqueValues(endpointMap);
      return entries;
    }

    function secondarySourceKey(source, index) {
      return `${source && source.endpoint || "local"}|${source && source.mediaType || ""}|${JSON.stringify(source && source.params || {})}|${index}`;
    }

    function buildSecondaryQueryPlan(id, filters, query) {
      id = normalizeLegacyCategoryId(id);
      const sources = secondaryQuerySourceLists(id, filters, query);
      const finite = false;
      const prior = Array.isArray(query.sourceStates) ? query.sourceStates : [];
      const sourceStates = sources.map((source, index) => {
          const key = secondarySourceKey(source, index);
          const old = prior.find((entry) => entry.key === key) || {};
          return Object.assign({ key, endpoint: source.endpoint || "", mediaType: source.mediaType || "", page: 0, totalPages: 0, done: false, loading: false, error: "", totalResults: 0 }, old, {
            key,
            endpoint: source.endpoint || "",
            mediaType: source.mediaType || "",
            loading: false
          });
        });
      query.sourceStates = sourceStates;
      query.finite = finite;
      const plan = {
        id,
        key: query.key,
        finite,
        sources,
        sourceStates,
        serverSideFilters: (query.serverSideFilters || []).slice(),
        clientSideFilters: (query.clientSideFilters || []).slice()
      };
      state.homeV14.secondaryQueryPlan = plan;
      return plan;
    }
    function secondaryFilterGroups(id, items) {
      id = normalizeLegacyCategoryId(id);
      if (id === "recent" || id === "now-playing") return [];
      const source = Array.isArray(items) ? items : [];
      const schema = secondaryFilterSchemaKeys(id);
      const list = getList(id);
      const configured = id === "now-playing" ? [] : secondaryConfigSources(id);
      const discover = configured.some(secondaryIsDiscoverSource);
      const moviePage = id === "movie" || String(list && list.mediaType || "").toLowerCase() === "movie";
      const tvPage = id === "tv" || String(list && list.mediaType || "").toLowerCase() === "tv";
      const add = (key, label, values, labels, fallback) => {
        const unique = secondaryUniqueValues(values).filter((value) => labels[value]);
        if (unique.length) return { key, label, options: [{ value: "all", label: "全部" }].concat(unique.map((value) => ({ value, label: labels[value] || (fallback ? fallback + value : value) })))};
        return null;
      };
      const groups = [];
      if (schema.includes("mediaType")) {
        groups.push({ key: "mediaType", label: "媒体类型", options: [{ value: "all", label: "全部" }, { value: "movie", label: "电影" }, { value: "tv", label: "电视剧" }] });
      }
      if (schema.includes("genre")) {
        const genreIds = moviePage && !tvPage ? SECONDARY_MOVIE_GENRE_IDS : SECONDARY_TV_GENRE_IDS;
        const group = add("genre", "类型", genreIds, SECONDARY_GENRE_LABELS, "类型 ");
        if (group) groups.push(group);
      }
      if (schema.includes("region")) {
        const regionIds = id === "anime" ? SECONDARY_ANIMATION_REGION_IDS : id === "variety" ? SECONDARY_VARIETY_REGION_IDS : tvPage ? SECONDARY_TV_REGION_IDS : SECONDARY_REGION_IDS;
        const group = add("region", "地区", regionIds, SECONDARY_REGION_LABELS);
        if (group) groups.push(group);
      }
      if (schema.includes("year")) groups.push({ key: "year", label: "年份", options: secondaryYearOptions() });
      if (schema.includes("sort")) {
        // All configured Secondary sources can use these metrics either on
        // TMDB (server-side discover) or on the already loaded local page.
        const sorts = [{ value: "hot", label: "热门" }, { value: "latest", label: "最新" }, { value: "rating", label: "评分" }];
        if (discover || source.length || id === "now-playing") groups.push({ key: "sort", label: "排序", options: sorts });
      }
      return groups;
    }

    const SECONDARY_NOSTR_HOT_BATCH_SIZE = 18;
    const SECONDARY_NOSTR_HOT_TARGET_MATCHES = 18;
    const SECONDARY_NOSTR_HOT_MAX_SCAN_CANDIDATES = 72;
    const SECONDARY_NOSTR_HOT_MAX_NEW_DETAIL_REQUESTS = 36;
    const SECONDARY_NOSTR_HOT_DETAIL_CONCURRENCY = 4;
    const SECONDARY_NOSTR_ANIME_MAX_SCAN_CANDIDATES = 150;
    const SECONDARY_NOSTR_ANIME_SCAN_BATCH_SIZE = 4;
    const SECONDARY_NOSTR_VARIETY_MAX_SCAN_CANDIDATES = 240;
    const SECONDARY_NOSTR_VARIETY_TARGET_MATCHES = 18;
    const SECONDARY_NOSTR_VARIETY_SCAN_BATCH_SIZE = 4;
    const SECONDARY_NOSTR_VARIETY_MAX_NEW_DETAIL_REQUESTS = 54;
    const NOSTR_TMDB_META_CACHE_VERSION = 2;
    const NOSTR_TMDB_META_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const NOSTR_TMDB_META_CACHE_MAX_ENTRIES = 1000;
    const NOSTR_TMDB_META_CACHE_SAVE_DEBOUNCE_MS = 450;

    function secondaryNostrHotEnabled(id, filters) {
      return ["movie", "tv", "anime", "variety"].includes(normalizeLegacyCategoryId(id))
        && filters && filters.sort === "hot"
        && homeHotSource() === "nostr";
    }

    function secondaryNostrHotCandidates(id) {
      const allowed = normalizeLegacyCategoryId(id);
      const seen = new Set();
      return filterBlocked(Array.isArray(state.hot && state.hot.items) ? state.hot.items : [])
        .filter((item) => {
          const type = String(item && (item.mediaType || item.media_type) || "").toLowerCase();
          const matches = allowed === "anime"
            ? type === "movie" || type === "tv"
            : allowed === "variety" ? type === "tv" : type === allowed;
          const key = homeNostrSignalKey(item);
          if (!matches || !key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, allowed === "anime"
          ? SECONDARY_NOSTR_ANIME_MAX_SCAN_CANDIDATES
          : allowed === "variety"
            ? SECONDARY_NOSTR_VARIETY_MAX_SCAN_CANDIDATES
            : SECONDARY_NOSTR_HOT_MAX_SCAN_CANDIDATES)
        .map((item, index) => Object.assign({}, item, { nostrHotRank: index + 1 }));
    }

    function secondaryNostrMetaCache() {
      const home = state.homeV14;
      home.secondaryNostrMetaCache = home.secondaryNostrMetaCache && typeof home.secondaryNostrMetaCache === "object"
        ? home.secondaryNostrMetaCache
        : {};
      return home.secondaryNostrMetaCache;
    }

    function secondaryNostrTmdbMemoryCache() {
      const home = state.homeV14;
      home.secondaryNostrTmdbMemoryCache = home.secondaryNostrTmdbMemoryCache && typeof home.secondaryNostrTmdbMemoryCache === "object"
        ? home.secondaryNostrTmdbMemoryCache
        : {};
      return home.secondaryNostrTmdbMemoryCache;
    }

    function secondaryNostrAnimeMemoryCache() {
      return secondaryNostrTmdbMemoryCache();
    }

    function nostrTmdbMetaRuntime() {
      const home = state.homeV14;
      let runtime = home.nostrTmdbMeta;
      if (!runtime || typeof runtime !== "object" || Number(runtime.version || 0) !== NOSTR_TMDB_META_CACHE_VERSION) {
        runtime = home.nostrTmdbMeta = {
          version: NOSTR_TMDB_META_CACHE_VERSION,
          loaded: false,
          loading: false,
          promise: null,
          entries: {},
          dirty: false,
          dirtyVersion: 0,
          saveTimer: 0,
          savePromise: null,
          lastLoadAt: 0,
          lastSaveAt: 0,
          expiredCount: 0,
          evictedCount: 0
        };
      }
      runtime.entries = runtime.entries && typeof runtime.entries === "object" ? runtime.entries : {};
      return runtime;
    }

    function nostrTmdbMetaEntryKey(value) {
      const mediaType = String(value && (value.mediaType || value.media_type) || "").toLowerCase();
      const tmdbId = String(value && (value.tmdbId || value.tmdb_id || value.id) || "").replace(/^tmdb:(movie|tv):/i, "").trim();
      return (mediaType === "movie" || mediaType === "tv") && tmdbId ? `tmdb:${mediaType}:${tmdbId}` : "";
    }

    function normalizeNostrTmdbMetaEntry(value) {
      if (!value || typeof value !== "object") return null;
      const mediaType = String(value.mediaType || value.media_type || "").toLowerCase();
      const tmdbId = String(value.tmdbId || value.tmdb_id || value.id || "").replace(/^tmdb:(movie|tv):/i, "").trim();
      const fetchedAt = Number(value.fetchedAt || value.fetched_at || 0);
      if (Number(value.version || NOSTR_TMDB_META_CACHE_VERSION) !== NOSTR_TMDB_META_CACHE_VERSION) return null;
      if ((mediaType !== "movie" && mediaType !== "tv") || !tmdbId || !Number.isFinite(fetchedAt) || fetchedAt <= 0) return null;
      const genreIds = Array.isArray(value.genreIds) ? value.genreIds : Array.isArray(value.genre_ids) ? value.genre_ids : null;
      const regions = Array.isArray(value.regions) ? value.regions : Array.isArray(value.originCountries) ? value.originCountries : Array.isArray(value.origin_country) ? value.origin_country : null;
      if (!genreIds || !regions || value.releaseDate == null && value.release_date == null) return null;
      const voteAverageValue = Number(value.voteAverage != null ? value.voteAverage : value.vote_average);
      return {
        version: NOSTR_TMDB_META_CACHE_VERSION,
        mediaType,
        tmdbId,
        genreIds: Array.from(new Set(genreIds.map((item) => String(item).trim()).filter(Boolean))),
        regions: Array.from(new Set(regions.map((item) => String(item).trim().toUpperCase()).filter(Boolean))),
        releaseDate: String(value.releaseDate != null ? value.releaseDate : value.release_date || "").trim(),
        voteAverage: Number.isFinite(voteAverageValue) && voteAverageValue > 0 ? voteAverageValue : 0,
        posterPath: tmdbImagePath(value.posterPath != null ? value.posterPath : value.poster_path),
        backdropPath: tmdbImagePath(value.backdropPath != null ? value.backdropPath : value.backdrop_path),
        fetchedAt,
        classification: value.classification === "valid" || value.classification === "invalid" ? value.classification : ""
      };
    }

    function nostrTmdbMetaHasCanonicalPoster(value) {
      const entry = value && typeof value === "object" ? value : {};
      return !!tmdbImagePath(entry.posterPath != null ? entry.posterPath : entry.poster_path);
    }

    function nostrTmdbMetaEnforceCapacity(runtime) {
      const keys = Object.keys(runtime.entries || {});
      if (keys.length <= NOSTR_TMDB_META_CACHE_MAX_ENTRIES) return 0;
      keys.sort((a, b) => Number(runtime.entries[a] && runtime.entries[a].fetchedAt || 0) - Number(runtime.entries[b] && runtime.entries[b].fetchedAt || 0));
      const removeCount = keys.length - NOSTR_TMDB_META_CACHE_MAX_ENTRIES;
      keys.slice(0, removeCount).forEach((key) => delete runtime.entries[key]);
      runtime.evictedCount = Number(runtime.evictedCount || 0) + removeCount;
      return removeCount;
    }

    function scheduleNostrTmdbMetaSave() {
      const runtime = nostrTmdbMetaRuntime();
      runtime.dirty = true;
      runtime.dirtyVersion = Number(runtime.dirtyVersion || 0) + 1;
      if (runtime.saveTimer || !runtime.loaded) return;
      runtime.saveTimer = setTimeout(() => {
        runtime.saveTimer = 0;
        flushNostrTmdbMetaCache().catch(() => {});
      }, NOSTR_TMDB_META_CACHE_SAVE_DEBOUNCE_MS);
    }

    async function flushNostrTmdbMetaCache() {
      const runtime = nostrTmdbMetaRuntime();
      if (!runtime.loaded || !runtime.dirty) return false;
      if (runtime.savePromise) return runtime.savePromise;
      nostrTmdbMetaEnforceCapacity(runtime);
      const version = Number(runtime.dirtyVersion || 0);
      const snapshot = {
        version: NOSTR_TMDB_META_CACHE_VERSION,
        savedAt: Date.now(),
        entries: Object.keys(runtime.entries || {}).reduce((result, key) => {
          const entry = normalizeNostrTmdbMetaEntry(runtime.entries[key]);
          if (entry) result[key] = entry;
          return result;
        }, {})
      };
      runtime.savePromise = Promise.resolve().then(async () => {
        try {
          await sdk().cache.set(cacheKey("nostrTmdbMeta"), JSON.stringify(snapshot));
          runtime.lastSaveAt = Date.now();
          if (Number(runtime.dirtyVersion || 0) === version) runtime.dirty = false;
          return true;
        } catch (e) {
          runtime.dirty = true;
          return false;
        } finally {
          runtime.savePromise = null;
          if (runtime.dirty && !runtime.saveTimer) {
            runtime.saveTimer = setTimeout(() => {
              runtime.saveTimer = 0;
              flushNostrTmdbMetaCache().catch(() => {});
            }, NOSTR_TMDB_META_CACHE_SAVE_DEBOUNCE_MS);
          }
        }
      });
      return runtime.savePromise;
    }

    function ensureNostrTmdbMetaLoaded() {
      const runtime = nostrTmdbMetaRuntime();
      if (runtime.loaded) return Promise.resolve(runtime);
      if (runtime.loading && runtime.promise) return runtime.promise;
      runtime.loading = true;
      runtime.promise = Promise.resolve().then(async () => {
        let saved = null;
        try {
          const raw = await sdk().cache.get(cacheKey("nostrTmdbMeta"));
          saved = typeof raw === "string" ? safeJson(raw, null) : raw;
        } catch (e) {
          saved = null;
        }
        const now = Date.now();
        const entries = {};
        let expired = 0;
        if (saved && typeof saved === "object" && Number(saved.version || 0) === NOSTR_TMDB_META_CACHE_VERSION && saved.entries && typeof saved.entries === "object") {
          Object.keys(saved.entries).forEach((key) => {
            const entry = normalizeNostrTmdbMetaEntry(saved.entries[key]);
            if (!entry) return;
            if (now - entry.fetchedAt > NOSTR_TMDB_META_CACHE_TTL_MS) {
              expired += 1;
              return;
            }
            entries[nostrTmdbMetaEntryKey(entry) || key] = entry;
          });
        }
        runtime.entries = entries;
        runtime.expiredCount = expired;
        const evicted = nostrTmdbMetaEnforceCapacity(runtime);
        runtime.loaded = true;
        runtime.loading = false;
        runtime.lastLoadAt = Date.now();
        runtime.promise = null;
        if (expired || evicted) scheduleNostrTmdbMetaSave();
        return runtime;
      }).catch(() => {
        runtime.entries = {};
        runtime.loaded = true;
        runtime.loading = false;
        runtime.lastLoadAt = Date.now();
        runtime.promise = null;
        return runtime;
      });
      return runtime.promise;
    }

    function nostrTmdbMetaPut(value, classification) {
      const runtime = nostrTmdbMetaRuntime();
      const entry = normalizeNostrTmdbMetaEntry(Object.assign({}, value, { classification }));
      const key = nostrTmdbMetaEntryKey(entry);
      if (!entry || !key || !runtime.loaded) return false;
      runtime.entries[key] = entry;
      nostrTmdbMetaEnforceCapacity(runtime);
      scheduleNostrTmdbMetaSave();
      return true;
    }

    function nostrTmdbMetaFromItem(hotItem, item) {
      if (!hotItem || !item || typeof item !== "object" || !homeNostrSignalKey(hotItem)) return null;
      const mediaType = String(hotItem.mediaType || hotItem.media_type || "").toLowerCase();
      const genreValue = item.genreIds != null ? item.genreIds : item.genre_ids;
      const regionValue = item.originCountries != null ? item.originCountries : item.origin_country;
      const releaseValue = item.releaseDate != null ? item.releaseDate : mediaType === "tv" ? item.first_air_date : item.release_date;
      const posterPath = tmdbImagePath(item.pic);
      const backdropPath = tmdbImagePath(item.landscape);
      if ((mediaType !== "movie" && mediaType !== "tv") || !Array.isArray(genreValue) || !Array.isArray(regionValue) || releaseValue == null || !posterPath) return null;
      return normalizeNostrTmdbMetaEntry({
        version: NOSTR_TMDB_META_CACHE_VERSION,
        mediaType,
        tmdbId: hotItem.tmdbId,
        genreIds: genreValue,
        regions: regionValue,
        releaseDate: releaseValue,
        voteAverage: item.voteAverage != null ? item.voteAverage : item.vote_average,
        posterPath,
        backdropPath,
        fetchedAt: Date.now()
      });
    }

    function secondaryNostrAnimeMetadataFromItem(hotItem, item) {
      return nostrTmdbMetaFromItem(hotItem, item);
    }

    function nostrTmdbMetaFromDetail(hotItem, detail) {
      if (!hotItem || !detail || typeof detail !== "object" || detail.id == null || !homeNostrSignalKey(hotItem)) return null;
      const mediaType = String(hotItem.mediaType || hotItem.media_type || "").toLowerCase();
      const genreValue = Array.isArray(detail.genre_ids)
        ? detail.genre_ids
        : Array.isArray(detail.genres) ? detail.genres.map((genre) => genre && genre.id).filter((value) => value != null) : [];
      let regionValue = [];
      if (mediaType === "tv") {
        regionValue = Array.isArray(detail.origin_country) ? detail.origin_country : [];
      } else if (mediaType === "movie") {
        regionValue = Array.isArray(detail.production_countries)
          ? detail.production_countries.map((country) => country && (country.iso_3166_1 || country.iso)).filter(Boolean)
          : Array.isArray(detail.origin_country) ? detail.origin_country : [];
      }
      const releaseKey = mediaType === "tv" ? "first_air_date" : "release_date";
      if ((mediaType !== "movie" && mediaType !== "tv") || typeof detail[releaseKey] !== "string") return null;
      return normalizeNostrTmdbMetaEntry({
        version: NOSTR_TMDB_META_CACHE_VERSION,
        mediaType,
        tmdbId: hotItem.tmdbId,
        genreIds: genreValue,
        regions: regionValue,
        releaseDate: detail[releaseKey],
        voteAverage: detail.vote_average != null
          ? detail.vote_average
          : hotItem.voteAverage != null ? hotItem.voteAverage : hotItem.vote_average,
        posterPath: tmdbImagePath(detail.poster_path),
        backdropPath: tmdbImagePath(detail.backdrop_path),
        fetchedAt: Date.now()
      });
    }

    function nostrTmdbItemFromMetadata(hotItem, metadata, listId, index) {
      const entry = normalizeNostrTmdbMetaEntry(metadata);
      const hotMediaType = String(hotItem && (hotItem.mediaType || hotItem.media_type) || "").toLowerCase();
      if (!hotItem || !entry || hotMediaType !== entry.mediaType || !nostrTmdbMetaHasCanonicalPoster(entry)) return null;
      const raw = {
        id: entry.tmdbId,
        media_type: entry.mediaType,
        name: hotItem.title || "未命名",
        title: hotItem.title || "未命名",
        original_name: hotItem.title || "",
        original_title: hotItem.title || "",
        genre_ids: entry.genreIds,
        origin_country: entry.regions,
        release_date: entry.mediaType === "movie" ? entry.releaseDate : "",
        first_air_date: entry.mediaType === "tv" ? entry.releaseDate : "",
        poster_path: entry.posterPath,
        backdrop_path: entry.backdropPath,
        vote_average: entry.voteAverage
      };
      const item = normalizeTmdb(raw, { id: "secondary-nostr", title: listId, mediaType: entry.mediaType }, index);
      if (!item) return null;
      item.id = `tmdb:${entry.mediaType}:${entry.tmdbId}`;
      item.tmdbId = entry.tmdbId;
      item.mediaType = entry.mediaType;
      item.title = item.title || hotItem.title || "未命名";
      item.listId = listId;
      return nostrHotSignalOverlay(item, hotItem, listId);
    }

    function secondaryNostrKnownItem(hotItem, query) {
      const key = homeNostrSignalKey(hotItem);
      if (!key) return null;
      const pools = [];
      if (query && Array.isArray(query.items)) pools.push(query.items);
      if (state.recent && Array.isArray(state.recent.items)) pools.push(state.recent.items);
      if (state.homeLatest && Array.isArray(state.homeLatest.items)) pools.push(state.homeLatest.items);
      Object.keys(state.catalog || {}).forEach((id) => {
        if (Array.isArray(state.catalog[id])) pools.push(state.catalog[id]);
      });
      for (const pool of pools) {
        const found = pool.find((item) => homeNostrSignalKey(item) === key
          && String(item && item.source || "") !== "nostr-hot"
          && !!tmdbImagePath(item && item.pic));
        if (found) return found;
      }
      for (const pool of pools) {
        const found = pool.find((item) => homeNostrSignalKey(item) === key
          && String(item && item.source || "") === "nostr-hot"
          && String(item && item.nostrMetadataSource || "").trim()
          && !!tmdbImagePath(item && item.pic));
        if (found) return found;
      }
      return null;
    }

    function secondaryNostrDetailUrl(item) {
      const url = new URL(`${window.WEBHOME_CONFIG.tmdb.apiBase}/${item.mediaType}/${item.tmdbId}`);
      url.searchParams.set("api_key", tmdbApiKey());
      url.searchParams.set("language", window.WEBHOME_CONFIG.tmdb.language);
      return url.toString();
    }

    function secondaryNostrItemFromDetail(hotItem, detail, listId, index) {
      if (!detail || typeof detail !== "object") return null;
      const genreIds = Array.isArray(detail.genre_ids)
        ? detail.genre_ids
        : Array.isArray(detail.genres) ? detail.genres.map((genre) => genre && genre.id).filter((value) => value != null) : [];
      const raw = Object.assign({}, detail, {
        id: hotItem.tmdbId,
        media_type: hotItem.mediaType,
        genre_ids: genreIds,
        origin_country: detail.origin_country || (Array.isArray(detail.production_countries)
          ? detail.production_countries.map((country) => country && country.iso_3166_1).filter(Boolean)
          : []),
        vote_average: detail.vote_average != null
          ? detail.vote_average
          : hotItem.voteAverage != null ? hotItem.voteAverage : hotItem.vote_average
      });
      const item = normalizeTmdb(raw, { id: "secondary-nostr", title: listId, mediaType: hotItem.mediaType }, index);
      if (!item || !tmdbImagePath(item.pic)) return null;
      item.id = `tmdb:${hotItem.mediaType}:${hotItem.tmdbId}`;
      item.tmdbId = String(hotItem.tmdbId || "");
      item.mediaType = String(hotItem.mediaType || "").toLowerCase();
      item.title = item.title || hotItem.title || "未命名";
      item.listId = listId;
      return nostrHotSignalOverlay(item, hotItem, listId);
    }

    function secondaryNostrItemAllowed(id, item) {
      if (!item || !hasPoster(item)) return false;
      const listId = normalizeLegacyCategoryId(id);
      const type = secondaryItemMediaType(item);
      if (listId === "movie" && type !== "movie") return false;
      if (listId === "tv" && type !== "tv") return false;
      if (listId === "anime" && !secondaryItemGenreIds(item).includes("16")) return false;
      if (listId === "variety" && (type !== "tv" || !secondaryItemGenreIds(item).some((value) => ["10764", "10767"].includes(value)))) return false;
      const regions = secondaryItemRegions(item);
      if (listId === "anime" && regions.length && !regions.some((value) => SECONDARY_ANIMATION_REGION_IDS.includes(String(value).toUpperCase()))) return false;
      if (listId === "tv" && regions.length && !regions.some((value) => SECONDARY_TV_REGION_IDS.includes(String(value).toUpperCase()))) return false;
      if (listId === "tv" && secondaryItemGenreIds(item).some((value) => ["16", "99", "10763", "10764", "10766", "10767"].includes(value))) return false;
      return true;
    }

    function secondaryNostrHotFilterMatches(id, filters, item) {
      if (!secondaryNostrItemAllowed(id, item)) return false;
      if (isReleaseFilteredCatalogId(id) && !isReleasedAsOfToday(item)) return false;
      return (filters.mediaType === "all" || secondaryItemMediaType(item) === filters.mediaType)
        && (filters.genre === "all" || secondaryItemGenreIds(item).includes(filters.genre))
        && (filters.region === "all" || secondaryRegionMatches(item, filters.region))
        && (filters.year === "all" || secondaryYearMatches(item, filters.year));
    }

    function nostrListTitle(listId) {
      const id = normalizeLegacyCategoryId(listId);
      return id === "anime" ? "动画" : id === "tv" ? "电视剧" : id === "variety" ? "综艺" : "电影";
    }

    function nostrHotSignalOverlay(item, hotItem, listId) {
      if (!item) return null;
      const result = Object.assign({}, item, { source: "nostr-hot", listId, listTitle: nostrListTitle(listId) });
      const hot = hotItem || {};
      if (hot.people != null || hot.count != null) {
        result.people = hot.people != null ? hot.people : hot.count;
        result.count = hot.count != null ? hot.count : hot.people;
      }
      if (hot.latest != null) result.latest = hot.latest;
      else if (hot.lastEventAt != null || hot.last_event_at != null) result.latest = hot.lastEventAt != null ? hot.lastEventAt : hot.last_event_at;
      if (hot.lastEventAt != null || hot.last_event_at != null) result.lastEventAt = hot.lastEventAt != null ? hot.lastEventAt : hot.last_event_at;
      if (hot.nostrHotRank != null) result.nostrHotRank = hot.nostrHotRank;
      return result;
    }

    function nostrTmdbRecordFromMetadata(hotItem, metadata, listId, index, source) {
      const entry = normalizeNostrTmdbMetaEntry(metadata);
      const item = entry ? nostrTmdbItemFromMetadata(hotItem, entry, listId, index) : null;
      const valid = !!(item && secondaryNostrHotFilterMatches(listId, homeCategoryDefaultFilters(), item));
      if (!entry || !item) return { status: "failed", metadata: null, item: null, source: source || "" };
      entry.classification = valid ? "valid" : "invalid";
      item.nostrMetadataSource = source === "persistent" ? "cache" : source || "";
      return { status: valid ? "valid" : "invalid", metadata: entry, item: valid ? item : null, source: source || "" };
    }

    function nostrTmdbRecordFromDetail(hotItem, detail, listId, index, source) {
      const metadata = nostrTmdbMetaFromDetail(hotItem, detail);
      if (!metadata) return { status: "failed", metadata: null, item: null, source: source || "detail" };
      const record = nostrTmdbRecordFromMetadata(hotItem, metadata, listId, index, source || "detail");
      if (record.status === "valid" || record.status === "invalid") nostrTmdbMetaPut(record.metadata, record.status);
      return record;
    }

    function secondaryNostrAnimeRecordFromMetadata(hotItem, metadata, index, source) {
      return nostrTmdbRecordFromMetadata(hotItem, metadata, "anime", index, source);
    }

    function secondaryNostrAnimeCandidateKey(candidate) {
      return homeNostrSignalKey(candidate);
    }

    function secondaryNostrAnimeResolverKey(candidates) {
      return JSON.stringify([
        Number(state.hot && state.hot.version || 0),
        (Array.isArray(candidates) ? candidates : []).map((candidate, index) => [
          secondaryNostrAnimeCandidateKey(candidate),
          Number(candidate && (candidate.people || candidate.count) || 0),
          String(candidate && (candidate.latest || candidate.lastEventAt || candidate.last_event_at) || ""),
          index + 1
        ])
      ]);
    }

    function secondaryNostrAnimeEmptyMetrics() {
      return { candidatesScanned: 0, lastScannedRank: 0, knownMetadataHits: 0, persistentHits: 0, memoryHits: 0, newDetailRequests: 0, detailFailures: 0, finalAnimeMatches: 0 };
    }

    function secondaryNostrAnimeResolverState(candidates) {
      const home = state.homeV14;
      const source = Array.isArray(candidates) ? candidates : [];
      const key = secondaryNostrAnimeResolverKey(source);
      let runtime = home.secondaryNostrAnimeResolver;
      if (!runtime || runtime.key !== key) {
        runtime = home.secondaryNostrAnimeResolver = {
          key,
          candidates: source.map((candidate, index) => Object.assign({}, candidate, { nostrHotRank: index + 1 })),
          statuses: {},
          items: {},
          failedKeys: {},
          nextIndex: 0,
          done: false,
          detailBudgetExhausted: false,
          retryOnlyFailed: false,
          promise: null,
          listeners: [],
          metrics: secondaryNostrAnimeEmptyMetrics()
        };
      }
      return runtime;
    }

    function secondaryNostrAnimeQualifiedItems(runtime, filters, target) {
      if (!runtime) return [];
      const limit = Math.max(0, Number(target || SECONDARY_NOSTR_HOT_TARGET_MATCHES));
      const selected = [];
      (runtime.candidates || []).forEach((candidate) => {
        if (selected.length >= limit) return;
        const key = secondaryNostrAnimeCandidateKey(candidate);
        if (!key || runtime.statuses[key] !== "valid" || !runtime.items[key]) return;
        if (!secondaryNostrHotFilterMatches("anime", filters || homeCategoryDefaultFilters(), runtime.items[key])) return;
        selected.push(runtime.items[key]);
      });
      return selected;
    }

    function secondaryNostrAnimeNotify(runtime) {
      if (!runtime) return;
      const defaultItems = secondaryNostrAnimeQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_HOT_TARGET_MATCHES);
      runtime.metrics.finalAnimeMatches = defaultItems.length;
      if (state.homeV14 && state.homeV14.secondaryNostrAnimeResolver === runtime) {
        state.homeV14.secondaryNostrAnimeMetrics = Object.assign({}, runtime.metrics, {
          resolverKey: runtime.key,
          done: !!runtime.done,
          cacheEntries: Object.keys(nostrTmdbMetaRuntime().entries || {}).length,
          cacheLoaded: !!nostrTmdbMetaRuntime().loaded
        });
        if (state.tvDiag) state.tvDiag.nostrAnime = state.homeV14.secondaryNostrAnimeMetrics;
      }
      (runtime.listeners || []).slice().forEach((listener) => {
        if (!listener || typeof listener.onProgress !== "function") return;
        const items = secondaryNostrAnimeQualifiedItems(runtime, listener.filters, listener.target);
        try {
          if (!listener.isCurrent || listener.isCurrent()) listener.onProgress(items, runtime);
        } catch (e) {}
      });
    }

    function secondaryNostrAnimeApplyResult(runtime, candidate, wrapped) {
      if (!runtime || !candidate) return;
      const key = secondaryNostrAnimeCandidateKey(candidate);
      if (!key) return;
      const record = wrapped && wrapped.ok ? wrapped.value : null;
      const rank = Number(candidate.nostrHotRank || 0);
      runtime.metrics.lastScannedRank = Math.max(Number(runtime.metrics.lastScannedRank || 0), rank);
      if (record && (record.status === "valid" || record.status === "invalid")) {
        runtime.statuses[key] = record.status;
        if (record.status === "valid" && record.item) runtime.items[key] = record.item;
        else delete runtime.items[key];
        delete runtime.failedKeys[key];
      } else if (record && record.status === "budget") {
        runtime.detailBudgetExhausted = true;
        delete runtime.statuses[key];
        delete runtime.items[key];
      } else {
        delete runtime.statuses[key];
        delete runtime.items[key];
        runtime.failedKeys[key] = true;
        runtime.metrics.detailFailures = Number(runtime.metrics.detailFailures || 0) + 1;
      }
    }

    function secondaryNostrAnimeScanShouldContinue(runtime) {
      if (!runtime) return false;
      if (secondaryNostrAnimeQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_HOT_TARGET_MATCHES).length < SECONDARY_NOSTR_HOT_TARGET_MATCHES) return true;
      return (runtime.listeners || []).some((listener) => {
        if (!listener) return false;
        const filters = listener.filters || homeCategoryDefaultFilters();
        const nonDefault = ["mediaType", "genre", "region", "year"].some((key) => filters[key] && filters[key] !== "all");
        return nonDefault && secondaryNostrAnimeQualifiedItems(runtime, filters, listener.target).length < listener.target;
      });
    }

    async function secondaryNostrAnimeResolveCandidate(candidate, query, index, runtime) {
      const key = secondaryNostrAnimeCandidateKey(candidate);
      if (!key) return { status: "failed", metadata: null, item: null, source: "" };
      const known = secondaryNostrKnownItem(candidate, query);
      const knownMetadata = secondaryNostrAnimeMetadataFromItem(candidate, known);
      if (knownMetadata) {
        runtime.metrics.knownMetadataHits = Number(runtime.metrics.knownMetadataHits || 0) + 1;
        const record = secondaryNostrAnimeRecordFromMetadata(candidate, knownMetadata, index, "known");
        secondaryNostrAnimeMemoryCache()[key] = Promise.resolve(record);
        return record;
      }
      await ensureNostrTmdbMetaLoaded();
      const memory = secondaryNostrAnimeMemoryCache();
      if (memory[key]) {
        const memoryPromise = memory[key];
        runtime.metrics.memoryHits = Number(runtime.metrics.memoryHits || 0) + 1;
        const record = await Promise.resolve(memoryPromise);
        if (record && (record.status === "valid" || record.status === "invalid")) {
          const refreshed = record.metadata ? secondaryNostrAnimeRecordFromMetadata(candidate, record.metadata, index, "cache") : record;
          if (refreshed.item) refreshed.item.nostrMetadataSource = "cache";
          return refreshed;
        }
        if (memory[key] === memoryPromise) delete memory[key];
      }
      const persistent = nostrTmdbMetaRuntime().entries[key];
      if (persistent) {
        runtime.metrics.persistentHits = Number(runtime.metrics.persistentHits || 0) + 1;
        const record = secondaryNostrAnimeRecordFromMetadata(candidate, persistent, index, "persistent");
        if (record.status === "valid" || record.status === "invalid") {
          if (record.item) record.item.nostrMetadataSource = "cache";
          memory[key] = Promise.resolve(record);
          return record;
        }
      }
      runtime.metrics.newDetailRequests = Number(runtime.metrics.newDetailRequests || 0) + 1;
      const detailPromise = requestJson(secondaryNostrDetailUrl(candidate), 18)
        .then((body) => nostrTmdbRecordFromDetail(candidate, body, "anime", index, "detail"))
        .catch(() => ({ status: "failed", metadata: null, item: null, source: "detail" }));
      memory[key] = detailPromise.then((record) => {
        if (!record || (record.status !== "valid" && record.status !== "invalid")) {
          if (memory[key]) delete memory[key];
        }
        return record;
      });
      return memory[key];
    }

    async function secondaryRunNostrAnimeResolver(runtime, query) {
      await ensureNostrTmdbMetaLoaded();
      const retryOnlyFailed = !!runtime.retryOnlyFailed;
      while (runtime.nextIndex < runtime.candidates.length && (retryOnlyFailed ? Object.keys(runtime.failedKeys || {}).length > 0 : secondaryNostrAnimeScanShouldContinue(runtime))) {
        const defaultMatches = secondaryNostrAnimeQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_HOT_TARGET_MATCHES).length;
        const batchSize = !retryOnlyFailed && defaultMatches < SECONDARY_NOSTR_HOT_TARGET_MATCHES
          ? Math.min(SECONDARY_NOSTR_ANIME_SCAN_BATCH_SIZE, Math.max(1, SECONDARY_NOSTR_HOT_TARGET_MATCHES - defaultMatches))
          : SECONDARY_NOSTR_ANIME_SCAN_BATCH_SIZE;
        const batch = runtime.candidates.slice(runtime.nextIndex, runtime.nextIndex + batchSize);
        runtime.nextIndex += batch.length;
        runtime.metrics.candidatesScanned = Number(runtime.metrics.candidatesScanned || 0) + batch.length;
        const pending = batch.filter((candidate) => {
          const key = secondaryNostrAnimeCandidateKey(candidate);
          return !!key && (retryOnlyFailed ? !!runtime.failedKeys[key] : !runtime.statuses[key]);
        });
        if (!pending.length) {
          secondaryNostrAnimeNotify(runtime);
          continue;
        }
        await weeklyMapLimit(pending, SECONDARY_NOSTR_HOT_DETAIL_CONCURRENCY, (candidate) => {
          return secondaryNostrAnimeResolveCandidate(candidate, query, Number(candidate.nostrHotRank || 0) - 1, runtime);
        }, (wrapped, candidate) => {
          secondaryNostrAnimeApplyResult(runtime, candidate, wrapped);
          secondaryNostrAnimeNotify(runtime);
        });
        if (retryOnlyFailed ? !Object.keys(runtime.failedKeys || {}).length : !secondaryNostrAnimeScanShouldContinue(runtime)) break;
      }
      runtime.retryOnlyFailed = false;
      runtime.done = true;
      secondaryNostrAnimeNotify(runtime);
      await flushNostrTmdbMetaCache();
      return runtime;
    }

    function secondaryNostrAnimeStartResolver(runtime, query) {
      if (!runtime) return Promise.resolve(null);
      if (runtime.promise && !runtime.done) return runtime.promise;
      if (runtime.done && Object.keys(runtime.failedKeys || {}).length) {
        runtime.nextIndex = 0;
        runtime.done = false;
        runtime.promise = null;
        runtime.metrics = secondaryNostrAnimeEmptyMetrics();
        runtime.retryOnlyFailed = true;
      }
      if (runtime.done && secondaryNostrAnimeScanShouldContinue(runtime)) {
        runtime.done = false;
        runtime.promise = null;
      }
      if (!runtime.promise) runtime.promise = secondaryRunNostrAnimeResolver(runtime, query).catch(() => runtime);
      return runtime.promise;
    }

    async function secondaryLoadNostrAnimePool(filters, query, target, options) {
      const opts = options || {};
      const candidates = secondaryNostrHotCandidates("anime");
      const runtime = secondaryNostrAnimeResolverState(candidates);
      const listener = {
        filters: Object.assign({}, homeCategoryDefaultFilters(), filters || {}),
        target: Math.max(0, Number(target || SECONDARY_NOSTR_HOT_TARGET_MATCHES)),
        isCurrent: typeof opts.isCurrent === "function" ? opts.isCurrent : null,
        onProgress: typeof opts.onProgress === "function" ? opts.onProgress : null
      };
      runtime.listeners.push(listener);
      try {
        secondaryNostrAnimeNotify(runtime);
        await secondaryNostrAnimeStartResolver(runtime, query);
        return secondaryNostrAnimeQualifiedItems(runtime, listener.filters, listener.target);
      } finally {
        runtime.listeners = runtime.listeners.filter((entry) => entry !== listener);
      }
    }

    function secondaryNostrVarietyMemoryCache() {
      return secondaryNostrTmdbMemoryCache();
    }

    function secondaryNostrVarietyRecordFromMetadata(hotItem, metadata, index, source) {
      return nostrTmdbRecordFromMetadata(hotItem, metadata, "variety", index, source);
    }

    function secondaryNostrVarietyCandidateKey(candidate) {
      return homeNostrSignalKey(candidate);
    }

    function secondaryNostrVarietyResolverKey(candidates) {
      return JSON.stringify([
        Number(state.hot && state.hot.version || 0),
        (Array.isArray(candidates) ? candidates : []).map((candidate, index) => [
          secondaryNostrVarietyCandidateKey(candidate),
          Number(candidate && (candidate.people || candidate.count) || 0),
          String(candidate && (candidate.latest || candidate.lastEventAt || candidate.last_event_at) || ""),
          index + 1
        ])
      ]);
    }

    function secondaryNostrVarietyEmptyMetrics() {
      return { candidatesScanned: 0, lastScannedRank: 0, knownMetadataHits: 0, persistentHits: 0, memoryHits: 0, discoverRequests: 0, discoverMetadataMatches: 0, newDetailRequests: 0, detailFailures: 0, finalVarietyMatches: 0 };
    }

    function secondaryNostrVarietyResolverState(candidates) {
      const home = state.homeV14;
      const source = Array.isArray(candidates) ? candidates : [];
      const key = secondaryNostrVarietyResolverKey(source);
      let runtime = home.secondaryNostrVarietyResolver;
      if (!runtime || runtime.key !== key) {
        runtime = home.secondaryNostrVarietyResolver = {
          key,
          candidates: source.map((candidate, index) => Object.assign({}, candidate, { nostrHotRank: index + 1 })),
          statuses: {},
          items: {},
          failedKeys: {},
          nextIndex: 0,
          done: false,
          retryOnlyFailed: false,
          promise: null,
          listeners: [],
          discoverPrimed: false,
          discoverPromise: null,
          metrics: secondaryNostrVarietyEmptyMetrics()
        };
      }
      return runtime;
    }

    function secondaryNostrVarietyQualifiedItems(runtime, filters, target) {
      if (!runtime) return [];
      const limit = Math.max(0, Number(target || SECONDARY_NOSTR_VARIETY_TARGET_MATCHES));
      const selected = [];
      (runtime.candidates || []).forEach((candidate) => {
        if (selected.length >= limit) return;
        const key = secondaryNostrVarietyCandidateKey(candidate);
        if (!key || runtime.statuses[key] !== "valid" || !runtime.items[key]) return;
        if (!secondaryNostrHotFilterMatches("variety", filters || homeCategoryDefaultFilters(), runtime.items[key])) return;
        selected.push(runtime.items[key]);
      });
      return selected;
    }

    function secondaryNostrVarietyNotify(runtime) {
      if (!runtime) return;
      const defaultItems = secondaryNostrVarietyQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_VARIETY_TARGET_MATCHES);
      runtime.metrics.finalVarietyMatches = defaultItems.length;
      if (state.homeV14 && state.homeV14.secondaryNostrVarietyResolver === runtime) {
        state.homeV14.secondaryNostrVarietyMetrics = Object.assign({}, runtime.metrics, {
          resolverKey: runtime.key,
          done: !!runtime.done,
          cacheEntries: Object.keys(nostrTmdbMetaRuntime().entries || {}).length,
          cacheLoaded: !!nostrTmdbMetaRuntime().loaded
        });
        if (state.tvDiag) state.tvDiag.nostrVariety = state.homeV14.secondaryNostrVarietyMetrics;
      }
      (runtime.listeners || []).slice().forEach((listener) => {
        if (!listener || typeof listener.onProgress !== "function") return;
        const items = secondaryNostrVarietyQualifiedItems(runtime, listener.filters, listener.target);
        try {
          if (!listener.isCurrent || listener.isCurrent()) listener.onProgress(items, runtime);
        } catch (e) {}
      });
    }

    function secondaryNostrVarietyApplyResult(runtime, candidate, wrapped) {
      if (!runtime || !candidate) return;
      const key = secondaryNostrVarietyCandidateKey(candidate);
      if (!key) return;
      const record = wrapped && wrapped.ok ? wrapped.value : null;
      const rank = Number(candidate.nostrHotRank || 0);
      runtime.metrics.lastScannedRank = Math.max(Number(runtime.metrics.lastScannedRank || 0), rank);
      if (record && (record.status === "valid" || record.status === "invalid")) {
        runtime.statuses[key] = record.status;
        if (record.status === "valid" && record.item) runtime.items[key] = record.item;
        else delete runtime.items[key];
        delete runtime.failedKeys[key];
      } else if (record && record.status === "budget") {
        runtime.detailBudgetExhausted = true;
        delete runtime.statuses[key];
        delete runtime.items[key];
      } else {
        delete runtime.statuses[key];
        delete runtime.items[key];
        runtime.failedKeys[key] = true;
        runtime.metrics.detailFailures = Number(runtime.metrics.detailFailures || 0) + 1;
      }
    }

    function secondaryNostrVarietyPrimeDiscover(runtime) {
      if (!runtime) return Promise.resolve(runtime);
      if (runtime.discoverPrimed) return Promise.resolve(runtime);
      if (runtime.discoverPromise) return runtime.discoverPromise;
      runtime.discoverPromise = Promise.resolve().then(async () => {
        await ensureNostrTmdbMetaLoaded();
        const candidates = Array.isArray(runtime.candidates) ? runtime.candidates : [];
        const candidateMap = new Map();
        candidates.forEach((candidate) => {
          const key = secondaryNostrVarietyCandidateKey(candidate);
          if (key && !candidateMap.has(key)) candidateMap.set(key, candidate);
        });
        const sources = secondaryFullCatalogSources("variety");
        const memory = secondaryNostrVarietyMemoryCache();
        const matched = new Set();
        for (let sourceIndex = 0; sourceIndex < sources.length && matched.size < SECONDARY_NOSTR_VARIETY_TARGET_MATCHES; sourceIndex++) {
          const source = sources[sourceIndex];
          for (let page = 1; page <= 3 && matched.size < SECONDARY_NOSTR_VARIETY_TARGET_MATCHES; page++) {
            runtime.metrics.discoverRequests = Number(runtime.metrics.discoverRequests || 0) + 1;
            let body = null;
            try { body = await requestJson(tmdbUrl(source, page), 18); } catch (e) { break; }
            const results = Array.isArray(body && body.results) ? body.results : [];
            if (!results.length) break;
            results.forEach((raw, index) => {
              const normalized = normalizeTmdb(raw, source, (page - 1) * 20 + index);
              const key = homeNostrSignalKey(normalized);
              const candidate = key && candidateMap.get(key);
              if (!candidate || matched.has(key)) return;
              const persistent = nostrTmdbMetaRuntime().entries[key];
              if (memory[key] || persistent) {
                matched.add(key);
                return;
              }
              const metadata = nostrTmdbMetaFromItem(candidate, normalized);
              if (!metadata) return;
              const record = secondaryNostrVarietyRecordFromMetadata(candidate, metadata, Number(candidate.nostrHotRank || 0) - 1, "discover");
              if (record.status !== "valid" && record.status !== "invalid") return;
              runtime.metrics.discoverMetadataMatches = Number(runtime.metrics.discoverMetadataMatches || 0) + 1;
              matched.add(key);
              memory[key] = Promise.resolve(record);
              nostrTmdbMetaPut(record.metadata, record.status);
            });
          }
        }
        runtime.discoverPrimed = true;
        runtime.discoverPromise = null;
        return runtime;
      }).catch(() => {
        runtime.discoverPrimed = true;
        runtime.discoverPromise = null;
        return runtime;
      });
      return runtime.discoverPromise;
    }

    function secondaryNostrVarietyScanShouldContinue(runtime) {
      if (!runtime) return false;
      if (runtime.detailBudgetExhausted) return false;
      if (secondaryNostrVarietyQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_VARIETY_TARGET_MATCHES).length < SECONDARY_NOSTR_VARIETY_TARGET_MATCHES) return true;
      return (runtime.listeners || []).some((listener) => {
        if (!listener) return false;
        const filters = listener.filters || homeCategoryDefaultFilters();
        const nonDefault = ["mediaType", "genre", "region", "year"].some((key) => filters[key] && filters[key] !== "all");
        return nonDefault && secondaryNostrVarietyQualifiedItems(runtime, filters, listener.target).length < listener.target;
      });
    }

    async function secondaryNostrVarietyResolveCandidate(candidate, query, index, runtime) {
      const key = secondaryNostrVarietyCandidateKey(candidate);
      if (!key) return { status: "failed", metadata: null, item: null, source: "" };
      const known = secondaryNostrKnownItem(candidate, query);
      const knownMetadata = nostrTmdbMetaFromItem(candidate, known);
      if (knownMetadata) {
        runtime.metrics.knownMetadataHits = Number(runtime.metrics.knownMetadataHits || 0) + 1;
        const record = secondaryNostrVarietyRecordFromMetadata(candidate, knownMetadata, index, "known");
        secondaryNostrVarietyMemoryCache()[key] = Promise.resolve(record);
        return record;
      }
      await ensureNostrTmdbMetaLoaded();
      const memory = secondaryNostrVarietyMemoryCache();
      if (memory[key]) {
        const memoryPromise = memory[key];
        runtime.metrics.memoryHits = Number(runtime.metrics.memoryHits || 0) + 1;
        const record = await Promise.resolve(memoryPromise);
        if (record && (record.status === "valid" || record.status === "invalid")) {
          const memorySource = record.source === "discover" ? "discover" : "cache";
          const refreshed = record.metadata ? secondaryNostrVarietyRecordFromMetadata(candidate, record.metadata, index, memorySource) : record;
          if (refreshed.item) refreshed.item.nostrMetadataSource = memorySource;
          return refreshed;
        }
        if (memory[key] === memoryPromise) delete memory[key];
      }
      const persistent = nostrTmdbMetaRuntime().entries[key];
      if (persistent) {
        runtime.metrics.persistentHits = Number(runtime.metrics.persistentHits || 0) + 1;
        const record = secondaryNostrVarietyRecordFromMetadata(candidate, persistent, index, "persistent");
        if (record.status === "valid" || record.status === "invalid") {
          if (record.item) record.item.nostrMetadataSource = "cache";
          memory[key] = Promise.resolve(record);
          return record;
        }
      }
      if (!runtime.retryOnlyFailed && Number(runtime.metrics.newDetailRequests || 0) >= SECONDARY_NOSTR_VARIETY_MAX_NEW_DETAIL_REQUESTS) {
        return { status: "budget", metadata: null, item: null, source: "budget" };
      }
      runtime.metrics.newDetailRequests = Number(runtime.metrics.newDetailRequests || 0) + 1;
      const detailPromise = requestJson(secondaryNostrDetailUrl(candidate), 18)
        .then((body) => nostrTmdbRecordFromDetail(candidate, body, "variety", index, "detail"))
        .catch(() => ({ status: "failed", metadata: null, item: null, source: "detail" }));
      memory[key] = detailPromise.then((record) => {
        if (!record || (record.status !== "valid" && record.status !== "invalid")) {
          if (memory[key]) delete memory[key];
        }
        return record;
      });
      return memory[key];
    }

    async function secondaryRunNostrVarietyResolver(runtime, query) {
      await ensureNostrTmdbMetaLoaded();
      const retryOnlyFailed = !!runtime.retryOnlyFailed;
      while (runtime.nextIndex < runtime.candidates.length && (retryOnlyFailed ? Object.keys(runtime.failedKeys || {}).length > 0 : secondaryNostrVarietyScanShouldContinue(runtime))) {
        const defaultMatches = secondaryNostrVarietyQualifiedItems(runtime, homeCategoryDefaultFilters(), SECONDARY_NOSTR_VARIETY_TARGET_MATCHES).length;
        const batchSize = !retryOnlyFailed && defaultMatches < SECONDARY_NOSTR_VARIETY_TARGET_MATCHES
          ? Math.min(SECONDARY_NOSTR_VARIETY_SCAN_BATCH_SIZE, Math.max(1, SECONDARY_NOSTR_VARIETY_TARGET_MATCHES - defaultMatches))
          : SECONDARY_NOSTR_VARIETY_SCAN_BATCH_SIZE;
        const batch = runtime.candidates.slice(runtime.nextIndex, runtime.nextIndex + batchSize);
        runtime.nextIndex += batch.length;
        runtime.metrics.candidatesScanned = Number(runtime.metrics.candidatesScanned || 0) + batch.length;
        const pending = batch.filter((candidate) => {
          const key = secondaryNostrVarietyCandidateKey(candidate);
          return !!key && (retryOnlyFailed ? !!runtime.failedKeys[key] : !runtime.statuses[key]);
        });
        if (!pending.length) {
          secondaryNostrVarietyNotify(runtime);
          continue;
        }
        await weeklyMapLimit(pending, SECONDARY_NOSTR_HOT_DETAIL_CONCURRENCY, (candidate) => {
          return secondaryNostrVarietyResolveCandidate(candidate, query, Number(candidate.nostrHotRank || 0) - 1, runtime);
        }, (wrapped, candidate) => {
          secondaryNostrVarietyApplyResult(runtime, candidate, wrapped);
          secondaryNostrVarietyNotify(runtime);
        });
        if (retryOnlyFailed ? !Object.keys(runtime.failedKeys || {}).length : !secondaryNostrVarietyScanShouldContinue(runtime)) break;
      }
      runtime.retryOnlyFailed = false;
      runtime.done = true;
      secondaryNostrVarietyNotify(runtime);
      await flushNostrTmdbMetaCache();
      return runtime;
    }

    function secondaryNostrVarietyStartResolver(runtime, query) {
      if (!runtime) return Promise.resolve(null);
      if (runtime.promise && !runtime.done) return runtime.promise;
      if (runtime.done && Object.keys(runtime.failedKeys || {}).length) {
        runtime.nextIndex = 0;
        runtime.done = false;
        runtime.promise = null;
        runtime.metrics = secondaryNostrVarietyEmptyMetrics();
        runtime.retryOnlyFailed = true;
      }
      if (runtime.done && secondaryNostrVarietyScanShouldContinue(runtime)) {
        runtime.done = false;
        runtime.promise = null;
      }
      if (!runtime.promise) runtime.promise = secondaryRunNostrVarietyResolver(runtime, query).catch(() => runtime);
      return runtime.promise;
    }

    async function secondaryLoadNostrVarietyPool(filters, query, target, options) {
      const opts = options || {};
      const candidates = secondaryNostrHotCandidates("variety");
      const runtime = secondaryNostrVarietyResolverState(candidates);
      const listener = {
        filters: Object.assign({}, homeCategoryDefaultFilters(), filters || {}),
        target: Math.max(0, Number(target || SECONDARY_NOSTR_VARIETY_TARGET_MATCHES)),
        isCurrent: typeof opts.isCurrent === "function" ? opts.isCurrent : null,
        onProgress: typeof opts.onProgress === "function" ? opts.onProgress : null
      };
      runtime.listeners.push(listener);
      try {
        await secondaryNostrVarietyPrimeDiscover(runtime);
        secondaryNostrVarietyNotify(runtime);
        await secondaryNostrVarietyStartResolver(runtime, query);
        return secondaryNostrVarietyQualifiedItems(runtime, listener.filters, listener.target);
      } finally {
        runtime.listeners = runtime.listeners.filter((entry) => entry !== listener);
      }
    }

    async function secondaryNostrEnrichCandidate(hotItem, listId, query, index) {
      const known = secondaryNostrKnownItem(hotItem, query);
      if (known && secondaryNostrItemAllowed(listId, known)) {
        const knownItem = nostrHotSignalOverlay(known, hotItem, listId);
        if (knownItem) knownItem.nostrMetadataSource = "known";
        return knownItem;
      }
      const key = homeNostrSignalKey(hotItem);
      if (!key) return null;
      await ensureNostrTmdbMetaLoaded();
      const memory = secondaryNostrTmdbMemoryCache();
      const memoryPromise = memory[key];
      if (memoryPromise) {
        const memoryRecord = await Promise.resolve(memoryPromise);
        if (memoryRecord && (memoryRecord.status === "valid" || memoryRecord.status === "invalid")) {
          const refreshed = memoryRecord.metadata
            ? nostrTmdbRecordFromMetadata(hotItem, memoryRecord.metadata, listId, index, "cache")
            : memoryRecord;
          if (refreshed.status === "valid") return nostrHotSignalOverlay(refreshed.item, hotItem, listId);
        }
        if (memory[key] === memoryPromise) delete memory[key];
      }
      const persistent = nostrTmdbMetaRuntime().entries[key];
      if (persistent) {
        const record = nostrTmdbRecordFromMetadata(hotItem, persistent, listId, index, "persistent");
        if (record.status === "valid" || record.status === "invalid") {
          memory[key] = Promise.resolve(record);
          return record.status === "valid"
            ? nostrHotSignalOverlay(record.item, hotItem, listId)
            : null;
        }
      }
      const detailPromise = requestJson(secondaryNostrDetailUrl(hotItem), 18)
        .then((body) => nostrTmdbRecordFromDetail(hotItem, body, listId, index, "detail"))
        .catch(() => ({ status: "failed", metadata: null, item: null, source: "detail" }));
      memory[key] = detailPromise.then((record) => {
        if (!record || (record.status !== "valid" && record.status !== "invalid")) {
          if (memory[key]) delete memory[key];
        }
        return record;
      });
      const record = await Promise.resolve(memory[key]);
      return record && record.status === "valid"
        ? nostrHotSignalOverlay(record.item, hotItem, listId)
        : null;
    }

    function secondaryNostrDetailRequestNeeded(hotItem, listId, query) {
      const known = secondaryNostrKnownItem(hotItem, query);
      if (known && secondaryNostrItemAllowed(listId, known)) return false;
      const key = homeNostrSignalKey(hotItem);
      const memory = secondaryNostrTmdbMemoryCache();
      const persistent = nostrTmdbMetaRuntime().entries[key];
      return !!key && !memory[key] && (!persistent || !nostrTmdbMetaHasCanonicalPoster(persistent));
    }

    function secondaryNostrTaskIsCurrent(id, filters, query, generation) {
      if (!query || !query.nostrHot || homeHotSource() !== "nostr") return false;
      if (homeUiRoute() !== "secondary" || state.homeV14.secondaryListId !== id) return false;
      if (secondaryActiveQuery(id) !== query || Number(query.nostrHotGeneration || 0) !== Number(generation || 0)) return false;
      return secondaryFilterKey(id, secondaryFilterState(id)) === query.key
        && secondaryFilterKey(id, filters) === query.key;
    }

    function secondaryNostrGridFocusSnapshot() {
      const grid = $("secondaryCatalogGrid");
      const active = document.activeElement;
      if (!grid || !active || !grid.contains(active)) return null;
      const mediaKey = String(active.dataset && active.dataset.mediaKey || mediaDomKey(active.__mediaItem) || "");
      return mediaKey ? { mediaKey, scrollTop: grid.scrollTop, scrollLeft: grid.scrollLeft } : null;
    }

    function restoreSecondaryNostrGridFocus(snapshot) {
      if (!snapshot || homeUiRoute() !== "secondary") return;
      const grid = $("secondaryCatalogGrid");
      if (!grid) return;
      let target = Array.from(grid.querySelectorAll(".card")).find((card) => String(card.dataset.mediaKey || mediaDomKey(card.__mediaItem) || "") === snapshot.mediaKey) || null;
      const info = state.gridRender[gridRenderId(grid)];
      if (!target && info && Array.isArray(info.items)) {
        const index = info.items.findIndex((item) => String(mediaDomKey(item) || "") === snapshot.mediaKey);
        if (index >= 0 && Number(info.rendered || 0) <= index) {
          appendGridItems(grid, info.items, index + 1);
          target = Array.from(grid.querySelectorAll(".card")).find((card) => String(card.dataset.mediaKey || mediaDomKey(card.__mediaItem) || "") === snapshot.mediaKey) || null;
        }
      }
      if (target && isVisibleFocusable(target)) {
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        syncFocusedCardHalo(target);
      }
      grid.scrollTop = snapshot.scrollTop;
      grid.scrollLeft = snapshot.scrollLeft;
    }

    function commitSecondaryNostrHotItems(id, filters, query, generation, items) {
      if (!secondaryNostrTaskIsCurrent(id, filters, query, generation)) return false;
      const focus = secondaryNostrGridFocusSnapshot();
      query.nostrHotItems = uniqueMedia(Array.isArray(items) ? items : []);
      const fallback = (query.items || []).filter((item) => item && item.source !== "nostr-hot");
      query.items = uniqueMedia(query.nostrHotItems.concat(fallback));
      const progressiveCategory = ["anime", "variety"].includes(normalizeLegacyCategoryId(id));
      if (progressiveCategory && query.nostrHotItems.length && !query.loaded) {
        query.loaded = true;
        query.error = "";
      }
      if (query.loaded || progressiveCategory && query.nostrHotItems.length) {
        renderSecondaryCatalog();
        restoreSecondaryNostrGridFocus(focus);
      }
      return true;
    }

    async function secondaryLoadNostrHotItems(id, filters, query) {
      if (!secondaryNostrHotEnabled(id, filters) || !query || !query.nostrHot) return [];
      if (query.nostrHotLoaded) return Array.isArray(query.nostrHotItems) ? query.nostrHotItems : [];
      if (query.nostrHotLoading) return Array.isArray(query.nostrHotItems) ? query.nostrHotItems : [];
      if (!state.hot || !state.hot.ready) return [];
      const scanFilters = {
        mediaType: filters.mediaType,
        genre: filters.genre,
        region: filters.region,
        year: filters.year,
        sort: filters.sort
      };
      const generation = Number(query.nostrHotGeneration || 0) + 1;
      query.nostrHotGeneration = generation;
      query.nostrHotLoading = true;
      query.nostrHotItems = [];
      if (id === "anime") {
        try {
          const qualifiedAnime = await secondaryLoadNostrAnimePool(scanFilters, query, SECONDARY_NOSTR_HOT_TARGET_MATCHES, {
            isCurrent: () => secondaryNostrTaskIsCurrent(id, scanFilters, query, generation),
            onProgress: (items) => commitSecondaryNostrHotItems(id, scanFilters, query, generation, items)
          });
          if (secondaryNostrTaskIsCurrent(id, scanFilters, query, generation)) {
            query.nostrHotItems = uniqueMedia(qualifiedAnime);
            query.nostrHotLoaded = true;
            commitSecondaryNostrHotItems(id, scanFilters, query, generation, qualifiedAnime);
          }
          return qualifiedAnime;
        } finally {
          if (Number(query.nostrHotGeneration || 0) === generation) query.nostrHotLoading = false;
        }
      }
      if (id === "variety") {
        try {
          const qualifiedVariety = await secondaryLoadNostrVarietyPool(scanFilters, query, SECONDARY_NOSTR_VARIETY_TARGET_MATCHES, {
            isCurrent: () => secondaryNostrTaskIsCurrent(id, scanFilters, query, generation),
            onProgress: (items) => commitSecondaryNostrHotItems(id, scanFilters, query, generation, items)
          });
          if (secondaryNostrTaskIsCurrent(id, scanFilters, query, generation)) {
            query.nostrHotItems = uniqueMedia(qualifiedVariety);
            query.nostrHotLoaded = true;
            commitSecondaryNostrHotItems(id, scanFilters, query, generation, qualifiedVariety);
          }
          return qualifiedVariety;
        } finally {
          if (Number(query.nostrHotGeneration || 0) === generation) query.nostrHotLoading = false;
        }
      }
      await ensureNostrTmdbMetaLoaded();
      const qualified = [];
      let newDetailRequests = 0;
      try {
        const candidates = secondaryNostrHotCandidates(id);
        for (let offset = 0; offset < candidates.length && qualified.length < SECONDARY_NOSTR_HOT_TARGET_MATCHES; offset += SECONDARY_NOSTR_HOT_BATCH_SIZE) {
          if (!secondaryNostrTaskIsCurrent(id, scanFilters, query, generation)) return qualified;
          const batch = candidates.slice(offset, offset + SECONDARY_NOSTR_HOT_BATCH_SIZE).filter((candidate) => {
            const needsDetail = secondaryNostrDetailRequestNeeded(candidate, id, query);
            if (needsDetail) {
              if (newDetailRequests >= SECONDARY_NOSTR_HOT_MAX_NEW_DETAIL_REQUESTS) return false;
              newDetailRequests += 1;
            }
            return true;
          });
          if (!batch.length) continue;
          const results = await weeklyMapLimit(batch, SECONDARY_NOSTR_HOT_DETAIL_CONCURRENCY, (candidate, index) => secondaryNostrEnrichCandidate(candidate, id, query, index));
          if (!secondaryNostrTaskIsCurrent(id, scanFilters, query, generation)) return qualified;
          const matches = results
            .filter((result) => result && result.ok && result.value && secondaryNostrHotFilterMatches(id, scanFilters, result.value))
            .map((result) => result.value)
            .slice(0, Math.max(0, SECONDARY_NOSTR_HOT_TARGET_MATCHES - qualified.length));
          if (matches.length) qualified.push(...matches);
          commitSecondaryNostrHotItems(id, scanFilters, query, generation, qualified);
        }
        if (secondaryNostrTaskIsCurrent(id, scanFilters, query, generation)) {
          query.nostrHotItems = uniqueMedia(qualified);
          query.nostrHotLoaded = true;
        }
        return qualified;
      } finally {
        if (Number(query.nostrHotGeneration || 0) === generation) query.nostrHotLoading = false;
      }
    }

    function refreshActiveNostrSecondaryQuery(force) {
      if (homeUiRoute() !== "secondary") return false;
      const id = normalizeLegacyCategoryId(state.homeV14 && state.homeV14.secondaryListId);
      const filters = id ? secondaryFilterState(id) : null;
      const query = id ? secondaryActiveQuery(id) : null;
      if (!query || !secondaryNostrHotEnabled(id, filters) || !state.hot || !state.hot.ready) return false;
      if (query.nostrHotLoading) return false;
      if (force) {
        query.nostrHotLoaded = false;
        query.nostrHotItems = [];
        query.items = (query.items || []).filter((item) => item && item.source !== "nostr-hot");
      }
      if (query.nostrHotLoaded) return false;
      secondaryLoadNostrHotItems(id, filters, query).catch(() => {});
      return true;
    }
