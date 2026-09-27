    function normalizedPanHistoryName(value) {
      return String(value || "")
        .toLowerCase()
        .replace(/\.[a-z0-9]{1,8}(?=$|[\s._-])/gi, "")
        .replace(/[\s._\-—–:：|/\\()[\]{}【】<>]+/g, "")
        .trim();
    }

    function stablePanHistoryId(value) {
      const text = String(value || "").trim();
      return text && !historyUrlLike(text) ? text : "";
    }

    function panHistoryCandidateId(item) {
      return stablePanHistoryId(item && (item.resourceId || item.resource_id || item.panFileId || item.pan_file_id || item.fileId || item.file_id));
    }

    function panHistoryCandidateName(item) {
      return normalizedPanHistoryName(item && (item.fileName || item.file_name || item.filename || item.title || ""));
    }

    function panHistoryCandidateFitsTarget(item, target) {
      if (!item || !target || target.mediaType !== "tv" || !target.episodeNumber) return true;
      const season = Number(target.seasonNumber || 1);
      const episode = Number(target.episodeNumber || 0);
      if (panItemMatchesEpisode(item, season, episode) || panItemIsSeasonPack(item, season)) return true;
      const title = String(item.title || item.fileName || "");
      const seasonMarker = title.match(/S0*(\d+)(?![0-9])/i) || title.match(/第\s*0*(\d+)\s*季/);
      if (seasonMarker && Number(seasonMarker[1]) !== season) return false;
      if (/(?:S\s*0*\d+\s*E\s*0*\d+|\bE\s*0*\d+|第\s*0*\d+\s*集)/i.test(title)) return false;
      return true;
    }

    function matchPanHistoryResource(historyOrTarget, results) {
      const target = normalizePlaybackTarget(state.selected, historyOrTarget);
      const list = (Array.isArray(results) ? results : []).filter(Boolean);
      if (!target || !list.length) return null;
      const targetId = stablePanHistoryId(target.resourceId || target.panFileId);
      if (targetId) {
        const exactId = list.find((item) => panHistoryCandidateId(item) === targetId);
        if (exactId) return exactId;
      }
      const targetName = normalizedPanHistoryName(target.panFileName);
      const targetProvider = normalizePanDiskType(target.panProvider || "");
      if (targetName) {
        const named = list.filter((item) => panHistoryCandidateName(item) === targetName && panHistoryCandidateFitsTarget(item, target));
        const providerMatch = named.find((item) => !targetProvider || normalizePanDiskType(item.diskType) === targetProvider);
        if (providerMatch) return providerMatch;
        if (named.length === 1) return named[0];
      }
      const targetUrl = String(target.lastPlayUrl || "").trim();
      if (targetUrl) {
        const normalizedUrl = normalizePanUrl(targetUrl);
        const urlMatch = list.find((item) => normalizePanUrl(item && (item.normalizedUrl || item.url) || "") === normalizedUrl
          && panHistoryCandidateFitsTarget(item, target));
        if (urlMatch) return urlMatch;
      }
      return null;
    }

    function openPanHistoryItem(history, options) {
      const resolved = resolveHistoryMedia(history);
      if (!resolved) {
        toast("暂时无法恢复播放");
        return false;
      }
      const media = Object.assign({}, resolved, {
        nativeHistoryRaw: history && history.nativeHistoryRaw,
        nativeHistoryKey: history && history.nativeHistoryKey,
        nativeCid: history && history.nativeCid,
        nativeSiteKey: history && history.nativeSiteKey,
        nativeVodId: history && history.nativeVodId
      });
      const context = normalizePlaybackTarget(media, historyPlaybackContext(history));
      const opts = options || {};
      if (context) setDetailPlaybackTarget(media, context);
      state.historyResume = {
        history,
        context,
        mediaKey: mediaDomKey(media),
        at: Date.now()
      };
      openDetail(media, {
        returnTarget: opts.returnTarget || document.activeElement,
        historyContext: context,
        historyResume: true
      });
      return true;
    }

    function buildDirectPanHistoryItem(target) {
      if (!target) return null;
      const url = String(target.lastPlayUrl || "").trim();
      const provider = resolvePanProviderForHistory(target);
      if (!url || !provider) return null;
      return {
        key: "history-direct|" + normalizePanUrl(url),
        diskType: normalizePanDiskType(provider),
        provider,
        url,
        normalizedUrl: url,
        password: String(target.panPassword || "").trim(),
        title: String(target.panTitle || target.panFileName || target.title || "盘搜资源").trim(),
        fileName: String(target.panFileName || "").trim(),
        fileId: String(target.panFileId || "").trim(),
        resourceId: String(target.resourceId || "").trim()
      };
    }

    async function resumePanHistoryFromSearch(item, target, preloadTask) {
      if (!item || state.selected !== item) return false;
      if (preloadTask && typeof preloadTask.then === "function") await preloadTask;
      if (state.selected !== item) return false;
      const waitUntil = Date.now() + 2600;
      while (state.selected === item && Date.now() < waitUntil) {
        const progress = state.pan.progress || {};
        if ((state.pan.results || []).length || !progress.active) break;
        await new Promise((resolve) => setTimeout(resolve, 140));
      }
      if (state.selected !== item) return false;
      const match = matchPanHistoryResource(target, state.pan.results);
      if (match) {
        state.historyResume = null;
        toast("正在恢复上次播放资源…");
        await playPanResult(match, { episodeTarget: target, historyResume: true });
        return true;
      }
      state.historyResume = null;
      toast("上次播放资源暂不可用，可使用盘搜重新选择");
      return false;
    }

    async function playNativeHistoryExact(item, options) {
      const opts = options || {};
      if (!item) return false;
      const context = historyPlaybackContext(item) || {};
      const nativeSiteKey = String(item.siteKey || context.siteKey || "").trim();
      const nativeVodId = String(item.vodId || context.vodId || "").trim();
      if (!nativeSiteKey || !nativeVodId) return false;
      const nativeIdentity = {
        siteKey: nativeSiteKey,
        vodId: nativeVodId,
        episodeUrl: nativeVodId,
        episodeName: context.episodeTitle || context.panTitle || context.title || item.title,
        flag: context.flag || item.flag || "",
        playbackOrigin: playbackOriginForNativeIdentity(item, { siteKey: nativeSiteKey, vodId: nativeVodId })
      };
      const watchItem = opts.watchItem || item;
      if (opts.detail) rememberDetailReturn(opts.button || $("detailContinueBtn"));
      else rememberHomeReturn(item, opts.returnTarget || document.activeElement, { origin: "recent_native_player" });
      saveUiSnapshotNow();
      rememberWatchIntent(watchItem, "view", context, nativeIdentity);
      // 用 localStorage 持久化标记，WebView 被挂起后 JS 内存会丢失
      // visibilitychange/pageshow/fmresume 恢复时读到此标记，保持当前页面不重置
      localStorage.setItem("fm_pan_playing", "1");
      try {
        await sdk().vod(nativeSiteKey, nativeVodId, item.title || context.title, item.pic || context.poster);
        await saveHistoryPlaybackContext(watchItem, context);
        startWatchTracking(watchItem, context, nativeIdentity);
        return true;
      } catch (e) {
        localStorage.removeItem("fm_pan_playing");
        throw e;
      }
    }

    async function openRecentItem(item, options) {
      const opts = options || {};
      const returnTarget = opts.returnTarget || document.activeElement;
      if (!item) {
        toast("最近观看缺少播放信息");
        return;
      }
      const context = historyPlaybackContext(item) || {};
      const nativeSiteKey = String(item.siteKey || context.siteKey || "").trim();
      const nativeVodId = String(item.vodId || context.vodId || "").trim();
      if (item.continueContext) {
        if (!openContinueWatchingContext(item, { returnTarget, autoResume: false })) toast("暂时无法恢复播放");
        return;
      }
      // Native History owns the original site/vod identity.  When it is
      // present, keep the native route as the primary action regardless of
      // WebHome's replay-kind classification; TMDB/Detail is compatibility
      // fallback only for records without a legal native identity.
      if (!nativeSiteKey || !nativeVodId) {
        openPanHistoryItem(item, { returnTarget });
        return;
      }
      try {
        await playNativeHistoryExact(item, { returnTarget });
      } catch (e) {
        toast("打开最近观看失败：" + (e.message || "unknown"));
      }
    }

    function mediaDomKey(item) {
      if (!item) return "";
      return item.id || (item.tmdbId && item.mediaType ? `tmdb:${item.mediaType}:${item.tmdbId}` : item.title || "");
    }

    function mediaRenderKey(item) {
      if (!item) return "";
      return [mediaDomKey(item), item.title, item.pic, item.remark, item.voteAverage, item.people, item.progress, item.badge]
        .map((value) => String(value == null ? "" : value).replace(/[\r\n]+/g, " "))
        .join("\t");
    }

    function mediaHeatKey(item) {
      if (!item) return "";
      const mediaType = item.mediaType || "";
      const tmdbId = item.tmdbId || "";
      if (mediaType && tmdbId) return `tmdb:${mediaType}:${tmdbId}`;
      const title = normalizeTitle(item.title || item.query || "");
      return title ? `title:${title}` : "";
    }

    function preferenceItems() {
      return state.hot.items;
    }

    function historyNestedContainers(history) {
      if (!history || typeof history !== "object") return [];
      const containers = [history];
      ["item", "playbackTarget", "media", "content", "tmdb", "context", "extra", "playback", "meta", "data", "detail"].forEach((key) => {
        const value = history[key];
        if (value && typeof value === "object" && !Array.isArray(value)) containers.push(value);
      });
      return containers;
    }

    function historyNestedValue(history, keys) {
      const containers = historyNestedContainers(history);
      for (const container of containers) {
        for (const key of keys || []) {
          const value = container[key];
          if (value != null && String(value).trim()) return value;
        }
      }
      return "";
    }

    function historyMediaIdentity(history) {
      const containers = historyNestedContainers(history);
      const inheritedType = normalizeHistoryMediaType(historyNestedValue(history, ["mediaType", "media_type", "contentType"]));
      const fields = ["tmdbId", "tmdb_id", "tmdbID", "mediaId", "media_id", "tmdb", "id"];
      for (const container of containers) {
        const containerType = normalizeHistoryMediaType(container.mediaType || container.media_type || container.contentType || container.type) || inheritedType;
        for (const field of fields) {
          const value = container[field];
          if (value == null || typeof value === "object") continue;
          const text = String(value).trim();
          if (!text) continue;
          const reference = historyTmdbReference(text);
          if (reference) return reference;
          if (/^\d+$/.test(text) && containerType) return { tmdbId: text, mediaType: containerType };
        }
      }
      return null;
    }

    function normalizeHistoryMediaType(value) {
      const text = String(value || "").trim().toLowerCase();
      if (!text) return "";
      if (/^(tv|电视剧|剧集|series|show)$/.test(text) || /电视剧|剧集|series|show/.test(text)) return "tv";
      if (/^(movie|电影|film)$/.test(text) || /电影|film/.test(text)) return "movie";
      return "";
    }

    function historyTmdbReference(value) {
      const text = String(value || "").trim();
      const match = text.match(/tmdb(?:[:/_-]+)(movie|tv)(?:[:/_-]+)(\d+)/i);
      return match ? { mediaType: String(match[1]).toLowerCase(), tmdbId: String(match[2]) } : null;
    }

    function historyEpisodeMarker(history) {
      const values = [
        historyNestedValue(history, ["seasonEpisode", "season_episode", "episodeCode"]),
        historyNestedValue(history, ["episodeUrl", "episode_url"]),
        historyNestedValue(history, ["vodName", "title", "name"])
      ].map((value) => String(value || "").trim()).filter(Boolean);
      for (const value of values) {
        const se = value.match(/S\s*0*(\d+)\s*E\s*0*(\d+)/i);
        if (se) return { seasonNumber: Number(se[1]), episodeNumber: Number(se[2]) };
        const cn = value.match(/第\s*0*(\d+)\s*季[^第\d]{0,8}第\s*0*(\d+)\s*集/);
        if (cn) return { seasonNumber: Number(cn[1]), episodeNumber: Number(cn[2]) };
      }
      return { seasonNumber: 0, episodeNumber: 0 };
    }

    function historyPersistedMediaConsensus(entries, rawTitleKey) {
      const titleMatches = (Array.isArray(entries) ? entries : []).map((entry, index) => ({ entry, index }))
        .filter((candidate) => normalizeTitle(historyTitleValue(candidate.entry)) === rawTitleKey);
      if (titleMatches.length < 2 || !rawTitleKey) return null;
      const identities = titleMatches.map((candidate) => {
        const identity = historyMediaIdentity(candidate.entry);
        return identity && identity.tmdbId && identity.mediaType
          ? { entry: candidate.entry, index: candidate.index, tmdbId: String(identity.tmdbId), mediaType: identity.mediaType }
          : null;
      });
      if (identities.some((identity) => !identity)) return null;
      const first = identities[0];
      if (!identities.every((identity) => identity.tmdbId === first.tmdbId && identity.mediaType === first.mediaType)) return null;
      const best = identities.slice().sort((a, b) => Number(b.entry && (b.entry.updatedAt || b.entry.at) || 0)
        - Number(a.entry && (a.entry.updatedAt || a.entry.at) || 0) || a.index - b.index)[0];
      return { entry: best.entry, tmdbId: first.tmdbId, mediaType: first.mediaType };
    }

    function historyPlaybackContextHint(history, parts, rawTitle) {
      const keyParts = parts || historyKeyParts(history);
      const panLike = keyParts.siteKey === "push_agent"
        || historyUrlLike(keyParts.siteKey)
        || historyUrlLike(keyParts.vodId)
        || historyUrlLike(keyParts.key)
        || /push[_ -]?agent|pan(?:[_ -]?(?:native|search|play))?|网盘/i.test(historyTypeText(history));
      if (!panLike) return null;
      const rawValues = [keyParts.vodId, historyNestedValue(history, ["url", "playUrl", "play_url", "episodeUrl", "episode_url", "lastPlayUrl", "last_play_url"])]
        .map((value) => String(value || "").trim()).filter(Boolean);
      const rawUrls = rawValues.map((value) => normalizePanUrl(value));
      const rawTitleKey = normalizeTitle(rawTitle || historyTitleValue(history));
      const candidates = [];
      const playbackReturn = state.pan && state.pan.playbackReturn;
      if (playbackReturn) candidates.push({
        at: playbackReturn.at,
        target: playbackReturn.episodeTarget,
        item: playbackReturn.item,
        panProvider: playbackReturn.panProvider,
        panPassword: playbackReturn.panPassword,
        panTitle: playbackReturn.panTitle,
        panFileName: playbackReturn.panFileName,
        panFileId: playbackReturn.panFileId,
        resourceId: playbackReturn.resourceId,
        lastPlayUrl: playbackReturn.lastPlayUrl,
        key: playbackReturn.key
      });
      if (state.watch && state.watch.item) candidates.push({
        at: state.watch.lastAt,
        target: state.watch.playbackTarget,
        item: state.watch.item
      });
      const storedContexts = state.historyContexts && Array.isArray(state.historyContexts.entries) ? state.historyContexts.entries : [];
      const storedConsensus = historyPersistedMediaConsensus(storedContexts, rawTitleKey);
      const storedTitleCounts = storedContexts.reduce((map, entry) => {
        const key = normalizeTitle(entry && entry.title || entry && entry.item && entry.item.title || "");
        if (key) map[key] = Number(map[key] || 0) + 1;
        return map;
      }, {});
      storedContexts.forEach((entry) => candidates.push({
        entry,
        at: entry && (entry.updatedAt || entry.at),
        target: entry && (entry.playbackTarget || entry.target),
        item: entry && entry.item,
        panProvider: entry && entry.panProvider,
        panPassword: entry && entry.panPassword,
        panTitle: entry && entry.panTitle,
        panFileName: entry && entry.panFileName,
        panFileId: entry && entry.panFileId,
        resourceId: entry && entry.resourceId,
        lastPlayUrl: entry && entry.lastPlayUrl,
        key: entry && entry.key,
        persisted: true
      }));
      for (const candidate of candidates) {
        const ageLimit = candidate && candidate.persisted ? HISTORY_CONTEXT_TTL_MS : 15 * 60 * 1000;
        if (!candidate || Date.now() - Number(candidate.at || 0) > ageLimit) continue;
        const target = candidate.target || {};
        const item = candidate.item || {};
        const savedUrls = [candidate.lastPlayUrl, target.lastPlayUrl, item.lastPlayUrl]
          .map((value) => String(value || "").trim()).filter(Boolean);
        if (candidate.key && String(candidate.key).includes("|")) savedUrls.push(String(candidate.key).split("|").slice(1).join("|"));
        const urlMatch = savedUrls.some((value) => rawUrls.includes(normalizePanUrl(value)));
        const rawFileId = String(historyNestedValue(history, ["panFileId", "pan_file_id", "fileId", "file_id"]) || "").trim();
        const rawResourceId = String(historyNestedValue(history, ["resourceId", "resource_id", "resourceID"]) || "").trim();
        const fileMatch = !!(rawFileId && candidate.panFileId && rawFileId === String(candidate.panFileId));
        const resourceMatch = !!(rawResourceId && candidate.resourceId && rawResourceId === String(candidate.resourceId));
        const savedTitle = normalizeTitle(target.title || item.title || "");
        const titleMatch = !!(rawTitleKey && savedTitle && rawTitleKey === savedTitle);
        if (candidate.persisted && titleMatch && !urlMatch && !fileMatch && !resourceMatch && Number(storedTitleCounts[rawTitleKey] || 0) > 1) {
          // Multiple episode contexts are safe only when their media identity
          // agrees.  Keep the newest same-media context for best-effort
          // season/episode recovery, but never guess across different media.
          if (!storedConsensus || candidate.entry !== storedConsensus.entry) continue;
        }
        if (!urlMatch && !fileMatch && !resourceMatch && !titleMatch) continue;
        const lastPlayUrl = target.lastPlayUrl || candidate.lastPlayUrl || item.lastPlayUrl || "";
        const panProvider = resolvePanProviderForHistory({
          diskType: target.diskType || candidate.diskType || item.diskType,
          panProvider: target.panProvider || candidate.panProvider || item.panProvider,
          provider: target.provider || candidate.provider || item.provider,
          lastPlayUrl
        });
        return Object.assign({}, item, target, {
          title: target.title || item.title || "",
          poster: target.poster || item.pic || item.image || "",
          mediaType: target.mediaType || item.mediaType || "",
          tmdbId: target.tmdbId || item.tmdbId || "",
          seasonNumber: target.seasonNumber || item.seasonNumber || 0,
          episodeNumber: target.episodeNumber || item.episodeNumber || 0,
          episodeTitle: target.episodeTitle || item.episodeTitle || "",
          sourceType: target.sourceType || item.sourceType || "",
          panProvider,
          panPassword: target.panPassword || candidate.panPassword || item.panPassword || item.password || "",
          panTitle: target.panTitle || candidate.panTitle || item.panTitle || item.title || "",
          panFileName: target.panFileName || candidate.panFileName || item.panFileName || item.fileName || "",
          panFileId: target.panFileId || candidate.panFileId || item.panFileId || item.fileId || "",
          resourceId: target.resourceId || candidate.resourceId || item.resourceId || "",
          panSearchKeyword: target.panSearchKeyword || item.panSearchKeyword || "",
          lastPlayUrl,
          playbackPosition: target.playbackPosition || item.position || 0,
          duration: target.duration || item.duration || 0,
          updatedAt: target.updatedAt || candidate.at || item.createTime || 0
        });
      }
      return null;
    }

    function historyPlaybackContext(history) {
      const parts = historyKeyParts(history);
      const typeText = historyTypeText(history);
      const rawTitle = historyTitleValue(history);
      const hint = historyPlaybackContextHint(history, parts, rawTitle);
      const title = hint && hint.title || rawTitle;
      const identity = historyMediaIdentity(history);
      const explicitTmdb = historyNestedValue(history, ["tmdbId", "tmdb_id", "tmdbID", "mediaId", "media_id"]);
      const ref = identity || historyTmdbReference(explicitTmdb) || historyTmdbReference(parts.vodId) || historyTmdbReference(parts.key);
      const tmdbId = String(identity && identity.tmdbId || explicitTmdb || ref && ref.tmdbId || hint && hint.tmdbId || "").trim();
      let mediaType = normalizeHistoryMediaType(identity && identity.mediaType) || normalizeHistoryMediaType(historyNestedValue(history, ["mediaType", "media_type", "contentType"])) || normalizeHistoryMediaType(hint && hint.mediaType);
      if (!mediaType && ref) mediaType = ref.mediaType;
      if (!mediaType && /(?:^|[\s:_-])(tv|series|show|电视剧|剧集)(?:$|[\s:_-])/i.test(typeText)) mediaType = "tv";
      if (!mediaType && /(?:^|[\s:_-])(movie|film|电影)(?:$|[\s:_-])/i.test(typeText)) mediaType = "movie";
      const marker = historyEpisodeMarker(history);
      const seasonNumber = Math.max(0, Number(historyNestedValue(history, ["seasonNumber", "season_number", "season"])) || marker.seasonNumber || Number(hint && hint.seasonNumber) || 0);
      const episodeNumber = Math.max(0, Number(historyNestedValue(history, ["episodeNumber", "episode_number", "episode"])) || marker.episodeNumber || Number(hint && hint.episodeNumber) || 0);
      const resourceId = String(historyNestedValue(history, ["resourceId", "resource_id", "resourceID"]) || hint && hint.resourceId || "").trim();
      const panFileId = String(historyNestedValue(history, ["panFileId", "pan_file_id", "fileId", "file_id"]) || hint && (hint.panFileId || hint.fileId) || "").trim();
      const panFileName = String(historyNestedValue(history, ["panFileName", "pan_file_name", "fileName", "file_name", "filename"]) || hint && (hint.panFileName || hint.fileName) || "").trim();
      const panPassword = String(historyNestedValue(history, ["panPassword", "pan_password", "password", "pwd", "passcode"]) || hint && (hint.panPassword || hint.password) || "").trim();
      const panTitle = String(historyNestedValue(history, ["panTitle", "pan_title", "playTitle", "play_title", "resourceTitle"]) || hint && hint.panTitle || "").trim();
      const lastPlayUrl = String(historyNestedValue(history, ["lastPlayUrl", "last_play_url", "playUrl", "play_url", "episodeUrl", "episode_url", "url"]) || hint && hint.lastPlayUrl || "").trim();
      const panProvider = resolvePanProviderForHistory({
        diskType: historyNestedValue(history, ["diskType", "disk_type"]) || hint && hint.diskType,
        panProvider: historyNestedValue(history, ["panProvider", "pan_provider"]) || hint && hint.panProvider,
        provider: historyNestedValue(history, ["provider"]) || hint && hint.provider,
        lastPlayUrl
      });
      const originalTitle = String(historyNestedValue(history, ["originalTitle", "original_title", "originalName", "original_name"]) || hint && hint.originalTitle || "").trim();
      const resourceSearchTitle = String(historyNestedValue(history, ["resourceSearchTitle", "resource_search_title"]) || hint && hint.resourceSearchTitle || "").trim();
      const aliases = mergeTitleAliases(
        historyNestedValue(history, ["aliases", "alias", "alternativeTitles"]),
        hint && hint.aliases,
        title,
        originalTitle
      );
      return {
        siteKey: parts.siteKey,
        vodId: parts.vodId,
        cid: parts.cid,
        title,
        originalTitle,
        resourceSearchTitle,
        aliases,
        poster: String(historyNestedValue(history, ["vodPic", "pic", "poster"]) || hint && hint.poster || "").trim(),
        backdrop: String(historyNestedValue(history, ["backdrop", "landscape", "backdropUrl", "backdrop_url"]) || hint && hint.backdrop || "").trim(),
        mediaType,
        tmdbId,
        seasonNumber,
        episodeNumber,
        episodeTitle: String(historyNestedValue(history, ["episodeTitle", "episode_title"]) || hint && hint.episodeTitle || "").trim(),
        sourceType: String(historyNestedValue(history, ["sourceType", "source_type", "playType", "play_type", "kind", "type", "source"]) || hint && hint.sourceType || "").trim(),
        panProvider,
        panPassword,
        panTitle,
        panFileName,
        panFileId,
        resourceId,
        panSearchKeyword: String(historyNestedValue(history, ["panSearchKeyword", "pan_search_keyword", "searchKeyword", "search_keyword"]) || hint && hint.panSearchKeyword || "").trim(),
        lastPlayUrl,
        playbackPosition: Number(historyNestedValue(history, ["playbackPosition", "playback_position", "position"])) || Number(hint && hint.playbackPosition) || 0,
        duration: Number(historyNestedValue(history, ["duration", "durationMs", "duration_ms"])) || Number(hint && hint.duration) || 0,
        updatedAt: Number(historyNestedValue(history, ["updatedAt", "updated_at", "createTime", "create_time"])) || Number(hint && hint.updatedAt) || 0
      };
    }

    async function loadHistoryContextIndex() {
      const store = state.historyContexts || (state.historyContexts = { loaded: false, loading: false, promise: null, entries: [], diag: null });
      if (store.loaded) return store;
      if (store.loading && store.promise) return store.promise;
      store.loading = true;
      store.promise = (async () => {
        try {
          const saved = safeJson(await sdk().cache.get(cacheKey("historyContext")), null);
          const entries = saved && Array.isArray(saved.entries) ? saved.entries : [];
          const pruned = pruneRecentWatchingEntries(entries, Date.now());
          store.entries = pruned.entries;
          store.diag = pruned;
          if (pruned.changed) await persistHistoryContextEntries(store.entries);
        } catch (e) {
          store.entries = [];
          store.diag = { rawCount: 0, keptCount: 0, mediaCount: 0, changed: false, error: String(e && e.message || "") };
        }
        store.loaded = true;
        store.loading = false;
        store.promise = null;
        return store;
      })();
      return store.promise;
    }

    function continueIndexMediaKey(item, target) {
      const context = target || normalizePlaybackTarget(item, item);
      const tmdbId = String(context && context.tmdbId || item && item.tmdbId || "").trim();
      const mediaType = normalizeHistoryMediaType(context && context.mediaType || item && item.mediaType);
      return tmdbId && mediaType ? `${mediaType}:${tmdbId}` : "";
    }

    function continueIndexFirstValue(values) {
      return (Array.isArray(values) ? values : []).map((value) => String(value == null ? "" : value).trim()).find(Boolean) || "";
    }

    function buildContinueIndexEntry(item, playbackTarget, panItem, playedAt, seed) {
      const source = seed && typeof seed === "object" ? seed : {};
      const target = normalizePlaybackTarget(item, Object.assign({}, source, playbackTarget || {}));
      const mediaKey = continueIndexMediaKey(item, target);
      if (!target || !mediaKey) return null;
      const pan = panItem && typeof panItem === "object" ? panItem : {};
      const tmdbId = String(target.tmdbId || "").trim();
      const mediaType = normalizeHistoryMediaType(target.mediaType);
      const title = continueIndexFirstValue([target.title, item && item.title, source.title, "最近观看"]);
      const originalTitle = continueIndexFirstValue([target.originalTitle, item && item.originalTitle, source.originalTitle]);
      const resourceSearchTitle = continueIndexFirstValue([target.resourceSearchTitle, item && item.resourceSearchTitle, source.resourceSearchTitle]);
      const aliases = mergeTitleAliases(target.aliases, item && item.aliases, source.aliases, title, originalTitle);
      const poster = continueIndexFirstValue([target.poster, item && item.poster, item && item.pic, item && item.image, source.poster]);
      const backdrop = continueIndexFirstValue([target.backdrop, item && item.backdrop, item && item.landscape, source.backdrop, source.landscape]);
      const playedAtValue = Number(playedAt || source.playedAt || source.updatedAt || target.updatedAt || Date.now()) || Date.now();
      const lastPlayUrl = continueIndexFirstValue([
        pan.normalizedUrl,
        pan.normalized_url,
        pan.url,
        target.lastPlayUrl,
        source.lastPlayUrl,
        source.last_play_url
      ]);
      const panProvider = resolvePanProviderForHistory({
        diskType: continueIndexFirstValue([pan.diskType, pan.disk_type, target.diskType, source.diskType, source.disk_type]),
        panProvider: continueIndexFirstValue([pan.panProvider, pan.pan_provider, target.panProvider, source.panProvider]),
        provider: continueIndexFirstValue([pan.provider, target.provider, source.provider]),
        lastPlayUrl
      });
      const panPassword = continueIndexFirstValue([pan.password, pan.pwd, pan.passcode, target.panPassword, source.panPassword, source.password, source.pwd]);
      const panFileName = continueIndexFirstValue([pan.fileName, pan.file_name, pan.filename, target.panFileName, source.panFileName, source.fileName]);
      const panTitle = continueIndexFirstValue([pan.title, pan.note, target.panTitle, source.panTitle, source.playTitle, panFileName, title]);
      const panFileId = continueIndexFirstValue([pan.fileId, pan.file_id, target.panFileId, source.panFileId, source.fileId]);
      const resourceId = continueIndexFirstValue([pan.resourceId, pan.resource_id, target.resourceId, source.resourceId]);
      const normalizedTarget = Object.assign({}, target, {
        tmdbId,
        mediaType,
        title,
        originalTitle,
        resourceSearchTitle,
        aliases,
        poster,
        backdrop,
        panProvider,
        panPassword,
        panTitle,
        panFileName,
        panFileId,
        resourceId,
        lastPlayUrl,
        updatedAt: playedAtValue
      });
      const snapshot = normalizeSnapshot(Object.assign({}, item || {}, {
        id: `tmdb:${mediaType}:${tmdbId}`,
        source: "tmdb",
        tmdbId,
        mediaType,
        title,
        originalTitle,
        resourceSearchTitle,
        aliases,
        pic: poster || item && item.pic || "",
        image: poster || item && (item.image || item.pic) || "",
        landscape: backdrop || item && item.landscape || ""
      }));
      return {
        version: 1,
        mediaKey,
        tmdbId,
        mediaType,
        title,
        originalTitle,
        resourceSearchTitle,
        aliases,
        poster,
        backdrop,
        seasonNumber: Math.max(0, Number(normalizedTarget.seasonNumber || 0) || 0),
        episodeNumber: Math.max(0, Number(normalizedTarget.episodeNumber || 0) || 0),
        episodeTitle: String(normalizedTarget.episodeTitle || source.episodeTitle || "").trim(),
        playbackPosition: Math.max(0, Number(normalizedTarget.playbackPosition || source.playbackPosition || 0) || 0),
        duration: Math.max(0, Number(normalizedTarget.duration || source.duration || 0) || 0),
        sourceType: continueIndexFirstValue([normalizedTarget.sourceType, source.sourceType, "pan"]),
        panProvider,
        panPassword,
        panTitle,
        panFileName,
        panFileId,
        resourceId,
        panSearchKeyword: continueIndexFirstValue([normalizedTarget.panSearchKeyword, source.panSearchKeyword, source.panSearchKeyword]),
        lastPlayUrl,
        playedAt: playedAtValue,
        updatedAt: playedAtValue,
        item: snapshot,
        playbackTarget: normalizedTarget
      };
    }

    function normalizeContinueIndexEntry(entry, index) {
      if (!entry || typeof entry !== "object") return null;
      const rawItem = entry.item && typeof entry.item === "object" ? entry.item : entry;
      const rawTarget = entry.playbackTarget && typeof entry.playbackTarget === "object"
        ? entry.playbackTarget
        : entry.target && typeof entry.target === "object" ? entry.target : entry;
      const target = normalizePlaybackTarget(rawItem, Object.assign({}, entry, rawTarget));
      if (!target || !target.tmdbId || !normalizeHistoryMediaType(target.mediaType)) return null;
      return buildContinueIndexEntry(rawItem, target, null, Number(entry.playedAt || entry.updatedAt || target.updatedAt || 0) || Date.now(), entry);
    }

    async function persistContinueIndexEntries(entries) {
      await sdk().cache.set(cacheKey("continueIndex"), JSON.stringify({ version: 1, entries: Array.isArray(entries) ? entries : [] }));
    }

    async function loadContinueIndex() {
      const store = state.continueIndex || (state.continueIndex = { loaded: false, loading: false, promise: null, entries: [], diag: null });
      if (store.loaded) return store;
      if (store.loading && store.promise) return store.promise;
      store.loading = true;
      store.promise = (async () => {
        try {
          const saved = safeJson(await sdk().cache.get(cacheKey("continueIndex")), null);
          let rawEntries = saved && Array.isArray(saved.entries) ? saved.entries : [];
          let migrated = false;
          if (!rawEntries.length) {
            await loadHistoryContextIndex();
            rawEntries = (state.historyContexts && Array.isArray(state.historyContexts.entries) ? state.historyContexts.entries : [])
              .filter((entry) => {
                const target = normalizePlaybackTarget(entry && entry.item || entry, entry && (entry.playbackTarget || entry.target) || entry);
                return !!(target && target.tmdbId && normalizeHistoryMediaType(target.mediaType)
                  && (target.lastPlayUrl || entry && (entry.lastPlayUrl || entry.panFileId || entry.resourceId)));
              });
            migrated = rawEntries.length > 0;
          }
          const normalized = rawEntries.map(normalizeContinueIndexEntry).filter(Boolean);
          const pruned = pruneRecentWatchingEntries(normalized, Date.now());
          store.entries = pruned.entries;
          store.diag = Object.assign({}, pruned, { migrated });
          if (migrated || pruned.changed) await persistContinueIndexEntries(store.entries);
        } catch (e) {
          store.entries = [];
          store.diag = { rawCount: 0, keptCount: 0, mediaCount: 0, changed: false, error: String(e && e.message || "") };
        }
        store.loaded = true;
        store.loading = false;
        store.promise = null;
        return store;
      })();
      return store.promise;
    }

    function extractNativeHistoryList(value) {
      const parsed = typeof value === "string" ? safeJson(value, []) : value;
      if (Array.isArray(parsed)) return parsed;
      if (parsed && Array.isArray(parsed.list)) return parsed.list;
      if (parsed && Array.isArray(parsed.items)) return parsed.items;
      if (parsed && parsed.data && Array.isArray(parsed.data)) return parsed.data;
      if (parsed && parsed.data && Array.isArray(parsed.data.list)) return parsed.data.list;
      return [];
    }

    function refreshRecentWatchingViews(now) {
      loadRecentList({ refresh: true, silent: true }).then(() => {
        if (isHomeRouteActive()) renderHomeRecent();
        if (state.activeList === "recent") renderRecentList();
        if (homeUiRoute() === "secondary" && state.homeV14.secondaryListId === "recent") {
          const query = secondaryActiveQuery("recent") || secondaryGetQuery("recent");
          query.items = state.recent.items.slice();
          query.loaded = true;
          query.loading = false;
          query.error = "";
          query.page = 1;
          query.totalPages = 1;
          query.totalResults = query.items.length;
          query.hasMore = false;
          renderSecondaryCatalog();
        }
      }).catch(() => {});
    }

    async function upsertContinueIndex(item, playbackTarget, panItem, options) {
      const opts = options || {};
      const entry = buildContinueIndexEntry(item, playbackTarget, panItem, Date.now());
      if (!entry) return false;
      try {
        await loadContinueIndex();
        const key = entry.mediaKey;
        const previous = state.continueIndex && Array.isArray(state.continueIndex.entries) ? state.continueIndex.entries : [];
        const merged = [entry].concat(previous.filter((old) => String(old && (old.mediaKey || recentContextMediaKey(old)) || "") !== key));
        const pruned = pruneRecentWatchingEntries(merged, entry.playedAt);
        state.continueIndex.entries = pruned.entries;
        state.continueIndex.diag = pruned;
        await persistContinueIndexEntries(pruned.entries);
        if (opts.refreshRecent !== false) refreshRecentWatchingViews(entry.playedAt);
        return true;
      } catch (e) {
        return false;
      }
    }

    function historyContextEntryKey(entry) {
      const target = entry && (entry.playbackTarget || entry.target) || {};
      return [
        entry && entry.lastPlayUrl || "",
        entry && entry.panFileId || "",
        entry && entry.resourceId || "",
        target.tmdbId || "",
        target.mediaType || "",
        target.seasonNumber || 0,
        target.episodeNumber || 0
      ].map((value) => String(value)).join("\u001f");
    }

    async function saveHistoryPlaybackContext(item, playbackTarget, panItem, options) {
      const opts = options || {};
      if (!item) return;
      const now = Date.now();
      const target = normalizePlaybackTarget(item, playbackTarget || currentPlaybackTargetForItem(item));
      const lastPlayUrl = String(panItem && (panItem.normalizedUrl || panItem.normalized_url || panItem.url) || "").trim();
      const panProvider = resolvePanProviderForHistory({
        diskType: panItem && (panItem.diskType || panItem.disk_type),
        panProvider: panItem && (panItem.panProvider || panItem.pan_provider),
        provider: panItem && panItem.provider,
        lastPlayUrl
      });
      const entry = {
        version: 1,
        updatedAt: now,
        key: String(panItem && panItem.key || ""),
        title: String(item.title || "").trim(),
        originalTitle: String(item.originalTitle || "").trim(),
        resourceSearchTitle: String(item.resourceSearchTitle || "").trim(),
        aliases: mergeTitleAliases(item.aliases, item.title, item.originalTitle),
        poster: String(item.pic || item.image || "").trim(),
        backdrop: String(item.backdrop || item.landscape || "").trim(),
        panProvider,
        panPassword: String(panItem && (panItem.password || panItem.pwd || panItem.passcode) || "").trim(),
        panTitle: String(panItem && (panItem.title || panItem.note) || item.title || "").trim(),
        panFileName: String(panItem && (panItem.fileName || panItem.file_name || panItem.filename) || "").trim(),
        panFileId: String(panItem && (panItem.fileId || panItem.file_id) || "").trim(),
        resourceId: String(panItem && (panItem.resourceId || panItem.resource_id) || "").trim(),
        lastPlayUrl,
        item: normalizeSnapshot(item),
        playbackTarget: target || null
      };
      try {
        await loadHistoryContextIndex();
        const entryKey = historyContextEntryKey(entry);
        const merged = [entry].concat((state.historyContexts.entries || []).filter((old) => historyContextEntryKey(old) !== entryKey));
        const pruned = pruneRecentWatchingEntries(merged, now);
        state.historyContexts.entries = pruned.entries;
        state.historyContexts.diag = pruned;
        await persistHistoryContextEntries(pruned.entries);
        if (opts.refreshRecent !== false) refreshRecentWatchingViews(now);
        scheduleUiSnapshotSave();
      } catch (e) {}
    }

    function normalizeContinueWatchingContext(entry, index) {
      if (!entry || typeof entry !== "object") return null;
      const rawItem = entry.item && typeof entry.item === "object" ? entry.item : {};
      const rawTarget = entry.playbackTarget && typeof entry.playbackTarget === "object"
        ? entry.playbackTarget
        : entry.target && typeof entry.target === "object" ? entry.target : rawItem;
      const target = normalizePlaybackTarget(rawItem, Object.assign({}, entry, rawTarget));
      const tmdbId = String(target && target.tmdbId || "").trim();
      const mediaType = normalizeHistoryMediaType(target && target.mediaType);
      if (!tmdbId || !mediaType) return null;
      const title = String(target.title || entry.title || rawItem.title || rawItem.name || "继续观看").trim();
      const originalTitle = String(target.originalTitle || entry.originalTitle || rawItem.originalTitle || "").trim();
      const resourceSearchTitle = String(target.resourceSearchTitle || entry.resourceSearchTitle || rawItem.resourceSearchTitle || "").trim();
      const aliases = mergeTitleAliases(target.aliases, entry.aliases, rawItem.aliases, title, originalTitle);
      const poster = String(target.poster || rawItem.pic || rawItem.image || rawItem.poster || "").trim();
      const backdrop = String(target.backdrop || entry.backdrop || rawItem.landscape || rawItem.backdrop || "").trim();
      const position = Math.max(0, Number(target.playbackPosition || entry.position || rawItem.position || 0) || 0);
      const duration = Math.max(0, Number(target.duration || entry.duration || rawItem.duration || 0) || 0);
      const updatedAt = Number(entry.updatedAt || entry.at || target.updatedAt || rawItem.updatedAt || 0) || 0;
      const lastPlayUrl = String(target.lastPlayUrl || entry.lastPlayUrl || rawItem.lastPlayUrl || "").trim();
      const panProvider = resolvePanProviderForHistory({
        diskType: target.diskType || entry.diskType || rawItem.diskType,
        panProvider: target.panProvider || entry.panProvider || rawItem.panProvider,
        provider: target.provider || entry.provider || rawItem.provider,
        lastPlayUrl
      });
      const progress = duration > 0 && position > 0 ? Math.min(100, Math.max(1, Math.round(position / duration * 100))) : 0;
      const progressText = duration > 0 && position > 0
        ? "已看 " + Math.min(99, Math.max(1, Math.round(position / duration * 100))) + "%"
        : position > 0 ? "看到 " + formatHistoryTime(position) : "";
      const seasonNumber = Math.max(0, Number(target.seasonNumber || 0) || 0);
      const episodeNumber = Math.max(0, Number(target.episodeNumber || 0) || 0);
      const episodeLabel = mediaType === "tv" && seasonNumber > 0 && episodeNumber > 0
        ? `S${String(seasonNumber).padStart(2, "0")}E${String(episodeNumber).padStart(2, "0")}` : "";
      const groupKey = `${mediaType}:${tmdbId}`;
      const snapshot = normalizeSnapshot(Object.assign({}, rawItem, {
        id: `tmdb:${mediaType}:${tmdbId}`,
        source: "tmdb",
        tmdbId,
        mediaType,
        title,
        originalTitle,
        resourceSearchTitle,
        aliases,
        pic: poster,
        image: poster,
        landscape: backdrop
      }));
      return Object.assign({}, snapshot, {
        id: "continue:" + groupKey,
        source: "history",
        continueContext: true,
        historyContextEntry: entry,
        historyContextTarget: target,
        historyKey: "continue:" + groupKey,
        nativeHistoryKey: "",
        historyStableKey: "continue:" + groupKey,
        siteKey: "",
        vodId: "",
        tmdbId,
        mediaType,
        title,
        originalTitle,
        resourceSearchTitle,
        aliases,
        backdrop,
        vodName: title,
        pic: poster,
        vodPic: poster,
        image: poster,
        remark: [episodeLabel, progressText].filter(Boolean).join(" · "),
        badge: episodeLabel,
        progress,
        desc: [episodeLabel, progressText].filter(Boolean).join(" · ") || title,
        updatedAt,
        popularity: updatedAt,
        baseRank: Number(index || 0) + 1,
        createTime: updatedAt,
        position,
        duration,
        seasonNumber,
        episodeNumber,
        episodeTitle: target.episodeTitle || "",
        sourceType: target.sourceType || entry.sourceType || "pan",
        panProvider,
        panPassword: target.panPassword || entry.panPassword || "",
        panTitle: target.panTitle || entry.panTitle || title,
        panFileName: target.panFileName || entry.panFileName || "",
        panFileId: target.panFileId || entry.panFileId || "",
        resourceId: target.resourceId || entry.resourceId || "",
        panSearchKeyword: target.panSearchKeyword || entry.panSearchKeyword || "",
        lastPlayUrl,
        historySiteKind: "push_agent",
        historyReplayKind: "PAN_NATIVE",
        historyRestorable: false,
        historyReplayable: true
      });
    }

    function recentContextTarget(entry) {
      if (!entry || typeof entry !== "object") return {};
      if (entry.playbackTarget && typeof entry.playbackTarget === "object") return entry.playbackTarget;
      if (entry.target && typeof entry.target === "object") return entry.target;
      return entry.item && typeof entry.item === "object" ? entry.item : entry;
    }

    function recentContextMediaKey(entry) {
      if (!entry || typeof entry !== "object") return "";
      const rawItem = entry.item && typeof entry.item === "object" ? entry.item : entry;
      const target = normalizePlaybackTarget(rawItem, Object.assign({}, entry, recentContextTarget(entry)));
      const tmdbId = String(target && target.tmdbId || entry.tmdbId || rawItem.tmdbId || "").trim();
      const mediaType = normalizeHistoryMediaType(target && target.mediaType || entry.mediaType || rawItem.mediaType);
      return tmdbId && mediaType ? `${mediaType}:${tmdbId}` : "";
    }

    function recentContextUpdatedAt(entry) {
      if (!entry || typeof entry !== "object") return 0;
      const rawItem = entry.item && typeof entry.item === "object" ? entry.item : entry;
      const target = recentContextTarget(entry);
      return Number(entry.updatedAt || entry.at || target && target.updatedAt || rawItem.updatedAt || rawItem.createTime || 0) || 0;
    }

    function pruneRecentWatchingEntries(entries, now) {
      const raw = (Array.isArray(entries) ? entries : []).filter((entry) => entry && typeof entry === "object");
      const timestamp = Number(now || Date.now());
      const ageKept = raw.filter((entry) => {
        const updatedAt = recentContextUpdatedAt(entry);
        return updatedAt > 0 && timestamp - updatedAt <= RECENT_MAX_AGE_MS;
      });
      const latestByMedia = new Map();
      ageKept.forEach((entry, index) => {
        const key = recentContextMediaKey(entry);
        if (!key) return;
        const current = latestByMedia.get(key);
        const updatedAt = recentContextUpdatedAt(entry);
        if (!current || updatedAt > current.updatedAt || updatedAt === current.updatedAt && index < current.index) {
          latestByMedia.set(key, { key, updatedAt, index });
        }
      });
      const keptMedia = Array.from(latestByMedia.values())
        .sort((a, b) => b.updatedAt - a.updatedAt || a.index - b.index)
        .slice(0, RECENT_MAX_MEDIA);
      const keepKeys = new Set(keptMedia.map((entry) => entry.key));
      const kept = ageKept
        .filter((entry) => keepKeys.has(recentContextMediaKey(entry)))
        .sort((a, b) => recentContextUpdatedAt(b) - recentContextUpdatedAt(a));
      return {
        entries: kept,
        rawCount: raw.length,
        ageKeptCount: ageKept.length,
        mediaCount: keepKeys.size,
        keptCount: kept.length,
        changed: raw.length !== kept.length || raw.some((entry, index) => entry !== kept[index])
      };
    }

    async function persistHistoryContextEntries(entries) {
      await sdk().cache.set(cacheKey("historyContext"), JSON.stringify({ version: 1, entries: Array.isArray(entries) ? entries : [] }));
    }

    function normalizeRecentWatchingContext(entry, index) {
      const item = normalizeContinueWatchingContext(entry, index);
      if (!item) return null;
      const mediaKey = `${item.mediaType}:${item.tmdbId}`;
      return Object.assign({}, item, {
        id: `tmdb:${mediaKey}`,
        source: "history",
        continueContext: true,
        continueIndexEntry: true,
        recentWatching: true,
        recentMediaKey: mediaKey,
        historyKey: `recent:${mediaKey}`,
        historyStableKey: `recent:${mediaKey}`,
        siteKey: "",
        vodId: "",
        remark: "",
        badge: "",
        desc: item.title || "最近观看"
      });
    }

    function recentWatchingMediaKey(item) {
      if (!item) return "";
      if (item.recentMediaKey) return String(item.recentMediaKey);
      const mediaType = normalizeHistoryMediaType(item.mediaType);
      const tmdbId = String(item.tmdbId || "").trim();
      return mediaType && tmdbId ? `${mediaType}:${tmdbId}` : mediaDomKey(item);
    }

    function uniqueRecentWatchingMedia(items) {
      const groups = new Map();
      (Array.isArray(items) ? items : []).forEach((item, index) => {
        if (!item) return;
        const key = recentWatchingMediaKey(item);
        if (!key) return;
        const current = groups.get(key);
        if (!current || Number(item.updatedAt || 0) > Number(current.item.updatedAt || 0)
          || Number(item.updatedAt || 0) === Number(current.item.updatedAt || 0) && index < current.index) {
          groups.set(key, { item, index });
        }
      });
      return Array.from(groups.values())
        .sort((a, b) => Number(b.item.updatedAt || 0) - Number(a.item.updatedAt || 0) || a.index - b.index)
        .map((entry) => entry.item);
    }

    function recentNativeHistoryKey(item) {
      return String(item && item.nativeHistoryKey || "").trim();
    }

    function recordRecentNativeKeyFlow(stage, item) {
      if (!item || !item.nativeHistoryRaw) return null;
      const key = recentNativeHistoryKey(item);
      const flowKey = key || String(item.historyStableKey || item.id || recentWatchingMediaKey(item) || "").trim();
      if (!flowKey || !state.recent) return null;
      if (!state.recent.nativeKeyFlow || typeof state.recent.nativeKeyFlow !== "object") state.recent.nativeKeyFlow = {};
      const flow = state.recent.nativeKeyFlow[flowKey] || {
        mediaKey: recentWatchingMediaKey(item),
        nativeHistoryKey: key
      };
      flow.mediaKey = recentWatchingMediaKey(item) || flow.mediaKey || "";
      flow.nativeHistoryKey = key;
      flow[stage] = key;
      state.recent.nativeKeyFlow[flowKey] = flow;
      if (state.tvDiag) state.tvDiag.recentNativeKeyFlow = state.recent.nativeKeyFlow;
      if (isTvDiagnosticEnabled()) {
        try {
          console.debug("[Nostr TV][" + stage + "]", {
            [stage]: key,
            mediaKey: flow.mediaKey
          });
        } catch (e) {}
      }
      return flow;
    }

    function recentWatchingContextEntries() {
      const entries = [];
      const seen = new Set();
      [state.continueIndex, state.historyContexts].forEach((store) => {
        const list = store && Array.isArray(store.entries) ? store.entries : [];
        list.forEach((entry) => {
          if (!entry || typeof entry !== "object") return;
          const key = historyContextEntryKey(entry);
          if (seen.has(key)) return;
          seen.add(key);
          entries.push(entry);
        });
      });
      return entries;
    }

    function recentWatchingContextCandidates() {
      return recentWatchingContextEntries().map((entry, index) => normalizeRecentWatchingContext(entry, index)).filter(Boolean);
    }

    function recentWatchingTmdbMediaKey(item) {
      if (!item) return "";
      const mediaType = normalizeHistoryMediaType(item.mediaType);
      const tmdbId = String(item.tmdbId || "").trim();
      return mediaType && tmdbId ? `${mediaType}:${tmdbId}` : "";
    }

    function recentWatchingContextForNative(nativeItem, candidates) {
      const list = Array.isArray(candidates) ? candidates : [];
      const nativeMediaKey = recentWatchingTmdbMediaKey(nativeItem);
      let matches = nativeMediaKey
        ? list.filter((candidate) => recentWatchingTmdbMediaKey(candidate) === nativeMediaKey)
        : [];
      if (!matches.length) {
        const titleKey = normalizeTitle(nativeItem && (nativeItem.title || nativeItem.vodName) || "");
        if (!titleKey) return null;
        matches = list.filter((candidate) => normalizeTitle(candidate && candidate.title || "") === titleKey);
        const mediaKeys = Array.from(new Set(matches.map(recentWatchingTmdbMediaKey).filter(Boolean)));
        if (mediaKeys.length > 1) return null;
      }
      return matches.slice().sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;
    }

    function recentValuePresent(value) {
      if (value == null) return false;
      if (typeof value === "number") return Number.isFinite(value) && value > 0;
      return String(value).trim() !== "";
    }

    function mergeRecentNativeContext(nativeItem, contextItem) {
      const native = nativeItem && typeof nativeItem === "object" ? nativeItem : {};
      const context = contextItem && typeof contextItem === "object" ? contextItem : {};
      const merged = Object.assign({}, context, native);
      [
        "tmdbId", "mediaType", "title", "originalTitle", "resourceSearchTitle", "aliases", "pic", "vodPic", "image", "landscape", "backdrop",
        "remark", "badge", "vodRemarks", "desc", "releaseDate", "genreIds", "originCountries",
        "originalLanguage", "seasonNumber", "episodeNumber", "episodeTitle", "sourceType",
        "panProvider", "panPassword", "panTitle", "panFileName", "panFileId", "resourceId",
        "panSearchKeyword", "lastPlayUrl", "position", "duration"
      ].forEach((field) => {
        if (!recentValuePresent(merged[field]) && recentValuePresent(context[field])) merged[field] = context[field];
      });
      const nativeTime = Number(native.updatedAt || native.createTime || 0) || 0;
      const contextTime = Number(context.updatedAt || context.createTime || 0) || 0;
      if (contextTime > nativeTime) {
        merged.updatedAt = contextTime;
        merged.popularity = contextTime;
      }
      merged.source = "history";
      merged.recentWatching = true;
      if (!recentWatchingTmdbMediaKey(native) && recentWatchingTmdbMediaKey(context)) {
        merged.recentMediaKey = recentWatchingTmdbMediaKey(context);
      }
      [
        "nativeHistoryRaw", "nativeHistoryKey", "nativeCid", "nativeSiteKey", "nativeVodId",
        "historyKey", "historyStableKey", "siteKey", "vodId", "cid", "historySiteKind",
        "historyReplayKind", "historyRestorable", "historyReplayable", "nativeHistoryType",
        "nativeHistorySource", "episodeUrl", "url"
      ].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(native, field)) merged[field] = native[field];
      });
      delete merged.continueContext;
      delete merged.continueIndexEntry;
      delete merged.historyContextEntry;
      delete merged.historyContextTarget;
      return merged;
    }

    function recentWatchingPrimaryEntries() {
      if (state.continueIndex && state.continueIndex.loaded && Array.isArray(state.continueIndex.entries)) {
        return state.continueIndex.entries;
      }
      return state.historyContexts && Array.isArray(state.historyContexts.entries) ? state.historyContexts.entries : [];
    }

    function recentWatchingItems() {
      const contextEntries = recentWatchingContextEntries();
      const contextCandidates = recentWatchingContextCandidates();
      const nativeSource = state.recent && Array.isArray(state.recent.nativeItems) ? state.recent.nativeItems : [];
      const native = nativeSource.map((nativeItem) => {
        const merged = mergeRecentNativeContext(nativeItem, recentWatchingContextForNative(nativeItem, contextCandidates));
        recordRecentNativeKeyFlow("RECENT_NATIVE_KEY_AFTER_MERGE", merged);
        return merged;
      });
      const nativeMediaKeys = new Set(native.map(recentWatchingTmdbMediaKey).filter(Boolean));
      const supplements = contextCandidates.filter((candidate) => {
        const mediaKey = recentWatchingTmdbMediaKey(candidate);
        return !mediaKey || !nativeMediaKeys.has(mediaKey);
      });
      const items = uniqueRecentWatchingMedia(native.concat(supplements));
      const diag = {
        rawContextCount: contextEntries.length,
        continueIndexCount: contextCandidates.length,
        nativeHistoryCount: native.length,
        htmlOnlySupplementCount: supplements.length,
        uniqueMediaCount: items.length,
        first10: items.slice(0, 10).map((item) => ({
          mediaType: item.mediaType || "",
          tmdbId: String(item.tmdbId || ""),
          updatedAt: Number(item.updatedAt || 0),
          nativeHistoryKey: recentNativeHistoryKey(item)
        }))
      };
      if (state.recent) state.recent.diag = diag;
      if (state.tvDiag) state.tvDiag.recentWatching = diag;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV][RECENT_WATCHING_DIAG]", diag); } catch (e) {}
      }
      return items;
    }

    function continueWatchingContextItems() {
      const entries = recentWatchingPrimaryEntries();
      const groups = new Map();
      entries.forEach((entry, index) => {
        const item = normalizeContinueWatchingContext(entry, index);
        if (!item) return;
        const key = `${item.mediaType}:${item.tmdbId}`;
        const current = groups.get(key);
        if (!current || Number(item.updatedAt || 0) > Number(current.item.updatedAt || 0)
          || (Number(item.updatedAt || 0) === Number(current.item.updatedAt || 0) && index < current.index)) {
          groups.set(key, { item, index });
        }
      });
      return Array.from(groups.values())
        .sort((a, b) => Number(b.item.updatedAt || 0) - Number(a.item.updatedAt || 0) || a.index - b.index)
        .map((entry) => entry.item);
    }

    function findContinueWatchingContext(item) {
      if (!item) return null;
      return continueWatchingContextItems().find((candidate) => playbackTargetMatchesItem(candidate.historyContextTarget, item)) || null;
    }

    function openContinueWatchingContext(item, options) {
      if (!item) return false;
      const opts = options || {};
      const entry = item.historyContextEntry;
      const rawItem = entry && entry.item && typeof entry.item === "object" ? entry.item : item;
      const rawTarget = item.historyContextTarget || entry && (entry.playbackTarget || entry.target) || rawItem;
      const target = normalizePlaybackTarget(rawItem, Object.assign({}, entry || {}, rawTarget || {}));
      const tmdbId = String(target && target.tmdbId || item.tmdbId || "").trim();
      const mediaType = normalizeHistoryMediaType(target && target.mediaType || item.mediaType);
      if (!tmdbId || !mediaType) return false;
      const pool = allItems().concat(state.searchItems || []).filter(Boolean);
      const media = pool.find((candidate) => String(candidate.tmdbId || "") === tmdbId
        && (!candidate.mediaType || candidate.mediaType === mediaType)) || Object.assign({}, normalizeSnapshot(rawItem), {
          id: `tmdb:${mediaType}:${tmdbId}`,
          source: "tmdb",
          tmdbId,
          mediaType,
          title: item.title || target.title || "继续观看",
          originalTitle: item.originalTitle || target.originalTitle || "",
          resourceSearchTitle: item.resourceSearchTitle || target.resourceSearchTitle || "",
          aliases: mergeTitleAliases(item.aliases, target.aliases, item.title, target.title, item.originalTitle, target.originalTitle),
          pic: item.pic || target.poster || "",
          image: item.image || item.pic || target.poster || "",
          landscape: item.landscape || item.backdrop || target.backdrop || "",
          desc: item.desc || item.title || ""
        });
      const context = normalizePlaybackTarget(media, target);
      state.historyResume = {
        history: item,
        context,
        mediaKey: mediaDomKey(media),
        autoResume: opts.autoResume === true,
        at: Date.now()
      };
      if (context) setDetailPlaybackTarget(media, context);
      openDetail(media, {
        returnTarget: opts.returnTarget || document.activeElement,
        historyContext: context,
        historyResume: true
      });
      return true;
    }

    function normalizePlaybackTarget(item, context) {
      const source = context && typeof context === "object"
        ? context.source === "history" ? historyPlaybackContext(context) : context
        : {};
      const value = (keys, fallback) => {
        for (const key of keys) {
          if (source[key] != null && String(source[key]).trim()) return source[key];
          if (item && item[key] != null && String(item[key]).trim()) return item[key];
        }
        return fallback;
      };
      const tmdbId = String(value(["tmdbId", "tmdb_id"], "") || "").trim();
      const mediaType = normalizeHistoryMediaType(value(["mediaType", "media_type"], "")) || String(value(["mediaType"], "") || "").trim();
      const title = String(value(["title", "vodName", "name"], "") || "").trim();
      const originalTitle = String(value(["originalTitle", "original_title"], "") || "").trim();
      const resourceSearchTitle = String(value(["resourceSearchTitle", "resource_search_title"], "") || "").trim();
      const aliases = mergeTitleAliases(source.aliases, item && item.aliases, title, originalTitle);
      const seasonNumber = Math.max(0, Number(value(["seasonNumber", "season_number", "season"], 0)) || 0);
      const episodeNumber = Math.max(0, Number(value(["episodeNumber", "episode_number", "episode"], 0)) || 0);
      const lastPlayUrl = String(value(["lastPlayUrl", "last_play_url", "playUrl", "play_url"], "") || "").trim();
      const panProvider = resolvePanProviderForHistory({
        diskType: value(["diskType", "disk_type"], ""),
        panProvider: value(["panProvider", "pan_provider"], ""),
        provider: value(["provider"], ""),
        lastPlayUrl
      });
      if (!tmdbId && !title && !mediaType) return null;
      return {
        mediaType,
        tmdbId,
        title,
        originalTitle,
        resourceSearchTitle,
        aliases,
        poster: String(value(["poster", "pic", "vodPic"], "") || "").trim(),
        backdrop: String(value(["backdrop", "landscape", "backdropUrl", "backdrop_url"], "") || "").trim(),
        seasonNumber,
        episodeNumber,
        episodeTitle: String(value(["episodeTitle", "episode_title"], "") || "").trim(),
        sourceType: String(value(["sourceType", "source_type"], "") || "").trim(),
        panProvider,
        panPassword: String(value(["panPassword", "pan_password", "password", "pwd", "passcode"], "") || "").trim(),
        panTitle: String(value(["panTitle", "pan_title", "playTitle", "play_title", "resourceTitle"], "") || "").trim(),
        panFileName: String(value(["panFileName", "pan_file_name", "fileName", "file_name"], "") || "").trim(),
        panFileId: String(value(["panFileId", "pan_file_id", "fileId", "file_id"], "") || "").trim(),
        resourceId: String(value(["resourceId", "resource_id"], "") || "").trim(),
        panSearchKeyword: String(value(["panSearchKeyword", "pan_search_keyword"], "") || "").trim(),
        lastPlayUrl,
        playbackPosition: Number(value(["playbackPosition", "playback_position", "position"], 0)) || 0,
        duration: Number(value(["duration", "durationMs", "duration_ms"], 0)) || 0,
        updatedAt: Number(value(["updatedAt", "updated_at", "createTime", "create_time"], 0)) || 0
      };
    }

    function playbackTargetMatchesItem(target, item) {
      if (!target || !item) return false;
      if (target.mediaType && item.mediaType && target.mediaType !== item.mediaType) return false;
      if (target.tmdbId && item.tmdbId) return String(target.tmdbId) === String(item.tmdbId);
      return !!(target.title && item.title && normalizeTitle(target.title) === normalizeTitle(item.title));
    }

    function currentPlaybackTargetForItem(item) {
      const target = state.detailEpisodeTarget;
      return playbackTargetMatchesItem(target, item) ? normalizePlaybackTarget(item, target) : null;
    }

    function setDetailPlaybackTarget(item, context) {
      const target = normalizePlaybackTarget(item, context);
      state.detailEpisodeTarget = target;
      scheduleUiSnapshotSave();
      return target;
    }

    function normalizeSnapshot(item) {
      if (!item || typeof item !== "object") return {};
      return {
        id: item.id || (item.tmdbId && item.mediaType ? `tmdb:${item.mediaType}:${item.tmdbId}` : ""),
        source: item.source || "tmdb",
        tmdbId: item.tmdbId ? String(item.tmdbId) : "",
        mediaType: item.mediaType || "",
        listId: item.listId || "",
        listTitle: item.listTitle || "",
        title: item.title || "",
        originalTitle: item.originalTitle || "",
        resourceSearchTitle: String(item.resourceSearchTitle || "").trim(),
        aliases: Array.isArray(item.aliases) ? mergeTitleAliases(item.aliases) : [],
        pic: item.pic || "",
        landscape: item.landscape || "",
        image: item.image || item.pic || "",
        desc: item.desc || "",
        releaseDate: item.releaseDate || "",
        voteAverage: item.voteAverage || 0,
        popularity: item.popularity || 0,
        baseRank: item.baseRank || 99,
        seasonNumber: Number(item.seasonNumber || item.season_number || 0) || 0,
        episodeNumber: Number(item.episodeNumber || item.episode_number || 0) || 0,
        episodeTitle: item.episodeTitle || item.episode_title || ""
      };
    }

