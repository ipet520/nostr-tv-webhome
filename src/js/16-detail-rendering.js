    function prepareDetailPlaybackForDetail(item, options) {
      const opts = options || {};
      const canonicalStartedAt = Date.now();
      let canonicalPromise = Promise.resolve(item);
      if (canonicalResourceKey(item)) {
        try {
          canonicalPromise = Promise.resolve(resolveCanonicalResourceTitle(item)).catch(() => item);
        } catch (e) {
          canonicalPromise = Promise.resolve(item);
        }
      }
      if (state.selected !== item) return Promise.resolve(null);
      return Promise.resolve(prepareDetailPlayback(item, Object.assign({}, opts, {
        canonicalPromise,
        canonicalStartedAt
      })));
    }

    function openDetail(item, options) {
      const opts = options || {};
      if (isConnectionPanelOpen()) closeConnectionPanel();
      const detailWasActive = $("detailSheet") && $("detailSheet").classList.contains("active");
      const sameSelected = state.selected === item;
      if (state.selected && state.selected !== item) {
        clearDirectPlayStatus(0, "selected_change");
        cancelPendingDirectPlay("selected_change");
        cancelDetailPlaybackPreparation("selected_change");
        state.detailHistoryHandoff = null;
      }
      const restorePlaybackReturn = opts.playerReturnRestore === true
        && opts.panSnapshot && opts.panSnapshot.playbackReturn;
      if (restorePlaybackReturn) state.pan.playbackReturn = opts.panSnapshot.playbackReturn;
      if (!opts.historyResume && !opts.playerReturnRestore) state.historyResume = null;
      if (opts.episodeTarget || opts.historyContext) setDetailPlaybackTarget(item, opts.episodeTarget || opts.historyContext);
      else if (!sameSelected && !opts.restore) state.detailEpisodeTarget = null;
      if (!opts.restore && !detailWasActive) rememberHomeReturn(item, opts.returnTarget);
      state.selected = item;
      state.detail = null;
      // 先按当前已知 Native History 同步按钮；真正的资源准备由
      // prepareDetailPlayback 的 Continue gate 决定，避免有效续播先启动 Curated。
      syncDetailMode(item);
      if (!opts.keepPan) {
        resetPanSearchState(true, {
          reason: "detail_open",
          preservePlaybackReturn: !!restorePlaybackReturn
        });
      }
      // 资源准备与本地 Continue gate 共用同一个 detailPlayback run；
      // gate 确认有历史线路时只进入 CONTINUE_READY，不启动任何搜索。
      prepareDetailPlaybackForDetail(item, {
        reason: "detail_open",
        continueGate: true,
        playerReturnRestore: opts.playerReturnRestore === true
      }).catch(() => {});
      ensureSheetViewport($("detailSheet"));
      syncDetailLayout();
      document.body.classList.add("detail-active");
      $("detailSheet").classList.add("active");
      $("detailSheet").setAttribute("aria-hidden", "false");
      if (isNativeLeanbackClient()) setTvMode(true);
      // TV 详情首次打开从完整 Hero 顶部开始；恢复路径仍由各自的
      // snapshot / player return 逻辑决定滚动位置。
      if (!opts.restore && isTvLikeDevice()) $("detailSheet").scrollTop = 0;
      try {
        renderDetailBase(item);
        clearDetailExtras();
      } catch (e) {
        $("detailTitle").textContent = item && item.title || "详情";
        setDetailTextContent("详情渲染失败：" + (e.message || "unknown"));
      }
      if (!opts.skipHistory && location.hash !== "#detail") history.pushState({ sheet: "detail" }, "", "#detail");
      if (!opts.restore) rememberWatchIntent(item, "view", currentPlaybackTargetForItem(item));
      setNativeToolbarVisible(false, isNativeLeanbackClient() || isNativeMobileClient());
      // TV 端：进入详情即进入持久全屏，返回主页后也保持，直到主页再次按返回键退出
      if (isTvLikeDevice()) state.tvFullscreen = true;
      if (shouldRefreshRecentList()) loadRecentList({ silent: true }).catch(() => {});
      loadDetail(item);
      scheduleUiSnapshotSave();
      if (!opts.restore) setTimeout(() => {
        const target = detailPrimaryActionButton() || $("closeDetailBtn");
        if (isTvLikeDevice()) restoreDetailTopAnchor({ reason: "detail_open", target });
        else focusRemoteTarget(target);
      }, 40);
    }

    function ensureSheetViewport(sheet, display) {
      if (!sheet) return;
      sheet.style.position = "fixed";
      sheet.style.top = "0";
      sheet.style.right = "0";
      sheet.style.bottom = "0";
      sheet.style.left = "0";
      sheet.style.width = "100%";
      sheet.style.height = "100vh";
      sheet.style.display = display || "block";
      sheet.style.zIndex = "60";
    }

    function renderDetailBase(item) {
      resetDetailTextClamp();
      // 清除上一个影视的 logo，显示文字标题（emby 风格 wrap）
      const logoWrap = $("detailLogoWrap");
      const logoImgEl = $("detailLogoImg");
      if (logoWrap) { logoWrap.style.display = "none"; logoWrap.classList.remove("logo-ready"); }
      if (logoImgEl) { logoImgEl.removeAttribute("src"); logoImgEl.classList.remove("loaded"); }
      if ($("detailTitle")) $("detailTitle").style.display = "";
      $("detailTitle").textContent = item.title;
      const fallbackText = item.desc || item.remark || "";
      setDetailTextContent(fallbackText || "");
      renderDetailMeta(item, state.detail);
      renderDetailTitleMeta(item, state.detail);
      setDetailCoverCarousel(item.landscape ? [item.landscape] : [], "", { allowPoster: false });
      updateDetailContinueButton();
      scheduleDetailTextClamp();
    }

    function renderDetailMeta(item, detail) {
      if (isTvLikeDevice() && !useLargeDetailLayout()) {
        $("detailMeta").replaceChildren();
        return;
      }
      $("detailMeta").replaceChildren(...detailMeta(item, detail).map((meta) => {
        const span = document.createElement("span");
        span.className = "meta-pill" + (meta.strong ? " strong" : "");
        span.textContent = meta.text || meta;
        return span;
      }));
    }

    function renderDetailTitleMeta(item, detail) {
      const root = $("detailTitleMeta");
      const items = useLargeDetailLayout()
        ? detailTitleMeta(item, detail).filter((meta) => meta.type === "score").slice(0, 1)
        : isTvLikeDevice() ? uniqueMeta(detailTitleMeta(item, detail).concat(detailMeta(item, detail))) : detailTitleMeta(item, detail);
      root.replaceChildren(...items.flatMap((meta, index) => {
        const span = document.createElement("span");
        span.className = meta.type || "";
        span.textContent = meta.text || meta;
        if (index === 0) return [span];
        const sep = document.createElement("span");
        sep.className = "sep";
        sep.textContent = "·";
        return [sep, span];
      }));
    }

    function setDetailCoverCarousel(landscapes, poster, options) {
      const images = uniqueCoverImages(Array.isArray(landscapes) ? landscapes : [landscapes]);
      pauseDetailCoverCarousel();
      state.detailCover.images = images;
      state.detailCover.index = 0;
      state.detailCover.token += 1;
      setDetailCoverImage(images[0] || "", poster, options);
      updateDetailCoverControls();
      if (images.length > 1) {
        const token = state.detailCover.token;
        state.detailCover.timer = setInterval(() => {
          if (token !== state.detailCover.token || !$('detailSheet').classList.contains('active') || document.visibilityState === 'hidden') return;
          switchDetailCover(1, { allowPoster: false, keepLoading: false });
        }, 5200);
      }
    }

    function updateDetailCoverControls() {
      const cover = $("detailImage") && $("detailImage").parentElement;
      if (!cover) return;
      const enabled = state.detailCover.images.length > 1;
      cover.classList.toggle("has-multiple", enabled);
    }

    function shiftDetailCover(delta) {
      const images = state.detailCover.images || [];
      if (images.length <= 1) return;
      pauseDetailCoverCarousel();
      switchDetailCover(delta, { allowPoster: false, keepLoading: false });
      updateDetailCoverControls();
    }

    function switchDetailCover(delta, options) {
      const images = state.detailCover.images || [];
      if (images.length <= 1) return;
      const start = Math.max(0, Math.min(Number(state.detailCover.index || 0), images.length - 1));
      const step = delta < 0 ? -1 : 1;
      const token = state.detailCover.token;
      tryPreloadDetailCover(start, step, 0, token, options || {});
    }

    function tryPreloadDetailCover(current, step, attempts, token, options) {
      const images = state.detailCover.images || [];
      if (token !== state.detailCover.token || !$('detailSheet').classList.contains('active')) return;
      if (!images.length || attempts >= images.length - 1) return;
      const next = (current + step + images.length) % images.length;
      const src = displayImage(images[next], { size: "w1280" });
      if (!src) return tryPreloadDetailCover(next, step, attempts + 1, token, options);
      preloadImage(src, () => {
        if (token !== state.detailCover.token || !$('detailSheet').classList.contains('active')) return;
        state.detailCover.index = next;
        setDetailCoverImage(images[next], "", Object.assign({}, options, { preloadedSrc: src }));
      }, () => tryPreloadDetailCover(next, step, attempts + 1, token, options));
    }

    function preloadImage(src, onload, onerror) {
      const img = new Image();
      img.onload = onload;
      img.onerror = onerror;
      img.src = src;
    }

    function restartDetailCoverCarousel() {
      if (!$('detailSheet').classList.contains('active') || state.detailCover.timer || state.detailCover.images.length <= 1) return;
      const images = state.detailCover.images.slice();
      const current = Math.max(0, Math.min(state.detailCover.index, images.length - 1));
      state.detailCover.images = [];
      setDetailCoverCarousel(images.slice(current).concat(images.slice(0, current)), "", { allowPoster: false, keepLoading: false });
    }

    function setDetailCoverImage(landscape, poster, options) {
      const opts = options || {};
      const cover = $("detailImage").parentElement;
      const image = $("detailImage");
      const land = String(landscape || "").trim();
      const post = String(poster || "").trim();
      const allowPoster = opts.allowPoster !== false;
      const usePoster = allowPoster && (!land || isSameImageSource(land, post));
      const src = usePoster ? post || land : land;
      const bgSrc = src ? displayImage(src, { size: usePoster ? "w780" : "w1280" }) : "";
      cover.classList.toggle("loading", !src && opts.keepLoading !== false);
      cover.classList.toggle("poster-mode", !!usePoster && !!src);
      cover.dataset.coverMode = usePoster ? "poster" : "landscape";
      cover.style.setProperty("--detail-cover-bg", bgSrc ? `url("${cssUrl(bgSrc)}")` : "none");
      const sheet = $("detailSheet");
      if (sheet) sheet.style.setProperty("--detail-hero-bg", bgSrc ? `url("${cssUrl(bgSrc)}")` : "none");
      // 同步更新全屏背景元素（仅移动端/桌面沉浸海报效果，TV端不触发）
      const heroBg = $("detailHeroBg");
      if (heroBg && !isTvLikeDevice()) {
        heroBg.style.backgroundImage = bgSrc ? `url("${cssUrl(bgSrc)}")` : "none";
        heroBg.classList.toggle("active", !!bgSrc);
        if (bgSrc) {
          const dsheet = $("detailSheet");
          if (!dsheet || (dsheet.scrollTop || 0) < 8) setDetailHeroBlur(0, 0); // 新打开从清晰开始
        }
      } else if (heroBg && isTvLikeDevice()) {
        heroBg.style.backgroundImage = "none";
        heroBg.classList.remove("active");
      }
      const blurLayer = $("detailBlurLayer");
      if (blurLayer) blurLayer.classList.toggle("active", !!bgSrc && !isTvLikeDevice());
      if (src) {
        const nextSrc = opts.preloadedSrc || bgSrc;
        const applyLoaded = () => {
          image.onload = null;
          image.onerror = null;
          image.src = nextSrc;
          resetDetailCoverFrame(cover);
          image.classList.add("active");
        };
        if (opts.preloadedSrc) {
          applyLoaded();
          return;
        }
        if (image.getAttribute("src") === nextSrc && image.classList.contains("active")) return;
        preloadImage(nextSrc, applyLoaded, () => {
          image.onload = null;
          image.onerror = null;
          image.classList.remove("active");
          image.removeAttribute("src");
          resetDetailCoverFrame(cover);
        });
      } else {
        image.onload = null;
        image.onerror = null;
        image.classList.remove("active");
        image.removeAttribute("src");
        resetDetailCoverFrame(cover);
      }
    }

    function syncDetailCoverFrame(image) {
      const cover = image && image.parentElement;
      resetDetailCoverFrame(cover);
    }

    function resetDetailCoverFrame(cover) {
      if (!cover) return;
      cover.style.width = "";
      cover.style.height = "";
      cover.style.minHeight = "";
      cover.style.maxHeight = "";
    }

    function pauseDetailCoverCarousel() {
      if (state.detailCover.timer) clearInterval(state.detailCover.timer);
      state.detailCover.timer = 0;
      state.detailCover.token += 1;
    }

    function stopDetailCoverCarousel(clearImage) {
      pauseDetailCoverCarousel();
      state.detailCover.images = [];
      state.detailCover.index = 0;
      updateDetailCoverControls();
      if (clearImage) {
        const image = $("detailImage");
        const cover = image.parentElement;
        image.onload = null;
        image.classList.remove("active");
        image.removeAttribute("src");
        cover.classList.remove("loading", "poster-mode");
        delete cover.dataset.coverMode;
        cover.style.setProperty("--detail-cover-bg", "none");
        if ($("detailSheet")) $("detailSheet").style.setProperty("--detail-hero-bg", "none");
        const heroBg2 = $("detailHeroBg");
        if (heroBg2 && !isTvLikeDevice()) { heroBg2.style.backgroundImage = "none"; heroBg2.classList.remove("active"); }
        const blurLayer2 = $("detailBlurLayer");
        if (blurLayer2 && !isTvLikeDevice()) blurLayer2.classList.remove("active");
        resetDetailCoverFrame(cover);
      }
    }

    function uniqueCoverImages(items) {
      const seen = new Set();
      return (items || []).map((item) => String(item || "").trim()).filter((item) => {
        const key = tmdbImagePath(item) || item;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function isSameImageSource(a, b) {
      const left = tmdbImagePath(a) || String(a || "").trim();
      const right = tmdbImagePath(b) || String(b || "").trim();
      return !!left && !!right && left === right;
    }

    function cssUrl(value) {
      return String(value || "").replace(/["\\\n\r]/g, "");
    }

    function detailMeta(item, detail) {
      const data = detail || {};
      const mediaType = item.mediaType === "tv" ? "剧集" : "电影";
      const date = data.first_air_date || data.release_date || item.releaseDate || "";
      const genres = (data.genres || []).map((genre) => genre && genre.name).filter(Boolean).slice(0, 2);
      const runtime = detailRuntime(data, item);
      const seasonText = item.mediaType === "tv" && data.number_of_seasons ? `${data.number_of_seasons}季` : "";
      if (useLargeDetailLayout()) {
        const year = String(date || "").slice(0, 4);
        const genreText = genres.length ? genres.slice(0, 3).join(" / ") : mediaType;
        const episodeText = item.mediaType === "tv" ? detailLargeEpisodeLabel(data) : runtime;
        const status = detailStatus(data.status || "");
        return uniqueMeta([year, genreText, episodeText, status && status !== "已完结" ? status : "", runtime && item.mediaType === "tv" ? runtime : ""])
          .slice(0, 6)
          .map((meta) => typeof meta === "string" ? { text: meta } : meta);
      }
      const metas = [
        detailDateLabel(item, date),
        seasonText,
        runtime
      ].filter(Boolean);
      genres.forEach((name) => metas.push(name));
      return uniqueMeta(metas).slice(0, 8).map((meta) => typeof meta === "string" ? { text: meta } : meta);
    }

    function detailTitleMeta(item, detail) {
      const data = detail || {};
      const mediaType = item.mediaType === "tv" ? "剧集" : "电影";
      const rating = Number(data.vote_average || item.voteAverage || 0);
      const episodeProgress = item.mediaType === "tv" ? detailEpisodeProgress(data) : "";
      const status = detailStatus(data.status || "");
      return [
        rating > 0 ? { text: `${rating.toFixed(1)}分`, type: "score" } : null,
        { text: mediaType },
        episodeProgress ? { text: episodeProgress } : null,
        status ? { text: status } : null
      ].filter(Boolean);
    }

    function detailRuntime(detail, item) {
      const runtimes = item.mediaType === "tv" ? detail.episode_run_time || [] : detail.runtime ? [detail.runtime] : [];
      const value = runtimes.find((runtime) => Number(runtime) > 0);
      if (!value) return "";
      return item.mediaType === "tv" ? `每集${Number(value)}分钟` : `${Number(value)}分钟`;
    }

    function detailEpisodeProgress(detail) {
      const total = Number(detail.number_of_episodes || 0);
      const aired = Math.max(Number(detail.last_episode_to_air && detail.last_episode_to_air.episode_number || 0), airedEpisodeFromSeason(detail));
      if (aired && total) return `${aired}/${total}集`;
      if (total) return `共${total}集`;
      if (aired) return `更新至${aired}集`;
      return "";
    }

    function detailLargeEpisodeLabel(detail) {
      const total = Number(detail && detail.number_of_episodes || 0);
      const aired = Math.max(Number(detail && detail.last_episode_to_air && detail.last_episode_to_air.episode_number || 0), airedEpisodeFromSeason(detail));
      const status = detailStatus(detail && detail.status || "");
      if (total && (status === "已完结" || aired >= total)) return `${total}集全`;
      if (aired && total) return `${aired}/${total}集`;
      if (aired) return `更新至${aired}集`;
      if (total) return `${total}集`;
      return "";
    }

    function airedEpisodeFromSeason(detail) {
      const season = detail && (detail["season/1"] || detail.season_1);
      const episodes = season && Array.isArray(season.episodes) ? season.episodes : [];
      if (!episodes.length) return 0;
      const todayMs = dateOnlyMs(today());
      return episodes.reduce((max, ep) => {
        const airMs = dateOnlyMs(ep && ep.air_date);
        if (!airMs || airMs > todayMs) return max;
        return Math.max(max, Number(ep.episode_number || 0));
      }, 0);
    }

    function detailStatus(status) {
      const map = {
        "Returning Series": "更新中",
        "Ended": "已完结",
        "Canceled": "已取消",
        "Cancelled": "已取消",
        "In Production": "制作中",
        "Planned": "计划中",
        "Released": "已上映",
        "Post Production": "后期制作"
      };
      return map[status] || status || "";
    }

    function tvEpisodeStatusLabel(detail) {
      if (!detail || typeof detail !== "object") return "";
      const total = Number(detail.number_of_episodes || 0);
      const seasons = Array.isArray(detail.seasons)
        ? detail.seasons.filter((season) => Number(season && season.season_number || 0) > 0 && Number(season && season.episode_count || 0) > 0).length
        : 0;
      const seasonCount = Math.max(Number(detail.number_of_seasons || 0), seasons);
      const last = detail.last_episode_to_air && typeof detail.last_episode_to_air === "object" ? detail.last_episode_to_air : null;
      const lastSeason = Number(last && last.season_number || 0);
      const lastEpisode = Number(last && last.episode_number || 0);
      const status = String(detail.status || "").trim();
      const ended = status === "Ended" || detailStatus(status) === "已完结";
      if (ended && total > 0) return `全 ${total} 集`;
      if (seasonCount > 1) {
        if (lastSeason > 0 && lastEpisode > 0) return `更新至 S${String(lastSeason).padStart(2, "0")}E${String(lastEpisode).padStart(2, "0")}`;
        return "";
      }
      if (lastEpisode > 0) return `更新至 ${lastEpisode} 集`;
      return "";
    }

    function varietyEpisodeStatusLabel(detail) {
      if (!detail || typeof detail !== "object") return "";
      const status = String(detail.status || "").trim().toLowerCase();
      const ended = status === "ended";
      const updating = status === "returning series";
      if (!ended && !updating) return "";
      const seasons = Array.isArray(detail.seasons) ? detail.seasons.filter((season) => Number(season && season.season_number || 0) > 0) : [];
      const seasonCount = Math.max(Number(detail.number_of_seasons || 0), seasons.length);
      const last = detail.last_episode_to_air && typeof detail.last_episode_to_air === "object" ? detail.last_episode_to_air : null;
      const lastSeason = Number(last && last.season_number || 0);
      const lastEpisode = Number(last && last.episode_number || 0);
      const currentSeason = lastSeason > 0 ? lastSeason : seasonCount === 1 ? 1 : 0;
      const seasonInfo = seasons.find((season) => Number(season && season.season_number || 0) === currentSeason);
      const knownEpisodeCount = lastEpisode > 0
        ? lastEpisode
        : Number(seasonInfo && (seasonInfo.episode_count || seasonInfo.number_of_episodes) || 0) > 0
          ? Number(seasonInfo.episode_count || seasonInfo.number_of_episodes)
          : seasonCount === 1 && Number(detail.number_of_episodes || 0) > 0
            ? Number(detail.number_of_episodes)
            : 0;
      const multiSeason = seasonCount > 1 || currentSeason > 1;
      if (knownEpisodeCount > 0) {
        if (ended) return multiSeason ? `第${currentSeason}季 · ${knownEpisodeCount}期全` : `全 ${knownEpisodeCount}期`;
        if (updating) return multiSeason ? `第${currentSeason}季 · 更新至 ${knownEpisodeCount}期` : `更新至 ${knownEpisodeCount}期`;
      }
      return ended ? "已完结" : "更新中";
    }

    function detailDateLabel(item, date) {
      if (!date) return "";
      return `${item.mediaType === "tv" ? "首播" : "上映"} ${formatDateCn(date)}`;
    }

    function formatDateCn(date) {
      const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return date || "";
      return `${match[1]}年${Number(match[2])}月${Number(match[3])}日`;
    }

    function dateOnlyMs(date) {
      const match = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return 0;
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
    }

    function uniqueMeta(items) {
      const seen = new Set();
      return items.filter((item) => {
        const text = typeof item === "string" ? item : item && item.text;
        const key = String(text || "").trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function clearDetailExtras() {
      ["castBlock", "personWorkBlock", "recommendBlock"].forEach((id) => $(id).style.display = "none");
      ["castRail", "personInfo", "personWorkRail", "recommendWorkRail"].forEach((id) => $(id).replaceChildren());
    }

    async function loadDetail(item) {
      try {
        const mediaType = String(item && item.mediaType || "").toLowerCase();
        const body = mediaType === "tv"
          ? await requestTvDetailShared(item)
          : mediaType === "movie"
            ? await requestMovieDetailShared(item)
            : await requestJson(tmdbDetailUrl(item), 18);
        if (!body || state.selected !== item) return;
        state.detail = body;
        renderDetailExtras(item, body);
      } catch (e) {
        setDetailTextContent(`详情加载失败：${e.message || "unknown"}`);
        scheduleDetailTextClamp();
        toast("详情加载失败");
      }
    }

    function detailCanonicalTitle(item, detail) {
      const itemTitle = String(item && item.title || "").trim();
      if (itemTitle) return itemTitle;
      const isTv = String(item && item.mediaType || "").toLowerCase() === "tv";
      const value = isTv
        ? detail && (detail.name || detail.original_name)
        : detail && (detail.title || detail.original_title);
      return String(value || "").trim();
    }

    function titleHasChinese(value) {
      return /[\u3400-\u9fff]/.test(String(value || ""));
    }

    function renderDetailExtras(item, detail) {
      const overview = detail.overview || item.desc || item.remark;
      if (overview) setDetailTextContent(overview);
      const canonicalTitle = detailCanonicalTitle(item, detail);
      const titleNode = $("detailTitle");
      if (titleNode && canonicalTitle) {
        titleNode.textContent = canonicalTitle;
        titleNode.style.display = "";
      }
      renderDetailMeta(item, detail);
      renderDetailTitleMeta(item, detail);
      renderDetailTitleLogo(item, detail, canonicalTitle);
      scheduleDetailTextClamp();
      renderDetailCoverFromDetail(item, detail);
      renderCast(detail.credits && detail.credits.cast || []);
      // 详情入口统一由 Direct prepare 提供资源；History 只在用户明确
      // 点击主按钮时提供季/集和进度上下文，不在详情渲染阶段自动续播。
      loadRecommendations(item);
      normalizeRails();
      updateDetailContinueButton();
      updatePostPanFocusState();
    }

    function bestDetailLogo(detail) {
      const logos = (detail && detail.images && detail.images.logos) || [];
      // 优先中文，其次英文，再其次 null（语言无标注）
      const ranked = logos.slice().sort((a, b) => {
        const langScore = (l) => l === "zh" ? 2 : l === "en" ? 1 : 0;
        const aScore = langScore(a.iso_639_1) * 1000 + (Number(a.vote_average) || 0) * 10 + Math.min(Number(a.vote_count) || 0, 100);
        const bScore = langScore(b.iso_639_1) * 1000 + (Number(b.vote_average) || 0) * 10 + Math.min(Number(b.vote_count) || 0, 100);
        return bScore - aScore;
      });
      return ranked[0] || null;
    }

    function renderDetailTitleLogo(item, detail, canonicalTitle) {
      // emby 风格：使用 detailLogoWrap / detailLogoImg
      const wrap = $("detailLogoWrap");
      const img = $("detailLogoImg");
      const title = $("detailTitle");
      if (!wrap || !img) return;
      const displayTitle = String(canonicalTitle || detailCanonicalTitle(item, detail) || item && item.title || "").trim();
      if (title && displayTitle) title.textContent = displayTitle;
      if (titleHasChinese(displayTitle)) {
        wrap.style.display = "none";
        wrap.classList.remove("logo-ready");
        img.removeAttribute("src");
        img.classList.remove("loaded");
        if (title) title.style.display = "";
        return;
      }
      const logo = bestDetailLogo(detail);
      if (!logo || !logo.file_path) {
        wrap.style.display = "none";
        img.removeAttribute("src");
        img.classList.remove("loaded");
        if (title) { title.style.display = ""; }
        return;
      }
      const logoUrl = `https://image.tmdb.org/t/p/w500${logo.file_path}`;
      // 检查是否已渲染同一张图
      if (img.getAttribute("src") === logoUrl && img.classList.contains("loaded")) return;
      img.classList.remove("loaded");
      wrap.style.display = "flex";
      img.alt = displayTitle || item.title || "";
      img.onload = () => {
        img.classList.add("loaded");
        if (title) title.style.display = "none";
        wrap.classList.add("logo-ready");
      };
      img.onerror = () => {
        wrap.style.display = "none";
        img.classList.remove("loaded");
        if (title) title.style.display = "";
      };
      img.src = logoUrl;
    }

    function detailPrimaryActionButton() {
      return [$("detailContinueBtn"), $("detailSearchBtn"), $("panSearchBtn")].find(isVisibleFocusable) || null;
    }

    function isDetailPrimaryAction(el) {
      const button = el && el.closest ? el.closest("button") || el : el;
      if (!button || !button.id || !button.closest || !button.closest("#detailSheet > .actions")) return false;
      return button.id === "detailContinueBtn" || button.id === "detailSearchBtn" || button.id === "panSearchBtn";
    }

    function recordDetailTopAnchorDiag(reason, fromTarget, toTarget, before, after) {
      if (!isTvDiagnosticEnabled()) return;
      const entry = {
        reason: String(reason || "detail_top_anchor"),
        fromTargetId: String(fromTarget && fromTarget.id || ""),
        toTargetId: String(toTarget && toTarget.id || ""),
        scrollTopBefore: Math.round(Number(before) || 0),
        scrollTopAfter: Math.round(Number(after) || 0)
      };
      state.tvDiag.detailTopAnchor = entry;
      try { console.debug("[Nostr TV DETAIL_TOP_ANCHOR]", entry); } catch (e) {}
      updateTvDiagnostic();
    }

    function restoreDetailTopAnchor(options) {
      const opts = options || {};
      const detail = $("detailSheet");
      if (!detail || !detail.classList.contains("active")) return false;
      const fromTarget = opts.fromTarget || document.activeElement;
      const requestedTarget = opts.target || null;
      const target = isVisibleFocusable(requestedTarget) ? requestedTarget : null;
      const before = Math.round(Number(detail.scrollTop || 0));
      detail.scrollTop = 0;
      if (target) {
        try {
          target.focus({ preventScroll: true });
        } catch (e) {
          target.focus();
        }
      }
      const after = Math.round(Number(detail.scrollTop || 0));
      recordDetailTopAnchorDiag(opts.reason, fromTarget, target, before, after);
      requestAnimationFrame(() => {
        if (!detail.isConnected || !detail.classList.contains("active")) return;
        const beforeReassert = Math.round(Number(detail.scrollTop || 0));
        if (beforeReassert !== 0) detail.scrollTop = 0;
        const afterReassert = Math.round(Number(detail.scrollTop || 0));
        if (afterReassert !== after) recordDetailTopAnchorDiag(opts.reason, fromTarget, target, before, afterReassert);
        scheduleUiSnapshotSave();
      });
      return true;
    }

    function scheduleDetailTextClamp() {
      requestAnimationFrame(() => requestAnimationFrame(updateDetailTextClamp));
    }

    function isMobileDetailSheetActive(sheet) {
      const target = sheet || $("detailSheet");
      return !!(document.documentElement.classList.contains("native-mobile-app") && target && target.classList.contains("active") && !target.classList.contains("detail-large"));
    }

    function detailTextPlain(text) {
      return String(text && text.textContent || "").replace(/\s+/g, "").trim();
    }

    function setDetailTextContent(value) {
      const text = $("detailText");
      if (!text) return;
      text.dataset.fullText = String(value || "");
      text.textContent = text.dataset.fullText;
      text.removeAttribute("data-detail-toggle");
      text.removeAttribute("data-more-label");
    }

    // 让影片简介本身可点击；普通浏览器/移动端可聚焦，TV 遥控器不纳入 Focus Graph。
    // on=true 时按设备模式决定 .focusable + tabindex，展开/收起点击行为始终保留。
    function setDetailTextFocusable(on) {
      const text = $("detailText");
      if (!text) return;
      if (on) {
        // 简介仍保留 pointer click 展开/收起，但 TV 遥控器不把整段
        // 文本加入 Focus Graph；移动端/普通浏览器沿用原有行为。
        text.classList.toggle("focusable", !isTvLikeDevice());
        text.classList.add("detail-expandable");
        text.setAttribute("tabindex", isTvLikeDevice() ? "-1" : "0");
      } else {
        text.classList.remove("focusable", "detail-expandable");
        text.setAttribute("tabindex", "-1");
      }
    }

    function renderMobileDetailText(expanded, options) {
      const text = $("detailText");
      const more = $("detailMoreBtn");
      if (!text || !more) return false;
      const raw = String(text.dataset.fullText || text.textContent || "");
      const plain = raw.replace(/\s+/g, "").trim();
      const opts = options || {};
      if (text.textContent !== raw) text.textContent = raw;
      text.removeAttribute("data-more-label");
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight || "21") || 21;
      const maxLines = 3;
      const targetHeight = Math.round(lineHeight * maxLines + Math.max(4, lineHeight * .16));
      if (!plain) {
        text.textContent = raw;
        text.removeAttribute("data-detail-toggle");
        text.classList.remove("clamped");
        setDetailTextFocusable(false);
        more.style.display = "none";
        return false;
      }
      text.style.setProperty("--detail-text-max", `${targetHeight}px`);
      const needsToggle = opts.forceToggle || text.scrollHeight > targetHeight + 1;
      if (!needsToggle) {
        text.removeAttribute("data-detail-toggle");
        text.classList.remove("clamped");
        setDetailTextFocusable(false);
        more.style.display = "none";
        return false;
      }
      text.dataset.detailToggle = expanded ? "collapse" : "expand";
      text.classList.toggle("clamped", !expanded);
      setDetailTextFocusable(true);
      more.dataset.expanded = expanded ? "1" : "";
      more.textContent = expanded ? "收起" : "更多";
      more.style.display = "inline-flex";
      more.style.visibility = "";
      return true;
    }

    function resetDetailTextClamp() {
      const text = $("detailText");
      const more = $("detailMoreBtn");
      if (text) {
        text.classList.remove("clamped");
        text.removeAttribute("data-detail-toggle");
        text.removeAttribute("data-more-label");
        text.style.removeProperty("--detail-text-max");
        setDetailTextFocusable(false);
      }
      if (more) {
        more.dataset.expanded = "";
        more.style.display = "none";
        more.style.visibility = "";
        more.textContent = "更多";
      }
    }

    function detailTextClampLimit() {
      return useLargeDetailLayout() ? DETAIL_TEXT_CLAMP_LIMIT_LARGE : DETAIL_TEXT_CLAMP_LIMIT;
    }

    function updateDetailTextClamp() {
      const sheet = $("detailSheet");
      const text = $("detailText");
      const more = $("detailMoreBtn");
      const actions = more && more.closest(".detail-info") && more.closest(".detail-info").nextElementSibling;
      if (!sheet || !text || !more || !actions || !sheet.classList.contains("active")) return;
      const mobileDetail = isMobileDetailSheetActive(sheet);
      if (more.dataset.expanded === "1") {
        if (mobileDetail) {
          renderMobileDetailText(true, { forceToggle: true });
          return;
        }
        text.classList.remove("clamped");
        text.removeAttribute("data-more-label");
        text.style.removeProperty("--detail-text-max");
        // 已展开：保持可聚焦/可点击，方便再次点击收起；按钮始终隐藏
        setDetailTextFocusable(true);
        more.style.display = "none";
        more.style.visibility = "";
        return;
      }
      text.classList.remove("clamped");
      text.removeAttribute("data-more-label");
      text.style.removeProperty("--detail-text-max");
      more.style.display = "none";
      more.style.visibility = "";
      more.textContent = "更多";
      if (mobileDetail) {
        renderMobileDetailText(false);
        return;
      }
      // 大布局（TV）：内容超过 3 行则折叠为 3 行，点击文字展开；不再显示“更多”按钮
      const naturalHeight = text.scrollHeight;
      const lineHeight = parseFloat(getComputedStyle(text).lineHeight || "21") || 21;
      const threeLines = lineHeight * 3 + 2;
      if (naturalHeight > threeLines) {
        text.classList.add("clamped");
        setDetailTextFocusable(true);
      } else {
        setDetailTextFocusable(false);
      }
    }

    function toggleDetailTextMore() {
      const more = $("detailMoreBtn");
      if (!more) return;
      more.dataset.expanded = more.dataset.expanded === "1" ? "" : "1";
      updateDetailTextClamp();
      scheduleUiSnapshotSave();
    }

    function handleDetailTextClick() {
      const sheet = $("detailSheet");
      const text = $("detailText");
      const more = $("detailMoreBtn");
      if (!sheet || !text || !more) return;
      // 仅当简介处于“可展开/可收起”状态时才响应点击
      const expanded = more.dataset.expanded === "1";
      if (!expanded && !text.classList.contains("clamped")) return;
      more.dataset.expanded = expanded ? "" : "1";
      updateDetailTextClamp();
      scheduleUiSnapshotSave();
    }

    function renderDetailCoverFromDetail(item, detail) {
      const detailLandscapes = bestDetailBackdrops(detail, 8);
      const detailLandscape = detailLandscapes[0] || "";
      const detailPoster = imageUrl(detail.poster_path, false) || item.pic;
      const posterFallback = detailPoster || item.pic || "";
      if (detailLandscapes.length) {
        item.landscape = detailLandscape;
        item.pic = item.pic || posterFallback;
        setDetailCoverCarousel(detailLandscapes, posterFallback, { allowPoster: false });
      } else if (posterFallback) {
        item.landscape = "";
        item.pic = item.pic || posterFallback;
        setDetailCoverCarousel([], posterFallback, { allowPoster: true, keepLoading: false });
      }
    }

    function bestDetailBackdrops(detail, limit) {
      const candidates = [];
      if (detail && detail.backdrop_path) candidates.push({ file_path: detail.backdrop_path, vote_average: 11, vote_count: Number.MAX_SAFE_INTEGER, width: 1280, height: 720 });
      (detail && detail.images && detail.images.backdrops || []).forEach((img) => {
        if (img && img.file_path) candidates.push(img);
      });
      return candidates
        .filter((img) => img && img.file_path)
        .sort((a, b) => backdropScore(b) - backdropScore(a))
        .slice(0, limit || 8)
        .map((img) => imageUrl(img.file_path, true));
    }

    function backdropScore(img) {
      const vote = Number(img && img.vote_average || 0);
      const count = Number(img && img.vote_count || 0);
      const width = Number(img && img.width || 0);
      const height = Number(img && img.height || 0);
      const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
      const ratioPenalty = Math.abs(ratio - 16 / 9) * 1.4;
      return vote * 1000 + Math.min(count, 1000) * 2 + Math.min(width, 3840) / 20 - ratioPenalty * 100;
    }

    function renderCast(cast) {
      const people = cast.filter((person) => person.profile_path).slice(0, 20);
      if (!people.length) return;
      $("castBlock").style.display = "";
      $("castRail").replaceChildren(...people.map((person) => {
        const button = document.createElement("button");
        button.className = "person-card focusable";
        button.type = "button";
        const profile = displayImage(imageUrl(person.profile_path, false), { size: "w185" });
        const zhName = escapeHtml(person.name || "");
        const enName = person.original_name && person.original_name !== person.name
          ? escapeHtml(person.original_name) : "";
        const role = escapeHtml(person.character || person.known_for_department || "");
        button.innerHTML = `
          <img alt="${zhName}" ${imageAttrs(profile)}>
          <div>
            <b>${zhName}</b>
            ${enName ? `<span class="person-en-name">${enName}</span>` : ""}
            ${role ? `<span>${role}</span>` : ""}
          </div>
        `;
        button.addEventListener("click", () => loadPersonWorks(person));
        return button;
      }));
    }

    async function loadPersonWorks(person) {
      try {
        $("personWorkTitle").textContent = "简介";
        $("personWorkBlock").style.display = "";
        renderPersonInfo(person, null);
        $("personWorkRail").replaceChildren(emptyNode("加载中..."));
        const body = await requestJson(tmdbPersonDetailUrl(person.id), 18);
        renderPersonInfo(person, body);
        const credits = body.combined_credits || body;
        const works = (credits.cast || []).filter((item) => (item.media_type === "movie" || item.media_type === "tv") && item.poster_path).slice(0, 18).map((value, index) => normalizeTmdb(value, { id: "person", title: "关联作品", mediaType: value.media_type }, index));
        fillRail($("personWorkRail"), works);
        updatePostPanFocusState();
      } catch (e) {
        renderPersonInfo(person, null);
        $("personWorkRail").replaceChildren(emptyNode("关联作品加载失败"));
        updatePostPanFocusState();
      }
    }

    async function loadRecommendations(item) {
      const block = $("recommendBlock");
      const rail = $("recommendWorkRail");
      if (!block || !rail || !item || !item.tmdbId || !item.mediaType) return;
      try {
        const body = await requestJson(tmdbRecommendationsUrl(item), 18);
        if (state.selected !== item) return;
        const works = (body.results || [])
          .map((value, index) => {
            const mediaType = value.media_type || item.mediaType;
            if ((mediaType !== "movie" && mediaType !== "tv") || !value.poster_path) return null;
            return normalizeTmdb(value, { id: "recommend", title: "相关推荐", mediaType }, index);
          })
          .filter(Boolean)
          .slice(0, 18);
        if (!works.length) {
          block.style.display = "none";
          rail.replaceChildren();
          return;
        }
        block.style.display = "";
        fillRail(rail, works);
        updatePostPanFocusState();
      } catch (e) {
        if (state.selected === item) {
          block.style.display = "none";
          rail.replaceChildren();
        }
      }
    }

    function renderPersonInfo(person, detail) {
      const root = $("personInfo");
      if (!root) return;
      const biography = detail && detail.biography || "暂无人物简介";
      root.innerHTML = `
        <div class="person-info" aria-live="polite">
          <div class="person-info-body">
            <p>${escapeHtml(biography)}</p>
          </div>
        </div>
      `;
    }

    function resetPanSearch() {
      resetPanSearchState(true);
    }

    function resetPanSearchState(hideBlock, options) {
      const opts = options || {};
      const preserveResults = !!opts.preserveResults;
      const preserveHealth = !!opts.preserveHealth;
      const preserveFocus = !!opts.preserveFocus;
      const preservePlaybackReturn = !!opts.preservePlaybackReturn;
      endPanSearchSession(opts.reason || "replaced");
      clearPanSessionTimer();
      if (state.pan.observer) {
        state.pan.observer.disconnect();
        state.pan.observer = null;
      }
      clearTimeout(state.pan.flushTimer);
      state.pan.flushTimer = 0;
      clearPanPollTimers();
      state.pan.pollRound = 0;
      state.pan.pollRoundStarted = {};
      state.pan.loading = false;
      if (!preserveResults) state.pan.results = [];
      state.pan.activeType = "";
      if (!preserveHealth) state.pan.health = {};
      state.pan.pending = {};
      state.pan.queued.clear();
      state.pan.inFlight.clear();
      state.pan.keyword = "";
      state.pan.sessionOrigin = "";
      state.pan.sessionItemKey = "";
      state.pan.sessionStartedAt = 0;
      state.pan.sessionTerminal = true;
      state.pan.sessionTerminalReason = String(opts.reason || "replaced");
      state.pan.sessionEndRecorded = true;
      state.pan.requestSeq = 0;
      state.pan.actualRequestAttempts = 0;
      state.pan.initialAttempts = 0;
      state.pan.pollRoundsStarted = 0;
      state.pan.pollRoundsCompleted = 0;
      state.pan.foregroundRecoveryCount = 0;
      state.pan.initialResultState = "";
      state.pan.viewToken = "";
      state.pan.searchMode = "";
      state.pan.initialSucceeded = false;
      state.pan.lastFailureKind = "";
      state.pan.retryRemaining = 0;
      state.pan.finalFailure = false;
      state.pan.directTransportExhausted = false;
      state.pan.directReady = null;
      state.pan.directFailure = null;
      state.pan.renderKeys = "";
      state.pan.tabKeys = "";
      if (!preserveFocus) {
        state.pan.focusKey = "";
        state.pan.focusMode = "";
      }
      state.pan.lastTypeSelect = null;
      state.pan.keepBlockPositionUntil = 0;
      if (!preservePlaybackReturn) state.pan.playbackReturn = null;
      setPanProgress(false, "", 0, 0);
      if (hideBlock && $("panSearchBlock")) {
        $("panSearchBlock").classList.remove("active");
        $("panSearchBlock").style.display = "none";
      }
      if (hideBlock) updatePostPanFocusState();
      if (hideBlock) {
        if ($("panSearchHint")) $("panSearchHint").textContent = "";
        if ($("panTabs")) $("panTabs").replaceChildren();
        if ($("panResultList")) $("panResultList").replaceChildren();
      }
    }

    function panItemIsRangePack(title) {
      const t = String(title || "");
      return /S?\d{1,2}\s*E\d{1,3}\s*[-~～]\s*E?\d{1,3}/i.test(t)   // S01E01-E24 / E01-E24
          || /第\s*\d{1,3}\s*[-~～]\s*\d{1,3}\s*集/.test(t)          // 第1-24集
          || /\bE\d{1,3}\s*[-~～]\s*\d{1,3}\b/i.test(t)              // E01-24
          || /全\s*\d{1,3}\s*集/.test(t)                            // 全24集
          || /合集|全集|完结合集|打包/.test(t);
    }

    // 单条盘搜资源是否精确命中「第 epNo 集」（季号 season）
    function panItemMatchesEpisode(item, season, epNo) {
      const t = String(item && (item.title || item.fileName || item.file_name || item.filename) || "");
      if (!t) return false;
      if (panItemIsRangePack(t)) return false;        // 区间/整季包不算单集
      const s = Number(season) || 1;
      const n = Number(epNo) || 0;
      if (!n) return false;
      const seasonMarker = t.match(/(?:^|[^0-9A-Za-z])S\s*0*(\d+)(?![0-9])/i) || t.match(/第\s*0*(\d+)\s*季/);
      if (seasonMarker && Number(seasonMarker[1]) !== s) return false;
      const reSE = new RegExp(`S0*${s}\\s*E0*${n}(?![0-9E])`, "i");      // S01E23
      const reEP = new RegExp(`(?:^|[^0-9A-Za-z])EP0*${n}(?![0-9])`, "i");// 独立 EP23
      const reE  = new RegExp(`(?:^|[^0-9A-Za-z])E0*${n}(?![0-9])`, "i");// 独立 E23
      const reCN = new RegExp(`第\\s*0*${n}\\s*集(?!\\s*[-~～])`);        // 第23集
      return reSE.test(t) || reEP.test(t) || reE.test(t) || reCN.test(t);
    }

    // 候选排序：115 优先，其次其它单集源，同源按画质分
    function panDiskOrder(item) {
      const order = { "115": 0, "quark": 1, "aliyun": 1, "uc": 1, "123": 1, "tianyi": 1, "mobile": 1, "xunlei": 2, "baidu": 2 };
      var _o = order[normalizePanDiskType(item && item.diskType)]; return _o != null ? _o : 3;
    }
    function rankPanCandidates(arr) {
      return arr.slice().sort((a, b) => {
        const d = panDiskOrder(a) - panDiskOrder(b);
        if (d) return d;
        return panQualityInfo(b).score - panQualityInfo(a).score;
      });
    }

    // 「全集/全包」字眼评分：标题越像完整合集分越高（优先选带「全集」字样的）
    function panPackScore(item) {
      const t = String(item && item.title || "");
      let score = 0;
      if (/全\s*\d{1,3}\s*集/.test(t)) score += 6;          // 全24集
      if (/全集/.test(t)) score += 5;                        // 全集
      if (/完结|大结局|完结篇/.test(t)) score += 3;          // 完结
      if (/合集|打包/.test(t)) score += 2;                   // 合集/打包
      if (/S?\d{1,2}\s*E\d{1,3}\s*[-~～]\s*E?\d{1,3}/i.test(t)) score += 2; // S01E01-E24
      if (/第\s*\d{1,3}\s*[-~～]\s*\d{1,3}\s*集/.test(t)) score += 2;        // 第1-24集
      return score;
    }

    // 全集包排序：不限网盘、择优——优先「全集」字眼，其次画质，网盘仅作次要 tiebreak
    function rankPanPacks(arr) {
      return arr.slice().sort((a, b) => {
        const ps = panPackScore(b) - panPackScore(a);
        if (ps) return ps;
        const q = panQualityInfo(b).score - panQualityInfo(a).score;
        if (q) return q;
        return panDiskOrder(a) - panDiskOrder(b);
      });
    }

    // 当前搜索关键字拆词（用于「标题命中关键字越多越贴合本剧」的判断）
    function panKeywordTokens() {
      const kw = String(state.pan.keyword || "");
      return kw
        .split(/[\s·:：\-—_,，.。、/|()【】\[\]]+/)
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length >= 1);
    }
    // 标题命中当前关键字 token 的数量（命中越多 → 越是本剧、资源越完整）
    function panKeywordHitScore(item) {
      const t = String(item && item.title || "").toLowerCase();
      if (!t) return 0;
      const tokens = panKeywordTokens();
      if (!tokens.length) return 0;
      let hit = 0;
      tokens.forEach((tok) => { if (t.indexOf(tok) >= 0) hit++; });
      return hit;
    }

    // 夸克全集包排序：画质优先（这样画质好），其次命中关键字越多越好，再看全集字眼/画质标签数
    function rankQuarkPacks(arr) {
      return arr.slice().sort((a, b) => {
        const q = panQualityInfo(b).score - panQualityInfo(a).score;   // 1) 画质分高优先
        if (q) return q;
        const kh = panKeywordHitScore(b) - panKeywordHitScore(a);       // 2) 关键字命中多优先
        if (kh) return kh;
        const ps = panPackScore(b) - panPackScore(a);                  // 3) 越像完整全集优先
        if (ps) return ps;
        return panQualityInfo(b).count - panQualityInfo(a).count;       // 4) 画质标签更多优先
      });
    }

    // 标题是否为「本季全集/合集包」（可整包播放，进播放器后由用户自己选集）
    function panItemIsSeasonPack(item, season) {
      const t = String(item && item.title || "");
      if (!panItemIsRangePack(t)) return false;
      const s = Number(season) || 1;
      if (new RegExp(`S0*${s}(?![0-9])`, "i").test(t)) return true;     // 明确 S01
      if (new RegExp(`第\\s*0*${s}\\s*季`).test(t)) return true;         // 第1季
      const mSe = /S0*(\d+)/i.exec(t);
      if (mSe && Number(mSe[1]) !== s) return false;                    // 标题指向其它季 → 排除
      const mCn = /第\s*0*(\d+)\s*季/.exec(t);
      if (mCn && Number(mCn[1]) !== s) return false;
      return true;                                                      // 无季号的全集 → 视为本季
    }

    function panCheckAvailable() {
      const pan = sdk().pan || {};
      return typeof pan.check === "function";
    }

    // 对少量候选做一次有效性校验，返回 key->state 并写回 state.pan.health
