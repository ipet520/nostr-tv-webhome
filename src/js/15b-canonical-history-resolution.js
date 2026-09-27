    function canonicalResourceKey(item) {
      const mediaType = normalizeHistoryMediaType(item && (item.mediaType || item.media_type));
      const tmdbId = String(item && (item.tmdbId || item.tmdb_id) || "").trim();
      return mediaType && tmdbId ? `${mediaType}:${tmdbId}` : "";
    }

    function applyCanonicalResourceIdentity(item, identity) {
      if (!item || !identity) return item;
      const resourceSearchTitle = String(identity.resourceSearchTitle || identity.title || "").trim();
      if (resourceSearchTitle) item.resourceSearchTitle = resourceSearchTitle;
      ["genreIds", "releaseDate", "originalLanguage", "originCountries"].forEach((field) => {
        const value = identity[field];
        const hasValue = Array.isArray(value)
          ? value.length > 0
          : String(value == null ? "" : value).trim() !== "";
        if (!hasValue) return;
        item[field] = Array.isArray(value) ? value.slice() : value;
      });
      item.aliases = mergeTitleAliases(
        item.aliases,
        identity.aliases,
        item.title,
        item.originalTitle,
        identity.title,
        identity.originalTitle
      );
      return item;
    }

    function canonicalAlternativeTitlesFromDetail(item, detail) {
      const mediaType = normalizeHistoryMediaType(item && (item.mediaType || item.media_type));
      const container = detail && detail.alternative_titles;
      const entries = mediaType === "tv"
        ? container && container.results
        : container && container.titles;
      if (!Array.isArray(entries)) return [];
      const allowedRegions = new Set(["CN", "HK", "TW", "SG", "MO"]);
      return entries
        .filter((entry) => entry && allowedRegions.has(String(entry.iso_3166_1 || "").trim().toUpperCase()))
        .map((entry) => String(entry.title || "").trim())
        .filter(Boolean);
    }

    function canonicalMainlandResourceTitleFromDetail(item, detail, localizedTitle, detailOriginalTitle) {
      const localized = String(localizedTitle || "").trim();
      if (titleHasChinese(localized)) return localized;
      const mediaType = normalizeHistoryMediaType(item && (item.mediaType || item.media_type));
      const container = detail && detail.alternative_titles;
      const entries = mediaType === "tv"
        ? container && container.results
        : container && container.titles;
      if (Array.isArray(entries)) {
        const mainlandTitle = entries
          .filter((entry) => String(entry && entry.iso_3166_1 || "").trim().toUpperCase() === "CN")
          .map((entry) => String(entry && entry.title || "").trim())
          .find((title) => title && titleHasChinese(title));
        if (mainlandTitle) return mainlandTitle;
      }
      return localized
        || String(detailOriginalTitle || "").trim()
        || String(item && item.title || "").trim()
        || String(item && item.originalTitle || "").trim()
        || "";
    }

    function canonicalDetailLooksRaw(item, detail) {
      if (!detail || typeof detail !== "object") return false;
      const mediaType = normalizeHistoryMediaType(item && (item.mediaType || item.media_type));
      const tmdbId = String(item && (item.tmdbId || item.tmdb_id) || "").trim();
      if (!mediaType || !tmdbId || String(detail.id || detail.tmdbId || "").trim() !== tmdbId) return false;
      const detailTitle = mediaType === "tv"
        ? detail.name || detail.original_name
        : detail.title || detail.original_title;
      if (!String(detailTitle || "").trim()) return false;
      const hasRawDetailField = mediaType === "tv"
        ? Object.prototype.hasOwnProperty.call(detail, "genres")
          || Object.prototype.hasOwnProperty.call(detail, "genre_ids")
          || Object.prototype.hasOwnProperty.call(detail, "first_air_date")
          || Object.prototype.hasOwnProperty.call(detail, "alternative_titles")
        : Object.prototype.hasOwnProperty.call(detail, "genres")
          || Object.prototype.hasOwnProperty.call(detail, "genre_ids")
          || Object.prototype.hasOwnProperty.call(detail, "release_date")
          || Object.prototype.hasOwnProperty.call(detail, "alternative_titles");
      return hasRawDetailField;
    }

    function canonicalExactDetailFor(item) {
      const mediaType = normalizeHistoryMediaType(item && (item.mediaType || item.media_type));
      const tmdbId = String(item && (item.tmdbId || item.tmdb_id) || "").trim();
      if (!mediaType || !tmdbId) return null;
      const matches = (detail) => {
        if (!canonicalDetailLooksRaw(item, detail)) return null;
        const detailType = normalizeHistoryMediaType(detail.mediaType || detail.media_type);
        return detailType && detailType !== mediaType ? null : detail;
      };
      const current = matches(state.detail);
      if (current) return current;
      if (mediaType === "tv") return matches(tvDetailCacheValue(item));
      if (mediaType === "movie") return matches(movieDetailCacheValue(item));
      return null;
    }

    function canonicalExactDetailUrl(item) {
      const url = new URL(tmdbDetailUrl(item));
      url.searchParams.set("language", "zh-CN");
      return url.toString();
    }

    function canonicalIdentityContextFromDetail(item, detail) {
      if (!detail || typeof detail !== "object") return {};
      const mediaType = normalizeHistoryMediaType(item && (item.mediaType || item.media_type));
      const genreValues = Array.isArray(detail.genres)
        ? detail.genres.map((genre) => genre && genre.id)
        : Array.isArray(detail.genre_ids) ? detail.genre_ids : [];
      const genreIds = Array.from(new Set(genreValues
        .map((value) => String(value == null ? "" : value).trim())
        .filter(Boolean)));
      const releaseDate = String(
        mediaType === "tv"
          ? detail.first_air_date || ""
          : detail.release_date || ""
      ).trim();
      const originalLanguage = String(detail.original_language || "").trim();
      const originValues = Array.isArray(detail.origin_country)
        ? detail.origin_country
        : [];
      const originCountries = Array.from(new Set(originValues
        .map((value) => String(value == null ? "" : value).trim())
        .filter(Boolean)));
      const context = {};
      if (genreIds.length) context.genreIds = genreIds;
      if (releaseDate) context.releaseDate = releaseDate;
      if (originalLanguage) context.originalLanguage = originalLanguage;
      if (originCountries.length) context.originCountries = originCountries;
      return context;
    }

    function canonicalIdentityFromDetail(item, detail) {
      const mediaType = normalizeHistoryMediaType(item && (item.mediaType || item.media_type));
      const localizedTitle = String((mediaType === "tv" ? detail && detail.name : detail && detail.title) || "").trim();
      if (!localizedTitle) return null;
      const detailOriginalTitle = String((mediaType === "tv" ? detail && detail.original_name : detail && detail.original_title) || "").trim();
      return Object.assign({
        title: item.title,
        originalTitle: item.originalTitle || detailOriginalTitle,
        resourceSearchTitle: canonicalMainlandResourceTitleFromDetail(item, detail, localizedTitle, detailOriginalTitle),
        aliases: mergeTitleAliases(
          item.aliases,
          item.title,
          item.originalTitle,
          localizedTitle,
          ...canonicalAlternativeTitlesFromDetail(item, detail),
          detail && detail.name,
          detail && detail.title,
          detail && detail.original_name,
          detail && detail.original_title
        ),
        authority: "EXACT_DETAIL",
        canonicalResolved: true
      }, canonicalIdentityContextFromDetail(item, detail));
    }

    async function resolveCanonicalResourceTitle(item) {
      if (!item || typeof item !== "object") return item;
      const key = canonicalResourceKey(item);
      if (!key) {
        applyCanonicalResourceIdentity(item, {
          resourceSearchTitle: item.title || item.originalTitle || "",
          title: item.title,
          originalTitle: item.originalTitle,
          aliases: item.aliases
        });
        return item;
      }
      const cached = canonicalResourceTitleCache.has(key)
        ? canonicalResourceCacheEntry(canonicalResourceTitleCache.get(key))
        : null;
      if (cached && cached.authority === "EXACT_DETAIL") {
        return applyCanonicalResourceIdentity(item, cached);
      }
      const pending = canonicalResourceTitlePromises.get(key);
      if (pending) return applyCanonicalResourceIdentity(item, await pending);

      const task = (async () => {
        const mediaType = String(item.mediaType || item.media_type || "").toLowerCase();
        const tmdbId = String(item.tmdbId || item.tmdb_id || "").trim();
        const query = String(item.originalTitle || item.title || "").trim();
        const fallback = cached || {
          title: item.title,
          originalTitle: item.originalTitle,
          resourceSearchTitle: item.resourceSearchTitle || item.title || item.originalTitle || "",
          aliases: mergeTitleAliases(item.aliases, item.title, item.originalTitle),
          authority: "ITEM_FALLBACK"
        };
        let exactDetailContext = {};
        const fallbackIdentity = (patch) => {
          const next = patch || {};
          return Object.assign({}, fallback, exactDetailContext, next, {
            title: item.title,
            originalTitle: item.originalTitle || fallback.originalTitle,
            resourceSearchTitle: next.resourceSearchTitle || fallback.resourceSearchTitle || item.title || item.originalTitle || "",
            aliases: mergeTitleAliases(
              fallback.aliases,
              item.aliases,
              item.title,
              item.originalTitle,
              next.aliases
            ),
            authority: canonicalResourceAuthority(next.authority || fallback.authority || "ITEM_FALLBACK")
          });
        };
        if ((mediaType === "tv" || mediaType === "movie") && tmdbId) {
          let exactDetail = canonicalExactDetailFor(item);
          if (!exactDetail) {
            try {
              exactDetail = mediaType === "tv"
                ? await requestTvDetailShared(item)
                : await requestMovieDetailShared(item);
            } catch (e) {}
          }
          exactDetailContext = canonicalIdentityContextFromDetail(item, exactDetail);
          const exactIdentity = canonicalIdentityFromDetail(item, exactDetail);
          if (exactIdentity) return exactIdentity;
          if (!query) {
            return fallbackIdentity();
          }
          try {
            const body = await requestJson(tmdbSearchUrl(query), 18);
            const results = Array.isArray(body && body.results) ? body.results : [];
            const matched = results.find((result) => String(result && result.id || "") === tmdbId
              && String(result && result.media_type || "").toLowerCase() === mediaType);
            if (matched) {
              const localizedTitle = String((mediaType === "tv" ? matched.name : matched.title) || "").trim();
              const originalTitle = String((mediaType === "tv" ? matched.original_name : matched.original_title) || "").trim();
              return Object.assign({
                title: item.title,
                originalTitle: item.originalTitle || originalTitle,
                resourceSearchTitle: localizedTitle || originalTitle || item.title || "",
                aliases: mergeTitleAliases(
                  item.aliases,
                  item.title,
                  item.originalTitle,
                  localizedTitle,
                  originalTitle
                ),
                authority: "SEARCH_MULTI_FALLBACK",
                canonicalResolved: true
              }, exactDetailContext);
            }
          } catch (e) {}
        }
        return fallbackIdentity();
      })();
      canonicalResourceTitlePromises.set(key, task);
      try {
        const identity = await task;
        const cacheEntry = canonicalResourceCacheEntry(identity);
        if (cacheEntry) canonicalResourceTitleCache.set(key, cacheEntry);
        return applyCanonicalResourceIdentity(item, cacheEntry || identity);
      } finally {
        if (canonicalResourceTitlePromises.get(key) === task) canonicalResourceTitlePromises.delete(key);
      }
    }

    function normalizeTitle(title) {
      return String(title || "")
        .toLowerCase()
        .replace(/[第][一二三四五六七八九十0-9]+[季部]?/g, "")
        .replace(/\s+/g, "")
        .replace(/[·:：,，.。!！?？'"“”‘’《》<>【】()[\]{}_-]/g, "")
        .trim();
    }

    function resolveHistoryMedia(history) {
      const context = historyPlaybackContext(history);
      const pool = allItems().concat(state.searchItems || []).filter(Boolean);
      if (context.tmdbId) {
        const byId = pool.find((item) => String(item.tmdbId || "") === context.tmdbId
         && (!context.mediaType || !item.mediaType || item.mediaType === context.mediaType));
        if (byId) return byId;
        if (context.mediaType === "movie" || context.mediaType === "tv") {
          return {
            id: `tmdb:${context.mediaType}:${context.tmdbId}`,
            source: "tmdb",
            tmdbId: context.tmdbId,
            mediaType: context.mediaType,
            title: context.title || "最近观看",
            originalTitle: context.originalTitle || "",
            resourceSearchTitle: context.resourceSearchTitle || "",
            aliases: mergeTitleAliases(context.aliases, context.title, context.originalTitle),
            pic: context.poster || "",
            image: context.poster || "",
            landscape: "",
            desc: context.title || ""
          };
        }
      }
      const title = normalizeTitle(context.title);
      if (title) {
        const matches = pool.filter((item) => normalizeTitle(item.title) === title
          && (!context.mediaType || !item.mediaType || item.mediaType === context.mediaType));
        const unique = Array.from(new Map(matches.map((item) => [mediaDomKey(item), item])).values());
        if (unique.length === 1) return unique[0];
      }
      return null;
    }

