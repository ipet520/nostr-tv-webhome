    const DETAIL_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

    function detailSessionId() {
      return "detail_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 12);
    }

    function detailSessionFor(item) {
      const session = state.detailSession;
      return session && !session.ended && session.expiresAt > Date.now()
        && item && session.itemKey === panSearchItemKey(item) ? session : null;
    }

    function detailSessionTargetKey(target) {
      return JSON.stringify([target && target.seasonNumber, target && target.episodeNumber,
        target && target.flag, target && target.sourceBindingKey, target && target.episodeUrl]);
    }

    function endDetailSession(reason) {
      const session = state.detailSession;
      if (!session) return;
      session.ended = true; session.phase = "CLOSED"; state.detailSession = null;
      if (session.requestId) { localStorage.removeItem("fm_pan_playing"); if (state.pan) state.pan.isPlaying = false; }
      const searchReturn = nativeSearchReturnMarkerFor();
      if (searchReturn && searchReturn.itemKey === session.itemKey) clearNativeSearchReturnMarker();
      const api = sdk();
      if (api.detailSession) Promise.resolve(api.detailSession({ operation: "close", version: 1, sessionId: session.id })).catch(() => {});
      state.detailHistory = null; state.detailHistoryHandoff = null;
      state.detailEpisodeTarget = null; state.historyResume = null;
      if (state.pan) state.pan.playbackReturn = null;
      state.detailReturn = null;
    }

    function detailSessionCall(payload, timeout) {
      const api = sdk();
      if (typeof api.detailSession !== "function") return Promise.reject(new Error("当前 App 不支持详情会话播放，请更新 App"));
      let timer;
      return Promise.race([Promise.resolve().then(() => api.detailSession(payload)), new Promise((resolve, reject) => {
        timer = setTimeout(() => { const error = new Error("详情会话交接结果未知"); error.sessionTimeout = true; reject(error); }, timeout || 3000);
      })]).finally(() => clearTimeout(timer));
    }

    function applyDetailSessionReceipt(session, receipt, fromReturn) {
      if (state.detailSession !== session || session.ended || !receipt || receipt.version !== 1
        || receipt.sessionId !== session.id || receipt.mediaKey !== session.itemKey
        || receipt.requestId !== session.requestId || receipt.accepted !== true) return false;
      const source = buildPanPlayPayload(session.candidate);
      if (!source || !receipt.route || receipt.route.entry !== "pan-push"
        || receipt.route.siteKey !== "push_agent" || receipt.route.vodId !== source.url) return false;
      session.accepted = true;
      if (!fromReturn && session.returnedRequestId === receipt.requestId) return true;
      if (fromReturn) session.returnedRequestId = receipt.requestId;
      session.actualPlayback = "UNKNOWN";
      session.nativeHistory = receipt.canResume === true && receipt.history ? normalizeHistoryItem(receipt.history, 0) : null;
      session.canResume = !!session.nativeHistory;
      return true;
    }

    function beginDetailSession(item, options) {
      const opts = options || {}, existing = detailSessionFor(item);
      if (opts.restore && existing) { existing.item = item; return existing; }
      endDetailSession("new_detail");
      const now = Date.now();
      const session = { version: 1, id: detailSessionId(), item, itemKey: panSearchItemKey(item),
        generation: 1, phase: "PREPARING", expiresAt: now + DETAIL_SESSION_TTL_MS,
        target: normalizePlaybackTarget(item, opts.episodeTarget || opts.historyContext || {}), candidate: null, accepted: false,
        requestId: "", actualPlayback: "UNKNOWN", canResume: false, nativeHistory: null, ended: false, promise: null };
      state.detailSession = session;
      state.detailEpisodeTarget = session.target;
      const saved = opts.detailSessionReturn;
      if (opts.playerReturnRestore && saved && saved.version === 1 && saved.returnIntent === "native-player"
        && saved.itemKey === session.itemKey && /^[A-Za-z0-9_-]{8,160}$/.test(saved.id || "")
        && /^[A-Za-z0-9_-]{8,160}$/.test(saved.requestId || "")
        && Number.isFinite(saved.expiresAt) && saved.expiresAt > now && saved.expiresAt <= now + DETAIL_SESSION_TTL_MS
        && saved.candidate && buildPanPlayPayload(saved.candidate)) {
        session.id = saved.id; session.requestId = saved.requestId; session.expiresAt = saved.expiresAt;
        session.candidate = saved.candidate; session.target = normalizePlaybackTarget(item, saved.target);
        session.phase = "RESTORING";
        const restoreGeneration = session.generation;
        session.restoration = detailSessionCall({ operation: "read", version: 1, sessionId: session.id }).then((receipt) => {
          if (!applyDetailSessionReceipt(session, receipt, true)) throw new Error("详情会话恢复身份不一致");
          session.phase = session.canResume ? "RETURNED" : "RETURNED_NO_POINT";
          session.applyingNativeTarget = true;
          session.target = setDetailPlaybackTarget(item, session.nativeHistory ? historyPlaybackContext(session.nativeHistory.nativeHistoryRaw) : session.target);
          session.applyingNativeTarget = false;
          syncDetailMode(item); updateDetailContinueButton();
          return true;
        }).catch(() => {
          if (state.detailSession === session && session.generation === restoreGeneration) {
            session.id = detailSessionId(); session.requestId = ""; session.accepted = false;
            session.candidate = null; session.phase = "PREPARING";
          }
          return false;
        });
      }
      return session;
    }

    function detailSessionSnapshot() {
      const session = detailSessionFor(state.selected);
      if (!session || !session.requestId || !session.candidate || !["REQUESTED", "UNKNOWN", "ACCEPTED", "RETURNED", "RETURNED_NO_POINT"].includes(session.phase)) return null;
      return { version: 1, id: session.id, itemKey: session.itemKey, requestId: session.requestId,
        expiresAt: session.expiresAt, returnIntent: "native-player", target: session.target,
        candidate: Object.assign(compactPanResults([session.candidate])[0], {
          identityVerdict: session.candidate.identityVerdict || "", healthAdmission: session.candidate.healthAdmission || "" }) };
    }

    function detailSessionTargetChanged(item, target) {
      const session = detailSessionFor(item);
      if (!session || session.applyingNativeTarget || detailSessionTargetKey(target) === detailSessionTargetKey(session.target)) return;
      restartDetailSessionPreparation(session, target, "detail_target_changed");
    }

    function restartDetailSessionPreparation(session, target, reason) {
      const item = session.item;
      const oldId = session.id;
      session.generation += 1; session.id = detailSessionId(); session.target = target;
      session.candidate = null; session.accepted = false; session.nativeHistory = null; session.canResume = false;
      session.phase = "PREPARING"; session.requestId = "";
      session.promise = null; session.restoring = null; session.returnedRequestId = "";
      if (sdk().detailSession) Promise.resolve(sdk().detailSession({ operation: "close", version: 1, sessionId: oldId })).catch(() => {});
      cancelDetailPlaybackPreparation(reason);
      return prepareDetailPlaybackForDetail(item, { reason, playRequested: reason === "session_retry" }).catch(() => {});
    }

    async function restoreDetailSessionAfterPlayerReturn(item) {
      const session = detailSessionFor(item);
      if (!session || !session.requestId) return false;
      if (session.restoring) return session.restoring;
      const generation = session.generation;
      const current = () => state.detailSession === session && !session.ended && session.generation === generation;
      session.restoring = detailSessionCall({ operation: "read", version: 1, sessionId: session.id }).then((receipt) => {
        if (!current() || !applyDetailSessionReceipt(session, receipt, true)) return false;
        session.phase = session.canResume ? "RETURNED" : "RETURNED_NO_POINT";
        session.applyingNativeTarget = true;
        if (session.nativeHistory) session.target = setDetailPlaybackTarget(item, historyPlaybackContext(session.nativeHistory.nativeHistoryRaw));
        if (state.detailReturn) state.detailReturn.episodeTarget = session.target;
        if (state.pan.playbackReturn) state.pan.playbackReturn.episodeTarget = session.target;
        session.applyingNativeTarget = false;
        if (state.detailPlayback && state.detailPlayback.sessionId === session.id) state.detailPlayback.handoffStarted = false;
        syncDetailMode(item); updateDetailContinueButton(); scheduleUiSnapshotSave();
        return true;
      }).catch(() => {
        if (current()) { session.phase = "FAILED"; session.canResume = false; session.nativeHistory = null; syncDetailMode(item); updateDetailContinueButton(); }
        return false;
      }).finally(() => { if (current()) session.restoring = null; });
      return session.restoring;
    }

    function playDetailSessionCandidate(candidate, options) {
      const session = detailSessionFor(state.selected), selected = state.selected;
      if (!session || session.item !== selected) return Promise.resolve(false);
      if (session.promise) return session.promise;
      if (["ACCEPTED", "REQUESTED", "UNKNOWN", "RESTORING"].includes(session.phase)) return Promise.resolve(false);
      const opts = options || {}, generation = session.generation;
      const current = () => detailSessionFor(selected) === session && session.generation === generation;
      const resume = session.phase === "RETURNED" && session.canResume;
      const payload = buildPanPlayPayload(candidate);
      if (!resume && !payload) return Promise.resolve(false);
      session.candidate = candidate; session.target = currentPlaybackTargetForItem(selected);
      session.requestId = detailSessionId(); session.phase = "REQUESTED"; session.accepted = false;
      const requestId = session.requestId;
      session.promise = (async () => {
        if (!resume) {
          const preflight = await freshPanPreflight(candidate, { token: state.pan.viewToken, item: selected }, { playback: true });
          if (!current() || preflight.cancelled) return false;
          if (opts.prechecked && (isPanHealthBad(candidate) || !panAutoHealthAdmission(candidate, {}).accepted)) throw new Error("本次会话资源已失效，请重新准备");
          if (!opts.prechecked && isPanHealthBad(candidate)) toast("该资源检测可能失效，仍尝试播放");
        }
        rememberDetailReturn($("detailContinueBtn"));
        const identity = { siteKey: "push_agent", vodId: payload && payload.url || "", episodeUrl: payload && payload.url || "", playbackOrigin: "pan-push" };
        if (!resume) { rememberWatchIntent(selected, "search", session.target, identity); startWatchTracking(selected, session.target, identity); }
        await persistPlaybackBeforeNativeHandoff(selected, session.target, candidate, opts.handoffAction);
        if (!current()) return false;
        localStorage.setItem("fm_pan_playing", "1"); state.pan.isPlaying = true;
        const receipt = await detailSessionCall({ operation: "play", version: 1, sessionId: session.id,
          mediaKey: session.itemKey, requestId, resume,
          route: { entry: "pan-push", siteKey: "push_agent", vodId: payload && payload.url || "",
            title: selected.title || "", pic: selected.pic || "", target: session.target } }, 8000);
        if (!current()) return false;
        if (!applyDetailSessionReceipt(session, receipt)) throw new Error("App 未确认详情会话交接");
        if (session.returnedRequestId !== requestId) session.phase = "ACCEPTED";
        cancelPendingDirectPlay("play_started"); scheduleUiSnapshotSave(); updateDetailContinueButton();
        return true;
      })().catch((error) => {
        if (current() && session.returnedRequestId !== requestId) {
          session.phase = error.sessionTimeout ? "UNKNOWN" : "FAILED";
          session.actualPlayback = "UNKNOWN";
          session.canResume = false; session.nativeHistory = null;
          if (!error.sessionTimeout) handlePanPlayFailure(selected, error, opts.handoffAction && opts.handoffAction.token);
          if (state.detailPlayback) state.detailPlayback.handoffStarted = false;
          updateDetailContinueButton();
        }
        return false;
      }).finally(() => { if (current()) session.promise = null; });
      return session.promise;
    }
