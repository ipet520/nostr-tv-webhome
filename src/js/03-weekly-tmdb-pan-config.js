
    function cacheKey(type) {
      if (type === "events") return window.WEBHOME_CONFIG.nostr.eventsKey || "fish2018_home_v1_events";
      if (type === "nsec") return window.WEBHOME_CONFIG.nostr.nsecKey || "fish2018_home_v1_nsec";
      if (type === "pan") return window.WEBHOME_CONFIG.pan.cacheKey || "fish2018_home_v1_pan_config";
      if (type === "ui") return "fish2018_home_v1_ui_snapshot";
      if (type === "uiPrefs") return "fish2018_home_v1_ui_prefs";
      if (type === "deleteState") return "fish2018_home_v1_delete_state";
      if (type === "blockedRecommend") return "fish2018_home_v1_blocked_recommend";
      if (type === "tmdb") return "fish2018_home_v1_tmdb_config";
      if (type === "historyContext") return "fish2018_home_v1_history_context";
      if (type === "continueIndex") return "fish2018_home_v1_continue_index";
      if (type === "homeWeekly") return "fish2018_home_v1_home_weekly";
      if (type === "nostrTmdbMeta") return "fish2018_home_v1_nostr_tmdb_meta";
      return type;
    }

    function sanitizeUiPrefs(value) {
      const raw = value && typeof value === "object" ? value : {};
      const source = raw.homeHotSource === "nostr" ? "nostr" : "tmdb";
      return { homeFullscreenEnabled: raw.homeFullscreenEnabled === false ? false : true, homeHotSource: source };
    }

    function applyUiPrefs() {
      const prefs = sanitizeUiPrefs(state.uiPrefs || {});
      state.uiPrefs = Object.assign({ loaded: state.uiPrefs && state.uiPrefs.loaded }, prefs);
      renderUiPrefsControls();
      if ($("detailSheet") && $("detailSheet").classList.contains("active")) {
        resetDetailCoverFrame($("detailImage") && $("detailImage").parentElement);
        scheduleDetailTextClamp();
        updateMobileDetailBackButton();
      }
    }

    async function initUiPrefs(options) {
      options = options || {};
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(options.timeout == null ? 1500 : options.timeout);
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(cacheKey("uiPrefs")), null); } catch (e) { saved = null; }
      state.uiPrefs = Object.assign({ loaded: true }, sanitizeUiPrefs(saved));
      applyUiPrefs();
    }

    function renderUiPrefsControls() {
      const fullscreen = isHomeFullscreenEnabled() ? "on" : "off";
      document.querySelectorAll("[data-home-fullscreen]").forEach((button) => {
        const active = button.dataset.homeFullscreen === fullscreen;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
      const source = homeHotSource();
      document.querySelectorAll("[data-home-hot-source]").forEach((button) => {
        const active = button.dataset.homeHotSource === source;
        button.classList.toggle("active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
      });
    }

    function homeHotSource() {
      return state.uiPrefs && state.uiPrefs.homeHotSource === "nostr" ? "nostr" : "tmdb";
    }

    function resolveHomeHotItems() {
      const source = homeHotSource();
      if (source === "nostr") {
        return {
          source,
          items: filterBlocked(Array.isArray(state.hot && state.hot.items) ? state.hot.items : []),
          page: null,
          loading: !(state.hot && state.hot.ready),
          error: "",
          path: "state.hot.items"
        };
      }
      const page = state.searchHot || null;
      return {
        source,
        items: filterBlocked(page && page.items || []),
        page,
        loading: !!(page && page.loading),
        error: page && page.error || "",
        path: "state.searchHot.items"
      };
    }

    const HOME_WEEKLY_TV_DISCOVER_PAGES = 2;
    const HOME_WEEKLY_TV_CANDIDATE_LIMIT = 40;
    const HOME_WEEKLY_TV_LIMIT = 22;
    const HOME_WEEKLY_MOVIE_LIMIT = 6;
    const HOME_WEEKLY_TOTAL_LIMIT = 28;
    const HOME_WEEKLY_DETAIL_CONCURRENCY = 8;
    const HOME_WEEKLY_REFRESH_TTL_MS = 30 * 60 * 1000;
    const HOME_WEEKLY_TIMEZONE = "Asia/Shanghai";
    const MOVIE_DETAIL_CACHE_TTL_MS = 45 * 60 * 1000;
    const TV_DETAIL_CACHE_TTL_MS = 45 * 60 * 1000;
    const TV_CARD_DETAIL_CONCURRENCY = 3;
    const TV_CARD_DETAIL_ROOT_MARGIN = "560px 0px";

    function latestDateOnly(value) {
      const match = String(value == null ? "" : value).trim().match(/^(\d{4}-\d{2}-\d{2})/);
      if (!match) return "";
      const date = match[1];
      const parts = date.split("-").map((value) => Number(value));
      const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
      return Number.isNaN(parsed.getTime()) || parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() !== parts[1] - 1 || parsed.getUTCDate() !== parts[2] ? "" : date;
    }

    function isReleasedAsOfToday(item) {
      if (!item) return true;
      const values = [item.releaseDate, item.release_date, item.first_air_date, item.firstAirDate];
      let releaseDate = "";
      for (let index = 0; index < values.length; index++) {
        const parsed = latestDateOnly(values[index]);
        if (parsed) { releaseDate = parsed; break; }
      }
      return !releaseDate || releaseDate <= today();
    }

    function detailUnreleasedInfo(item) {
      const mediaType = String(item && (item.mediaType || item.media_type) || "").toLowerCase();
      if (mediaType !== "movie" && mediaType !== "tv") return { mediaType, date: "", unreleased: false };
      if (mediaType === "movie") {
        const movieDate = latestDateOnly(item.releaseDate) || latestDateOnly(item.release_date);
        return { mediaType, date: movieDate, unreleased: !!movieDate && movieDate > today() };
      }
      const firstAirDate = latestDateOnly(item.firstAirDate) || latestDateOnly(item.first_air_date);
      const releaseDate = latestDateOnly(item.releaseDate) || latestDateOnly(item.release_date);
      const normalizedNextEpisodeDate = latestDateOnly(item.weeklyNextEpisodeDate)
        || latestDateOnly(item.weeklyNextEpisode && item.weeklyNextEpisode.air_date);
      const date = firstAirDate || (releaseDate && releaseDate === normalizedNextEpisodeDate ? "" : releaseDate);
      return { mediaType, date, unreleased: !!date && date > today() };
    }

    function isReleaseFilteredCatalogId(id) {
      // Movie catalogues intentionally include announced/future releases.
      // Keep the existing release-date guard for recommendation/all, TV,
      // anime and variety paths only.
      return ["all", "tv", "anime", "variety"].includes(String(id || ""));
    }

    function filterReleasedCatalogItems(id, items) {
      const source = Array.isArray(items) ? items : [];
      return isReleaseFilteredCatalogId(id) ? source.filter(isReleasedAsOfToday) : source;
    }

    function latestIdentity(item) {
      if (!item) return "";
      let mediaType = String(item.mediaType || item.media_type || "").toLowerCase();
      let tmdbId = String(item.tmdbId || "").trim();
      if ((!mediaType || !tmdbId) && /^tmdb:(movie|tv):[^:]+$/i.test(String(item.id || ""))) {
        const parts = String(item.id).split(":");
        mediaType = mediaType || String(parts[1] || "").toLowerCase();
        tmdbId = tmdbId || String(parts.slice(2).join(":") || "").trim();
      }
      return (mediaType === "movie" || mediaType === "tv") && tmdbId ? `${mediaType}:${tmdbId}` : "";
    }

    function weeklyShanghaiToday() {
      try {
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: HOME_WEEKLY_TIMEZONE,
          year: "numeric",
          month: "2-digit",
          day: "2-digit"
        }).formatToParts(new Date());
        const values = parts.reduce((result, part) => {
          if (part && part.type) result[part.type] = part.value;
          return result;
        }, {});
        const value = `${values.year || ""}-${values.month || ""}-${values.day || ""}`;
        return latestDateOnly(value) || today();
      } catch (e) {
        return today();
      }
    }

    function weeklyAddDays(dateValue, amount) {
      const date = new Date(`${latestDateOnly(dateValue) || today()}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() + Number(amount || 0));
      return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
    }

    function weeklyDateRange() {
      const todayValue = weeklyShanghaiToday();
      const weekday = new Date(`${todayValue}T00:00:00Z`).getUTCDay();
      const start = weeklyAddDays(todayValue, -((weekday + 6) % 7));
      return { start, today: todayValue, tomorrow: weeklyAddDays(todayValue, 1), end: weeklyAddDays(start, 6), timezone: HOME_WEEKLY_TIMEZONE };
    }

    function weeklyDateInRange(value, from, to) {
      const date = latestDateOnly(value);
      return !!date && date >= from && date <= to;
    }

    function weeklyEpisodeCode(episode) {
      if (!episode) return "";
      const season = Number(episode.season_number);
      const number = Number(episode.episode_number);
      const seasonText = Number.isFinite(season) ? `S${String(season).padStart(2, "0")}` : "";
      const episodeText = Number.isFinite(number) ? `E${String(number).padStart(2, "0")}` : "";
      return `${seasonText}${episodeText}`;
    }

    function weeklyDateLabel(value) {
      const date = latestDateOnly(value);
      if (!date) return "";
      const parts = date.split("-");
      return `${Number(parts[1])}月${Number(parts[2])}日`;
    }

    function movieReleaseStatusText(item, weeklyText) {
      if (!item || String(item.mediaType || item.media_type || "").toLowerCase() !== "movie") return "";
      if (String(weeklyText == null ? item.weeklyUpdateText || "" : weeklyText).trim()) return "";
      const releaseDate = latestDateOnly(item.releaseDate || item.release_date || "");
      if (!releaseDate) return "";
      const currentDate = today();
      if (releaseDate <= currentDate) return "已上映";
      const parts = releaseDate.split("-");
      const year = Number(parts[0]);
      const month = Number(parts[1]);
      const day = Number(parts[2]);
      const currentYear = Number(currentDate.slice(0, 4));
      return year === currentYear
        ? `${month}月${day}日上映`
        : `${year}年${month}月${day}日上映`;
    }

    function weeklyWeekdayLabel(value) {
      const date = latestDateOnly(value);
      if (!date) return "";
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      return ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][weekday] || "";
    }

    function weeklyGenreText(item) {
      const labels = typeof SECONDARY_GENRE_LABELS === "object" ? SECONDARY_GENRE_LABELS : {};
      return (Array.isArray(item && item.genreIds) ? item.genreIds : [])
        .map((id) => labels[String(id)] || "")
        .filter(Boolean)
        .slice(0, 2)
        .join(" / ");
    }

    function weeklyGenreIds(item) {
      if (!item) return [];
      const values = [];
      if (Array.isArray(item.genreIds)) values.push(...item.genreIds);
      if (Array.isArray(item.genre_ids)) values.push(...item.genre_ids);
      if (Array.isArray(item.genres)) item.genres.forEach((genre) => {
        if (genre && genre.id != null) values.push(genre.id);
      });
      return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
    }

    function weeklyContentCategory(item, mediaType) {
      const type = String(mediaType || item && (item.media_type || item.mediaType) || "").toLowerCase();
      const genres = new Set(weeklyGenreIds(item));
      const excluded = type === "tv"
        ? ["99", "10763", "10764", "10766", "10767"]
        : ["99"];
      if (excluded.some((id) => genres.has(id))) return "";
      if (genres.has("16")) return "anime";
      return type === "tv" ? "tv" : type === "movie" ? "movie" : "";
    }

    function weeklyMetaText(item) {
      const type = item && item.weeklyCategory === "anime" ? "动画" : item && item.mediaType === "tv" ? "电视剧" : "电影";
      const year = String(item && (item.firstAirDate || item.releaseDate) || "").slice(0, 4);
      const genres = weeklyGenreText(item);
      return [year, genres || type].filter(Boolean).join(" · ");
    }

    function weeklyUpdateText(item, range) {
      const current = range || weeklyDateRange();
      if (!item || item.mediaType !== "tv") {
        return `本周新片${item && item.releaseDate ? ` · ${weeklyDateLabel(item.releaseDate)}上映` : ""}`;
      }
      const last = item.weeklyLastEpisode;
      const next = item.weeklyNextEpisode;
      const lastDate = latestDateOnly(last && last.air_date);
      const nextDate = latestDateOnly(next && next.air_date);
      if (lastDate === current.today) return `${weeklyEpisodeCode(last) || "最新一集"} · 今天更新`;
      if (nextDate === current.today) return `${weeklyEpisodeCode(next) || "下一集"} · 今天更新`;
      if (weeklyDateInRange(lastDate, current.start, current.today)) return `更新至${weeklyEpisodeCode(last) || "最新一集"} · ${weeklyDateLabel(lastDate)}更新`;
      if (weeklyDateInRange(nextDate, current.tomorrow, current.end)) return `${weeklyEpisodeCode(next) || "下一集"} · ${weeklyWeekdayLabel(nextDate)}更新`;
      return "本周更新";
    }

    function weeklyClassifyTv(detail, range) {
      const lastDate = latestDateOnly(detail && detail.last_episode_to_air && detail.last_episode_to_air.air_date);
      const nextDate = latestDateOnly(detail && detail.next_episode_to_air && detail.next_episode_to_air.air_date);
      const updated = weeklyDateInRange(lastDate, range.start, range.today);
      const todayUpdate = lastDate === range.today || nextDate === range.today;
      const upcoming = weeklyDateInRange(nextDate, range.tomorrow, range.end);
      const category = weeklyContentCategory(detail, "tv");
      return {
        updated,
        todayUpdate,
        upcoming,
        category,
        keep: !!category && (updated || todayUpdate || upcoming),
        status: todayUpdate ? "today" : updated ? "updated" : upcoming ? "upcoming" : ""
      };
    }

    async function weeklyMapLimit(items, limit, worker, onResult) {
      const values = Array.isArray(items) ? items : [];
      const results = new Array(values.length);
      let cursor = 0;
      const run = async () => {
        while (true) {
          const index = cursor++;
          if (index >= values.length) return;
          try {
            results[index] = { ok: true, value: await worker(values[index], index) };
          } catch (error) {
            results[index] = { ok: false, error };
          }
          if (typeof onResult === "function") {
            try { onResult(results[index], values[index], index); } catch (e) {}
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(Math.max(1, Number(limit || 1)), values.length) }, () => run()));
      return results;
    }

    function weeklySourceIdentity(item, mediaType) {
      const type = String(mediaType || item && (item.media_type || item.mediaType) || "").toLowerCase();
      const id = String(item && item.id || item && item.tmdbId || "").trim();
      return type && id ? `${type}:${id}` : "";
    }

    function weeklyItemDate(item) {
      return latestDateOnly(item && (item.weeklyLastEpisodeDate || item.weeklyNextEpisodeDate || item.releaseDate || item.firstAirDate)) || "";
    }

    function sortWeeklyItems(items) {
      const order = { today: 0, updated: 1, upcoming: 2, movie: 3 };
      return (Array.isArray(items) ? items : []).slice().sort((a, b) => {
        const orderDelta = Number(order[a && a.weeklyStatus] == null ? 9 : order[a.weeklyStatus]) - Number(order[b && b.weeklyStatus] == null ? 9 : order[b.weeklyStatus]);
        if (orderDelta) return orderDelta;
        const dateDelta = weeklyItemDate(b).localeCompare(weeklyItemDate(a));
        if (dateDelta) return dateDelta;
        return Number(b && b.popularity || 0) - Number(a && a.popularity || 0);
      });
    }

    function homeLatestSources() {
      const range = weeklyDateRange();
      const regions = [
        { key: "zh", language: "zh", country: "CN|HK|TW", requestLanguage: "zh-CN" },
        { key: "ko", language: "ko", country: "KR", requestLanguage: "zh-CN" },
        { key: "ja", language: "ja", country: "JP", requestLanguage: "zh-CN" },
        { key: "en", language: "en", country: "US|GB|CA|AU", requestLanguage: "zh-CN" }
      ];
      const sources = [];
      regions.forEach((region) => {
        for (let page = 1; page <= HOME_WEEKLY_TV_DISCOVER_PAGES; page++) {
          sources.push({
            key: `tv-${region.key}-${page}`,
            kind: "tv-discover",
            id: `home-weekly-tv-${region.key}-${page}`,
            title: "本周更新",
            endpoint: "discover/tv",
            mediaType: "tv",
            page,
            region: region.key,
            params: {
              air_date_gte: range.start,
              air_date_lte: range.end,
              timezone: HOME_WEEKLY_TIMEZONE,
              with_original_language: region.language,
              with_origin_country: region.country,
              sort_by: "popularity.desc",
              include_null_first_air_dates: "false",
              language: region.requestLanguage
            }
          });
        }
      });
      [1, 2].forEach((page) => sources.push({
        key: `movie-now-playing-${page}`,
        kind: "movie-now-playing",
        id: `home-weekly-movie-now-playing-${page}`,
        title: "本周更新",
        endpoint: "movie/now_playing",
        mediaType: "movie",
        page,
        params: { language: "zh-CN" }
      }));
      [1, 2].forEach((page) => sources.push({
        key: `movie-discover-${page}`,
        kind: "movie-discover",
        id: `home-weekly-movie-discover-${page}`,
        title: "本周更新",
        endpoint: "discover/movie",
        mediaType: "movie",
        page,
        params: {
          primary_release_date_gte: range.start,
          primary_release_date_lte: range.end,
          sort_by: "popularity.desc",
          include_adult: "false",
          language: "zh-CN"
        }
      }));
      return sources;
    }

    function recordHomeLatestDiag(diag) {
      const value = Object.assign({ source: "weekly-feed" }, diag || {});
      state.homeLatest.diag = value;
      state.tvDiag.homeLatest = value;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV][HOME_WEEKLY_DIAG]", JSON.stringify(value)); } catch (e) {}
      }
      return value;
    }

    function homeLatestHasItems(latest) {
      return !!(latest && Array.isArray(latest.items) && latest.items.length);
    }

    function homeLatestSnapshotIsCurrent(latest) {
      const currentWeekStart = weeklyDateRange().start;
      return !(latest && latest.range && latest.range.start && latest.range.start !== currentWeekStart);
    }

    function publishHomeWeeklySnapshot(source, options) {
      const latest = state.homeLatest;
      if (!latest || !homeLatestHasItems(latest)) return false;
      if (homeUiRoute() !== "secondary" || state.homeV14.secondaryListId !== "now-playing") return false;
      const query = secondaryActiveQuery("now-playing") || secondaryGetQuery("now-playing");
      if (!query) return false;
      const opts = options || {};
      const refreshing = opts.refreshing == null ? !!latest.loading : !!opts.refreshing;
      const final = opts.final === true || !refreshing;
      const items = filterBlocked(latest.items || []);
      query.items = items.slice();
      query.totalResults = items.length;
      query.totalPages = 1;
      query.page = 1;
      query.hasMore = false;
      query.finite = true;
      query.snapshotReady = true;
      query.snapshotSource = String(source || "memory");
      query.loading = !final && refreshing;
      query.loaded = final;
      query.error = final ? String(latest.error || "") : "";
      query.serverSideFilters = [];
      query.clientSideFilters = [];
      query.endpointMap = ["discover/tv", "tv/{id}", "movie/now_playing", "discover/movie"];
      query.sourceStates = [];
      state.homeV14.secondaryPage = 1;
      if (!Number(latest.firstRenderableAt || 0)) latest.firstRenderableAt = Date.now();
      recordHomeLatestDiag(Object.assign({}, latest.diag || {}, {
        snapshotReady: true,
        snapshotSource: query.snapshotSource,
        firstRenderableMs: latest.refreshStartedAt ? Math.max(0, latest.firstRenderableAt - latest.refreshStartedAt) : 0,
        refreshStillRunning: !!latest.loading
      }));
      renderSecondaryCatalog();
      return true;
    }

    function homeLatestCacheAge(latest) {
      const savedAt = Number(latest && latest.cacheSavedAt || 0);
      return savedAt > 0 ? Math.max(0, Date.now() - savedAt) : 0;
    }

    async function hydrateHomeLatestCache(latest, range) {
      if (!latest || !range) return false;
      if (latest.cacheChecked && latest.cacheWeekStart === range.start) return !!latest.cacheHydrated;
      latest.cacheChecked = true;
      latest.cacheWeekStart = range.start;
      latest.cacheHydrated = false;
      latest.cacheSavedAt = 0;
      latest.cacheItemCount = 0;
      latest.cacheHydratedAt = 0;
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(cacheKey("homeWeekly")), null); } catch (e) { saved = null; }
      const valid = !!(saved && Number(saved.version) === 4
        && String(saved.weekStart || "") === String(range.start || "")
        && Array.isArray(saved.items) && saved.items.length);
      if (!valid) return false;
      const items = saved.items
        .map((item) => item && typeof item === "object" ? Object.assign({}, item) : null)
        .filter(Boolean);
      if (!items.length) return false;
      latest.items = items;
      latest.range = range;
      latest.loaded = false;
      latest.error = "";
      latest.cacheHydrated = true;
      latest.cacheSavedAt = Number(saved.savedAt || 0) > 0 ? Number(saved.savedAt) : 0;
      latest.cacheItemCount = items.length;
      latest.cacheHydratedAt = Date.now();
      recordHomeLatestDiag({
        cacheHit: true,
        cacheAgeMs: homeLatestCacheAge(latest),
        cacheItemCount: items.length,
        cacheHydratedAt: latest.cacheHydratedAt,
        networkRefresh: false,
        networkRefreshSucceeded: false,
        networkRefreshReason: "cold-start"
      });
      publishHomeWeeklySnapshot("cache", { refreshing: !!latest.loading });
      if (isHomeRouteActive()) {
        renderHomeHot();
      }
      return true;
    }

    async function persistHomeLatestCache(latest, range) {
      if (!latest || !range || !homeLatestHasItems(latest)) return false;
      const snapshot = {
        version: 4,
        weekStart: range.start,
        savedAt: Date.now(),
        items: latest.items.map((item) => Object.assign({}, item))
      };
      try {
        await sdk().cache.set(cacheKey("homeWeekly"), JSON.stringify(snapshot));
        latest.cacheSavedAt = snapshot.savedAt;
        latest.cacheWeekStart = range.start;
        latest.cacheItemCount = snapshot.items.length;
        return true;
      } catch (e) {
        return false;
      }
    }

    function homeLatestRefreshReason(latest) {
      if (latest && Number(latest.loadedAt || 0) > 0) return "ttl-expired";
      if (latest && latest.cacheHydrated) return "cold-start";
      if (latest && Number(latest.lastRefreshAt || 0) > 0) return "retry";
      return "no-cache";
    }

    async function loadHomeLatest() {
      const latest = state.homeLatest;
      if (!latest) return latest;
      if (latest.loading) return latest.promise || latest;
      const currentWeekStart = weeklyDateRange().start;
      const weekChanged = !!(latest.range && latest.range.start && latest.range.start !== currentWeekStart);
      const ageFromNetwork = latest.loadedAt > 0 ? Math.max(0, Date.now() - latest.loadedAt) : Infinity;
      const ageFromAttempt = latest.lastRefreshAt > 0 ? Math.max(0, Date.now() - latest.lastRefreshAt) : Infinity;
      if (!weekChanged && latest.loadedAt > 0 && ageFromNetwork < HOME_WEEKLY_REFRESH_TTL_MS) return latest;
      if (!weekChanged && !latest.loadedAt && latest.loaded && latest.lastRefreshAt > 0 && ageFromAttempt < HOME_WEEKLY_REFRESH_TTL_MS) return latest;
      if (!weekChanged && !latest.networkRefreshSucceeded && latest.loaded && latest.lastRefreshAt > 0 && ageFromAttempt < HOME_WEEKLY_REFRESH_TTL_MS) return latest;
      latest.refreshStartedAt = Date.now();
      latest.firstRenderableAt = 0;
      const promise = Promise.resolve().then(() => loadHomeLatestInternal(latest)).catch((error) => {
        const hasItems = homeLatestHasItems(latest);
        latest.loading = false;
        latest.loaded = true;
        latest.error = hasItems ? "" : "加载失败";
        latest.networkRefreshSucceeded = false;
        recordHomeLatestDiag({
          cacheHit: !!latest.cacheHydrated,
          cacheAgeMs: homeLatestCacheAge(latest),
          cacheItemCount: latest.cacheItemCount || 0,
          cacheHydratedAt: latest.cacheHydratedAt || 0,
          networkRefresh: true,
          networkRefreshSucceeded: false,
          networkRefreshDurationMs: latest.lastRefreshAt ? Math.max(0, Date.now() - latest.lastRefreshAt) : 0,
          networkRefreshReason: latest.networkRefreshReason || "no-cache",
          refreshFailure: true,
          error: String(error && error.message || "加载失败")
        });
        publishHomeWeeklySnapshot("network-final", { final: true, refreshing: false });
        throw error;
      });
      latest.promise = promise;
      promise.then(() => {
        if (latest.promise === promise) latest.promise = null;
      }, () => {
        if (latest.promise === promise) latest.promise = null;
      });
      return promise;
    }

    async function loadHomeLatestInternal(latest) {
      latest.loading = true;
      latest.error = "";
      const requestSeq = ++latest.requestSeq;
      const range = weeklyDateRange();
      if (latest.range && latest.range.start && latest.range.start !== range.start) {
        latest.items = [];
        latest.loaded = false;
        latest.loadedAt = 0;
        latest.lastRefreshAt = 0;
        latest.cacheChecked = false;
        latest.cacheHydrated = false;
        latest.cacheWeekStart = "";
        latest.cacheSavedAt = 0;
        latest.cacheItemCount = 0;
        latest.cacheHydratedAt = 0;
        latest.networkRefreshReason = "";
        latest.networkRefreshSucceeded = false;
      }
      latest.range = range;
      const refreshReason = homeLatestRefreshReason(latest);
      latest.lastRefreshAt = Date.now();
      await hydrateHomeLatestCache(latest, range);
      if (latest.requestSeq !== requestSeq) return latest;
      const hadExistingSnapshot = homeLatestHasItems(latest);
      latest.networkRefreshReason = latest.cacheHydrated ? "cold-start" : refreshReason;
      if (isHomeRouteActive()) renderHomeHot();
      const networkStartedAt = Date.now();
      latest.lastRefreshAt = networkStartedAt;
      const sources = homeLatestSources();
      const responses = await Promise.all(sources.map((source) => Promise.resolve()
        .then(() => requestJson(tmdbUrl(source, source.page || 1), 18))
        .then((body) => ({ source, body: body || {}, error: null }))
        .catch((error) => ({ source, body: null, error }))));
      if (latest.requestSeq !== requestSeq) return latest;
      const tvCandidatesById = new Map();
      const movieCandidatesById = new Map();
      const counts = { tvDiscoverResponses: 0, tvDiscoverCandidateCount: 0, movieNowPlayingCandidateCount: 0, movieDiscoverCandidateCount: 0, tvDetailSuccessCount: 0, tvDetailFailureCount: 0 };
      let goodCount = 0;
      responses.forEach(({ source, body, error }) => {
        if (error || !body) return;
        goodCount += 1;
        const values = Array.isArray(body.results) ? body.results : [];
        if (source.kind === "tv-discover") {
          counts.tvDiscoverResponses += 1;
          values.forEach((item) => {
            const key = weeklySourceIdentity(item, "tv");
            if (!key) return;
            const candidate = Object.assign({}, item, { media_type: "tv", weeklyRegion: source.region });
            const previous = tvCandidatesById.get(key);
            if (!previous || Number(candidate.popularity || 0) > Number(previous.popularity || 0)) tvCandidatesById.set(key, candidate);
          });
        } else {
          values.forEach((item) => {
            const key = weeklySourceIdentity(item, "movie");
            if (!key) return;
            const candidate = Object.assign({}, item, { media_type: "movie", weeklyMovieSource: source.kind });
            const previous = movieCandidatesById.get(key);
            if (!previous || Number(candidate.popularity || 0) > Number(previous.popularity || 0)) movieCandidatesById.set(key, candidate);
          });
          counts[source.kind === "movie-discover" ? "movieDiscoverCandidateCount" : "movieNowPlayingCandidateCount"] += values.length;
        }
      });
      const tvCandidates = Array.from(tvCandidatesById.values()).sort((a, b) => Number(b.popularity || 0) - Number(a.popularity || 0)).slice(0, HOME_WEEKLY_TV_CANDIDATE_LIMIT);
      counts.tvDiscoverCandidateCount = tvCandidates.length;
      const tvItems = [];
      const publishColdWeeklyPartial = () => {
        if (hadExistingSnapshot || !tvItems.length) return;
        const partialItems = sortWeeklyItems(tvItems).slice(0, HOME_WEEKLY_TV_LIMIT);
        if (!partialItems.length) return;
        latest.items = partialItems;
        publishHomeWeeklySnapshot("network-partial", { refreshing: true });
      };
      const handleTvDetailResult = (result, candidate) => {
        if (!result || !result.ok || !result.value) {
          counts.tvDetailFailureCount += 1;
          return;
        }
        counts.tvDetailSuccessCount += 1;
        const detail = result.value;
        const merged = mergeTmdbLocalizedEnrichment(candidate, detail, "tv");
        merged.id = detail.id || candidate.id;
        merged.media_type = "tv";
        const classification = weeklyClassifyTv(merged, range);
        if (!classification.keep) return;
        if (!merged.poster_path) merged.poster_path = candidate.poster_path || "";
        if (!merged.backdrop_path) merged.backdrop_path = candidate.backdrop_path || "";
        if (!merged.name) merged.name = candidate.name || candidate.original_name || "未命名";
        const item = normalizeTmdb(merged, { id: "weekly", title: "本周更新", mediaType: "tv" }, tvItems.length);
        item.firstAirDate = latestDateOnly(detail.first_air_date || candidate.first_air_date);
        item.weeklyLastEpisode = detail.last_episode_to_air || null;
        item.weeklyNextEpisode = detail.next_episode_to_air || null;
        item.weeklyLastEpisodeDate = latestDateOnly(item.weeklyLastEpisode && item.weeklyLastEpisode.air_date);
        item.weeklyNextEpisodeDate = latestDateOnly(item.weeklyNextEpisode && item.weeklyNextEpisode.air_date);
        item.releaseDate = item.weeklyLastEpisodeDate || item.weeklyNextEpisodeDate || item.firstAirDate || "";
        item.weeklyCategory = classification.category;
        item.weeklyStatus = classification.status;
        item.weeklyUpdateText = weeklyUpdateText(item, range);
        item.weeklyMetaText = weeklyMetaText(item);
        item.weeklyDetail = detail;
        if (hasPoster(item) && latestIdentity(item)) {
          tvItems.push(item);
          if (tvItems.length === 1 || tvItems.length % 4 === 0) publishColdWeeklyPartial();
        }
      };
      await weeklyMapLimit(tvCandidates, HOME_WEEKLY_DETAIL_CONCURRENCY, (candidate) => requestTvDetailShared(candidate), handleTvDetailResult);
      const movieItemsById = new Map();
      Array.from(movieCandidatesById.values()).forEach((raw, index) => {
        const releaseDate = latestDateOnly(raw.release_date);
        if (!weeklyDateInRange(releaseDate, range.start, range.end)) return;
        const weeklyCategory = weeklyContentCategory(raw, "movie");
        if (!weeklyCategory) return;
        const item = normalizeTmdb(raw, { id: "weekly", title: "本周更新", mediaType: "movie" }, index);
        item.releaseDate = releaseDate;
        item.weeklyCategory = weeklyCategory;
        item.weeklyStatus = "movie";
        item.weeklyUpdateText = weeklyUpdateText(item, range);
        item.weeklyMetaText = weeklyMetaText(item);
        if (hasPoster(item) && latestIdentity(item)) movieItemsById.set(latestIdentity(item), item);
      });
      const sortedTv = sortWeeklyItems(tvItems).slice(0, HOME_WEEKLY_TV_LIMIT);
      const remainingMovieSlots = Math.max(0, HOME_WEEKLY_TOTAL_LIMIT - sortedTv.length);
      const sortedMovies = sortWeeklyItems(Array.from(movieItemsById.values())).slice(0, Math.min(HOME_WEEKLY_MOVIE_LIMIT, remainingMovieSlots));
      const nextItems = sortedTv.concat(sortedMovies);
      if (!hadExistingSnapshot && nextItems.length && !homeLatestHasItems(latest)) {
        latest.items = nextItems.slice();
        publishHomeWeeklySnapshot("network-partial", { refreshing: true });
      }
      const hadExistingItems = hadExistingSnapshot;
      if (nextItems.length || !hadExistingItems) latest.items = nextItems;
      const networkSucceeded = goodCount > 0;
      const networkRefreshSucceeded = networkSucceeded && nextItems.length > 0;
      latest.loading = false;
      latest.loaded = true;
      if (networkRefreshSucceeded) latest.loadedAt = Date.now();
      latest.networkRefreshSucceeded = networkRefreshSucceeded;
      latest.error = networkSucceeded || homeLatestHasItems(latest) ? "" : "加载失败";
      recordHomeLatestDiag(Object.assign({}, counts, {
        weekStart: range.start,
        weekEnd: range.end,
        today: range.today,
        timezone: range.timezone,
        tvRenderedCount: sortedTv.length,
        movieRenderedCount: sortedMovies.length,
        renderedCount: latest.items.length,
        firstItemTitle: latest.items[0] && latest.items[0].title || "",
        firstItems: latest.items.slice(0, 10).map((item) => ({ title: item.title || "", mediaType: item.mediaType || "", update: item.weeklyUpdateText || "" })),
        cacheHit: !!latest.cacheHydrated,
        cacheAgeMs: homeLatestCacheAge(latest),
        cacheItemCount: latest.cacheItemCount || 0,
        cacheHydratedAt: latest.cacheHydratedAt || 0,
        networkRefresh: true,
        networkRefreshSucceeded,
        networkRefreshDurationMs: Math.max(0, Date.now() - networkStartedAt),
        networkRefreshReason: latest.networkRefreshReason
      }));
      publishHomeWeeklySnapshot("network-final", { final: true, refreshing: false });
      if (isHomeRouteActive()) {
        renderHomeHot();
        mergeHomeLatestIntoHeroFeed({ render: true });
      }
      if (networkRefreshSucceeded && latest.requestSeq === requestSeq) await persistHomeLatestCache(latest, range);
      return latest;
    }

    function ensureHomeLatestData() {
      if (!isHomeRouteActive()) return false;
      const latest = state.homeLatest;
      if (!latest) return false;
      if (latest.loading) return false;
      const currentWeekStart = weeklyDateRange().start;
      const weekChanged = !!(latest.range && latest.range.start && latest.range.start !== currentWeekStart);
      const networkAge = latest.loadedAt > 0 ? Math.max(0, Date.now() - latest.loadedAt) : Infinity;
      const attemptAge = latest.lastRefreshAt > 0 ? Math.max(0, Date.now() - latest.lastRefreshAt) : Infinity;
      if (!weekChanged && latest.loadedAt > 0 && networkAge < HOME_WEEKLY_REFRESH_TTL_MS) return false;
      if (!weekChanged && !latest.loadedAt && latest.loaded && latest.lastRefreshAt > 0 && attemptAge < HOME_WEEKLY_REFRESH_TTL_MS) return false;
      if (!weekChanged && !latest.networkRefreshSucceeded && latest.loaded && latest.lastRefreshAt > 0 && attemptAge < HOME_WEEKLY_REFRESH_TTL_MS) return false;
      Promise.resolve(loadHomeLatest()).catch(() => {
        if (state.homeLatest) {
          const hasItems = homeLatestHasItems(state.homeLatest);
          state.homeLatest.loading = false;
          state.homeLatest.loaded = true;
          state.homeLatest.error = hasItems ? "" : "加载失败";
          state.homeLatest.networkRefreshSucceeded = false;
          recordHomeLatestDiag({
            cacheHit: !!state.homeLatest.cacheHydrated,
            cacheAgeMs: homeLatestCacheAge(state.homeLatest),
            cacheItemCount: state.homeLatest.cacheItemCount || 0,
            cacheHydratedAt: state.homeLatest.cacheHydratedAt || 0,
            networkRefresh: true,
            networkRefreshSucceeded: false,
            networkRefreshDurationMs: state.homeLatest.lastRefreshAt ? Math.max(0, Date.now() - state.homeLatest.lastRefreshAt) : 0,
            networkRefreshReason: state.homeLatest.networkRefreshReason || "no-cache",
            refreshFailure: true
          });
        }
        if (isHomeRouteActive()) renderHomeHot();
      });
      return true;
    }

    function resolveHomeWeeklyItems() {
      const page = state.homeLatest || null;
      return {
        source: "weekly-feed",
        items: filterBlocked(page && page.items || []),
        page,
        loading: !!(page && page.loading),
        error: page && page.error || "",
        path: "state.homeLatest.items"
      };
    }

    // Keep the established function name as a compatibility boundary for
    // diagnostics and the existing Home renderer; its data is now Weekly.
    function resolveHomeLatestItems() {
      return resolveHomeWeeklyItems();
    }

    async function setHomeHotSource(source) {
      const next = source === "nostr" ? "nostr" : "tmdb";
      state.uiPrefs = Object.assign({}, state.uiPrefs || {}, sanitizeUiPrefs(state.uiPrefs || {}), { homeHotSource: next, loaded: true });
      renderUiPrefsControls();
      if (next === "tmdb") ensureSearchHotData();
      if (state.activeList === "all" && homeUiRoute() === "search") renderSearch();
      if (homeUiRoute() === "home") {
        invalidateHomeCategoryFeeds();
        renderHome();
      }
      if (homeUiRoute() === "secondary") {
        const secondaryId = normalizeLegacyCategoryId(state.homeV14 && state.homeV14.secondaryListId);
        const secondaryFilters = secondaryId ? secondaryFilterState(secondaryId) : null;
        if (["movie", "tv", "anime"].includes(secondaryId) && secondaryFilters && secondaryFilters.sort === "hot") {
          state.homeV14.secondaryActiveQueryKey = "";
          const query = secondaryGetQuery(secondaryId);
          renderSecondaryCatalog();
          if (!query.loaded && !query.loading) loadSecondaryPage(secondaryId, query, 1).catch(() => {});
        }
      }
      try { await sdk().cache.set(cacheKey("uiPrefs"), JSON.stringify(sanitizeUiPrefs(state.uiPrefs))); } catch (e) {}
      scheduleUiSnapshotSave();
    }

    async function setHomeFullscreenEnabled(enabled) {
      state.uiPrefs = Object.assign({}, state.uiPrefs || {}, sanitizeUiPrefs(state.uiPrefs || {}), { homeFullscreenEnabled: enabled !== false, loaded: true });
      applyUiPrefs();
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(1200);
      try { await sdk().cache.set(cacheKey("uiPrefs"), JSON.stringify(sanitizeUiPrefs(state.uiPrefs))); } catch (e) {}
      syncNativeToolbarForRoute();
      toast(isHomeFullscreenEnabled() ? "首页全屏：已开启" : "首页全屏：已关闭");
      scheduleUiSnapshotSave();
    }

    function reassertConnectionSegmentedFocus(target) {
      if (!isTvLikeDevice() || !isConnectionPanelOpen() || !target || !target.isConnected || !isVisibleFocusable(target)) return;
      if (document.activeElement !== target) focusRemoteTarget(target);
      requestAnimationFrame(() => {
        if (!isTvLikeDevice() || !isConnectionPanelOpen() || !target.isConnected || !isVisibleFocusable(target)) return;
        if (document.activeElement !== target) focusRemoteTarget(target);
      });
    }

    function commitConnectionSegmentedTarget(target) {
      if (!target) return Promise.resolve(false);
      const fullscreenValue = target.dataset.homeFullscreen;
      const hotSourceValue = target.dataset.homeHotSource;
      let commit = null;
      if (fullscreenValue === "on" || fullscreenValue === "off") {
        const enabled = fullscreenValue === "on";
        if (isHomeFullscreenEnabled() === enabled) {
          reassertConnectionSegmentedFocus(target);
          return Promise.resolve(false);
        }
        commit = setHomeFullscreenEnabled(enabled);
      } else if (hotSourceValue === "nostr" || hotSourceValue === "tmdb") {
        if (homeHotSource() === hotSourceValue) {
          reassertConnectionSegmentedFocus(target);
          return Promise.resolve(false);
        }
        commit = setHomeHotSource(hotSourceValue);
      }
      if (!commit || typeof commit.then !== "function") {
        reassertConnectionSegmentedFocus(target);
        return Promise.resolve(false);
      }
      return commit.then(() => {
        reassertConnectionSegmentedFocus(target);
        return true;
      }, () => {
        reassertConnectionSegmentedFocus(target);
        return false;
      });
    }

    function handleConnectionSegmentedDirectionalKey(button, event) {
      if (!isTvLikeDevice() || !isConnectionPanelOpen() || !button) return false;
      const key = normalizeRemoteKey(event);
      if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
      const group = button.closest && button.closest(".detail-style-segmented");
      if (!group) return false;
      const field = button.dataset.homeFullscreen != null ? "homeFullscreen" : button.dataset.homeHotSource != null ? "homeHotSource" : "";
      if (!field) return false;
      const values = field === "homeFullscreen" ? ["on", "off"] : ["nostr", "tmdb"];
      const currentValue = String(button.dataset[field] || "");
      const currentIndex = values.indexOf(currentValue);
      const targetValue = values[Math.max(0, Math.min(values.length - 1, currentIndex + (key === "ArrowRight" ? 1 : -1)))] || currentValue;
      const target = Array.from(group.querySelectorAll("button[data-home-fullscreen],button[data-home-hot-source]"))
        .find((candidate) => isVisibleFocusable(candidate) && candidate.dataset[field] === targetValue) || button;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      focusRemoteTarget(target);
      commitConnectionSegmentedTarget(target).catch(() => {});
      return true;
    }

    function sanitizeTmdbConfig(value) {
      const raw = value && typeof value === "object" ? value : {};
      return { apiKey: String(raw.apiKey || "").trim() || DEFAULT_TMDB_API_KEY };
    }

    function tmdbApiKey() {
      return String(window.WEBHOME_CONFIG.tmdb.apiKey || "").trim() || DEFAULT_TMDB_API_KEY;
    }

    async function initTmdbConfig(options) {
      options = options || {};
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(options.timeout == null ? 1500 : options.timeout);
      if (options.preserveDirty && state.tmdb.configDirty) return;
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(cacheKey("tmdb")), null); } catch (e) { saved = null; }
      state.tmdb.config = sanitizeTmdbConfig(saved);
      window.WEBHOME_CONFIG.tmdb.apiKey = state.tmdb.config.apiKey;
      state.tmdb.configDirty = false;
      renderTmdbConfigControls();
    }

    function readTmdbConfigControls() {
      return { apiKey: $("tmdbKeyInput") ? $("tmdbKeyInput").value : "" };
    }

    function renderTmdbConfigControls() {
      const config = state.tmdb.config || sanitizeTmdbConfig(null);
      if ($("tmdbKeyInput")) {
        $("tmdbKeyInput").value = config.apiKey || DEFAULT_TMDB_API_KEY;
        disablePanelTextEditing($("tmdbKeyInput"));
      }
    }

    function resetTmdbRuntimeAfterConfigChange() {
      const tvDetail = state.tvDetail;
      if (tvDetail) {
        tvDetail.generation = Number(tvDetail.generation || 0) + 1;
        tvDetail.cache = {};
        tvDetail.cardTasks = {};
        tvDetail.cardQueue = [];
        if (tvDetail.observer) tvDetail.observer.disconnect();
        tvDetail.observer = null;
        if (tvDetail.scanTimer) clearTimeout(tvDetail.scanTimer);
        tvDetail.scanTimer = 0;
      }
      state.catalog = {};
      state.catalogPage = {};
      state.fallback = [];
      state.fallbackPage = { sourceIndex: 0, page: 0, loading: false, loaded: false, done: false };
      state.searchItems = [];
      state.gridRender = {};
      state.recommendationSource = "pending";
      renderSearch();
      renderAll({ deferContent: true });
      loadCatalog();
    }

    function curatedSourceDefaults() {
      const result = {};
      CURATED_SOURCE_DEFINITIONS.forEach((source) => {
        result[source.id] = (source.domains || []).slice();
      });
      return result;
    }

    function normalizeSourceDomain(value) {
      const text = String(value || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(text)) return "";
      try {
        const parsed = new URL(text);
        return parsed.origin + parsed.pathname.replace(/\/+$/, "");
      } catch (e) {
        return "";
      }
    }

    function sanitizeSourceDomains(value) {
      const defaults = curatedSourceDefaults();
      const result = {};
      CURATED_SOURCE_ORDER.forEach((id) => {
        result[id] = (defaults[id] || []).slice(0, 1);
      });
      return result;
    }

    function sanitizeSourceTemplateCache(value) {
      const raw = value && typeof value === "object" ? value : {};
      const result = {};
      CURATED_SOURCE_ORDER.forEach((id) => {
        const template = String(raw[id] || "").trim();
        if (template && (template.includes("{kw}") || template.includes("{keyword}"))) result[id] = template;
      });
      return result;
    }

    function sourceDomainControls() {
      return {
        wanou: $("sourceDomainsWanou"),
        muou: $("sourceDomainsMuou"),
        duoduo: $("sourceDomainsDuoduo"),
        huban: $("sourceDomainsHuban"),
        shandian: $("sourceDomainsShandian")
      };
    }

    function setSourceDomainsOpen(open) {
      const toggle = $("sourceDomainsToggle");
      const body = $("sourceDomainsBody");
      if (!toggle || !body) return false;
      const expanded = !!open;
      body.hidden = !expanded;
      body.setAttribute("aria-hidden", expanded ? "false" : "true");
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      return expanded;
    }

    function toggleSourceDomains() {
      const body = $("sourceDomainsBody");
      return setSourceDomainsOpen(!body || body.hidden);
    }

    function renderSourceDomainControls(sourceDomains) {
      const values = sanitizeSourceDomains(sourceDomains);
      const controls = sourceDomainControls();
      CURATED_SOURCE_ORDER.forEach((id) => {
        const control = controls[id];
        if (!control) return;
        control.value = (values[id] || []).join("\n");
        disablePanelTextEditing(control);
      });
    }

    function restoreSourceDomainDefaults() {
      renderSourceDomainControls(curatedSourceDefaults());
      markPanConfigDirty();
      toast("已恢复站源默认域名，请点击保存配置");
    }

    function readSourceDomainControls() {
      const controls = sourceDomainControls();
      const result = {};
      CURATED_SOURCE_ORDER.forEach((id) => {
        result[id] = String(controls[id] && controls[id].value || "")
          .split(/[\r\n,，]+/)
          .map(normalizeSourceDomain)
          .filter(Boolean);
      });
      return sanitizeSourceDomains(result);
    }

    function defaultPanConfig() {
      return {
        apiBase: window.WEBHOME_CONFIG.pan.apiBase || "https://so.252035.xyz",
        diskTypes: (window.WEBHOME_CONFIG.pan.diskTypes || []).slice(),
        username: "",
        password: "",
        token: "",
        tokenExpiresAt: 0,
        channels: [],
        sourceDomains: curatedSourceDefaults(),
        sourceTemplates: {}
      };
    }

    function normalizePanBase(value) {
      let base = String(value || "").trim() || defaultPanConfig().apiBase;
      if (!/^https?:\/\//i.test(base)) base = "https://" + base;
      return base.replace(/\/+$/, "");
    }

    function normalizePanDiskType(type) {
      const value = String(type || "").trim().toLowerCase();
      if (value === "ali" || value === "alipan") return "aliyun";
      if (value === "123pan") return "123";
      if (value === "139" || value === "caiyun") return "mobile";
      if (value === "pikpakdrive") return "pikpak";
      if (value === "guangyapan") return "guangya";
      if (value === "magnetlink" || value === "magnet:?" || value === "bt") return "magnet";
      if (value === "ed2k:") return "ed2k";
      if (value === "other") return "others";
      return value;
    }

    function resolvePanProviderForHistory(itemOrTarget) {
      const value = itemOrTarget && typeof itemOrTarget === "object" ? itemOrTarget : {};
      const allowed = new Set(PAN_DISK_TYPES.map((item) => item.id));
      const firstValid = (values) => {
        for (const candidate of values) {
          const normalized = normalizePanDiskType(candidate);
          if (normalized && allowed.has(normalized)) return normalized;
        }
        return "";
      };
      return firstValid([
        value.diskType,
        value.disk_type,
        value.panDiskType,
        value.pan_disk_type
      ]) || firstValid([
        value.panProvider,
        value.pan_provider,
        value.provider
      ]) || normalizePanDiskType(curatedDiskTypeForUrl(
        value.lastPlayUrl || value.last_play_url || value.url || value.normalizedUrl || value.normalized_url
      ));
    }

    function normalizePanChannels(value) {
      const list = Array.isArray(value) ? value : String(value || "").split(/[\n,，\s]+/);
      return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
    }

    function isPanCheckSupported(item) {
      return !!(item && PAN_CHECKABLE_DISK_TYPES.has(normalizePanDiskType(item.diskType)));
    }

    function canCheckPanLinks() {
      const pan = sdk().pan || {};
      return !!(state.pan.checkEnabled && pan.check);
    }

    function sanitizePanConfig(value) {
      const fallback = defaultPanConfig();
      const raw = value && typeof value === "object" ? value : {};
      const allowed = new Set(PAN_DISK_TYPES.map((item) => item.id));
      const disks = Array.isArray(raw.diskTypes) ? raw.diskTypes.map(normalizePanDiskType).filter((item) => allowed.has(item)) : fallback.diskTypes;
      return {
        apiBase: normalizePanBase(raw.apiBase || fallback.apiBase),
        diskTypes: Array.from(new Set(disks.length ? disks : fallback.diskTypes)),
        username: String(raw.username || "").trim(),
        password: String(raw.password || ""),
        token: String(raw.token || ""),
        tokenExpiresAt: Number(raw.tokenExpiresAt || 0),
        channels: normalizePanChannels(raw.channels || raw.tgChannels || raw.channel),
        sourceDomains: sanitizeSourceDomains(raw.sourceDomains),
        sourceTemplates: sanitizeSourceTemplateCache(raw.sourceTemplates)
      };
    }

    async function initPanConfig(options) {
      options = options || {};
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(options.timeout == null ? 1500 : options.timeout);
      if (options.preserveDirty && state.pan.configDirty) return;
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(cacheKey("pan")), null); } catch (e) { saved = null; }
      state.pan.config = sanitizePanConfig(saved);
      state.pan.configDirty = false;
      renderPanConfigControls();
    }

    async function savePanConfig() {
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(1500);
      if (window.fongmiBridge && !window.fm) throw new Error("App SDK 未就绪，请稍后再保存");
      const previousTmdbKey = tmdbApiKey();
      state.tmdb.config = sanitizeTmdbConfig(readTmdbConfigControls());
      window.WEBHOME_CONFIG.tmdb.apiKey = state.tmdb.config.apiKey;
      state.pan.config = sanitizePanConfig(readPanConfigControls());
      await sdk().cache.set(cacheKey("tmdb"), JSON.stringify(state.tmdb.config));
      await sdk().cache.set(cacheKey("pan"), JSON.stringify(state.pan.config));
      renderTmdbConfigControls();
      renderPanConfigControls();
      state.tmdb.configDirty = false;
      state.pan.configDirty = false;
      setPanStatus("配置已保存");
      closeConnectionPanel();
      toast("配置已保存");
      if (previousTmdbKey !== tmdbApiKey()) resetTmdbRuntimeAfterConfigChange();
    }

    function readPanConfigControls() {
      const checked = Array.from(document.querySelectorAll("#panDiskGrid input:checked")).map((input) => input.value);
      return {
        apiBase: $("panBaseInput") ? $("panBaseInput").value : "",
        username: $("panUserInput") ? $("panUserInput").value : "",
        password: $("panPassInput") ? $("panPassInput").value : "",
        token: state.pan.config && state.pan.config.token || "",
        tokenExpiresAt: state.pan.config && state.pan.config.tokenExpiresAt || 0,
        diskTypes: checked,
        channels: normalizePanChannels($("panChannelsInput") ? $("panChannelsInput").value : ""),
        sourceDomains: readSourceDomainControls(),
        sourceTemplates: state.pan.config && state.pan.config.sourceTemplates || {}
      };
    }

    function renderPanConfigControls() {
      const config = state.pan.config || defaultPanConfig();
      if ($("panBaseInput")) {
        $("panBaseInput").value = config.apiBase;
        disablePanelTextEditing($("panBaseInput"));
      }
      if ($("panChannelsInput")) {
        $("panChannelsInput").value = (config.channels || []).join("\n");
        disablePanelTextEditing($("panChannelsInput"));
      }
      if ($("panUserInput")) {
        $("panUserInput").value = config.username || "";
        disablePanelTextEditing($("panUserInput"));
      }
      if ($("panPassInput")) {
        $("panPassInput").value = config.password || "";
        disablePanelTextEditing($("panPassInput"));
      }
      renderSourceDomainControls(config.sourceDomains);
      const grid = $("panDiskGrid");
      if (!grid) return;
      const selected = new Set(config.diskTypes || []);
      grid.replaceChildren(...PAN_DISK_TYPES.map((disk) => {
        const label = document.createElement("label");
        label.innerHTML = `<input class="focusable" type="checkbox" value="${escapeAttr(disk.id)}" ${selected.has(disk.id) ? "checked" : ""}><span>${escapeHtml(disk.name)}</span>`;
        return label;
      }));
    }

    function markPanConfigDirty(event) {
      const target = event && event.target;
      if (target && target.id === "tmdbKeyInput") state.tmdb.configDirty = true;
      else state.pan.configDirty = true;
    }

    function panDiskName(type) {
      const normalized = normalizePanDiskType(type);
      const item = PAN_DISK_TYPES.find((disk) => disk.id === normalized);
      return item ? item.name : normalized || "网盘";
    }

    function panApi(path) {
      const base = normalizePanBase((state.pan.config || defaultPanConfig()).apiBase);
      if (base.endsWith("/api") && path.startsWith("/api/")) return base + path.slice(4);
      return base + path;
    }

    function panSearchDiskTypes(config) {
      const types = ((config && config.diskTypes) || []).map(normalizePanDiskType).filter(Boolean);
      return Array.from(new Set(types));
    }

    function panSearchPayload(keyword, config) {
      const payload = {
        kw: keyword,
        res: "merge",
        src: "all",
        cloud_types: panSearchDiskTypes(config)
      };
      const channels = normalizePanChannels(config && config.channels || []);
      if (channels.length) payload.channels = channels;
      return payload;
    }

    async function persistPanConfigQuietly() {
      try { await sdk().cache.set(cacheKey("pan"), JSON.stringify(state.pan.config || defaultPanConfig())); } catch (e) {}
    }

    async function ensurePanAuthHeaders() {
      const config = state.pan.config || defaultPanConfig();
      if (!config.username || !config.password) return {};
      if (config.token && Number(config.tokenExpiresAt || 0) * 1000 > Date.now() + 60000) return { Authorization: "Bearer " + config.token };
      const response = await postJson(panApi("/api/auth/login"), { username: config.username, password: config.password }, 12, {});
      const data = response && response.data ? response.data : response;
      const token = data && data.token;
      if (!token) throw new Error(response && (response.error || response.message) || "盘搜认证失败");
      state.pan.config = sanitizePanConfig(Object.assign({}, config, { token, tokenExpiresAt: data.expires_at || 0 }));
      await persistPanConfigQuietly();
      return { Authorization: "Bearer " + token };
    }

