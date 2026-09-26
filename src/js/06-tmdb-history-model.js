    function today() {
      const date = new Date();
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }

    function resolveParamDate(value) {
      if (typeof value !== "string") return value;
      if (value === "today") return today();
      const match = value.match(/^today([+-])(\d+)$/);
      if (match) {
        const offset = parseInt(match[2], 10) * (match[1] === "-" ? -1 : 1);
        const date = new Date();
        date.setDate(date.getDate() + offset);
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      }
      return value;
    }

    function tmdbUrl(list, page) {
      const url = new URL(`${window.WEBHOME_CONFIG.tmdb.apiBase}/${list.endpoint}`);
      url.searchParams.set("api_key", tmdbApiKey());
      url.searchParams.set("language", window.WEBHOME_CONFIG.tmdb.language);
      Object.entries(list.params || {}).forEach(([key, value]) => {
        // 支持 _gte/_lte/_date 后缀转为 TMDB 的 .gte/.lte 参数
        const param = key.replace(/_gte$/, ".gte").replace(/_lte$/, ".lte");
        url.searchParams.set(param, resolveParamDate(value));
      });
      if (page) url.searchParams.set("page", String(page));
      return url.toString();
    }

    function tmdbFallbackUrl(type, page) {
      const endpoint = type === "airing" ? "tv/airing_today" : "trending/all/day";
      const url = new URL(`${window.WEBHOME_CONFIG.tmdb.apiBase}/${endpoint}`);
      url.searchParams.set("api_key", tmdbApiKey());
      url.searchParams.set("language", window.WEBHOME_CONFIG.tmdb.language);
      url.searchParams.set("page", String(page || 1));
      return url.toString();
    }

    function tmdbSearchUrl(keyword) {
      const url = new URL(`${window.WEBHOME_CONFIG.tmdb.apiBase}/search/multi`);
      url.searchParams.set("api_key", tmdbApiKey());
      url.searchParams.set("language", window.WEBHOME_CONFIG.tmdb.language);
      url.searchParams.set("query", keyword);
      url.searchParams.set("include_adult", "false");
      url.searchParams.set("page", "1");
      return url.toString();
    }

    function suggestUrl(keyword) {
      const url = new URL("https://suggest.video.iqiyi.com/");
      url.searchParams.set("if", "mobile");
      url.searchParams.set("key", keyword);
      return url.toString();
    }

    function tmdbDetailUrl(item) {
      const url = new URL(`${window.WEBHOME_CONFIG.tmdb.apiBase}/${item.mediaType}/${item.tmdbId}`);
      url.searchParams.set("api_key", tmdbApiKey());
      url.searchParams.set("language", window.WEBHOME_CONFIG.tmdb.language);
      url.searchParams.set("append_to_response", item.mediaType === "tv" ? "credits,images,season/1,alternative_titles" : "credits,images,alternative_titles");
      url.searchParams.set("include_image_language", "zh,null,en");
      return url.toString();
    }

    function recordMovieDetailSharedDiag(item, status, startedAt, extra) {
      const diag = Object.assign({
        status: String(status || ""),
        mediaType: "movie",
        tmdbId: String(item && (item.tmdbId || item.id) || "").trim(),
        elapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0
      }, extra || {});
      if (state.tvDiag) state.tvDiag.movieDetailShared = diag;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV] TMDB_MOVIE_DETAIL_SHARED", diag); } catch (e) {}
        updateTvDiagnostic();
      }
      return diag;
    }

    function movieDetailCacheId(itemOrId) {
      const raw = itemOrId && typeof itemOrId === "object"
        ? itemOrId.tmdbId != null ? itemOrId.tmdbId : itemOrId.id
        : itemOrId;
      const value = String(raw == null ? "" : raw).trim();
      return /^\d+$/.test(value) && Number(value) > 0 ? value : "";
    }

    function movieDetailCacheKey(itemOrId) {
      const id = movieDetailCacheId(itemOrId);
      return id ? `movie:${id}` : "";
    }

    function movieDetailCacheValue(itemOrId) {
      const runtime = state.movieDetail;
      const key = movieDetailCacheKey(itemOrId);
      const entry = runtime && key ? runtime.cache[key] : null;
      if (!entry || !entry.detail || typeof entry.detail !== "object" || !entry.fetchedAt) return null;
      if (Date.now() - Number(entry.fetchedAt) >= MOVIE_DETAIL_CACHE_TTL_MS) return null;
      const expectedId = movieDetailCacheId(itemOrId);
      const detailId = String(entry.detail.id || entry.detail.tmdbId || "").trim();
      return expectedId && detailId === expectedId ? entry.detail : null;
    }

    function storeMovieDetailCache(itemOrId, detail) {
      const runtime = state.movieDetail;
      const key = movieDetailCacheKey(itemOrId);
      const expectedId = movieDetailCacheId(itemOrId);
      const detailId = String(detail && (detail.id || detail.tmdbId) || "").trim();
      if (!runtime || !key || !expectedId || !detail || typeof detail !== "object" || detailId !== expectedId) return null;
      const entry = runtime.cache[key] || (runtime.cache[key] = { detail: null, fetchedAt: 0, promise: null });
      entry.detail = detail;
      entry.fetchedAt = Date.now();
      entry.promise = null;
      return detail;
    }

    function requestMovieDetailShared(itemOrId, requestOverride) {
      const runtime = state.movieDetail;
      const id = movieDetailCacheId(itemOrId);
      const key = id ? `movie:${id}` : "";
      if (!runtime || !key) return Promise.resolve(null);
      const request = typeof requestOverride === "function" ? requestOverride : requestJson;
      const cached = movieDetailCacheValue(itemOrId);
      if (cached) {
        recordMovieDetailSharedDiag(itemOrId, "cache_hit", 0);
        return Promise.resolve(cached);
      }
      const entry = runtime.cache[key] || (runtime.cache[key] = { detail: null, fetchedAt: 0, promise: null });
      if (entry.promise) {
        recordMovieDetailSharedDiag(itemOrId, "join_pending", 0);
        return entry.promise;
      }
      const startedAt = Date.now();
      recordMovieDetailSharedDiag(itemOrId, "network_start", startedAt);
      const requestItem = { mediaType: "movie", tmdbId: id };
      let requestResult;
      try {
        requestResult = request(tmdbDetailUrl(requestItem), 18);
      } catch (error) {
        if (runtime.cache[key] === entry) entry.promise = null;
        recordMovieDetailSharedDiag(requestItem, "network_done", startedAt, { success: false });
        return Promise.reject(error);
      }
      const promise = Promise.resolve(requestResult).then((body) => {
        const detail = body && typeof body === "object" ? body : {};
        const stored = storeMovieDetailCache(requestItem, detail);
        if (runtime.cache[key] === entry && !stored) entry.promise = null;
        recordMovieDetailSharedDiag(requestItem, "network_done", startedAt, { success: !!stored });
        return detail;
      }).catch((error) => {
        if (runtime.cache[key] === entry) entry.promise = null;
        recordMovieDetailSharedDiag(requestItem, "network_done", startedAt, { success: false });
        throw error;
      });
      entry.promise = promise;
      return promise;
    }

    function tvDetailCacheId(itemOrId) {
      const raw = itemOrId && typeof itemOrId === "object"
        ? itemOrId.tmdbId != null ? itemOrId.tmdbId : itemOrId.id
        : itemOrId;
      const value = String(raw == null ? "" : raw).trim();
      return /^\d+$/.test(value) && Number(value) > 0 ? value : "";
    }

    function tvDetailCacheKey(itemOrId) {
      const id = tvDetailCacheId(itemOrId);
      return id ? `tv:${id}` : "";
    }

    function tvDetailCacheValue(itemOrId) {
      const runtime = state.tvDetail;
      const key = tvDetailCacheKey(itemOrId);
      const entry = runtime && key ? runtime.cache[key] : null;
      if (!entry || !entry.detail || !entry.fetchedAt) return null;
      if (Date.now() - Number(entry.fetchedAt) >= TV_DETAIL_CACHE_TTL_MS) return null;
      return entry.detail;
    }

    function storeTvDetailCache(itemOrId, detail, generation) {
      const runtime = state.tvDetail;
      const key = tvDetailCacheKey(itemOrId);
      if (!runtime || !key || !detail || typeof detail !== "object") return detail || null;
      if (generation != null && Number(generation) !== Number(runtime.generation || 0)) return detail;
      const entry = runtime.cache[key] || (runtime.cache[key] = { detail: null, fetchedAt: 0, promise: null });
      entry.detail = detail;
      entry.fetchedAt = Date.now();
      entry.promise = null;
      return detail;
    }

    function requestTvDetailShared(itemOrId) {
      const runtime = state.tvDetail;
      const id = tvDetailCacheId(itemOrId);
      const key = id ? `tv:${id}` : "";
      if (!runtime || !key) return Promise.resolve(null);
      const cached = tvDetailCacheValue(itemOrId);
      if (cached) return Promise.resolve(cached);
      const entry = runtime.cache[key] || (runtime.cache[key] = { detail: null, fetchedAt: 0, promise: null });
      if (entry.promise) return entry.promise;
      const generation = runtime.generation || 0;
      const requestItem = { mediaType: "tv", tmdbId: id };
      const promise = requestJson(tmdbDetailUrl(requestItem), 18).then((body) => {
        const detail = body && typeof body === "object" ? body : {};
        storeTvDetailCache(requestItem, detail, generation);
        return detail;
      }).catch((error) => {
        if (runtime.cache[key] === entry) entry.promise = null;
        throw error;
      });
      entry.promise = promise;
      return promise;
    }

    function tmdbRecommendationsUrl(item) {
      const url = new URL(`${window.WEBHOME_CONFIG.tmdb.apiBase}/${item.mediaType}/${item.tmdbId}/recommendations`);
      url.searchParams.set("api_key", tmdbApiKey());
      url.searchParams.set("language", window.WEBHOME_CONFIG.tmdb.language);
      url.searchParams.set("page", "1");
      return url.toString();
    }

    function tmdbPersonDetailUrl(personId) {
      const url = new URL(`${window.WEBHOME_CONFIG.tmdb.apiBase}/person/${personId}`);
      url.searchParams.set("api_key", tmdbApiKey());
      url.searchParams.set("language", window.WEBHOME_CONFIG.tmdb.language);
      url.searchParams.set("append_to_response", "combined_credits");
      return url.toString();
    }

    function imageUrl(path, backdrop) {
      if (!path) return "";
      return (backdrop ? window.WEBHOME_CONFIG.tmdb.backdropBase : window.WEBHOME_CONFIG.tmdb.imageBase) + path;
    }

    function tmdbImageUrl(path, size) {
      if (!path) return "";
      const value = String(path || "").trim();
      const imagePath = value.startsWith("/") ? value : tmdbImagePath(value);
      if (!imagePath) return value;
      return `https://image.tmdb.org/t/p/${size || "w342"}${imagePath}`;
    }

    function tmdbImagePath(url) {
      const value = String(url || "").trim();
      if (!value) return "";
      if (value.startsWith("/")) return value;
      try {
        const parsed = new URL(value);
        if (parsed.hostname !== "image.tmdb.org" && parsed.hostname !== "images.tmdb.org") return "";
        return parsed.pathname.replace(/^\/t\/p\/[^/]+/, "") || "";
      } catch (e) {
        return "";
      }
    }

    function isTmdbImage(url) {
      return !!tmdbImagePath(url);
    }

    function displayImage(url, options) {
      if (!url) return "";
      const opts = options || {};
      const tmdbPath = tmdbImagePath(url);
      if (tmdbPath) return tmdbImageUrl(tmdbPath, opts.size || "w342");
      return nativeImage(url);
    }

    function nativeImage(url) {
      if (!url) return "";
      if (isTmdbImage(url)) return url;
      try { return sdk().res(url, { credentials: "include" }); } catch (e) { return url; }
    }

    function imageAttrs(src, options) {
      const opts = options || {};
      const loading = opts.loading || "lazy";
      const fetchPriority = opts.fetchPriority ? ` fetchpriority="${escapeAttr(opts.fetchPriority)}"` : "";
      const canDeferHomeImage = !!(opts.homeLazy && isTvLikeDevice() && src && !/^data:image\//i.test(String(src)));
      const placeholder = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
      const actualSrc = canDeferHomeImage ? placeholder : src;
      const deferred = canDeferHomeImage ? ` data-src="${escapeAttr(src)}" data-home-deferred="1"` : "";
      return `src="${escapeAttr(actualSrc)}"${deferred} loading="${escapeAttr(loading)}" decoding="async"${fetchPriority}`;
    }

    function mergeTitleAliases() {
      const values = Array.prototype.slice.call(arguments);
      const result = [];
      const seen = new Set();
      const add = (value) => {
        if (Array.isArray(value)) {
          value.forEach(add);
          return;
        }
        const text = String(value == null ? "" : value).trim();
        if (!text || seen.has(text)) return;
        seen.add(text);
        result.push(text);
      };
      values.forEach(add);
      return result;
    }

    function mergeTmdbLocalizedEnrichment(base, detail, mediaType) {
      const localized = base && typeof base === "object" ? base : {};
      const enriched = detail && typeof detail === "object" ? detail : {};
      const type = String(mediaType || localized.media_type || enriched.media_type || "").toLowerCase();
      const merged = Object.assign({}, localized, enriched);
      const basePrimary = type === "tv"
        ? String(localized.name || "").trim()
        : String(localized.title || "").trim();
      if (type === "tv") {
        merged.name = basePrimary
          || enriched.name
          || enriched.original_name
          || localized.original_name
          || enriched.title
          || localized.title
          || "";
      } else {
        merged.title = basePrimary
          || enriched.title
          || enriched.original_title
          || localized.original_title
          || enriched.name
          || localized.name
          || "";
      }
      merged.aliases = mergeTitleAliases(
        localized.aliases,
        enriched.aliases,
        localized.name,
        localized.title,
        localized.original_name,
        localized.original_title,
        enriched.name,
        enriched.title,
        enriched.original_name,
        enriched.original_title
      );
      return merged;
    }

    function normalizeTmdb(item, list, index) {
      const date = item.release_date || item.first_air_date || "";
      const listMediaType = String(list && list.mediaType || "").toLowerCase();
      const itemMediaType = String(item && item.media_type || "").toLowerCase();
      const mediaType = listMediaType === "tv" || listMediaType === "movie"
        ? listMediaType
        : itemMediaType === "tv" || itemMediaType === "movie"
          ? itemMediaType
          : "movie";
      const isTv = mediaType === "tv";
      const title = isTv
        ? item.name || item.title || item.original_name || item.original_title || "未命名"
        : item.title || item.name || item.original_title || item.original_name || "未命名";
      const originalTitle = isTv
        ? item.original_name || ""
        : item.original_title || "";
      const genreIds = Array.isArray(item.genre_ids) ? item.genre_ids.map((value) => String(value)).filter(Boolean) : [];
      const originCountries = Array.isArray(item.origin_country)
        ? item.origin_country.map((value) => String(value)).filter(Boolean)
        : item.origin_country ? String(item.origin_country).split(/[|,\s]+/).map((value) => value.trim()).filter(Boolean) : [];
      return {
        id: `tmdb:${mediaType}:${item.id}`,
        source: "tmdb",
        tmdbId: String(item.id),
        mediaType,
        listId: list.id || "search",
        listTitle: list.title || "搜索",
        title,
        originalTitle,
        aliases: mergeTitleAliases(title, originalTitle, item.name, item.title, item.original_name, item.original_title, item.aliases),
        resourceSearchTitle: title,
        pic: imageUrl(item.poster_path, false),
        landscape: imageUrl(item.backdrop_path, true),
        image: imageUrl(item.backdrop_path, true) || imageUrl(item.poster_path, false),
        remark: "",
        desc: item.overview || `${list.title || "搜索"} · ${title}`,
        releaseDate: date,
        genreIds,
        originCountries,
        originalLanguage: String(item.original_language || ""),
        popularity: item.popularity || 0,
        voteAverage: item.vote_average || 0,
        baseRank: index + 1
      };
    }

    function historyKeyParts(history) {
      const key = String(history && (history.key || history.historyKey || "") || historyNestedValue(history, ["key", "historyKey"]) || "").trim();
      const parts = key.split("@@@");
      const explicitCid = history && history.cid != null
        ? history.cid
        : historyNestedValue(history, ["cid"]);
      return {
        key,
        siteKey: String(parts[0] || history && (history.siteKey || history.site || "") || historyNestedValue(history, ["siteKey", "site"]) || "").trim(),
        vodId: String(parts[1] || history && (history.vodId || history.videoId || "") || historyNestedValue(history, ["vodId", "videoId"]) || "").trim(),
        cid: String(explicitCid != null && String(explicitCid).trim() ? explicitCid : parts[2] || "").trim()
      };
    }

    function validHistoryMs(value) {
      const ms = Number(value || 0);
      return Number.isFinite(ms) && ms > 0 && ms < 7 * 24 * 60 * 60 * 1000 ? ms : 0;
    }

    function historyTitleValue(history) {
      return String(history && (history.vodName || history.vod_name || history.title || history.name || history.showName || history.show_name)
        || historyNestedValue(history, ["vodName", "vod_name", "title", "name", "showName", "show_name"]) || "").trim();
    }

    function historyTypeText(history) {
      return [
        history && history.type,
        history && history.source,
        history && history.kind,
        history && history.playType,
        history && history.replayKind,
        historyNestedValue(history, ["type", "source", "kind", "playType", "replayKind"])
      ].filter((value) => value != null && String(value).trim()).join(" ").toLowerCase();
    }

    function historyUrlLike(value) {
      return /^(push|https?|file|magnet|ed2k|thunder|video):/i.test(String(value || "").trim());
    }

    function isRestorableHistory(history) {
      const parts = historyKeyParts(history);
      const title = historyTitleValue(history);
      if (!parts.siteKey || !parts.vodId || !title) return false;
      if (parts.siteKey === "push_agent") return false;
      if (historyUrlLike(parts.siteKey) || historyUrlLike(parts.vodId) || historyUrlLike(parts.key)) return false;
      if (/(^|[\s:_-])push[_ -]?agent([\s:_-]|$)|(^|[\s:_-])pan(?:[_ -]?(?:native|search|play))?([\s:_-]|$)/i.test(historyTypeText(history))) return false;
      return true;
    }

    function historyStatusText(history) {
      return [history && history.vodRemarks, history && history.remark, history && history.desc, history && history.status, history && history.summary, history && history.message, history && history.error, history && history.reason, history && history.episodeUrl, historyNestedValue(history, ["vodRemarks", "remark", "desc", "status", "summary", "message", "error", "reason", "episodeUrl", "episode_url"])]
        .filter((value) => value != null && String(value).trim())
        .map((value) => String(value))
        .join(" ")
        .toLowerCase();
    }

    function historyExplicitInvalidReason(history) {
      const statusText = historyStatusText(history);
      if (/(已过期|已失效|链接失效|资源失效|分享已取消|取消分享|文件不存在|内容不存在|资源不存在|不存在|被删除|已删除|违规|notfound|not[\s_-]*found|expired|invalid|forbidden|share[\s_-]*(?:cancelled|canceled)|file[\s_-]*not[\s_-]*found|folder[\s_-]*not[\s_-]*found|shareexpirederror|sharenotfound|shareinfonotfound|filenotfound|foldernotfound)/i.test(statusText)) return "EXPLICIT_EXPIRED";
      const parts = historyKeyParts(history);
      const pic = String(history && (history.vodPic || history.pic || "") || "").trim();
      if (isExpiredPosterSource(pic, parts)) return "EXPLICIT_EXPIRED";
      const title = historyTitleValue(history);
      return /^(已过期|已失效|链接失效|资源失效|文件不存在|内容不存在|资源不存在|不存在)$/.test(title) ? "EXPLICIT_EXPIRED" : "";
    }

    function historyHasMeaningfulState(history) {
      const createTime = Number(historyNestedValue(history, ["createTime", "create_time", "updatedAt", "updated_at"]) || 0);
      const position = Number(historyNestedValue(history, ["position", "playbackPosition", "playback_position"]) || 0);
      const duration = Number(historyNestedValue(history, ["duration", "durationMs", "duration_ms"]) || 0);
      return (Number.isFinite(createTime) && createTime > 0) ||
        (Number.isFinite(position) && position > 0) ||
        (Number.isFinite(duration) && duration > 0);
    }

    function historyHasNativeIdentity(history) {
      const parts = historyKeyParts(history);
      return !!(parts.siteKey && parts.vodId);
    }

    function historyVisibilityInfo(history) {
      if (!history || typeof history !== "object") return { visible: false, hiddenReason: "INVALID_RECORD" };
      if (!historyTitleValue(history)) return { visible: false, hiddenReason: "MISSING_TITLE" };
      const explicitReason = historyExplicitInvalidReason(history);
      if (explicitReason) return { visible: false, hiddenReason: explicitReason };
      if (!historyHasMeaningfulState(history) && !historyHasNativeIdentity(history)) return { visible: false, hiddenReason: "INVALID_RECORD" };
      return { visible: true, hiddenReason: "" };
    }

    function isVisibleRecentHistory(history) {
      return historyVisibilityInfo(history).visible;
    }

    function historyReplayKind(history, parts, restorable) {
      const keyParts = parts || historyKeyParts(history);
      const canRestore = restorable == null ? isRestorableHistory(history) : !!restorable;
      if (canRestore) return "VOD";
      const typeText = historyTypeText(history);
      if (keyParts.siteKey === "push_agent" || /push[_ -]?agent|pan(?:[_ -]?(?:native|search|play))?|网盘/i.test(typeText)) return "PAN_NATIVE";
      if (historyUrlLike(keyParts.siteKey) || historyUrlLike(keyParts.vodId) || historyUrlLike(keyParts.key) || /url|native[_ -]?url/i.test(typeText)) return "URL_NATIVE";
      return "DISPLAY_ONLY";
    }

    function historySiteKind(history, parts, restorable) {
      const keyParts = parts || historyKeyParts(history);
      if (keyParts.siteKey === "push_agent" || /push[_ -]?agent|pan(?:[_ -]?(?:native|search|play))?|网盘/i.test(historyTypeText(history))) return "push_agent";
      if (historyUrlLike(keyParts.siteKey) || historyUrlLike(keyParts.vodId) || historyUrlLike(keyParts.key)) return "url";
      if (restorable == null ? isRestorableHistory(history) : !!restorable) return "vod";
      return "other";
    }

    function historyFingerprint(history) {
      const value = [
        historyTitleValue(history),
        history && history.createTime,
        history && history.position,
        history && history.duration,
        history && history.url,
        history && history.episodeUrl,
        history && history.type,
        history && history.source
      ].map((part) => String(part == null ? "" : part)).join("\u001f");
      let hash = 2166136261;
      for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(16);
    }

    function historyStableKey(history, parts, index) {
      const keyParts = parts || historyKeyParts(history);
      if (keyParts.key && !/^@+$/.test(keyParts.key)) return keyParts.key;
      if (keyParts.siteKey && keyParts.vodId) return keyParts.siteKey + "@@@" + keyParts.vodId;
      const title = historyTitleValue(history) || "最近观看";
      const createTime = Number(historyNestedValue(history, ["createTime", "create_time", "updatedAt", "updated_at"]) || 0);
      const position = Number(historyNestedValue(history, ["position", "playbackPosition", "playback_position"]) || 0);
      const duration = Number(historyNestedValue(history, ["duration", "durationMs", "duration_ms"]) || 0);
      return [title, createTime, position, duration, historyFingerprint(history), index == null ? "" : index].join("@@");
    }

    function isExpiredPosterSource(pic, parts) {
      const value = String(pic || "").trim();
      if (!value) return false;
      const lower = value.slice(0, 500).toLowerCase();
      if (/(已过期|已失效|链接失效|资源失效|expired|notfound|not-found|invalid|forbidden)/i.test(lower)) return true;
      return false;
    }

    function formatHistoryTime(ms) {
      const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor(total % 3600 / 60);
      const sec = total % 60;
      if (h > 0) return h + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
      return m + ":" + String(sec).padStart(2, "0");
    }

    function historyProgressText(history) {
      const position = validHistoryMs(historyNestedValue(history, ["position", "playbackPosition", "playback_position"]));
      const duration = validHistoryMs(historyNestedValue(history, ["duration", "durationMs", "duration_ms"]));
      if (duration > 0 && position > 0) return "已看 " + Math.min(99, Math.max(1, Math.round(position / duration * 100))) + "%";
      return position > 0 ? "看到 " + formatHistoryTime(position) : "";
    }

    function historyProgressPercent(history) {
      const position = validHistoryMs(historyNestedValue(history, ["position", "playbackPosition", "playback_position"]));
      const duration = validHistoryMs(historyNestedValue(history, ["duration", "durationMs", "duration_ms"]));
      if (duration <= 0 || position <= 0) return 0;
      return Math.min(100, Math.max(1, Math.round(position / duration * 100)));
    }

    function normalizeHistoryItem(history, index) {
      const parts = historyKeyParts(history);
      const context = historyPlaybackContext(history);
      const title = context.title || historyTitleValue(history) || "最近观看";
      const pic = String(history && (history.vodPic || history.pic || "") || historyNestedValue(history, ["vodPic", "pic", "poster"]) || context.poster || "").trim();
      const badge = String(history && history.vodRemarks || historyNestedValue(history, ["vodRemarks", "remark", "badge"]) || "").trim();
      const createTime = Number(historyNestedValue(history, ["createTime", "create_time", "updatedAt", "updated_at"]) || 0);
      const position = Number(historyNestedValue(history, ["position", "playbackPosition", "playback_position"]) || 0);
      const duration = Number(historyNestedValue(history, ["duration", "durationMs", "duration_ms"]) || 0);
      const progressText = historyProgressText(history);
      const restorable = isRestorableHistory(history);
      const replayKind = historyReplayKind(history, parts, restorable);
      const stableKey = historyStableKey(history, parts, index);
      return {
        id: "history:" + stableKey.replace(/[\r\n]+/g, " "),
        source: "history",
        nativeHistoryRaw: history,
        nativeHistoryKey: parts.key,
        nativeCid: parts.cid,
        nativeSiteKey: parts.siteKey,
        nativeVodId: parts.vodId,
        historyKey: parts.key || stableKey,
        historyStableKey: stableKey,
        siteKey: parts.siteKey,
        vodId: parts.vodId,
        cid: parts.cid,
        tmdbId: context.tmdbId,
        mediaType: context.mediaType,
        title,
        originalTitle: context.originalTitle || "",
        resourceSearchTitle: context.resourceSearchTitle || "",
        aliases: mergeTitleAliases(context.aliases, title, context.originalTitle),
        vodName: title,
        pic,
        vodPic: pic,
        image: pic,
        landscape: context.backdrop || "",
        remark: progressText || (badge ? "继续观看" : ""),
        badge,
        vodRemarks: badge,
        progress: historyProgressPercent(history),
        desc: [badge, progressText].filter(Boolean).join(" · ") || title,
        releaseDate: "",
        voteAverage: 0,
        popularity: createTime,
        baseRank: index + 1,
        createTime,
        updatedAt: createTime,
        position,
        duration,
        nativeHistoryType: String(history && history.type || historyNestedValue(history, ["type", "playType", "kind"]) || ""),
        nativeHistorySource: String(history && history.source || historyNestedValue(history, ["source", "siteKey", "site"]) || ""),
        episodeUrl: String(history && history.episodeUrl || historyNestedValue(history, ["episodeUrl", "episode_url"]) || ""),
        url: String(history && history.url || historyNestedValue(history, ["url", "playUrl", "play_url"]) || ""),
        seasonNumber: context.seasonNumber,
        episodeNumber: context.episodeNumber,
        episodeTitle: context.episodeTitle,
        backdrop: context.backdrop,
        sourceType: context.sourceType,
        panProvider: context.panProvider,
        panPassword: context.panPassword,
        panTitle: context.panTitle,
        panFileName: context.panFileName,
        panFileId: context.panFileId,
        resourceId: context.resourceId,
        panSearchKeyword: context.panSearchKeyword,
        lastPlayUrl: context.lastPlayUrl,
        historySiteKind: historySiteKind(history, parts, restorable),
        historyReplayKind: replayKind,
        historyRestorable: restorable,
        historyReplayable: restorable || ((replayKind === "PAN_NATIVE" || replayKind === "URL_NATIVE") && !!title)
      };
    }

    function recordHistoryItemDiag(history, item, visibility, restorable, replayKind) {
      const parts = historyKeyParts(history);
      const poster = historyNestedValue(history, ["vodPic", "pic", "poster"]);
      const position = Number(historyNestedValue(history, ["position", "playbackPosition", "playback_position"]) || 0);
      const duration = Number(historyNestedValue(history, ["duration", "durationMs", "duration_ms"]) || 0);
      const createTime = Number(historyNestedValue(history, ["createTime", "create_time", "updatedAt", "updated_at"]) || 0);
      const diag = {
        siteKind: item && item.historySiteKind || historySiteKind(history, parts, restorable),
        replayKind: item && item.historyReplayKind || replayKind || historyReplayKind(history, parts, restorable),
        hasTitle: !!historyTitleValue(history),
        hasPoster: !!String(poster || "").trim(),
        hasPosition: Number.isFinite(position) && position > 0,
        hasDuration: Number.isFinite(duration) && duration > 0,
        hasCreateTime: Number.isFinite(createTime) && createTime > 0,
        visible: !!(visibility && visibility.visible),
        restorable: !!restorable,
        hiddenReason: visibility && visibility.hiddenReason || ""
      };
      if (state.tvDiag) state.tvDiag.historyItem = diag;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV][HISTORY_ITEM_DIAG]", diag); } catch (e) {}
      }
      return diag;
    }

    function recordHistoryCompatDiag(diag) {
      if (state.tvDiag) state.tvDiag.historyCompat = diag;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV][HISTORY_COMPAT_DIAG]", diag); } catch (e) {}
        updateTvDiagnostic();
      }
    }

    function normalizeHistoryList(list) {
      const seen = new Set();
      const entries = (Array.isArray(list) ? list : [])
        .map((history, index) => ({ history, index }))
        .sort((a, b) => Number(historyNestedValue(b.history, ["createTime", "create_time", "updatedAt", "updated_at"]) || 0)
          - Number(historyNestedValue(a.history, ["createTime", "create_time", "updatedAt", "updated_at"]) || 0) || a.index - b.index);
      const hiddenReasons = {};
      let hiddenCount = 0;
      let visibleCandidateCount = 0;
      let duplicateCount = 0;
      const normalized = [];
      entries.forEach((entry) => {
        const history = entry.history;
        const visibility = historyVisibilityInfo(history);
        const visible = isVisibleRecentHistory(history);
        const restorable = isRestorableHistory(history);
        const replayKind = historyReplayKind(history, null, restorable);
        if (!visible) {
          hiddenCount++;
          hiddenReasons[visibility.hiddenReason] = Number(hiddenReasons[visibility.hiddenReason] || 0) + 1;
          recordHistoryItemDiag(history, null, visibility, restorable, replayKind);
          return;
        }
        visibleCandidateCount++;
        const item = normalizeHistoryItem(history, entry.index);
        recordHistoryItemDiag(history, item, visibility, restorable, replayKind);
        const key = item.historyStableKey || item.historyKey;
        if (!key || seen.has(key)) {
          duplicateCount++;
          return;
        }
        seen.add(key);
        normalized.push(item);
      });
      const restorableCount = normalized.filter((item) => item.historyRestorable === true).length;
      recordHistoryCompatDiag({
        rawCount: entries.length,
        visibleCount: normalized.length,
        hiddenCount,
        restorableCount,
        nonRestorableVisibleCount: normalized.length - restorableCount,
        visibleCandidateCount,
        duplicateCount,
        hiddenReasons
      });
      return normalized;
    }

    function detailHistoryTitleCandidates(item) {
      return [
        item && item.title,
        item && item.name,
        item && item.query,
        item && item.originalTitle,
        item && item.original_name,
        item && item.original_title
      ].map(normalizeTitle).filter(Boolean);
    }

    function detailHistoryVodIdMatchesTmdb(tmdbId, vodId) {
      const id = String(tmdbId || "").trim();
      const value = String(vodId || "").trim();
      if (!id || !value) return false;
      if (value === id) return true;
      if (/tmdb/i.test(value) && value.split(/[^a-z0-9]+/i).includes(id)) return true;
      return false;
    }

    function historyCanUseVodReplay(history) {
      return !!(history && history.source === "history" && history.historyRestorable === true && history.historyReplayKind === "VOD" && history.siteKey && history.vodId);
    }

    function historyCanContinuePlayback(history) {
      if (historyCanUseVodReplay(history)) return true;
      if (!history || history.source !== "history") return false;
      const kind = String(history.historyReplayKind || historyReplayKind(history, null, false));
      return (kind === "PAN_NATIVE" || kind === "URL_NATIVE") && !!historyTitleValue(history);
    }

    function historyPlaybackPositionValue(history) {
      const values = [
        history && history.position,
        history && history.playbackPosition,
        history && history.playback_position,
        history && history.positionMs,
        history && history.position_ms,
        historyNestedValue(history, ["position", "playbackPosition", "playback_position", "positionMs", "position_ms"]),
        history && history.nativeHistoryRaw && history.nativeHistoryRaw !== history ? history.nativeHistoryRaw.position : 0,
        history && history.nativeHistoryRaw && history.nativeHistoryRaw !== history ? history.nativeHistoryRaw.playbackPosition : 0,
        history && history.nativeHistoryRaw && history.nativeHistoryRaw !== history ? history.nativeHistoryRaw.playback_position : 0,
        history && history.nativeHistoryRaw && history.nativeHistoryRaw !== history ? history.nativeHistoryRaw.positionMs : 0,
        history && history.nativeHistoryRaw && history.nativeHistoryRaw !== history ? history.nativeHistoryRaw.position_ms : 0
      ];
      return values.reduce((best, value) => {
        const number = Number(value || 0);
        return Number.isFinite(number) && number > best ? number : best;
      }, 0);
    }

    function detailHistoryMatches(item, history) {
      if (!item || !history || !historyCanContinuePlayback(history)) return false;
      const context = historyPlaybackContext(history);
      const replayKind = String(history.historyReplayKind || historyReplayKind(history, null, historyCanUseVodReplay(history)));
      if (item.mediaType && context.mediaType && item.mediaType !== context.mediaType) return false;
      const tmdbId = item.tmdbId ? String(item.tmdbId) : item.id && /^tmdb:/i.test(String(item.id)) ? String(item.id).split(":").pop() : "";
      if (detailHistoryVodIdMatchesTmdb(tmdbId, history.vodId) || detailHistoryVodIdMatchesTmdb(tmdbId, context.tmdbId)) return true;
      const title = normalizeTitle(history.title || context.title || "");
      if (!title) return false;
      if (replayKind !== "VOD") {
        return detailHistoryTitleCandidates(item).some((candidate) => candidate === title);
      }
      return detailHistoryTitleCandidates(item).some((candidate) => {
        if (!candidate) return false;
        if (candidate === title) return true;
        return candidate.length >= 4 && title.length >= 4 && (candidate.includes(title) || title.includes(candidate));
      });
    }

    function detailHasAuthoritativeNativeHistory(history) {
      return !!(history
        && history.source === "history"
        && (history.nativeHistoryRaw && typeof history.nativeHistoryRaw === "object"
          || String(history.nativeHistoryKey || "").trim())
        && historyCanContinuePlayback(history)
        && historyPlaybackPositionValue(history) > 0);
    }

    function detailAuthoritativeNativeHistoryFor(item, candidate, options) {
      if (!item || !candidate) return null;
      if (options && options.freshNative && detailHasAuthoritativeNativeHistory(candidate) && detailHistoryMatches(item, candidate)) return candidate;
      const candidateIdentity = nativeHistoryDeleteIdentityKey(candidate);
      return (state.recent.items || []).find((history) => {
        if (!detailHasAuthoritativeNativeHistory(history) || !detailHistoryMatches(item, history)) return false;
        if (history === candidate) return true;
        return !!candidateIdentity && nativeHistoryDeleteIdentityKey(history) === candidateIdentity;
      }) || null;
    }

    function detailContinueHistoryIsValid(history) {
      return detailHasAuthoritativeNativeHistory(history);
    }

    function recentNativeHistoryWinnerFor(item, list) {
      const source = Array.isArray(list) ? list : (state.recent.items || []);
      const mediaKey = recentWatchingMediaKey(item);
      let candidates = mediaKey
        ? source.filter((history) => history && recentWatchingMediaKey(history) === mediaKey)
        : [];
      if (!candidates.length) {
        candidates = source.filter((history) => history && detailHistoryMatches(item, history));
      }
      return uniqueRecentWatchingMedia(candidates)[0] || null;
    }

    function findDetailContinueHistory(item) {
      const winner = recentNativeHistoryWinnerFor(item);
      return winner && detailHasAuthoritativeNativeHistory(winner) && detailHistoryMatches(item, winner)
        ? winner
        : null;
    }

    function recordDetailPlaybackDecision(name, item, detail) {
      const payload = Object.assign({
        itemKey: item ? panSearchItemKey(item) : "",
        continueContextFound: false,
        continueUrlFound: false,
        playbackReturnFound: false,
        nativeHistoryKnown: false,
        nativeHistoryFound: false,
        lastPlayUrlFound: false,
        nativeProgress: 0,
        decision: "",
        curatedStarted: false
      }, detail || {});
      try {
        console.debug(String(name || "DETAIL_PLAYBACK_DECISION"), payload);
      } catch (e) {}
      if (state.tvDiag) state.tvDiag[String(name || "DETAIL_PLAYBACK_DECISION")] = payload;
      return payload;
    }

    function detailContinueResourceCandidateFor(item, target) {
      if (!item || !target || !playbackTargetMatchesItem(target, item)) return null;
      const normalizedTarget = normalizePlaybackTarget(item, target);
      const candidate = buildDirectPanHistoryItem(normalizedTarget);
      if (!normalizedTarget || !candidate || !candidate.url || !candidate.diskType) return null;
      const payload = buildPanPlayPayload(candidate);
      if (!payload || !payload.type || !payload.url) return null;
      return { target: normalizedTarget, candidate };
    }

    function detailContinueResourceContextFor(item, nativeHistory) {
      if (!item) return null;
      const add = (source, target, contextFound, history) => {
        const resource = detailContinueResourceCandidateFor(item, target);
        if (!resource) return null;
        return Object.assign({}, resource, {
          source,
          contextFound: !!contextFound,
          history: history || null
        });
      };

      // Native History winner 与 HTML Recent 使用同一媒体级选择规则，
      // 先尝试当前展示的精确线路；缓存上下文只作为续播资源 fallback。
      const history = nativeHistory || findDetailContinueHistory(item);
      if (detailContinueHistoryIsValid(history)) {
        const historyTarget = detailContinuePlaybackTargetFor(item, history);
        const found = add("native-history", historyTarget, false, history);
        if (found) return found;
      }

      // Continue Index / History Context 仅作为续播线路的 fallback。
      const primaryContext = findContinueWatchingContext(item);
      const localContexts = [primaryContext]
        .concat(recentWatchingContextCandidates().filter((candidate) => (
          candidate && playbackTargetMatchesItem(candidate.historyContextTarget, item)
        )))
        .filter(Boolean);
      for (const context of localContexts) {
        const contextTarget = detailContinuePlaybackTargetFor(item, context);
        const found = add("continue-context", contextTarget, true, null);
        if (found) return found;
      }

      // 播放器返回快照在 WebView 尚未重新加载 cache 时仍可直接恢复。
      const playbackReturn = state.pan && state.pan.playbackReturn;
      if (playbackReturn) {
        const returnTarget = normalizePlaybackTarget(item, Object.assign(
          {},
          playbackReturn.item || {},
          playbackReturn,
          playbackReturn.episodeTarget || {}
        ));
        const found = add("playback-return", returnTarget, true, null);
        if (found) return found;
      }

      return null;
    }

    async function resolveDetailContinueResource(item, run) {
      if (!item) return null;
      let resource = detailContinueResourceContextFor(item);
      if (resource) return resource;
      const contextsLoaded = !!(state.historyContexts && state.historyContexts.loaded);
      const continueLoaded = !!(state.continueIndex && state.continueIndex.loaded);
      if (contextsLoaded && continueLoaded) return null;
      let timer = 0;
      const loadTask = Promise.all([
        loadHistoryContextIndex(),
        loadContinueIndex()
      ]).catch(() => null);
      try {
        await Promise.race([
          loadTask,
          new Promise((resolve) => {
            timer = setTimeout(() => resolve(null), DETAIL_CONTINUE_GATE_MAX_MS);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
      if (run && !detailPlaybackIsCurrent(run)) return null;
      resource = detailContinueResourceContextFor(item);
      return resource;
    }

