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
        return run.provider === "curated"
          ? playPreparedDetailCandidate(item, candidate, button)
          : playDetailDirectReadyCandidate(item, candidate, button);
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

    function detailPreparedCandidateFor(item) {
      const run = state.detailPlayback;
      const candidate = run && detailPlaybackIsCurrent(run) && run.candidate;
      if (!candidate) return null;
      const mediaVerdict = automaticVideoCandidateVerdict(item, candidate);
      const admission = panAutoHealthAdmission(candidate, {});
      if (!mediaVerdict.accepted || !admission.accepted) {
        if (!mediaVerdict.accepted) recordAutomaticMediaRejected(run.provider || "detail", run.sourceId || candidate.source || candidate.provider, candidate, mediaVerdict);
        run.candidate = null;
        run.error = !mediaVerdict.accepted ? "automatic_media_rejected" : admission.state === "bad" ? "fresh_bad_candidate" : "health_unconfirmed_candidate";
        settleDetailPlayback(run, "NO_RESOURCE", run.error);
        updateDetailContinueButton();
        return null;
      }
      return candidate;
    }

    function restoreDetailPreparedCandidate(item, candidate, metadata) {
      if (!item || state.selected !== item || !candidate || !buildPanPlayPayload(candidate)) return false;
      const itemKey = panSearchItemKey(item);
      const saved = metadata || {};
      const previous = state.detailPlayback || {};
      const run = {
        seq: Number(previous.seq || 0) + 1,
        token: ++_directPlayActionSeq,
        item,
        itemKey,
        canonicalPromise: Promise.resolve(item),
        canonicalStartedAt: Date.now(),
        canonicalResolved: true,
        canonicalSuccess: true,
        active: false,
        promise: null,
        candidate,
        sourceId: String(saved.sourceId || candidate.sourceId || candidate.source || ""),
        provider: String(saved.provider || candidate.provider || "player-return"),
        playRequested: false,
        handoffStarted: false,
        episodeTarget: normalizePlaybackTarget(item, saved.episodeTarget || currentPlaybackTargetForItem(item)) || null,
        directAction: null,
        error: "",
        reason: "player_return_snapshot_restore",
        phase: "READY",
        settledResult: "READY",
        raceActive: false,
        providerCommitted: true,
        providerCommitCount: 1,
        preparationStarted: true
      };
      state.detailPlayback = run;
      return true;
    }

    async function playPreparedDetailCandidate(item, candidate, button) {
      const run = state.detailPlayback;
      if (!run || !detailPlaybackIsCurrent(run) || !candidate) return false;
      if (run.handoffStarted) return false;
      run.handoffStarted = true;
      run.playRequested = false;
      run.phase = "STARTING_PLAYER";
      showDirectPlayStatus(run.token, "STARTING_PLAYER", "正在启动播放器…", "native_handoff_start");
      const episodeTarget = currentPlaybackTargetForItem(item);
      if (episodeTarget) setDetailPlaybackTarget(item, episodeTarget);
      // 资源准备期间缓存状态可能变化；handoff 前必须再读一次当前健康状态。
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
        episodeTarget
      });
      armDirectPlayStatusUiFallback(run.token);
      return true;
    }

    function prepareDetailPlayback(item, options) {
      const opts = options || {};
      const previous = state.detailPlayback || {};
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
        active: true,
        promise: null,
        candidate: null,
        sourceId: "",
        provider: "",
        playRequested: !!opts.playRequested,
        handoffStarted: false,
        episodeTarget: null,
        directAction: null,
        error: "",
        reason: String(opts.reason || "detail_prepare"),
        preparationStarted: false,
        phase: "INITIALIZING",
        settledResult: "",
        finalFailureNotified: false,
        curatedSummarySent: false,
        cancelled: false,
        cancelReason: "",
        staleLogged: false,
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
        await run.canonicalPromise.catch(() => item);
        if (!detailPlaybackCurrentOrRecord(run)) return null;
        recordDetailRaceDiag("DETAIL_FIRST_PLAY_BARRIER_RELEASED", run, {
          elapsedMs: Math.max(0, Date.now() - Number(run.canonicalStartedAt || Date.now())),
            canonicalDone: !!run.canonicalResolved
        });
        const unreleased = detailUnreleasedInfo(item);
        if (unreleased.unreleased) {
          recordDetailPlaybackDecision("DETAIL_OPEN_PLAYBACK_DECISION", item, {
            continueContextFound: false,
            continueUrlFound: false,
            nativeHistoryKnown: false,
            nativeProgress: 0,
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
          continueContextFound: false,
          continueUrlFound: false,
          nativeHistoryKnown: false,
          nativeProgress: 0,
          decision: "FIRST_PLAY_PREPARE",
          curatedStarted: true
        });
        showDirectPlayStatus(run.token, "BACKGROUND_PREPARING", DIRECT_PLAY_STATUS_TEXT.BACKGROUND_PREPARING, "detail_prepare_start");
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

    async function playDetailDirectReadyCandidate(item, candidate, button) {
      if (!item || !candidate || !detailDirectPlayReadyFor(item)) return false;
      const detailRun = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        && state.detailPlayback.item === item ? state.detailPlayback : null;
      if (detailRun && detailRun.handoffStarted) return false;
      const episodeTarget = currentPlaybackTargetForItem(item);
      if (episodeTarget) setDetailPlaybackTarget(item, episodeTarget);
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
        episodeTarget
      });
      return true;
    }

    async function requestDetailPlayback(item) {
      if (!item || state.selected !== item) return false;
      const button = $("detailContinueBtn");
      const returnHistory = detailReturnedNativeHistoryFor(item);
      if (returnHistory) {
        const marker = state.detailPlayerReturn;
        const returnedRun = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
          && state.detailPlayback.item === item ? state.detailPlayback : null;
        if (returnedRun) {
          returnedRun.handoffStarted = true;
          returnedRun.playRequested = false;
          returnedRun.phase = "STARTING_PLAYER";
        }
        try {
          const started = await playNativeHistoryExact(returnHistory, { detail: true, button });
          if (!started) throw new Error("原生历史无法精确恢复");
          return true;
        } catch (e) {
          marker.handoffStarted = false;
          if (returnedRun && state.detailPlayback === returnedRun) {
            returnedRun.handoffStarted = false;
            returnedRun.phase = returnedRun.candidate ? "READY" : "NO_RESOURCE";
          }
          updateDetailContinueButton();
          toast("续播失败：" + (e && e.message || "原生历史无法精确恢复"));
          return false;
        }
      }
      const activeReturn = state.detailPlayerReturn;
      if (activeReturn && activeReturn.itemKey === panSearchItemKey(item) && activeReturn.handoffStarted) return false;
      const directOptions = { detailPrimary: true, suppressAutoPan: true };
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
        playDetailDirectReadyCandidate(item, readyCandidate, button).catch(() => {});
        return;
      }
      if (detailUnreleasedInfo(item).unreleased) {
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
      if (canonicalResourceKey(item)) {
        try { await resolveCanonicalResourceTitle(item); } catch (e) {}
        if (state.selected !== item) return false;
      }
      playBestQuark(item, directOptions);
    }

    function handleDetailPrimaryAction() {
      return requestDetailPlayback(state.selected);
    }

    function detailContinuePlayStateFor(item) {
      if (!item) return "idle";
      // When the primary action is an executable Native History resume, its
      // ready state takes precedence over an unrelated Curated/Direct run.
      // This keeps the icon color aligned with both the visible label and the
      // history_exact action dispatched by requestDetailPlayback().
      if (typeof detailReturnedNativeHistoryFor === "function"
        && detailReturnedNativeHistoryFor(item)) return "ready";
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

    function detailNativeHistoryKey(history) {
      const ref = history && history.historyRecordRef;
      return String(history && (history.nativeHistoryKey || history.historyKey) || ref && ref.historyKey || "").trim();
    }

    function refreshDetailReturnHistory(item) {
      const marker = state.detailPlayerReturn;
      const detail = $("detailSheet");
      if (!item || state.selected !== item || !marker || marker.itemKey !== panSearchItemKey(item)
        || marker.handoffStarted || !(Number(marker.returnedAt || 0) > 0)
        || !detail || !detail.classList.contains("active")) return false;
      const history = findDetailContinueHistory(item);
      marker.nativeHistoryKey = nativeHistoryRecordCanPlayExact(history) ? detailNativeHistoryKey(history) : "";
      return !!marker.nativeHistoryKey;
    }

    function detailReturnedNativeHistoryFor(item) {
      const marker = state.detailPlayerReturn;
      if (!item || !marker || marker.itemKey !== panSearchItemKey(item)
        || marker.handoffStarted || !(Number(marker.returnedAt || 0) > 0)) return null;
      const hasPinnedIdentity = Object.prototype.hasOwnProperty.call(marker, "nativeHistoryKey");
      const pinnedKey = String(marker.nativeHistoryKey || "").trim();
      const rows = state.recent && (state.recent.detailItems || state.recent.items) || [];
      const history = hasPinnedIdentity
        ? (pinnedKey ? rows.find((candidate) => detailNativeHistoryKey(candidate) === pinnedKey) || null : null)
        : findDetailContinueHistory(item);
      return history && detailHasAuthoritativeNativeHistory(history)
        && detailHistoryMatches(item, history) && nativeHistoryRecordCanPlayExact(history) ? history : null;
    }

    function updateDetailContinueButton() {
      const button = $("detailContinueBtn");
      const continueText = $("detailContinueText");
      const searchText = $("detailSearchText");
      if (!button) return;
      const selected = state.selected;
      const returnMarker = state.detailPlayerReturn;
      if (selected && returnMarker && returnMarker.itemKey === panSearchItemKey(selected)
        && returnMarker.handoffStarted) return;
      const actions = button.closest(".actions");
      button.__historyItem = null;
      button.style.display = "";
      button.setAttribute("aria-hidden", "false");
      const hasNativeResume = !!(state.selected && detailReturnedNativeHistoryFor(state.selected));
      if (continueText) continueText.textContent = hasNativeResume ? "续播" : "播放";
      if (actions) actions.classList.toggle("has-continue", hasNativeResume);
      const directReady = detailDirectPlayReadyFor(state.selected);
      // 新进入详情时继续使用当前准备资源；只有同一详情页真实播放器返回后，
      // 可精确恢复的 Native History 才接管主按钮的续播交接。
      const playState = detailContinuePlayStateFor(state.selected);
      const ready = playState === "ready";
      button.classList.toggle("is-ready", ready);
      button.dataset.ready = ready ? "true" : "false";
      button.dataset.playState = playState;
      button.dataset.mode = hasNativeResume ? "CONTINUE" : "FIRST_PLAY";
      button.dataset.directReady = directReady ? "true" : "false";
      if (searchText) searchText.textContent = "聚搜";
    }

