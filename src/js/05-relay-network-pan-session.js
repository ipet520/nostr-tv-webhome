    function isNostrRefreshActive(token) {
      const info = state.relay.refresh;
      return !!(info && info.active && (token == null || token === state.relay.subscribeToken));
    }

    function getRelayBackfillState(relay) {
      if (!state.relay.backfillState) state.relay.backfillState = {};
      if (!state.relay.backfillState[relay]) {
        state.relay.backfillState[relay] = {
          loading: false,
          error: "",
          terminal: false,
          terminalState: "pending",
          historyDone: false,
          historyFailed: false,
          historyTimedOut: false,
          startedAt: 0,
          finishedAt: 0
        };
      }
      return state.relay.backfillState[relay];
    }

    function setRelayBackfillState(relay, patch) {
      return Object.assign(getRelayBackfillState(relay), patch || {});
    }

    function markRelayBackfillTerminal(relay, terminalState, error, token) {
      if (token != null && token !== state.relay.subscribeToken) return;
      const normalized = terminalState === "done" ? "done" : terminalState === "timeout" ? "timeout" : "failed";
      setRelayBackfillState(relay, {
        loading: false,
        error: String(error || ""),
        terminal: true,
        terminalState: normalized,
        historyDone: normalized === "done",
        historyFailed: normalized === "failed",
        historyTimedOut: normalized === "timeout",
        finishedAt: hotNow()
      });
    }

    function allRelayBackfillsTerminal() {
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      return relays.every((relay) => {
        const value = state.relay.backfillState && state.relay.backfillState[relay];
        return !!(value && value.terminal);
      });
    }

    function maybeFinishNostrRefresh(token) {
      if (!isNostrRefreshActive(token)) return;
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      const busy = Object.keys(state.relay.backfillBusy || {}).length;
      const timers = Object.values(state.relay.backfillTimers || {}).filter(Boolean).length;
      if (state.relay.subscribeDone < relays.length || !allRelayBackfillsTerminal() || busy || timers || state.hot.refreshTimer) return;
      updateNostrRefreshProgress({ active: false, phase: "完成", finishedAt: Date.now(), indexed: state.hot.items.length });
      toast(`榜单刷新完成：${state.hot.items.length}条`);
    }

    function setRelayStatus(relay, value) {
      state.relay.statuses[relay] = value;
      renderConnection();
    }

    function relayFailedAll() {
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      const failed = relays.filter((relay) => {
        const value = state.relay.statuses[relay];
        return value === "失败" || value === "断开";
      }).length;
      return failed >= relays.length;
    }

    function nostrReadyForFallback() {
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      return state.recommendationSource === "fallback"
        || relayFailedAll()
        || state.relay.subscribeDone >= relays.length
        || Date.now() >= PAGE_OPENED_AT + FALLBACK_SHOW_MS;
    }

    function useFallbackRecommendations() {
      if (preferenceItems().length) {
        useNostrRecommendationsIfReady();
        return;
      }
      if (state.recommendationSource === "fallback") return;
      state.recommendationSource = "fallback";
      ensureRecommendationFallback();
      if (state.activeList === "all") renderActiveGrid();
    }

    function useNostrRecommendationsIfReady() {
      if (!preferenceItems().length) return;
      state.recommendationSource = "nostr";
      clearTimeout(state.relay.fallbackTimer);
      clearTimeout(state.relay.fallbackPrefetchTimer);
      if (state.activeList === "all") renderActiveGrid();
    }

    function finishRelaySubscribe(relay, status) {
      if (state.relay.subscribeFinished[relay]) return;
      state.relay.subscribeFinished[relay] = true;
      if (status) {
        setRelayStatus(relay, status);
        markRelayBackfillTerminal(relay, status === "断开" ? "timeout" : "failed", status);
      }
      state.relay.subscribeDone += 1;
      if (state.relay.subscribeDone >= window.WEBHOME_CONFIG.nostr.relays.length) {
        if (preferenceItems().length === 0) {
          setStatus("nostr", relayFailedAll() ? "连接失败" : "无推荐数据");
          useFallbackRecommendations();
        }
      }
      if (state.activeList === "all") renderActiveGrid();
    }

    function renderConnection() {
      if (!$("connectionDot")) return;
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      const relayValues = relays.map((relay) => `${shortRelay(relay)} ${state.relay.statuses[relay] || "等待"}`);
      const connected = Object.values(state.relay.statuses).filter((value) => value === "已连接").length;
      const failed = Object.values(state.relay.statuses).filter((value) => value === "失败" || value === "断开").length;
      const tmdbOk = state.status.tmdb.includes("成功") || state.status.tmdb.includes("完成");
      const nostrOk = connected > 0;
      const bad = state.status.tmdb.includes("失败") || (!nostrOk && failed === relays.length);
      $("statusSdk").textContent = state.status.sdk;
      $("statusTmdb").textContent = state.status.tmdb;
      $("statusNostr").textContent = `${state.status.nostr} (${connected}/${relays.length})`;
      if ($("statusPan")) $("statusPan").textContent = state.status.pan || "未搜索";
      $("statusPublish").textContent = state.status.publish;
      $("statusIdentity").textContent = state.status.identity;
      if ($("statusRefresh")) $("statusRefresh").textContent = state.status.refresh || "未执行";
      $("statusRelays").textContent = relayValues.join(" · ");
      if ($("refreshNostrBtn")) $("refreshNostrBtn").textContent = state.relay.refresh && state.relay.refresh.active ? "刷新中" : "刷新榜单";
      renderUiPrefsControls();
      $("connectionDot").className = "dot " + (nostrOk ? "ok" : bad ? "bad" : "warn");
      fitConnectionPanel();
    }

    function fitConnectionPanel() {
      const dock = $("connectionDock");
      const body = $("connectionBody");
      if (!dock || !body) return;
      body.style.setProperty("--connection-shift", "0px");
      const host = $("connectionOverlayHost");
      if (host && body.parentElement === host) return;
      if (!dock.classList.contains("open")) return;
      requestAnimationFrame(() => {
        const rect = body.getBoundingClientRect();
        const pad = 8;
        let shift = 0;
        if (rect.left < pad) shift = pad - rect.left;
        if (rect.right + shift > window.innerWidth - pad) shift = window.innerWidth - pad - rect.right;
        body.style.setProperty("--connection-shift", `${Math.round(shift)}px`);
      });
    }

    function setConnectionPanelOpen(open) {
      const dock = $("connectionDock");
      const body = $("connectionBody");
      const toggle = $("connectionToggle");
      const host = $("connectionOverlayHost");
      const overlayBackdrop = $("connectionOverlayBackdrop");
      if (!dock || !body) return;
      const isOpen = !!open;
      if (isOpen) ensureConnectionHistoryEntry();
      dock.classList.toggle("open", isOpen);
      body.classList.toggle("open", isOpen);
      if (host) {
        host.hidden = !isOpen;
        host.classList.toggle("open", isOpen);
        host.setAttribute("aria-hidden", isOpen ? "false" : "true");
      }
      if (overlayBackdrop) {
        overlayBackdrop.hidden = !isOpen;
        overlayBackdrop.setAttribute("aria-hidden", isOpen ? "false" : "true");
      }
      if (toggle) toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      body.setAttribute("aria-hidden", isOpen ? "false" : "true");
      if (isOpen) disableConnectionTextEditing();
      else if (isTvLikeDevice() && body.contains(document.activeElement) && toggle) requestAnimationFrame(() => focusRemoteTarget(toggle));
      fitConnectionPanel();
      syncSidebarMobilePresentation();
      scheduleUiSnapshotSave();
    }

    function toggleConnectionPanel(event) {
      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      const open = !$("connectionDock").classList.contains("open");
      setConnectionPanelOpen(open);
      if (open) revealConnectionPanel();
    }

    function revealConnectionPanel() {
      const panel = $("connectionBody");
      if (!panel || !panel.classList.contains("open")) return false;
      if (isTvLikeDevice()) panel.scrollTop = 0;
      requestAnimationFrame(() => {
        if (!panel.isConnected || !panel.classList.contains("open")) return;
        panel.style.maxHeight = "";
        if (isTvLikeDevice()) panel.scrollTop = 0;
        requestAnimationFrame(() => {
          if (!panel.isConnected || !panel.classList.contains("open")) return;
          if (isTvLikeDevice()) panel.scrollTop = 0;
          const target = connectionPanelItems()[0];
          if (target) focusRemoteTarget(target);
        });
      });
      return true;
    }

    function abortRelayQuerySockets() {
      Array.from(state.relay.queryAborters || []).forEach((abort) => {
        try { abort(); } catch (e) {}
      });
      state.relay.queryAborters = new Set();
    }

    function abortRelaySubscriptionSockets() {
      Array.from(state.relay.subscriptionAborters || []).forEach((abort) => {
        try { abort(); } catch (e) {}
      });
      state.relay.subscriptionAborters = new Set();
    }

    function clearRelayBackfillTimers() {
      abortRelayQuerySockets();
      abortRelaySubscriptionSockets();
      Object.values(state.relay.backfillTimers).forEach((timer) => clearTimeout(timer));
      state.relay.backfillTimers = {};
      clearTimeout(state.hot.refreshTimer);
      state.hot.refreshTimer = 0;
    }

    function resetRelaySubscribeState() {
      const generation = ++state.relay.subscribeToken;
      abortRelayQuerySockets();
      abortRelaySubscriptionSockets();
      Object.values(state.relay.backfillTimers || {}).forEach((timer) => clearTimeout(timer));
      state.relay.connected = 0;
      state.relay.subscribeDone = 0;
      state.relay.subscribeFinished = {};
      state.relay.statuses = {};
      state.relay.backfillBusy = {};
      state.relay.backfillTimers = {};
      state.relay.backfillState = {};
      window.WEBHOME_CONFIG.nostr.relays.forEach((relay) => getRelayBackfillState(relay));
      return generation;
    }

    function connectionHistoryEntryActive() {
      const current = history.state;
      return isTvLikeDevice()
        && location.hash === "#connection"
        && !!(current && current.sheet === "connection" && current.connectionTransient === true);
    }

    function ensureConnectionHistoryEntry() {
      if (!isTvLikeDevice() || connectionHistoryEntryActive()) return false;
      const current = history.state && typeof history.state === "object" ? history.state : {};
      const returnState = Object.assign({}, current);
      if (returnState.sheet === "connection") returnState.sheet = "home";
      delete returnState.connectionTransient;
      delete returnState.connectionReturnUrl;
      delete returnState.connectionReturnState;
      if (!returnState.sheet) returnState.sheet = "home";
      const returnHash = location.hash === "#connection" ? "" : location.hash;
      const returnUrl = location.pathname + location.search + returnHash;
      const nextState = Object.assign({}, current, {
        sheet: "connection",
        connectionTransient: true,
        connectionReturnUrl: returnUrl,
        connectionReturnState: returnState
      });
      try {
        if (location.hash === "#connection") history.replaceState(nextState, "", "#connection");
        else history.pushState(nextState, "", "#connection");
        return true;
      } catch (e) {
        return false;
      }
    }

    function clearConnectionHistoryEntry() {
      if (!isTvLikeDevice() || location.hash !== "#connection") return false;
      const current = history.state && typeof history.state === "object" ? history.state : {};
      const nextState = current.connectionReturnState && typeof current.connectionReturnState === "object"
        ? Object.assign({}, current.connectionReturnState)
        : Object.assign({}, current);
      delete nextState.connectionTransient;
      delete nextState.connectionReturnUrl;
      delete nextState.connectionReturnState;
      if (nextState.sheet === "connection" || !nextState.sheet) nextState.sheet = "home";
      const returnUrl = current.connectionReturnUrl || (location.pathname + location.search);
      try {
        history.replaceState(nextState, "", returnUrl);
        return true;
      } catch (e) {
        return false;
      }
    }

    function closeConnectionPanel(options) {
      const opts = options || {};
      if (opts.fromPopState !== true) clearConnectionHistoryEntry();
      setConnectionPanelOpen(false);
    }

    function shortRelay(url) {
      return String(url || "").replace(/^wss?:\/\//, "").replace(/\/$/, "");
    }

    async function browserRequest(url, options) {
      const init = options || {};
      try {
        const response = await fetch(url, {
          method: init.method || "GET",
          headers: init.headers || {},
          body: init.method && init.method !== "GET" && init.method !== "HEAD" ? init.body || "" : undefined,
          credentials: init.credentials === "include" ? "include" : "same-origin"
        });
        const headers = {};
        response.headers.forEach((value, key) => headers[key] = value);
        const body = init.responseType === "json" ? await response.json() : await response.text();
        return { ok: response.ok, status: response.status, url: response.url, headers, body };
      } catch (e) {
        throw e;
      }
    }

    async function requestJson(url, timeout) {
      const response = await sdk().req(url, { responseType: "text", timeout: timeout || 18 });
      if (response && response.error) throw new Error(response.error);
      const body = response && response.body;
      if (typeof body === "string") return JSON.parse(body || "{}");
      return body || {};
    }

    async function postJson(url, payload, timeout, headers) {
      const response = await sdk().req(url, {
        method: "POST",
        responseType: "text",
        timeout: timeout || 24,
        headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
        body: JSON.stringify(payload || {})
      });
      if (response && response.error) throw new Error(response.error);
      if (response && response.ok === false) throw new Error("HTTP " + (response.status || 0));
      const body = response && response.body;
      const data = typeof body === "string" ? JSON.parse(body || "{}") : body || {};
      if (data && data.code && Number(data.code) !== 0 && Number(data.code) !== 200) throw new Error(data.message || data.error || ("HTTP " + data.code));
      return data;
    }

    const PAN_INITIAL_SEARCH_MAX_ATTEMPTS = 3;
    const PAN_POLL_MAX_ATTEMPTS = 2;
    const PAN_INITIAL_RETRY_DELAYS = [700, 1600];
    const PAN_POLL_RETRY_DELAYS = [700];
    const PAN_INITIAL_ATTEMPT_TIMEOUT_MS = 8000;
    const PAN_POLL_ATTEMPT_TIMEOUT_MS = 6000;
    const PAN_INITIAL_TOTAL_DEADLINE_MS = 24000;
    const PAN_SEARCH_TIMEOUT_CODE = "PAN_SEARCH_TIMEOUT";
    const PAN_SEARCH_TIMEOUT_MESSAGE = "盘搜响应超时";
    const PAN_DIRECT_ATTEMPT_TIMEOUT_MS = 6000;
    const PAN_FOREGROUND_ATTEMPT_TIMEOUT_MS = 6000;
    const PAN_DIRECT_RETRY_DELAYS = [500, 900];
    const PAN_FOREGROUND_RETRY_DELAYS = [500, 900];
    const DIRECT_PLAY_WAIT_BUDGET_MS = 20000;
    const PLAYBACK_PREFLIGHT_TIMEOUT_MS = 1800;
    const PLAYBACK_SNAPSHOT_TIMEOUT_MS = 800;
    const DIRECT_PLAY_STATUS_PAN_PLAY_UI_FALLBACK_MS = 3000;
    const DIRECT_PLAY_STATUS_FINAL_ERROR_MS = 2500;
    const PAN_SEARCH_SESSION_MAX_MS = 60000;

    const DIRECT_PLAY_STATUS_TEXT = {
      BACKGROUND_PREPARING: "正在准备播放资源…",
      REQUESTED_PREPARING: "资源准备中，准备完成后自动播放…",
      READY: "播放资源已准备好",
      SEARCHING: "正在查找可播放资源…",
      RETRYING: "资源搜索响应较慢，正在重新尝试…",
      POLLING: "暂未找到可直播放资源，正在继续查找…",
      FOUND_QB: "已找到可播放资源，正在准备播放…",
      STARTING_PLAYER: "正在启动播放器…",
      FINAL_ERROR: "暂时无法启动播放"
    };

    function directPlayStatusTextKey(phase) {
      const value = String(phase || "");
      if (value === "SEARCHING" || value === "INITIAL" || value === "INITIAL_SEARCHING") return "SEARCHING";
      if (value === "RETRYING" || value === "RETRY") return "RETRYING";
      if (value === "POLLING" || /^POLL(?:_|$)/.test(value)) return "POLLING";
      if (value === "FOUND_QB") return "FOUND_QB";
      if (value === "BACKGROUND_PREPARING" || value === "REQUESTED_PREPARING" || value === "READY") return value;
      if (["PICK_START", "CANDIDATE_BEFORE", "CANDIDATE_AFTER", "HEALTH_CHECK_START", "HEALTH_CHECK_OK", "HEALTH_CHECK_TIMEOUT", "PICK_DONE", "SNAPSHOT_START", "SNAPSHOT_OK", "SNAPSHOT_TIMEOUT", "PAN_PLAY_CALLED"].includes(value)) return "STARTING_PLAYER";
      if (["TERMINAL_NO_QB", "WAIT_BUDGET_EXPIRED", "DIRECT_TRANSPORT_EXHAUSTED"].includes(value)) return "FINAL_ERROR";
      if (value === "FINAL_ERROR") return "FINAL_ERROR";
      return "";
    }

    function renderDirectPlayStatus(target) {
      const status = state.directPlayStatus || {};
      const row = $("directPlayStatus");
      const text = $("directPlayStatusText");
      if (!row || !text) return;
      const sheet = $("detailSheet");
      const hiddenByFocus = detailPlaybackStatusHiddenFor(target || document.activeElement)
        || !!(sheet && sheet.classList.contains("active") && sheet.classList.contains("detail-focus-below-episodes"));
      const hidden = !status.active || hiddenByFocus;
      row.hidden = hidden;
      if (hidden) row.style.setProperty("display", "none", "important");
      else row.style.removeProperty("display");
      text.textContent = status.active ? String(status.text || "") : "";
    }

    function recordDirectPlayStatusDiag(actionId, phase, textKey, visible, reason) {
      if (!isTvDiagnosticEnabled()) return null;
      const status = state.directPlayStatus || {};
      const diag = {
        actionId: Number(actionId || 0),
        phase: String(phase || ""),
        visible: !!visible,
        textKey: String(textKey || ""),
        elapsedMs: status.startedAt ? Math.max(0, Date.now() - Number(status.startedAt || 0)) : 0,
        reason: String(reason || "")
      };
      state.tvDiag.directPlayStatus = diag;
      try { console.debug("[Nostr TV] DIRECT_PLAY_STATUS_DIAG", diag); } catch (e) {}
      updateTvDiagnostic();
      return diag;
    }

    function clearDirectPlayStatus(actionId, reason) {
      const status = state.directPlayStatus || {};
      const requestedId = Number(actionId || 0);
      if (requestedId && status.actionId && requestedId !== Number(status.actionId)) return false;
      clearTimeout(status.clearTimer);
      const currentId = Number(status.actionId || requestedId || 0);
      const wasVisible = !!status.active;
      state.directPlayStatus = {
        active: false,
        actionId: currentId,
        phase: "CLEARED",
        text: "",
        textKey: "CLEARED",
        startedAt: Number(status.startedAt || 0),
        clearTimer: 0
      };
      renderDirectPlayStatus();
      if (state.selected && $("detailSheet") && $("detailSheet").classList.contains("active")) updateDetailContinueButton();
      if (wasVisible || requestedId) recordDirectPlayStatusDiag(currentId, "CLEARED", "CLEARED", false, reason);
      return true;
    }

    function showDirectPlayStatus(actionId, phase, text, reason) {
      const id = Number(actionId || 0);
      const current = state.directPlayStatus || {};
      const detailRun = state.detailPlayback;
      if (detailRun && Number(detailRun.raceActionToken || 0) === id) return false;
      if (!id || current.actionId > id || current.actionId === id && !current.active) return false;
      clearTimeout(current.clearTimer);
      const textKey = directPlayStatusTextKey(phase) || String(phase || "");
      state.directPlayStatus = {
        active: true,
        actionId: id,
        phase: String(phase || ""),
        text: String(text || DIRECT_PLAY_STATUS_TEXT[textKey] || ""),
        textKey,
        startedAt: current.actionId === id && current.startedAt ? current.startedAt : Date.now(),
        clearTimer: 0
      };
      renderDirectPlayStatus();
      if (state.selected && $("detailSheet") && $("detailSheet").classList.contains("active")) updateDetailContinueButton();
      recordDirectPlayStatusDiag(id, state.directPlayStatus.phase, textKey, true, reason || "start");
      return true;
    }

    function updateDirectPlayStatus(actionId, phase, text, reason) {
      const current = state.directPlayStatus || {};
      const id = Number(actionId || 0);
      if (!current.active || !id || Number(current.actionId) !== id) return false;
      return showDirectPlayStatus(id, phase, text, reason || "stage");
    }

    function armDirectPlayStatusUiFallback(actionId) {
      const current = state.directPlayStatus || {};
      const id = Number(actionId || 0);
      if (!current.active || !id || Number(current.actionId) !== id) return false;
      clearTimeout(current.clearTimer);
      current.clearTimer = setTimeout(() => clearDirectPlayStatus(id, "ui_fallback"), DIRECT_PLAY_STATUS_PAN_PLAY_UI_FALLBACK_MS);
      return true;
    }

    function syncDirectPlayStatusFromStage(stage, item, action) {
      if (action && action.raceMode) return;
      if (!action || !state.directPlayStatus || Number(state.directPlayStatus.actionId) !== Number(action.token) || !state.directPlayStatus.active) return;
      const value = String(stage || "");
      if (value === "CANCELLED") {
        clearDirectPlayStatus(action.token, "cancelled");
        return;
      }
      const textKey = directPlayStatusTextKey(value);
      if (!textKey) return;
      if (action.prepareOnly && value !== "PAN_PLAY_CALLED") {
        const prepareKey = action.playRequested ? "REQUESTED_PREPARING" : "BACKGROUND_PREPARING";
        updateDirectPlayStatus(action.token, prepareKey, DIRECT_PLAY_STATUS_TEXT[prepareKey], "prepare_stage");
        return;
      }
      updateDirectPlayStatus(action.token, value, DIRECT_PLAY_STATUS_TEXT[textKey], "stage");
      if (value === "PAN_PLAY_CALLED") armDirectPlayStatusUiFallback(action.token);
      if (value === "FINAL_ERROR") {
        const current = state.directPlayStatus;
        clearTimeout(current.clearTimer);
        current.clearTimer = setTimeout(() => clearDirectPlayStatus(action.token, "final_error_timeout"), DIRECT_PLAY_STATUS_FINAL_ERROR_MS);
      }
    }

    function clearDirectPlayStatusAfterPanOpen(actionId, reason) {
      const block = $("panSearchBlock");
      if (!block || !block.classList.contains("active") || block.style.display === "none") return false;
      return clearDirectPlayStatus(actionId, reason || "pan_open");
    }

    function clearDirectPlayStatusOnNativeTakeover(reason) {
      const status = state.directPlayStatus || {};
      if (!status.active || !state.pan || !state.pan.isPlaying) return false;
      return clearDirectPlayStatus(status.actionId, reason || "native_takeover");
    }

    function panErrorStatus(error) {
      const direct = Number(error && (error.status || error.statusCode || error.httpStatus || 0));
      if (direct >= 100 && direct <= 599) return direct;
      const message = String(error && (error.message || error.error) || error || "");
      const match = message.match(/\b(?:HTTP(?:\s+status)?\s*)?(4\d{2}|5\d{2})\b/i);
      return match ? Number(match[1]) : 0;
    }

    function classifyPanRequestError(error) {
      if (error && error.code === PAN_SEARCH_TIMEOUT_CODE) return "timeout";
      const status = panErrorStatus(error);
      const message = String(error && (error.message || error.error) || error || "");
      if (status === 401 || status === 403 || /\b(?:401|403)\b|unauthori[sz]ed|forbidden/i.test(message)) return "auth";
      if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return "http_transient";
      if (error && (error.panBusiness === true || error.code === "PAN_BUSINESS_ERROR")) return "business";
      if (/failed to fetch|networkerror|network request failed|load failed|connection reset|connection closed|socket closed|unexpected end of stream|eofexception|econnreset|econnrefused|etimedout|timeout|timed out/i.test(message)) return "network";
      return status ? "request" : "request";
    }

    function panRequestFailureIsRetryable(kind) {
      return ["timeout", "network", "http_transient"].includes(String(kind || ""));
    }

    function panRetryStatusText(kind) {
      switch (String(kind || "")) {
        case "timeout": return "盘搜响应超时，正在重新请求…";
        case "network": return "盘搜连接异常，正在重新请求…";
        case "http_transient": return "盘搜服务响应异常，正在重新请求…";
        default: return "盘搜请求异常，正在重新请求…";
      }
    }

    function panFinalFailureStatusText(kind) {
      switch (String(kind || "")) {
        case "timeout": return "盘搜连接超时，请稍后重试";
        case "network": return "连接失败，请手动重试";
        case "http_transient": return "盘搜服务暂时不可用，请稍后重试";
        case "auth": return "盘搜认证失败，请检查配置";
        case "business": return "盘搜返回业务错误，请稍后重试";
        default: return "盘搜请求失败，请稍后重试";
      }
    }

    function waitForPanRetry(delay, isCurrent) {
      const wait = Math.max(0, Number(delay || 0));
      return new Promise((resolve) => {
        const end = Date.now() + wait;
        let timer = 0;
        const check = () => {
          if (!isCurrent() || Date.now() >= end) {
            clearInterval(timer);
            resolve(isCurrent());
          }
        };
        timer = setInterval(check, 50);
        check();
      });
    }

    function createPanSearchTimeoutError() {
      const error = new Error(PAN_SEARCH_TIMEOUT_MESSAGE);
      error.code = PAN_SEARCH_TIMEOUT_CODE;
      return error;
    }

    function panSearchRequestResult(error) {
      return classifyPanRequestError(error);
    }

    function recordPanSearchRequestDiag(options, startedAt, timeoutMs, result) {
      if (!isTvDiagnosticEnabled()) return null;
      const opts = options || {};
      const phase = String(opts.phase || "");
      const resultName = String(result || "");
      const failureKind = String(opts.failureKind || (["success", "stale", "none"].includes(resultName) ? "none" : resultName));
      const diag = {
        mode: String(opts.mode || (phase === "poll" ? "poll" : "foreground")),
        phase,
        round: Math.max(0, Number(opts.round || 0)),
        attempt: Math.max(0, Number(opts.attempt || 0)),
        elapsedMs: Math.max(0, Date.now() - Number(startedAt || Date.now())),
        timeoutMs: Math.max(0, Number(timeoutMs || 0)),
        requestTimeout: Math.max(0, Number(timeoutMs || 0)),
        retryIndex: Math.max(0, Number(opts.attempt || 1) - 1),
        failureKind,
        retryRemaining: Math.max(0, Number(opts.retryRemaining || 0)),
        finalFailure: !!opts.finalFailure,
        lifecycleBefore: String(opts.lifecycleBefore || ""),
        lifecycleAfter: String(state.pan && state.pan.progress && state.pan.progress.phase || ""),
        resultCount: Number(state.pan && state.pan.results && state.pan.results.length || 0),
        actualRequestAttempts: Math.max(0, Number(state.pan && state.pan.actualRequestAttempts || 0)),
        result: resultName
      };
      state.tvDiag.panSearchRequest = diag;
      refreshDirectPlaySessionDiag();
      refreshForegroundSessionDiag();
      try { console.debug("[Nostr TV] PAN_SEARCH_REQUEST_DIAG", diag); } catch (e) {}
      updateTvDiagnostic();
      return diag;
    }

    function panSearchItemKey(item) {
      if (!item) return "";
      const type = String(item.mediaType || item.media_type || "");
      const id = item.tmdbId != null ? item.tmdbId : item.id != null ? item.id : item.title || "";
      return `${type}|${id}|${String(item.title || "").trim()}`;
    }

    function clearPanPollTimers() {
      const timers = state.pan && Array.isArray(state.pan.pollTimers) ? state.pan.pollTimers : [];
      timers.forEach((timer) => clearTimeout(timer));
      if (state.pan) state.pan.pollTimers = [];
    }

    function clearPanSessionTimer() {
      if (!state.pan) return;
      clearTimeout(state.pan.sessionTimer);
      state.pan.sessionTimer = 0;
    }

    function isPanSearchSessionCurrent(item, token, sessionId, allowTerminal) {
      const pan = state.pan;
      return !!(pan && Number(sessionId || 0) > 0
        && Number(pan.sessionId || 0) === Number(sessionId || 0)
        && pan.viewToken === token
        && state.selected === item
        && pan.keyword
        && (!pan.sessionTerminal || allowTerminal));
    }

    function isPanSearchSessionActive(item, token, sessionId) {
      const pan = state.pan;
      return isPanSearchSessionCurrent(item, token, sessionId, false) && !isPanSearchSessionHardExpired(pan);
    }

    function isPanSearchSessionHardExpired(pan) {
      const startedAt = Number(pan && pan.sessionStartedAt || 0);
      return !!(startedAt && Date.now() - startedAt >= PAN_SEARCH_SESSION_MAX_MS);
    }

    function recordPanSearchSessionDiag(event, reason) {
      const pan = state.pan;
      if (!pan || !pan.sessionId) return null;
      const startedAt = Number(pan.sessionStartedAt || 0);
      const diag = {
        event: String(event || ""),
        sessionId: Number(pan.sessionId || 0),
        origin: String(pan.sessionOrigin || ""),
        keyword: String(pan.keyword || ""),
        startedAt,
        elapsedMs: Math.max(0, Date.now() - startedAt),
        initialAttempts: Math.max(0, Number(pan.initialAttempts || 0)),
        pollRoundsStarted: Math.max(0, Number(pan.pollRoundsStarted || 0)),
        pollRoundsCompleted: Math.max(0, Number(pan.pollRoundsCompleted || 0)),
        foregroundRecoveryCount: Math.max(0, Number(pan.foregroundRecoveryCount || 0)),
        resultCount: Number(pan.results && pan.results.length || 0),
        actualRequestAttempts: Math.max(0, Number(pan.actualRequestAttempts || 0)),
        terminal: !!pan.sessionTerminal,
        terminalReason: String(reason || pan.sessionTerminalReason || "")
      };
      pan.sessionDiag = diag;
      if (state.tvDiag) state.tvDiag.panSearchSession = diag;
      refreshDirectPlaySessionDiag();
      refreshForegroundSessionDiag(diag.terminal ? diag.terminalReason : "");
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV] PAN_SEARCH_SESSION_DIAG", diag); } catch (e) {}
        updateTvDiagnostic();
      }
      return diag;
    }

    function endPanSearchSession(reason) {
      const pan = state.pan;
      if (!pan || !pan.sessionId || pan.sessionEndRecorded) return false;
      pan.sessionTerminal = true;
      pan.sessionTerminalReason = String(reason || pan.sessionTerminalReason || "ended");
      pan.sessionEndRecorded = true;
      pan.sessionEndCount = Math.max(0, Number(pan.sessionEndCount || 0) + 1);
      clearPanSessionTimer();
      recordPanSearchSessionDiag("SESSION_END", pan.sessionTerminalReason);
      return true;
    }

    function startPanSearchSession(item, keyword, origin, options) {
      const pan = state.pan;
      const opts = options || {};
      const sessionId = Number(pan.lifecycleSeq || 0) + 1;
      pan.lifecycleSeq = sessionId;
      pan.sessionId = sessionId;
      pan.sessionOrigin = ["manual", "direct", "foreground_recovery", "preload"].includes(String(origin || "")) ? String(origin) : "manual";
      pan.sessionItemKey = panSearchItemKey(item);
      pan.sessionStartedAt = Date.now();
      pan.sessionTerminal = false;
      pan.sessionTerminalReason = "";
      pan.sessionEndRecorded = false;
      pan.sessionStartCount = Math.max(0, Number(pan.sessionStartCount || 0) + 1);
      pan.directReady = null;
      pan.directFailure = null;
      clearPanSessionTimer();
      clearPanPollTimers();
      // requestSeq is scoped to the current execution lifecycle. Session guards
      // (sessionId + viewToken) remain the authoritative stale-callback barrier.
      pan.requestSeq = 0;
      pan.actualRequestAttempts = 0;
      pan.initialAttempts = 0;
      pan.pollRound = 0;
      pan.pollRoundsStarted = 0;
      pan.pollRoundsCompleted = 0;
      pan.pollRoundStarted = {};
      pan.foregroundRecoveryCount = Math.max(0, Number(opts.foregroundRecoveryCount || 0));
      pan.keyword = keyword;
      pan.retryRemaining = 0;
      pan.finalFailure = false;
      pan.directTransportExhausted = false;
      pan.sessionDiag = null;
      recordPanSearchSessionDiag("SESSION_START", "");
      return sessionId;
    }

    function armPanSearchSessionHardGuard(item, token, sessionId) {
      clearPanSessionTimer();
      const startedAt = Number(state.pan.sessionStartedAt || Date.now());
      const remaining = Math.max(1, PAN_SEARCH_SESSION_MAX_MS - Math.max(0, Date.now() - startedAt));
      state.pan.sessionTimer = setTimeout(() => {
        if (!isPanSearchSessionCurrent(item, token, sessionId, false)) return;
        terminalizePanSearchSession(token, item, sessionId, "hard_timeout");
      }, remaining);
    }

    function terminalizePanSearchSession(token, item, sessionId, reason, options) {
      const pan = state.pan;
      const opts = options || {};
      if (!isPanSearchSessionCurrent(item, token, sessionId, true)) return false;
      if (pan.sessionTerminal && pan.sessionEndRecorded) return false;
      const total = Number(pan.results && pan.results.length || 0);
      const failureKind = String(opts.failureKind || pan.lastFailureKind || "");
      const configuredRounds = Number(opts.totalRounds || (pan.progress && pan.progress.totalRounds) || pan.pollRound || 0);
      const emptyComplete = !total && (String(reason || "") === "complete_empty"
        || (pan.initialSucceeded && ["complete", "poll_failure", "hard_timeout"].includes(String(reason || ""))));
      const hardTimeout = String(reason || "") === "hard_timeout";
      let phase = "complete";
      if (emptyComplete) phase = "complete-empty";
      else if (hardTimeout && !total) phase = "session-timeout";
      else if (String(reason || "") === "initial_failure") phase = "initial-failed";
      if (phase !== "complete") pan.directReady = null;
      pan.loading = false;
      clearPanPollTimers();
      pan.pollRound = Math.max(0, Number(pan.pollRound || 0));
      pan.pollRoundsCompleted = Math.max(Number(pan.pollRoundsCompleted || 0), pan.pollRound);
      pan.finalFailure = phase === "initial-failed" || phase === "session-timeout" && !pan.initialSucceeded;
      if (phase === "complete-empty") {
        pan.lastFailureKind = failureKind;
        setPanProgress(false, "complete-empty", pan.pollRound, configuredRounds);
        setPanStatus("未找到盘搜资源");
      } else if (phase === "session-timeout") {
        pan.lastFailureKind = failureKind || "timeout";
        setPanProgress(false, "session-timeout", pan.pollRound, configuredRounds);
        setPanStatus(total ? `找到 ${total} 条` : panFinalFailureStatusText(pan.lastFailureKind));
      } else if (phase === "initial-failed") {
        pan.lastFailureKind = failureKind || "request";
        setPanProgress(false, "initial-failed", 0, configuredRounds);
        setPanStatus(panFinalFailureStatusText(pan.lastFailureKind));
      } else {
        pan.lastFailureKind = failureKind;
        setPanProgress(false, "complete", pan.pollRound, configuredRounds);
        setPanStatus(total ? `找到 ${total} 条` : "未找到盘搜资源");
      }
      pan.sessionTerminal = true;
      pan.sessionTerminalReason = String(reason || phase);
      endPanSearchSession(pan.sessionTerminalReason);
      if (opts.render !== false && isPanSearchActive()) {
        renderPanResults();
        scheduleUiSnapshotSave();
      }
      return true;
    }

    async function requestPanSearchAttempt(item, token, keyword, config, headers, options) {
      const opts = options || {};
      const phase = String(opts.phase || "initial");
      const attempt = Math.max(1, Number(opts.attempt || 1));
      const baseTimeout = Math.max(1, Number(opts.attemptTimeoutMs || (phase === "poll" ? PAN_POLL_ATTEMPT_TIMEOUT_MS : PAN_INITIAL_ATTEMPT_TIMEOUT_MS)));
      const deadlineAt = Number(opts.deadlineAt || 0);
      const sessionId = Number(opts.sessionId || 0);
      if (phase === "initial" && sessionId && state.pan.sessionId === sessionId && !state.pan.sessionTerminal) {
        state.pan.initialAttempts = Math.max(Number(state.pan.initialAttempts || 0), attempt);
      }
      const remaining = deadlineAt ? deadlineAt - Date.now() : baseTimeout;
      if (remaining <= 0) {
        const timeoutError = createPanSearchTimeoutError();
        recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, failureKind: "timeout", retryRemaining: Math.max(0, Number(opts.maxAttempts || 1) - attempt), finalFailure: false }), opts.startedAt || Date.now(), 0, "timeout");
        throw timeoutError;
      }
      const timeoutMs = Math.max(1, Math.min(baseTimeout, remaining));
      const startedAt = Date.now();
      const requestSeq = ++state.pan.requestSeq;
      const isCurrent = () => sessionId ? isPanSearchSessionActive(item, token, sessionId) : state.pan.viewToken === token && state.selected === item && state.pan.keyword === keyword;
      let timedOut = false;
      let timer = 0;
      const actualRequest = Promise.resolve().then(() => {
        state.pan.actualRequestAttempts = Math.max(0, Number(state.pan.actualRequestAttempts || 0)) + 1;
        return postJson(panApi("/api/search"), panSearchPayload(keyword, config), 28, headers);
      });
      actualRequest.then(() => {
        if (timedOut) recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, failureKind: "none" }), startedAt, timeoutMs, "stale");
      }, () => {
        if (timedOut) recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, failureKind: "none" }), startedAt, timeoutMs, "stale");
      });
      const timeoutRequest = new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(createPanSearchTimeoutError());
        }, timeoutMs);
      });
      try {
        const body = await Promise.race([actualRequest, timeoutRequest]);
        if (!isCurrent() || state.pan.requestSeq !== requestSeq) {
          recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, failureKind: "none" }), startedAt, timeoutMs, "stale");
          return null;
        }
        recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, failureKind: "none" }), startedAt, timeoutMs, "success");
        return body;
      } catch (error) {
        const failureKind = panSearchRequestResult(error);
        recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, failureKind, retryRemaining: Math.max(0, Number(opts.maxAttempts || 1) - attempt), finalFailure: false }), startedAt, timeoutMs, failureKind);
        throw error;
      } finally {
        clearTimeout(timer);
      }
    }

    async function requestPanSearchWithRetry(item, token, keyword, config, headers, options) {
      const opts = options || {};
      const maxAttempts = Math.max(1, Number(opts.maxAttempts || PAN_INITIAL_SEARCH_MAX_ATTEMPTS));
      const delays = Array.isArray(opts.retryDelays) && opts.retryDelays.length ? opts.retryDelays : PAN_INITIAL_RETRY_DELAYS;
      const sessionId = Number(opts.sessionId || 0);
      const isCurrent = () => sessionId ? isPanSearchSessionActive(item, token, sessionId) : state.pan.viewToken === token && state.selected === item && state.pan.keyword === keyword;
      const startedAt = Date.now();
      const deadlineAt = opts.totalDeadlineMs ? startedAt + Math.max(0, Number(opts.totalDeadlineMs)) : 0;
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (!isCurrent()) return null;
        if (deadlineAt && Date.now() >= deadlineAt) {
          const timeoutError = createPanSearchTimeoutError();
          recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, startedAt, maxAttempts, failureKind: "timeout", retryRemaining: 0, finalFailure: true }), startedAt, 0, "timeout");
          throw timeoutError;
        }
        try {
          const body = await requestPanSearchAttempt(item, token, keyword, config, headers, Object.assign({}, opts, {
            attempt,
            startedAt,
            deadlineAt,
            maxAttempts,
            retryRemaining: Math.max(0, maxAttempts - attempt),
            finalFailure: false
          }));
          if (body === null || !isCurrent()) return null;
          return body;
        } catch (error) {
          lastError = error;
          const failureKind = classifyPanRequestError(error);
          try { error.panFailureKind = failureKind; } catch (e) {}
          const retryable = panRequestFailureIsRetryable(failureKind);
          const remaining = Math.max(0, maxAttempts - attempt);
          if (!retryable || remaining <= 0) {
            try { error.panRetryExhausted = retryable; } catch (e) {}
            recordPanSearchRequestDiag(Object.assign({}, opts, { attempt, startedAt, maxAttempts, failureKind, retryRemaining: 0, finalFailure: true }), startedAt, Number(opts.attemptTimeoutMs || 0), failureKind);
            throw error;
          }
          if (typeof opts.onRetry === "function") opts.onRetry(attempt, remaining, error, failureKind);
          const next = await waitForPanRetry(delays[attempt - 1] == null ? delays[delays.length - 1] : delays[attempt - 1], isCurrent);
          if (!next) return null;
        }
      }
      throw lastError || new Error("盘搜请求失败");
    }

