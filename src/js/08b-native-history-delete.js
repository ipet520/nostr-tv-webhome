    function historyRecordReference(item) {
      const ref = item && item.historyRecordRef;
      if (!ref || ref.version !== 1 || !["ITEM", "SEASON"].includes(ref.kind)
        || typeof ref.historyKey !== "string" || !ref.historyKey || !Number.isInteger(ref.cid) || ref.cid < 0
        || !ref.siteKey || !ref.vodId) return null;
      if (ref.kind === "SEASON" && (ref.mediaType !== "tv" || !(ref.tmdbId > 0)
        || !Number.isInteger(ref.seasonNumber) || ref.seasonNumber < 0)) return null;
      return Object.assign({}, ref);
    }

    function historyRecordDisplayId(ref) {
      return JSON.stringify([1, ref.kind, ref.cid, ref.historyKey,
        ref.kind === "SEASON" ? ref.mediaType : "", ref.kind === "SEASON" ? ref.tmdbId : 0,
        ref.kind === "SEASON" ? ref.seasonNumber : -1]).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
    }

    function recentHistoryItemKey(item) {
      const ref = historyRecordReference(item);
      return ref ? historyRecordDisplayId(ref) : String(item && (item.historyStableKey || item.nativeHistoryKey || item.historyKey || item.id) || "");
    }

    function uniqueHistoryRecords(items) {
      const seen = new Set();
      return (items || []).filter((item) => {
        const key = recentHistoryItemKey(item);
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
      });
    }

    function historyRecordFocusItem(items, key) {
      const exact = (items || []).find((item) => mediaDomKey(item) === key);
      if (exact) return exact;
      if (typeof key !== "string" || !key.startsWith("history:[")) return null;
      let tuple; try { tuple = JSON.parse(key.slice(8)); } catch (error) { return null; }
      if (!Array.isArray(tuple) || tuple[0] !== 1 || !["ITEM", "SEASON"].includes(tuple[1])) return null;
      return (items || []).find((item) => {
        const ref = historyRecordReference(item);
        return ref && ref.cid === tuple[2] && ref.historyKey === tuple[3]
          && (tuple[1] === "ITEM" || ref.mediaType === tuple[4] && ref.tmdbId === tuple[5] && ref.seasonNumber === tuple[6]);
      }) || null;
    }

    async function readNativeHistoryForUi() {
      const value = await sdk().history({ mode: "independent", version: 1 });
      return value && value.version === 1 && value.mode === "independent" && Array.isArray(value.records)
        ? value : Array.isArray(value) ? value : [];
    }

    async function deleteHistoryRecords(items) {
      const frozen = uniqueHistoryRecords(items).map((item) => ({ item, ref: historyRecordReference(item), key: recentHistoryItemKey(item) }));
      const results = [];
      const supported = frozen.filter((entry) => {
        const allowed = entry.ref && entry.item.historyCanDeleteExact && state.recent.referenceVersion === 1 && typeof sdk().historyDelete === "function";
        if (!allowed) results.push({ displayId: entry.key, status: "UNSUPPORTED", message: entry.item.historyCapabilityReason || "当前 App 不支持精确删除此记录" });
        return allowed;
      });
      if (supported.length) {
        const response = await sdk().historyDelete({ version: 1, refs: supported.map((entry) => entry.ref) });
        if (!response || response.version !== 1 || !Array.isArray(response.results)
          || !response.readback || response.readback.version !== 1 || !Array.isArray(response.readback.records)) throw new Error("原生删除结果无法验证");
        const present = new Set(normalizeHistoryList(response.readback).map(recentHistoryItemKey));
        supported.forEach((entry) => {
          const result = response.results.find((item) => item.displayId === entry.key);
          if (!result || !["DELETED", "NOT_FOUND", "FAILED", "UNSUPPORTED"].includes(result.status)) {
            results.push({ displayId: entry.key, status: "FAILED", message: "原生删除结果缺失" }); return;
          }
          results.push(present.has(entry.key) && ["DELETED", "NOT_FOUND"].includes(result.status)
            ? { displayId: entry.key, status: "FAILED", message: "原生回读仍存在该记录" } : result);
        });
        state.recent.items = normalizeHistoryList(response.readback);
        state.recent.detailItems = normalizeHistoryList(response.readback.legacy || []);
        state.recent.loaded = true; state.recent.error = ""; state.recent.refreshedAt = Date.now();
        // An in-flight older list must not resurrect deleted cards.
        if (state.recent.activeRun) state.recent.activeRun.invalidated = true;
        const successful = new Set(results.filter((result) => result.status === "DELETED" || result.status === "NOT_FOUND").map((result) => result.displayId));
        for (const storeName of ["historyContexts", "continueIndex"]) {
          const store = state[storeName];
          if (!store || !store.loaded || !Array.isArray(store.entries)) continue;
          const next = store.entries.filter((entry) => !successful.has(recentHistoryItemKey(entry)));
          if (next.length !== store.entries.length) {
            try {
              await (storeName === "historyContexts" ? persistHistoryContextEntries(next) : persistContinueIndexEntries(next));
              store.entries = next;
            } catch (error) { toast("原生历史已处理，但资源上下文清理失败"); }
          }
        }
      }
      return results;
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

    function nativeHistoryDeleteIdentityKey(item) {
      const ref = historyRecordReference(item);
      if (ref) return historyRecordDisplayId(ref);
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

