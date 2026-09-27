    function secondaryFilterDefaults() { return { mediaType: "all", genre: "all", region: "all", year: "all", sort: "hot", lastFocused: {} }; }
    function secondaryFilterState(id) {
      id = normalizeLegacyCategoryId(id);
      const home = state.homeV14;
      home.secondaryFilters = home.secondaryFilters && typeof home.secondaryFilters === "object" ? home.secondaryFilters : {};
      const filters = home.secondaryFilters[id] = Object.assign(secondaryFilterDefaults(), home.secondaryFilters[id] || {});
      filters.lastFocused = Object.assign({}, filters.lastFocused || {});
      if (filters.sort === "default" || !["hot", "latest", "rating"].includes(filters.sort)) filters.sort = "hot";
      if (filters.lastFocused.sort === "default" || !["hot", "latest", "rating"].includes(filters.lastFocused.sort)) filters.lastFocused.sort = filters.sort;
      return filters;
    }
    function secondaryCatalogBaseItems(id) {
      id = normalizeLegacyCategoryId(id);
      if (id === "recent") return state.recent && Array.isArray(state.recent.items) ? state.recent.items : [];
      if (id === "recommendation") return filterBlocked(uniqueMedia(state.hot && state.hot.items || []));
      // now-playing is the finite Weekly Feed route.  It is populated from
      // state.homeLatest by loadSecondaryPage instead of the catalog cache.
      if (id === "now-playing") return [];
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
      if (id === "recent" || id === "recommendation") return [];
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
          { id, title: "动画", endpoint: "discover/tv", mediaType: "tv", params: Object.assign({}, common, { with_genres: "16" }) },
          { id, title: "动画", endpoint: "discover/movie", mediaType: "movie", params: { with_genres: "16", sort_by: "popularity.desc" } }
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
      const sourceKind = id === "now-playing" ? "weekly-feed" : id === "recent" ? "local-history" : id === "recommendation" ? "recommendation-pool" : "tmdb";
      return JSON.stringify([id, sourceKind, filters.mediaType, filters.genre, filters.region, filters.year, filters.sort]);
    }
    function secondaryGetQuery(id) {
      id = normalizeLegacyCategoryId(id);
      const home = state.homeV14;
      home.secondaryQueries = home.secondaryQueries && typeof home.secondaryQueries === "object" ? home.secondaryQueries : {};
      const filters = secondaryFilterState(id);
      const key = secondaryFilterKey(id, filters);
      let query = home.secondaryQueries[key];
      const source = id === "now-playing" ? "weekly-feed" : id === "recent" ? "local-history" : id === "recommendation" ? "recommendation" : "tmdb";
      if (!query) {
        query = home.secondaryQueries[key] = {
          key,
          listId: id,
          source,
          page: 0,
          totalPages: 0,
          totalResults: 0,
          loading: false,
          loaded: false,
          hasMore: false,
          hasMoreLocal: false,
          items: [],
          error: "",
          retryableError: "",
          failedPage: 0,
          requestSeq: 0,
          serverSideFilters: [],
          clientSideFilters: [],
          endpointMap: [],
          sourceStates: [],
          tmdbMetrics: null,
          finite: source === "weekly-feed" || source === "local-history" || source === "recommendation",
          snapshotReady: false,
          snapshotSource: "",
          poolItems: source === "recommendation" ? [] : null,
          renderedCount: 0,
          batchSize: 18,
          stale: false
        };
      }
      query.source = source;
      if (source === "recommendation" && !Array.isArray(query.poolItems)) query.poolItems = [];
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
      if (id === "now-playing" || id === "recent" || id === "recommendation") {
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

    function secondaryTmdbErrorStatus(error) {
      const value = error && (error.status || error.statusCode || error.httpStatus);
      const numeric = Number(value);
      return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
    }

    function secondaryTmdbErrorIsTerminal(error) {
      if (error && error.terminal === true) return true;
      const status = secondaryTmdbErrorStatus(error);
      return [400, 401, 403, 404].includes(status);
    }

    function secondaryTmdbSourceHasMore(sourceState) {
      return !!(sourceState && !sourceState.exhausted && !sourceState.terminalError);
    }

    function buildSecondaryQueryPlan(id, filters, query) {
      id = normalizeLegacyCategoryId(id);
      const sources = secondaryQuerySourceLists(id, filters, query);
      const finite = false;
      const prior = Array.isArray(query.sourceStates) ? query.sourceStates : [];
      const sourceStates = sources.map((source, index) => {
          const key = secondarySourceKey(source, index);
          const old = prior.find((entry) => entry.key === key) || {};
          const previousError = String(old.retryableError || old.error || "");
          const previousTerminalError = String(old.terminalError || "");
          const previousExhausted = old.exhausted === true
            || (old.exhausted == null && old.done === true && !previousError && !previousTerminalError);
          const next = Object.assign({ key, endpoint: source.endpoint || "", mediaType: source.mediaType || "", page: 0, totalPages: 0, exhausted: false, loading: false, retryableError: "", terminalError: "", totalResults: 0 }, old, {
            key,
            endpoint: source.endpoint || "",
            mediaType: source.mediaType || "",
            loading: false,
            exhausted: previousExhausted,
            retryableError: previousError,
            terminalError: previousTerminalError,
          });
          delete next.error;
          return next;
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
      if (id === "recent" || id === "now-playing" || id === "recommendation") return [];
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
