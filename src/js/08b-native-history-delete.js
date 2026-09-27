    function nativeHistoryDeleteCandidates(item, mediaKey, sourceItems) {
      const nativeItems = Array.isArray(sourceItems)
        ? sourceItems
        : state.recent && Array.isArray(state.recent.items) ? state.recent.items : [];
      if (!nativeItems.length || !mediaKey) return [];
      return nativeItems.filter((nativeItem) => recentWatchingMediaKey(nativeItem) === mediaKey);
    }

    function nativeHistoryHttpOrigin(value) {
      let candidate = String(value || "").trim();
      if (!candidate) return "";
      if (!/^https?:\/\//i.test(candidate)) {
        if (!/^[^\s/]+(?::\d+)?$/.test(candidate)) return "";
        candidate = "http://" + candidate;
      }
      try {
        if (typeof URL === "function") {
          const parsed = new URL(candidate);
          if (/^https?:$/i.test(parsed.protocol)) return parsed.origin;
        }
      } catch (e) {}
      const match = candidate.match(/^(https?:\/\/[^/]+)/i);
      return match ? match[1].replace(/\/+$/, "") : "";
    }

    function nativeHistoryDeleteBaseUrl(device) {
      const envelope = device && typeof device === "object" ? device : {};
      let body = envelope.body;
      if (typeof body === "string") body = safeJson(body, null);
      const source = body && typeof body === "object"
        ? Object.assign({}, envelope, body)
        : envelope.info && typeof envelope.info === "object"
          ? Object.assign({}, envelope, envelope.info)
          : device || {};
      const candidates = [source.ip, source.baseUrl, source.baseURL, source.httpUrl, source.http]
        .map((value) => nativeHistoryHttpOrigin(value))
        .filter(Boolean);
      if (candidates.length) return candidates[0];
      return nativeHistoryHttpOrigin(envelope.url);
    }

    async function nativeHistoryLocalRequestContext(path) {
      const native = window.fm || null;
      const api = native || sdk();
      let request = null;
      if (native && typeof native.req === "function") {
        request = (url, options) => native.req.call(native, url, options);
      } else if (native && native.net && typeof native.net.request === "function") {
        request = (url, options) => native.net.request.call(native.net, url, options);
      } else if (api && typeof api.req === "function") {
        request = (url, options) => api.req.call(api, url, options);
      } else if (api && api.net && typeof api.net.request === "function") {
        request = (url, options) => api.net.request.call(api.net, url, options);
      }
      if (!request) return { error: "REQUEST_UNAVAILABLE" };
      let device = null;
      try {
        if (native && typeof native.device === "function") device = await native.device.call(native);
        else if (native && native.device && typeof native.device.info === "function") device = await native.device.info.call(native.device);
        else if (native && native.device && typeof native.device.info === "object") device = native.device.info;
        else if (api && typeof api.device === "function") device = await api.device.call(api);
        else if (api && api.device && typeof api.device.info === "function") device = await api.device.info.call(api.device);
        else if (api && api.device && typeof api.device.info === "object") device = api.device.info;
      } catch (e) {
        return { error: "DEVICE_INFO_FAILED", message: String(e && e.message || e || "") };
      }
      const baseUrl = nativeHistoryDeleteBaseUrl(device);
      if (!baseUrl) return { error: "LOCAL_API_ADDRESS_UNAVAILABLE" };
      return { request, endpoint: baseUrl + String(path || "") };
    }

    function nativeHistoryDeleteBody(response) {
      const hasNestedBody = !!(response && (response.body != null || response.data != null));
      const body = response && response.body != null ? response.body : response && response.data;
      if (body && typeof body === "object") return body;
      if (typeof body === "string") return safeJson(body, {});
      if (!hasNestedBody && response && typeof response === "object") {
        const resultKeys = ["total", "deleted", "skipped", "failed", "items", "success", "action", "affected", "message"];
        if (resultKeys.some((key) => Object.prototype.hasOwnProperty.call(response, key))) return response;
      }
      return {};
    }

    function nativeHistoryDeleteRawResponse(response) {
      if (response && response.body != null) return response.body;
      if (response && response.data != null) return response.data;
      return response;
    }

    function nativeHistoryDeleteDiagnosticText(value) {
      if (value == null) return "";
      if (typeof value === "string") return value.slice(0, 500);
      try { return JSON.stringify(value).slice(0, 500); } catch (e) { return String(value).slice(0, 500); }
    }

    function isNativeHistoryDeleteProbeRequested() {
      const search = String(window.location && window.location.search || "");
      try {
        return new URLSearchParams(search).get("_native_delete_probe") === "1";
      } catch (e) {
        return /(?:^|[?&])_native_delete_probe=1(?:&|$)/.test(search);
      }
    }

    async function probeNativeHistoryDeleteRoutes() {
      const paths = [
        "/api/playback/progress",
        "/api/playback/progress/delete",
        "/playback/progress/delete"
      ];
      const probes = [];
      for (const path of paths) {
        const requestContext = await nativeHistoryLocalRequestContext(path);
        const probe = {
          PROBE_URL: String(requestContext && requestContext.endpoint || ""),
          PROBE_STATUS: 0,
          PROBE_BODY: "",
          PROBE_ERROR: "",
          PROBE_HEADERS: {}
        };
        if (!requestContext || typeof requestContext.request !== "function") {
          probe.PROBE_ERROR = String(requestContext && requestContext.message || requestContext && requestContext.error || "REQUEST_UNAVAILABLE");
          probes.push(probe);
          continue;
        }
        try {
          const response = await requestContext.request(requestContext.endpoint, {
            method: "OPTIONS",
            responseType: "text",
            timeout: 24,
            headers: { Accept: "application/json" }
          });
          probe.PROBE_STATUS = Number(response && (response.status || response.code) || 0);
          probe.PROBE_BODY = nativeHistoryDeleteDiagnosticText(nativeHistoryDeleteRawResponse(response)).slice(0, 300);
          probe.PROBE_HEADERS = response && response.headers && typeof response.headers === "object" ? response.headers : {};
        } catch (e) {
          probe.PROBE_ERROR = String(e && e.message || e || "REQUEST_FAILED");
        }
        probes.push(probe);
      }
      const diag = { requestedAt: Date.now(), probes };
      state.tvDiag.nativeHistoryDeleteProbe = diag;
      try { console.debug("[Nostr TV][NATIVE_DELETE_ROUTE_PROBE]", diag); } catch (e) {}
      if (isTvDiagnosticEnabled()) updateTvDiagnostic();
      return probes;
    }

    function recordNativeHistoryDeleteDiag(payload, status, data, rawResponse, endpoint) {
      const body = data && typeof data === "object" ? data : {};
      const items = Array.isArray(body.items) ? body.items : [];
      const item = items[0] && typeof items[0] === "object" ? items[0] : {};
      const rawText = nativeHistoryDeleteDiagnosticText(rawResponse);
      const diag = {
        NATIVE_DELETE_ENDPOINT: String(endpoint || ""),
        NATIVE_DELETE_REQUEST: {
          historyKey: String(payload && payload.historyKey || ""),
          siteKey: String(payload && payload.siteKey || ""),
          vodId: String(payload && payload.vodId || ""),
          cid: payload && payload.cid != null ? payload.cid : ""
        },
        NATIVE_DELETE_HTTP_STATUS: Number(status || 0),
        NATIVE_DELETE_BATCH_TOTAL: Number(body.total || 0),
        NATIVE_DELETE_BATCH_APPLIED: Number(body.applied || 0),
        NATIVE_DELETE_BATCH_CREATED: Number(body.created || 0),
        NATIVE_DELETE_BATCH_UPDATED: Number(body.updated || 0),
        NATIVE_DELETE_BATCH_DELETED: Number(body.deleted || 0),
        NATIVE_DELETE_BATCH_SKIPPED: Number(body.skipped || 0),
        NATIVE_DELETE_BATCH_FAILED: Number(body.failed || 0),
        NATIVE_DELETE_ITEM_ACTION: String(item.action || ""),
        NATIVE_DELETE_ITEM_MESSAGE: String(item.message || ""),
        NATIVE_DELETE_ITEM_HISTORY_KEY: String(item.historyKey || ""),
        NATIVE_DELETE_ITEM_SITE_KEY: String(item.siteKey || ""),
        NATIVE_DELETE_ITEM_VOD_ID: String(item.vodId || ""),
        NATIVE_DELETE_RAW_RESPONSE: rawText,
        NATIVE_DELETE_PARSED_BODY: body,
        NATIVE_DELETE_RESPONSE: body
      };
      state.tvDiag.nativeHistoryDelete = diag;
      try { console.debug("NATIVE_DELETE_RAW_RESPONSE =", rawResponse); } catch (e) {}
      try { console.debug("NATIVE_DELETE_PARSED_BODY =", body); } catch (e) {}
      try { console.debug("[Nostr TV][NATIVE_DELETE_DIAG]", JSON.stringify(diag)); } catch (e) {}
      if (isTvDiagnosticEnabled()) updateTvDiagnostic();
      return diag;
    }

    async function deleteNativeHistoryViaLocalApi(history) {
      const requestContext = await nativeHistoryLocalRequestContext("/api/playback/progress/delete");
      if (!requestContext || typeof requestContext.request !== "function") {
        return { ok: false, status: 0, reason: requestContext && requestContext.error || "REQUEST_UNAVAILABLE", message: requestContext && requestContext.message || "" };
      }
      const request = requestContext.request;
      const endpoint = requestContext.endpoint;
      const parts = historyKeyParts(history);
      const context = historyPlaybackContext(history) || {};
      const historyKey = String(history && (history.nativeHistoryKey || history.historyKey || history.key) || parts.key || "").trim();
      const siteKey = String(history && history.siteKey || parts.siteKey || context.siteKey || "").trim();
      const vodId = String(history && history.vodId || parts.vodId || context.vodId || "").trim();
      const cid = String(history && history.cid != null && String(history.cid).trim() ? history.cid : parts.cid || context.cid || "").trim();
      const payload = {};
      if (historyKey) payload.historyKey = historyKey;
      if (siteKey) payload.siteKey = siteKey;
      if (vodId) payload.vodId = vodId;
      if (cid) payload.cid = /^\d+$/.test(cid) ? Number(cid) : cid;
      if (!payload.historyKey && (!payload.siteKey || !payload.vodId)) {
        return { ok: false, status: 0, reason: "NATIVE_HISTORY_KEY_UNAVAILABLE" };
      }
      let response;
      try {
        response = await request(endpoint, {
          method: "POST",
          responseType: "json",
          timeout: 24,
          headers: { "Content-Type": "application/json; charset=utf-8" },
          body: JSON.stringify(payload)
        });
      } catch (e) {
        const message = String(e && e.message || e || "");
        recordNativeHistoryDeleteDiag(payload, 0, { message }, { message }, endpoint);
        return { ok: false, status: 0, reason: "REQUEST_FAILED", endpoint, payload, message: String(e && e.message || e || "") };
      }
      const rawResponse = nativeHistoryDeleteRawResponse(response);
      const data = nativeHistoryDeleteBody(response);
      const status = Number(response && (response.status || response.code) || 0);
      const apiCode = Number(data && data.code);
      const effectiveStatus = status || (apiCode >= 100 ? apiCode : 0);
      const result = { ok: false, status: effectiveStatus, endpoint, payload, data };
      recordNativeHistoryDeleteDiag(payload, effectiveStatus, data, rawResponse, endpoint);
      if (effectiveStatus === 404 || apiCode === 404) {
        result.reason = "ENDPOINT_NOT_FOUND";
        return result;
      }
      if (effectiveStatus === 403 || apiCode === 403) {
        result.reason = "FORBIDDEN";
        result.message = String(data && (data.message || data.error) || "本机 API 修改未开启");
        return result;
      }
      if (response && response.error) {
        result.reason = "REQUEST_ERROR";
        result.message = String(response.error);
        return result;
      }
      if (response && response.ok === false || effectiveStatus >= 400) {
        result.reason = "HTTP_ERROR";
        result.message = String(data && (data.message || data.error) || "HTTP " + effectiveStatus);
        return result;
      }
      const items = Array.isArray(data && data.items) ? data.items : [];
      const deleted = Number(data && data.deleted || 0);
      const skipped = Number(data && data.skipped || 0);
      const failed = Number(data && data.failed || 0);
      const singleAction = String(data && data.action || "").toLowerCase();
      const singleAffected = Number(data && data.affected || 0);
      const singleSuccess = data && data.success === true && singleAction === "deleted" && singleAffected > 0;
      const singleFailure = data && data.success === false || singleAction === "skipped" || singleAction === "failed";
      const hasFailedItem = items.some((item) => String(item && item.action || "").toLowerCase() === "failed");
      const hasSkippedItem = items.some((item) => String(item && item.action || "").toLowerCase() === "skipped");
      const hasDeletedItem = items.some((item) => String(item && item.action || "").toLowerCase() === "deleted" && Number(item && item.affected || 0) > 0);
      const confirmed = !singleFailure && !hasFailedItem && failed <= 0
        && !hasSkippedItem && skipped <= 0
        && (deleted > 0 || hasDeletedItem || singleSuccess);
      if (!confirmed) {
        result.reason = singleFailure || hasFailedItem || failed > 0 ? "DELETE_FAILED" : hasSkippedItem || skipped > 0 ? "DELETE_SKIPPED" : "DELETE_NOT_CONFIRMED";
        const firstItem = items[0] && typeof items[0] === "object" ? items[0] : {};
        const message = String(firstItem.message || data && (data.message || data.error) || "");
        result.message = message || ("原生历史删除未确认｜HTTP:" + effectiveStatus + "｜BODY:" + nativeHistoryDeleteDiagnosticText(rawResponse));
        return result;
      }
      result.ok = true;
      result.reason = "DELETED";
      return result;
    }

    function nativeHistoryDeleteFailureText(result) {
      const item = result || {};
      if (item.reason === "FORBIDDEN") return "原生历史删除受 App 设置限制：" + (item.message || "本机 API 修改未开启");
      if (item.reason === "ENDPOINT_NOT_FOUND") return "当前 App 未提供原生历史删除接口";
      if (item.reason === "LOCAL_API_ADDRESS_UNAVAILABLE" || item.reason === "REQUEST_UNAVAILABLE") return "当前 App 未暴露可用的原生历史删除接口";
      if (["DELETE_FAILED", "DELETE_SKIPPED", "DELETE_NOT_CONFIRMED"].includes(item.reason) && item.message) return item.message;
      return "最近观看删除失败" + (item.message ? "：" + item.message : "");
    }

    async function readFreshNativeHistoryItemsForDeletion() {
      const list = await sdk().history();
      const rawItems = (Array.isArray(list) ? list : [])
        .map((history, index) => ({ history, index }))
        .filter((entry) => entry.history && typeof entry.history === "object");
      return rawItems.map((entry) => normalizeHistoryItem(entry.history, entry.index));
    }

    function nativeHistoryDeleteIdentityKey(item) {
      const raw = item && item.nativeHistoryRaw && typeof item.nativeHistoryRaw === "object"
        ? item.nativeHistoryRaw
        : item || {};
      const parts = historyKeyParts(raw);
      const historyKey = String(raw.key || raw.historyKey || item && (item.nativeHistoryKey || item.historyKey) || parts.key || "").trim();
      if (historyKey) return "key:" + historyKey;
      const siteKey = String(raw.siteKey || item && (item.nativeSiteKey || item.siteKey) || parts.siteKey || "").trim();
      const vodId = String(raw.vodId || item && (item.nativeVodId || item.vodId) || parts.vodId || "").trim();
      const cid = String(raw.cid != null ? raw.cid : item && item.nativeCid != null ? item.nativeCid : parts.cid || "").trim();
      return "identity:" + siteKey + "\u001f" + vodId + "\u001f" + cid;
    }

    function uniqueNativeHistoryDeleteCandidates(items) {
      const seen = new Set();
      return (Array.isArray(items) ? items : []).filter((item) => {
        const identity = nativeHistoryDeleteIdentityKey(item);
        if (!identity || seen.has(identity)) return false;
        seen.add(identity);
        return true;
      });
    }

    function freezeNativeHistoryDeleteIdentity(item) {
      const raw = item && item.nativeHistoryRaw && typeof item.nativeHistoryRaw === "object"
        ? item.nativeHistoryRaw
        : item || {};
      const parts = historyKeyParts(raw);
      const historyKey = String(raw.key || raw.historyKey || item && (item.nativeHistoryKey || item.historyKey) || parts.key || "").trim();
      const siteKey = String(raw.siteKey || raw.site || item && (item.nativeSiteKey || item.siteKey) || parts.siteKey || "").trim();
      const vodId = String(raw.vodId || raw.videoId || item && (item.nativeVodId || item.vodId) || parts.vodId || "").trim();
      const cid = String(raw.cid != null
        ? raw.cid
        : item && item.nativeCid != null
          ? item.nativeCid
          : parts.cid || "").trim();
      return Object.freeze({
        identityKey: nativeHistoryDeleteIdentityKey(item),
        nativeHistoryRaw: Object.assign({}, raw),
        key: historyKey,
        historyKey,
        nativeHistoryKey: historyKey,
        cid,
        nativeCid: cid,
        siteKey,
        nativeSiteKey: siteKey,
        vodId,
        nativeVodId: vodId
      });
    }

    function nativeHistoryDeleteFrozenPresent(snapshot, frozenIdentities) {
      const frozen = Array.isArray(frozenIdentities) ? frozenIdentities : [];
      const present = new Set((Array.isArray(snapshot) ? snapshot : [])
        .map((item) => nativeHistoryDeleteIdentityKey(item))
        .filter(Boolean));
      return frozen.filter((identity) => identity && present.has(identity.identityKey));
    }

    async function deleteNativeHistoryMediaGroupVerified(item, mediaKey) {
      const maxRounds = 3;
      const retryDelay = 220;
      let memberCountBefore = 0;
      let lastMessage = "";
      let frozenNativeIdentities = null;
      for (let round = 0; round < maxRounds; round++) {
        let snapshot;
        try {
          snapshot = await readFreshNativeHistoryItemsForDeletion();
        } catch (e) {
          return {
            ok: false,
            reason: "HISTORY_READ_FAILED",
            message: String(e && e.message || e || "最近观看刷新失败"),
            rounds: round + 1,
            memberCountBefore,
            frozenNativeIdentities: frozenNativeIdentities || []
          };
        }
        if (!frozenNativeIdentities) {
          const groupedCandidates = uniqueNativeHistoryDeleteCandidates(nativeHistoryDeleteCandidates(item, mediaKey, snapshot));
          frozenNativeIdentities = groupedCandidates.map(freezeNativeHistoryDeleteIdentity);
          memberCountBefore = frozenNativeIdentities.length;
        }
        const candidates = nativeHistoryDeleteFrozenPresent(snapshot, frozenNativeIdentities);
        if (!frozenNativeIdentities.length || !candidates.length) {
          return { ok: true, rounds: round + 1, memberCountBefore, remaining: 0, frozenNativeIdentities };
        }
        for (const nativeIdentity of candidates) {
          const result = await deleteNativeHistoryViaLocalApi(nativeIdentity);
          if (!result.ok) {
            return {
              ok: false,
              reason: result.reason || "DELETE_FAILED",
              message: result.message || "",
              rounds: round + 1,
              memberCountBefore,
              remaining: candidates.length,
              frozenNativeIdentities
            };
          }
          lastMessage = String(result.message || lastMessage || "");
        }
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        let verification;
        try {
          verification = await readFreshNativeHistoryItemsForDeletion();
        } catch (e) {
          return {
            ok: false,
            reason: "HISTORY_READ_FAILED",
            message: String(e && e.message || e || "最近观看刷新失败"),
            rounds: round + 1,
            memberCountBefore,
            frozenNativeIdentities
          };
        }
        const remaining = nativeHistoryDeleteFrozenPresent(verification, frozenNativeIdentities);
        if (!remaining.length) {
          return { ok: true, rounds: round + 1, memberCountBefore, remaining: 0, frozenNativeIdentities };
        }
        if (round === maxRounds - 1) {
          return {
            ok: false,
            reason: "DELETE_NOT_CONFIRMED",
            message: lastMessage || "原生历史删除未确认",
            rounds: maxRounds,
            memberCountBefore,
            remaining: remaining.length,
            frozenNativeIdentities
          };
        }
      }
      return {
        ok: false,
        reason: "DELETE_NOT_CONFIRMED",
        message: "原生历史删除未确认",
        memberCountBefore,
        frozenNativeIdentities: frozenNativeIdentities || []
      };
    }

