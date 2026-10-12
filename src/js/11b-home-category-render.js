    function showHomeRailStatus(rail, message, options) {
      if (!rail) return;
      const opts = options || {};
      const status = document.createElement("div");
      status.className = "home-rail-status";
      if (opts.variant === "landscape") status.classList.add("landscape");
      status.textContent = message || "";
      rail.dataset.homeRenderKeys = "";
      replaceHomeRailChildren(rail, [status], captureHomeRailFocus(rail));
    }

    const HOME_CATEGORY_IDS = new Set(["movie", "tv", "anime", "documentary", "variety"]);
    const HOME_CATEGORY_CACHE_VERSION = 1;
    const HOME_CATEGORY_CACHE_TTL_MS = 30 * 60 * 1000;

    function isHomeCategoryId(id) {
      return HOME_CATEGORY_IDS.has(normalizeLegacyCategoryId(id));
    }

    function homeCategoryFeedKey(id) {
      id = normalizeLegacyCategoryId(id);
      const sourceIdentity = homeCategoryTmdbSources(id).map((source) => ({
        endpoint: source.endpoint,
        mediaType: source.mediaType,
        params: source.params || {}
      }));
      return JSON.stringify([id, "tmdb", sourceIdentity]);
    }

    function homeCategoryFeed(id) {
      id = normalizeLegacyCategoryId(id);
      if (!isHomeCategoryId(id)) return null;
      const home = state.homeV14;
      home.categoryFeeds = home.categoryFeeds && typeof home.categoryFeeds === "object" ? home.categoryFeeds : {};
      let feed = home.categoryFeeds[id];
      if (!feed) {
        feed = home.categoryFeeds[id] = {
          id,
          key: "",
          source: "",
          items: [],
          loading: false,
          loaded: false,
          loadedAt: 0,
          error: "",
          promise: null,
          requestSeq: 0,
          cacheChecked: false,
          cacheHydrated: false,
          cacheSavedAt: 0,
          networkLoaded: false,
          partial: false,
          requestClass: "foreground",
          dataVersion: "",
          signature: ""
        };
      }
      const key = homeCategoryFeedKey(id);
      if (feed.key !== key) {
        feed.key = key;
        feed.source = "tmdb";
        feed.items = [];
        feed.loading = false;
        feed.loaded = false;
        feed.loadedAt = 0;
        feed.error = "";
        feed.promise = null;
        feed.requestSeq = Number(feed.requestSeq || 0) + 1;
        feed.cacheChecked = false;
        feed.cacheHydrated = false;
        feed.cacheSavedAt = 0;
        feed.networkLoaded = false;
        feed.partial = false;
        feed.dataVersion = key;
        feed.signature = key;
      }
      return feed;
    }

    function invalidateHomeCategoryFeeds() {
      const home = state.homeV14;
      const feeds = home && home.categoryFeeds;
      if (!feeds || typeof feeds !== "object") return;
      Object.keys(feeds).forEach((id) => {
        const feed = feeds[id];
        if (!feed) return;
        feed.key = "";
        feed.items = [];
        feed.loading = false;
        feed.loaded = false;
        feed.loadedAt = 0;
        feed.error = "";
        feed.promise = null;
        feed.requestSeq = Number(feed.requestSeq || 0) + 1;
        feed.cacheChecked = false;
        feed.cacheHydrated = false;
        feed.cacheSavedAt = 0;
        feed.networkLoaded = false;
        feed.partial = false;
      });
    }

    function homeCategoryFeedIsCurrent(feed, key, requestSeq) {
      return !!(feed && feed.key === key && Number(feed.requestSeq || 0) === Number(requestSeq || 0));
    }

    function homeCategoryFeedNeedsRefresh(feed, now) {
      if (!feed || !feed.loaded) return true;
      const loadedAt = Number(feed.loadedAt || feed.cacheSavedAt || 0);
      const age = Number(now || Date.now()) - loadedAt;
      return loadedAt <= 0 || age < 0 || age >= HOME_CATEGORY_CACHE_TTL_MS;
    }

    function homeCategoryDefaultFilters() {
      return { mediaType: "all", genre: "all", region: "all", year: "all", sort: "hot" };
    }

    function homeCategoryTmdbSources(id) {
      const filters = homeCategoryDefaultFilters();
      return secondaryFullCatalogSources(id)
        .map((source) => secondaryApplyServerFilters(source, filters))
        .filter(Boolean)
        .map((result) => result.entry);
    }

    async function loadHomeCategoryTmdbPool(id, requestClass, requestKey, onSourceResult) {
      const sources = homeCategoryTmdbSources(id);
      if (!sources.length) return { items: [], error: "暂无可用来源", goodCount: 0, totalSources: 0 };
      let goodCount = 0;
      const sourceItems = sources.map(() => []);
      await Promise.all(sources.map((source, sourceIndex) => Promise.resolve()
        .then(() => homeRequestJson(tmdbUrl(source, 1), 18, requestClass, requestKey))
        .then((body) => {
          goodCount += 1;
          sourceItems[sourceIndex] = (Array.isArray(body && body.results) ? body.results : [])
            .map((item, index) => normalizeTmdb(item, source, index))
            .filter((item) => hasPoster(item) && (!isReleaseFilteredCatalogId(id) || isReleasedAsOfToday(item)));
          if (typeof onSourceResult === "function") {
            const partialItems = uniqueMedia(filterReleasedCatalogItems(id, sourceItems.reduce((all, items) => all.concat(items), [])));
            if (partialItems.length) {
              try { onSourceResult(partialItems, { sourceIndex, goodCount, totalSources: sources.length }); } catch (e) {}
            }
          }
        })
        .catch(() => { sourceItems[sourceIndex] = []; })));
      const incoming = sourceItems.reduce((all, items) => all.concat(items), []);
      return {
        items: uniqueMedia(filterReleasedCatalogItems(id, incoming)),
        error: goodCount ? "" : "加载失败",
        goodCount,
        totalSources: sources.length
      };
    }

    function homeCategoryFeedLimit(id) {
      const config = homeSectionConfig().find((entry) => entry.listId === normalizeLegacyCategoryId(id));
      return Number(config && config.initialLimit || homeRailLimit("portrait"));
    }

    function homeCategoryCacheKey(id) {
      return "fish2018_home_v1_home_category_" + normalizeLegacyCategoryId(id);
    }

    function homeCategoryCacheItem(item, categoryId) {
      if (!item || typeof item !== "object" || String(item.source || "") !== "tmdb") return null;
      const mediaType = String(item.mediaType || "").toLowerCase();
      const tmdbId = String(item.tmdbId || "").trim();
      if ((mediaType !== "movie" && mediaType !== "tv") || !/^\d+$/.test(tmdbId) || !String(item.pic || "").trim()) return null;
      return {
        id: `tmdb:${mediaType}:${tmdbId}`,
        source: "tmdb",
        tmdbId,
        mediaType,
        listId: normalizeLegacyCategoryId(categoryId),
        listTitle: String(item.listTitle || categoryId).slice(0, 80),
        title: String(item.title || "未命名").slice(0, 240),
        originalTitle: String(item.originalTitle || "").slice(0, 240),
        aliases: (Array.isArray(item.aliases) ? item.aliases : []).map((value) => String(value || "").slice(0, 240)).filter(Boolean).slice(0, 12),
        resourceSearchTitle: String(item.resourceSearchTitle || item.title || "").slice(0, 240),
        pic: String(item.pic || ""),
        landscape: String(item.landscape || ""),
        image: String(item.image || item.landscape || item.pic || ""),
        remark: String(item.remark || "").slice(0, 120),
        desc: String(item.desc || "").slice(0, 1800),
        releaseDate: String(item.releaseDate || "").slice(0, 32),
        genreIds: (Array.isArray(item.genreIds) ? item.genreIds : []).map((value) => String(value || "")).filter(Boolean).slice(0, 32),
        originCountries: (Array.isArray(item.originCountries) ? item.originCountries : []).map((value) => String(value || "")).filter(Boolean).slice(0, 16),
        originalLanguage: String(item.originalLanguage || "").slice(0, 16),
        popularity: Number(item.popularity || 0),
        voteAverage: Number(item.voteAverage || 0),
        baseRank: Math.max(0, Number(item.baseRank || 0))
      };
    }

    function homeCategorySnapshotIsValid(snapshot, id, key, now) {
      if (!snapshot || typeof snapshot !== "object" || Number(snapshot.version) !== HOME_CATEGORY_CACHE_VERSION) return false;
      if (String(snapshot.categoryId || "") !== normalizeLegacyCategoryId(id) || String(snapshot.feedKey || "") !== String(key || "")) return false;
      const savedAt = Number(snapshot.savedAt || 0);
      const age = Number(now || Date.now()) - savedAt;
      return savedAt > 0 && age >= 0 && age <= HOME_CATEGORY_CACHE_TTL_MS && Array.isArray(snapshot.items) && snapshot.items.length > 0;
    }

    async function hydrateHomeCategoryCache(feed, id, key, requestSeq) {
      if (!feed || feed.cacheChecked) return false;
      feed.cacheChecked = true;
      const storageKey = homeCategoryCacheKey(id);
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(storageKey), null); } catch (e) { saved = null; }
      if (!homeCategoryFeedIsCurrent(feed, key, requestSeq) || feed.networkLoaded || feed.partial) return false;
      const home = state.homeV14;
      const items = homeCategorySnapshotIsValid(saved, id, key, Date.now())
        ? saved.items.map((item) => homeCategoryCacheItem(item, id)).filter(Boolean)
        : [];
      if (!items.length) {
        home.categoryCacheMissCount = Number(home.categoryCacheMissCount || 0) + 1;
        if (saved) {
          try { if (sdk().cache && typeof sdk().cache.del === "function") await sdk().cache.del(storageKey); } catch (e) {}
        }
        return false;
      }
      feed.items = items;
      feed.loaded = true;
      feed.loadedAt = Number(saved.savedAt || 0);
      feed.error = "";
      feed.cacheHydrated = true;
      feed.cacheSavedAt = Number(saved.savedAt || 0);
      feed.partial = false;
      feed.dataVersion = key;
      feed.signature = key;
      home.categoryCacheHitCount = Number(home.categoryCacheHitCount || 0) + 1;
      recordHomeCategoryReady(id);
      renderHomeCategoryRail(id);
      maybePrefetchHomeTail();
      recordHomeV14Diag();
      return true;
    }

    async function persistHomeCategoryCache(feed, id, key, requestSeq) {
      if (!feed || !homeCategoryFeedIsCurrent(feed, key, requestSeq) || !feed.items.length) return false;
      const items = feed.items.map((item) => homeCategoryCacheItem(item, id)).filter(Boolean).slice(0, homeCategoryFeedLimit(id));
      if (!items.length) return false;
      const snapshot = {
        version: HOME_CATEGORY_CACHE_VERSION,
        categoryId: normalizeLegacyCategoryId(id),
        feedKey: key,
        savedAt: Date.now(),
        items
      };
      try {
        await sdk().cache.set(homeCategoryCacheKey(id), JSON.stringify(snapshot));
        feed.cacheSavedAt = snapshot.savedAt;
        return true;
      } catch (e) {
        return false;
      }
    }

    function loadHomeCategoryFeed(id, options) {
      id = normalizeLegacyCategoryId(id);
      if (!isHomeCategoryId(id)) return Promise.resolve(null);
      const opts = options || {};
      const feed = homeCategoryFeed(id);
      const key = feed.key;
      if (feed.loading && feed.promise) return feed.promise;
      if (feed.loaded && !homeCategoryFeedNeedsRefresh(feed)) return Promise.resolve(feed);
      const requestSeq = Number(feed.requestSeq || 0) + 1;
      feed.requestSeq = requestSeq;
      feed.loading = true;
      feed.requestClass = opts.requestClass === "prefetch" ? "prefetch" : "foreground";
      feed.networkLoaded = false;
      feed.partial = false;
      feed.error = "";
      const requestKey = `home-category:${id}:${requestSeq}`;
      hydrateHomeCategoryCache(feed, id, key, requestSeq).catch(() => {});
      const task = Promise.resolve().then(async () => {
        const tmdbResult = await loadHomeCategoryTmdbPool(id, feed.requestClass, requestKey, (partialItems) => {
          if (!homeCategoryFeedIsCurrent(feed, key, requestSeq) || feed.cacheHydrated) return;
          const items = filterBlocked(uniqueMedia(partialItems));
          if (!items.length) return;
          feed.source = "tmdb";
          feed.items = items.slice();
          feed.loaded = true;
          feed.partial = true;
          feed.error = "";
          recordHomeCategoryReady(id);
          recordHomeCategoryFirstRender(id);
          renderHomeCategoryRail(id);
        });
        if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return feed;
        const items = filterBlocked(uniqueMedia(Array.isArray(tmdbResult.items) ? tmdbResult.items : []));
        if (!tmdbResult.goodCount) throw new Error(tmdbResult.error || "加载失败");
        if (feed.cacheHydrated && tmdbResult.goodCount < tmdbResult.totalSources) {
          feed.error = "";
          return feed;
        }
        feed.source = "tmdb";
        feed.items = items.slice();
        feed.loaded = true;
        feed.loadedAt = Date.now();
        feed.networkLoaded = true;
        feed.cacheHydrated = false;
        feed.cacheSavedAt = 0;
        feed.partial = false;
        feed.error = "";
        feed.dataVersion = key;
        feed.signature = key;
        recordHomeCategoryReady(id);
        recordHomeCategoryFinalReady(id);
        if (tmdbResult.goodCount === tmdbResult.totalSources) persistHomeCategoryCache(feed, id, key, requestSeq).catch(() => {});
        feed.loading = false;
        renderHomeCategoryRail(id);
        maybePrefetchHomeTail();
        return feed;
      }).catch((error) => {
        if (homeCategoryFeedIsCurrent(feed, key, requestSeq)) {
          feed.loaded = true;
          feed.error = feed.items.length ? "" : String(error && error.message || "加载失败");
          if (!feed.items.length) feed.loadedAt = Date.now();
          feed.partial = false;
          feed.loading = false;
          renderHomeCategoryRail(id);
          maybePrefetchHomeTail();
        }
        return feed;
      }).finally(() => {
        if (homeCategoryFeedIsCurrent(feed, key, requestSeq)) {
          feed.loading = false;
          feed.promise = null;
        }
      });
      feed.promise = task;
      return task;
    }

    function fillHomeRail(rail, items, options) {
      if (!rail) return;
      const opts = options || {};
      const variant = opts.variant === "landscape" ? "landscape" : "portrait";
      const source = Array.isArray(items) ? items : [];
      const uniqueSource = opts.recentWatching
        ? uniqueRecentWatchingMedia(source)
        : opts.allowNoPoster ? uniqueHistoryMedia(source) : uniqueMedia(source);
      const limit = Number(opts.limit || homeRailLimit(variant));
      const unique = uniqueSource;
      const limited = unique.slice(0, limit);
      const renderKeys = limited.map(mediaRenderKey).join("\n");
      rail.dataset.homeVariant = variant;
      rail.dataset.railKey = opts.railKey || rail.dataset.railKey || rail.id || "";
      if (!limited.length) {
        const empty = document.createElement("div");
        empty.className = "home-rail-empty";
        empty.textContent = "暂无内容";
        if (variant === "landscape") empty.classList.add("landscape");
        rail.dataset.homeRenderKeys = "";
        replaceHomeRailChildren(rail, [empty], captureHomeRailFocus(rail));
        return;
      }
      const expectedChildren = limited.length + (opts.homeMore ? 1 : 0);
      if (rail.dataset.homeRenderKeys === renderKeys && rail.children.length === expectedChildren) {
        observeHomeImages(rail);
        return;
      }
      rail.dataset.homeRenderKeys = renderKeys;
      fillRail(rail, limited, {
        home: true,
        landscape: variant === "landscape",
        allowNoPoster: !!opts.allowNoPoster,
        recentWatching: !!opts.recentWatching,
        weeklyHome: !!opts.weeklyHome,
        homeMore: !!opts.homeMore,
        homeMoreListId: rail.dataset.homeListId || "",
        homeLazy: true,
        homeEagerCount: Number(opts.homeEagerCount == null ? 4 : opts.homeEagerCount),
        railKey: rail.dataset.railKey
      });
      observeHomeImages(rail);
    }

    function createHomeDynamicSection(config) {
      const section = document.createElement("section");
      section.className = "home-section home-dynamic-section";
      section.dataset.homeListId = config.listId;
      section.id = homeSectionDomId(config.listId);
      const titleId = `homeSectionTitle-${String(config.listId).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      section.setAttribute("aria-labelledby", titleId);
      section.innerHTML = `
        <div class="home-section-head">
          <h2 class="home-section-title" id="${titleId}"></h2>
          <span class="home-section-line" aria-hidden="true"></span>
          <button class="home-section-more focusable" type="button" tabindex="0" data-home-more-id="${escapeAttr(config.listId)}">查看更多</button>
        </div>
        <div class="home-rail rail" data-home-list-id="${escapeAttr(config.listId)}"></div>
      `;
      const more = section.querySelector(".home-section-more");
      more.addEventListener("click", () => openSecondaryCatalog(config.listId, { originSection: config.listId, originTarget: more }));
      const rail = section.querySelector(".home-rail");
      rail.dataset.railKey = `home:${config.listId}`;
      rail.dataset.listId = config.listId;
      return section;
    }

    function homeColdStartElapsedMs() {
      const startedAt = Number(state.homeV14 && state.homeV14.coldStartAt || 0);
      return startedAt > 0 ? Math.max(0, Date.now() - startedAt) : null;
    }

    function recordHomeCategoryFirstRender(id) {
      const home = state.homeV14;
      const categoryId = normalizeLegacyCategoryId(id);
      const elapsed = homeColdStartElapsedMs();
      if (!home || elapsed == null) return null;
      home.categoryFirstRenderMs = home.categoryFirstRenderMs || {};
      if (home.categoryFirstRenderMs[categoryId] == null) home.categoryFirstRenderMs[categoryId] = elapsed;
      if (home.firstCategoryReadyMs == null) home.firstCategoryReadyMs = elapsed;
      return home.categoryFirstRenderMs[categoryId];
    }

    function recordHomeCategoryReady(id) {
      const home = state.homeV14;
      const categoryId = normalizeLegacyCategoryId(id);
      const elapsed = homeColdStartElapsedMs();
      if (!home || elapsed == null) return null;
      recordHomeCategoryFirstRender(categoryId);
      home.categoryReadyMs = home.categoryReadyMs || {};
      if (home.categoryReadyMs[categoryId] == null) home.categoryReadyMs[categoryId] = elapsed;
      maybePrefetchHomeTail();
      return home.categoryReadyMs[categoryId];
    }

    function recordHomeCategoryFinalReady(id) {
      const home = state.homeV14;
      const categoryId = normalizeLegacyCategoryId(id);
      const elapsed = homeColdStartElapsedMs();
      if (!home || elapsed == null) return null;
      home.categoryFinalReadyMs = home.categoryFinalReadyMs || {};
      if (home.categoryFinalReadyMs[categoryId] == null) home.categoryFinalReadyMs[categoryId] = elapsed;
      return home.categoryFinalReadyMs[categoryId];
    }

    function renderHomeCategoryRail(id) {
      if (!isHomeRouteActive()) return false;
      const categoryId = normalizeLegacyCategoryId(id);
      const section = document.getElementById(homeSectionDomId(categoryId));
      const config = homeSectionConfig().find((entry) => entry.listId === categoryId);
      if (!section || !config) return false;
      renderHomeDynamicSection(section, config);
      requestAnimationFrame(updateHomeRails);
      recordHomeV14Diag();
      return true;
    }

    function maybePrefetchHomeTail() {
      const home = state.homeV14;
      if (!home || home.tailPrefetchStarted || !isHomeRouteActive()) return false;
      const configs = homeSectionConfig().filter((entry) => isHomeCategoryId(entry.listId));
      if (configs.length <= 2) return false;
      const initial = configs.slice(0, 2);
      const ready = initial.every((config) => {
        const feed = home.categoryFeeds && home.categoryFeeds[config.listId];
        return !!(feed && feed.loaded);
      });
      if (!ready) return false;
      home.tailPrefetchStarted = true;
      configs.slice(2).forEach((config) => enqueueHomeListLoad(config.listId, "prefetch"));
      return true;
    }

    function homeBaseFeedsReady() {
      if (tvBrowseActive()) { const query = secondaryActiveQuery(tvBrowseState().column); return !!(query && query.items && query.items.length); }
      const configs = homeSectionConfig().filter((entry) => isHomeCategoryId(entry.listId));
      return configs.length > 0 && configs.every((config) => {
        const feed = state.homeV14.categoryFeeds && state.homeV14.categoryFeeds[config.listId];
        return !!(feed && feed.loaded);
      });
    }

    function recordHomeCardEnrichmentStart(kind) {
      if (kind === "tv" && homeUiRoute() === "home" && !homeBaseFeedsReady()) {
        if (!state.homeV14.tvCardEnrichmentStartedBeforeBaseFeedsReady) {
          state.homeV14.tvCardEnrichmentStartedBeforeBaseFeedsReady = true;
          recordHomeV14Diag();
        }
      }
    }

    function renderHomeDynamicSection(section, config) {
      if (!isHomeRouteActive()) {
        if (section) section.hidden = true;
        return;
      }
      state.homeV14.homeRailUpdateCount = Number(state.homeV14.homeRailUpdateCount || 0) + 1;
      const title = section.querySelector(".home-section-title");
      const rail = section.querySelector(".home-rail");
      if (title) title.textContent = config.title;
      if (!rail) return;
      rail.dataset.homeVariant = config.variant;
      const feed = homeCategoryFeed(config.listId);
      const hasPartialItems = !!(feed && feed.loaded && Array.isArray(feed.items) && feed.items.length);
      const items = feed && feed.loaded ? feed.items : [];
      rail.dataset.homeFeedSource = feed && feed.source || "";
      rail.dataset.homeFeedVersion = feed && feed.dataVersion || "";
      if (feed && feed.loading && !hasPartialItems) {
        showHomeRailStatus(rail, "加载中...", { variant: config.variant });
      } else if (feed && feed.error && !hasPartialItems) {
        showHomeRailStatus(rail, "加载失败", { variant: config.variant });
      } else if (!feed || (!feed.loaded && !hasPartialItems)) {
        const rect = section.getBoundingClientRect ? section.getBoundingClientRect() : null;
        const nearViewport = !rect || rect.top <= (window.innerHeight || document.documentElement.clientHeight || 0) + 760;
        if (!nearViewport) {
          showHomeRailStatus(rail, "待加载", { variant: config.variant });
        } else {
          const count = Math.min(config.initialLimit, homeRailColumnTarget(config.variant, rail.clientWidth));
          rail.dataset.homeRenderKeys = "";
          const skeletons = Array.from({ length: Math.max(2, count) }, () => {
            const skeleton = document.createElement("div");
            skeleton.className = "home-rail-skeleton" + (config.variant === "landscape" ? " landscape" : "");
            skeleton.setAttribute("aria-hidden", "true");
            return skeleton;
          });
          replaceHomeRailChildren(rail, skeletons, captureHomeRailFocus(rail));
        }
      } else {
        fillHomeRail(rail, items, {
          variant: config.variant,
          limit: config.initialLimit,
          homeMore: true,
          railKey: `home:${config.listId}`,
          homeEagerCount: 4
        });
      }
    }

    function renderHomeRecent() {
      const section = $("homeRecentSection");
      const rail = $("homeRecentRail");
      if (!section || !rail) return;
      if (!isHomeRouteActive()) {
        section.hidden = true;
        return;
      }
      const items = state.recent.loaded && Array.isArray(state.recent.items) ? state.recent.items : [];
      if (!items.length) {
        const railFocus = captureHomeRailFocus(rail);
        section.hidden = true;
        replaceHomeRailChildren(rail, [], railFocus);
        rail.dataset.homeRenderKeys = "";
        return;
      }
      section.hidden = false;
      fillHomeRail(rail, items, {
        variant: "landscape",
        limit: homeRailLimit("landscape"),
        allowNoPoster: true,
        recentWatching: true,
        homeMore: true,
        railKey: "home:recent",
        homeEagerCount: 4
      });
    }

    function renderHomeDynamicSections() {
      const container = $("listStack");
      if (!container) return;
      if (!isHomeRouteActive()) {
        Array.from(container.children || []).forEach((section) => {
          if (section.classList && section.classList.contains("home-dynamic-section")) section.hidden = true;
        });
        state.homeV14.renderedSectionCount = 0;
        return;
      }
      const configs = homeSectionConfig();
      const valid = new Set(configs.map((config) => config.listId));
      Array.from(container.children).forEach((section) => {
        if (section.classList && section.classList.contains("list-panel")) {
          section.hidden = true;
          return;
        }
        if (section.classList && section.classList.contains("home-dynamic-section") && !valid.has(section.dataset.homeListId)) section.remove();
        if (section.classList && section.classList.contains("empty")) section.remove();
      });
      configs.forEach((config) => {
        let section = Array.from(container.children).find((entry) => entry.dataset.homeListId === config.listId);
        if (!section) {
          section = createHomeDynamicSection(config);
          container.appendChild(section);
        }
        renderHomeDynamicSection(section, config);
      });
      state.homeV14.sections = configs.reduce((result, config) => {
        result[config.listId] = { variant: config.variant, initialLimit: config.initialLimit };
        return result;
      }, {});
      state.homeV14.renderedSectionCount = Array.from(container.children).filter((entry) => entry.classList && entry.classList.contains("home-dynamic-section")).length;
    }

    function ensureHomeImageObserver() {
      const home = state.homeV14;
      if (home.imageObserver || !("IntersectionObserver" in window)) return home.imageObserver;
      home.imageObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const image = entry.target;
          const source = image.getAttribute("data-src");
          if (!source) return;
          image.removeAttribute("data-src");
          image.removeAttribute("data-home-deferred");
          image.src = source;
          home.imageObserver.unobserve(image);
        });
        recordHomeV14Diag();
      }, { root: null, rootMargin: HOME_V14_IMAGE_ROOT_MARGIN, threshold: 0.01 });
      return home.imageObserver;
    }

    function observeHomeImages(root) {
      if (!root) return;
      const observer = ensureHomeImageObserver();
      const images = Array.from(root.querySelectorAll("img[data-src]"));
      if (observer) images.forEach((image) => observer.observe(image));
      else images.forEach((image) => {
        const source = image.getAttribute("data-src");
        if (!source) return;
        image.removeAttribute("data-src");
        image.removeAttribute("data-home-deferred");
        image.src = source;
      });
      observeTvCardEnrichment(root);
      recordHomeV14Diag();
    }

    function isTvEpisodeStatusCard(card) {
      const item = card && card.__mediaItem;
      return !!(card && item
        && String(item.mediaType || "").toLowerCase() === "tv"
        && tvDetailCacheId(item)
        && card.querySelector
        && card.querySelector(".card-air-status"));
    }

    function syncCardAirStatusLayout(card, label) {
      if (!card) return;
      const text = String(label || "").trim();
      const visible = !!text;
      const status = card.querySelector && card.querySelector(".card-air-status");
      if (status) {
        status.textContent = text;
        status.hidden = !visible;
      }
      card.classList.toggle("has-air-status", visible);
      card.querySelectorAll(".poster-wrap").forEach((wrap) => wrap.classList.toggle("has-air-status", visible));
    }

    function updateTvEpisodeStatusCards(itemOrId, detail) {
      const id = tvDetailCacheId(itemOrId);
      if (!id || !detail) return;
      let updatedHomeCard = false;
      const readyAt = Date.now();
      document.querySelectorAll(".card").forEach((card) => {
        if (!isTvEpisodeStatusCard(card)) return;
        const cardItem = card.__mediaItem;
        if (tvDetailCacheId(cardItem) !== id) return;
        const status = card.querySelector(".card-air-status");
        if (!status) return;
        const weeklyText = String(cardItem.weeklyUpdateText || "").trim();
        const isVariety = normalizeLegacyCategoryId(cardItem.listId || cardItem.categoryId || cardItem.category) === "variety";
        const label = weeklyText || (isVariety ? varietyEpisodeStatusLabel(detail) : tvEpisodeStatusLabel(detail));
        syncCardAirStatusLayout(card, label);
        if (card.closest && card.closest("#home")) {
          updatedHomeCard = true;
          if (!Number(card.dataset.tvStatusReadyAt || 0)) {
            const baseCardRenderAt = Number(card.dataset.tvStatusBaseCardRenderAt || 0);
            card.dataset.tvStatusReadyAt = String(readyAt);
            if (baseCardRenderAt) card.dataset.tvStatusDelayMs = String(Math.max(0, readyAt - baseCardRenderAt));
          }
        }
      });
      if (updatedHomeCard) {
        if (tvBrowseActive()) {
          const target = tvBrowsePosterTarget();
          if (target && target.__mediaItem && tvDetailCacheId(target.__mediaItem) === id) tvBrowsePreview(target.__mediaItem);
        }
        recordHomeV14Diag();
      }
    }

    function tvCardNearViewport(card) {
      if (!card || !card.getBoundingClientRect) return false;
      const rect = card.getBoundingClientRect();
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const margin = Math.max(420, height * .75);
      return rect.bottom >= -margin && rect.top <= height + margin;
    }

    function flushTvCardDetailQueue() {
      const runtime = state.tvDetail;
      if (!runtime) return;
      while (runtime.cardActive < TV_CARD_DETAIL_CONCURRENCY && runtime.cardQueue.length) {
        const job = runtime.cardQueue.shift();
        if (!job || runtime.cardTasks[job.key] !== job) continue;
        runtime.cardActive += 1;
        if (job.home) {
          recordHomeCardEnrichmentStart("tv");
        }
        const request = job.home
          ? (url, timeout) => homeTvStatusRequest(url, timeout, job.key)
          : requestJson;
        requestTvDetailShared(job.item, request).then((detail) => {
          if (job.generation === runtime.generation && detail) updateTvEpisodeStatusCards(job.item, detail);
        }).catch(() => {}).finally(() => {
          runtime.cardActive = Math.max(0, runtime.cardActive - 1);
          if (runtime.cardTasks[job.key] === job) delete runtime.cardTasks[job.key];
          flushTvCardDetailQueue();
        });
      }
    }

    function queueTvCardEpisodeEnrichment(card) {
      if (!isTvEpisodeStatusCard(card)) return;
      const item = card.__mediaItem;
      const cached = tvDetailCacheValue(item);
      if (cached) {
        updateTvEpisodeStatusCards(item, cached);
        return;
      }
      const runtime = state.tvDetail;
      const key = tvDetailCacheKey(item);
      if (!runtime || !key || runtime.cardTasks[key]) return;
      const job = { key, item, generation: runtime.generation, home: !!(card.closest && card.closest("#home")) };
      runtime.cardTasks[key] = job;
      runtime.cardQueue.push(job);
      flushTvCardDetailQueue();
    }

    function promoteHomeTvCardStatusOnFocus(card) {
      if (!card || !card.closest || !card.closest("#home") || !isTvEpisodeStatusCard(card)) return false;
      const status = card.querySelector(".card-air-status");
      if (status && String(status.textContent || "").trim()) return false;
      const key = tvDetailCacheKey(card.__mediaItem);
      const promoted = promoteHomeBudgetRequests(key, "visible-status", "focus");
      queueTvCardEpisodeEnrichment(card);
      return promoted;
    }

    function ensureTvCardDetailObserver() {
      const runtime = state.tvDetail;
      if (!runtime) return null;
      if (!("IntersectionObserver" in window)) {
        if (!runtime.scrollBound) {
          runtime.scrollBound = true;
          window.addEventListener("scroll", () => {
            if (runtime.scanTimer) return;
            runtime.scanTimer = setTimeout(() => {
              runtime.scanTimer = 0;
              observeTvCardEnrichment(document);
            }, 100);
          }, { passive: true });
        }
        return null;
      }
      if (runtime.observer) return runtime.observer;
      runtime.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          runtime.observer.unobserve(entry.target);
          queueTvCardEpisodeEnrichment(entry.target);
        });
      }, { root: null, rootMargin: TV_CARD_DETAIL_ROOT_MARGIN, threshold: 0.01 });
      return runtime.observer;
    }

    function observeTvCardEnrichment(root) {
      if (!root || !root.querySelectorAll) return;
      const cards = Array.from(root.querySelectorAll(".card")).filter(isTvEpisodeStatusCard);
      const observer = ensureTvCardDetailObserver();
      if (observer) cards.forEach((card) => observer.observe(card));
      else cards.filter(tvCardNearViewport).forEach(queueTvCardEpisodeEnrichment);
    }

    function isNostrMovieReleaseStatusCard(card) {
      const item = card && card.__mediaItem;
      if (!card || !item || item.source !== "nostr-hot") return false;
      if (String(item.mediaType || item.media_type || "").toLowerCase() !== "movie") return false;
      if (!movieDetailCacheId(item)) return false;
      if (latestDateOnly(item.releaseDate || item.release_date || "")) return false;
      const cached = movieDetailCacheValue(item);
      if (cached && latestDateOnly(cached.release_date || cached.releaseDate || "")) return false;
      return !!(card.querySelector && card.querySelector(".card-air-status"));
    }

    function updateMovieReleaseStatusCards(itemOrId, detail) {
      const id = movieDetailCacheId(itemOrId);
      if (!id || !detail) return;
      if (tvBrowseActive()) {
        const target = tvBrowsePosterTarget();
        if (target && target.__mediaItem && String(target.__mediaItem.mediaType || "").toLowerCase() === "movie" && movieDetailCacheId(target.__mediaItem) === id) tvBrowsePreview(target.__mediaItem);
      }
      document.querySelectorAll(".card").forEach((card) => {
        const cardItem = card.__mediaItem;
        if (!cardItem || cardItem.source !== "nostr-hot") return;
        if (String(cardItem.mediaType || cardItem.media_type || "").toLowerCase() !== "movie") return;
        if (movieDetailCacheId(cardItem) !== id) return;
        const status = card.querySelector && card.querySelector(".card-air-status");
        if (!status) return;
        const releaseDate = latestDateOnly(detail.release_date || detail.releaseDate || "");
        const presentationItem = releaseDate ? Object.assign({}, cardItem, { releaseDate }) : cardItem;
        syncCardAirStatusLayout(card, movieReleaseStatusText(presentationItem));
      });
    }

    function movieCardNearViewport(card) {
      return tvCardNearViewport(card);
    }

    function flushMovieCardDetailQueue() {
      const runtime = state.movieDetail;
      if (!runtime) return;
      if (!runtime.cardTasks) runtime.cardTasks = {};
      if (!Array.isArray(runtime.cardQueue)) runtime.cardQueue = [];
      runtime.cardActive = Number(runtime.cardActive || 0);
      while (runtime.cardActive < MOVIE_CARD_DETAIL_CONCURRENCY && runtime.cardQueue.length) {
        const job = runtime.cardQueue.shift();
        if (!job || runtime.cardTasks[job.key] !== job) continue;
        runtime.cardActive += 1;
        const request = job.home ? homeEnrichmentRequest : requestJson;
        requestMovieDetailShared(job.item, request).then((detail) => {
          if (detail) updateMovieReleaseStatusCards(job.item, detail);
        }).catch(() => {}).finally(() => {
          runtime.cardActive = Math.max(0, runtime.cardActive - 1);
          if (runtime.cardTasks[job.key] === job) delete runtime.cardTasks[job.key];
          flushMovieCardDetailQueue();
        });
      }
    }

    function queueMovieCardReleaseEnrichment(card) {
      if (!isNostrMovieReleaseStatusCard(card)) return;
      const item = card.__mediaItem;
      const cached = movieDetailCacheValue(item);
      if (cached) {
        updateMovieReleaseStatusCards(item, cached);
        return;
      }
      const runtime = state.movieDetail;
      const key = movieDetailCacheKey(item);
      if (!runtime || !key) return;
      if (!runtime.cardTasks) runtime.cardTasks = {};
      if (!Array.isArray(runtime.cardQueue)) runtime.cardQueue = [];
      if (runtime.cardTasks[key]) return;
      const job = { key, item, home: !!(card.closest && card.closest("#home")) };
      runtime.cardTasks[key] = job;
      runtime.cardQueue.push(job);
      flushMovieCardDetailQueue();
    }

    function ensureMovieCardDetailObserver() {
      const runtime = state.movieDetail;
      if (!runtime) return null;
      if (!Array.isArray(runtime.cardQueue)) runtime.cardQueue = [];
      if (!runtime.cardTasks) runtime.cardTasks = {};
      if (!("IntersectionObserver" in window)) {
        if (!runtime.scrollBound) {
          runtime.scrollBound = true;
          window.addEventListener("scroll", () => {
            if (runtime.scanTimer) return;
            runtime.scanTimer = setTimeout(() => {
              runtime.scanTimer = 0;
              observeMovieCardEnrichment(document);
            }, 100);
          }, { passive: true });
        }
        return null;
      }
      if (runtime.observer) return runtime.observer;
      runtime.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          runtime.observer.unobserve(entry.target);
          queueMovieCardReleaseEnrichment(entry.target);
        });
      }, { root: null, rootMargin: MOVIE_CARD_DETAIL_ROOT_MARGIN, threshold: 0.01 });
      return runtime.observer;
    }

    function observeMovieCardEnrichment(root) {
      if (!root || !root.querySelectorAll) return;
      const cards = Array.from(root.querySelectorAll(".card")).filter(isNostrMovieReleaseStatusCard);
      const observer = ensureMovieCardDetailObserver();
      if (observer) cards.forEach((card) => observer.observe(card));
      else cards.filter(movieCardNearViewport).forEach(queueMovieCardReleaseEnrichment);
    }

    function updateHomeRails() {
      const home = $("home");
      if (!home || !isHomeRouteActive()) return;
      home.querySelectorAll(".home-rail").forEach((rail) => {
        const variant = rail.dataset.homeVariant === "landscape" ? "landscape" : "portrait";
        const rect = rail.getBoundingClientRect ? rail.getBoundingClientRect() : null;
        const width = rail.clientWidth || rect && rect.width || window.innerWidth || 0;
        const styles = getComputedStyle(rail);
        const gap = parseFloat(styles.columnGap || styles.gap || "12") || 12;
        const left = parseFloat(styles.paddingLeft || "0") || 0;
        const right = parseFloat(styles.paddingRight || "0") || 0;
        const available = Math.max(0, width - left - right);
        const columns = homeRailColumnTarget(variant, width);
        const baseCardWidth = Math.floor((available - gap * Math.max(0, columns - 1)) / columns);
        const cardWidth = Math.max(80, Math.floor(baseCardWidth * (isTvLikeDevice() ? 1.14 : 1)));
        rail.style.setProperty("--home-card-width", `${cardWidth}px`);
      });
      recordHomeV14Diag();
    }

    function scheduleHomeRailResize() {
      const home = state.homeV14;
      if (home.resizeFrame) return;
      home.resizeFrame = requestAnimationFrame(() => {
        home.resizeFrame = 0;
        updateHomeRails();
      });
    }

    function ensureHomeResizeBinding() {
      const home = state.homeV14;
      if (home.resizeBound) return;
      home.resizeBound = true;
      window.addEventListener("resize", scheduleHomeRailResize, { passive: true });
    }

    function enqueueHomeListLoad(id, requestClass) {
      if (!isHomeRouteActive() || !id || id === "all" || id === "recent" || id === "live") return;
      id = normalizeLegacyCategoryId(id);
      if (!isHomeCategoryId(id)) return;
      const desiredClass = requestClass === "prefetch" ? "prefetch" : "foreground";
      const feed = homeCategoryFeed(id);
      const home = state.homeV14;
      if (feed && feed.loading) {
        if (desiredClass === "foreground" && feed.requestClass === "prefetch") {
          feed.requestClass = "foreground";
          promoteHomeBudgetRequests(`home-category:${id}:${Number(feed.requestSeq || 0)}`, "foreground");
        }
        return;
      }
      if (feed && feed.loaded && !homeCategoryFeedNeedsRefresh(feed)) return;
      const queued = home.loadQueue.find((entry) => entry.id === id);
      if (queued) {
        if (desiredClass === "foreground" && queued.requestClass === "prefetch") {
          queued.requestClass = "foreground";
          home.loadQueue.splice(home.loadQueue.indexOf(queued), 1);
          home.loadQueue.unshift(queued);
        }
        pumpHomeListLoads();
        return;
      }
      const entry = { id, requestClass: desiredClass };
      const priority = Number(HOME_REQUEST_PRIORITY[desiredClass] || 0);
      const insertAt = home.loadQueue.findIndex((queuedEntry) => Number(HOME_REQUEST_PRIORITY[queuedEntry.requestClass] || 0) > priority);
      if (insertAt < 0) home.loadQueue.push(entry);
      else home.loadQueue.splice(insertAt, 0, entry);
      pumpHomeListLoads();
    }

    function pumpHomeListLoads() {
      const home = state.homeV14;
      while (isHomeRouteActive() && home.activeLoads < HOME_V14_MAX_CONCURRENT && home.loadQueue.length) {
        const request = home.loadQueue.shift();
        const id = request.id;
        const feed = homeCategoryFeed(id);
        if (feed && (feed.loading || (feed.loaded && !homeCategoryFeedNeedsRefresh(feed)))) continue;
        home.activeLoads += 1;
        home.requestCount += 1;
        home.maxConcurrent = Math.max(home.maxConcurrent, home.activeLoads);
        Promise.resolve(loadHomeCategoryFeed(id, { requestClass: request.requestClass })).catch(() => {}).finally(() => {
          home.activeLoads = Math.max(0, home.activeLoads - 1);
          if (isHomeRouteActive()) recordHomeV14Diag();
          pumpHomeListLoads();
        });
      }
      recordHomeV14Diag();
    }

    function ensureHomeListLoadsNearViewport() {
      if (!isHomeRouteActive()) return;
      const bottom = (window.innerHeight || document.documentElement.clientHeight || 0) + 760;
      const sections = Array.from(document.querySelectorAll("#listStack > .home-dynamic-section"));
      sections
        .filter((section) => {
          const rect = section.getBoundingClientRect ? section.getBoundingClientRect() : null;
          return !rect || rect.top <= bottom;
        })
        .sort((a, b) => {
          const ar = a.getBoundingClientRect ? a.getBoundingClientRect().top : 0;
          const br = b.getBoundingClientRect ? b.getBoundingClientRect().top : 0;
          return ar - br;
        })
        .forEach((section) => enqueueHomeListLoad(section.dataset.homeListId, "foreground"));
    }

    function ensureHomeSectionObserver() {
      const home = state.homeV14;
      if ("IntersectionObserver" in window) {
        if (!home.sectionObserver) {
          home.sectionObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) enqueueHomeListLoad(entry.target.dataset.homeListId, "foreground");
            });
            recordHomeV14Diag();
          }, { root: null, rootMargin: HOME_V14_SECTION_ROOT_MARGIN, threshold: 0.01 });
        }
        document.querySelectorAll("#listStack > .home-dynamic-section").forEach((section) => {
          home.sectionObserver.observe(section);
        });
      }
      ensureHomeListLoadsNearViewport();
    }

    function recordHomeV14Diag() {
      const homeRoot = $("home");
      const home = state.homeV14;
      if (!homeRoot) return null;
      const budget = homeRequestBudgetState();
      const latest = state.homeLatest || {};
      const elapsed = homeColdStartElapsedMs();
      const root = document.documentElement;
      const viewportHeight = Number(window.visualViewport && window.visualViewport.height)
        || Number(root.clientHeight)
        || Number(window.innerHeight)
        || 0;
      const hostHeight = parseFloat(getComputedStyle(root).getPropertyValue("--fm-web-height")) || 0;
      const detailSheet = $("detailSheet");
      const detailActive = !!(detailSheet && detailSheet.classList.contains("active"));
      const detailRect = detailActive && detailSheet.getBoundingClientRect ? detailSheet.getBoundingClientRect() : null;
      const configs = homeSectionConfig();
      const cards = Array.from(homeRoot.querySelectorAll(".home-rail > .card"));
      const tvStatusCards = cards.filter((card) => Number(card.dataset.tvStatusBaseCardRenderAt || 0) > 0);
      const latestTvStatusCard = tvStatusCards.reduce((latest, card) => {
        if (!latest) return card;
        return Number(card.dataset.tvStatusReadyAt || 0) > Number(latest.dataset.tvStatusReadyAt || 0) ? card : latest;
      }, null);
      const images = Array.from(homeRoot.querySelectorAll("img"));
      const pageLoaded = configs.filter((config) => {
        const feed = home.categoryFeeds && home.categoryFeeds[config.listId];
        return !!(feed && feed.loaded && feed.key === homeCategoryFeedKey(config.listId));
      }).length;
      const isRealSrc = (image) => {
        const src = image.getAttribute("src") || "";
        return !!src && !/^data:image\//i.test(src);
      };
      const diag = {
        sectionCount: configs.length,
        renderedSectionCount: homeRoot.querySelectorAll("#listStack > .home-dynamic-section").length,
        loadedSectionCount: pageLoaded,
        portraitCardCount: cards.filter((card) => !card.classList.contains("landscape-card") && !card.classList.contains("recent-card")).length,
        landscapeCardCount: cards.filter((card) => card.classList.contains("landscape-card")).length,
        recentCardCount: cards.filter((card) => card.classList.contains("recent-card") || card.classList.contains("recent-watching-card")).length,
        imageSrcCount: images.filter(isRealSrc).length,
        imageDeferredCount: images.filter((image) => !!image.getAttribute("data-src")).length,
        activeListRequestCount: home.requestCount,
        homeListConcurrentRequests: home.activeLoads,
        homeListMaxConcurrentRequests: home.maxConcurrent,
        homeCategoryFeedSources: configs.reduce((result, config) => {
          const feed = home.categoryFeeds && home.categoryFeeds[config.listId];
          result[config.listId] = feed && feed.source || "";
          return result;
        }, {}),
        heroCandidateCount: Number(home.heroCandidateCount || 0),
        heroPoolCandidateCount: Number(home.heroFeed && home.heroFeed.poolCount || 0),
        heroExtraTmdbRequestCount: Number(home.heroExtraTmdbRequestCount || 0),
        heroCacheTtlMs: HOME_HERO_CACHE_TTL_MS,
        heroCacheAgeMs: home.heroFeed && home.heroFeed.loadedAt ? Math.max(0, Date.now() - Number(home.heroFeed.loadedAt)) : 0,
        heroSourceStats: home.heroFeed && home.heroFeed.sourceStats || null,
        recommendationCardCount: homeRoot.querySelectorAll("#homeRecommendationRail > .card").length,
        weeklyCardCount: homeRoot.querySelectorAll("#homeWeeklyRail > .card").length,
        homeRoute: homeUiRoute(),
        fixedViewportAuthority: "100vh",
        cssViewportHeightPx: Number(window.innerHeight || root.clientHeight || 0),
        visibleViewportHeightPx: viewportHeight,
        fmWebHeightPx: hostHeight,
        fmWebHeightDeltaFromViewportPx: hostHeight - viewportHeight,
        detailSheetActive: detailActive,
        detailSheetRectHeightPx: detailRect ? Number(detailRect.height || 0) : 0,
        detailSheetBottomOverrunPx: detailRect ? Math.max(0, Number(detailRect.bottom || 0) - viewportHeight) : 0,
        detailSheetClientHeightPx: detailActive ? Number(detailSheet.clientHeight || 0) : 0,
        detailSheetScrollHeightPx: detailActive ? Number(detailSheet.scrollHeight || 0) : 0,
        detailSheetScrollRangePx: detailActive ? Math.max(0, Number(detailSheet.scrollHeight || 0) - Number(detailSheet.clientHeight || 0)) : 0,
        HOME_COLD_START_AT: Number(home.coldStartAt || 0),
        FIRST_HOME_RENDER_MS: home.firstHomeRenderMs,
        FIRST_HERO_READY_MS: home.firstHeroReadyMs,
        FIRST_CATEGORY_READY_MS: home.firstCategoryReadyMs,
        MOVIE_READY_MS: home.categoryReadyMs && home.categoryReadyMs.movie != null ? home.categoryReadyMs.movie : null,
        TV_READY_MS: home.categoryReadyMs && home.categoryReadyMs.tv != null ? home.categoryReadyMs.tv : null,
        ANIME_FIRST_RENDER_MS: home.categoryFirstRenderMs && home.categoryFirstRenderMs.anime != null ? home.categoryFirstRenderMs.anime : null,
        ANIME_FINAL_READY_MS: home.categoryFinalReadyMs && home.categoryFinalReadyMs.anime != null ? home.categoryFinalReadyMs.anime : null,
        DOCUMENTARY_FIRST_RENDER_MS: home.categoryFirstRenderMs && home.categoryFirstRenderMs.documentary != null ? home.categoryFirstRenderMs.documentary : null,
        DOCUMENTARY_FINAL_READY_MS: home.categoryFinalReadyMs && home.categoryFinalReadyMs.documentary != null ? home.categoryFinalReadyMs.documentary : null,
        VARIETY_READY_MS: home.categoryReadyMs && home.categoryReadyMs.variety != null ? home.categoryReadyMs.variety : null,
        CATEGORY_CACHE_HIT_COUNT: Number(home.categoryCacheHitCount || 0),
        CATEGORY_CACHE_MISS_COUNT: Number(home.categoryCacheMissCount || 0),
        FOREGROUND_REQUEST_MAX: Number(budget.maxByClass && budget.maxByClass.foreground || 0),
        BACKGROUND_REQUEST_MAX: Number(budget.maxBackground || 0),
        ENRICHMENT_REQUEST_MAX: Number(budget.maxByClass && budget.maxByClass.enrichment || 0),
        HOME_TV_STATUS_REQUEST_QUEUED: Number(budget.tvStatusRequestQueued || 0),
        HOME_TV_STATUS_REQUEST_STARTED: Number(budget.tvStatusRequestStarted || 0),
        HOME_TV_STATUS_REQUEST_DONE: Number(budget.tvStatusRequestDone || 0),
        HOME_TV_STATUS_MAX_ACTIVE: Number(budget.maxByClass && budget.maxByClass["visible-status"] || 0),
        HOME_TV_STATUS_PROMOTED_ON_FOCUS: Number(budget.tvStatusPromotedOnFocus || 0),
        TV_CARD_STATUS_WAIT_MS: budget.lastTvCardStatusWaitMs == null ? null : Number(budget.lastTvCardStatusWaitMs),
        BASE_CARD_RENDER_AT: latestTvStatusCard ? Number(latestTvStatusCard.dataset.tvStatusBaseCardRenderAt || 0) : null,
        TV_STATUS_READY_AT: latestTvStatusCard && Number(latestTvStatusCard.dataset.tvStatusReadyAt || 0) ? Number(latestTvStatusCard.dataset.tvStatusReadyAt) : null,
        TV_STATUS_DELAY_MS: latestTvStatusCard && latestTvStatusCard.dataset.tvStatusDelayMs != null ? Number(latestTvStatusCard.dataset.tvStatusDelayMs) : null,
        HOME_REQUEST_ACTIVE: Number(budget.active || 0),
        HOME_REQUEST_QUEUED: Array.isArray(budget.queue) ? budget.queue.length : 0,
        HOME_WHOLE_RENDER_COUNT: Number(home.wholeHomeRenderCount || 0),
        HOME_RAIL_UPDATE_COUNT: Number(home.homeRailUpdateCount || 0),
        WEEKLY_CACHE_HIT: latest.cacheChecked ? !!latest.cacheHydrated : null,
        WEEKLY_NETWORK_REFRESH_START_MS: Number(latest.networkRefreshStartedAt || 0) > 0 && elapsed != null ? Math.max(0, Number(latest.networkRefreshStartedAt) - Number(home.coldStartAt)) : null,
        WEEKLY_NETWORK_REFRESH_END_MS: Number(latest.networkRefreshEndedAt || 0) > 0 && elapsed != null ? Math.max(0, Number(latest.networkRefreshEndedAt) - Number(home.coldStartAt)) : null,
        TV_CARD_ENRICHMENT_STARTED_BEFORE_BASE_FEEDS_READY: home.tvCardEnrichmentStartedBeforeBaseFeedsReady == null ? false : !!home.tvCardEnrichmentStartedBeforeBaseFeedsReady
      };
      home.imageSrcCount = diag.imageSrcCount;
      home.imageDeferredCount = diag.imageDeferredCount;
      home.loadedSectionCount = diag.loadedSectionCount;
      state.tvDiag.homeV14 = diag;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV][HOME_V14_DIAG]", diag); } catch (e) {}
      }
      return diag;
    }

    function renderHome() {
      if (isTvLikeDevice()) { renderTvBrowse(); return; }
      const homeRoot = $("home");
      if (!homeRoot || !isHomeRouteActive()) return;
      const home = state.homeV14;
      if (!home.coldStartAt) home.coldStartAt = Date.now();
      if (home.firstHomeRenderMs == null) home.firstHomeRenderMs = 0;
      home.wholeHomeRenderCount = Number(home.wholeHomeRenderCount || 0) + 1;
      setHomeOnlyPresentationVisible(true);
      renderSidebar();
      renderHomeHero();
      renderHomeRecent();
      renderHomeRecommendation();
      renderHomeWeekly();
      renderHomeDynamicSections();
      ensureHomeResizeBinding();
      ensureHomeSectionObserver();
      observeHomeImages(homeRoot);
      requestAnimationFrame(updateHomeRails);
      recordHomeV14Diag();
    }
