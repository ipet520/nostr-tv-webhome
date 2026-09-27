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

    function isHomeCategoryId(id) {
      return HOME_CATEGORY_IDS.has(normalizeLegacyCategoryId(id));
    }

    function homeCategoryFeedKey(id) {
      id = normalizeLegacyCategoryId(id);
      return JSON.stringify([id, "tmdb"]);
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
          error: "",
          promise: null,
          requestSeq: 0,
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
        feed.error = "";
        feed.promise = null;
        feed.requestSeq = Number(feed.requestSeq || 0) + 1;
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
        feed.error = "";
        feed.promise = null;
        feed.requestSeq = Number(feed.requestSeq || 0) + 1;
      });
    }

    function homeCategoryFeedIsCurrent(feed, key, requestSeq) {
      return !!(feed && feed.key === key && Number(feed.requestSeq || 0) === Number(requestSeq || 0));
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

    async function loadHomeCategoryTmdbPool(id) {
      const sources = homeCategoryTmdbSources(id);
      if (!sources.length) return { items: [], error: "暂无可用来源" };
      const results = await Promise.all(sources.map((source) => Promise.resolve()
        .then(() => requestJson(tmdbUrl(source, 1), 18))
        .then((body) => ({ source, body: body || {}, error: null }))
        .catch((error) => ({ source, body: null, error }))));
      const incoming = [];
      let goodCount = 0;
      results.forEach((result) => {
        if (result.error || !result.body) return;
        goodCount += 1;
        (Array.isArray(result.body.results) ? result.body.results : []).forEach((item, index) => {
          const normalized = normalizeTmdb(item, result.source, index);
          if (hasPoster(normalized) && (!isReleaseFilteredCatalogId(id) || isReleasedAsOfToday(normalized))) incoming.push(normalized);
        });
      });
      return {
        items: uniqueMedia(filterReleasedCatalogItems(id, incoming)),
        error: goodCount ? "" : "加载失败"
      };
    }


    function commitHomeCategoryTmdbItems(id, feed, key, requestSeq, items) {
      if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return false;
      const tmdbItems = uniqueMedia(Array.isArray(items) ? items : []);
      feed.source = "tmdb";
      feed.items = filterBlocked(tmdbItems);
      feed.dataVersion = key;
      feed.signature = key;
      const section = Array.from(document.querySelectorAll("#listStack > .home-dynamic-section")).find((entry) => entry.dataset.homeListId === normalizeLegacyCategoryId(id));
      const config = homeSectionConfig().find((entry) => entry.listId === normalizeLegacyCategoryId(id));
      if (section && config && tmdbItems.length) renderHomeDynamicSection(section, config);
      recordHomeV14Diag();
      return true;
    }

    function homeCategoryFeedLimit(id) {
      const config = homeSectionConfig().find((entry) => entry.listId === normalizeLegacyCategoryId(id));
      return Number(config && config.initialLimit || homeRailLimit("portrait"));
    }

    function loadHomeCategoryFeed(id) {
      id = normalizeLegacyCategoryId(id);
      if (!isHomeCategoryId(id)) return Promise.resolve(null);
      const feed = homeCategoryFeed(id);
      const key = feed.key;
      if (feed.loading && feed.promise) return feed.promise;
      if (feed.loaded) return Promise.resolve(feed);
      const requestSeq = Number(feed.requestSeq || 0) + 1;
      feed.requestSeq = requestSeq;
      feed.loading = true;
      feed.loaded = false;
      feed.error = "";
      const target = homeCategoryFeedLimit(id);
      const task = Promise.resolve().then(async () => {
        const tmdbResult = await loadHomeCategoryTmdbPool(id);
        if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return feed;
        const items = filterBlocked(uniqueMedia(Array.isArray(tmdbResult.items) ? tmdbResult.items : []));
        if (!items.length && tmdbResult.error) throw new Error(tmdbResult.error);
        feed.source = "tmdb";
        feed.items = items.slice();
        feed.loaded = true;
        feed.error = "";
        feed.dataVersion = key;
        feed.signature = key;
        return feed;
      }).catch((error) => {
        if (homeCategoryFeedIsCurrent(feed, key, requestSeq)) {
          feed.loaded = true;
          feed.error = String(error && error.message || "加载失败");
          feed.items = [];
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

    function renderHomeDynamicSection(section, config) {
      if (!isHomeRouteActive()) {
        if (section) section.hidden = true;
        return;
      }
      const title = section.querySelector(".home-section-title");
      const rail = section.querySelector(".home-rail");
      if (title) title.textContent = config.title;
      if (!rail) return;
      rail.dataset.homeVariant = config.variant;
      const feed = homeCategoryFeed(config.listId);
      const hasPartialItems = false;
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
      });
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
        requestTvDetailShared(job.item).then((detail) => {
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
      const job = { key, item, generation: runtime.generation };
      runtime.cardTasks[key] = job;
      runtime.cardQueue.push(job);
      flushTvCardDetailQueue();
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

    function enqueueHomeListLoad(id) {
      if (!isHomeRouteActive() || !id || id === "all" || id === "recent" || id === "live") return;
      const feed = homeCategoryFeed(id);
      const home = state.homeV14;
      if (feed && (feed.loading || feed.loaded) || home.loadQueue.includes(id)) return;
      home.loadQueue.push(id);
      pumpHomeListLoads();
    }

    function pumpHomeListLoads() {
      const home = state.homeV14;
      while (isHomeRouteActive() && home.activeLoads < HOME_V14_MAX_CONCURRENT && home.loadQueue.length) {
        const id = home.loadQueue.shift();
        const feed = homeCategoryFeed(id);
        if (feed && (feed.loading || feed.loaded)) continue;
        home.activeLoads += 1;
        home.requestCount += 1;
        home.maxConcurrent = Math.max(home.maxConcurrent, home.activeLoads);
        Promise.resolve(loadHomeCategoryFeed(id)).catch(() => {}).finally(() => {
          home.activeLoads = Math.max(0, home.activeLoads - 1);
          if (isHomeRouteActive()) renderHome();
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
        .forEach((section) => enqueueHomeListLoad(section.dataset.homeListId));
    }

    function ensureHomeSectionObserver() {
      const home = state.homeV14;
      if ("IntersectionObserver" in window) {
        if (!home.sectionObserver) {
          home.sectionObserver = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) enqueueHomeListLoad(entry.target.dataset.homeListId);
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
      const configs = homeSectionConfig();
      const cards = Array.from(homeRoot.querySelectorAll(".home-rail > .card"));
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
        homeRoute: homeUiRoute()
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
      const homeRoot = $("home");
      if (!homeRoot || !isHomeRouteActive()) return;
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
