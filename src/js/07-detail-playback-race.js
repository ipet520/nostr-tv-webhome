    function syncDetailMode(item, historyOverride, options) {
      const candidate = historyOverride === undefined ? findDetailContinueHistory(item) : historyOverride;
      const history = detailAuthoritativeNativeHistoryFor(item, candidate, options);
      state.detailMode = history ? "CONTINUE" : "FIRST_PLAY";
      state.detailModeItemKey = item ? panSearchItemKey(item) : "";
      state.detailHistory = history;
      const pending = typeof _directPlayPending !== "undefined" ? _directPlayPending : null;
      if (pending && pending.item === item) {
        pending.history = history;
        pending.episodeTarget = history ? detailContinuePlaybackTargetFor(item, history) : null;
        if (pending.episodeTarget) setDetailPlaybackTarget(item, pending.episodeTarget);
      }
      return state.detailMode;
    }

    function recordDetailPlaybackLifecycle(run, event, detail) {
      const session = Number(run && run.token || 0);
      if (!session) return;
      const suffix = detail ? ` ${String(detail)}` : "";
      try { console.info(`[AutoPlayback] session=${session} ${String(event || "")}${suffix}`); } catch (e) {}
    }

    function detailPlaybackCurrentOrRecord(run) {
      if (detailPlaybackIsCurrent(run)) return true;
      if (run && !run.staleLogged) {
        run.staleLogged = true;
        recordDetailPlaybackLifecycle(run, "stale result ignored");
      }
      return false;
    }

    function detailRaceCandidateLabel(candidate) {
      if (!candidate) return "";
      return String(
        candidate.resourceTitle
        || candidate.sourceEntryTitle
        || candidate.title
        || candidate.fileName
        || candidate.file_name
        || candidate.url
        || ""
      ).slice(0, 160);
    }

    function recordDetailRaceDiag(event, run, detail) {
      const payload = Object.assign({
        event: String(event || ""),
        runId: run && Number(run.seq || run.token || 0) || "",
        itemKey: run && String(run.itemKey || "") || ""
      }, detail || {});
      try {
        if (state.tvDiag) {
          const log = Array.isArray(state.tvDiag.detailRaceLog) ? state.tvDiag.detailRaceLog : [];
          log.push(payload);
          if (log.length > 60) log.splice(0, log.length - 60);
          state.tvDiag.detailRaceLog = log;
          state.tvDiag.detailRace = payload;
        }
      } catch (e) {}
      try { console.debug("[Nostr TV] " + String(event || "DETAIL_RACE"), payload); } catch (e) {}
      try { updateTvDiagnostic(); } catch (e) {}
      return payload;
    }

    function detailRaceResolveCompletion(run, value) {
      if (!run || run.raceCompletionResolved) return false;
      run.raceCompletionResolved = true;
      if (typeof run.resolveRaceCompletion === "function") {
        run.resolveRaceCompletion(value || null);
      }
      return true;
    }

    function detailRaceHandoffCommittedProvider(run) {
      if (!run || !run.providerCommitted || !run.playRequested || run.handoffDispatching) return false;
      if (!detailPlaybackIsCurrent(run) || run.cancelled || run.handoffStarted) return false;
      run.handoffDispatching = true;
      const item = run.item;
      const button = $("detailContinueBtn");
      const candidate = run.candidate;
      run.handoffPromise = (async () => {
        if (run.provider === "pan-direct" && run.historyPromise) {
          await run.historyPromise.catch(() => null);
          if (!detailPlaybackIsCurrent(run) || run.cancelled) return false;
        }
        return run.provider === "curated"
          ? playPreparedDetailCandidate(item, candidate, button)
          : playDetailDirectReadyCandidate(item, candidate, run.history || state.detailHistory, button);
      })().catch(() => false).then((result) => {
        run.handoffDispatching = false;
        return result;
      });
      return true;
    }

    function terminalizeDirectDiscoveryAfterProviderCommit(run, provider) {
      const pan = state.pan;
      const action = run && run.directAction;
      if (action) {
        action.cancelReason = "provider_committed";
        action.waitResult = "CANCELLED";
      }
      const sameDirectSession = !!(run && pan && state.selected === run.item
        && pan.sessionItemKey === run.itemKey
        && pan.sessionOrigin === "direct"
        && pan.searchMode === "direct"
        && Number(pan.sessionId || 0) > 0
        && pan.viewToken);
      if (!sameDirectSession) return false;
      clearPanPollTimers();
      if (isPanSearchSessionCurrent(run.item, pan.viewToken, pan.sessionId, true)) {
        terminalizePanSearchSession(pan.viewToken, run.item, pan.sessionId, "provider_committed", { render: false });
      } else {
        pan.loading = false;
        pan.retryRemaining = 0;
        if (!pan.sessionTerminal) endPanSearchSession("provider_committed");
      }
      recordDetailRaceDiag("DIRECT_DISCOVERY_TERMINATED", run, {
        provider: String(provider || run.provider || ""),
        reason: "PROVIDER_COMMITTED"
      });
      return true;
    }

    function tryCommitDetailProvider(run, provider, candidate, details) {
      const info = details || {};
      const normalizedProvider = String(provider || "");
      const identityVerdict = String(
        info.identityVerdict
        || candidate && (candidate.identityVerdict || candidate.candidateVerdict)
        || ""
      ).toUpperCase();
      const healthState = String(info.healthState || candidate && candidate.healthAdmission || "").toLowerCase();
      const healthAccepted = info.healthAccepted === true
        || info.healthState === "ok"
        || ["ok", "unsupported"].includes(healthState)
        || !!(candidate && panAutoHealthAdmission(candidate, {}).accepted);
      const finalTentative = info.allowTentativeFinal === true
        && identityVerdict === "TENTATIVE"
        && !!(run && run.curatedTerminal && run.directTerminal);
      if (!run || !candidate || !["curated", "pan-direct"].includes(normalizedProvider)
        || !healthAccepted || identityVerdict !== "STRONG" && !finalTentative) {
        return false;
      }
      const mediaVerdict = automaticVideoCandidateVerdict(run.item, candidate);
      if (!mediaVerdict.accepted) {
        recordAutomaticMediaRejected(normalizedProvider, info.sourceId || candidate.source || candidate.provider, candidate, mediaVerdict);
        return false;
      }
      if (!detailPlaybackIsCurrent(run) || run.cancelled) return false;
      if (run.providerCommitted) {
        recordDetailRaceDiag("PROVIDER_COMMIT_REJECTED", run, {
          lateProvider: normalizedProvider,
          winnerProvider: String(run.provider || ""),
          elapsedMs: Math.max(0, Date.now() - Number(run.raceStartedAt || Date.now()))
        });
        return false;
      }
      run.providerCommitted = true;
      run.providerCommitCount = Number(run.providerCommitCount || 0) + 1;
      run.provider = normalizedProvider;
      run.sourceId = String(info.sourceId || candidate.sourceId || run.sourceId || "");
      run.candidate = candidate;
      run.commitAt = Date.now();
      run.phase = "READY";
      run.raceActive = false;
      run.raceFinalized = true;
      recordDetailRaceDiag("PROVIDER_COMMIT", run, {
        provider: normalizedProvider,
        elapsedMs: Math.max(0, run.commitAt - Number(run.raceStartedAt || run.commitAt)),
        candidateLabel: detailRaceCandidateLabel(candidate),
        playRequested: !!run.playRequested,
        identityVerdict,
        healthState: healthState || "accepted",
        commitCount: run.providerCommitCount
      });
      terminalizeDirectDiscoveryAfterProviderCommit(run, normalizedProvider);
      settleDetailPlayback(run, "READY", "provider_commit");
      showDirectPlayStatus(run.token, "READY", DIRECT_PLAY_STATUS_TEXT.READY, "provider_commit");
      updateDetailContinueButton();
      detailRaceResolveCompletion(run, candidate);
      detailRaceHandoffCommittedProvider(run);
      return true;
    }

    function detailRaceLaneTerminal(run, lane, tentative, reason, details) {
      if (!run || !detailPlaybackIsCurrent(run) || run.cancelled) return false;
      if (run.providerCommitted) return false;
      const normalizedLane = lane === "curated" ? "curated" : "direct";
      const terminalKey = normalizedLane === "curated" ? "curatedTerminal" : "directTerminal";
      if (run[terminalKey]) return false;
      run[terminalKey] = true;
      const safeTentative = tentative && automaticVideoCandidateVerdict(run.item, tentative).accepted
        ? tentative
        : null;
      if (tentative && !safeTentative) {
        recordAutomaticMediaRejected(normalizedLane === "curated" ? "curated" : "pan-direct", tentative.source || tentative.provider, tentative, automaticVideoCandidateVerdict(run.item, tentative));
      }
      if (normalizedLane === "curated") {
        run.curatedTentative = safeTentative;
        run.curatedFailure = String(reason || "");
      } else {
        run.directTentative = safeTentative;
        run.directFailureType = ["NO_RESOURCE", "CONNECTION_FAILED"].includes(String(reason || ""))
          ? String(reason) : run.directFailureType || "";
      }
      const event = normalizedLane === "curated" ? "CURATED_RACE_TERMINAL" : "DIRECT_RACE_TERMINAL";
      recordDetailRaceDiag(event, run, Object.assign({
        elapsedMs: Math.max(0, Date.now() - Number(run.raceStartedAt || Date.now())),
        reason: String(reason || ""),
        candidateLabel: detailRaceCandidateLabel(safeTentative),
        identityVerdict: String(safeTentative && safeTentative.identityVerdict || ""),
        healthState: String(safeTentative && safeTentative.healthAdmission || "")
      }, details || {}));
      if (!(run.curatedTerminal && run.directTerminal) || run.providerCommitted) return true;
      const fallback = run.curatedTentative || run.directTentative;
      if (fallback) {
        const fallbackProvider = run.curatedTentative ? "curated" : "pan-direct";
        if (tryCommitDetailProvider(run, fallbackProvider, fallback, {
          allowTentativeFinal: true,
          sourceId: fallback.sourceId,
          identityVerdict: String(fallback.identityVerdict || "TENTATIVE"),
          healthState: String(fallback.healthAdmission || ""),
          healthAccepted: true
        })) return true;
      }
      run.raceFinalized = true;
      run.raceActive = false;
      const finalFailure = run.directFailureType || detailDirectFailureTypeAfterPrepare() || "NO_RESOURCE";
      recordDetailRaceDiag("DETAIL_RACE_FINAL_FAILURE", run, {
        elapsedMs: Math.max(0, Date.now() - Number(run.raceStartedAt || Date.now())),
        failureType: finalFailure
      });
      settleDetailPlayback(run, finalFailure, "detail_race_final_failure");
      if (run.playRequested) notifyCurrentDetailFinalFailure(run, finalFailure);
      updateDetailContinueButton();
      detailRaceResolveCompletion(run, null);
      return true;
    }

    function reportDetailDirectRaceResult(action, candidate, reason, details) {
      if (!action || !action.raceMode || !action.detailRun) return false;
      const run = action.detailRun;
      if (!detailPlaybackIsCurrent(run) || run.providerCommitted || run.cancelled) return false;
      const item = action.item;
      const identityVerdict = String(candidate && candidate.identityVerdict || details && details.identityVerdict || "").toUpperCase();
      if (candidate && identityVerdict === "STRONG") {
        const mediaVerdict = automaticVideoCandidateVerdict(item, candidate);
        if (!mediaVerdict.accepted) {
          recordAutomaticMediaRejected("pan-direct", candidate.source || candidate.provider, candidate, mediaVerdict);
          return detailRaceLaneTerminal(run, "direct", null, "AUTOMATIC_MEDIA_REJECTED", details);
        }
        const admission = panAutoHealthAdmission(candidate, {});
        if (admission.accepted) {
          recordDetailRaceDiag("DIRECT_QUALIFIED_READY", run, {
            elapsedMs: Math.max(0, Date.now() - Number(run.raceStartedAt || Date.now())),
            identityVerdict,
            healthState: String(admission.state || ""),
            candidateLabel: detailRaceCandidateLabel(candidate)
          });
          return tryCommitDetailProvider(run, "pan-direct", candidate, {
            identityVerdict,
            healthState: admission.state,
            healthAccepted: true
          });
        }
      }
      return detailRaceLaneTerminal(run, "direct", candidate && identityVerdict === "TENTATIVE" ? candidate : null, reason || "NO_QUALIFIED_CANDIDATE", details);
    }

    function settleDetailPlayback(run, result, reason) {
      if (!detailPlaybackCurrentOrRecord(run)) return false;
      const finalResult = String(result || "NO_RESOURCE");
      run.active = false;
      run.phase = finalResult;
      run.settledResult = finalResult;
      recordDetailPlaybackLifecycle(run, "settled", `result=${finalResult}`);
      if (finalResult !== "READY") {
        const status = state.directPlayStatus || {};
        const statusId = Number(status.actionId || (run.directAction && run.directAction.token) || run.token || 0);
        clearDirectPlayStatus(statusId, reason || "detail_prepare_settled");
      }
      return true;
    }

    function settleDetailUnreleased(item, reason) {
      const info = detailUnreleasedInfo(item);
      if (!info.unreleased) return false;
      const run = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        && state.detailPlayback.item === item ? state.detailPlayback : null;
      if (run) {
        run.error = "";
        run.playRequested = false;
        run.unreleasedInfo = info;
        clearDirectPlayStatus(0, reason || "unreleased_gate");
        settleDetailPlayback(run, "UNRELEASED", reason || "unreleased_gate");
      }
      return !!run;
    }

    function cancelDetailPlaybackPreparation(reason) {
      const run = state.detailPlayback;
      if (!run) return false;
      const cancelReason = String(reason || "detail_prepare_cancelled");
      const diagnosticReason = cancelReason === "detail_closed" ? "detail-close" : cancelReason;
      if (!run.cancelled) recordDetailPlaybackLifecycle(run, "CANCELLED", diagnosticReason);
      run.cancelled = true;
      run.active = false;
      run.playRequested = false;
      run.phase = "CANCELLED";
      run.settledResult = "CANCELLED";
      run.cancelReason = cancelReason;
      run.error = cancelReason;
      detailRaceResolveCompletion(run, null);
      if (run.directAction && typeof _directPlayPending !== "undefined" && _directPlayPending === run.directAction) {
        cancelPendingDirectPlay(cancelReason);
      }
      run.directAction = null;
      // 把关闭/切换后的 run 从当前详情上下文摘除；旧异步任务只能落入 stale guard，
      // 不能再把结果写回重新打开的详情页。
      if (state.detailPlayback === run) state.detailPlayback = null;
      return true;
    }

    async function verifyDetailNativeHistory(item, run) {
      let history = null;
      try {
        await loadHistoryContextIndex();
        await loadContinueIndex();
        const rawList = await sdk().history();
        const normalized = normalizeHistoryList(rawList);
        const winner = recentNativeHistoryWinnerFor(item, normalized);
        history = winner && detailHasAuthoritativeNativeHistory(winner)
          && detailHistoryMatches(item, winner) ? winner : null;
      } catch (e) {
        history = null;
      }
      if (!detailPlaybackIsCurrent(run)) return null;
      if (run && run.continueHistoryGateTimedOut) return null;
      run.historyVerified = true;
      run.history = history;
      syncDetailMode(item, history, { freshNative: true });
      if (history) {
        const target = detailContinuePlaybackTargetFor(item, history);
        if (target) setDetailPlaybackTarget(item, target);
      }
      updateDetailContinueButton();
      return history;
    }

    async function verifyDetailNativeHistoryWithDeadline(item, run) {
      let timer = 0;
      let timedOut = false;
      const verifyTask = Promise.resolve()
        .then(() => verifyDetailNativeHistory(item, run))
        .then((history) => ({ timedOut: false, history }), () => ({ timedOut: false, history: null }));
      const timeoutTask = new Promise((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          if (run) run.continueHistoryGateTimedOut = true;
          resolve({ timedOut: true, history: null });
        }, DETAIL_NATIVE_HISTORY_GATE_MAX_MS);
      });
      try {
        const result = await Promise.race([verifyTask, timeoutTask]);
        if (!timedOut && run) run.continueHistoryGateResolved = true;
        return result || { timedOut: false, history: null };
      } finally {
        clearTimeout(timer);
      }
    }

    function detailPreparedCandidateFor(item) {
      const run = state.detailPlayback;
      const candidate = run && detailPlaybackIsCurrent(run) && run.candidate;
      if (!candidate) return null;
      const mediaVerdict = automaticVideoCandidateVerdict(item, candidate);
      if (!mediaVerdict.accepted) {
        recordAutomaticMediaRejected(run.provider || "detail", run.sourceId || candidate.source || candidate.provider, candidate, mediaVerdict);
        run.candidate = null;
        run.error = "automatic_media_rejected";
        updateDetailContinueButton();
        return null;
      }
      // Curated/direct candidates只有在本次详情生命周期内通过自动健康准入后才可 Ready。
      const admission = panAutoHealthAdmission(candidate, {});
      if (!admission.accepted) {
        run.candidate = null;
        run.error = admission.state === "bad" ? "fresh_bad_candidate" : "health_unconfirmed_candidate";
        updateDetailContinueButton();
        return null;
      }
      return candidate;
    }

    async function playPreparedDetailCandidate(item, candidate, button) {
      const run = state.detailPlayback;
      if (!run || !detailPlaybackIsCurrent(run) || !candidate) return false;
      if (run.handoffStarted) return false;
      run.handoffStarted = true;
      run.playRequested = false;
      run.candidate = null;
      showDirectPlayStatus(run.token, "STARTING_PLAYER", "正在启动播放器…", "native_handoff_start");
      if (!run.history && run.historyPromise) {
        await run.historyPromise.catch(() => null);
        if (!detailPlaybackIsCurrent(run)) return false;
      }
      const history = run.history || state.detailHistory;
      const episodeTarget = history
        ? detailContinuePlaybackTargetFor(item, history)
        : currentPlaybackTargetForItem(item);
      if (episodeTarget) setDetailPlaybackTarget(item, episodeTarget);
      // 预检可能在等待 Native History 的期间晚到；handoff 前必须再读一次当前鲜活状态。
      const handoffAdmission = panAutoHealthAdmission(candidate, {});
      const handoffMediaVerdict = automaticVideoCandidateVerdict(item, candidate);
      if (!handoffMediaVerdict.accepted) {
        recordAutomaticMediaRejected(run.provider || "detail", run.sourceId || candidate.source || candidate.provider, candidate, handoffMediaVerdict);
        run.error = "automatic_media_rejected_at_native_handoff";
        run.active = false;
        run.handoffStarted = false;
        showDirectPlayStatus(run.token, "FINAL_ERROR", DIRECT_PLAY_STATUS_TEXT.FINAL_ERROR, run.error);
        updateDetailContinueButton();
        return false;
      }
      if (!handoffAdmission.accepted) {
        run.error = handoffAdmission.state === "bad" ? "fresh_bad_at_native_handoff" : "health_unconfirmed_at_native_handoff";
        run.active = false;
        run.handoffStarted = false;
        showDirectPlayStatus(run.token, "FINAL_ERROR", DIRECT_PLAY_STATUS_TEXT.FINAL_ERROR, run.error);
        updateDetailContinueButton();
        // 让现有详情准备入口继续做下一站/Direct fallback，不把已失效资源送进播放器。
        const retryOptions = { reason: handoffAdmission.state === "bad" ? "curated_late_bad" : "curated_health_unconfirmed", playRequested: true };
        prepareDetailPlayback(item, retryOptions);
        return false;
      }
      if (button) rememberDetailReturn(button);
      await playPanResult(candidate, {
        prechecked: true,
        episodeTarget,
        historyResume: !!history
      });
      armDirectPlayStatusUiFallback(run.token);
      return true;
    }

    function prepareDetailPlayback(item, options) {
      const opts = options || {};
      const previous = state.detailPlayback || {};
      const continueGate = opts.continueGate === true;
      cancelDetailPlaybackPreparation("new_detail_prepare");
      const canonicalStartedAt = Number(opts.canonicalStartedAt || Date.now());
      let canonicalPromise = opts.canonicalPromise;
      if (!canonicalPromise) {
        if (canonicalResourceKey(item)) {
          try {
            canonicalPromise = Promise.resolve(resolveCanonicalResourceTitle(item)).catch(() => item);
          } catch (e) {
            canonicalPromise = Promise.resolve(item);
          }
        } else {
          canonicalPromise = Promise.resolve(item);
        }
      }
      const run = {
        seq: Number(previous.seq || 0) + 1,
        // 复用 Direct 状态使用的单调数字 token，保证诊断/状态提示不会被字符串 token 丢弃，
        // 也避免 curated 准备与后续 playBestQuark action 发生状态 ID 冲突。
        token: ++_directPlayActionSeq,
        item,
        itemKey: panSearchItemKey(item),
        canonicalPromise: null,
        canonicalStartedAt,
        canonicalResolved: false,
        canonicalSuccess: false,
        historyGateStartedAt: 0,
        historyGateDone: !continueGate,
        active: true,
        promise: null,
        candidate: null,
        sourceId: "",
        provider: "",
        playRequested: !!opts.playRequested,
        handoffStarted: false,
        history: null,
        historyVerified: false,
        episodeTarget: null,
        directAction: null,
        error: "",
        reason: String(opts.reason || "detail_prepare"),
        preparationStarted: false,
        phase: "CONTINUE_GATE",
        settledResult: "",
        finalFailureNotified: false,
        curatedSummarySent: false,
        cancelled: false,
        cancelReason: "",
        staleLogged: false,
        continuePending: continueGate,
        continueDecisionPromise: null,
        continueResource: null,
        continueResourcePromise: null,
        continueHistoryGateTimedOut: false,
        continueHistoryGateResolved: false,
        raceActive: false,
        raceStartedAt: 0,
        raceCompletionResolved: false,
        resolveRaceCompletion: null,
        raceFinalized: false,
        raceActionToken: 0,
        providerCommitted: false,
        providerCommitCount: 0,
        commitAt: 0,
        curatedTerminal: false,
        directTerminal: false,
        curatedTentative: null,
        directTentative: null,
        curatedFailure: "",
        directFailureType: "",
        handoffDispatching: false,
        handoffPromise: null
      };
      state.detailPlayback = run;
      recordDetailPlaybackLifecycle(run, "START");
      recordDetailRaceDiag("DETAIL_CANONICAL_START", run, {
        mediaType: String(item && item.mediaType || ""),
        tmdbId: String(item && item.tmdbId || "")
      });
      run.canonicalPromise = Promise.resolve(canonicalPromise).then((value) => {
        run.canonicalResolved = true;
        run.canonicalSuccess = true;
        const canonicalEntry = canonicalResourceKey(item) && canonicalResourceTitleCache.has(canonicalResourceKey(item))
          ? canonicalResourceCacheEntry(canonicalResourceTitleCache.get(canonicalResourceKey(item)))
          : null;
        recordDetailRaceDiag("DETAIL_CANONICAL_DONE", run, {
          elapsedMs: Math.max(0, Date.now() - canonicalStartedAt),
          success: true,
          authority: canonicalEntry && canonicalEntry.authority === "EXACT_DETAIL"
            ? "EXACT_DETAIL"
            : "ITEM_FALLBACK"
        });
        return value || item;
      }, () => {
        run.canonicalResolved = true;
        run.canonicalSuccess = false;
        recordDetailRaceDiag("DETAIL_CANONICAL_DONE", run, {
          elapsedMs: Math.max(0, Date.now() - canonicalStartedAt),
          success: false,
          authority: "ITEM_FALLBACK"
        });
        return item;
      });
      run.promise = (async () => {
        let continueDecision = null;
        if (run.continuePending) {
          run.historyGateStartedAt = Date.now();
          run.continueDecisionPromise = (async () => {
            const historyDecision = await verifyDetailNativeHistoryWithDeadline(item, run);
            const verifiedHistory = historyDecision && historyDecision.history;
            if (!detailPlaybackCurrentOrRecord(run)) return null;

            // Native History 独立决定 CONTINUE/FIRST_PLAY；续播资源上下文只负责
            // 判断旧线路能否直接复用，不能因为没有 lastPlayUrl/provider 就跳过历史核验。
            const timedOutHistory = !verifiedHistory
              && historyDecision
              && historyDecision.timedOut
              && state.detailMode === "CONTINUE"
              && state.detailModeItemKey === panSearchItemKey(item)
              && detailContinueHistoryIsValid(state.detailHistory)
              && detailHistoryMatches(item, state.detailHistory)
              ? state.detailHistory
              : null;
            const history = verifiedHistory || timedOutHistory;
            if (history && detailContinueHistoryIsValid(history)) {
              const resourcePromise = resolveDetailContinueResource(item, run).catch(() => null);
              return {
                attempted: true,
                resource: null,
                resourcePromise,
                history,
                timedOut: !!(historyDecision && historyDecision.timedOut)
              };
            }

            const localResource = await resolveDetailContinueResource(item, run);
            if (!localResource) return { attempted: false, resource: null, history: null };
            return {
              attempted: true,
              resource: detailContinueResourceContextFor(item, verifiedHistory) || localResource,
              history: verifiedHistory,
              timedOut: !!(historyDecision && historyDecision.timedOut)
            };
          })();
          continueDecision = await run.continueDecisionPromise.catch(() => null);
          run.historyGateDone = true;
          recordDetailRaceDiag("DETAIL_HISTORY_GATE_DONE", run, {
            elapsedMs: Math.max(0, Date.now() - Number(run.historyGateStartedAt || Date.now())),
            historyFound: !!(continueDecision && continueDecision.history),
            timedOut: !!(continueDecision && continueDecision.timedOut)
          });
          run.continuePending = false;
          if (!detailPlaybackCurrentOrRecord(run)) return null;
          if (continueDecision && detailContinueHistoryIsValid(continueDecision.history)) {
            run.continueResource = continueDecision.resource || null;
            run.continueResourcePromise = continueDecision.resourcePromise || null;
            run.history = continueDecision.history;
            run.historyVerified = true;
            const progressTarget = detailContinuePlaybackTargetFor(item, continueDecision.history);
            if (progressTarget) setDetailPlaybackTarget(item, progressTarget);
            syncDetailMode(item, continueDecision.history, { freshNative: true });
            recordDetailPlaybackDecision("DETAIL_OPEN_PLAYBACK_DECISION", item, {
              continueContextFound: !!(continueDecision.resource && continueDecision.resource.contextFound),
              continueUrlFound: !!continueDecision.resource,
              nativeHistoryKnown: true,
              nativeProgress: historyPlaybackPositionValue(continueDecision.history),
              decision: "CONTINUE_READY",
              curatedStarted: false
            });
            settleDetailPlayback(run, "CONTINUE_READY", "continue_ready");
            updateDetailContinueButton();
            if (run.continueResourcePromise) run.continueResourcePromise.then((resource) => {
              if (!detailPlaybackCurrentOrRecord(run) || run.history !== continueDecision.history) return;
              run.continueResource = resource || null;
            }).catch(() => {});
            return null;
          }
        }
        await run.canonicalPromise.catch(() => item);
        if (!detailPlaybackCurrentOrRecord(run)) return null;
        recordDetailRaceDiag("DETAIL_FIRST_PLAY_BARRIER_RELEASED", run, {
          elapsedMs: Math.max(0, Date.now() - Number(run.canonicalStartedAt || Date.now())),
          historyGateDone: !!run.historyGateDone,
          canonicalDone: !!run.canonicalResolved
        });
        const knownNativeHistory = state.detailMode === "CONTINUE"
          && state.detailModeItemKey === panSearchItemKey(item)
          && detailContinueHistoryIsValid(state.detailHistory)
          && detailHistoryMatches(item, state.detailHistory);
        const unreleased = detailUnreleasedInfo(item);
        if (unreleased.unreleased && !knownNativeHistory) {
          recordDetailPlaybackDecision("DETAIL_OPEN_PLAYBACK_DECISION", item, {
            continueContextFound: !!(continueDecision && continueDecision.attempted),
            continueUrlFound: false,
            nativeHistoryKnown: !!(continueDecision && continueDecision.history),
            nativeProgress: continueDecision && continueDecision.history
              ? historyPlaybackPositionValue(continueDecision.history) : 0,
            decision: "UNRELEASED",
            unreleasedDate: unreleased.date,
            curatedStarted: false
          });
          settleDetailUnreleased(item, "unreleased_gate");
          updateDetailContinueButton();
          return null;
        }
        run.preparationStarted = true;
        run.phase = "PREPARING";
        recordDetailPlaybackDecision("DETAIL_OPEN_PLAYBACK_DECISION", item, {
          continueContextFound: !!(continueDecision && continueDecision.attempted),
          continueUrlFound: false,
          nativeHistoryKnown: !!(continueDecision && continueDecision.history),
          nativeProgress: continueDecision && continueDecision.history
            ? historyPlaybackPositionValue(continueDecision.history) : 0,
          decision: "FIRST_PLAY_PREPARE",
          curatedStarted: true
        });
        showDirectPlayStatus(run.token, "BACKGROUND_PREPARING", DIRECT_PLAY_STATUS_TEXT.BACKGROUND_PREPARING, "detail_prepare_start");
        run.historyPromise = continueDecision && continueDecision.attempted
          ? Promise.resolve(continueDecision.history)
          : verifyDetailNativeHistory(item, run).catch(() => null);
        run.raceActive = true;
        run.raceStartedAt = Date.now();
        run.phase = "PREPARING";
        run.raceCompletionPromise = new Promise((resolve) => { run.resolveRaceCompletion = resolve; });
        recordDetailRaceDiag("DETAIL_RACE_START", run, {
          startedAt: run.raceStartedAt,
          playRequested: !!run.playRequested
        });

        recordDetailRaceDiag("CURATED_RACE_START", run, {
          startedAt: run.raceStartedAt,
          discoveryWindowMs: CURATED_DISCOVERY_WINDOW_MS,
          qualityGraceMs: CURATED_QUALITY_GRACE_MS
        });
        run.curatedTask = Promise.resolve()
          .then(() => resolveCuratedPlaybackCandidate(item, run))
          .then((curated) => {
            if (!detailPlaybackIsCurrent(run) || run.providerCommitted || run.cancelled) return null;
            if (curated && curated.candidate) {
              const candidate = curated.candidate;
              const identityVerdict = String(curated.identityVerdict || candidate.identityVerdict || candidate.candidateVerdict || "STRONG").toUpperCase();
              const admission = panAutoHealthAdmission(candidate, {});
              if (identityVerdict === "STRONG" && admission.accepted) {
                recordDetailRaceDiag("CURATED_QUALIFIED_READY", run, {
                  elapsedMs: Math.max(0, Date.now() - Number(run.raceStartedAt || Date.now())),
                  identityVerdict,
                  healthState: String(admission.state || candidate.healthAdmission || ""),
                  candidateLabel: detailRaceCandidateLabel(candidate)
                });
                tryCommitDetailProvider(run, "curated", candidate, {
                  sourceId: curated.sourceId,
                  identityVerdict,
                  healthState: admission.state,
                  healthAccepted: true
                });
                return candidate;
              }
              return detailRaceLaneTerminal(run, "curated", identityVerdict === "TENTATIVE" ? candidate : null, "NO_QUALIFIED_CANDIDATE");
            }
            return detailRaceLaneTerminal(run, "curated", null, "NO_QUALIFIED_CANDIDATE");
          }, (error) => {
            if (detailPlaybackIsCurrent(run) && !run.providerCommitted && !run.cancelled) {
              run.error = String(error && error.message || error || "curated_failed");
              detailRaceLaneTerminal(run, "curated", null, "CURATED_FAILED");
            }
            return null;
          });

        recordDetailRaceDiag("DIRECT_RACE_START", run, {
          startedAt: run.raceStartedAt,
          origin: "direct",
          mode: "direct",
          prepareOnly: true
        });
        run.phase = "PAN_DIRECT";
        const directTask = playBestQuark(item, {
          detailPrimary: true,
          suppressAutoPan: true,
          mode: "direct",
          origin: "direct",
          prepareOnly: true,
          playRequested: false,
          raceMode: true
        });
        run.directAction = typeof _directPlayPending !== "undefined" && _directPlayPending && _directPlayPending.item === item
          ? _directPlayPending
          : null;
        run.directTask = Promise.resolve(directTask).catch((error) => {
          if (detailPlaybackIsCurrent(run) && !run.providerCommitted && !run.cancelled) {
            run.error = String(error && error.message || error || "direct_failed");
            reportDetailDirectRaceResult(run.directAction, null, "DIRECT_FAILED");
          }
          return null;
        });
        return await run.raceCompletionPromise;
      })().catch((error) => {
        if (detailPlaybackCurrentOrRecord(run)) {
          run.error = String(error && error.message || error || "detail_prepare_failed");
          settleDetailPlayback(run, "CONNECTION_FAILED", "detail_prepare_failed");
          if (run.playRequested) notifyCurrentDetailFinalFailure(run, "CONNECTION_FAILED");
          updateDetailContinueButton();
        }
        return null;
      });
      return run.promise;
    }

    function detailDirectPlayCandidateKey(candidate) {
      if (!candidate) return "";
      const url = String(candidate.url || "").trim();
      return url ? panHealthKey(candidate) : String(candidate.key || candidate.title || "").trim();
    }

    function detailDirectFailureTypeFor(item, lifecycle) {
      const pan = state.pan || {};
      const current = lifecycle || getPanSearchLifecycleFor(item);
      const failure = pan.directFailure;
      if (!item || !failure || !current.sameSession || current.origin !== "direct") return "";
      if (failure.itemKey !== panSearchItemKey(item)
        || Number(failure.sessionId || 0) !== Number(current.sessionId || 0)) return "";
      return ["NO_RESOURCE", "CONNECTION_FAILED"].includes(String(failure.type || ""))
        ? String(failure.type)
        : "";
    }

    function setDetailDirectFailureType(item, type, lifecycle) {
      const pan = state.pan || {};
      const current = lifecycle || getPanSearchLifecycleFor(item);
      const failureType = ["NO_RESOURCE", "CONNECTION_FAILED"].includes(String(type || ""))
        ? String(type)
        : "";
      if (!item || !current.sameSession || current.origin !== "direct") {
        pan.directFailure = null;
        return "";
      }
      pan.directFailure = failureType ? {
        itemKey: panSearchItemKey(item),
        sessionId: Number(current.sessionId || 0),
        type: failureType
      } : null;
      return failureType;
    }

    function detailDirectFailureTypeAfterPrepare() {
      const pan = state.pan || {};
      const initialState = String(pan.initialResultState || "");
      const receivedValidResponse = !!(pan.initialSucceeded
        && /^(?:success)(?:_|$)/.test(initialState)
        && !pan.directTransportExhausted);
      return receivedValidResponse ? "NO_RESOURCE" : "CONNECTION_FAILED";
    }

    function detailDirectFailureMessage(type) {
      return String(type || "") === "CONNECTION_FAILED"
        ? "连接失败，请手动重试，或尝试聚搜、盘搜"
        : "暂无可播放资源，可尝试聚搜或盘搜";
    }

    function detailDirectReadyCandidateFor(item, ready) {
      if (!item || !ready || !ready.candidateKey) return null;
      const selected = ready.candidate;
      if (selected && detailDirectPlayCandidateKey(selected) === ready.candidateKey) return selected;
      return (state.pan && Array.isArray(state.pan.results) ? state.pan.results : [])
        .find((candidate) => detailDirectPlayCandidateKey(candidate) === ready.candidateKey) || null;
    }

    function detailDirectPlayReadyFor(item) {
      if (!item) return false;
      const detailRun = state.detailPlayback;
      if (detailRun && detailPlaybackIsCurrent(detailRun)
        && ["NO_RESOURCE", "CONNECTION_FAILED", "CANCELLED"].includes(String(detailRun.phase || ""))) return false;
      if (detailRun && detailPlaybackIsCurrent(detailRun)
        && detailRun.raceActive && !detailRun.providerCommitted) return false;
      if (detailPreparedCandidateFor(item)) return true;
      const pan = state.pan || {};
      const lifecycle = getPanSearchLifecycleFor(item);
      const phase = String(lifecycle.phase || "");
      const terminalReason = String(lifecycle.terminalReason || "").toUpperCase();
      const failedTerminal = ["complete-empty", "initial-failed", "session-timeout", "error"].includes(phase)
        || ["TERMINAL_NO_QB", "WAIT_BUDGET_EXPIRED"].includes(terminalReason)
        || lifecycle.transportExhausted
        || !!pan.finalFailure
        || !!pan.directTransportExhausted;
      if (!lifecycle.sameSession || lifecycle.origin !== "direct" || String(pan.searchMode || "") !== "direct" || failedTerminal) return false;
      const ready = pan.directReady;
      if (!ready || ready.itemKey !== panSearchItemKey(item)
        || Number(ready.sessionId || 0) !== Number(lifecycle.sessionId || 0)
        || !ready.candidateKey) return false;
      const candidate = detailDirectReadyCandidateFor(item, ready);
      if (!candidate) return false;
      const identity = panAutoIdentityVerdict(item, candidate);
      if (identity.verdict === "REJECT") return false;
      const mediaVerdict = automaticVideoCandidateVerdict(item, candidate);
      if (!mediaVerdict.accepted) {
        recordAutomaticMediaRejected("pan-direct", candidate.source || candidate.provider, candidate, mediaVerdict);
        return false;
      }
      return panAutoHealthAdmission(candidate, {}).accepted;
    }

    function detailDirectPlayCandidateFor(item) {
      const prepared = detailPreparedCandidateFor(item);
      if (prepared) return prepared;
      if (!detailDirectPlayReadyFor(item)) return null;
      const ready = state.pan && state.pan.directReady;
      return detailDirectReadyCandidateFor(item, ready);
    }

    function detailContinuePlaybackTargetFor(item, history) {
      if (!item || !history) return currentPlaybackTargetForItem(item);
      const entry = history.historyContextEntry;
      const rawItem = entry && entry.item && typeof entry.item === "object" ? entry.item : history;
      const rawTarget = history.historyContextTarget
        || entry && (entry.playbackTarget || entry.target)
        || rawItem;
      const source = history.continueContext || entry || history.historyContextTarget
        ? Object.assign({}, entry || {}, rawTarget || {})
        : historyPlaybackContext(history);
      return normalizePlaybackTarget(item, source);
    }

    async function playDetailDirectReadyCandidate(item, candidate, history, button) {
      if (!item || !candidate || !detailDirectPlayReadyFor(item)) return false;
      const detailRun = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        && state.detailPlayback.item === item ? state.detailPlayback : null;
      if (detailRun && detailRun.handoffStarted) return false;
      const effectiveHistory = history;
      const episodeTarget = detailContinuePlaybackTargetFor(item, effectiveHistory);
      if (episodeTarget) setDetailPlaybackTarget(item, episodeTarget);
      if (effectiveHistory) {
        // Ready 已经确定了当前 Direct 资源；历史记录只补充季/集和进度上下文，
        // 不再进入会重新搜索或切换资源的旧续播分支。
        rememberDetailReturn(button);
        state.historyResume = null;
      }
      // 自动选择的 Direct 候选在最终交接前仍需同步复核缓存健康状态；
      // 手动盘搜入口继续由 playPanResult() 保留“警告后强制播放”语义。
      const admission = panAutoHealthAdmission(candidate, {});
      if (!admission.accepted) {
        state.pan.directReady = null;
        updateDetailContinueButton();
        toast(detailDirectFailureMessage("NO_RESOURCE"));
        return false;
      }
      if (detailRun) {
        detailRun.handoffStarted = true;
        detailRun.playRequested = false;
      }
      recordDirectReadyEvent("DIRECT_READY_CONSUMED", item, candidate, "ready_click", admission.state, null);
      await playPanResult(candidate, {
        prechecked: true,
        episodeTarget,
        historyResume: !!effectiveHistory
      });
      return true;
    }

    function detailHistoryDirectResourceFor(item, history) {
      if (!item || !detailContinueHistoryIsValid(history)) return null;
      const target = detailContinuePlaybackTargetFor(item, history);
      const candidate = buildDirectPanHistoryItem(target);
      if (!target || !candidate || !candidate.url || !candidate.diskType) return null;
      const supported = PAN_DISK_TYPES.some((disk) => disk.id === normalizePanDiskType(candidate.diskType));
      const payload = buildPanPlayPayload(candidate);
      if (!supported || !payload || !payload.type || !payload.url) return null;
      return { target, candidate };
    }

    function detailHistoryHandoffCurrent(item, handoff) {
      return !!(handoff && state.detailHistoryHandoff === handoff && state.selected === item
        && $("detailSheet") && $("detailSheet").classList.contains("active"));
    }

    function startDetailContinueFallback(item, target, reason) {
      if (!item || state.selected !== item || !$("detailSheet") || !$("detailSheet").classList.contains("active")) {
        return Promise.resolve(false);
      }
      const existing = state.detailHistoryHandoff;
      if (existing && existing.item === item && existing.status === "fallback" && existing.promise) return existing.promise;
      const pending = typeof _directPlayPending !== "undefined" ? _directPlayPending : null;
      cancelDetailPlaybackPreparation(reason || "continue_history_fallback");
      cancelPendingDirectPlay(reason || "continue_history_fallback");
      resetPanSearchState(false, { reason: reason || "continue_history_fallback", preserveHealth: true });
      if (target) setDetailPlaybackTarget(item, target);
      const handoff = { item, target: target || null, status: "fallback", promise: null };
      state.detailHistoryHandoff = handoff;
      handoff.promise = (async () => {
        if (pending && pending.promise && typeof pending.promise.then === "function") {
          await pending.promise.catch(() => {});
        }
      if (state.selected !== item || !$("detailSheet") || !$("detailSheet").classList.contains("active")) return false;
        if (target) setDetailPlaybackTarget(item, target);
        prepareDetailPlayback(item, {
          reason: reason || "continue_history_fallback",
          playRequested: true
        }).catch(() => {});
        return true;
      })();
      return handoff.promise;
    }

    async function playDetailContinueHistoryFirst(item, history, button) {
      const existing = state.detailHistoryHandoff;
      if (existing && existing.item === item) {
        if (existing.status === "fallback") return false;
        if (existing.status === "playing" && state.pan && state.pan.isPlaying) return true;
        if (existing.status === "preparing" && existing.promise) {
          await existing.promise.catch(() => {});
          return true;
        }
        if (existing.status === "playing" && !(state.pan && state.pan.isPlaying)) state.detailHistoryHandoff = null;
      }
      const progressTarget = detailContinuePlaybackTargetFor(item, history);
      if (progressTarget) setDetailPlaybackTarget(item, progressTarget);
      if (history && detailContinueHistoryIsValid(history)) {
        try {
          if (await playNativeHistoryExact(history, {
            detail: true,
            button,
            watchItem: item
          })) {
            state.historyResume = null;
            return true;
          }
        } catch (e) {}
      }
      const currentRun = state.detailPlayback;
      if (currentRun
        && detailPlaybackIsCurrent(currentRun)
        && currentRun.phase === "CONTINUE_READY"
        && currentRun.continueResourcePromise) {
        await currentRun.continueResourcePromise.catch(() => null);
        if (!detailPlaybackIsCurrent(currentRun)) return true;
      }
      const runResource = currentRun
        && detailPlaybackIsCurrent(currentRun)
        && currentRun.phase === "CONTINUE_READY"
        && currentRun.continueResource
        ? currentRun.continueResource
        : null;
      const resource = detailHistoryDirectResourceFor(item, history)
        || runResource
        || detailContinueResourceContextFor(item, history);
      if (!resource) {
        await startDetailContinueFallback(item, progressTarget, "continue_history_resource_unavailable");
        return true;
      }
      const pending = typeof _directPlayPending !== "undefined" ? _directPlayPending : null;
      cancelDetailPlaybackPreparation("continue_history_resource");
      cancelPendingDirectPlay("continue_history_resource");
      resetPanSearchState(false, { reason: "continue_history_resource", preserveHealth: true });
      const handoff = {
        item,
        target: progressTarget,
        candidate: resource.candidate,
        status: "preparing",
        promise: null
      };
      state.detailHistoryHandoff = handoff;
      handoff.promise = (async () => {
        if (!detailHistoryHandoffCurrent(item, handoff)) return false;
        if (isPanHealthBad(resource.candidate)) {
          await startDetailContinueFallback(item, progressTarget, "continue_history_health_bad");
          return true;
        }
        const preflight = await freshPanPreflight(resource.candidate, {
          token: state.pan.viewToken,
          item
        }, { playback: true });
        if (preflight && preflight.cancelled) return false;
        if (!detailHistoryHandoffCurrent(item, handoff)) return false;
        if (isPanHealthBad(resource.candidate)) {
          await startDetailContinueFallback(item, progressTarget, "continue_history_health_bad");
          return true;
        }
        if (progressTarget) setDetailPlaybackTarget(item, progressTarget);
        if (button) rememberDetailReturn(button);
        state.historyResume = null;
        let fallbackPromise = null;
        const onPlayFailure = (error) => {
          if (fallbackPromise || !detailHistoryHandoffCurrent(item, handoff)) return;
          handlePanPlayFailure(item, error, 0);
          fallbackPromise = startDetailContinueFallback(item, progressTarget, "continue_history_handoff_failed");
        };
        await playPanResult(resource.candidate, {
          prechecked: true,
          episodeTarget: progressTarget,
          historyResume: true,
          onPlayFailure
        });
        if (fallbackPromise) await fallbackPromise;
        return true;
      })().catch(async () => {
        if (!detailHistoryHandoffCurrent(item, handoff)) return false;
        await startDetailContinueFallback(item, progressTarget, "continue_history_handoff_failed");
        return true;
      });
      const result = await handoff.promise.catch(() => false);
      if (state.detailHistoryHandoff === handoff) handoff.status = state.pan && state.pan.isPlaying ? "playing" : "done";
      return result !== false;
    }

    async function requestDetailPlayback(item) {
      if (!item) return;
      if (canonicalResourceKey(item)) {
        try { await resolveCanonicalResourceTitle(item); } catch (e) {}
        if (state.selected !== item) return;
      }
      const pendingContinueRun = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        && state.detailPlayback.continuePending ? state.detailPlayback : null;
      if (pendingContinueRun) {
        await (pendingContinueRun.continueDecisionPromise || Promise.resolve(null)).catch(() => null);
        if (state.selected !== item) return;
      }
      const button = $("detailContinueBtn");
      if (state.detailModeItemKey !== panSearchItemKey(item)) syncDetailMode(item);
      const mode = state.detailMode === "CONTINUE" ? "CONTINUE" : "FIRST_PLAY";
      const history = mode === "CONTINUE" ? state.detailHistory : null;
      const directOptions = { detailPrimary: true, suppressAutoPan: true };
      if (history) {
        directOptions.history = history;
      }
      if (mode === "CONTINUE" && history && detailContinueHistoryIsValid(history)) {
        if (await playDetailContinueHistoryFirst(item, history, button)) return;
      }
      const racingDetailPlayback = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        && state.detailPlayback.item === item && state.detailPlayback.raceActive
        && !state.detailPlayback.providerCommitted ? state.detailPlayback : null;
      if (racingDetailPlayback) {
        racingDetailPlayback.playRequested = true;
        showDirectPlayStatus(racingDetailPlayback.token, "REQUESTED_PREPARING", DIRECT_PLAY_STATUS_TEXT.REQUESTED_PREPARING, "play_requested_while_detail_race");
        updateDetailContinueButton();
        toast("资源正在准备，请稍候");
        return;
      }
      const prepared = detailPreparedCandidateFor(item);
      if (prepared) {
        playPreparedDetailCandidate(item, prepared, button).catch(() => {});
        return;
      }
      const readyCandidate = detailDirectPlayCandidateFor(item);
      if (readyCandidate) {
        playDetailDirectReadyCandidate(item, readyCandidate, history, button).catch(() => {});
        return;
      }
      if (detailUnreleasedInfo(item).unreleased && !history) {
        settleDetailUnreleased(item, "unreleased_manual_guard");
        updateDetailContinueButton();
        toast("尚未上映");
        return;
      }
      const detailPlayback = state.detailPlayback;
      if (detailPlayback && detailPlaybackIsCurrent(detailPlayback) && detailPlayback.handoffStarted) return;
      if (detailPlayback && detailPlaybackIsCurrent(detailPlayback) && detailPlayback.active && !detailPlayback.candidate) {
        detailPlayback.playRequested = true;
        if (detailPlayback.directAction && typeof _directPlayPending !== "undefined" && _directPlayPending === detailPlayback.directAction) {
          playBestQuark(item, directOptions);
        } else {
          showDirectPlayStatus(detailPlayback.token, "REQUESTED_PREPARING", DIRECT_PLAY_STATUS_TEXT.REQUESTED_PREPARING, "play_requested_while_curated_preparing");
          toast("资源正在准备，请稍候");
        }
        return;
      }
      // 详情进入时的 prepareOnly 仍在同一个 playBestQuark action 中运行时，
      // 让原 action 接收一次用户播放意图；不得因为历史按钮形态绕开它。
      const pending = typeof _directPlayPending !== "undefined" ? _directPlayPending : null;
      if (pending && pending.item === item && pending.prepareOnly) {
        playBestQuark(item, directOptions);
        return;
      }
      // Direct preparation 的失败终态也必须由同一个 playBestQuark action
      // 处理：NO_RESOURCE 只提示，CONNECTION_FAILED 才允许人工 fresh retry。
      const directFailureType = detailDirectFailureTypeFor(item);
      if (directFailureType) {
        playBestQuark(item, directOptions);
        return;
      }
      // 播放/准备统一由同一个 playBestQuark action 处理；若当前是
      // prepareOnly action，由 playBestQuark 内部记录 playRequested 并继续等待。
      playBestQuark(item, directOptions);
    }

    function handleDetailPrimaryAction() {
      return requestDetailPlayback(state.selected);
    }

    function detailContinuePlayStateFor(item) {
      if (!item) return "idle";
      const itemKey = panSearchItemKey(item);
      const history = state.detailMode === "CONTINUE"
        && state.detailModeItemKey === itemKey
        && detailContinueHistoryIsValid(state.detailHistory)
        && detailHistoryMatches(item, state.detailHistory)
        ? state.detailHistory
        : null;
      if (history) return "ready";

      const run = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        && state.detailPlayback.item === item ? state.detailPlayback : null;
      const racePreparing = !!(run && run.raceActive && !run.providerCommitted);
      const directReady = racePreparing ? false : detailDirectPlayReadyFor(item);
      if (directReady) return "ready";

      const runPhase = String(run && run.phase || "");
      if (run && (run.handoffStarted || ["READY", "STARTING_PLAYER", "PAN_PLAY_CALLED"].includes(runPhase))) {
        return "ready";
      }

      const pending = typeof _directPlayPending !== "undefined" ? _directPlayPending : null;
      const action = pending && pending.item === item && panDirectPlayActionIsCurrent(pending) ? pending : null;
      const status = state.directPlayStatus || {};
      if (action && ["READY", "STARTING_PLAYER"].includes(String(status.textKey || status.phase || ""))) {
        return "ready";
      }
      if (run && (runPhase === "UNRELEASED" || run.settledResult === "UNRELEASED")) {
        return "unreleased";
      }
      if (racePreparing) return "preparing";
      if (run && run.active && (run.preparationStarted || ["PREPARING", "PAN_DIRECT"].includes(runPhase))) return "preparing";
      if (action && (action.prepareOnly || action.playRequested || action.searchStarted)) return "preparing";

      const failurePhase = ["NO_RESOURCE", "CONNECTION_FAILED", "FINAL_ERROR"].includes(runPhase);
      if (failurePhase || !!detailDirectFailureTypeFor(item)) return "failed";
      return "idle";
    }

    function updateDetailContinueButton() {
      const button = $("detailContinueBtn");
      const continueText = $("detailContinueText");
      const searchText = $("detailSearchText");
      if (!button) return;
      if (state.selected && state.detailModeItemKey !== panSearchItemKey(state.selected)) syncDetailMode(state.selected);
      const mode = state.detailMode === "CONTINUE" ? "CONTINUE" : "FIRST_PLAY";
      const match = mode === "CONTINUE" ? state.detailHistory : null;
      const actions = button.closest(".actions");
      button.__historyItem = match || null;
      button.style.display = "";
      button.setAttribute("aria-hidden", "false");
      if (continueText) continueText.textContent = match ? "续播" : "播放";
      if (actions) actions.classList.toggle("has-continue", !!match);
      const directReady = detailDirectPlayReadyFor(state.selected);
      // 文字由权威 Native History 决定；图标状态同样优先尊重有效历史，
      // 再反映当前详情生命周期中的可交接资源、准备中和终态失败。
      const playState = detailContinuePlayStateFor(state.selected);
      const ready = playState === "ready";
      button.classList.toggle("is-ready", ready);
      button.dataset.ready = ready ? "true" : "false";
      button.dataset.playState = playState;
      button.dataset.mode = mode;
      button.dataset.directReady = directReady ? "true" : "false";
      if (searchText) searchText.textContent = "聚搜";
    }

