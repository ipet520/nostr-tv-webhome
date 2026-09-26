    async function probePanHealth(items, options) {
      const context = options && options.context;
      const curatedAttempt = context && context.curatedAttempt;
      const raceRun = context && context.raceRun;
      const isCurrent = () => raceRun
        ? detailPlaybackIsCurrent(raceRun)
          && (!curatedAttempt || (curatedAttempt.active && curatedRemainingMs(curatedAttempt) > 0))
        : !context || (panContextIsCurrent(context)
          && (!curatedAttempt || (curatedAttempt.active && curatedRemainingMs(curatedAttempt) > 0)));
      const list = (items || []).filter((it) => it && isPanCheckSupported(it));
      if (!list.length || !panCheckAvailable() || !isCurrent()) return {};
      try {
        const resp = await sdk().pan.check(list.map((it) => ({ type: it.diskType, url: it.url, password: it.password })));
        if (!isCurrent()) return {};
        const results = (resp && Array.isArray(resp.results)) ? resp.results : [];
        const out = {};
        list.forEach((it, i) => {
          const r = results[i] || {};
          const st = r.state || "uncertain";
          out[it.key] = st;
          state.pan.health[it.key] = { state: st, summary: r.summary || "", checkedAt: r.checked_at || Date.now(), expiresAt: r.expires_at || Date.now() + 300000 };
          invalidateAutomaticReadyForHealth(it, st, context);
        });
        return out;
      } catch (e) {
        if (options && options.throwOnError) throw e;
        return {};
      }
    }

    // 用户触发播放时，健康检查只能作为有界的辅助信号；背景预热仍直接使用 probePanHealth。
    // 超时后不等待原 Promise，也不把没有结果误记为 bad。Curated 可选地消费同一个原始 checkTask 的 late 结果。
    function playbackPanHealthPreflight(items, context, timeoutMs, options) {
      const opts = options || {};
      const preflightTimeout = timeoutMs == null
        ? PLAYBACK_PREFLIGHT_TIMEOUT_MS
        : Math.max(1, Number(timeoutMs) || 1);
      let timer = 0;
      const checkTask = Promise.resolve()
        .then(() => probePanHealth(items, { context, throwOnError: true }))
        .then((states) => ({ states: states || {}, timedOut: false, checkError: false }))
        .catch((error) => ({ states: {}, timedOut: false, checkError: true, error: String(error && error.message || error || "") }));
      const timeoutTask = new Promise((resolve) => {
        timer = setTimeout(() => resolve({ states: {}, timedOut: true, checkError: false }), preflightTimeout);
      });
      return Promise.race([checkTask, timeoutTask]).then((result) => {
        clearTimeout(timer);
        if (result && result.timedOut && opts.exposeLateResult === true) {
          return Object.assign({}, result, { latePromise: checkTask });
        }
        return result || { states: {}, timedOut: false, checkError: true };
      });
    }

    // ── 夸克/百度 Top5 候选池（"搜索播放"首选 + 1 分钟内重复点击的随机来源）──
    // 1 分钟内重复点击同一目标（同部影片，或同一集）则从前 5 里随机挑一个，
    // 超过 1 分钟（或首次点击）则固定取排名第 1 的（即最优画质/最贴合关键字那条）。
    const _repeatClickAt = {};
    const REPEAT_CLICK_WINDOW_MS = 60000;
    // 返回本次点击是否落在「上次点击同 key」的 1 分钟窗口内，并刷新该 key 的点击时间
    function isRepeatClickWithinWindow(key) {
      const now = Date.now();
      const last = _repeatClickAt[key];
      _repeatClickAt[key] = now;
      return !!(last && (now - last) <= REPEAT_CLICK_WINDOW_MS);
    }
    function isQuarkOrBaidu(it) {
      const t = normalizePanDiskType(it && it.diskType);
      return t === "quark" || t === "baidu";
    }

    function panAutoIdentityVerdict(item, candidate) {
      const title = String(candidate && (candidate.title || candidate.fileName || candidate.file_name || candidate.filename) || "").trim();
      const metadata = {
        remark: String(candidate && candidate.remark || "").trim(),
        year: String(candidate && candidate.year || "").trim(),
        yearTrusted: candidate && candidate.yearTrusted === true
      };
      const verdict = mediaIdentityVerdict(item, title, metadata);
      if (candidate) {
        candidate.identityVerdict = String(verdict && verdict.verdict || "REJECT");
        candidate.identityReason = String(verdict && verdict.reason || "");
        candidate.identityMatchedAlias = String(verdict && verdict.matchedAlias || "");
      }
      return verdict;
    }

    function automaticVideoCandidateVerdict(item, candidate) {
      const mediaType = String(item && (item.mediaType || item.media_type) || "").toLowerCase();
      if (mediaType !== "movie" && mediaType !== "tv") {
        return { accepted: true, reason: "NON_VIDEO_SCOPE", evidence: [] };
      }
      const evidence = [
        candidate && candidate.title,
        candidate && candidate.fileName,
        candidate && candidate.file_name,
        candidate && candidate.filename,
        candidate && candidate.resourceTitle,
        candidate && candidate.mediaTitle,
        candidate && candidate.sourceEntryTitle,
        candidate && candidate.remark,
        candidate && candidate.url
      ].map((value) => String(value || "").trim()).filter(Boolean);
      const text = evidence.join(" ");
      const extension = /\.(?:flac|mp3|wav|ape|m4a|aac|ogg|wma)(?:$|[?#\s)\]}，。；;])/i;
      const audioFormat = /(?:\bFLAC\b|\bMP3\b|\bWAV\b|\bAPE\b|\bM4A\b|\bAAC\b|\bOGG\b|\bWMA\b|24\s*bit|48\s*khz|96\s*khz|192\s*khz|母带|臻品母带|无损音乐|Hi[- ]?Res|伴奏|和声伴奏)/i;
      const soundtrack = /(?:\bOST\b|原声带|插曲|主题曲|片尾曲)/i;
      const strongAudioEvidence = extension.test(text) || audioFormat.test(text)
        || soundtrack.test(text) && (extension.test(text) || audioFormat.test(text));
      return strongAudioEvidence
        ? { accepted: false, reason: "AUDIO_ONLY_RESOURCE", evidence: evidence.slice(0, 8) }
        : { accepted: true, reason: "VIDEO_RESOURCE", evidence: evidence.slice(0, 8) };
    }

    function recordAutomaticMediaRejected(provider, sourceId, candidate, verdict) {
      if (!candidate || !verdict || verdict.accepted) return false;
      if (candidate._automaticMediaRejectedLogged) return true;
      candidate._automaticMediaRejectedLogged = true;
      recordCuratedRaceDiag("AUTOMATIC_MEDIA_REJECTED", {
        provider: String(provider || ""),
        sourceId: String(sourceId || candidate.source || candidate.provider || ""),
        candidateLabel: String(candidate.resourceTitle || candidate.title || candidate.fileName || "").slice(0, 160),
        reason: String(verdict.reason || "AUTOMATIC_MEDIA_REJECTED"),
        evidence: Array.isArray(verdict.evidence) ? verdict.evidence : []
      });
      return true;
    }

    function panAutoCandidateTiers(item, candidates) {
      const tiers = { strong: [], tentative: [], reject: [], identityStrongCount: 0, identityTentativeCount: 0, identityRejectCount: 0, mediaRejectCount: 0 };
      (candidates || []).forEach((candidate) => {
        const verdict = panAutoIdentityVerdict(item, candidate);
        const mediaVerdict = automaticVideoCandidateVerdict(item, candidate);
        candidate.automaticMediaVerdict = mediaVerdict;
        if (!mediaVerdict.accepted) {
          tiers.reject.push(candidate);
          tiers.mediaRejectCount++;
          recordAutomaticMediaRejected("pan-direct", candidate.source || candidate.provider, candidate, mediaVerdict);
          return;
        }
        if (verdict.verdict === "STRONG") {
          tiers.strong.push(candidate);
          tiers.identityStrongCount++;
        } else if (verdict.verdict === "TENTATIVE") {
          tiers.tentative.push(candidate);
          tiers.identityTentativeCount++;
        } else {
          tiers.reject.push(candidate);
          tiers.identityRejectCount++;
        }
      });
      return tiers;
    }

    function panAutoQBCandidateTiers(item, candidates) {
      return panAutoCandidateTiers(item, (candidates || []).filter(isQuarkOrBaidu));
    }

    function panAutoCandidateOrder(items) {
      const positions = new Map((state.pan.results || []).map((candidate, index) => [candidate.key, index]));
      const currentSnapshotSeq = Number(state.pan.panSnapshotSeq || 0);
      return (items || []).slice().sort((a, b) => {
        const disk = panDiskOrder(a) - panDiskOrder(b);
        if (disk) return disk;
        const aFresh = Number(a && a.panSnapshotSeq || 0) === currentSnapshotSeq ? 0 : 1;
        const bFresh = Number(b && b.panSnapshotSeq || 0) === currentSnapshotSeq ? 0 : 1;
        if (aFresh !== bFresh) return aFresh - bFresh;
        const aRank = Number.isFinite(Number(a && a.panServerDiskRank)) ? Number(a.panServerDiskRank) : Number.MAX_SAFE_INTEGER;
        const bRank = Number.isFinite(Number(b && b.panServerDiskRank)) ? Number(b.panServerDiskRank) : Number.MAX_SAFE_INTEGER;
        if (aRank !== bRank) return aRank - bRank;
        return (positions.get(a && a.key) == null ? Number.MAX_SAFE_INTEGER : positions.get(a.key))
          - (positions.get(b && b.key) == null ? Number.MAX_SAFE_INTEGER : positions.get(b.key));
      });
    }

    // 自动播放只消费身份合格且健康已确认的前 5 条；手动盘搜仍保留完整结果。
    async function pickQuarkBaiduTop5(item, randomize, handoffAction, options) {
      const opts = options || {};
      let pool = (state.pan.results || []).filter(isQuarkOrBaidu);
      if (!pool.length) return null;
      const identityTiers = panAutoCandidateTiers(item, pool);
      const tier = opts.tentativeOnly
        ? "TENTATIVE"
        : identityTiers.strong.length ? "STRONG"
        : opts.allowTentative && identityTiers.tentative.length ? "TENTATIVE" : "";
      const eligible = tier === "STRONG" ? identityTiers.strong : tier === "TENTATIVE" ? identityTiers.tentative : [];
      const top5 = panAutoCandidateOrder(eligible).slice(0, 5);
      if (!top5.length) return null;
      const previousHealth = panHealthSnapshot(top5);
      const healthCheckAvailable = panCheckAvailable();
      let freshHealth = {};
      const checkable = top5.filter(isPanCheckSupported);
      if (handoffAction) recordPanDirectHandoffStage("HEALTH_CHECK_START", item, handoffAction, { healthCheckCandidateCount: checkable.length });
      if (healthCheckAvailable) {
        const context = { token: state.pan.viewToken, item: state.selected, directAction: handoffAction };
        if (checkable.length) {
          const preflight = await playbackPanHealthPreflight(checkable, context);
          freshHealth = preflight.states || {};
          if (handoffAction) {
            recordPanDirectHandoffStage(preflight.timedOut ? "HEALTH_CHECK_TIMEOUT" : "HEALTH_CHECK_OK", item, handoffAction, {
              healthCheckTimedOut: !!preflight.timedOut,
              healthCheckError: !!preflight.checkError,
              healthCheckAvailable: Object.keys(freshHealth).length > 0
            });
          }
        } else if (handoffAction) {
          recordPanDirectHandoffStage("HEALTH_CHECK_OK", item, handoffAction, { healthCheckSkipped: true, healthCheckAvailable: false });
        }
        if (!panContextIsCurrent(context)) return null;
      } else if (handoffAction) {
        recordPanDirectHandoffStage("HEALTH_CHECK_OK", item, handoffAction, { healthCheckSkipped: true, healthCheckAvailable: false });
      }
      const decision = panPreflightCandidates(top5, freshHealth, previousHealth, { rejectAllBad: true });
      let healthAcceptedCount = 0;
      let healthRejectedCount = 0;
      let healthUnconfirmedCount = 0;
      const accepted = [];
      const decisionCandidates = new Set(decision.candidates || []);
      top5.forEach((candidate) => {
        const admission = panAutoHealthAdmission(candidate, freshHealth);
        candidate.healthAdmission = admission.state;
        if (admission.accepted && decisionCandidates.has(candidate)) {
          healthAcceptedCount++;
          accepted.push(candidate);
        } else if (["bad", "locked", "unavailable"].includes(admission.state) || !decisionCandidates.has(candidate)) {
          healthRejectedCount++;
        } else {
          healthUnconfirmedCount++;
        }
      });
      const finalPool = panAutoCandidateOrder(accepted);
      const pick = finalPool.length ? (randomize ? finalPool[Math.floor(Math.random() * finalPool.length)] : finalPool[0]) : null;
      recordPanPreflightResult(top5, freshHealth, panPreflightCheckErrorCount(checkable, freshHealth), pick, decision.allBadBatch);
      if (handoffAction) recordPanDirectHandoffStage("PICK_DONE", item, handoffAction, {
        selectedCandidate: panDirectPlayCandidateLabel(pick),
        allBadBatch: !!decision.allBadBatch,
        confirmedBadCount: Number(decision.confirmedBadCount || 0),
        identityStrongCount: identityTiers.identityStrongCount,
        identityTentativeCount: identityTiers.identityTentativeCount,
        identityRejectCount: identityTiers.identityRejectCount,
        healthAcceptedCount,
        healthRejectedCount,
        healthUnconfirmedCount,
        selectionTier: tier,
        selectedServerDiskRank: pick && Number.isFinite(Number(pick.panServerDiskRank)) ? Number(pick.panServerDiskRank) : null
      });
      return pick;
    }

    function openPanBlockIfNeeded() {
      const block = $("panSearchBlock");
      if (!block || block.classList.contains("active")) return;
      block.classList.add("active");
      block.style.display = "";
      // TV 版不压 #pan 历史（沿用本版 searchPanResources 的做法）
      renderPanResults();
      centerPanSearchBlock();
    }

    function resourceSearchKeyword(item) {
      return String(item && (item.resourceSearchTitle || item.title || item.originalTitle) || "").trim();
    }

    function panKeyword(item) {
      return resourceSearchKeyword(item);
    }

    function openPanFallback(item, message) {
      if (message) toast(message);
      if (!item) return false;
      const keyword = panKeyword(item);
      const lifecycle = getPanSearchLifecycleFor(item);
      const hasCurrentResults = lifecycle.sameSession && (state.pan.results || []).length;
      // Fallback 只负责展示当前生命周期。即使当前结果为空或都被健康 UI 标成 bad，
      // 也不能因为一次展示动作重新创建 Search Session；新的搜索必须来自明确入口。
      if (hasCurrentResults || lifecycle.sameSession) {
        openPanBlockIfNeeded();
        updatePostPanFocusState();
        renderPanResults();
        focusFirstPanTab();
        return true;
      }
      // 已有同一标题的静默搜索时只把现有 Pan UI 显示出来，避免重复发起请求。
      if (state.pan.keyword === keyword && state.pan.loading) {
        openPanBlockIfNeeded();
        updatePostPanFocusState();
        return true;
      }
      if (state.pan.loading) resetPanSearchState(false, { reason: "fallback_replaced" });
      openPanBlockIfNeeded();
      updatePostPanFocusState();
      renderPanResults();
      focusFirstPanTab();
      return true;
    }

    function getPanSearchLifecycleFor(item) {
      const keyword = panKeyword(item);
      const progress = state.pan.progress || {};
      const phase = String(progress.phase || "");
      const sameKeyword = !!keyword && state.pan.keyword === keyword;
      const sameSession = !!(sameKeyword && state.pan.sessionId && state.pan.sessionItemKey === panSearchItemKey(item));
      const expired = !!(sameSession && isPanSearchSessionHardExpired(state.pan));
      const terminalPhase = ["complete", "complete-empty", "initial-failed", "session-timeout", "error"].includes(phase);
      const active = !!(sameSession && !state.pan.sessionTerminal && !expired && !terminalPhase
        && (state.pan.loading || progress.active && (phase === "initial" || phase === "retry" || phase === "polling")));
      const idle = !!(sameSession && !state.pan.sessionTerminal && !expired && !active && !phase);
      const terminal = !!(sameSession && (state.pan.sessionTerminal || expired || terminalPhase || idle));
      const hasResults = !!(sameSession && (state.pan.results || []).length);
      const transportExhausted = !!(sameSession && state.pan.searchMode === "direct" && state.pan.directTransportExhausted);
      const resultCount = sameSession ? Number(state.pan.results && state.pan.results.length || 0) : 0;
      const resultCounts = sameSession ? panDirectPlayResultCounts(state.pan.results) : null;
      return {
        keyword,
        phase,
        sameKeyword,
        sameSession,
        active,
        terminal,
        idle,
        expired,
        hasResults,
        transportExhausted,
        sessionId: Number(state.pan.sessionId || 0),
        origin: String(state.pan.sessionOrigin || ""),
        failureKind: String(state.pan.lastFailureKind || ""),
        terminalReason: String(state.pan.sessionTerminalReason || ""),
        initialAttempts: Math.max(0, Number(state.pan.initialAttempts || 0)),
        requestSeq: Math.max(0, Number(state.pan.requestSeq || 0)),
        resultCount,
        qbCount: resultCounts ? resultCounts.quarkCount + resultCounts.baiduCount : 0
      };
    }

    function recordDirectPlaySessionDiag(action, reuseDecision, lifecycle) {
      if (!isTvDiagnosticEnabled() || !action) return null;
      const current = lifecycle || getPanSearchLifecycleFor(action.item);
      const old = action.oldSession || {};
      const decision = String(reuseDecision || action.sessionReuseDecision || "");
      if (decision === "CREATE_FRESH_DIRECT" && current && current.sameSession && Number(current.sessionId || 0) !== Number(old.sessionId || 0)) {
        if (!action.newSessionId || Number(action.newSessionId) !== Number(current.sessionId)) {
          action.newSessionId = Number(current.sessionId || 0);
          action.newInitialAttemptCount = Math.max(0, Number(state.pan.initialAttempts || 0));
        }
      }
      const result = {
        actionId: Number(action.token || 0),
        keyword: String(action.keyword || ""),
        oldSessionId: Number(old.sessionId || 0),
        oldLifecycle: String(old.lifecycle || ""),
        oldTerminal: !!old.terminal,
        oldFailureKind: String(old.failureKind || ""),
        oldAttemptCount: Math.max(0, Number(old.attemptCount || 0)),
        oldResultCount: Math.max(0, Number(old.resultCount || 0)),
        oldQbCount: Math.max(0, Number(old.qbCount || 0)),
        reuseDecision: decision,
        newSessionId: Number(action.newSessionId || (current && current.sameSession ? current.sessionId : state.pan.sessionId || 0)),
        newInitialAttemptCount: action.newInitialAttemptCount == null
          ? Math.max(0, Number(state.pan.initialAttempts || 0))
          : Math.max(0, Number(action.newInitialAttemptCount || 0)),
        actualRequestAttempts: Math.max(0, Number(state.pan.actualRequestAttempts || 0))
      };
      state.tvDiag.directPlaySession = result;
      try { console.debug("[Nostr TV] DIRECT_PLAY_SESSION_DIAG", result); } catch (e) {}
      updateTvDiagnostic();
      return result;
    }

    function refreshDirectPlaySessionDiag() {
      if (!isTvDiagnosticEnabled() || !state.tvDiag || !state.tvDiag.directPlaySession) return null;
      const diag = state.tvDiag.directPlaySession;
      const current = getPanSearchLifecycleFor(state.selected);
      if (diag.newSessionId && (!current.sameSession || Number(current.sessionId) !== Number(diag.newSessionId))) return diag;
      diag.actualRequestAttempts = Math.max(0, Number(state.pan.actualRequestAttempts || 0));
      return diag;
    }

    function recordForegroundSessionDiag(sourceActionId, oldDirectSessionId, foregroundSessionId, terminalReason) {
      if (!isTvDiagnosticEnabled()) return null;
      const pan = state.pan || {};
      const startedAt = Number(pan.sessionStartedAt || Date.now());
      const age = Math.max(0, Date.now() - startedAt);
      const result = {
        sourceActionId: Number(sourceActionId || 0),
        oldDirectSessionId: Number(oldDirectSessionId || 0),
        foregroundSessionId: Number(foregroundSessionId || pan.sessionId || 0),
        initialAttemptCount: Math.max(0, Number(pan.initialAttempts || 0)),
        initialRetryCount: 0,
        startedAtAgeMs: age,
        deadlineRemainingMs: Math.max(0, PAN_SEARCH_SESSION_MAX_MS - age),
        actualRequestAttempts: Math.max(0, Number(pan.actualRequestAttempts || 0)),
        terminalReason: String(terminalReason || pan.sessionTerminalReason || "")
      };
      state.tvDiag.foregroundSession = result;
      try { console.debug("[Nostr TV] FOREGROUND_SESSION_DIAG", result); } catch (e) {}
      updateTvDiagnostic();
      return result;
    }

    function refreshForegroundSessionDiag(terminalReason) {
      if (!isTvDiagnosticEnabled() || !state.tvDiag || !state.tvDiag.foregroundSession) return null;
      const diag = state.tvDiag.foregroundSession;
      if (!diag.foregroundSessionId || Number(diag.foregroundSessionId) !== Number(state.pan.sessionId || 0)) return diag;
      const startedAt = Number(state.pan.sessionStartedAt || Date.now());
      const age = Math.max(0, Date.now() - startedAt);
      diag.startedAtAgeMs = age;
      diag.deadlineRemainingMs = Math.max(0, PAN_SEARCH_SESSION_MAX_MS - age);
      diag.actualRequestAttempts = Math.max(0, Number(state.pan.actualRequestAttempts || 0));
      if (terminalReason || state.pan.sessionTerminalReason) diag.terminalReason = String(terminalReason || state.pan.sessionTerminalReason || "");
      return diag;
    }

    function panDirectPlayActionIsCurrent(action) {
      return !!(action && _directPlayPending === action && action.token === _directPlayPending.token && state.selected === action.item
        && !action.cancelReason
        && (!action.viewTokenBound || action.viewToken === state.pan.viewToken));
    }

    function panDirectPlayCancelReason(action) {
      if (!action) return "action_replaced";
      if (_directPlayPending !== action || action.token !== _directPlayPending.token) return "action_replaced";
      if (action.cancelReason) return action.cancelReason;
      if (state.selected !== action.item) return "selected_changed";
      if (action.searchStarted && state.pan.keyword && state.pan.keyword !== action.keyword) return "keyword_replaced";
      if (action.viewTokenBound && state.pan.viewToken !== action.viewToken) {
        if (!state.pan.viewToken) return "route_left";
        if (state.pan.keyword !== action.keyword) return "keyword_replaced";
        return "route_left";
      }
      return "";
    }

    function bindPanDirectPlayView(action) {
      if (!action || !action.searchStarted || action.viewTokenBound) return;
      const token = String(state.pan.viewToken || "");
      if (!token || state.pan.keyword !== action.keyword) return;
      action.viewToken = token;
      action.viewTokenBound = true;
      action.searchViewTokenChanged = token !== action.initialViewToken;
    }

    function panDirectPlayResultCounts(results) {
      const counts = {
        total: 0,
        quarkCount: 0,
        baiduCount: 0,
        aliyunCount: 0,
        ucCount: 0,
        "115Count": 0,
        otherCount: 0
      };
      (results || []).forEach((item) => {
        if (!item) return;
        counts.total++;
        const type = normalizePanDiskType(item.diskType);
        if (type === "quark") counts.quarkCount++;
        else if (type === "baidu") counts.baiduCount++;
        else if (type === "aliyun") counts.aliyunCount++;
        else if (type === "uc") counts.ucCount++;
        else if (type === "115") counts["115Count"]++;
        else counts.otherCount++;
      });
      return counts;
    }

    function panDirectPlayStage(lifecycle) {
      if (!lifecycle) return "";
      if (lifecycle.phase === "initial") return "INITIAL";
      if (lifecycle.phase === "retry") return "RETRY";
      if (lifecycle.phase === "polling") {
        const round = Number(state.pan.progress && state.pan.progress.round || 0);
        return round > 0 ? `POLL_${round}` : "POLLING";
      }
      return "";
    }

    function panDirectPlayCandidateSummary(item) {
      let pool = (state.pan.results || []).filter(isQuarkOrBaidu);
      const qbTotalBeforeRanking = pool.length;
      if (item && item.mediaType === "tv") {
        const packs = pool.filter((candidate) => panItemIsRangePack(String(candidate.title || "")));
        if (packs.length) pool = packs;
      }
      const qbTotalAfterTvPackFilter = pool.length;
      const top5 = rankQuarkPacks(pool).slice(0, 5);
      return {
        qbTotalBeforeRanking,
        qbTotalAfterTvPackFilter,
        top5Count: top5.length,
        top5: top5.map((candidate) => {
          const quality = panQualityInfo(candidate) || {};
          const health = getPanHealth(candidate) || {};
          return {
            diskType: normalizePanDiskType(candidate.diskType),
            title: String(candidate.title || ""),
            keywordHitScore: panKeywordHitScore(candidate),
            qualityScore: Number(quality.score || 0),
            packScore: panPackScore(candidate),
            healthState: String(health.state || "idle")
          };
        })
      };
    }

    function panDirectPlayCandidateLabel(item) {
      if (!item) return null;
      return {
        diskType: normalizePanDiskType(item.diskType),
        title: String(item.title || "")
      };
    }

    function recordDirectReadyEvent(event, item, candidate, reason, healthState, action) {
      const result = {
        event: String(event || ""),
        itemKey: item ? panSearchItemKey(item) : "",
        sessionId: Number(state.pan && state.pan.sessionId || 0),
        candidateKey: detailDirectPlayCandidateKey(candidate),
        identityVerdict: String(candidate && candidate.identityVerdict || ""),
        healthState: String(healthState || ""),
        reason: String(reason || ""),
        diskType: normalizePanDiskType(candidate && candidate.diskType),
        serverDiskRank: candidate && Number.isFinite(Number(candidate.panServerDiskRank))
          ? Number(candidate.panServerDiskRank) : null,
        actionId: Number(action && action.token || 0)
      };
      if (state.tvDiag) state.tvDiag.directReady = result;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV] " + String(event || "DIRECT_READY"), result); } catch (e) {}
        updateTvDiagnostic();
      }
      return result;
    }

    function recordPanDirectPlayDiag(stage, item, lifecycle, startedAt, extra, action) {
      syncDirectPlayStatusFromStage(stage, item, action);
      if (!isTvDiagnosticEnabled()) return null;
      const now = Date.now();
      const handoffStartedAt = Number(startedAt || now);
      const elapsed = Math.max(0, now - handoffStartedAt);
      const requestDiag = state.tvDiag.panSearchRequest || {};
      const result = Object.assign({
        actionId: Number(action && action.token || 0),
        stage: String(stage || ""),
        keyword: panKeyword(item),
        mediaType: String(item && item.mediaType || ""),
        lifecyclePhase: String(lifecycle && lifecycle.phase || ""),
        keywordMatchesCurrentSearch: !!(lifecycle && lifecycle.sameKeyword),
        searchActive: !!(lifecycle && lifecycle.active),
        elapsedMs: elapsed,
        directPlayElapsedMs: elapsed,
        stageElapsedMs: elapsed,
        totalHandoffElapsedMs: elapsed,
        directPlayBudgetMs: DIRECT_PLAY_WAIT_BUDGET_MS,
        waitBudgetMs: DIRECT_PLAY_WAIT_BUDGET_MS,
        requestAttempt: Number(requestDiag.attempt || 0),
        requestElapsedMs: Number(requestDiag.elapsedMs || 0),
        requestTimeout: Number(requestDiag.requestTimeout || 0),
        retryIndex: Number(requestDiag.retryIndex || 0),
        searchViewTokenChanged: !!(action && action.searchViewTokenChanged),
        cancelReason: String(action && action.cancelReason || ""),
        waitResult: String(action && action.waitResult || "")
      }, panDirectPlayResultCounts(lifecycle && lifecycle.sameKeyword ? state.pan.results : []), extra || {});
      state.tvDiag.panDirectPlay = result;
      try { console.debug("[Nostr TV] PAN_DIRECT_PLAY_DIAG", result); } catch (e) {}
      updateTvDiagnostic();
      return result;
    }

    function recordPanDirectHandoffStage(stage, item, action, extra) {
      if (!action) return null;
      const now = Date.now();
      const startedAt = Number(action.startedAt || now);
      const stageStartedAt = Number(action.handoffStageStartedAt || startedAt);
      const result = recordPanDirectPlayDiag(stage, item, getPanSearchLifecycleFor(item), startedAt, Object.assign({
        stageElapsedMs: Math.max(0, now - stageStartedAt),
        totalHandoffElapsedMs: Math.max(0, now - startedAt)
      }, extra || {}), action);
      action.handoffStageStartedAt = Date.now();
      return result;
    }

    function recordPanForegroundRecoveryDiag(reason, previousFailureKind, lifecycleStarted) {
      if (!isTvDiagnosticEnabled()) return null;
      const result = {
        reason: String(reason || ""),
        previousFailureKind: String(previousFailureKind || ""),
        newLifecycleStarted: !!lifecycleStarted
      };
      state.tvDiag.panForegroundRecovery = result;
      try { console.debug("[Nostr TV] PAN_FOREGROUND_RECOVERY_DIAG", result); } catch (e) {}
      updateTvDiagnostic();
      return result;
    }

    function recordPanForegroundHandoffDiag(oldSessionId, newSessionId, reason, previousFailureKind) {
      if (!isTvDiagnosticEnabled()) return null;
      const pan = state.pan || {};
      const progress = pan.progress || {};
      const block = $("panSearchBlock");
      const searching = !!(progress.active && progress.phase === "initial");
      const result = {
        oldSessionId: Number(oldSessionId || 0),
        newSessionId: Number(newSessionId || 0),
        reason: String(reason || ""),
        previousFailureKind: String(previousFailureKind || ""),
        newLifecycle: searching ? "INITIAL_SEARCHING" : String(progress.phase || ""),
        newFailureKind: String(pan.lastFailureKind || "none") || "none",
        panVisible: !!(block && block.classList.contains("active") && block.style.display !== "none"),
        firstRenderedState: searching ? "INITIAL_SEARCHING" : String(panEmptyStateText() || "")
      };
      state.tvDiag.panForegroundHandoff = result;
      try { console.debug("[Nostr TV] PAN_FOREGROUND_HANDOFF_DIAG", result); } catch (e) {}
      updateTvDiagnostic();
      return result;
    }

    async function waitForPanDirectPlay(action, options) {
      const opts = options || {};
      const waitStartedAt = Number(action && (action.waitStartedAt || action.startedAt) || Date.now());
      const baselineSnapshotSeq = Number(opts.afterSnapshotSeq || 0);
      const waitForNewSnapshot = !!opts.waitForNewSnapshot;
      let lastMarker = "";
      while (true) {
        bindPanDirectPlayView(action);
        const cancelReason = panDirectPlayCancelReason(action);
        if (cancelReason) {
          action.cancelReason = cancelReason;
          action.waitResult = "CANCELLED";
          recordPanDirectPlayDiag("CANCELLED", action.item, getPanSearchLifecycleFor(action.item), action.startedAt, null, action);
          return { result: "CANCELLED", cancelled: true, cancelReason };
        }
        const lifecycle = getPanSearchLifecycleFor(action.item);
        const counts = panDirectPlayResultCounts(state.pan.results);
        const identityTiers = panAutoQBCandidateTiers(action.item, state.pan.results);
        const hasStrongCandidate = lifecycle.sameSession && identityTiers.strong.length > 0;
        const snapshotAdvanced = Number(state.pan.panSnapshotSeq || 0) > baselineSnapshotSeq;
        if (hasStrongCandidate && (!waitForNewSnapshot || snapshotAdvanced || lifecycle.terminal)) {
          if (lastMarker !== "FOUND_QB") {
            action.waitResult = "FOUND_QB";
            recordPanDirectPlayDiag("FOUND_QB", action.item, lifecycle, action.startedAt, {
              identityStrongCount: identityTiers.identityStrongCount,
              identityTentativeCount: identityTiers.identityTentativeCount,
              identityRejectCount: identityTiers.identityRejectCount,
              snapshotSeq: Number(state.pan.panSnapshotSeq || 0)
            }, action);
            action.handoffStageStartedAt = Date.now();
            lastMarker = "FOUND_QB";
          }
          return { result: "FOUND_QB", found: true, lifecycle };
        }
        if (lifecycle.active) {
          const stage = panDirectPlayStage(lifecycle);
          const progress = state.pan.progress || {};
          const marker = `${stage}|${lifecycle.phase}|${Number(progress.round || 0)}|${counts.total}|${Number(state.pan.panSnapshotSeq || 0)}`;
          if (marker !== lastMarker) {
            recordPanDirectPlayDiag(stage, action.item, lifecycle, action.startedAt, null, action);
            lastMarker = marker;
          }
        }
        if (lifecycle.transportExhausted && !lifecycle.hasResults) {
          action.waitResult = "DIRECT_TRANSPORT_EXHAUSTED";
          recordPanDirectPlayDiag("DIRECT_TRANSPORT_EXHAUSTED", action.item, lifecycle, action.startedAt, null, action);
          return { result: "DIRECT_TRANSPORT_EXHAUSTED", transportExhausted: true, lifecycle };
        }
        if (lifecycle.terminal || lifecycle.idle) {
          action.waitResult = "TERMINAL_NO_QB";
          return { result: "TERMINAL_NO_QB", found: false, terminal: true, lifecycle };
        }
        const elapsed = Date.now() - waitStartedAt;
        if (elapsed >= DIRECT_PLAY_WAIT_BUDGET_MS) {
          action.waitResult = "WAIT_BUDGET_EXPIRED";
          recordPanDirectPlayDiag("WAIT_BUDGET_EXPIRED", action.item, lifecycle, action.startedAt, null, action);
          return { result: "WAIT_BUDGET_EXPIRED", budgetExpired: true, lifecycle };
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(120, Math.max(1, DIRECT_PLAY_WAIT_BUDGET_MS - elapsed))));
      }
    }

    function startPanForegroundRecovery(item, message, previousFailureKind, sourceActionId) {
      if (message) toast(message);
      if (!item) {
        recordPanForegroundRecoveryDiag("direct_transport_exhausted", previousFailureKind, false);
        return false;
      }
      const previousRecoveryCount = Math.max(0, Number(state.pan.foregroundRecoveryCount || 0));
      if (previousRecoveryCount >= 1) {
        recordPanForegroundRecoveryDiag("direct_transport_exhausted_limit", previousFailureKind, false);
        openPanFallback(item, "盘搜连接异常，请稍后重试");
        return false;
      }
      const oldSessionId = Number(state.pan.sessionId || 0);
      const searchTask = searchPanResources(item, {
        silent: false,
        mode: "foreground",
        origin: "foreground_recovery",
        forceNewSession: true,
        foregroundRecoveryCount: previousRecoveryCount + 1,
        recoveryReason: "direct_transport_exhausted",
        previousFailureKind: String(previousFailureKind || "")
      });
      // searchPanResources synchronously creates the new session and initializes
      // the visible INITIAL state before its first await. Render again here so
      // an already-open Pan list cannot retain the Direct session's final error.
      recordForegroundSessionDiag(sourceActionId, oldSessionId, Number(state.pan.sessionId || 0), "");
      renderPanResults();
      recordPanForegroundHandoffDiag(oldSessionId, Number(state.pan.sessionId || 0), "DIRECT_TRANSPORT_EXHAUSTED", previousFailureKind);
      const started = !!(state.pan.searchMode === "foreground" && state.pan.keyword === panKeyword(item) && state.pan.viewToken);
      recordPanForegroundRecoveryDiag("direct_transport_exhausted", previousFailureKind, started);
      if (searchTask && typeof searchTask.catch === "function") searchTask.catch(() => {});
      return started;
    }

    function currentDetailFailureRunFor(action) {
      if (!action || !action.item || state.selected !== action.item) return null;
      const sheet = $("detailSheet");
      if (!sheet || !sheet.classList.contains("active")) return null;
      const run = state.detailPlayback;
      if (!run || !detailPlaybackIsCurrent(run)) return null;
      if (action.detailPrimary && action.detailRun !== run) return null;
      return run;
    }

    function notifyCurrentDetailFinalFailure(run, type) {
      if (!run || run.finalFailureNotified || !detailPlaybackIsCurrent(run)) return false;
      const sheet = $("detailSheet");
      if (!sheet || !sheet.classList.contains("active") || state.selected !== run.item) return false;
      const failureType = ["NO_RESOURCE", "CONNECTION_FAILED"].includes(String(type || ""))
        ? String(type)
        : "CONNECTION_FAILED";
      toast(detailDirectFailureMessage(failureType));
      run.finalFailureNotified = true;
      return true;
    }

    function suppressDirectPlayPanFallback(action, message) {
      if (!action || !action.suppressAutoPan) return false;
      clearDirectPlayStatus(action.token, "detail_primary_no_source");
      // 旧 run、关闭详情或切换影片后的异步失败不得提示；后台 prepareOnly
      // 的失败由按钮三角状态表达，人工点击仍沿用原有提示语义。
      const detailRun = currentDetailFailureRunFor(action);
      const userRequested = !action.prepareOnly || !!action.playRequested;
      const failureType = detailDirectFailureTypeFor(action.item);
      const failureMessage = failureType ? detailDirectFailureMessage(failureType) : message;
      const alreadyNotified = !!action.finalFailureNotified
        || !!(detailRun && detailRun.finalFailureNotified);
      if (userRequested && failureMessage && !alreadyNotified) {
        toast(failureMessage);
        action.finalFailureNotified = true;
        if (detailRun) detailRun.finalFailureNotified = true;
      }
      action.playRequested = false;
      return true;
    }

    function isRecentNativeHomeReturn() {
      return !!(state.homeReturn && state.homeReturn.origin === "recent_native_player");
    }

    // 直接播放盘搜准备好的夸克/百度资源（"搜索播放"短按）：
    // 首次点击固定取排名第 1（最优画质/最贴合关键字）；1 分钟内再次点击则在排名前 5 里随机换一个。
    // 结果未就绪先复用同标题的完整搜索生命周期；终止或无候选只报告失败，不自动打开盘搜。
    let _directPlayActionSeq = 0;
    let _directPlayPending = null;

    function cancelPendingDirectPlay(reason) {
      const action = typeof _directPlayPending !== "undefined" ? _directPlayPending : null;
      if (!action) return false;
      action.playRequested = false;
      action.cancelReason = String(reason || "direct_play_cancelled");
      return true;
    }

    async function playBestQuark(item, options) {
      if (!item) return;
      const opts = options || {};
      const continueHistory = opts.history && typeof opts.history === "object" ? opts.history : null;
      const continueTarget = continueHistory ? detailContinuePlaybackTargetFor(item, continueHistory) : null;
      const requestedTarget = continueTarget;
      if (requestedTarget) setDetailPlaybackTarget(item, requestedTarget);
      if (_directPlayPending) {
        if (_directPlayPending.item === item) {
          // 详情进入时的 prepareOnly 与用户点击必须共享同一个 action。
          // 这里只改变当前 action 的意图，不创建新的搜索/session。
          if (continueHistory) {
            _directPlayPending.history = continueHistory;
            _directPlayPending.episodeTarget = continueTarget;
          }
          if (_directPlayPending.prepareOnly && !_directPlayPending.playRequested && !opts.prepareOnly) {
            _directPlayPending.playRequested = true;
            isRepeatClickWithinWindow(`qb:${item.tmdbId || item.title}`);
            showDirectPlayStatus(_directPlayPending.token, "REQUESTED_PREPARING", DIRECT_PLAY_STATUS_TEXT.REQUESTED_PREPARING, "play_requested_while_preparing");
            toast("资源正在准备，请稍候");
          }
          return _directPlayPending.promise;
        }
        if (state.selected === _directPlayPending.item) return _directPlayPending.promise;
      }
      const prepareOnly = !!opts.prepareOnly;
      const action = {
        item,
        token: ++_directPlayActionSeq,
        keyword: panKeyword(item),
        initialViewToken: String(state.pan.viewToken || ""),
        viewToken: "",
        viewTokenBound: false,
        searchStarted: false,
        searchViewTokenChanged: false,
        cancelReason: "",
        waitResult: "",
        sessionReuseDecision: "",
        oldSession: null,
        newSessionId: 0,
        newInitialAttemptCount: null,
        detailPrimary: !!opts.detailPrimary,
        detailRun: opts.detailPrimary ? state.detailPlayback : null,
        suppressAutoPan: !!opts.suppressAutoPan,
        raceMode: !!opts.raceMode,
        prepareOnly,
        history: continueHistory,
        episodeTarget: requestedTarget,
        playRequested: prepareOnly ? !!opts.playRequested : true,
        forceFreshDirect: !!opts.forceFreshDirect,
        startedAt: Date.now(),
        waitStartedAt: Date.now(),
        handoffStageStartedAt: 0,
        finalFailureNotified: false,
        promise: null
      };
      if (action.raceMode && action.detailRun) action.detailRun.raceActionToken = action.token;
      _directPlayPending = action;
      const initialStatusPhase = prepareOnly
        ? (action.playRequested ? "REQUESTED_PREPARING" : "BACKGROUND_PREPARING")
        : "SEARCHING";
      if (!action.raceMode) {
        showDirectPlayStatus(action.token, initialStatusPhase, DIRECT_PLAY_STATUS_TEXT[initialStatusPhase], prepareOnly ? "detail_prepare" : "play_click");
      }
      action.promise = (async () => {
        const keyword = action.keyword;
        if (!keyword || !panDirectPlayActionIsCurrent(action)) {
          if (action.raceMode && panDirectPlayActionIsCurrent(action)) reportDetailDirectRaceResult(action, null, "NO_KEYWORD");
          action.playRequested = false;
          return;
        }
        let lifecycle = getPanSearchLifecycleFor(item);
        action.oldSession = {
          sessionId: Number(lifecycle.sessionId || 0),
          lifecycle: String(lifecycle.phase || (lifecycle.terminal ? "TERMINAL" : lifecycle.active ? "ACTIVE" : "")),
          terminal: !!lifecycle.terminal,
          failureKind: String(lifecycle.failureKind || ""),
          attemptCount: Math.max(0, Number(lifecycle.initialAttempts || 0)),
          resultCount: Math.max(0, Number(lifecycle.resultCount || 0)),
          qbCount: Math.max(0, Number(lifecycle.qbCount || 0))
        };
        if (lifecycle.sameKeyword && state.pan.viewToken) {
          action.viewToken = state.pan.viewToken;
          action.viewTokenBound = true;
          action.initialViewToken = action.viewToken;
        }
        recordPanDirectPlayDiag("CLICK", item, lifecycle, action.startedAt, null, action);
        const currentDirectFailureType = detailDirectFailureTypeFor(item, lifecycle);
        if (action.detailPrimary && !prepareOnly && currentDirectFailureType === "NO_RESOURCE") {
          action.sessionReuseDecision = "NO_RESOURCE_NO_RETRY";
          recordDirectPlaySessionDiag(action, action.sessionReuseDecision, lifecycle);
          const message = detailDirectFailureMessage(currentDirectFailureType);
          suppressDirectPlayPanFallback(action, message);
          return;
        }
        const connectionFailureNeedsFresh = action.detailPrimary && !prepareOnly
          && currentDirectFailureType === "CONNECTION_FAILED";
        const currentIsDetailDirect = !action.detailPrimary
          || lifecycle.origin === "direct";
        const currentIdentityTiers = panAutoQBCandidateTiers(item, state.pan.results);
        const currentHasStrong = currentIdentityTiers.strong.length > 0;
        const currentHasTentative = currentIdentityTiers.tentative.length > 0;
        let hasCurrentQuarkOrBaidu = !connectionFailureNeedsFresh && currentIsDetailDirect && lifecycle.sameSession
          && (currentHasStrong || lifecycle.terminal && currentHasTentative);
        if (hasCurrentQuarkOrBaidu) {
          action.sessionReuseDecision = "USE_EXISTING_QB";
          recordDirectPlaySessionDiag(action, action.sessionReuseDecision, lifecycle);
        }
        if (!hasCurrentQuarkOrBaidu) {
          // prepareOnly 结束后，用户再次显式播放且仍没有 QB 候选时，
          // 才建立 fresh Direct session；prepareOnly 自身不会开启第二条搜索。
          const explicitPlayNeedsFreshDirect = action.detailPrimary
            && action.playRequested
            && !action.prepareOnly
            && currentIsDetailDirect;
          const shouldStartSearch = action.forceFreshDirect
            || explicitPlayNeedsFreshDirect
            || connectionFailureNeedsFresh
            || !lifecycle.sameSession
            || !currentIsDetailDirect
            || lifecycle.expired
            || lifecycle.idle && !lifecycle.hasResults;
          if (shouldStartSearch) {
            action.sessionReuseDecision = "CREATE_FRESH_DIRECT";
            recordDirectPlaySessionDiag(action, action.sessionReuseDecision, lifecycle);
            if (!action.raceMode) toast("正在搜索资源…");
            if (state.pan.loading && state.pan.keyword !== keyword) resetPanSearchState(false);
            if (!panDirectPlayActionIsCurrent(action)) {
              action.playRequested = false;
              return;
            }
            action.searchStarted = true;
            // A fresh lifecycle must bind this action to its new view token.
            action.viewToken = "";
            action.viewTokenBound = false;
            const searchTask = searchPanResources(item, { silent: true, mode: "direct", origin: "direct", forceNewSession: true, foregroundRecoveryCount: 0 });
            bindPanDirectPlayView(action);
            recordDirectPlaySessionDiag(action, action.sessionReuseDecision, getPanSearchLifecycleFor(item));
            if (!action.viewTokenBound) await Promise.resolve();
            bindPanDirectPlayView(action);
            if (searchTask && typeof searchTask.catch === "function") searchTask.catch(() => {});
          } else if (lifecycle.active) {
            action.sessionReuseDecision = "REUSE_ACTIVE_SEARCH";
            recordDirectPlaySessionDiag(action, action.sessionReuseDecision, lifecycle);
            if (!action.raceMode) toast("正在继续搜索可播放资源…");
          } else if (lifecycle.hasResults) {
            action.sessionReuseDecision = "USE_EXISTING_RESULTS";
            recordDirectPlaySessionDiag(action, action.sessionReuseDecision, lifecycle);
          }
          const waited = await waitForPanDirectPlay(action);
          if (waited.result === "CANCELLED" || waited.cancelled || !panDirectPlayActionIsCurrent(action)) {
            action.playRequested = false;
            return;
          }
          recordDirectPlaySessionDiag(action, action.sessionReuseDecision, waited.lifecycle || getPanSearchLifecycleFor(item));
          if (waited.result === "DIRECT_TRANSPORT_EXHAUSTED") {
            setDetailDirectFailureType(item, "CONNECTION_FAILED", waited.lifecycle || getPanSearchLifecycleFor(item));
            recordPanDirectPlayDiag("DIRECT_TRANSPORT_EXHAUSTED", item, waited.lifecycle || getPanSearchLifecycleFor(item), action.startedAt, null, action);
            if (action.raceMode) {
              reportDetailDirectRaceResult(action, null, "CONNECTION_FAILED");
              return;
            }
            suppressDirectPlayPanFallback(action, detailDirectFailureMessage("CONNECTION_FAILED"));
            return;
          }
          if (waited.result === "WAIT_BUDGET_EXPIRED") {
            const failureType = detailDirectFailureTypeAfterPrepare();
            setDetailDirectFailureType(item, failureType, waited.lifecycle || getPanSearchLifecycleFor(item));
            const failureMessage = detailDirectFailureMessage(failureType);
            recordPanDirectPlayDiag("FINAL_ERROR", item, waited.lifecycle || getPanSearchLifecycleFor(item), action.startedAt, null, action);
            if (action.raceMode) {
              reportDetailDirectRaceResult(action, null, failureType);
              return;
            }
            suppressDirectPlayPanFallback(action, failureMessage);
            return;
          }
          if (waited.result !== "FOUND_QB" && waited.result !== "TERMINAL_NO_QB") {
            if (action.raceMode) reportDetailDirectRaceResult(action, null, "DIRECT_FAILED");
            return;
          }
          lifecycle = waited.lifecycle || getPanSearchLifecycleFor(item);
          const waitedIdentityTiers = panAutoQBCandidateTiers(item, state.pan.results);
          const waitedHasStrong = waitedIdentityTiers.strong.length > 0;
          const waitedHasTentative = waitedIdentityTiers.tentative.length > 0;
          const foundAfterWait = lifecycle.sameSession
            && (waitedHasStrong
              || lifecycle.terminal && waitedHasTentative);
          hasCurrentQuarkOrBaidu = foundAfterWait;
          if (!foundAfterWait) {
            const failureType = detailDirectFailureTypeAfterPrepare();
            setDetailDirectFailureType(item, failureType, lifecycle);
            const failureMessage = detailDirectFailureMessage(failureType);
            action.waitResult = "TERMINAL_NO_QB";
            recordPanDirectPlayDiag("TERMINAL_NO_QB", item, lifecycle, action.startedAt, null, action);
            recordPanDirectPlayDiag("FINAL_ERROR", item, lifecycle, action.startedAt, null, action);
            if (action.raceMode) {
              reportDetailDirectRaceResult(action, null, failureType);
              return;
            }
            suppressDirectPlayPanFallback(action, failureMessage);
            return;
          }
        }
        if (!panDirectPlayActionIsCurrent(action)) {
          action.playRequested = false;
          return;
        }
        lifecycle = getPanSearchLifecycleFor(item);
        if (hasCurrentQuarkOrBaidu) {
          recordPanDirectHandoffStage("FOUND_QB", item, action, { foundFromCurrentLifecycle: true });
        }
        const before = panDirectPlayCandidateSummary(item);
        recordPanDirectPlayDiag("CANDIDATE_BEFORE", item, lifecycle, action.startedAt, before, action);
        // 1 分钟内重复点击同一部 → 排名前 5 的夸克/百度资源里随机换一个；
        // 首次点击 / 超过 1 分钟 → 固定取排名第 1
        const clickKey = `qb:${item.tmdbId || item.title}`;
        // 自动 prepareOnly 不是用户点击，不能污染手动播放的重复点击窗口。
        const isRepeat = action.prepareOnly ? false : isRepeatClickWithinWindow(clickKey);
        recordPanDirectHandoffStage("PICK_START", item, action, { repeatClick: !!isRepeat });
        let pick = null;
        let selectionTier = "";
        let selectionType = "";
        let pickLifecycle = getPanSearchLifecycleFor(item);
        while (panDirectPlayActionIsCurrent(action)) {
          pickLifecycle = getPanSearchLifecycleFor(item);
          const identityTiers = panAutoQBCandidateTiers(item, state.pan.results);
          pick = await pickQuarkBaiduTop5(item, isRepeat, action, { allowTentative: false });
          selectionTier = pick ? String(pick.identityVerdict || "STRONG") : "";
          selectionType = "";
          if (!pick && pickLifecycle.terminal && identityTiers.tentative.length) {
            pick = await pickQuarkBaiduTop5(item, isRepeat, action, { allowTentative: true, tentativeOnly: true });
            selectionTier = pick ? String(pick.identityVerdict || "TENTATIVE") : "";
          }
          if (pick || !pickLifecycle.active) break;
          const snapshotSeq = Number(state.pan.panSnapshotSeq || 0);
          const continued = await waitForPanDirectPlay(action, {
            waitForNewSnapshot: true,
            afterSnapshotSeq: snapshotSeq
          });
          if (continued.result === "CANCELLED" || continued.cancelled || !panDirectPlayActionIsCurrent(action)) {
            action.playRequested = false;
            return;
          }
          if (["WAIT_BUDGET_EXPIRED", "DIRECT_TRANSPORT_EXHAUSTED"].includes(continued.result)) break;
        }
        if (!panDirectPlayActionIsCurrent(action)) {
          action.playRequested = false;
          return;
        }
        const after = panDirectPlayCandidateSummary(item);
        recordPanDirectPlayDiag("CANDIDATE_AFTER", item, getPanSearchLifecycleFor(item), action.startedAt, Object.assign(after, {
          selectedCandidate: panDirectPlayCandidateLabel(pick),
          selectionTier,
          selectionType
        }), action);
        if (!pick) {
          const failureType = detailDirectFailureTypeAfterPrepare();
          setDetailDirectFailureType(item, failureType, getPanSearchLifecycleFor(item));
          const failureMessage = detailDirectFailureMessage(failureType);
          state.pan.directReady = null;
          recordPanDirectPlayDiag("FINAL_ERROR", item, getPanSearchLifecycleFor(item), action.startedAt, null, action);
          if (action.raceMode) {
            reportDetailDirectRaceResult(action, null, failureType);
            return;
          }
          suppressDirectPlayPanFallback(action, failureMessage);
          return;
        }
        const readyLifecycle = getPanSearchLifecycleFor(item);
        const readyCandidateKey = detailDirectPlayCandidateKey(pick);
        state.pan.directFailure = null;
        if (readyLifecycle.sameSession && readyLifecycle.origin === "direct" && readyCandidateKey) {
          const readyMediaVerdict = automaticVideoCandidateVerdict(item, pick);
          if (!readyMediaVerdict.accepted) {
            recordAutomaticMediaRejected("pan-direct", pick.source || pick.provider, pick, readyMediaVerdict);
            state.pan.directReady = null;
            if (action.raceMode) reportDetailDirectRaceResult(action, null, "AUTOMATIC_MEDIA_REJECTED");
            return;
          }
          const readyAdmission = panAutoHealthAdmission(pick, {});
          state.pan.directReady = {
            itemKey: panSearchItemKey(item),
            sessionId: Number(readyLifecycle.sessionId || 0),
            candidateKey: readyCandidateKey,
            candidate: pick,
            identityVerdict: String(pick.identityVerdict || ""),
            healthState: String(readyAdmission.state || ""),
            serverDiskRank: Number.isFinite(Number(pick.panServerDiskRank)) ? Number(pick.panServerDiskRank) : null
          };
          recordDirectReadyEvent("DIRECT_READY_PUBLISHED", item, pick, "health_accepted", readyAdmission.state, action);
        } else {
          state.pan.directReady = null;
        }
        if (action.raceMode) {
          reportDetailDirectRaceResult(action, pick, "DIRECT_QUALIFIED_READY", {
            identityVerdict: String(pick && pick.identityVerdict || selectionTier || "")
          });
          return;
        }
        if (action.prepareOnly && !action.playRequested) {
          // 自动准备只把同一 lifecycle 留在 Ready 状态，绝不自动交给原生播放器。
          showDirectPlayStatus(action.token, "READY", DIRECT_PLAY_STATUS_TEXT.READY, "prepare_only_ready");
          updateDetailContinueButton();
          return;
        }
        if (isRepeat) toast(`已换源 · ${panDiskName(pick.diskType)}`);
        // 播放开始前消费一次性请求，避免后续状态刷新重复触发播放。
        if (action.detailPrimary && action.prepareOnly && action.playRequested) {
          const detailRun = state.detailPlayback;
          if (detailRun && detailPlaybackIsCurrent(detailRun) && detailRun.historyPromise) {
            await detailRun.historyPromise.catch(() => null);
            if (!panDirectPlayActionIsCurrent(action)) {
              action.playRequested = false;
              return;
            }
            action.history = detailRun.history || state.detailHistory || null;
            action.episodeTarget = action.history
              ? detailContinuePlaybackTargetFor(item, action.history)
              : action.episodeTarget || currentPlaybackTargetForItem(item);
          }
        }
        // 最终同步坏源保护：不新增网络检查，只拒绝当前缓存已明确失效的候选。
        // 手动盘搜仍直接进入 playPanResult()，保留其警告后强制播放行为。
        if (isPanHealthBad(pick)) {
          state.pan.directReady = null;
          setDetailDirectFailureType(item, "NO_RESOURCE", getPanSearchLifecycleFor(item));
          updateDetailContinueButton();
          suppressDirectPlayPanFallback(action, detailDirectFailureMessage("NO_RESOURCE"));
          return;
        }
        recordDirectReadyEvent("DIRECT_READY_CONSUMED", item, pick, "direct_play", panAutoHealthAdmission(pick, {}).state, action);
        action.playRequested = false;
        updateDirectPlayStatus(action.token, "STARTING_PLAYER", "正在启动播放器…", "native_handoff");
        await playPanResult(pick, {
          prechecked: true,
          handoffAction: action,
          episodeTarget: action.episodeTarget || currentPlaybackTargetForItem(item),
          historyResume: !!action.history
        });
      })();
      try {
        return await action.promise;
      } finally {
        if (_directPlayPending === action) _directPlayPending = null;
      }
    }

    async function searchPanResources(item, opts) {
      const options = opts || {};
      if (!item) return;
      const silent = !!options.silent;
      const requestedMode = String(options.mode || (silent ? "background" : "foreground"));
      const mode = ["direct", "foreground", "background"].includes(requestedMode) ? requestedMode : "foreground";
      const requestedOrigin = String(options.origin || "");
      const origin = ["manual", "direct", "foreground_recovery", "preload"].includes(requestedOrigin)
        ? requestedOrigin
        : mode === "direct" ? "direct" : silent ? "preload" : "manual";
      const forceNewSession = !!options.forceNewSession || origin === "manual" || origin === "foreground_recovery";
      const keyword = panKeyword(item);
      if (!keyword) { if (!silent) toast("缺少搜索标题"); return; }
      const lifecycle = getPanSearchLifecycleFor(item);
      if (state.pan.loading && !forceNewSession) return;
      if (lifecycle.sameSession && !forceNewSession) return;
      const hadResults = state.pan.results.length > 0 && $("panSearchBlock") && $("panSearchBlock").classList.contains("active");
      // A forced Direct/Foreground lifecycle is allowed to replace execution
      // state for the same item without deleting reusable results, health cache,
      // focus state, or playback return data.
      const preserveSessionData = !!(lifecycle.sameSession && forceNewSession
        && (origin === "direct" || origin === "foreground_recovery"));
      const lifecycleBefore = String(state.pan.progress && state.pan.progress.phase || "");
      resetPanSearchState(false, {
        reason: options.reason || "new_session",
        preserveResults: preserveSessionData,
        preserveHealth: preserveSessionData,
        preserveFocus: preserveSessionData,
        preservePlaybackReturn: preserveSessionData
      });
      const sessionId = startPanSearchSession(item, keyword, origin, options);
      state.pan.loading = true;
      state.pan.searchMode = mode;
      const token = `pan-${Date.now()}-${sessionId}`;
      state.pan.viewToken = token;
      state.pan.initialSucceeded = false;
      state.pan.initialResultState = "";
      state.pan.lastFailureKind = "";
      state.pan.retryRemaining = 0;
      state.pan.finalFailure = false;
      state.pan.directTransportExhausted = false;
      if (!preserveSessionData) state.pan.results = [];
      state.pan.activeType = "";
      if (!preserveSessionData) state.pan.health = {};
      state.pan.pending = {};
      state.pan.queued.clear();
      state.pan.inFlight.clear();
      state.pan.focusMode = "tabs";
      clearPanPollTimers();
      state.pan.pollRound = 0;
      const totalPollRounds = panSearchPollIntervals().length;
      armPanSearchSessionHardGuard(item, token, sessionId);
      setPanProgress(true, "initial", 0, totalPollRounds);
      // silent：后台静默搜索，不打开盘搜页、不抢焦点（用于详情页主播放预搜）
      if (!silent) {
        if ($("panSearchBlock")) {
          $("panSearchBlock").classList.add("active");
          $("panSearchBlock").style.display = "";
        }
        updatePostPanFocusState();
        centerPanSearchBlock();
        if (!hadResults && $("panTabs")) $("panTabs").replaceChildren();
        if (!hadResults && $("panResultList")) $("panResultList").replaceChildren(emptyNode(panEmptyStateText()));
        $("panSearchHint").textContent = `${keyword} · 正在搜索`;
      }
      setPanStatus(`搜索 ${keyword}`);
      try {
        const config = state.pan.config || defaultPanConfig();
        const headers = await ensurePanAuthHeaders();
        const attemptTimeoutMs = mode === "direct" ? PAN_DIRECT_ATTEMPT_TIMEOUT_MS : mode === "foreground" ? PAN_FOREGROUND_ATTEMPT_TIMEOUT_MS : PAN_INITIAL_ATTEMPT_TIMEOUT_MS;
        const retryDelays = mode === "direct" ? PAN_DIRECT_RETRY_DELAYS : mode === "foreground" ? PAN_FOREGROUND_RETRY_DELAYS : PAN_INITIAL_RETRY_DELAYS;
        const body = await requestPanSearchWithRetry(item, token, keyword, config, headers, {
          mode,
          phase: "initial",
          round: 0,
          sessionId,
          maxAttempts: PAN_INITIAL_SEARCH_MAX_ATTEMPTS,
          retryDelays,
          attemptTimeoutMs,
          totalDeadlineMs: mode === "background" ? PAN_INITIAL_TOTAL_DEADLINE_MS : 0,
          lifecycleBefore,
          onRetry: (round, total, error, failureKind) => {
            if (!isPanSearchSessionActive(item, token, sessionId)) return;
            state.pan.lastFailureKind = String(failureKind || classifyPanRequestError(error));
            state.pan.retryRemaining = Math.max(0, Number(total || 0));
            state.pan.finalFailure = false;
            setPanProgress(true, "retry", 0, totalPollRounds);
            if (!silent && $("panSearchHint")) $("panSearchHint").textContent = `${keyword} · ${panRetryStatusText(state.pan.lastFailureKind)} ${round}/${total}`;
            if (!silent) renderPanResults();
          }
        });
        if (body === null || !isPanSearchSessionActive(item, token, sessionId)) return;
        state.pan.initialSucceeded = true;
        state.pan.initialResultState = "success";
        state.pan.lastFailureKind = "";
        state.pan.retryRemaining = 0;
        state.pan.finalFailure = false;
        state.pan.directTransportExhausted = false;
        const results = applyPanSearchBody(body, keyword);
        if (!results.length) state.pan.initialResultState = "success_empty";
        setPanStatus(results.length ? `找到 ${results.length} 条` : "无资源");
        schedulePanPolling(token, item, sessionId);
        if (!silent) {
          renderPanResults();
          focusFirstPanTab();
        }
        scheduleUiSnapshotSave();
      } catch (e) {
        if (!isPanSearchSessionActive(item, token, sessionId)) return;
        const failureKind = classifyPanRequestError(e);
        state.pan.lastFailureKind = failureKind;
        state.pan.retryRemaining = 0;
        state.pan.finalFailure = true;
        state.pan.directTransportExhausted = mode === "direct" && panRequestFailureIsRetryable(failureKind) && !!e.panRetryExhausted;
        if (failureKind === "auth" && state.pan.config) {
          state.pan.config.token = "";
          state.pan.config.tokenExpiresAt = 0;
          await persistPanConfigQuietly();
          if (!isPanSearchSessionActive(item, token, sessionId)) return;
        }
        if (!preserveSessionData) state.pan.results = [];
        terminalizePanSearchSession(token, item, sessionId, "initial_failure", { failureKind, totalRounds: totalPollRounds, render: !silent });
      } finally {
        if (isPanSearchSessionCurrent(item, token, sessionId, true)) state.pan.loading = false;
      }
    }

    function focusFirstPanResult() {
      const item = $("panResultList") && $("panResultList").querySelector(".pan-result-item");
      if (item) requestAnimationFrame(() => focusRemoteTarget(item));
    }

    function applyPanSearchBody(body, keyword) {
      const data = body && body.data ? body.data : body;
      const incoming = normalizePanResults(data && data.merged_by_type || {}, keyword);
      const map = new Map(state.pan.results.map((item) => [item.key, item]));
      const snapshotSeq = Math.max(0, Number(state.pan.panSnapshotSeq || 0)) + 1;
      const incomingKeys = new Set();
      const ordered = [];
      incoming.forEach((item, incomingIndex) => {
        const existing = map.get(item.key);
        const target = existing ? Object.assign(existing, item) : item;
        target.panSnapshotSeq = snapshotSeq;
        target.panSnapshotIndex = incomingIndex;
        incomingKeys.add(target.key);
        ordered.push(target);
      });
      const carried = state.pan.results.filter((item) => !incomingKeys.has(item.key));
      state.pan.panSnapshotSeq = snapshotSeq;
      state.pan.results = ordered.concat(carried);
      const snapshotDiag = {
        snapshotSeq,
        incomingCount: incoming.length,
        carriedCount: carried.length
      };
      if (state.tvDiag) state.tvDiag.panSnapshot = snapshotDiag;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV] PAN_SNAPSHOT", snapshotDiag); } catch (e) {}
        updateTvDiagnostic();
      }
      ensureActivePanType();
      if (state.selected && $("detailSheet") && $("detailSheet").classList.contains("active")) {
        updateDetailContinueButton();
      }
      scheduleUiSnapshotSave();
      return state.pan.results;
    }

    function panSearchPollIntervals() {
      const value = window.WEBHOME_CONFIG && window.WEBHOME_CONFIG.pan && window.WEBHOME_CONFIG.pan.pollIntervals;
      return Array.isArray(value) ? value.map((delay) => Number(delay)).filter((delay) => Number.isFinite(delay) && delay >= 0) : [];
    }

    function finishPanPolling(token, item, totalRounds, options) {
      const opts = options || {};
      const sessionId = Number(opts.sessionId || state.pan.sessionId || 0);
      if (!isPanSearchSessionActive(item, token, sessionId)) return;
      const total = state.pan.results.length;
      state.pan.pollRound = Number(totalRounds || state.pan.pollRound || 0);
      state.pan.pollRoundsCompleted = Math.max(Number(state.pan.pollRoundsCompleted || 0), state.pan.pollRound);
      state.pan.retryRemaining = 0;
      state.pan.finalFailure = false;
      const failureKind = String(opts.failureKind || "");
      if (failureKind) state.pan.lastFailureKind = failureKind;
      const reason = !total && state.pan.initialSucceeded
        ? "complete_empty"
        : failureKind ? "poll_failure" : "complete";
      terminalizePanSearchSession(token, item, sessionId, reason, {
        failureKind,
        totalRounds: Number(totalRounds || state.pan.pollRound || 0),
        render: opts.render !== false
      });
    }

    function schedulePanPolling(token, item, sessionId) {
      if (!isPanSearchSessionActive(item, token, sessionId)) return;
      const intervals = panSearchPollIntervals();
      if (!intervals.length) {
        finishPanPolling(token, item, 0, { sessionId });
        return;
      }
      setPanProgress(true, "polling", 0, intervals.length);
      state.pan.pollRoundStarted = {};
      intervals.forEach((delay, index) => {
        const timer = setTimeout(() => pollPanResources(token, item, index + 1, intervals.length, sessionId), delay);
        state.pan.pollTimers.push(timer);
      });
    }

    async function pollPanResources(token, item, round, totalRounds, sessionId) {
      const currentSessionId = Number(sessionId || state.pan.sessionId || 0);
      if (!isPanSearchSessionActive(item, token, currentSessionId) || !state.pan.keyword) return;
      const total = Number(totalRounds || panSearchPollIntervals().length || 0);
      state.pan.pollRound = round;
      if (!state.pan.pollRoundStarted[round]) {
        state.pan.pollRoundStarted[round] = true;
        state.pan.pollRoundsStarted = Math.max(0, Number(state.pan.pollRoundsStarted || 0) + 1);
      }
      setPanProgress(true, "polling", round, total);
      if (isPanSearchActive() && $("panSearchHint")) $("panSearchHint").textContent = `${state.pan.keyword} · 正在更新资源 · ${round}/${total}`;
      try {
        const config = state.pan.config || defaultPanConfig();
        const headers = await ensurePanAuthHeaders();
        const body = await requestPanSearchWithRetry(item, token, state.pan.keyword, config, headers, {
          mode: "poll",
          phase: "poll",
          round,
          sessionId: currentSessionId,
          maxAttempts: PAN_POLL_MAX_ATTEMPTS,
          retryDelays: PAN_POLL_RETRY_DELAYS,
          attemptTimeoutMs: PAN_POLL_ATTEMPT_TIMEOUT_MS,
          lifecycleBefore: "polling",
          onRetry: (retry, retries, error, failureKind) => {
            if (!isPanSearchSessionActive(item, token, currentSessionId)) return;
            state.pan.lastFailureKind = String(failureKind || classifyPanRequestError(error));
            state.pan.retryRemaining = Math.max(0, Number(retries || 0));
            state.pan.finalFailure = false;
            setPanProgress(true, "retry", round, total);
            if (isPanSearchActive() && $("panSearchHint")) $("panSearchHint").textContent = `${state.pan.keyword} · ${panRetryStatusText(state.pan.lastFailureKind)} ${retry}/${retries}`;
            if (!state.pan.results.length && isPanSearchActive()) renderPanResults();
          }
        });
        if (body === null || !isPanSearchSessionActive(item, token, currentSessionId)) return;
        setPanProgress(true, "polling", round, total);
        const before = state.pan.results.length;
        const results = applyPanSearchBody(body, state.pan.keyword);
        const added = results.length - before;
        setPanStatus(added > 0 ? `新增 ${added} 条，共 ${results.length}` : `已更新 ${results.length} 条`);
        renderPanResults();
        if (isPanSearchActive() && $("panSearchHint")) $("panSearchHint").textContent = `${state.pan.keyword} · 正在更新资源 · ${round}/${total}`;
        scheduleUiSnapshotSave();
      } catch (e) {
        const failureKind = classifyPanRequestError(e);
        if (failureKind === "auth" && state.pan.config) {
          state.pan.config.token = "";
          state.pan.config.tokenExpiresAt = 0;
          await persistPanConfigQuietly();
        }
        if (isPanSearchSessionActive(item, token, currentSessionId)) {
          state.pan.lastFailureKind = failureKind;
          state.pan.retryRemaining = 0;
          state.pan.finalFailure = false;
          setPanStatus("更新失败");
          if (round < total) {
            setPanProgress(true, "polling", round, total);
            if (!state.pan.results.length && isPanSearchActive()) renderPanResults();
          } else {
            finishPanPolling(token, item, total, { sessionId: currentSessionId, failureKind });
          }
        }
      } finally {
        if (isPanSearchSessionActive(item, token, currentSessionId) && round >= total) finishPanPolling(token, item, total, { sessionId: currentSessionId });
      }
    }

    function normalizePanResults(merged, keyword) {
      const config = state.pan.config || defaultPanConfig();
      const enabled = new Set((config.diskTypes || []).map(normalizePanDiskType));
      const seen = new Set();
      const items = [];
      Object.entries(merged || {}).forEach(([type, links]) => {
        const diskType = normalizePanDiskType(type);
        if (!enabled.has(diskType) || !Array.isArray(links)) return;
        links.forEach((link, index) => {
          const url = String(link && (link.url || link.link || link.href) || "").trim();
          if (!url) return;
          const key = `${diskType}|${normalizePanUrl(url)}`;
          if (seen.has(key)) return;
          seen.add(key);
          items.push({
            key,
            diskType,
            url,
            password: String(link.password || link.pwd || link.passcode || link.code || "").trim(),
            title: String(link.note || link.name || link.title || link.work_title || keyword || "盘搜资源").trim(),
            source: String(link.source || link.channel || link.plugin || "").trim(),
            provider: String(link.provider || link.panProvider || link.pan_provider || "").trim(),
            fileName: String(link.fileName || link.file_name || link.filename || "").trim(),
            fileId: String(link.fileId || link.file_id || "").trim(),
            resourceId: String(link.resourceId || link.resource_id || link.resourceID || "").trim(),
            datetime: String(link.datetime || link.time || link.created_at || "").trim(),
            normalizedUrl: String(link.normalized_url || link.normalizedUrl || "").trim(),
            remark: String(link.remark || link.remarks || link.description || "").trim(),
            year: String(link.year || link.releaseYear || link.release_year || "").trim(),
            yearTrusted: link.yearTrusted === true || link.year_trusted === true,
            panServerDiskRank: Math.max(0, Number(index || 0)),
            panSnapshotSeq: 0,
            panSnapshotIndex: index,
            index: items.length + index / 1000
          });
        });
      });
      return items;
    }

