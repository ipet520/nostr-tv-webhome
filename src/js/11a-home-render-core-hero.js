    function renderAll(options) {
      const opts = options || {};
      clearTimeout(state.renderTimer);
      state.renderTimer = 0;
      normalizeActiveListForViewport();
      syncHomeRoutePresentation();
      if (opts.deferContent) scheduleHomeContentRender({ afterPaint: true });
      else renderHomeContent();
      renderMetrics();
      normalizeRails();
    }

    function renderHomeContent() {
      const isHome = isHomeRouteActive();
      const route = homeUiRoute();
      document.documentElement.classList.toggle("home-active", isHome);
      setHomeOnlyPresentationVisible(isHome);
      const list = $("listSection");
      // Home dynamic rails live in the existing #listSection/#listStack.
      // Keep that single presentation container visible on Home; the Home
      // renderer hides only the inactive catalog panels inside it.  Secondary
      // and Search remain separate routes with the Home list hidden.
      if (list) list.hidden = route === "secondary" || route === "search";
      syncHomeRoutePresentation();
      if (route === "secondary") {
        renderSecondaryCatalog();
      } else if (route === "search") {
        renderSearch();
      } else if (isHome) renderHome();
      else renderLists();
      observeInfiniteScroll();
      requestAnimationFrame(ensureScrollablePage);
    }

    function homeSectionVariant(list, index) {
      return Number(index || 0) % 2 === 0 ? "landscape" : "portrait";
    }

    function homeSectionPriority(list, index) {
      const id = String(list && list.id || "");
      const priority = {
        "now-playing": 10,
        movie: 20,
        tv: 30,
        anime: 40,
        documentary: 50,
        variety: 60
      };
      return Number(priority[id] || 200 + Number(index || 0));
    }

    function homeSectionConfig() {
      return visibleTmdbLists()
        .filter((list) => list && list.id !== "all" && list.id !== "now-playing")
        .map((list, index) => ({
          listId: list.id,
          title: list.title || list.id,
          priority: homeSectionPriority(list, index)
        }))
        .sort((a, b) => a.priority - b.priority)
        .map((config, index) => {
          const variant = homeSectionVariant({ id: config.listId }, index);
          return Object.assign({}, config, { variant, initialLimit: homeRailLimit(variant) });
        });
    }

    function homeRailColumnTarget(variant, width) {
      const value = Number(width || 0) || Number(window.innerWidth || 0) || 390;
      if (variant === "landscape") {
        if (value >= 1200) return 6;
        if (value >= 900) return 5;
        if (value >= 640) return 4;
        if (value >= 480) return 3;
        return 2;
      }
      // Phase 2 canvas density: keep the existing TV scale factor while
      // giving 1920px Home rails the vvee-sized ~180px poster target.
      if (value >= 1600) return 10;
      if (value >= 1200) return 9;
      if (value >= 900) return 7;
      if (value >= 640) return 5;
      if (value >= 480) return 4;
      return 3;
    }

    function homeRailLimit(variant, fallback) {
      const max = variant === "landscape" ? 8 : 14;
      const target = homeRailColumnTarget(variant);
      const desired = Math.min(max, target + 2);
      const requested = Number(fallback || 0);
      return requested > 0 ? Math.min(desired, requested) : desired;
    }

    const HOME_HERO_FINAL_LIMIT = 6;
    const HOME_HERO_PREFETCH_LIMIT = 10;
    const HOME_HERO_NOSTR_SCAN_LIMIT = 24;
    const HOME_HERO_CACHE_TTL_MS = 45 * 60 * 1000;
    const HOME_HERO_DETAIL_CONCURRENCY = 5;

    function homeHeroFeedState() {
      const home = state.homeV14;
      if (!home) return null;
      if (!home.heroFeed) {
        home.heroFeed = {
          items: [], loading: false, loaded: false, loadedAt: 0, error: "",
          promise: null, requestSeq: 0, poolCount: 0, detailRequests: 0, weeklyMerged: false, sourceStats: null,
          source: "", sourceKey: ""
        };
      }
      if (home.heroFeed.source == null) home.heroFeed.source = "";
      if (home.heroFeed.sourceKey == null) home.heroFeed.sourceKey = "";
      return home.heroFeed;
    }

    function homeHeroSourceKey(source) {
      const selected = source === "nostr" ? "nostr" : "tmdb";
      if (selected !== "nostr") return "tmdb";
      const hot = state.hot || {};
      const signature = filterBlocked(Array.isArray(hot.items) ? hot.items : [])
        .slice(0, HOME_HERO_NOSTR_SCAN_LIMIT)
        .map((item, index) => [
          homeHeroIdentity(item),
          Number(item && (item.people || item.count) || 0),
          String(item && (item.latest || item.lastEventAt || item.last_event_at) || ""),
          index
        ].join(":"))
        .join("|");
      return `nostr:${Number(hot.version || 0)}:${signature}`;
    }

    function invalidateHomeHeroFeed() {
      const feed = homeHeroFeedState();
      if (!feed) return false;
      feed.requestSeq = Number(feed.requestSeq || 0) + 1;
      feed.source = "";
      feed.sourceKey = "";
      feed.items = [];
      feed.loading = false;
      feed.loaded = false;
      feed.loadedAt = 0;
      feed.error = "";
      feed.promise = null;
      feed.poolCount = 0;
      feed.detailRequests = 0;
      feed.weeklyMerged = false;
      feed.sourceStats = null;
      return true;
    }

    function homeHeroIdentity(item) {
      if (!item) return "";
      const mediaType = String(item.mediaType || item.media_type || "").toLowerCase();
      let tmdbId = String(item.tmdbId || "").trim();
      if (!tmdbId && /^tmdb:(movie|tv):[^:]+$/i.test(String(item.id || ""))) tmdbId = String(item.id).split(":").slice(2).join(":");
      return (mediaType === "movie" || mediaType === "tv") && tmdbId ? `${mediaType}:${tmdbId}` : "";
    }

    function homeHeroTitleKey(item) {
      return normalizeTitle(item && (item.title || item.name || ""));
    }

    function homeHeroBackdrop(item) {
      return String(item && (item.landscape || item.backdrop || item.backdropUrl || item.backdropPath || item.backdrop_path || "") || "").trim();
    }

    function homeHeroFreshnessScore(item) {
      const value = latestDateOnly(item && (item.releaseDate || item.firstAirDate || item.release_date || item.first_air_date || ""));
      if (!value) return 0;
      const stamp = Date.parse(`${value}T00:00:00Z`);
      if (!Number.isFinite(stamp)) return 0;
      const days = (Date.now() - stamp) / 86400000;
      if (days < -30) return 0;
      if (days <= 14) return Math.max(0, 18 - Math.max(0, days) * 0.65);
      if (days <= 120) return Math.max(0, 9 - (days - 14) * 0.075);
      return 0;
    }

    function homeHeroNormalizeSourceItem(raw, source, index) {
      if (!raw || !raw.id) return null;
      const mediaType = String(source.mediaType || raw.media_type || raw.mediaType || "").toLowerCase();
      if (mediaType !== "movie" && mediaType !== "tv") return null;
      const normalized = normalizeTmdb(Object.assign({}, raw, { media_type: mediaType }), {
        id: "home-hero", title: "首页 Hero", mediaType
      }, index);
      if (!homeHeroIdentity(normalized) || !normalized.title) return null;
      normalized.voteCount = Number(raw.vote_count || raw.voteCount || 0);
      normalized.heroSourceKinds = [source.kind];
      normalized.heroRaw = raw;
      normalized.heroDetailEnriched = false;
      return normalized;
    }

    function homeHeroMergeCandidate(map, candidate) {
      const key = homeHeroIdentity(candidate);
      if (!key || !candidate) return;
      const previous = map.get(key);
      const merged = Object.assign({}, previous || {}, candidate);
      ["title", "pic", "landscape", "image", "desc", "releaseDate", "voteAverage", "voteCount", "originalLanguage", "originCountries"].forEach((field) => {
        if ((merged[field] == null || merged[field] === "") && previous && previous[field] != null) merged[field] = previous[field];
      });
      merged.heroSourceKinds = Array.from(new Set([].concat(previous && previous.heroSourceKinds || [], candidate.heroSourceKinds || [])));
      merged.heroRaw = candidate.heroRaw || previous && previous.heroRaw || null;
      map.set(key, merged);
    }

    function homeHeroEligible(item) {
      const identity = homeHeroIdentity(item);
      const title = String(item && item.title || "").trim();
      const backdrop = homeHeroBackdrop(item);
      const isWeeklyFeed = Array.isArray(item && item.heroSourceKinds) && item.heroSourceKinds.includes("weekly-feed");
      const popularity = Math.max(0, Number(item && item.popularity || 0));
      const voteCount = Math.max(0, Number(item && (item.voteCount || item.vote_count) || 0));
      const fresh = homeHeroFreshnessScore(item) > 0;
      if (!identity || !title || !backdrop || !hasPoster(item)) return false;
      if (!isWeeklyFeed && !isReleasedAsOfToday(item)) return false;
      if (popularity < 1.2 && voteCount < 20 && !fresh) return false;
      if (popularity < 0.45 && voteCount < 80 && !fresh) return false;
      return true;
    }

    function homeHeroScore(item) {
      const popularity = Math.min(160, Math.max(0, Number(item && item.popularity || 0)));
      const rating = Math.min(10, Math.max(0, Number(item && (item.voteAverage || item.vote_average) || 0)));
      const votes = Math.min(14, Math.log10(Math.max(1, Number(item && (item.voteCount || item.vote_count) || 0) + 1)) * 3.2);
      const freshness = homeHeroFreshnessScore(item);
      const backdrop = homeHeroBackdrop(item) ? 10 : 0;
      return popularity * 0.48 + rating * 2.7 + votes + freshness + backdrop;
    }

    function homeHeroRank(items) {
      return (Array.isArray(items) ? items : [])
        .filter(homeHeroEligible)
        .map((item) => Object.assign({}, item, { heroScore: homeHeroScore(item) }))
        .sort((a, b) => Number(b.heroScore || 0) - Number(a.heroScore || 0));
    }

    function homeHeroSelect(items, limit) {
      const rankedItems = homeHeroRank(items);
      const selected = [];
      const titleKeys = new Set();
      rankedItems.forEach((item) => {
        if (selected.length >= Number(limit || HOME_HERO_FINAL_LIMIT)) return;
        const titleKey = homeHeroTitleKey(item);
        if (titleKey && titleKeys.has(titleKey)) return;
        selected.push(item);
        if (titleKey) titleKeys.add(titleKey);
      });
      if (selected.length < Number(limit || HOME_HERO_FINAL_LIMIT)) {
        rankedItems.forEach((item) => {
          if (selected.length >= Number(limit || HOME_HERO_FINAL_LIMIT)) return;
          if (!selected.some((entry) => homeHeroIdentity(entry) === homeHeroIdentity(item))) selected.push(item);
        });
      }
      return selected;
    }

    function homeHeroNostrEligible(item) {
      const identity = homeHeroIdentity(item);
      const title = String(item && item.title || "").trim();
      return !!identity
        && !!title
        && !!homeHeroBackdrop(item)
        && hasPoster(item)
        && !isBlocked(item)
        && isReleasedAsOfToday(item);
    }

    function homeHeroSelectNostr(items, limit) {
      const selected = [];
      const identityKeys = new Set();
      const titleKeys = new Set();
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (selected.length >= Number(limit || HOME_HERO_FINAL_LIMIT) || !homeHeroNostrEligible(item)) return;
        const identity = homeHeroIdentity(item);
        const titleKey = homeHeroTitleKey(item);
        if (!identity || identityKeys.has(identity) || titleKey && titleKeys.has(titleKey)) return;
        selected.push(item);
        identityKeys.add(identity);
        if (titleKey) titleKeys.add(titleKey);
      });
      return selected;
    }

    function homeHeroNormalizeNostrCandidate(raw, index) {
      if (!raw) return null;
      const mediaType = String(raw.mediaType || raw.media_type || "").toLowerCase();
      const tmdbId = String(raw.tmdbId || raw.tmdb_id || "").trim();
      if ((mediaType !== "movie" && mediaType !== "tv") || !tmdbId) return null;
      const title = String(raw.title || raw.name || "").trim();
      const sourceRaw = mediaType === "tv"
        ? { id: tmdbId, media_type: mediaType, name: title }
        : { id: tmdbId, media_type: mediaType, title };
      const normalized = normalizeTmdb(sourceRaw, { id: "home-hero-nostr", title: "首页 Nostr Hero", mediaType }, index);
      if (!normalized || !homeHeroIdentity(normalized)) return null;
      normalized.pic = "";
      normalized.landscape = "";
      normalized.image = "";
      normalized.title = normalized.title || title;
      normalized.resourceSearchTitle = title;
      normalized.heroSourceKinds = ["nostr-hot"];
      normalized.heroRaw = sourceRaw;
      normalized.heroDetailEnriched = false;
      normalized.nostrHotRank = Number(raw.nostrHotRank || index + 1);
      normalized.people = raw.people != null ? raw.people : raw.count;
      normalized.count = raw.count != null ? raw.count : raw.people;
      normalized.latest = raw.latest || raw.lastEventAt || raw.last_event_at || "";
      return normalized;
    }

    function homeHeroNostrCandidates() {
      const seen = new Set();
      return filterBlocked(Array.isArray(state.hot && state.hot.items) ? state.hot.items : [])
        .slice(0, HOME_HERO_NOSTR_SCAN_LIMIT)
        .map((item, index) => homeHeroNormalizeNostrCandidate(item, index))
        .filter((item) => {
          const identity = homeHeroIdentity(item);
          if (!identity || seen.has(identity)) return false;
          seen.add(identity);
          return true;
        });
    }

    function homeHeroIsTmdbCandidate(item) {
      return !!item
        && item.source !== "nostr-hot"
        && !(Array.isArray(item.heroSourceKinds) && item.heroSourceKinds.includes("nostr-hot"));
    }

    function homeHeroFallbackCandidates(source) {
      if ((source || homeHotSource()) === "nostr") return [];
      const sources = [];
      if (Array.isArray(state.homeLatest && state.homeLatest.items)) {
        sources.push(...state.homeLatest.items.map((item) => Object.assign({}, item, { heroSourceKinds: ["weekly-feed"] })));
      }
      if (Array.isArray(state.fallback)) sources.push(...state.fallback);
      if (Array.isArray(state.searchHot && state.searchHot.items)) sources.push(...state.searchHot.items);
      sources.push(...allItems());
      return homeHeroSelect(uniqueMedia(filterBlocked(sources).filter(homeHeroIsTmdbCandidate)), HOME_HERO_FINAL_LIMIT);
    }

    function mergeHomeLatestIntoHeroFeed(options) {
      const feed = homeHeroFeedState();
      if (homeHotSource() === "nostr") return false;
      if (!feed || feed.source !== "tmdb" || feed.sourceKey !== "tmdb" || feed.loading || !feed.loaded || feed.weeklyMerged || !state.homeLatest || !state.homeLatest.loaded) return false;
      feed.weeklyMerged = true;
      const weekly = filterBlocked(state.homeLatest.items || []).slice(0, 12);
      if (!weekly.length) return false;
      const next = homeHeroSelect((feed.items || []).concat(weekly), HOME_HERO_FINAL_LIMIT);
      const changed = next.map(homeHeroIdentity).join("|") !== (feed.items || []).map(homeHeroIdentity).join("|");
      feed.items = next;
      if (changed && (!options || options.render !== false) && isHomeRouteActive()) renderHomeHero();
      return changed;
    }

    function homeHeroBackdropFromDetail(candidate, detail) {
      const entries = Array.isArray(detail && detail.images && detail.images.backdrops) ? detail.images.backdrops.filter((entry) => entry && entry.file_path) : [];
      const usable = entries.filter((entry) => !entry.width || Number(entry.width) >= 800 || !entry.aspect_ratio || Number(entry.aspect_ratio) >= 1.45);
      if (usable.length) {
        usable.sort((a, b) => {
          const ratioScore = (entry) => 5 - Math.min(5, Math.abs(Number(entry.aspect_ratio || 1.777) - 1.777) * 4);
          const qualityScore = (entry) => ratioScore(entry) + Math.min(4, Number(entry.width || 0) / 1000) + Math.min(3, Number(entry.vote_average || 0) * 0.35) + Math.min(2, Math.log10(Number(entry.vote_count || 0) + 1) * 0.5);
          return qualityScore(b) - qualityScore(a);
        });
        return imageUrl(usable[0].file_path, true);
      }
      return homeHeroBackdrop(candidate);
    }

    async function homeHeroEnrichCandidate(candidate) {
      const mediaType = String(candidate && candidate.mediaType || "").toLowerCase();
      const tmdbId = String(candidate && candidate.tmdbId || "").trim();
      if (!candidate || !tmdbId || (mediaType !== "movie" && mediaType !== "tv")) return candidate;
      const detail = mediaType === "tv"
        ? await requestTvDetailShared({ mediaType: "tv", tmdbId })
        : await requestJson(tmdbUrl({
          id: "home-hero-detail",
          title: "首页 Hero",
          endpoint: `${mediaType}/${encodeURIComponent(tmdbId)}`,
          mediaType,
          params: { language: "zh-CN", append_to_response: "images" }
        }), 18);
      const heroRaw = candidate.heroRaw && typeof candidate.heroRaw === "object"
        ? candidate.heroRaw
        : {};
      const localizedBase = Object.assign({}, heroRaw);
      if (mediaType === "tv") {
        localizedBase.name = candidate.resourceSearchTitle
          || candidate.title
          || localizedBase.name
          || "";
      } else {
        localizedBase.title = candidate.resourceSearchTitle
          || candidate.title
          || localizedBase.title
          || "";
      }
      localizedBase.aliases = mergeTitleAliases(
        localizedBase.aliases,
        candidate.aliases,
        candidate.resourceSearchTitle,
        candidate.title,
        candidate.originalTitle
      );
      const raw = mergeTmdbLocalizedEnrichment(localizedBase, detail || {}, mediaType);
      raw.id = detail && detail.id || tmdbId;
      raw.media_type = mediaType;
      const normalized = normalizeTmdb(raw, { id: "home-hero-detail", title: "首页 Hero", mediaType }, 0);
      const enriched = Object.assign({}, candidate, normalized);
      enriched.pic = enriched.pic || candidate.pic || "";
      enriched.landscape = homeHeroBackdropFromDetail(candidate, detail) || homeHeroBackdrop(normalized) || candidate.landscape || "";
      enriched.image = enriched.landscape || enriched.image || candidate.image || candidate.pic || "";
      enriched.voteCount = Number(detail && detail.vote_count || candidate.voteCount || 0);
      enriched.heroSourceKinds = candidate.heroSourceKinds || [];
      enriched.heroRaw = raw;
      enriched.heroDetail = detail || null;
      enriched.heroDetailEnriched = true;
      return enriched;
    }

    function homeHeroFeedIsCurrent(feed, source, sourceKey, requestSeq) {
      return !!(feed
        && feed.requestSeq === requestSeq
        && feed.source === source
        && feed.sourceKey === sourceKey
        && homeHotSource() === source
        && homeHeroSourceKey(source) === sourceKey);
    }

    async function homeHeroProgressiveNostrEnrich(scanCandidates, runCurrent) {
      const candidates = Array.isArray(scanCandidates) ? scanCandidates : [];
      const enriched = [];
      let selected = [];
      let cursor = 0;
      while (selected.length < HOME_HERO_FINAL_LIMIT && cursor < candidates.length) {
        if (!runCurrent()) return { stale: true, items: [], processed: cursor };
        const missing = HOME_HERO_FINAL_LIMIT - selected.length;
        const batch = candidates.slice(cursor, cursor + missing);
        cursor += batch.length;
        const details = await weeklyMapLimit(batch, HOME_HERO_DETAIL_CONCURRENCY, (candidate) => homeHeroEnrichCandidate(candidate));
        if (!runCurrent()) return { stale: true, items: [], processed: cursor };
        details.forEach((result, index) => {
          enriched.push(result && result.ok && result.value ? result.value : batch[index]);
        });
        selected = homeHeroSelectNostr(enriched, HOME_HERO_FINAL_LIMIT);
      }
      return { stale: false, items: selected, processed: cursor };
    }

    async function loadHomeHeroFeed() {
      const feed = homeHeroFeedState();
      if (!feed) return null;
      const source = homeHotSource();
      const sourceKey = homeHeroSourceKey(source);
      if (feed.loading && feed.source === source && feed.sourceKey === sourceKey) return feed.promise || feed;
      if (feed.loading) invalidateHomeHeroFeed();
      feed.source = source;
      feed.sourceKey = sourceKey;
      feed.loading = true;
      feed.error = "";
      const requestSeq = ++feed.requestSeq;
      const runCurrent = () => homeHeroFeedIsCurrent(feed, source, sourceKey, requestSeq);
      const promise = Promise.resolve().then(async () => {
        const candidates = new Map();
        const sourceStats = {};
        let successCount = 0;
        if (source === "nostr") {
          if (!(state.hot && state.hot.ready)) {
            feed.loading = false;
            feed.loaded = false;
            feed.loadedAt = 0;
            feed.items = [];
            feed.error = "";
            return feed;
          }
          homeHeroNostrCandidates().forEach((candidate) => homeHeroMergeCandidate(candidates, candidate));
          sourceStats["nostr-hot"] = candidates.size;
          successCount = 1;
        } else {
          const sources = [
            { kind: "tmdb-trending-week", endpoint: "trending/all/week", mediaType: "" },
            { kind: "tmdb-movie-now-playing", endpoint: "movie/now_playing", mediaType: "movie" },
            { kind: "tmdb-tv-on-the-air", endpoint: "tv/on_the_air", mediaType: "tv" }
          ];
          const responses = await Promise.all(sources.map((sourceItem) => requestJson(tmdbUrl({
            id: "home-hero-source", title: "首页 Hero", endpoint: sourceItem.endpoint, mediaType: sourceItem.mediaType,
            params: { language: "zh-CN" }
          }), 18).then((body) => ({ source: sourceItem, body: body || {}, ok: true })).catch((error) => ({ source: sourceItem, body: null, ok: false, error }))));
          if (!runCurrent()) return feed;
          responses.forEach((result) => {
            const sourceItem = result.source;
            const values = result.ok && result.body && Array.isArray(result.body.results) ? result.body.results : [];
            sourceStats[sourceItem.kind] = values.length;
            if (result.ok) successCount += 1;
            values.forEach((raw, index) => homeHeroMergeCandidate(candidates, homeHeroNormalizeSourceItem(raw, sourceItem, index)));
          });
          if (state.homeLatest && state.homeLatest.loaded) {
            filterBlocked(state.homeLatest.items || []).slice(0, 12).forEach((item) => {
              const candidate = Object.assign({}, item, { heroSourceKinds: ["weekly-feed"], heroRaw: item.weeklyDetail || item });
              homeHeroMergeCandidate(candidates, candidate);
            });
            sourceStats["weekly-feed"] = Math.min(12, (state.homeLatest.items || []).length);
          }
        }
        if (!runCurrent()) return feed;
        const sourceCandidates = Array.from(candidates.values());
        let finalItems = [];
        if (source === "nostr") {
          const scanCandidates = sourceCandidates.slice(0, HOME_HERO_NOSTR_SCAN_LIMIT);
          feed.poolCount = scanCandidates.length;
          const progress = await homeHeroProgressiveNostrEnrich(scanCandidates, runCurrent);
          if (progress.stale || !runCurrent()) return feed;
          feed.detailRequests = progress.processed;
          finalItems = progress.items;
        } else {
          const prefetch = homeHeroSelect(sourceCandidates, HOME_HERO_PREFETCH_LIMIT);
          feed.poolCount = prefetch.length;
          const details = await weeklyMapLimit(prefetch, HOME_HERO_DETAIL_CONCURRENCY, (candidate) => homeHeroEnrichCandidate(candidate));
          if (!runCurrent()) return feed;
          feed.detailRequests = prefetch.length;
          const enriched = details.map((result, index) => result && result.ok && result.value ? result.value : prefetch[index]).filter(Boolean);
          finalItems = homeHeroSelect(enriched, HOME_HERO_FINAL_LIMIT);
          if (finalItems.length < HOME_HERO_FINAL_LIMIT) {
            finalItems = homeHeroSelect(finalItems.concat(homeHeroFallbackCandidates("tmdb")), HOME_HERO_FINAL_LIMIT);
          }
        }
        feed.items = finalItems.slice(0, HOME_HERO_FINAL_LIMIT);
        feed.weeklyMerged = source === "tmdb" && !!(state.homeLatest && state.homeLatest.loaded);
        feed.loaded = true;
        feed.loadedAt = Date.now();
        feed.loading = false;
        feed.error = source === "nostr" ? "" : (feed.items.length || successCount ? "" : "加载失败");
        feed.sourceStats = Object.assign({ successCount, candidateCount: candidates.size }, sourceStats);
        if (isHomeRouteActive()) renderHomeHero();
        return feed;
      }).catch((error) => {
        if (!runCurrent()) return feed;
        feed.loading = false;
        feed.loaded = true;
        feed.loadedAt = Date.now();
        feed.error = source === "nostr" ? String(error && error.message || "加载失败") : String(error && error.message || "加载失败");
        feed.detailRequests = 0;
        if (source === "tmdb" && !feed.items.length) feed.items = homeHeroFallbackCandidates("tmdb");
        if (isHomeRouteActive()) renderHomeHero();
        return feed;
      });
      feed.promise = promise;
      promise.then(() => { if (feed.promise === promise) feed.promise = null; }, () => { if (feed.promise === promise) feed.promise = null; });
      return promise;
    }

    function ensureHomeHeroFeed() {
      if (!isHomeRouteActive()) return false;
      const feed = homeHeroFeedState();
      if (!feed) return false;
      const source = homeHotSource();
      const sourceKey = homeHeroSourceKey(source);
      if (feed.source !== source || feed.sourceKey !== sourceKey) invalidateHomeHeroFeed();
      if (source === "nostr" && !(state.hot && state.hot.ready)) return false;
      if (feed.loading) return false;
      if (feed.loaded && feed.loadedAt && Date.now() - feed.loadedAt < HOME_HERO_CACHE_TTL_MS) return false;
      loadHomeHeroFeed().catch(() => {});
      return true;
    }

    function homeHeroCandidates() {
      const feed = homeHeroFeedState();
      const source = homeHotSource();
      const sourceKey = homeHeroSourceKey(source);
      const cached = feed && feed.source === source && feed.sourceKey === sourceKey ? filterBlocked(feed.items || []) : [];
      if (source === "nostr") return homeHeroSelectNostr(cached, HOME_HERO_FINAL_LIMIT).slice(0, HOME_HERO_FINAL_LIMIT);
      return cached && cached.length
        ? homeHeroSelect(cached, HOME_HERO_FINAL_LIMIT).slice(0, HOME_HERO_FINAL_LIMIT)
        : homeHeroFallbackCandidates("tmdb");
    }

    function homeHeroBackdropUrl(item) {
      const value = homeHeroBackdrop(item);
      return value ? displayImage(value, { size: "w1280" }) : "";
    }

    function homeHeroBackdropCss(url) {
      return url ? `url("${String(url).replace(/\\/g, "\\\\").replace(/"/g, "%22")}")` : "";
    }

    function preloadHomeHeroBackdrop(url) {
      const source = String(url || "").trim();
      const home = state.homeV14;
      if (!source || !home) return Promise.resolve(false);
      const cache = home.heroBackdropCache || (home.heroBackdropCache = {});
      if (cache[source] === true) return Promise.resolve(true);
      if (cache[source] && typeof cache[source].then === "function") return cache[source];
      if (typeof Image !== "function") return Promise.resolve(false);
      const promise = new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          cache[source] = true;
          resolve(true);
        };
        image.onerror = () => {
          delete cache[source];
          resolve(false);
        };
        image.src = source;
      });
      cache[source] = promise;
      return promise;
    }

    const HOME_HERO_AUTOPLAY_MS = 5000;

    function clearHomeHeroConfirmGuard() {
      const home = state.homeV14;
      const guard = home && home.heroConfirmGuard;
      if (guard && guard.timer) clearTimeout(guard.timer);
      if (home) home.heroConfirmGuard = null;
    }

    function armHomeHeroConfirmGuard(event) {
      const home = state.homeV14;
      if (!home) return false;
      clearHomeHeroConfirmGuard();
      home.heroConfirmGuard = {
        key: "Enter",
        keyCode: Number(event && (event.keyCode || event.which) || 0),
        armedAt: Date.now(),
        timer: setTimeout(clearHomeHeroConfirmGuard, 900)
      };
      return true;
    }

    function isHomeHeroConfirmGuardMatch(event) {
      const guard = state.homeV14 && state.homeV14.heroConfirmGuard;
      return !!(guard && normalizeRemoteKey(event) === guard.key);
    }

    function consumeHomeHeroConfirmGuard(event) {
      if (!isHomeHeroConfirmGuardMatch(event)) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (event.type === "keyup") clearHomeHeroConfirmGuard();
      return true;
    }

    function clearHomeHeroAutoplayResume() {
      const home = state.homeV14;
      if (home && home.heroAutoplayResumeTimer) clearTimeout(home.heroAutoplayResumeTimer);
      if (home) home.heroAutoplayResumeTimer = 0;
    }

    function stopHomeHeroAutoplay() {
      if (state.homeV14.heroTimer) clearTimeout(state.homeV14.heroTimer);
      state.homeV14.heroTimer = 0;
    }

    function pauseHomeHeroAutoplay() {
      const home = state.homeV14;
      if (!home) return;
      home.heroAutoplayPaused = true;
      clearHomeHeroAutoplayResume();
      stopHomeHeroAutoplay();
    }

    function resumeHomeHeroAutoplayLater() {
      const home = state.homeV14;
      if (!home) return;
      clearHomeHeroAutoplayResume();
      home.heroAutoplayResumeTimer = setTimeout(() => {
        home.heroAutoplayResumeTimer = 0;
        home.heroAutoplayPaused = false;
        scheduleHomeHeroAutoplay();
      }, 9000);
    }

    function bindHomeHeroFocus(hero) {
      if (!hero || hero.dataset.homeHeroFocusBound === "1") return;
      hero.dataset.homeHeroFocusBound = "1";
      hero.addEventListener("focus", () => {
        pauseHomeHeroAutoplay();
      });
      hero.addEventListener("blur", () => {
        resumeHomeHeroAutoplayLater();
      });
    }

    function homeHeroCanAutoplay() {
      const hero = $("homeHero");
      const items = Array.isArray(state.homeV14.heroItems) ? state.homeV14.heroItems : [];
      return isHomeRouteActive()
        && !!hero
        && !hero.hidden
        && hero.isConnected !== false
        && items.length > 1
        && !state.homeV14.heroAutoplayPaused
        && !document.hidden;
    }

    function scheduleHomeHeroAutoplay() {
      stopHomeHeroAutoplay();
      if (!homeHeroCanAutoplay()) return false;
      state.homeV14.heroTimer = setTimeout(() => {
        state.homeV14.heroTimer = 0;
        if (!homeHeroCanAutoplay()) return;
        setHomeHeroIndex(Number(state.homeV14.heroIndex || 0) + 1, { autoplay: true, resetTimer: false });
        scheduleHomeHeroAutoplay();
      }, HOME_HERO_AUTOPLAY_MS);
      return true;
    }

    function openHomeHeroDetail(event) {
      const hero = $("homeHero");
      const action = $("homeHeroAction");
      const item = hero && hero.__homeHeroItem || action && action.__homeHeroItem;
      if (!item) return false;
      // A programmatic click from the remote-confirm path has no useful
      // keyboard event of its own.  Arm the same one-shot guard here as a
      // safety net for native button activation, while mouse clicks remain
      // ordinary detail-only clicks.
      if (event && event.detail === 0 && !(state.homeV14 && state.homeV14.heroConfirmGuard)) armHomeHeroConfirmGuard(event);
      // The Home Hero CTA is a detail entry point only.  Keep playback on the
      // existing Detail/Play path; never turn this CTA into a direct player call.
      pauseHomeHeroAutoplay();
      openDetail(item, { returnTarget: hero });
      return true;
    }

    function homeHeroPresentationDetail(item) {
      return item && (item.heroDetail || item.weeklyDetail || item.heroRaw) || {};
    }

    function homeHeroPresentationGenres(item, detail) {
      const names = [];
      const add = (value) => {
        const text = String(value || "").trim();
        if (text && !names.includes(text)) names.push(text);
      };
      (Array.isArray(detail && detail.genres) ? detail.genres : []).forEach((genre) => add(genre && (genre.name || genre.title)));
      const raw = item && item.heroRaw;
      if (!names.length && raw && Array.isArray(raw.genres)) raw.genres.forEach((genre) => add(genre && (genre.name || genre.title)));
      const labels = typeof SECONDARY_GENRE_LABELS === "object" ? SECONDARY_GENRE_LABELS : {};
      const ids = Array.isArray(detail && detail.genre_ids) ? detail.genre_ids : raw && Array.isArray(raw.genre_ids) ? raw.genre_ids : item && Array.isArray(item.genreIds) ? item.genreIds : [];
      ids.forEach((id) => add(labels[String(id)] || ""));
      return names.slice(0, 3);
    }

    function homeHeroPresentationOverview(item, detail) {
      const raw = item && item.heroRaw;
      const candidates = [detail && detail.overview, raw && raw.overview, item && item.overview];
      return candidates.map((value) => String(value || "").trim()).find(Boolean) || "";
    }

    function homeHeroPresentationEpisodeLabel(episode) {
      const code = weeklyEpisodeCode(episode);
      if (code) return code;
      const number = Number(episode && (episode.episode_number || episode.episodeNumber));
      return Number.isFinite(number) && number > 0 ? `第${number}集` : "";
    }

    function homeHeroPresentationStatus(item, detail) {
      if (!item) return "";
      if (item.mediaType !== "tv") {
        const runtime = detailRuntime(detail || {}, item);
        const releaseDate = latestDateOnly(detail && (detail.release_date || detail.primary_release_date) || item.releaseDate);
        const release = releaseDate ? `${weeklyDateLabel(releaseDate)}上映` : "";
        return [runtime, release].filter(Boolean).join(" · ");
      }
      const weekly = String(item.weeklyUpdateText || "").trim();
      if (weekly && weekly !== "本周更新") return weekly;
      const last = detail && detail.last_episode_to_air || item.weeklyLastEpisode;
      const next = detail && detail.next_episode_to_air || item.weeklyNextEpisode;
      const lastDate = latestDateOnly(last && last.air_date);
      const nextDate = latestDateOnly(next && next.air_date);
      const lastLabel = homeHeroPresentationEpisodeLabel(last);
      if (lastLabel || lastDate) {
        const dateLabel = lastDate === weeklyShanghaiToday() ? "今天更新" : lastDate ? `${weeklyDateLabel(lastDate)}更新` : "";
        return [`更新至${lastLabel || "最新一集"}`, dateLabel].filter(Boolean).join(" · ");
      }
      const nextLabel = homeHeroPresentationEpisodeLabel(next);
      if (nextLabel || nextDate) {
        const dateLabel = nextDate === weeklyShanghaiToday() ? "今天更新" : nextDate ? `${weeklyWeekdayLabel(nextDate)}更新` : "";
        return [nextLabel || "下一集", dateLabel].filter(Boolean).join(" · ");
      }
      return weekly;
    }

    function setHomeHeroOptionalText(node, value) {
      if (!node) return;
      const text = String(value || "").trim();
      node.textContent = text;
      node.hidden = !text;
    }

    function updateHomeHeroPresentation(item) {
      const detail = homeHeroPresentationDetail(item);
      const title = $("homeHeroTitle");
      const tagline = $("homeHeroTagline");
      const meta = $("homeHeroMeta");
      const status = $("homeHeroStatus");
      const overview = $("homeHeroOverview");
      const hero = $("homeHero");
      const action = $("homeHeroAction");
      const logoWrap = $("homeHeroLogoWrap");
      const logo = $("homeHeroLogo");
      if (!title || !meta || !action || !hero) return false;
      title.textContent = item && item.title || "正在准备首页";
      const date = detail && (detail.release_date || detail.first_air_date) || item && (item.releaseDate || item.firstAirDate) || "";
      const year = String(date).slice(0, 4);
      const kind = item && item.mediaType === "tv" ? "剧集" : item ? "电影" : "";
      const genres = homeHeroPresentationGenres(item, detail);
      const ratingValue = Number(detail && detail.vote_average || item && item.voteAverage || 0);
      const rating = ratingValue > 0 ? `${ratingValue.toFixed(1)} 分` : "";
      meta.textContent = [year, kind, genres.length ? genres.join(" / ") : "", rating].filter(Boolean).join(" · ");
      setHomeHeroOptionalText(tagline, detail && (detail.tagline || detail.tag_line) || item && item.tagline);
      setHomeHeroOptionalText(status, homeHeroPresentationStatus(item, detail));
      setHomeHeroOptionalText(overview, homeHeroPresentationOverview(item, detail));
      const existingLogo = item && (item.logo || item.logoUrl || item.logoPath || item.logo_path) || "";
      if (logoWrap && logo) {
        const logoSrc = existingLogo ? displayImage(existingLogo, { size: "w780" }) : "";
        logoWrap.hidden = !logoSrc;
        logo.src = logoSrc;
        logo.alt = item && item.title || "";
      }
      title.classList.toggle("has-logo", !!(logoWrap && !logoWrap.hidden));
      hero.tabIndex = item ? 0 : -1;
      hero.setAttribute("aria-disabled", item ? "false" : "true");
      hero.__homeHeroItem = item;
      action.__homeHeroItem = item;
      action.dataset.homeAction = "detail";
      bindHomeHeroFocus(hero);
      if (!hero.dataset.homeBound) {
        hero.dataset.homeBound = "1";
        hero.addEventListener("click", (event) => {
          if (Date.now() < Number(state.homeV14.heroSwipeSuppressClickUntil || 0)) {
            event.preventDefault();
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          openHomeHeroDetail(event);
        });
      }
      return true;
    }

    function bindHomeHeroSwipe() {
      const hero = $("homeHero");
      if (!hero || hero.dataset.homeSwipeBound === "1") return;
      hero.dataset.homeSwipeBound = "1";
      hero.addEventListener("touchstart", (event) => {
        if (isTvLikeDevice() || !isHomeRouteActive()) {
          state.homeV14.heroSwipe = null;
          return;
        }
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        state.homeV14.heroSwipe = { x: touch.clientX, y: touch.clientY, at: Date.now(), moved: false };
      }, { passive: true });
      hero.addEventListener("touchmove", (event) => {
        const swipe = state.homeV14.heroSwipe;
        const touch = event.touches && event.touches[0];
        if (!swipe || !touch || isTvLikeDevice()) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.25) {
          swipe.moved = true;
          event.preventDefault();
        }
      }, { passive: false });
      hero.addEventListener("touchend", (event) => {
        const swipe = state.homeV14.heroSwipe;
        state.homeV14.heroSwipe = null;
        if (!swipe || !swipe.moved || isTvLikeDevice() || !isHomeRouteActive()) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.25 || Date.now() - swipe.at > 900) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        state.homeV14.heroSwipeSuppressClickUntil = Date.now() + 500;
        const items = Array.isArray(state.homeV14.heroItems) ? state.homeV14.heroItems : [];
        if (items.length > 1) setHomeHeroIndex(Number(state.homeV14.heroIndex || 0) + (dx < 0 ? 1 : -1), { manual: true });
      }, { passive: false });
      hero.addEventListener("touchcancel", () => {
        state.homeV14.heroSwipe = null;
      }, { passive: true });
    }

    function setHomeHeroIndex(index, options) {
      const opts = options || {};
      const items = Array.isArray(state.homeV14.heroItems) ? state.homeV14.heroItems : [];
      const slides = $("homeHeroSlides");
      const dots = $("homeHeroDots");
      if (!items.length || !slides || !dots) return false;
      const count = items.length;
      const next = ((Number(index) % count) + count) % count;
      state.homeV14.heroIndex = next;
      state.homeV14.heroItem = items[next] || null;
      Array.from(dots.children || []).forEach((dot, dotIndex) => dot.classList.toggle("active", dotIndex === next));
      updateHomeHeroPresentation(state.homeV14.heroItem);
      if (opts.manual) {
        pauseHomeHeroAutoplay();
        // Manual navigation pauses autoplay, but the same timer must be
        // allowed to resume it even while the Hero keeps focus.
        resumeHomeHeroAutoplayLater();
      }
      const targetSlide = slides.children[next];
      const targetBackground = targetSlide && targetSlide.querySelector(".home-hero-slide-bg");
      const backgroundUrl = homeHeroBackdropUrl(state.homeV14.heroItem);
      const token = ++state.homeV14.heroBackdropSeq;
      const activate = () => {
        Array.from(slides.children || []).forEach((slide, slideIndex) => slide.classList.toggle("active", slideIndex === next));
      };
      if (!targetSlide || !targetBackground || !backgroundUrl || targetBackground.dataset.homeHeroLoadedSrc === backgroundUrl || state.homeV14.heroBackdropCache && state.homeV14.heroBackdropCache[backgroundUrl] === true) {
        if (targetBackground && backgroundUrl) {
          targetBackground.style.backgroundImage = homeHeroBackdropCss(backgroundUrl);
          targetBackground.dataset.homeHeroLoadedSrc = backgroundUrl;
        }
        activate();
      } else {
        preloadHomeHeroBackdrop(backgroundUrl).then((loaded) => {
          if (token !== state.homeV14.heroBackdropSeq) return;
          if (loaded) {
            targetBackground.style.backgroundImage = homeHeroBackdropCss(backgroundUrl);
            targetBackground.dataset.homeHeroLoadedSrc = backgroundUrl;
            activate();
          }
        });
      }
      if (opts.resetTimer !== false) scheduleHomeHeroAutoplay();
      return true;
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopHomeHeroAutoplay();
      else scheduleHomeHeroAutoplay();
    });

    function renderHomeHero() {
      if (!isHomeRouteActive()) {
        stopHomeHeroAutoplay();
        return;
      }
      stopHomeHeroAutoplay();
      mergeHomeLatestIntoHeroFeed({ render: false });
      const slides = $("homeHeroSlides");
      const dots = $("homeHeroDots");
      if (!slides || !dots) return;
      const candidates = homeHeroCandidates();
      const previousItem = state.homeV14.heroItem;
      const previousIndex = Math.max(0, Number(state.homeV14.heroIndex || 0));
      const previousKey = previousItem && mediaRenderKey(previousItem);
      const previousCandidateIndex = previousKey ? candidates.findIndex((entry) => mediaRenderKey(entry) === previousKey) : -1;
      const nextIndex = previousCandidateIndex >= 0 ? previousCandidateIndex : previousIndex;
      const activeIndex = candidates.length ? Math.min(candidates.length - 1, nextIndex) : 0;
      const item = candidates[activeIndex] || null;
      state.homeV14.heroCandidateCount = candidates.length;
      const feed = homeHeroFeedState();
      state.homeV14.heroExtraTmdbRequestCount = Number(feed && feed.detailRequests || 0);
      state.homeV14.heroItems = candidates;
      state.homeV14.heroIndex = activeIndex;
      state.homeV14.heroItem = item;
      state.homeV14.heroBackdropSeq += 1;
      slides.replaceChildren(...candidates.map((entry, index) => {
        const slide = document.createElement("div");
        slide.className = "home-hero-slide" + (index === activeIndex ? " active" : "");
        slide.dataset.heroIndex = String(index);
        const bg = document.createElement("div");
        bg.className = "home-hero-slide-bg";
        const image = homeHeroBackdropUrl(entry);
        if (image) bg.style.backgroundImage = homeHeroBackdropCss(image);
        slide.appendChild(bg);
        return slide;
      }));
      dots.replaceChildren(...candidates.map((entry, index) => {
        const dot = document.createElement("span");
        dot.className = "home-hero-dot" + (index === activeIndex ? " active" : "");
        dot.dataset.heroIndex = String(index);
        return dot;
      }));
      updateHomeHeroPresentation(item);
      focusColdHomeHeroIfReady();
      scheduleHomeHeroAutoplay();
      ensureHomeHeroFeed();
    }

    function focusColdHomeHeroIfReady() {
      const home = state.homeV14;
      if (!home || !home.coldHomeFocusPending || !isTvLikeDevice() || !isHomeRouteActive()) return false;
      if (Number(home.coldHomeFocusEpoch || 0) !== homeFocusUserEpoch()) {
        home.coldHomeFocusPending = false;
        home.coldHomeFallbackTarget = null;
        return false;
      }
      const target = $("homeHero");
      if (!isVisibleFocusable(target)) return false;
      const active = document.activeElement;
      const fallbackTarget = home.coldHomeFallbackTarget;
      const isOwnedFallback = !!(fallbackTarget && active === fallbackTarget);
      if (isVisibleFocusable(active) && active !== document.body && active !== document.documentElement && !isOwnedFallback) {
        home.coldHomeFocusPending = false;
        home.coldHomeFallbackTarget = null;
        return false;
      }
      home.coldHomeFocusPending = false;
      home.coldHomeFallbackTarget = null;
      home.initialHomeFocusPending = false;
      state.remoteInitialFocused = true;
      focusRemoteTarget(target);
      return true;
    }
