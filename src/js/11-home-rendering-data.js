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
    const HOME_HERO_CACHE_TTL_MS = 45 * 60 * 1000;
    const HOME_HERO_DETAIL_CONCURRENCY = 5;

    function homeHeroFeedState() {
      const home = state.homeV14;
      if (!home) return null;
      if (!home.heroFeed) {
        home.heroFeed = {
          items: [], loading: false, loaded: false, loadedAt: 0, error: "",
          promise: null, requestSeq: 0, poolCount: 0, detailRequests: 0, weeklyMerged: false, sourceStats: null
        };
      }
      return home.heroFeed;
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

    function homeHeroNostrSignals() {
      const signals = new Map();
      filterBlocked(Array.isArray(state.hot && state.hot.items) ? state.hot.items : []).forEach((item) => {
        const identity = homeHeroIdentity(item);
        if (!identity) return;
        const heat = Math.max(0, Number(item.people || item.count || 0));
        signals.set(identity, { heat, rank: signals.size + 1 });
      });
      return signals;
    }

    function homeHeroNostrBoost(item, signals) {
      const signal = signals && signals.get(homeHeroIdentity(item));
      if (!signal) return 0;
      return Math.min(16, 4 + Math.log1p(signal.heat || 1) * 2.4);
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

    function homeHeroScore(item, signals) {
      const popularity = Math.min(160, Math.max(0, Number(item && item.popularity || 0)));
      const rating = Math.min(10, Math.max(0, Number(item && (item.voteAverage || item.vote_average) || 0)));
      const votes = Math.min(14, Math.log10(Math.max(1, Number(item && (item.voteCount || item.vote_count) || 0) + 1)) * 3.2);
      const freshness = homeHeroFreshnessScore(item);
      const backdrop = homeHeroBackdrop(item) ? 10 : 0;
      const nostr = homeHeroNostrBoost(item, signals);
      return popularity * 0.48 + rating * 2.7 + votes + freshness + backdrop + nostr;
    }

    function homeHeroRank(items, signals) {
      return (Array.isArray(items) ? items : [])
        .filter(homeHeroEligible)
        .map((item) => Object.assign({}, item, { heroScore: homeHeroScore(item, signals) }))
        .sort((a, b) => Number(b.heroScore || 0) - Number(a.heroScore || 0));
    }

    function homeHeroSelect(items, limit, signals) {
      const rankedItems = homeHeroRank(items, signals || homeHeroNostrSignals());
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

    function homeHeroFallbackCandidates() {
      const sources = [];
      if (Array.isArray(state.homeLatest && state.homeLatest.items)) {
        sources.push(...state.homeLatest.items.map((item) => Object.assign({}, item, { heroSourceKinds: ["weekly-feed"] })));
      }
      if (Array.isArray(state.fallback)) sources.push(...state.fallback);
      if (Array.isArray(state.searchHot && state.searchHot.items)) sources.push(...state.searchHot.items);
      sources.push(...allItems());
      return homeHeroSelect(uniqueMedia(filterBlocked(sources)), HOME_HERO_FINAL_LIMIT, homeHeroNostrSignals());
    }

    function mergeHomeLatestIntoHeroFeed(options) {
      const feed = homeHeroFeedState();
      if (!feed || feed.loading || !feed.loaded || feed.weeklyMerged || !state.homeLatest || !state.homeLatest.loaded) return false;
      feed.weeklyMerged = true;
      const weekly = filterBlocked(state.homeLatest.items || []).slice(0, 12);
      if (!weekly.length) return false;
      const next = homeHeroSelect((feed.items || []).concat(weekly), HOME_HERO_FINAL_LIMIT, homeHeroNostrSignals());
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
      enriched.landscape = homeHeroBackdropFromDetail(candidate, detail) || candidate.landscape || "";
      enriched.image = enriched.landscape || enriched.image || candidate.image || candidate.pic || "";
      enriched.voteCount = Number(detail && detail.vote_count || candidate.voteCount || 0);
      enriched.heroSourceKinds = candidate.heroSourceKinds || [];
      enriched.heroRaw = raw;
      enriched.heroDetail = detail || null;
      enriched.heroDetailEnriched = true;
      return enriched;
    }

    async function loadHomeHeroFeed() {
      const feed = homeHeroFeedState();
      if (!feed) return null;
      if (feed.loading) return feed.promise || feed;
      feed.loading = true;
      feed.error = "";
      const requestSeq = ++feed.requestSeq;
      const sources = [
        { kind: "tmdb-trending-week", endpoint: "trending/all/week", mediaType: "" },
        { kind: "tmdb-movie-now-playing", endpoint: "movie/now_playing", mediaType: "movie" },
        { kind: "tmdb-tv-on-the-air", endpoint: "tv/on_the_air", mediaType: "tv" }
      ];
      const promise = Promise.all(sources.map((source) => requestJson(tmdbUrl({
        id: "home-hero-source", title: "首页 Hero", endpoint: source.endpoint, mediaType: source.mediaType,
        params: { language: "zh-CN" }
      }), 18).then((body) => ({ source, body: body || {}, ok: true })).catch((error) => ({ source, body: null, ok: false, error })))).then(async (responses) => {
        if (feed.requestSeq !== requestSeq) return feed;
        const candidates = new Map();
        const sourceStats = {};
        let successCount = 0;
        responses.forEach((result) => {
          const source = result.source;
          const values = result.ok && result.body && Array.isArray(result.body.results) ? result.body.results : [];
          sourceStats[source.kind] = values.length;
          if (result.ok) successCount += 1;
          values.forEach((raw, index) => homeHeroMergeCandidate(candidates, homeHeroNormalizeSourceItem(raw, source, index)));
        });
        if (state.homeLatest && state.homeLatest.loaded) {
          filterBlocked(state.homeLatest.items || []).slice(0, 12).forEach((item) => {
            const candidate = Object.assign({}, item, { heroSourceKinds: ["weekly-feed"], heroRaw: item.weeklyDetail || item });
            homeHeroMergeCandidate(candidates, candidate);
          });
          sourceStats["weekly-feed"] = Math.min(12, (state.homeLatest.items || []).length);
        }
        const signals = homeHeroNostrSignals();
        const prefetch = homeHeroSelect(Array.from(candidates.values()), HOME_HERO_PREFETCH_LIMIT, signals);
        feed.poolCount = prefetch.length;
        const details = await weeklyMapLimit(prefetch, HOME_HERO_DETAIL_CONCURRENCY, (candidate) => homeHeroEnrichCandidate(candidate));
        feed.detailRequests = prefetch.length;
        const enriched = details.map((result, index) => result && result.ok && result.value ? result.value : prefetch[index]).filter(Boolean);
        let finalItems = homeHeroSelect(enriched, HOME_HERO_FINAL_LIMIT, signals);
        if (finalItems.length < HOME_HERO_FINAL_LIMIT) {
          finalItems = homeHeroSelect(finalItems.concat(homeHeroFallbackCandidates()), HOME_HERO_FINAL_LIMIT, signals);
        }
        feed.items = finalItems.slice(0, HOME_HERO_FINAL_LIMIT);
        feed.weeklyMerged = !!(state.homeLatest && state.homeLatest.loaded);
        feed.loaded = true;
        feed.loadedAt = Date.now();
        feed.loading = false;
        feed.error = feed.items.length || successCount ? "" : "加载失败";
        feed.sourceStats = Object.assign({ successCount, candidateCount: candidates.size }, sourceStats);
        if (isHomeRouteActive()) renderHomeHero();
        return feed;
      }).catch((error) => {
        if (feed.requestSeq !== requestSeq) return feed;
        feed.loading = false;
        feed.loaded = true;
        feed.loadedAt = Date.now();
        feed.error = String(error && error.message || "加载失败");
        feed.detailRequests = 0;
        if (!feed.items.length) feed.items = homeHeroFallbackCandidates();
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
      if (!feed || feed.loading) return false;
      if (feed.loaded && feed.loadedAt && Date.now() - feed.loadedAt < HOME_HERO_CACHE_TTL_MS) return false;
      loadHomeHeroFeed().catch(() => {});
      return true;
    }

    function homeHeroCandidates() {
      const feed = homeHeroFeedState();
      const cached = feed && filterBlocked(feed.items || []);
      return cached && cached.length
        ? homeHeroSelect(cached, HOME_HERO_FINAL_LIMIT, homeHeroNostrSignals()).slice(0, HOME_HERO_FINAL_LIMIT)
        : homeHeroFallbackCandidates();
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

    function homeNostrSignalKey(item) {
      const mediaType = String(item && (item.mediaType || item.media_type) || "").toLowerCase();
      const tmdbId = String(item && (item.tmdbId || item.tmdb_id) || "").trim();
      return (mediaType === "movie" || mediaType === "tv") && tmdbId ? `tmdb:${mediaType}:${tmdbId}` : "";
    }

    const HOME_CATEGORY_IDS = new Set(["movie", "tv", "anime", "documentary", "variety"]);

    function isHomeCategoryId(id) {
      return HOME_CATEGORY_IDS.has(normalizeLegacyCategoryId(id));
    }

    function homeCategoryEffectiveSource(id) {
      id = normalizeLegacyCategoryId(id);
      return id === "documentary" ? "tmdb" : homeHotSource();
    }

    function homeNostrHotSignature(id) {
      const items = Array.isArray(state.hot && state.hot.items) ? state.hot.items : [];
      const normalizedId = normalizeLegacyCategoryId(id);
      const scanLimit = normalizedId === "anime"
        ? SECONDARY_NOSTR_ANIME_MAX_SCAN_CANDIDATES
        : normalizedId === "variety"
          ? SECONDARY_NOSTR_VARIETY_MAX_SCAN_CANDIDATES
          : SECONDARY_NOSTR_HOT_MAX_SCAN_CANDIDATES;
      return items.slice(0, scanLimit).map((item, index) => [
        homeNostrSignalKey(item),
        Number(item && (item.people || item.count) || 0),
        String(item && (item.latest || item.lastEventAt || item.last_event_at) || ""),
        index
      ].join(":")).join("|");
    }

    function homeCategoryFeedKey(id) {
      id = normalizeLegacyCategoryId(id);
      const selectedSource = homeHotSource();
      const effectiveSource = homeCategoryEffectiveSource(id);
      const hotVersion = effectiveSource === "nostr" ? Number(state.hot && state.hot.version || 0) : 0;
      const hotSignature = effectiveSource === "nostr" ? homeNostrHotSignature(id) : "canonical";
      return JSON.stringify([id, selectedSource, effectiveSource, hotVersion, hotSignature]);
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
          nostrItems: [],
          tmdbItems: [],
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
        feed.source = homeCategoryEffectiveSource(id);
        feed.items = [];
        feed.nostrItems = [];
        feed.tmdbItems = [];
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
        feed.nostrItems = [];
        feed.tmdbItems = [];
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

    async function loadHomeCategoryNostrPool(id, feed, key, requestSeq, target) {
      if (!state.hot || !state.hot.ready) return [];
      const scanFilters = homeCategoryDefaultFilters();
      const knownQuery = { items: Array.isArray(feed && feed.tmdbItems) ? feed.tmdbItems : [] };
      if (normalizeLegacyCategoryId(id) === "anime") {
        return secondaryLoadNostrAnimePool(scanFilters, knownQuery, target, {
          isCurrent: () => homeCategoryFeedIsCurrent(feed, key, requestSeq),
          onProgress: (items) => commitHomeCategoryNostrItems(id, feed, key, requestSeq, items)
        });
      }
      if (normalizeLegacyCategoryId(id) === "variety") {
        return secondaryLoadNostrVarietyPool(scanFilters, knownQuery, target, {
          isCurrent: () => homeCategoryFeedIsCurrent(feed, key, requestSeq),
          onProgress: (items) => commitHomeCategoryNostrItems(id, feed, key, requestSeq, items)
        });
      }
      await ensureNostrTmdbMetaLoaded();
      const candidates = secondaryNostrHotCandidates(id);
      const qualified = [];
      let newDetailRequests = 0;
      for (let offset = 0; offset < candidates.length && qualified.length < target; offset += SECONDARY_NOSTR_HOT_BATCH_SIZE) {
        if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return qualified;
        const batch = candidates.slice(offset, offset + SECONDARY_NOSTR_HOT_BATCH_SIZE).filter((candidate) => {
          const needsDetail = secondaryNostrDetailRequestNeeded(candidate, id, knownQuery);
          if (needsDetail) {
            if (newDetailRequests >= SECONDARY_NOSTR_HOT_MAX_NEW_DETAIL_REQUESTS) return false;
            newDetailRequests += 1;
          }
          return true;
        });
        if (!batch.length) continue;
        const results = await weeklyMapLimit(batch, SECONDARY_NOSTR_HOT_DETAIL_CONCURRENCY, (candidate, index) => secondaryNostrEnrichCandidate(candidate, id, knownQuery, index));
        if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return qualified;
        results
          .filter((result) => result && result.ok && result.value && secondaryNostrHotFilterMatches(id, scanFilters, result.value))
          .map((result) => result.value)
          .slice(0, Math.max(0, target - qualified.length))
          .forEach((item) => qualified.push(item));
      }
      return uniqueMedia(qualified);
    }

    function commitHomeCategoryNostrItems(id, feed, key, requestSeq, items) {
      if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return false;
      const nostrItems = uniqueMedia(Array.isArray(items) ? items : []);
      feed.source = "nostr";
      feed.nostrItems = nostrItems;
      feed.items = filterBlocked(uniqueMedia(nostrItems.concat(Array.isArray(feed.tmdbItems) ? feed.tmdbItems : [])));
      feed.dataVersion = key;
      feed.signature = key;
      const section = Array.from(document.querySelectorAll("#listStack > .home-dynamic-section")).find((entry) => entry.dataset.homeListId === normalizeLegacyCategoryId(id));
      const config = homeSectionConfig().find((entry) => entry.listId === normalizeLegacyCategoryId(id));
      if (section && config) renderHomeDynamicSection(section, config);
      recordHomeV14Diag();
      return true;
    }

    function commitHomeCategoryTmdbItems(id, feed, key, requestSeq, items) {
      if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return false;
      const tmdbItems = uniqueMedia(Array.isArray(items) ? items : []);
      feed.source = "nostr";
      feed.tmdbItems = tmdbItems;
      feed.items = filterBlocked(uniqueMedia((Array.isArray(feed.nostrItems) ? feed.nostrItems : []).concat(tmdbItems)));
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
      const source = homeCategoryEffectiveSource(id);
      const task = Promise.resolve().then(async () => {
        let nostrItems = [];
        let tmdbResult = { items: [], error: "" };
        if (source === "nostr") {
          const progressiveTmdbPromise = id === "variety"
            ? loadHomeCategoryTmdbPool(id).then((result) => {
              if (homeCategoryFeedIsCurrent(feed, key, requestSeq)) commitHomeCategoryTmdbItems(id, feed, key, requestSeq, result && result.items || []);
              return result;
            })
            : null;
          nostrItems = await loadHomeCategoryNostrPool(id, feed, key, requestSeq, target);
          if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return feed;
          if (progressiveTmdbPromise) tmdbResult = await progressiveTmdbPromise;
          else if (nostrItems.length < target) tmdbResult = await loadHomeCategoryTmdbPool(id);
        } else {
          tmdbResult = await loadHomeCategoryTmdbPool(id);
        }
        if (!homeCategoryFeedIsCurrent(feed, key, requestSeq)) return feed;
        const tmdbItems = Array.isArray(tmdbResult.items) ? tmdbResult.items : [];
        const items = filterBlocked(uniqueMedia(nostrItems.concat(tmdbItems)));
        if (!items.length && tmdbResult.error && !nostrItems.length) throw new Error(tmdbResult.error);
        feed.source = source;
        feed.nostrItems = nostrItems;
        feed.tmdbItems = tmdbItems;
        feed.items = items;
        feed.loaded = true;
        feed.error = "";
        feed.dataVersion = key;
        feed.signature = key;
        return feed;
      }).catch((error) => {
        if (homeCategoryFeedIsCurrent(feed, key, requestSeq)) {
          const retainedTmdb = id === "variety" && Array.isArray(feed.tmdbItems) ? feed.tmdbItems : [];
          feed.loaded = true;
          feed.error = String(error && error.message || "加载失败");
          feed.items = filterBlocked(uniqueMedia(retainedTmdb));
          feed.nostrItems = [];
          feed.tmdbItems = retainedTmdb;
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
      const hasPartialItems = ["anime", "variety"].includes(config.listId) && !!(feed && Array.isArray(feed.items) && feed.items.length);
      const items = feed && (feed.loaded || hasPartialItems) ? feed.items : [];
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
        hotSource: homeHotSource(),
        hotRenderSource: homeRoot.querySelector("#recommendSection") && homeRoot.querySelector("#recommendSection").dataset.hotSource || "",
        hotRenderDataPath: homeRoot.querySelector("#recommendRail") && homeRoot.querySelector("#recommendRail").dataset.hotDataPath || "",
        hotCardCount: homeRoot.querySelectorAll("#recommendRail > .card").length,
        nostrAnime: home.secondaryNostrAnimeMetrics || null,
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
      renderHomeHot();
      renderHomeDynamicSections();
      ensureHomeResizeBinding();
      ensureHomeSectionObserver();
      observeHomeImages(homeRoot);
      requestAnimationFrame(updateHomeRails);
      recordHomeV14Diag();
    }

    function scheduleHomeContentRender(options) {
      const opts = options || {};
      const seq = ++state.homeContentSeq;
      if (state.homeContentTimer) {
        cancelAnimationFrame(state.homeContentTimer);
        state.homeContentTimer = 0;
      }
      const run = () => {
        if (seq !== state.homeContentSeq) return;
        state.homeContentTimer = 0;
        renderHomeContent();
        if (typeof opts.after === "function") opts.after();
      };
      if (!opts.afterPaint) {
        run();
        return;
      }
      state.homeContentTimer = requestAnimationFrame(() => {
        if (seq !== state.homeContentSeq) return;
        state.homeContentTimer = requestAnimationFrame(run);
      });
    }

    function scheduleRender() {
      clearTimeout(state.renderTimer);
      const delay = Date.now() < state.scrollingUntil ? 700 : 160;
      state.renderTimer = setTimeout(() => {
        if (Date.now() < state.scrollingUntil) {
          scheduleRender();
          return;
        }
        renderAll({ deferContent: uiSnapshotRoute() === "home" });
      }, delay);
    }

    function homeSectionDomId(listId) {
      return `homeSection-${String(listId || "section").replace(/[^a-zA-Z0-9_-]/g, "-")}`;
    }

    function isSearchHistoryEntry() {
      const current = window.history && window.history.state;
      return location.hash === "#search" && !!(current && current.sheet === "search");
    }

    function openSearchPage() {
      const form = $("searchForm");
      const host = $("searchPageFormHost");
      if (!form || !host) return false;
      if (isRecentManagePage() && recentManageRuntime().deleting) {
        toast("正在删除，请稍候");
        return true;
      }
      if (isRecentManagePage()) resetRecentManageState();
      if (homeUiRoute() === "search" && isSearchHistoryEntry()) return true;
      if (!isSearchHistoryEntry()) {
        if (location.hash === "#search" || history.state && history.state.sheet === "search") {
          history.replaceState({ sheet: "search" }, "", "#search");
        } else {
          history.pushState({ sheet: "search" }, "", "#search");
        }
      }
      state.homeV14.searchReturn = {
        scrollY: homeScrollTop(),
        focusId: "searchSubmitBtn",
        route: homeUiRoute(),
        activeList: state.activeList,
        searchRailScrollLeft: Number(($('searchRail') || {}).scrollLeft || 0),
        searchHotRailScrollLeft: Number(($('searchHotRail') || {}).scrollLeft || 0)
      };
      state.homeV14.route = "search";
      state.homeV14.searchHistoryBackPending = false;
      if (form.parentElement !== host) host.appendChild(form);
      form.hidden = false;
      ensureSearchPageOrder();
      setHomeOnlyPresentationVisible(false);
      if ($("listSection")) $("listSection").hidden = true;
      syncHomeRoutePresentation();
      renderSearch();
      scheduleUiSnapshotSave();
      requestAnimationFrame(() => {
        const input = $("searchInput");
        if (input) focusRemoteTarget(input);
        else focusRemoteTarget($("searchPageBack"));
      });
      return true;
    }

    function closeSearchPage() {
      if (homeUiRoute() !== "search") return false;
      state.homeV14.searchHistoryBackPending = false;
      const form = $("searchForm");
      const saved = state.homeV14.searchReturn || {};
      if (form) form.hidden = true;
      // Search is a presentation route over the single Home model. Older
      // snapshots could carry the removed live/recent Home routes; never
      // revive those routes when returning from Search.
      state.homeV14.route = "home";
      state.activeList = "all";
      state.homeV14.searchReturn = null;
      renderAll({ deferContent: false });
      const restore = () => {
        applyHomeScrollTop(Math.max(0, Number(saved.scrollY || 0)));
        const searchRail = $("searchRail");
        if (searchRail) searchRail.scrollLeft = Math.max(0, Number(saved.searchRailScrollLeft || 0));
        const searchHotRail = $("searchHotRail");
        if (searchHotRail) searchHotRail.scrollLeft = Math.max(0, Number(saved.searchHotRailScrollLeft || 0));
        const target = isVisibleFocusable($("homeSearchLauncher"))
          ? $("homeSearchLauncher")
          : isVisibleFocusable($("searchSubmitBtn")) ? $("searchSubmitBtn") : initialHomeFocus();
        if (target) focusRemoteTarget(target);
      };
      requestAnimationFrame(restore);
      scheduleUiSnapshotSave();
      return true;
    }

    function requestCloseSearchPage() {
      if (homeUiRoute() !== "search") return false;
      const homeV14 = state.homeV14;
      if (!homeV14) return false;
      if (homeV14.searchHistoryBackPending) return true;
      if (isSearchHistoryEntry()) {
        homeV14.searchHistoryBackPending = true;
        try {
          history.back();
          return true;
        } catch (e) {
          homeV14.searchHistoryBackPending = false;
        }
      }
      homeV14.searchHistoryBackPending = false;
      const closed = closeSearchPage();
      if (closed && (location.hash === "#search" || history.state && history.state.sheet === "search")) {
        history.replaceState({ sheet: "home" }, "", location.pathname + location.search);
      }
      return closed;
    }

    const SECONDARY_GENRE_LABELS = { "12": "冒险", "14": "奇幻", "16": "动画", "18": "剧情", "27": "恐怖", "28": "动作", "35": "喜剧", "36": "历史", "37": "西部", "53": "惊悚", "80": "犯罪", "99": "纪录片", "878": "科幻", "9648": "悬疑", "10402": "音乐", "10749": "爱情", "10751": "家庭", "10752": "战争", "10759": "动作冒险", "10762": "儿童", "10763": "新闻", "10764": "真人秀", "10765": "科幻奇幻", "10766": "肥皂剧", "10767": "脱口秀", "10768": "战争政治" };
    const SECONDARY_REGION_LABELS = { CN: "中国大陆", "HK|TW": "港台", HK: "香港", TW: "台湾", US: "美国", GB: "英国", JP: "日本", KR: "韩国", AU: "澳大利亚", CA: "加拿大", FR: "法国", DE: "德国", IN: "印度" };
    // Keep Secondary controls useful without probing every option.  Movie
    // and TV genre IDs are deliberately separate; the underlying TMDB
    // discover source remains responsible for applying the selected value.
    const SECONDARY_MOVIE_GENRE_IDS = ["28", "12", "16", "18", "35", "27", "53", "80", "878", "9648", "10749", "10751", "10752", "99", "10402"];
    const SECONDARY_TV_GENRE_IDS = ["18", "35", "80", "9648", "10749", "10751", "10759", "10765"];
    const SECONDARY_REGION_IDS = ["CN", "HK", "TW", "US", "GB", "JP", "KR", "AU", "CA", "FR", "DE", "IN"];
    const SECONDARY_TV_REGION_IDS = ["CN", "HK", "TW", "KR", "JP", "US", "GB"];
    const SECONDARY_ANIMATION_REGION_IDS = ["CN", "JP"];
    const SECONDARY_VARIETY_REGION_IDS = ["CN", "HK|TW", "KR", "JP"];
    const SECONDARY_FILTER_SCHEMA = {
      "now-playing": [],
      movie: ["genre", "region", "year", "sort"],
      tv: ["genre", "region", "year", "sort"],
      anime: ["region", "year", "sort"],
      documentary: ["year", "sort"],
      variety: ["region", "year"]
    };

