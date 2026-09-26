    function curatedSourceDefinitions() {
      const config = state.pan.config || defaultPanConfig();
      const domains = sanitizeSourceDomains(config.sourceDomains);
      return CURATED_SOURCE_DEFINITIONS.map((source) => Object.assign({}, source, {
        domains: (domains[source.id] || source.domains || []).slice()
      }));
    }

    function detailPlaybackIsCurrent(run) {
      return !!(run && state.detailPlayback === run && state.selected === run.item
        && String(run.itemKey || "") === panSearchItemKey(state.selected));
    }

    function curatedAbsoluteUrl(value, base) {
      const text = String(value || "").trim();
      if (!text || /^(?:javascript|data|mailto):/i.test(text)) return "";
      try {
        const parsed = new URL(text, base || location.href);
        return /^https?:$/i.test(parsed.protocol) ? parsed.href : "";
      } catch (e) {
        return "";
      }
    }

    async function requestCuratedHtml(url, timeout, options) {
      const opts = options || {};
      let referer = String(opts.referer || "").trim();
      if (!referer) {
        try { referer = new URL(url).origin + "/"; } catch (e) { referer = String(url || location.href); }
      }
      const headers = {
        "User-Agent": CURATED_REQUEST_USER_AGENT,
        Referer: referer
      };
      const requestTimeout = Math.max(1, Number(timeout || CURATED_REQUEST_TIMEOUT_SEC));
      const response = await sdk().req(url, { method: "GET", responseType: "text", timeout: requestTimeout, headers });
      if (response && response.error) throw new Error(String(response.error));
      if (response && response.ok === false) throw new Error("HTTP " + Number(response.status || 0));
      if (response && Number(response.status || 0) >= 400) throw new Error("HTTP " + Number(response.status));
      const raw = response && response.body != null ? response.body : response && response.data != null ? response.data : response;
      const html = typeof raw === "string" ? raw : raw && (raw.html || raw.content || raw.text) || "";
      if (!String(html || "").trim()) throw new Error("站源返回空页面");
      return {
        html: String(html),
        base: String(response && response.url || url),
        status: Number(response && response.status || 0)
      };
    }

    async function requestCuratedJson(url, timeout, options) {
      const opts = options || {};
      let referer = String(opts.referer || "").trim();
      if (!referer) {
        try { referer = new URL(url).origin + "/"; } catch (e) { referer = String(url || location.href); }
      }
      const headers = {
        "User-Agent": CURATED_REQUEST_USER_AGENT,
        Referer: referer
      };
      const requestTimeout = Math.max(1, Number(timeout || CURATED_REQUEST_TIMEOUT_SEC));
      const response = await sdk().req(url, { method: "GET", responseType: "text", timeout: requestTimeout, headers });
      if (response && response.error) throw new Error(String(response.error));
      if (response && response.ok === false) throw new Error("HTTP " + Number(response.status || 0));
      if (response && Number(response.status || 0) >= 400) throw new Error("HTTP " + Number(response.status));
      const raw = response && response.body != null ? response.body : response && response.data != null ? response.data : response;
      let body = raw;
      if (typeof body === "string") {
        try { body = JSON.parse(body); } catch (e) { throw new Error("站源返回无效 JSON"); }
      }
      if (!body || typeof body !== "object") throw new Error("站源返回无效 JSON");
      return {
        body,
        base: String(response && response.url || url),
        status: Number(response && response.status || 0)
      };
    }

    function curatedDeadlineError(kind) {
      const error = new Error(String(kind || "SOURCE_TIMEOUT"));
      error.curatedDeadline = true;
      error.curatedDeadlineKind = String(kind || "SOURCE_TIMEOUT");
      return error;
    }

    function curatedRemainingMs(context) {
      const sourceDeadline = context && Number(context.sourceDeadline);
      const chainDeadline = context && Number(context.chainDeadline);
      const sourceRemaining = Number.isFinite(sourceDeadline) ? sourceDeadline - Date.now() : Infinity;
      const chainRemaining = Number.isFinite(chainDeadline) ? chainDeadline - Date.now() : Infinity;
      return Math.max(0, Math.min(sourceRemaining, chainRemaining));
    }

    function curatedNativeTimeoutSec(remainingMs) {
      return Math.min(
        CURATED_REQUEST_TIMEOUT_SEC,
        Math.max(1, Math.ceil(Math.max(0, Number(remainingMs) || 0) / 1000))
      );
    }

    function curatedAttemptState(context, run) {
      if (!detailPlaybackIsCurrent(run)) return "STALE";
      if (!context || !context.active || curatedRemainingMs(context) <= 0) return "SOURCE_TIMEOUT";
      return "";
    }

    function curatedRequestStartState(context, run) {
      const state = curatedAttemptState(context, run);
      if (state) return state;
      return curatedRemainingMs(context) < CURATED_MIN_REQUEST_START_MS ? "SOURCE_TIMEOUT" : "";
    }

    function recordCuratedRaceDiag(event, detail) {
      const payload = Object.assign({ event: String(event || "") }, detail || {});
      try {
        if (state.tvDiag) {
          const log = Array.isArray(state.tvDiag.curatedRaceLog) ? state.tvDiag.curatedRaceLog : [];
          log.push(payload);
          if (log.length > 60) log.splice(0, log.length - 60);
          state.tvDiag.curatedRaceLog = log;
          state.tvDiag.curatedRace = payload;
        }
      } catch (e) {}
      try {
        if (typeof isTvDiagnosticEnabled !== "function" || isTvDiagnosticEnabled()) {
          console.debug("[Nostr TV] " + String(event || "CURATED"), payload);
        }
      } catch (e) {}
      return payload;
    }

    function recordWanouDiag(event, detail) {
      return recordCuratedRaceDiag(event, Object.assign({ sourceId: "wanou" }, detail || {}));
    }

    function recordCuratedRaceSummary(run, detail) {
      if (run && run.curatedSummarySent) return false;
      if (run) run.curatedSummarySent = true;
      const payload = Object.assign({
        event: "CURATED_RACE_SUMMARY",
        runId: run && (run.id || run.runId || run.itemKey) || "",
        runReason: String(run && (run.reason || run.playbackReason) || ""),
        keyword: "",
        resourceSearchTitle: "",
        discoveryWindowMs: CURATED_DISCOVERY_WINDOW_MS,
        qualityGraceMs: CURATED_QUALITY_GRACE_MS,
        preflightBudgetMs: CURATED_PREFLIGHT_BUDGET_MS,
        sources: [],
        firstCandidateMs: null,
        firstCandidateSource: "",
        collectionDoneMs: null,
        collectionReason: "",
        preflightStartMs: null,
        preflightDurationMs: null,
        preflightTimedOut: false,
        preflightFreshStateCount: 0,
        healthAcceptedCount: 0,
        healthRejectedCount: 0,
        healthUnconfirmedCount: 0,
        selectedSource: "",
        selectedDiskType: "",
        plannedSearchKeywords: [],
        selectedEntryTitle: "",
        selectedExtractionMethod: "",
        selectedUrlHost: "",
        totalCuratedMs: 0
      }, detail || {});
      recordCuratedRaceDiag("CURATED_RACE_SUMMARY", payload);
      const message = "CURATED_RACE_SUMMARY " + JSON.stringify(payload);
      try {
        const api = sdk();
        const candidates = [
          { owner: api && api.ext, method: api && api.ext && api.ext.log },
          { owner: window.fm && window.fm.ext, method: window.fm && window.fm.ext && window.fm.ext.log },
          { owner: api, method: api && api.log },
          { owner: window.fm, method: window.fm && window.fm.log }
        ];
        const target = candidates.find((entry) => entry.owner && typeof entry.method === "function");
        if (target) {
          const result = target.method.call(target.owner, message);
          if (result && typeof result.catch === "function") result.catch(() => {});
        }
      } catch (e) {}
      return true;
    }

    // Native 请求本身无法可靠取消；将迟到的 resolve/reject 都包进已消费的 Promise，
    // 这样超时后既不阻塞后续站源，也不会把迟到结果写回当前 source/run。
    function curatedRequestWithDeadline(task, context, kind) {
      const allowedMs = curatedRemainingMs(context);
      if (allowedMs <= 0) return Promise.reject(curatedDeadlineError(kind || "SOURCE_TIMEOUT"));
      const requestTask = Promise.resolve()
        .then(task)
        .then(
          (value) => ({ type: "value", value }),
          (error) => ({ type: "error", error })
        );
      let timer = 0;
      const timeoutTask = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ type: "timeout" }), Math.max(1, allowedMs));
      });
      return Promise.race([requestTask, timeoutTask]).then((result) => {
        clearTimeout(timer);
        if (result && result.type === "timeout") throw curatedDeadlineError(kind || "SOURCE_TIMEOUT");
        if (result && result.type === "error") throw result.error;
        return result && result.value;
      });
    }

    function curatedCleanTitle(value) {
      return normalizeTitle(String(value || "")
        .replace(/第\s*[一二三四五六七八九十百\d]+\s*季|Season\s*\d+|S\d{1,3}/ig, "")
        .replace(/导演剪辑版|未删减版|加长版|蓝光原盘|原盘|remastered|blu[- ]?ray|remux|2160p|1080p|720p|4k|hdr10\+?|hdr|dolby\s*vision|dovi|国语|粤语|国粤双语|双语|中字|高码|高码率|杜比全景声/ig, ""));
    }

    function curatedYear(value) {
      const match = String(value || "").match(/(?:19|20)\d{2}/);
      return match ? match[0] : "";
    }

    function curatedEntryYear(node, anchor, remark) {
      const dataYearValues = [
        anchor && anchor.getAttribute && anchor.getAttribute("data-year"),
        node && node.getAttribute && node.getAttribute("data-year")
      ];
      const structuredNode = node && node.querySelector
        ? node.querySelector(".year,.module-item-year,.video-year,[data-year]")
        : null;
      if (structuredNode) {
        dataYearValues.push(
          structuredNode.getAttribute && structuredNode.getAttribute("data-year"),
          structuredNode.textContent
        );
      }
      const structuredYear = dataYearValues.map((value) => curatedYear(value)).find(Boolean) || "";
      if (structuredYear) {
        return { year: structuredYear, yearTrusted: true, yearSource: "STRUCTURED" };
      }
      const extractedYear = curatedYear(remark) || curatedYear(node && node.textContent || "");
      return {
        year: extractedYear,
        yearTrusted: false,
        yearSource: extractedYear ? "TEXT_FALLBACK" : ""
      };
    }

    function mediaIdentityMarkers(value) {
      const text = String(value || "");
      return {
        liveAction: /(?:真人版|真人剧|真人电影|真人演绎|live[\s._-]*action)/i.test(text),
        animation: /(?:动画版|动漫版|\banime\b)/i.test(text),
        movie: /(?:剧场版|电影版|\bmovie\b)/i.test(text),
        special: /(?:特别篇|番外|特辑|\b(?:ova|oad|sp|special)\b)/i.test(text)
      };
    }

    function mediaIdentityNormalizeTitle(value) {
      return normalizeTitle(String(value || "")
        .replace(/立刻\s*播放|立即\s*播放|点击\s*播放|在线播放/gi, " ")
        .replace(/S\d{1,3}(?:\s*E\d{1,4})?|Season\s*\d+|第\s*[一二三四五六七八九十百\d]+\s*季|年番/ig, " ")
        .replace(/(?:E|EP)\s*\d{1,4}|第\s*[一二三四五六七八九十百\d]+\s*(?:集|话)/ig, " ")
        .replace(/全\s*[一二三四五六七八九十百\d]+\s*集|全集|合集|完结|打包/ig, " ")
        .replace(/4K|2160P|1080P|720P|HDR10\+?|HDR|DV|Dolby\s*Vision|REMUX|Blu[- ]?Ray|HEVC|H\.?265|AVC|H\.?264|WEB[- ]?DL|WEBRip/ig, " ")
        .replace(/国语|粤语|双语|中字|国粤双语/ig, " ")
        .replace(/(?:19|20)\d{2}/g, " "));
    }

    function mediaIdentityAliases(item) {
      return mergeTitleAliases(
        item && item.resourceSearchTitle,
        item && item.title,
        item && item.originalTitle,
        item && item.original_title,
        item && item.originalName,
        item && item.original_name,
        item && item.aliases
      ).map((value) => ({
        raw: String(value || "").trim(),
        normalized: mediaIdentityNormalizeTitle(value)
      })).filter((alias) => alias.raw && alias.normalized.length >= 2);
    }

    function mediaIdentityVerdict(item, candidateTitle, metadata) {
      const meta = metadata && typeof metadata === "object" ? metadata : {};
      const candidateTitleText = String(candidateTitle || "").trim();
      const candidateMetadataText = `${String(meta.remark || "").trim()} ${String(meta.year || "").trim()}`.trim();
      const candidateEvidenceText = `${candidateTitleText} ${candidateMetadataText}`.trim();
      const normalizedCandidate = mediaIdentityNormalizeTitle(candidateTitleText);
      const aliases = mediaIdentityAliases(item);
      const targetMarkerText = aliases.map((alias) => alias.raw).join(" ");
      const targetMarkers = mediaIdentityMarkers(targetMarkerText);
      const candidateMarkers = mediaIdentityMarkers(candidateEvidenceText);
      const conflicts = [];
      const genreIds = [];
      if (Array.isArray(item && item.genreIds)) genreIds.push(...item.genreIds);
      if (Array.isArray(item && item.genre_ids)) genreIds.push(...item.genre_ids);
      const animationTarget = genreIds.map((value) => String(value)).includes("16") || targetMarkers.animation;
      const mediaType = String(item && (item.mediaType || item.media_type) || "").toLowerCase();
      if (animationTarget && candidateMarkers.liveAction) conflicts.push("LIVE_ACTION_CONFLICT");
      if (mediaType === "tv" && candidateMarkers.movie && !targetMarkers.movie) conflicts.push("MOVIE_FORM_CONFLICT");
      if (candidateMarkers.special && !targetMarkers.special) conflicts.push("SPECIAL_FORM_CONFLICT");
      if (conflicts.length) {
        return {
          verdict: "REJECT",
          reason: conflicts[0],
          matchedAlias: "",
          normalizedCandidate,
          conflicts
        };
      }
      if (!normalizedCandidate || !aliases.length) {
        return {
          verdict: "REJECT",
          reason: "NO_TITLE_EVIDENCE",
          matchedAlias: "",
          normalizedCandidate,
          conflicts
        };
      }
      const exact = aliases.find((alias) => alias.normalized === normalizedCandidate);
      const titleYears = candidateTitleText.match(/(?:19|20)\d{2}/g) || [];
      const trustedMetadataYears = meta.yearTrusted === true
        ? String(meta.year || "").match(/(?:19|20)\d{2}/g) || []
        : [];
      const candidateIdentityYears = Array.from(new Set(titleYears.concat(trustedMetadataYears)));
      const targetDate = mediaType === "movie"
        ? item && (item.releaseDate || item.release_date)
        : item && (item.firstAirDate || item.first_air_date);
      const targetYearMatch = String(targetDate || "").match(/(?:19|20)\d{2}/);
      const movieYearConflict = mediaType === "movie"
        && targetYearMatch
        && candidateIdentityYears.length
        && candidateIdentityYears.every((year) => year !== targetYearMatch[0]);
      if (exact) {
        return {
          verdict: movieYearConflict ? "TENTATIVE" : "STRONG",
          reason: movieYearConflict ? "MOVIE_YEAR_VARIANT" : "EXACT_ALIAS",
          matchedAlias: exact.raw,
          normalizedCandidate,
          conflicts: movieYearConflict ? ["YEAR_MISMATCH"] : conflicts
        };
      }
      const contained = aliases
        .filter((alias) => normalizedCandidate.includes(alias.normalized))
        .sort((a, b) => b.normalized.length - a.normalized.length);
      if (contained.length > 1) {
        let remainder = normalizedCandidate;
        contained.forEach((alias) => { remainder = remainder.replace(alias.normalized, ""); });
        if (!remainder) {
          return {
            verdict: movieYearConflict ? "TENTATIVE" : "STRONG",
            reason: movieYearConflict ? "MOVIE_YEAR_VARIANT" : "ALIAS_COMBINATION",
            matchedAlias: contained.map((alias) => alias.raw).join(" + "),
            normalizedCandidate,
            conflicts: movieYearConflict ? ["YEAR_MISMATCH"] : conflicts
          };
        }
      }
      if (contained.length) {
        return {
          verdict: "TENTATIVE",
          reason: "KNOWN_ALIAS_WITH_UNRECOGNIZED_SUFFIX",
          matchedAlias: contained[0].raw,
          normalizedCandidate,
          conflicts
        };
      }
      return {
        verdict: "REJECT",
        reason: "NO_ALIAS_MATCH",
        matchedAlias: "",
        normalizedCandidate,
        conflicts
      };
    }

    function curatedHtmlSourceIsStrict(source) {
      return ["muou", "duoduo", "huban", "shandian"].includes(String(source && source.id || ""));
    }

    function curatedDetailEntryHref(value, base) {
      const href = curatedAbsoluteUrl(value, base);
      if (!href) return "";
      try {
        const parsed = new URL(href);
        const pathname = parsed.pathname.replace(/\/+$/, "");
        return /^\/(?:index\.php\/)?vod\/detail\/id\/[^/]+\.html$/i.test(pathname) ? href : "";
      } catch (e) {
        return "";
      }
    }

    function curatedSearchEntries(html, source, base) {
      const entries = [];
      const strictSource = curatedHtmlSourceIsStrict(source);
      let documentRoot = null;
      try { documentRoot = new DOMParser().parseFromString(String(html || ""), "text/html"); } catch (e) { documentRoot = null; }
      if (documentRoot) {
        let nodes = Array.from(documentRoot.querySelectorAll(strictSource ? ".module-search-item" : (source.searchListSelector || ".module-search-item")));
        if (!strictSource && !nodes.length) nodes = Array.from(documentRoot.querySelectorAll(".module-search-item"));
        nodes.forEach((node) => {
          const shandian = String(source && source.id || "") === "shandian";
          const titleAnchor = strictSource
            ? node.querySelector(".video-info-header h3 a[href]")
            : node.matches && node.matches("a[href]") ? node : node.querySelector("a[href]") || node.closest && node.closest("a[href]");
          const hrefAnchor = strictSource && shandian
            ? node.querySelector(".module-item-pic a[href]")
            : titleAnchor;
          if (!titleAnchor || !hrefAnchor) return;
          const href = strictSource
            ? curatedDetailEntryHref(hrefAnchor.getAttribute("href"), base)
            : curatedAbsoluteUrl(hrefAnchor.getAttribute("href"), base);
          if (strictSource && !href) return;
          const titleNode = node.querySelector(".module-item-title,.module-search-item-title,.video-title,.title,h1,h2,h3");
          const title = String(titleAnchor.getAttribute("title") || titleNode && titleNode.textContent || titleAnchor.textContent || node.textContent || "").replace(/\s+/g, " ").trim();
          const metaNode = node.querySelector(".module-item-note,.module-item-desc,.module-item-content,.remark,.year,.meta,.note");
          const remark = String(titleAnchor.getAttribute("data-remark") || metaNode && metaNode.textContent || "").replace(/\s+/g, " ").trim();
          const yearInfo = curatedEntryYear(node, titleAnchor, remark);
          const idMatch = strictSource
            ? href.match(/\/vod\/detail\/id\/([^/.]+)\.html/i)
            : String(source && source.id || "") === "wanou" && href.match(/\/voddetail\/([^/.]+)\.html/i);
          if (href && title) entries.push({
            href,
            title,
            remark,
            year: yearInfo.year,
            yearTrusted: yearInfo.yearTrusted,
            yearSource: yearInfo.yearSource,
            sourceEntryId: idMatch ? idMatch[1] : ""
          });
        });
        if (!strictSource && !entries.length) {
          Array.from(documentRoot.querySelectorAll("a[href]")).forEach((anchor) => {
            const title = String(anchor.getAttribute("title") || anchor.textContent || "").replace(/\s+/g, " ").trim();
            const href = curatedAbsoluteUrl(anchor.getAttribute("href"), base);
            const entryNode = anchor.parentElement || anchor;
            const remark = String(anchor.getAttribute("data-remark") || entryNode && entryNode.textContent || "").replace(/\s+/g, " ").trim();
            const yearInfo = curatedEntryYear(entryNode, anchor, remark);
            const idMatch = String(source && source.id || "") === "wanou" && href && href.match(/\/voddetail\/([^/.]+)\.html/i);
            if (href && title.length >= 2 && title.length <= 120) entries.push({ href, title, remark, year: yearInfo.year, yearTrusted: yearInfo.yearTrusted, yearSource: yearInfo.yearSource, sourceEntryId: idMatch ? idMatch[1] : "" });
          });
        }
      }
      if (!strictSource && !entries.length) {
        const anchorRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/ig;
        let match;
        while ((match = anchorRe.exec(String(html || "")))) {
          const title = String(match[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
          const href = curatedAbsoluteUrl(match[1], base);
          if (href && title.length >= 2 && title.length <= 120) entries.push({
            href,
            title,
            remark: "",
            year: curatedYear(title) || "",
            yearTrusted: false,
            yearSource: curatedYear(title) ? "TITLE" : "",
            sourceEntryId: String(source && source.id || "") === "wanou" && href.match(/\/voddetail\/([^/.]+)\.html/i)
              ? href.match(/\/voddetail\/([^/.]+)\.html/i)[1] : ""
          });
        }
      }
      const seen = new Set();
      return entries.filter((entry) => {
        const key = entry.href + "\u001f" + curatedCleanTitle(entry.title);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function curatedDiskTypeForUrl(url) {
      const value = String(url || "").toLowerCase();
      if (/pan\.quark\.cn|quark/.test(value)) return "quark";
      if (/pan\.baidu\.com|baidu/.test(value)) return "baidu";
      if (/drive\.uc\.cn|uc\.cn|uc123/.test(value)) return "uc";
      if (/aliyundrive|alipan|aliyunpan/.test(value)) return "aliyun";
      if (/pan\.xunlei|xunlei/.test(value)) return "xunlei";
      if (/115\.com|115cdn|anxia/.test(value)) return "115";
      if (/123(?:\d{2,4})?\.(?:com|cn|net)|123pan/.test(value)) return "123";
      if (/cloud\.189|189\.cn/.test(value)) return "tianyi";
      if (/caiyun\.139|139\.cn/.test(value)) return "mobile";
      if (/pikpak/.test(value)) return "pikpak";
      if (/guangya|gy[a-z0-9.-]*\./.test(value)) return "guangya";
      if (/^magnet:/i.test(value)) return "magnet";
      if (/^ed2k:/i.test(value)) return "ed2k";
      return "";
    }

    function curatedVerifiedDiskTypeForUrl(url) {
      const value = String(url || "").trim();
      if (!value) return "";
      if (/^magnet:\?[^#\s]*xt=urn:btih:[a-z0-9]{16,}/i.test(value)) return "magnet";
      if (/^ed2k:\/\/\|file\|[^|]+\|\d+\|[a-f0-9]{16,}\|/i.test(value)) return "ed2k";
      let parsed;
      try { parsed = new URL(value); } catch (e) { return ""; }
      if (!/^https?:$/i.test(parsed.protocol)) return "";
      const host = String(parsed.hostname || "").toLowerCase();
      const path = String(parsed.pathname || "").replace(/\/+$/, "");
      const sharePath = /^\/s\/[^/]+$/i.test(path);
      if (host === "pan.quark.cn" && sharePath) return "quark";
      if (host === "drive.uc.cn" && sharePath) return "uc";
      if (host === "pan.baidu.com" && sharePath) return "baidu";
      if (["aliyundrive.com", "www.aliyundrive.com", "alipan.com", "www.alipan.com"].includes(host) && sharePath) return "aliyun";
      if (host === "pan.xunlei.com" && sharePath) return "xunlei";
      if (host === "cloud.189.cn" && /^\/t\/[^/]+$/i.test(path)) return "tianyi";
      if (["115.com", "www.115.com"].includes(host) && sharePath) return "115";
      if (host === "caiyun.feixin.10086.cn" && /^\/[a-z0-9][a-z0-9_-]{3,}$/i.test(path)) return "mobile";
      if (["123pan.com", "www.123pan.com"].includes(host) && sharePath) return "123";
      if (["mypikpak.com", "www.mypikpak.com"].includes(host) && sharePath) return "pikpak";
      return "";
    }

    function curatedUrlHost(url) {
      try { return new URL(String(url || "")).hostname; } catch (e) { return ""; }
    }

    function curatedExtractUrls(value) {
      const text = String(value || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
      const matches = text.match(/(?:https?:\/\/|magnet:|ed2k:\/\/)[^\s"'<>，。、）)]+/ig) || [];
      return matches.map((url) => String(url).replace(/[，。、；;）)\]}]+$/, "")).filter(Boolean);
    }

    function curatedPasswordFromText(value) {
      const match = String(value || "").match(/(?:提取码|访问码|密码|pwd|password|passcode|code)\s*[:：=]?\s*([a-z0-9]{2,16})/i);
      return match ? match[1] : "";
    }

    function curatedResourceTitleFromContext(value, fallback) {
      const text = String(value || "")
        .replace(/(?:https?:\/\/|magnet:|ed2k:\/\/)[^\s"'<>，。、）)]+/ig, " ")
        .replace(/(?:提取码|访问码|密码|pwd|password|passcode|code)\s*[:：=]?\s*[a-z0-9]{2,16}/ig, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text || text.length < 2 || text.length > 180) return String(fallback || "").trim();
      return text;
    }

    function curatedDetailCandidates(html, source, base, item, entry) {
      const candidates = [];
      const byKey = new Map();
      const add = (value, contextText) => {
        const url = curatedAbsoluteUrl(value, base) || String(value || "").trim();
        if (!url) return;
        const diskType = curatedVerifiedDiskTypeForUrl(url);
        if (!diskType || !PAN_DISK_TYPES.some((disk) => disk.id === diskType)) return;
        const normalized = normalizePanUrl(url);
        const key = `${diskType}|${normalized}`;
        const fallbackTitle = String(entry && entry.title || item && item.title || "盘搜资源").trim();
        const resourceTitle = curatedResourceTitleFromContext(contextText, fallbackTitle);
        const password = curatedPasswordFromText(contextText);
        const existing = byKey.get(key);
        if (existing) {
          // 同一 URL 可能先从 href 出现、后从详情文本出现；只补充后者带来的上下文。
          if (!existing.password && password) existing.password = password;
          if (resourceTitle && (!existing.resourceTitle || existing.resourceTitle === fallbackTitle || resourceTitle.length > existing.resourceTitle.length)) {
            existing.resourceTitle = resourceTitle;
            existing.title = resourceTitle;
            existing.fileName = resourceTitle;
          }
          return;
        }
        const title = resourceTitle || fallbackTitle;
        candidates.push({
          key,
          diskType,
          url,
          normalizedUrl: url,
          password,
          title,
          mediaTitle: String(item && item.title || "").trim(),
          resourceTitle: title,
          source: source.id,
          provider: source.id,
          curatedSourceId: source.id,
          sourceEntryTitle: String(entry && entry.title || "").trim(),
          sourceEntryId: String(entry && (entry.sourceEntryId || entry.id || entry.vod_id) || "").trim(),
          sourceEntryUrl: String(entry && entry.href || "").trim(),
          extractionMethod: String(source && source.id || "") === "wanou"
            ? "WOGG_HTML_DETAIL"
            : curatedHtmlSourceIsStrict(source) ? "DOWNLOAD_LIST" : "HTML_DETAIL",
          fileName: title,
          index: candidates.length
        });
        byKey.set(key, candidates[candidates.length - 1]);
      };
      let documentRoot = null;
      try { documentRoot = new DOMParser().parseFromString(String(html || ""), "text/html"); } catch (e) { documentRoot = null; }
      if (curatedHtmlSourceIsStrict(source)) {
        if (!documentRoot) return candidates;
        Array.from(documentRoot.querySelectorAll("#download-list .module-row-one")).forEach((row) => {
          const holder = row.getAttribute && row.getAttribute("data-clipboard-text")
            ? row
            : row.querySelector && row.querySelector("[data-clipboard-text]");
          const raw = holder && holder.getAttribute && holder.getAttribute("data-clipboard-text") || "";
          curatedExtractUrls(raw).forEach((url) => add(url, row.textContent || raw));
          Array.from(row.querySelectorAll ? row.querySelectorAll("a[href]") : []).forEach((anchor) => {
            add(anchor.getAttribute("href"), row.textContent || anchor.textContent || "");
          });
        });
        return candidates;
      }
      if (documentRoot) {
        Array.from(documentRoot.querySelectorAll(source.detailPanSelector || ".module-row-info p")).forEach((node) => {
          const text = node.textContent || "";
          const urls = curatedExtractUrls(text);
          if (urls.length === 1) add(urls[0], text);
          else urls.forEach((url) => add(url, ""));
        });
        Array.from(documentRoot.querySelectorAll("a[href]" )).forEach((anchor) => {
          const scope = anchor.closest && anchor.closest(".module-row-info p,.module-item-content,.module-row-info");
          const scopeText = scope && scope.textContent || "";
          const scopeUrls = curatedExtractUrls(scopeText);
          const scopeAnchors = scope && scope.querySelectorAll ? scope.querySelectorAll("a[href]").length : 0;
          const text = (scopeUrls.length === 1 || scopeAnchors === 1)
            ? scopeText
            : `${anchor.textContent || ""} ${anchor.getAttribute("title") || ""}`;
          add(anchor.getAttribute("href"), text);
        });
      }
      // 非 strict source 的旧兼容路径只负责补漏 URL，不把页面第一个提取码无条件绑定给所有链接。
      curatedExtractUrls(html).forEach((url) => add(url, ""));
      return candidates;
    }

    function curatedSourceTemplates(source) {
      const config = state.pan.config || defaultPanConfig();
      const cached = config.sourceTemplates && config.sourceTemplates[source.id];
      const explicit = source.searchUrl ? [source.searchUrl] : [];
      const defaults = explicit.length ? explicit : CURATED_SEARCH_URL_TEMPLATES;
      return Array.from(new Set([].concat(explicit, cached || [], defaults).filter(Boolean)));
    }

    function rememberCuratedTemplate(sourceId, template) {
      if (!state.pan.config) state.pan.config = defaultPanConfig();
      if (!state.pan.config.sourceTemplates) state.pan.config.sourceTemplates = {};
      if (state.pan.config.sourceTemplates[sourceId] === template) return;
      state.pan.config.sourceTemplates[sourceId] = template;
      persistPanConfigQuietly().catch(() => {});
    }

    function curatedSearchPath(template, keyword, page) {
      const encoded = encodeURIComponent(String(keyword || "").trim());
      return String(template || "")
        .replace(/\{kw\}|\{keyword\}/g, encoded)
        .replace(/\{p\}|\{page\}/g, String(page || 1));
    }

    function curatedSourceResult(kind, detail) {
      return Object.assign({
        kind: String(kind || "TRANSPORT_FAILURE"),
        terminalReason: String(kind || "TRANSPORT_FAILURE"),
        entryCount: 0,
        matchedEntryCount: 0,
        sampleEntryTitles: [],
        searchKeywordsTried: [],
        identityStrongCount: 0,
        identityTentativeCount: 0,
        identityRejectCount: 0,
        identityReason: "",
        identityReasons: []
      }, detail || {});
    }

    function curatedSearchKeywords(item) {
      const values = mergeTitleAliases(
        item && item.resourceSearchTitle,
        item && item.title,
        item && item.originalTitle,
        item && item.original_title,
        item && item.originalName,
        item && item.original_name,
        item && item.aliases
      );
      const seen = new Set();
      return values.filter((value) => {
        const text = String(value || "").trim();
        const key = normalizeTitle(text) || text.toLowerCase();
        if (!text || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    function curatedPunctuationFallback(value) {
      return String(value || "")
        .replace(/[!！?？,，。．.:：;；、\/\\|｜《》〈〉“”\"‘’'「」『』（）()【】\[\]{}<>—–_~`]+/g, " ")
        .replace(/[-+]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function curatedSearchKeywordVariants(item) {
      const values = mergeTitleAliases(
        item && item.resourceSearchTitle,
        item && item.title,
        item && item.originalTitle,
        item && item.original_title,
        item && item.originalName,
        item && item.original_name,
        item && item.aliases
      );
      const result = [];
      const seen = new Set();
      const add = (value) => {
        const text = String(value || "").trim().replace(/\s+/g, " ");
        if (!text || seen.has(text)) return;
        seen.add(text);
        result.push(text);
      };
      values.forEach((value) => {
        const raw = String(value || "").trim();
        add(raw);
        add(curatedPunctuationFallback(raw));
      });
      return result;
    }

    function wanouDiskTypeForCode(value) {
      const key = String(value || "").trim().toUpperCase().replace(/[\s_-]+/g, "");
      return ({
        BD: "baidu",
        KG: "quark",
        UC: "uc",
        ALY: "aliyun",
        XL: "xunlei",
        TY: "tianyi",
        "115": "115",
        MB: "mobile",
        "123": "123",
        PIKPAK: "pikpak"
      })[key] || "";
    }

    function curatedWanouCandidates(vodItem, source, item, sourceUrl) {
      const candidates = [];
      const types = String(vodItem && vodItem.vod_down_from || "").split("$$$");
      const urls = String(vodItem && vodItem.vod_down_url || "").split("$$$");
      const title = String(vodItem && vodItem.vod_name || item && item.title || "盘搜资源").trim();
      const sourceEntryId = String(vodItem && vodItem.vod_id || "").trim();
      const remarks = String(vodItem && vodItem.vod_remarks || "").trim();
      urls.forEach((rawUrl, index) => {
        const url = String(rawUrl || "").trim();
        const typeHint = wanouDiskTypeForCode(types[index]);
        if (!url) return;
        const diskType = curatedVerifiedDiskTypeForUrl(url);
        if (!diskType || typeHint && diskType !== typeHint) return;
        const normalized = normalizePanUrl(url);
        candidates.push({
          key: `${diskType}|${normalized}`,
          diskType,
          url,
          normalizedUrl: url,
          password: curatedPasswordFromText(`${url} ${remarks}`),
          title,
          mediaTitle: String(item && item.title || "").trim(),
          resourceTitle: title,
          source: source.id,
          provider: source.id,
          curatedSourceId: source.id,
          sourceEntryTitle: title,
          sourceEntryId,
          sourceEntryUrl: String(sourceUrl || "").trim(),
          extractionMethod: "WANOU_JSON_VOD_DOWN",
          fileName: title,
          index: index
        });
      });
      return candidates;
    }

    async function searchWanouHtmlKeyword(source, item, run, context, keyword, variant) {
      const beforeRequest = curatedRequestStartState(context, run);
      if (beforeRequest) return curatedSourceResult(beforeRequest);
      const remainingSearchMs = curatedRemainingMs(context);
      const template = curatedSearchPath(source.searchUrl, keyword, 1);
      const url = curatedAbsoluteUrl(template, source.domains && source.domains[0]);
      if (!url) return curatedSourceResult("TRANSPORT_FAILURE", { terminalReason: "INVALID_REQUEST_URL" });
      recordWanouDiag("WANOU_SEARCH_ATTEMPT", {
        backend: "wogg-html",
        keyword: String(keyword || ""),
        variant: String(variant || "raw"),
        httpState: "REQUEST_START",
        resultState: "REQUEST_START",
        entryCount: 0
      });
      let response;
      try {
        response = await curatedRequestWithDeadline(
          () => requestCuratedHtml(url, curatedNativeTimeoutSec(remainingSearchMs), {
            referer: source.domains && source.domains[0] || url
          }),
          context,
          "SOURCE_TIMEOUT"
        );
      } catch (e) {
        recordWanouDiag("WANOU_SEARCH_ATTEMPT", {
          backend: "wogg-html",
          keyword: String(keyword || ""),
          variant: String(variant || "raw"),
          httpState: e && e.curatedDeadline ? "TIMEOUT" : "TRANSPORT_FAILURE",
          resultState: e && e.curatedDeadline ? "SOURCE_TIMEOUT" : "TRANSPORT_FAILURE",
          entryCount: 0
        });
        if (e && e.curatedDeadline) return curatedSourceResult("SOURCE_TIMEOUT", { searchKeywordsTried: [keyword] });
        const afterFailure = curatedAttemptState(context, run);
        return curatedSourceResult(afterFailure || "TRANSPORT_FAILURE", { searchKeywordsTried: [keyword] });
      }
      const afterSearch = curatedAttemptState(context, run);
      if (afterSearch) return curatedSourceResult(afterSearch, { searchKeywordsTried: [keyword] });
      const entries = curatedSearchEntries(response && response.html, source, response && response.base || url);
      const entryCount = entries.length;
      const woggStructureRecognized = /(?:module-search-item|module-items|search-stat|mac_total)/i.test(String(response && response.html || ""));
      recordWanouDiag("WANOU_SEARCH_ATTEMPT", {
        backend: "wogg-html",
        keyword: String(keyword || ""),
        variant: String(variant || "raw"),
        httpState: "HTTP_OK",
        resultState: entryCount ? "ENTRIES" : woggStructureRecognized ? "NO_ENTRIES" : "PARSE_FAILURE",
        entryCount,
        status: Number(response && response.status || 0)
      });
      const sampleEntryTitles = entries.slice(0, 3)
        .map((entry) => String(entry && entry.title || "").trim().slice(0, 80))
        .filter(Boolean);
      const baseDiagnostics = {
        entryCount,
        matchedEntryCount: 0,
        sampleEntryTitles,
        searchKeywordsTried: [keyword]
      };
      if (!entryCount) {
        return curatedSourceResult(woggStructureRecognized ? "NO_MATCH" : "PARSE_FAILURE", Object.assign({}, baseDiagnostics, {
          terminalReason: woggStructureRecognized ? "NO_ENTRIES" : "UNRECOGNIZED_HTML"
        }));
      }
      const identityResults = entries.map((entry) => {
        return {
          entry,
          searchUrl: url,
          verdict: mediaIdentityVerdict(item, entry.title, entry)
        };
      });
      const identityStrongCount = identityResults.filter((result) => result.verdict.verdict === "STRONG").length;
      const identityTentativeCount = identityResults.filter((result) => result.verdict.verdict === "TENTATIVE").length;
      const identityRejectCount = identityResults.filter((result) => result.verdict.verdict === "REJECT").length;
      const identityReasons = Array.from(new Set(identityResults
        .map((result) => String(result.verdict.reason || "").trim())
        .filter(Boolean))).slice(0, 12);
      const diagnostics = {
        entryCount,
        matchedEntryCount: identityStrongCount + identityTentativeCount,
        sampleEntryTitles,
        searchKeywordsTried: [keyword],
        identityStrongCount,
        identityTentativeCount,
        identityRejectCount,
        identityReason: identityReasons[0] || "",
        identityReasons
      };
      const strongMatches = identityResults
        .filter((result) => result.verdict.verdict === "STRONG")
        .slice(0, 5);
      const tentativeMatches = identityResults
        .filter((result) => result.verdict.verdict === "TENTATIVE")
        .slice(0, 5);
      if (!strongMatches.length && !tentativeMatches.length) {
        return curatedSourceResult("NO_MATCH", Object.assign({ terminalReason: "TITLE_NO_MATCH" }, diagnostics));
      }
      if (!strongMatches.length) {
        return curatedSourceResult("TENTATIVE_MATCHES", Object.assign({
          terminalReason: "TENTATIVE_IDENTITY",
          tentativeEntries: tentativeMatches
        }, diagnostics));
      }
      const candidates = [];
      const detailResult = await curatedDetailCandidatesForMatches(
        source,
        item,
        run,
        context,
        strongMatches,
        diagnostics
      );
      if (detailResult.result) return detailResult.result;
      candidates.push(...detailResult.candidates);
      if (candidates.length) {
        return curatedSourceResult("CANDIDATES", Object.assign({
          candidates,
          candidateVerdict: "STRONG"
        }, diagnostics));
      }
      return curatedSourceResult("NO_RESOURCE", Object.assign({
        terminalReason: "NO_CANDIDATE",
        tentativeEntries: tentativeMatches
      }, diagnostics));
    }

    async function searchWanouNxogKeyword(source, item, run, context, keyword, variant) {
      const beforeRequest = curatedRequestStartState(context, run);
      if (beforeRequest) return curatedSourceResult(beforeRequest);
      const remainingSearchMs = curatedRemainingMs(context);
      const template = curatedSearchPath(source.searchApi, keyword, 1);
      const url = curatedAbsoluteUrl(template, source.domains && source.domains[0]);
      if (!url) return curatedSourceResult("TRANSPORT_FAILURE", { terminalReason: "INVALID_REQUEST_URL" });
      recordWanouDiag("WANOU_SEARCH_ATTEMPT", {
        backend: "nxog-json",
        keyword: String(keyword || ""),
        variant: String(variant || "raw"),
        httpState: "REQUEST_START",
        resultState: "REQUEST_START",
        entryCount: 0
      });
      let response;
      try {
        response = await curatedRequestWithDeadline(
          () => requestCuratedJson(url, curatedNativeTimeoutSec(remainingSearchMs), {
            referer: source.domains && source.domains[0] || url
          }),
          context,
          "SOURCE_TIMEOUT"
        );
      } catch (e) {
        recordWanouDiag("WANOU_SEARCH_ATTEMPT", {
          backend: "nxog-json",
          keyword: String(keyword || ""),
          variant: String(variant || "raw"),
          httpState: e && e.curatedDeadline ? "TIMEOUT" : "TRANSPORT_FAILURE",
          resultState: e && e.curatedDeadline ? "SOURCE_TIMEOUT" : "TRANSPORT_FAILURE",
          entryCount: 0
        });
        if (e && e.curatedDeadline) return curatedSourceResult("SOURCE_TIMEOUT", { searchKeywordsTried: [keyword] });
        const afterFailure = curatedAttemptState(context, run);
        return curatedSourceResult(afterFailure || "TRANSPORT_FAILURE", { searchKeywordsTried: [keyword] });
      }
      const afterSearch = curatedAttemptState(context, run);
      if (afterSearch) return curatedSourceResult(afterSearch, { searchKeywordsTried: [keyword] });
      const list = response && response.body && Array.isArray(response.body.list) ? response.body.list : null;
      if (!list) {
        recordWanouDiag("WANOU_SEARCH_ATTEMPT", {
          backend: "nxog-json",
          keyword: String(keyword || ""),
          variant: String(variant || "raw"),
          httpState: "HTTP_OK",
          resultState: "PARSE_FAILURE",
          entryCount: 0,
          status: Number(response && response.status || 0)
        });
        return curatedSourceResult("PARSE_FAILURE", { terminalReason: "INVALID_RESPONSE", searchKeywordsTried: [keyword] });
      }
      recordWanouDiag("WANOU_SEARCH_ATTEMPT", {
        backend: "nxog-json",
        keyword: String(keyword || ""),
        variant: String(variant || "raw"),
        httpState: "HTTP_OK",
        resultState: list.length ? "ENTRIES" : "NO_ENTRIES",
        entryCount: list.length,
        status: Number(response && response.status || 0)
      });
      const sampleEntryTitles = list.slice(0, 3)
        .map((entry) => String(entry && entry.vod_name || "").trim().slice(0, 80))
        .filter(Boolean);
      if (!list.length) {
        return curatedSourceResult("NO_MATCH", {
          terminalReason: "NO_ENTRIES",
          entryCount: 0,
          matchedEntryCount: 0,
          sampleEntryTitles,
          searchKeywordsTried: [keyword]
        });
      }
      const identityResults = list.map((vodItem) => {
        const entry = Object.assign({}, vodItem, {
          title: String(vodItem && vodItem.vod_name || "").trim(),
          href: url,
          sourceEntryId: String(vodItem && vodItem.vod_id || "").trim(),
          sourceEntryUrl: url,
          remark: String(vodItem && vodItem.vod_remarks || "").trim(),
          year: String(vodItem && vodItem.vod_year || "").trim(),
          yearTrusted: !!String(vodItem && vodItem.vod_year || "").trim(),
          yearSource: "WANOU_VOD_YEAR",
          wanouBackend: "nxog-json",
          wanouVodItem: vodItem
        });
        return {
          backend: "nxog-json",
          entry,
          searchUrl: url,
          verdict: mediaIdentityVerdict(item, entry.title, entry)
        };
      });
      const identityStrongCount = identityResults.filter((result) => result.verdict.verdict === "STRONG").length;
      const identityTentativeCount = identityResults.filter((result) => result.verdict.verdict === "TENTATIVE").length;
      const identityRejectCount = identityResults.filter((result) => result.verdict.verdict === "REJECT").length;
      const identityReasons = Array.from(new Set(identityResults
        .map((result) => String(result.verdict.reason || "").trim())
        .filter(Boolean))).slice(0, 12);
      const diagnostics = {
        entryCount: list.length,
        matchedEntryCount: identityStrongCount + identityTentativeCount,
        sampleEntryTitles,
        searchKeywordsTried: [keyword],
        identityStrongCount,
        identityTentativeCount,
        identityRejectCount,
        identityReason: identityReasons[0] || "",
        identityReasons
      };
      const strongMatches = identityResults
        .filter((result) => result.verdict.verdict === "STRONG")
        .slice(0, 5);
      const tentativeMatches = identityResults
        .filter((result) => result.verdict.verdict === "TENTATIVE")
        .slice(0, 5);
      if (!strongMatches.length && !tentativeMatches.length) {
        return curatedSourceResult("NO_MATCH", Object.assign({ terminalReason: "TITLE_NO_MATCH" }, diagnostics));
      }
      if (!strongMatches.length) {
        return curatedSourceResult("TENTATIVE_MATCHES", Object.assign({
          terminalReason: "TENTATIVE_IDENTITY",
          tentativeEntries: tentativeMatches
        }, diagnostics));
      }
      const detailResult = await curatedDetailCandidatesForMatches(
        source,
        item,
        run,
        context,
        strongMatches,
        diagnostics
      );
      if (detailResult.result) return detailResult.result;
      if (detailResult.candidates.length) {
        return curatedSourceResult("CANDIDATES", Object.assign({
          candidates: detailResult.candidates,
          candidateVerdict: "STRONG"
        }, diagnostics));
      }
      return curatedSourceResult("NO_RESOURCE", Object.assign({
        terminalReason: "NO_CANDIDATE",
        tentativeEntries: tentativeMatches
      }, diagnostics));
    }

    async function searchWanouSource(source, item, run, context) {
      const keywords = curatedSearchKeywordVariants(item);
      const rawKeywordSet = new Set(mergeTitleAliases(
        item && item.resourceSearchTitle,
        item && item.title,
        item && item.originalTitle,
        item && item.original_title,
        item && item.originalName,
        item && item.original_name,
        item && item.aliases
      ).map((value) => String(value || "").trim().replace(/\s+/g, " ")).filter(Boolean));
      const aggregate = {
        entryCount: 0,
        matchedEntryCount: 0,
        sampleEntryTitles: [],
        searchKeywordsTried: [],
        identityStrongCount: 0,
        identityTentativeCount: 0,
        identityRejectCount: 0,
        identityReason: "",
        identityReasons: []
      };
      const tentativeEntries = [];
      const tentativeKeys = new Set();
      let lastResult = null;
      const absorb = (result) => {
        const tried = Array.isArray(result && result.searchKeywordsTried) && result.searchKeywordsTried.length
          ? result.searchKeywordsTried : [];
        tried.forEach((value) => {
          const text = String(value || "").trim();
          if (text && !aggregate.searchKeywordsTried.includes(text)) aggregate.searchKeywordsTried.push(text);
        });
        aggregate.entryCount += Number(result && result.entryCount || 0);
        aggregate.matchedEntryCount += Number(result && result.matchedEntryCount || 0);
        (result && result.sampleEntryTitles || []).forEach((title) => {
          const value = String(title || "").trim();
          if (value && !aggregate.sampleEntryTitles.includes(value) && aggregate.sampleEntryTitles.length < 3) {
            aggregate.sampleEntryTitles.push(value);
          }
        });
        aggregate.identityStrongCount += Number(result && result.identityStrongCount || 0);
        aggregate.identityTentativeCount += Number(result && result.identityTentativeCount || 0);
        aggregate.identityRejectCount += Number(result && result.identityRejectCount || 0);
        if (!aggregate.identityReason && result && result.identityReason) aggregate.identityReason = result.identityReason;
        (result && result.identityReasons || []).forEach((reason) => {
          const value = String(reason || "").trim();
          if (value && !aggregate.identityReasons.includes(value)) aggregate.identityReasons.push(value);
        });
        aggregate.identityReasons = aggregate.identityReasons.slice(0, 12);
      };
      const rememberTentative = (entries) => {
        (entries || []).forEach((match) => {
          const entry = match && match.entry;
          const key = `${match && match.backend || "wogg-html"}\u001f${entry && entry.href || ""}\u001f${entry && entry.title || ""}`;
          if (!entry || tentativeKeys.has(key)) return;
          tentativeKeys.add(key);
          tentativeEntries.push(match);
        });
      };
      const variantName = (index, keyword) => rawKeywordSet.has(keyword) ? "raw" : "punctuation-fallback";
      for (let index = 0; index < keywords.length; index++) {
        const keyword = keywords[index];
        const result = await searchWanouHtmlKeyword(source, item, run, context, keyword, variantName(index, keyword));
        absorb(result);
        lastResult = result;
        rememberTentative(result && result.tentativeEntries);
        if (result.kind === "CANDIDATES" && result.candidateVerdict === "STRONG") {
          return curatedSourceResult("CANDIDATES", Object.assign({}, result, aggregate));
        }
        if (!["NO_MATCH", "NO_RESOURCE", "TENTATIVE_MATCHES", "SOURCE_TIMEOUT", "TRANSPORT_FAILURE", "PARSE_FAILURE"].includes(result.kind)) {
          return curatedSourceResult(result.kind, Object.assign({}, result, aggregate));
        }
      }
      if (tentativeEntries.length) {
        const detailResult = await curatedDetailCandidatesForMatches(source, item, run, context, tentativeEntries, aggregate);
        if (detailResult.result && !["SOURCE_TIMEOUT", "TRANSPORT_FAILURE"].includes(detailResult.result.kind)) {
          return curatedSourceResult(detailResult.result.kind, Object.assign({}, detailResult.result, aggregate));
        }
        if (detailResult.candidates && detailResult.candidates.length) {
          return curatedSourceResult("CANDIDATES", Object.assign({}, aggregate, {
            kind: "CANDIDATES",
            terminalReason: "CANDIDATES",
            candidates: detailResult.candidates,
            candidateVerdict: "TENTATIVE"
          }));
        }
      }
      recordWanouDiag("WANOU_FALLBACK_TO_NXOG", {
        reason: aggregate.entryCount ? aggregate.matchedEntryCount ? "NO_PLAYABLE_WOGG_CANDIDATE" : "TITLE_NO_MATCH" : "NO_ENTRIES_OR_TRANSPORT"
      });
      for (let index = 0; index < keywords.length; index++) {
        const keyword = keywords[index];
        const result = await searchWanouNxogKeyword(source, item, run, context, keyword, variantName(index, keyword));
        absorb(result);
        lastResult = result;
        rememberTentative(result && result.tentativeEntries);
        if (result.kind === "CANDIDATES" && result.candidateVerdict === "STRONG") {
          return curatedSourceResult("CANDIDATES", Object.assign({}, result, aggregate));
        }
        if (!["NO_MATCH", "NO_RESOURCE", "TENTATIVE_MATCHES", "SOURCE_TIMEOUT", "TRANSPORT_FAILURE", "PARSE_FAILURE"].includes(result.kind)) {
          return curatedSourceResult(result.kind, Object.assign({}, result, aggregate));
        }
      }
      if (tentativeEntries.length) {
        const detailResult = await curatedDetailCandidatesForMatches(source, item, run, context, tentativeEntries, aggregate);
        if (detailResult.candidates && detailResult.candidates.length) {
          return curatedSourceResult("CANDIDATES", Object.assign({}, aggregate, {
            kind: "CANDIDATES",
            terminalReason: "CANDIDATES",
            candidates: detailResult.candidates,
            candidateVerdict: "TENTATIVE"
          }));
        }
      }
      if (lastResult && lastResult.kind === "NO_MATCH" && aggregate.entryCount === 0) {
        return curatedSourceResult("NO_MATCH", Object.assign({}, lastResult, aggregate, { terminalReason: "NO_ENTRIES" }));
      }
      if (lastResult && lastResult.kind === "NO_MATCH") {
        return curatedSourceResult("NO_MATCH", Object.assign({}, lastResult, aggregate, { terminalReason: "TITLE_NO_MATCH" }));
      }
      if (lastResult && lastResult.kind === "NO_RESOURCE") {
        return curatedSourceResult("NO_RESOURCE", Object.assign({}, lastResult, aggregate));
      }
      return curatedSourceResult(lastResult && lastResult.kind || "TRANSPORT_FAILURE", Object.assign({}, lastResult || {}, aggregate));
    }

    async function curatedDetailCandidatesForMatches(source, item, run, context, matches, diagnostics) {
      const candidates = [];
      for (const match of matches || []) {
        const isWanouNxog = String(source && source.id || "") === "wanou"
          && String(match && (match.backend || match.entry && match.entry.wanouBackend) || "") === "nxog-json";
        if (isWanouNxog) {
          const currentState = curatedAttemptState(context, run);
          if (currentState) return { result: curatedSourceResult(currentState, diagnostics) };
          const extracted = curatedWanouCandidates(
            match && match.entry && match.entry.wanouVodItem || match && match.entry,
            source,
            item,
            match && match.searchUrl
          );
          recordWanouDiag("WANOU_DETAIL_RESULT", {
            backend: "nxog-json",
            entryTitle: String(match && match.entry && match.entry.title || ""),
            entryUrl: String(match && match.entry && match.entry.href || match && match.searchUrl || ""),
            candidateCount: extracted.length,
            diskTypes: Array.from(new Set(extracted.map((candidate) => String(candidate && candidate.diskType || "")).filter(Boolean))),
            extractionMethod: "WANOU_JSON_VOD_DOWN"
          });
          candidates.push(...extracted);
          continue;
        }
        const beforeDetail = curatedRequestStartState(context, run);
        if (beforeDetail) return { result: curatedSourceResult(beforeDetail, diagnostics) };
        const remainingDetailMs = curatedRemainingMs(context);
        try {
          const entry = match.entry;
          const detail = await curatedRequestWithDeadline(
            () => requestCuratedHtml(
              entry.href,
              curatedNativeTimeoutSec(remainingDetailMs),
              { referer: match.searchUrl || entry.href }
            ),
            context,
            "SOURCE_TIMEOUT"
          );
          const afterDetail = curatedAttemptState(context, run);
          if (afterDetail) return { result: curatedSourceResult(afterDetail, diagnostics) };
          const extracted = curatedDetailCandidates(
            detail.html,
            source,
            detail.base || entry.href,
            item,
            entry
          );
          if (String(source && source.id || "") === "wanou") {
            recordWanouDiag("WANOU_DETAIL_RESULT", {
              backend: "wogg-html",
              entryTitle: String(entry && entry.title || ""),
              entryUrl: String(entry && entry.href || ""),
              candidateCount: extracted.length,
              diskTypes: Array.from(new Set(extracted.map((candidate) => String(candidate && candidate.diskType || "")).filter(Boolean))),
              extractionMethod: "WOGG_HTML_DETAIL"
            });
          }
          candidates.push(...extracted);
        } catch (e) {
          if (e && e.curatedDeadline) return { result: curatedSourceResult("SOURCE_TIMEOUT", diagnostics) };
          const afterFailure = curatedAttemptState(context, run);
          if (afterFailure) return { result: curatedSourceResult(afterFailure, diagnostics) };
          // 当前匹配条目的详情请求失败，继续检查本次搜索返回的其它匹配条目。
        }
      }
      return { candidates };
    }

    async function searchCuratedSourceKeyword(source, item, run, context, keyword) {
      if (String(source && source.id || "") === "wanou") {
        return searchWanouHtmlKeyword(source, item, run, context, keyword, "raw");
      }
      const templates = curatedSourceTemplates(source);
      for (const template of templates) {
        for (const domain of source.domains || []) {
          const beforeRequest = curatedRequestStartState(context, run);
          if (beforeRequest) return curatedSourceResult(beforeRequest);
          const remainingSearchMs = curatedRemainingMs(context);
          const url = curatedAbsoluteUrl(curatedSearchPath(template, keyword, 1), domain);
          if (!url) continue;
          let response;
          try {
            response = await curatedRequestWithDeadline(
              () => requestCuratedHtml(url, curatedNativeTimeoutSec(remainingSearchMs), { referer: String(domain).replace(/\/+$/, "") + "/" }),
              context,
              "SOURCE_TIMEOUT"
            );
          } catch (e) {
            if (e && e.curatedDeadline) return curatedSourceResult("SOURCE_TIMEOUT");
            const afterFailure = curatedAttemptState(context, run);
            if (afterFailure) return curatedSourceResult(afterFailure);
            continue;
          }
          const afterSearch = curatedAttemptState(context, run);
          if (afterSearch) return curatedSourceResult(afterSearch);
          const entries = curatedSearchEntries(response.html, source, response.base || url);
          const entryCount = entries.length;
          const sampleEntryTitles = entries.slice(0, 3)
            .map((entry) => String(entry && entry.title || "").trim().slice(0, 80))
            .filter(Boolean);
          if (!entries.length) {
            return curatedSourceResult("NO_MATCH", {
              terminalReason: "NO_ENTRIES",
              entryCount,
              matchedEntryCount: 0,
              sampleEntryTitles
            });
          }
          rememberCuratedTemplate(source.id, template);
          const identityResults = entries.map((entry) => ({
            entry,
            searchUrl: url,
            verdict: mediaIdentityVerdict(item, entry.title, entry)
          }));
          const identityStrongCount = identityResults.filter((result) => result.verdict.verdict === "STRONG").length;
          const identityTentativeCount = identityResults.filter((result) => result.verdict.verdict === "TENTATIVE").length;
          const identityRejectCount = identityResults.filter((result) => result.verdict.verdict === "REJECT").length;
          const identityReasons = Array.from(new Set(identityResults
            .map((result) => String(result.verdict.reason || "").trim())
            .filter(Boolean))).slice(0, 12);
          const diagnostics = {
            entryCount,
            matchedEntryCount: identityStrongCount + identityTentativeCount,
            sampleEntryTitles,
            identityStrongCount,
            identityTentativeCount,
            identityRejectCount,
            identityReason: identityReasons[0] || "",
            identityReasons
          };
          const strongMatches = identityResults
            .filter((result) => result.verdict.verdict === "STRONG")
            .slice(0, 5);
          const tentativeMatches = identityResults
            .filter((result) => result.verdict.verdict === "TENTATIVE")
            .slice(0, 5);
          if (!strongMatches.length && !tentativeMatches.length) {
            return curatedSourceResult("NO_MATCH", Object.assign({
              terminalReason: "TITLE_NO_MATCH"
            }, diagnostics));
          }
          if (!strongMatches.length) {
            return curatedSourceResult("TENTATIVE_MATCHES", Object.assign({
              terminalReason: "TENTATIVE_IDENTITY",
              tentativeEntries: tentativeMatches
            }, diagnostics));
          }
          const detailResult = await curatedDetailCandidatesForMatches(
            source,
            item,
            run,
            context,
            strongMatches,
            diagnostics
          );
          if (detailResult.result) return detailResult.result;
          if (detailResult.candidates.length) {
            return curatedSourceResult("CANDIDATES", Object.assign({
              candidates: detailResult.candidates,
              candidateVerdict: "STRONG"
            }, diagnostics));
          }
          return curatedSourceResult("NO_RESOURCE", Object.assign({
            terminalReason: "NO_CANDIDATE",
            tentativeEntries: tentativeMatches
          }, diagnostics));
        }
      }
      return curatedSourceResult("TRANSPORT_FAILURE");
    }

    async function searchCuratedSource(source, item, run, context) {
      if (String(source && source.id || "") === "wanou") {
        return searchWanouSource(source, item, run, context);
      }
      const keywords = curatedSearchKeywords(item);
      const aggregate = {
        entryCount: 0,
        matchedEntryCount: 0,
        sampleEntryTitles: [],
        searchKeywordsTried: [],
        identityStrongCount: 0,
        identityTentativeCount: 0,
        identityRejectCount: 0,
        identityReason: "",
        identityReasons: []
      };
      let tentativeEntries = [];
      const tentativeEntryKeys = new Set();
      let lastResult = null;
      const absorb = (result, keyword) => {
        aggregate.searchKeywordsTried.push(keyword);
        aggregate.entryCount += Number(result && result.entryCount || 0);
        aggregate.matchedEntryCount += Number(result && result.matchedEntryCount || 0);
        (result && result.sampleEntryTitles || []).forEach((title) => {
          const value = String(title || "").trim();
          if (value && !aggregate.sampleEntryTitles.includes(value) && aggregate.sampleEntryTitles.length < 3) {
            aggregate.sampleEntryTitles.push(value);
          }
        });
        aggregate.identityStrongCount += Number(result && result.identityStrongCount || 0);
        aggregate.identityTentativeCount += Number(result && result.identityTentativeCount || 0);
        aggregate.identityRejectCount += Number(result && result.identityRejectCount || 0);
        if (!aggregate.identityReason && result && result.identityReason) aggregate.identityReason = result.identityReason;
        (result && result.identityReasons || []).forEach((reason) => {
          const value = String(reason || "").trim();
          if (value && !aggregate.identityReasons.includes(value)) aggregate.identityReasons.push(value);
        });
        aggregate.identityReasons = aggregate.identityReasons.slice(0, 12);
      };
      const rememberTentativeEntries = (entries) => {
        (entries || []).forEach((match) => {
          const entry = match && match.entry;
          const key = `${entry && entry.href || ""}\u001f${entry && entry.title || ""}`;
          if (!entry || tentativeEntryKeys.has(key)) return;
          tentativeEntryKeys.add(key);
          tentativeEntries.push(match);
        });
      };
      for (const keyword of keywords) {
        const result = await searchCuratedSourceKeyword(source, item, run, context, keyword);
        absorb(result, keyword);
        lastResult = result;
        if (result.kind === "CANDIDATES") {
          if (result.candidateVerdict === "STRONG") {
            return curatedSourceResult("CANDIDATES", Object.assign({}, result, aggregate));
          }
          rememberTentativeEntries(result.tentativeEntries);
          continue;
        }
        rememberTentativeEntries(result.tentativeEntries);
        if (result.kind === "TENTATIVE_MATCHES") continue;
        if (result.kind === "NO_MATCH" || result.kind === "NO_RESOURCE") continue;
        return curatedSourceResult(result.kind, Object.assign({}, result, aggregate));
      }
      if (tentativeEntries.length) {
        const detailResult = await curatedDetailCandidatesForMatches(
          source,
          item,
          run,
          context,
          tentativeEntries,
          aggregate
        );
        if (detailResult.result) {
          return curatedSourceResult(
            detailResult.result.kind,
            Object.assign({}, detailResult.result, aggregate)
          );
        }
        if (detailResult.candidates.length) {
          return curatedSourceResult("CANDIDATES", Object.assign({}, lastResult || {}, aggregate, {
            kind: "CANDIDATES",
            candidates: detailResult.candidates,
            candidateVerdict: "TENTATIVE",
            terminalReason: "CANDIDATES"
          }));
        }
        return curatedSourceResult("NO_RESOURCE", Object.assign({}, lastResult || {}, aggregate, {
          kind: "NO_RESOURCE",
          terminalReason: "NO_CANDIDATE"
        }));
      }
      if (lastResult && lastResult.kind === "TENTATIVE_MATCHES") {
        return curatedSourceResult("NO_MATCH", Object.assign({}, lastResult, aggregate, {
          kind: "NO_MATCH",
          terminalReason: "TITLE_NO_MATCH"
        }));
      }
      if (lastResult && lastResult.kind === "NO_RESOURCE") {
        return curatedSourceResult("NO_RESOURCE", Object.assign({}, lastResult, aggregate));
      }
      if (lastResult && lastResult.kind === "NO_MATCH") {
        return curatedSourceResult("NO_MATCH", Object.assign({}, lastResult, aggregate));
      }
      return curatedSourceResult(
        lastResult && lastResult.kind || "TRANSPORT_FAILURE",
        Object.assign({}, lastResult || {}, aggregate)
      );
    }

    function curatedCandidateOrder(items) {
      return (items || []).slice().sort((a, b) => {
        const disk = panDiskOrder(a) - panDiskOrder(b);
        if (disk) return disk;
        const quality = panQualityInfo(b).score - panQualityInfo(a).score;
        if (quality) return quality;
        return panPackScore(b) - panPackScore(a);
      });
    }

    function curatedHealthBatchPlan(candidates, maxCount) {
      const ordered = curatedCandidateOrder(candidates).slice(0, Math.max(0, Number(maxCount || CURATED_MAX_AUTO_CHECK_PER_SOURCE)));
      const batches = [];
      for (let offset = 0; offset < ordered.length; offset += CURATED_PREFLIGHT_PER_SOURCE) {
        batches.push({
          batchIndex: batches.length,
          startOffset: offset,
          candidates: ordered.slice(offset, offset + CURATED_PREFLIGHT_PER_SOURCE)
        });
      }
      return { ordered, batches };
    }

    function curatedHealthBatchQualification(batch, item, sourceState, freshHealth) {
      const candidates = Array.isArray(batch) ? batch : [];
      const decision = panPreflightCandidates(candidates, freshHealth || {}, {}, { rejectAllBad: true });
      const decisionCandidates = new Set(decision.candidates || []);
      let selected = null;
      let acceptedCount = 0;
      let rejectedCount = 0;
      let unconfirmedCount = 0;
      candidates.forEach((candidate) => {
        const mediaVerdict = automaticVideoCandidateVerdict(item, candidate);
        if (!mediaVerdict.accepted) {
          recordAutomaticMediaRejected("curated", sourceState.source.id, candidate, mediaVerdict);
          rejectedCount++;
          return;
        }
        const admission = panAutoHealthAdmission(candidate, freshHealth || {});
        candidate.healthAdmission = admission.state;
        if (!selected && admission.accepted && decisionCandidates.has(candidate)) {
          selected = candidate;
          acceptedCount++;
        } else if (["bad", "locked", "unavailable"].includes(admission.state) || !decisionCandidates.has(candidate)) {
          rejectedCount++;
        } else if (admission.accepted) {
          acceptedCount++;
        } else {
          unconfirmedCount++;
        }
      });
      const allFreshBad = candidates.length > 0 && candidates.every((candidate) => {
        const key = panHealthKey(candidate);
        return Object.prototype.hasOwnProperty.call(freshHealth || {}, key)
          && String(freshHealth[key] || "").toLowerCase() === "bad"
          && isPanHealthBad(candidate);
      });
      return {
        decision,
        selected,
        acceptedCount,
        rejectedCount,
        unconfirmedCount,
        allFreshBad
      };
    }

    async function curatedProgressiveHealthCandidate(sourceState, item, run, startedAt, options) {
      const opts = options || {};
      const plan = curatedHealthBatchPlan(sourceState && sourceState.candidates, CURATED_MAX_AUTO_CHECK_PER_SOURCE);
      if (!plan.ordered.length) {
        return { candidate: null, sourceId: sourceState && sourceState.source && sourceState.source.id || "", sourceName: sourceState && sourceState.source && sourceState.source.name || "", stale: false, timedOut: false, checkError: false, freshStateCount: 0, healthAcceptedCount: 0, healthRejectedCount: 0, healthUnconfirmedCount: 0 };
      }
      if (!detailPlaybackIsCurrent(run)) {
        return { candidate: null, sourceId: "", sourceName: "", stale: true, timedOut: false, checkError: false, freshStateCount: 0, healthAcceptedCount: 0, healthRejectedCount: 0, healthUnconfirmedCount: 0 };
      }
      let totalAccepted = 0;
      let totalRejected = 0;
      let totalUnconfirmed = 0;
      let lastPreflightStartedAt = 0;
      let lastPreflightDurationMs = 0;
      let lastTimedOut = false;
      let lastCheckError = false;
      let lastFreshStateCount = 0;
      for (const batchInfo of plan.batches) {
        if (!detailPlaybackIsCurrent(run)) {
          return { candidate: null, sourceId: "", sourceName: "", stale: true, timedOut: lastTimedOut, checkError: lastCheckError, preflightStartedAt: lastPreflightStartedAt, preflightDurationMs: lastPreflightDurationMs, freshStateCount: lastFreshStateCount, healthAcceptedCount: totalAccepted, healthRejectedCount: totalRejected, healthUnconfirmedCount: totalUnconfirmed };
        }
        const batch = batchInfo.candidates;
        const preflightStartedAt = Date.now();
        lastPreflightStartedAt = preflightStartedAt;
        recordCuratedRaceDiag("CURATED_PREFLIGHT_START", {
          elapsedMs: Math.max(0, preflightStartedAt - startedAt),
          preflightStartMs: Math.max(0, preflightStartedAt - startedAt),
          allowedMs: CURATED_PREFLIGHT_BUDGET_MS,
          itemCount: batch.length,
          sourceCount: 1,
          sourceId: sourceState.source.id,
          batchIndex: batchInfo.batchIndex,
          startOffset: batchInfo.startOffset
        });
        let freshHealth = {};
        let timedOut = false;
        let checkError = false;
        const checkable = batch.filter((candidate) => isPanCheckSupported(candidate));
        if (checkable.length && panCheckAvailable()) {
          const context = { raceRun: run, raceOwner: "curated", item };
          const checked = await playbackPanHealthPreflight(batch, context, CURATED_PREFLIGHT_BUDGET_MS, { exposeLateResult: opts.exposeLateResult === true });
          if (!detailPlaybackIsCurrent(run) || !panContextIsCurrent(context)) {
            return { candidate: null, sourceId: "", sourceName: "", stale: true, timedOut: false, checkError: false, preflightStartedAt, preflightDurationMs: Math.max(0, Date.now() - preflightStartedAt), freshStateCount: 0, healthAcceptedCount: totalAccepted, healthRejectedCount: totalRejected, healthUnconfirmedCount: totalUnconfirmed };
          }
          freshHealth = checked && checked.states || {};
          timedOut = !!(checked && checked.timedOut);
          checkError = !!(checked && checked.checkError);
          if (timedOut && checked && checked.latePromise && typeof opts.registerLateHealth === "function") {
            opts.registerLateHealth(sourceState, batchInfo, batch, checked.latePromise, {
              preflightStartedAt,
              preflightDurationMs: Math.max(0, Date.now() - preflightStartedAt)
            });
          }
        }
        const qualified = curatedHealthBatchQualification(batch, item, sourceState, freshHealth);
        const selected = qualified.selected;
        const acceptedCount = qualified.acceptedCount;
        const rejectedCount = qualified.rejectedCount;
        const unconfirmedCount = qualified.unconfirmedCount;
        totalAccepted += acceptedCount;
        totalRejected += rejectedCount;
        totalUnconfirmed += unconfirmedCount;
        const doneAt = Date.now();
        lastPreflightDurationMs = Math.max(0, doneAt - preflightStartedAt);
        lastTimedOut = timedOut;
        lastCheckError = checkError;
        lastFreshStateCount = Object.keys(freshHealth).length;
        recordCuratedRaceDiag("CURATED_PREFLIGHT_DONE", {
          elapsedMs: Math.max(0, doneAt - startedAt),
          preflightDoneMs: Math.max(0, doneAt - startedAt),
          preflightDurationMs: lastPreflightDurationMs,
          allowedMs: CURATED_PREFLIGHT_BUDGET_MS,
          timedOut,
          checkError,
          freshStateCount: lastFreshStateCount,
          sourceId: sourceState.source.id,
          batchIndex: batchInfo.batchIndex
        });
        recordCuratedRaceDiag("CURATED_HEALTH_BATCH", {
          sourceId: sourceState.source.id,
          batchIndex: batchInfo.batchIndex,
          startOffset: batchInfo.startOffset,
          candidateCount: batch.length,
          acceptedCount,
          badCount: rejectedCount,
          unconfirmedCount,
          remainingCandidateCount: Math.max(0, plan.ordered.length - batchInfo.startOffset - batch.length)
        });
        const allFreshBad = qualified.allFreshBad;
        recordPanPreflightResult(batch, freshHealth, panPreflightCheckErrorCount(checkable, freshHealth), selected, allFreshBad);
        if (selected) {
          return {
            candidate: selected,
            sourceId: sourceState.source.id,
            sourceName: sourceState.source.name,
            identityVerdict: String(sourceState.candidateVerdict || ""),
            stale: false,
            timedOut,
            checkError,
            preflightStartedAt,
            preflightDurationMs: lastPreflightDurationMs,
            freshStateCount: lastFreshStateCount,
            healthAcceptedCount: totalAccepted,
            healthRejectedCount: totalRejected,
            healthUnconfirmedCount: totalUnconfirmed
          };
        }
        if (batchInfo.batchIndex === 0 && allFreshBad && plan.ordered.length > batch.length) {
          recordCuratedRaceDiag("CURATED_SOURCE_SECOND_CHANCE", {
            sourceId: sourceState.source.id,
            reason: "FIRST_BATCH_ALL_BAD",
            remainingCandidateCount: plan.ordered.length - batch.length
          });
        }
      }
      return {
        candidate: null,
        sourceId: sourceState.source.id,
        sourceName: sourceState.source.name,
        identityVerdict: String(sourceState.candidateVerdict || ""),
        stale: false,
        timedOut: lastTimedOut,
        checkError: lastCheckError,
        preflightStartedAt: lastPreflightStartedAt,
        preflightDurationMs: lastPreflightDurationMs,
        freshStateCount: lastFreshStateCount,
        healthAcceptedCount: totalAccepted,
        healthRejectedCount: totalRejected,
        healthUnconfirmedCount: totalUnconfirmed
      };
    }

    async function curatedCentralHealthCandidate(sourceStates, item, run, startedAt) {
      const hasStrong = (sourceStates || []).some((state) =>
        state && state.candidates && state.candidates.length && state.candidateVerdict === "STRONG"
      );
      const pools = (sourceStates || [])
        .filter((state) => state && state.kind === "CANDIDATES" && state.candidates && state.candidates.length
          && (hasStrong ? state.candidateVerdict === "STRONG" : state.candidateVerdict === "TENTATIVE"))
        .sort((a, b) => a.index - b.index);
      for (const sourceState of pools) {
        const result = await curatedProgressiveHealthCandidate(sourceState, item, run, startedAt);
        if (result.stale) return result;
        if (result.candidate) return result;
      }
      return {
        candidate: null,
        sourceId: "",
        sourceName: "",
        identityVerdict: "",
        stale: false,
        timedOut: false,
        checkError: false,
        preflightStartedAt: 0,
        preflightDurationMs: 0,
        freshStateCount: 0,
        healthAcceptedCount: 0,
        healthRejectedCount: 0,
        healthUnconfirmedCount: 0
      };
    }

    async function resolveCuratedPlaybackCandidate(item, run) {
      const sources = curatedSourceDefinitions();
      const startedAt = Date.now();
      if (!detailPlaybackIsCurrent(run)) {
        recordCuratedRaceSummary(run, {
          keyword: resourceSearchKeyword(item),
          resourceSearchTitle: String(item && item.resourceSearchTitle || ""),
          sources: sources.map((source) => ({
            id: source.id,
            startMs: null,
            doneMs: null,
            kind: "STALE",
            terminalReason: "STALE",
            entryCount: 0,
            matchedEntryCount: 0,
            sampleEntryTitles: [],
            searchKeywordsTried: [],
            identityStrongCount: 0,
            identityTentativeCount: 0,
            identityRejectCount: 0,
            identityReason: "",
            identityReasons: [],
            candidateVerdict: "",
            candidateCount: 0
          })),
          collectionReason: "STALE",
          totalCuratedMs: Math.max(0, Date.now() - startedAt)
        });
        return null;
      }
      const discoveryDeadline = startedAt + CURATED_DISCOVERY_WINDOW_MS;
      recordCuratedRaceDiag("CURATED_RACE_START", {
        runId: run && (run.id || run.runId || run.itemKey) || "",
        startedAt,
        discoveryWindowMs: CURATED_DISCOVERY_WINDOW_MS,
        qualityGraceMs: CURATED_QUALITY_GRACE_MS,
        sourceCount: sources.length
      });

      const emitSummary = (detail) => {
        const health = detail && detail.healthResult || {};
        const collection = detail && detail.collection || {};
        recordCuratedRaceSummary(run, {
          keyword: resourceSearchKeyword(item),
          resourceSearchTitle: String(item && item.resourceSearchTitle || ""),
          sources: sourceStates.map((sourceState) => ({
            id: sourceState.source.id,
            startMs: Number.isFinite(sourceState.startedAt) ? Math.max(0, sourceState.startedAt - startedAt) : null,
            doneMs: sourceState.doneAt ? Math.max(0, sourceState.doneAt - startedAt) : null,
            kind: sourceState.kind || "",
            terminalReason: sourceState.terminalReason || "",
            entryCount: Number(sourceState.entryCount || 0),
            matchedEntryCount: Number(sourceState.matchedEntryCount || 0),
            sampleEntryTitles: Array.isArray(sourceState.sampleEntryTitles) ? sourceState.sampleEntryTitles.slice(0, 3) : [],
            searchKeywordsTried: Array.isArray(sourceState.searchKeywordsTried) ? sourceState.searchKeywordsTried.slice() : [],
            identityStrongCount: Number(sourceState.identityStrongCount || 0),
            identityTentativeCount: Number(sourceState.identityTentativeCount || 0),
            identityRejectCount: Number(sourceState.identityRejectCount || 0),
            identityReason: String(sourceState.identityReason || ""),
            identityReasons: Array.isArray(sourceState.identityReasons) ? sourceState.identityReasons.slice(0, 12) : [],
            candidateVerdict: String(sourceState.candidateVerdict || ""),
            candidateCount: sourceState.candidates.length
          })),
          firstCandidateMs: firstCandidateAt ? Math.max(0, firstCandidateAt - startedAt) : null,
          firstCandidateSource,
          collectionDoneMs: collection.doneAt ? Math.max(0, collection.doneAt - startedAt) : null,
          collectionReason: String(detail && detail.collectionReason || collection.reason || ""),
          preflightStartMs: health.preflightStartedAt ? Math.max(0, health.preflightStartedAt - startedAt) : null,
          preflightDurationMs: health.preflightDurationMs || 0,
          preflightTimedOut: !!health.timedOut,
          preflightFreshStateCount: Number(health.freshStateCount || 0),
          healthAcceptedCount: Number(health.healthAcceptedCount || 0),
          healthRejectedCount: Number(health.healthRejectedCount || 0),
          healthUnconfirmedCount: Number(health.healthUnconfirmedCount || 0),
          lateHealthPendingCount,
          lateHealthResolvedCount,
          lateHealthAcceptedCount,
          selectedByLateHealth,
          selectedSource: String(health.sourceId || ""),
          selectedDiskType: String(health.candidate && health.candidate.diskType || ""),
          plannedSearchKeywords: curatedSearchKeywordVariants(item),
          selectedEntryTitle: String(health.candidate && health.candidate.sourceEntryTitle || ""),
          selectedExtractionMethod: String(health.candidate && health.candidate.extractionMethod || ""),
          selectedUrlHost: curatedUrlHost(health.candidate && health.candidate.url),
          totalCuratedMs: Math.max(0, Date.now() - startedAt)
        });
      };

      const sourceStates = sources.map((source, index) => ({
        source,
        index,
        startedAt: Date.now(),
        context: {
          chainDeadline: discoveryDeadline,
          sourceDeadline: discoveryDeadline,
          sourceId: source.id,
          active: true
        },
        terminal: false,
        kind: "",
        terminalReason: "",
        entryCount: 0,
        matchedEntryCount: 0,
        sampleEntryTitles: [],
        searchKeywordsTried: [],
        identityStrongCount: 0,
        identityTentativeCount: 0,
        identityRejectCount: 0,
        identityReason: "",
        identityReasons: [],
        candidateVerdict: "",
        candidates: [],
        doneAt: 0,
        qualificationStarted: false,
        qualificationDone: false,
        qualificationPromise: null,
        qualificationResult: null,
        qualifiedCandidate: null,
        lateHealthPendingCount: 0,
        lateHealthResolvedCount: 0,
        lateHealthAcceptedCount: 0,
        lateHealthPromises: []
      }));

      sourceStates.forEach((sourceState) => {
        recordCuratedRaceDiag("CURATED_SOURCE_START", {
          sourceId: sourceState.source.id,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          sourceStartMs: Math.max(0, sourceState.startedAt - startedAt)
        });
      });

      let resolveCollection;
      let collectionDone = false;
      let collectionReason = "";
      let firstCandidateAt = 0;
      let firstCandidateSource = "";
      let discoveryTimer = 0;
      let qualificationActive = false;
      let lateHealthPendingCount = 0;
      let lateHealthResolvedCount = 0;
      let lateHealthAcceptedCount = 0;
      let selectedByLateHealth = false;
      const collectionPromise = new Promise((resolve) => { resolveCollection = resolve; });

      const finishCollection = (reason) => {
        if (collectionDone) return;
        collectionDone = true;
        collectionReason = String(reason || "");
        clearTimeout(discoveryTimer);
        sourceStates.forEach((sourceState) => { sourceState.context.active = false; });
        const doneAt = Date.now();
        const candidateSources = sourceStates
          .filter((sourceState) => sourceState.candidates.length)
          .map((sourceState) => sourceState.source.id);
        recordCuratedRaceDiag("CURATED_COLLECTION_DONE", {
          elapsedMs: Math.max(0, doneAt - startedAt),
          reason,
          availableSourceCount: candidateSources.length,
          availableCandidateSourceIds: candidateSources,
          candidateSources,
          sourceIds: candidateSources
        });
        resolveCollection({
          reason,
          stale: reason === "STALE",
          doneAt,
          sourceStates
        });
      };

      const maybeFinishCollection = () => {
        if (collectionDone) return;
        if (!detailPlaybackIsCurrent(run)) {
          finishCollection("STALE");
          return;
        }
        const pendingLateHealth = sourceStates.some((sourceState) => Number(sourceState.lateHealthPendingCount || 0) > 0);
        const beforeDiscoveryDeadline = Date.now() < discoveryDeadline;
        const strongAvailable = sourceStates.filter((sourceState) =>
          sourceState.terminal && sourceState.candidates.length && sourceState.candidateVerdict === "STRONG"
        );
        const tentativeAvailable = sourceStates.filter((sourceState) =>
          sourceState.terminal && sourceState.candidates.length && sourceState.candidateVerdict === "TENTATIVE"
        );
        const qualified = strongAvailable.find((sourceState) => sourceState.qualifiedCandidate);
        if (qualified) {
          finishCollection("HEALTH_ACCEPTED");
          return;
        }
        if (!strongAvailable.length) {
          if (sourceStates.every((sourceState) => sourceState.terminal)) {
            if (pendingLateHealth && beforeDiscoveryDeadline) return;
            finishCollection(tentativeAvailable.length
              ? "ALL_SOURCES_TERMINAL_NO_STRONG_CANDIDATE"
              : "ALL_SOURCES_TERMINAL_NO_CANDIDATE");
          }
          return;
        }
        if (strongAvailable.some((sourceState) => !sourceState.qualificationDone) || qualificationActive) return;
        if (sourceStates.every((sourceState) => sourceState.terminal)) {
          if (pendingLateHealth && beforeDiscoveryDeadline) return;
          finishCollection("ALL_SOURCES_TERMINAL_HEALTH_EXHAUSTED");
        }
      };

      const registerLateHealth = (sourceState, batchInfo, batch, latePromise, preflightInfo) => {
        if (!sourceState || sourceState.candidateVerdict !== "STRONG" || !latePromise || collectionDone) return;
        const batchIndex = Number(batchInfo && batchInfo.batchIndex || 0);
        const entry = {
          sourceState,
          batchInfo,
          batch: Array.isArray(batch) ? batch.slice() : [],
          pending: true,
          preflightStartedAt: Number(preflightInfo && preflightInfo.preflightStartedAt || Date.now()),
          preflightDurationMs: Number(preflightInfo && preflightInfo.preflightDurationMs || 0)
        };
        sourceState.lateHealthPendingCount = Number(sourceState.lateHealthPendingCount || 0) + 1;
        sourceState.lateHealthPromises.push(latePromise);
        lateHealthPendingCount++;
        recordCuratedRaceDiag("CURATED_LATE_HEALTH_PENDING", {
          sourceId: sourceState.source.id,
          batchIndex,
          candidateCount: entry.batch.length,
          elapsedMs: Math.max(0, Date.now() - startedAt),
          remainingDiscoveryMs: Math.max(0, discoveryDeadline - Date.now())
        });

        const settleLateCounters = () => {
          if (!entry.pending) return;
          entry.pending = false;
          sourceState.lateHealthPendingCount = Math.max(0, Number(sourceState.lateHealthPendingCount || 0) - 1);
          sourceState.lateHealthResolvedCount = Number(sourceState.lateHealthResolvedCount || 0) + 1;
          lateHealthPendingCount = Math.max(0, lateHealthPendingCount - 1);
          lateHealthResolvedCount++;
        };
        const currentFreshHealthFor = (lateResult) => {
          const lateStates = lateResult && lateResult.states && typeof lateResult.states === "object"
            ? lateResult.states : {};
          const checkError = !!(lateResult && lateResult.checkError);
          const freshHealth = {};
          entry.batch.forEach((candidate) => {
            const key = panHealthKey(candidate);
            if (!key) return;
            if (checkError) {
              if (isPanCheckSupported(candidate)) freshHealth[key] = "uncertain";
              return;
            }
            if (Object.prototype.hasOwnProperty.call(lateStates, key)) {
              freshHealth[key] = lateStates[key];
              return;
            }
            const cached = getPanHealth(candidate);
            if (isPanHealthFresh(candidate) && cached && ["ok", "bad", "locked", "unavailable"].includes(String(cached.state || "").toLowerCase())) {
              freshHealth[key] = cached.state;
            }
          });
          return freshHealth;
        };
        const handleLateHealth = (lateResult) => {
          const elapsedMs = Math.max(0, Date.now() - startedAt);
          const current = detailPlaybackIsCurrent(run) && !run.cancelled;
          let ignoredReason = "";
          if (!current) ignoredReason = "STALE_RUN";
          else if (run.providerCommitted) ignoredReason = "PROVIDER_ALREADY_COMMITTED";
          else if (collectionDone) ignoredReason = collectionReason === "DISCOVERY_DEADLINE" ? "DISCOVERY_DEADLINE" : "COLLECTION_DONE";
          else if (Date.now() >= discoveryDeadline) ignoredReason = "DISCOVERY_DEADLINE";
          if (ignoredReason) {
            settleLateCounters();
            recordCuratedRaceDiag("CURATED_LATE_HEALTH_IGNORED", {
              sourceId: sourceState.source.id,
              batchIndex,
              elapsedMs,
              reason: ignoredReason
            });
            maybeFinishCollection();
            return;
          }

          const freshHealth = currentFreshHealthFor(lateResult);
          const qualified = curatedHealthBatchQualification(entry.batch, item, sourceState, freshHealth);
          const checkError = !!(lateResult && lateResult.checkError);
          recordCuratedRaceDiag("CURATED_LATE_HEALTH_RESULT", {
            sourceId: sourceState.source.id,
            batchIndex,
            elapsedMs,
            freshStateCount: Object.keys(freshHealth).length,
            acceptedCount: qualified.acceptedCount,
            badCount: qualified.rejectedCount,
            unconfirmedCount: qualified.unconfirmedCount
          });
          settleLateCounters();
          if (qualified.selected && !checkError && sourceState.candidateVerdict === "STRONG") {
            const lateQualification = {
              candidate: qualified.selected,
              sourceId: sourceState.source.id,
              sourceName: sourceState.source.name,
              identityVerdict: String(sourceState.candidateVerdict || ""),
              stale: false,
              timedOut: true,
              lateHealth: true,
              checkError: false,
              preflightStartedAt: entry.preflightStartedAt,
              preflightDurationMs: entry.preflightDurationMs,
              freshStateCount: Object.keys(freshHealth).length,
              healthAcceptedCount: qualified.acceptedCount,
              healthRejectedCount: qualified.rejectedCount,
              healthUnconfirmedCount: qualified.unconfirmedCount
            };
            sourceState.qualifiedCandidate = qualified.selected;
            sourceState.qualificationResult = lateQualification;
            sourceState.lateHealthAcceptedCount = Number(sourceState.lateHealthAcceptedCount || 0) + 1;
            lateHealthAcceptedCount++;
            selectedByLateHealth = true;
            recordCuratedRaceDiag("CURATED_LATE_HEALTH_ACCEPTED", {
              sourceId: sourceState.source.id,
              batchIndex,
              candidateLabel: String(qualified.selected.resourceTitle || qualified.selected.title || qualified.selected.fileName || "").slice(0, 160),
              diskType: String(qualified.selected.diskType || ""),
              elapsedMs
            });
            finishCollection("LATE_HEALTH_ACCEPTED");
            return;
          }
          if (qualified.selected && sourceState.candidateVerdict !== "STRONG") {
            recordCuratedRaceDiag("CURATED_LATE_HEALTH_IGNORED", {
              sourceId: sourceState.source.id,
              batchIndex,
              elapsedMs,
              reason: "NO_ACCEPTABLE_CANDIDATE"
            });
          }
          maybeFinishCollection();
        };
        Promise.resolve(latePromise).then(handleLateHealth, () => {
          handleLateHealth({ states: {}, checkError: true });
        });
      };

      const startNextQualification = () => {
        if (collectionDone || qualificationActive || !detailPlaybackIsCurrent(run)) return;
        const next = sourceStates
          .filter((sourceState) => sourceState.terminal
            && sourceState.candidates.length
            && sourceState.candidateVerdict === "STRONG"
            && !sourceState.qualificationStarted)
          .sort((a, b) => a.index - b.index)[0];
        if (!next) {
          maybeFinishCollection();
          return;
        }
        next.qualificationStarted = true;
        qualificationActive = true;
        next.qualificationPromise = Promise.resolve()
          .then(() => curatedProgressiveHealthCandidate(next, item, run, startedAt, {
            exposeLateResult: true,
            registerLateHealth
          }))
          .then((result) => {
            next.qualificationDone = true;
            next.qualificationResult = result || null;
            next.qualifiedCandidate = result && result.candidate || null;
            qualificationActive = false;
            if (next.qualifiedCandidate && !collectionDone) {
              finishCollection("HEALTH_ACCEPTED");
              return result;
            }
            startNextQualification();
            maybeFinishCollection();
            return result;
          }, () => {
            next.qualificationDone = true;
            next.qualificationResult = null;
            next.qualifiedCandidate = null;
            qualificationActive = false;
            startNextQualification();
            maybeFinishCollection();
            return null;
          });
      };

      const completeSource = (sourceState, result) => {
        if (collectionDone) return;
        if (!detailPlaybackIsCurrent(run)) {
          finishCollection("STALE");
          return;
        }
        const sourceResult = result && typeof result === "object" ? result : { kind: "TRANSPORT_FAILURE" };
        const kind = String(sourceResult.kind || "TRANSPORT_FAILURE").toUpperCase();
        sourceState.doneAt = Date.now();
        sourceState.terminal = true;
        sourceState.kind = kind;
        sourceState.terminalReason = String(sourceResult.terminalReason || kind);
        sourceState.entryCount = Number(sourceResult.entryCount || 0);
        sourceState.matchedEntryCount = Number(sourceResult.matchedEntryCount || 0);
        sourceState.sampleEntryTitles = Array.isArray(sourceResult.sampleEntryTitles)
          ? sourceResult.sampleEntryTitles.slice(0, 3)
          : [];
        sourceState.searchKeywordsTried = Array.isArray(sourceResult.searchKeywordsTried)
          ? sourceResult.searchKeywordsTried.slice()
          : [];
        sourceState.identityStrongCount = Number(sourceResult.identityStrongCount || 0);
        sourceState.identityTentativeCount = Number(sourceResult.identityTentativeCount || 0);
        sourceState.identityRejectCount = Number(sourceResult.identityRejectCount || 0);
        sourceState.identityReason = String(sourceResult.identityReason || "");
        sourceState.identityReasons = Array.isArray(sourceResult.identityReasons)
          ? sourceResult.identityReasons.slice(0, 12)
          : [];
        sourceState.candidateVerdict = kind === "CANDIDATES"
          ? String(sourceResult.candidateVerdict || "").toUpperCase()
          : "";
        sourceState.context.active = false;
        sourceState.candidates = kind === "CANDIDATES"
          ? (Array.isArray(sourceResult.candidates) ? sourceResult.candidates : [])
            .filter((candidate) => {
              if (!buildPanPlayPayload(candidate)) return false;
              const mediaVerdict = automaticVideoCandidateVerdict(item, candidate);
              if (!mediaVerdict.accepted) {
                recordAutomaticMediaRejected("curated", sourceState.source.id, candidate, mediaVerdict);
                return false;
              }
              return true;
            })
          : [];
        recordCuratedRaceDiag("CURATED_SOURCE_DONE", {
          sourceId: sourceState.source.id,
          kind,
          elapsedMs: Math.max(0, sourceState.doneAt - startedAt),
          sourceDoneMs: Math.max(0, sourceState.doneAt - startedAt),
          terminalReason: sourceState.terminalReason,
          entryCount: sourceState.entryCount,
          matchedEntryCount: sourceState.matchedEntryCount,
          sampleEntryTitles: sourceState.sampleEntryTitles,
          searchKeywordsTried: sourceState.searchKeywordsTried,
          identityStrongCount: sourceState.identityStrongCount,
          identityTentativeCount: sourceState.identityTentativeCount,
          identityRejectCount: sourceState.identityRejectCount,
          identityReason: sourceState.identityReason,
          identityReasons: sourceState.identityReasons,
          candidateVerdict: sourceState.candidateVerdict,
          candidateCount: sourceState.candidates.length
        });
        if (
          sourceState.candidates.length
          && sourceState.candidateVerdict === "STRONG"
          && !firstCandidateAt
        ) {
          firstCandidateAt = sourceState.doneAt;
          firstCandidateSource = sourceState.source.id;
          recordCuratedRaceDiag("CURATED_FIRST_CANDIDATE", {
            sourceId: sourceState.source.id,
            elapsedMs: Math.max(0, firstCandidateAt - startedAt),
            firstCandidateMs: Math.max(0, firstCandidateAt - startedAt),
            qualification: "PROGRESSIVE_HEALTH"
          });
        }
        startNextQualification();
        maybeFinishCollection();
      };

      discoveryTimer = setTimeout(() => finishCollection("DISCOVERY_DEADLINE"), Math.max(1, discoveryDeadline - Date.now()));
      sourceStates.forEach((sourceState) => {
        let sourceTask;
        try {
          sourceTask = searchCuratedSource(sourceState.source, item, run, sourceState.context);
        } catch (error) {
          sourceTask = Promise.reject(error);
        }
        Promise.resolve(sourceTask).then(
          (result) => completeSource(sourceState, result),
          (error) => completeSource(sourceState, {
            kind: error && error.curatedDeadline ? "SOURCE_TIMEOUT" : "TRANSPORT_FAILURE"
          })
        );
      });

      const collection = await collectionPromise;
      if (!detailPlaybackIsCurrent(run) || collection.stale) {
        recordCuratedRaceDiag("CURATED_NO_SELECTION", {
          elapsedMs: Math.max(0, Date.now() - startedAt),
          reason: collection.stale ? "STALE" : collection.reason
        });
        emitSummary({ collection, collectionReason: collection.stale ? "STALE" : collection.reason });
        return null;
      }
      const availableSourceCount = collection.sourceStates.filter((sourceState) => sourceState.candidates.length).length;
      if (!availableSourceCount) {
        recordCuratedRaceDiag("CURATED_NO_SELECTION", {
          elapsedMs: Math.max(0, Date.now() - startedAt),
          reason: collection.reason
        });
        emitSummary({ collection, collectionReason: collection.reason });
        return null;
      }

      const pendingQualifications = collection.sourceStates
        .map((sourceState) => sourceState.qualificationPromise)
        .filter((promise) => promise && typeof promise.then === "function");
      if (pendingQualifications.length) await Promise.all(pendingQualifications);
      let healthResult = collection.sourceStates
        .map((sourceState) => sourceState.qualificationResult)
        .find((result) => result && result.candidate) || null;
      if (!healthResult) {
        const strongStates = collection.sourceStates.filter((sourceState) =>
          sourceState.candidates.length && sourceState.candidateVerdict === "STRONG" && !sourceState.qualificationStarted
        );
        const hasStrong = collection.sourceStates.some((sourceState) =>
          sourceState.candidates.length && sourceState.candidateVerdict === "STRONG"
        );
        const fallbackStates = strongStates.length
          ? strongStates
          : hasStrong
            ? []
            : collection.sourceStates.filter((sourceState) =>
              sourceState.candidates.length && sourceState.candidateVerdict === "TENTATIVE" && !sourceState.qualificationStarted
            );
        if (fallbackStates.length) {
          try {
            healthResult = await curatedCentralHealthCandidate(fallbackStates, item, run, startedAt);
          } catch (error) {
            emitSummary({ collection, collectionReason: "PREFLIGHT_ERROR" });
            throw error;
          }
        }
      }
      if (!healthResult) {
        healthResult = {
          candidate: null,
          sourceId: "",
          sourceName: "",
          stale: false,
          timedOut: false,
          checkError: false,
          preflightStartedAt: 0,
          preflightDurationMs: 0,
          freshStateCount: 0,
          healthAcceptedCount: 0,
          healthRejectedCount: 0,
          healthUnconfirmedCount: 0
        };
      }
      if (!detailPlaybackIsCurrent(run) || !healthResult || healthResult.stale) {
        recordCuratedRaceDiag("CURATED_NO_SELECTION", {
          elapsedMs: Math.max(0, Date.now() - startedAt),
          reason: "STALE"
        });
        emitSummary({ collection, healthResult: healthResult || {}, collectionReason: "STALE" });
        return null;
      }
      if (healthResult.candidate) {
        emitSummary({ collection, healthResult, collectionReason: collection.reason });
        recordCuratedRaceDiag("CURATED_SELECTED", {
          elapsedMs: Math.max(0, Date.now() - startedAt),
          totalCuratedMs: Math.max(0, Date.now() - startedAt),
          sourceId: healthResult.sourceId,
          candidateLabel: String(
            healthResult.candidate.resourceTitle
            || healthResult.candidate.title
            || healthResult.candidate.fileName
            || ""
          ).slice(0, 160),
          diskType: String(healthResult.candidate.diskType || ""),
          selectionReason: "SOURCE_PRIORITY_THEN_CANDIDATE_ORDER"
        });
        return {
          sourceId: healthResult.sourceId,
          sourceName: healthResult.sourceName,
          identityVerdict: String(healthResult.identityVerdict || ""),
          candidate: healthResult.candidate
        };
      }
      recordCuratedRaceDiag("CURATED_NO_SELECTION", {
        elapsedMs: Math.max(0, Date.now() - startedAt),
        reason: "FRESH_BAD_OR_NO_ACCEPTABLE_CANDIDATE"
      });
      emitSummary({ collection, healthResult, collectionReason: "FRESH_BAD_OR_NO_ACCEPTABLE_CANDIDATE" });
      return null;
    }

