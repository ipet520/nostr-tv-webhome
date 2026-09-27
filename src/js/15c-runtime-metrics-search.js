    function renderMetrics() {
      const localKey = state.identity ? hotUserKey(state.identity.pubkey) : "";
      const localVector = localKey ? state.hot.users.get(localKey) : null;
      const local = localVector ? hotActiveVectorItems(localVector).length : 0;
      $("identityText").textContent = state.identity ? `npub: ${state.identity.npub}
nsec: ${state.identity.nsec}` : "身份未就绪";
      $("relayText").textContent = `relay: ${window.WEBHOME_CONFIG.nostr.relays.join(", ")}`;
      setStatus("nostr", `已连接 ${state.relay.connected}/${window.WEBHOME_CONFIG.nostr.relays.length} · 本机 ${local} · 榜单 ${state.hot.items.length}`);
      if (state.identity) state.status.identity = shortKey(state.identity.npub);
      renderConnection();
    }

    function scheduleSearchSuggest() {
      clearTimeout(state.suggestions.timer);
      const input = $("searchInput");
      const kw = input ? input.value.trim() : "";
      if (!kw) {
        hideSearchSuggest();
        return;
      }
      if (input && input.readOnly) return hideSearchSuggest();
      const seq = ++state.suggestions.seq;
      state.suggestions.timer = setTimeout(() => loadSearchSuggest(kw, seq), 180);
    }

    async function loadSearchSuggest(keyword, seq) {
      const kw = String(keyword || "").trim();
      if (!kw) return hideSearchSuggest();
      if (seq !== state.suggestions.seq) return;
      if (state.suggestions.keyword === kw && state.suggestions.items.length) {
        if ($("searchInput") && $("searchInput").value.trim() === kw && !$("searchInput").readOnly) renderSearchSuggest();
        return;
      }
      state.suggestions.loading = true;
      try {
        const body = await requestJson(suggestUrl(kw), 8);
        if (seq !== state.suggestions.seq) return;
        if (!$("searchInput") || $("searchInput").value.trim() !== kw || $("searchInput").readOnly) return;
        state.suggestions.keyword = kw;
        state.suggestions.items = normalizeSuggestItems(body).slice(0, 8);
        renderSearchSuggest();
      } catch (e) {
        if (seq === state.suggestions.seq && $("searchInput") && $("searchInput").value.trim() === kw) hideSearchSuggest();
      } finally {
        state.suggestions.loading = false;
      }
    }

    function normalizeSuggestItems(body) {
      const raw = Array.isArray(body && body.data) ? body.data : Array.isArray(body) ? body : [];
      const seen = new Set();
      const items = [];
      raw.forEach((item) => {
        const title = String(item && (item.name || item.title || item.keyword || item.word) || "").trim();
        if (!title || seen.has(title)) return;
        seen.add(title);
        const type = String(item.cname || item.channel_name || item.type || "").trim();
        const year = item.year ? String(item.year) : "";
        const actor = Array.isArray(item.main_actor) ? item.main_actor.slice(0, 2).join("/") : "";
        items.push({ title, meta: [type, year, actor].filter(Boolean).join(" · ") });
      });
      return items;
    }

    function renderSearchSuggest() {
      const panel = $("suggestPanel");
      if (!panel) return;
      const items = state.suggestions.items || [];
      if (!items.length) return hideSearchSuggest();
      closeConnectionPanel();
      panel.replaceChildren(...items.map((item) => {
        const button = document.createElement("button");
        button.className = "suggest-item focusable";
        button.type = "button";
        button.setAttribute("role", "option");
        button.innerHTML = `<b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.meta || "")}</span>`;
        button.addEventListener("click", () => applySearchSuggest(item.title));
        return button;
      }));
      panel.classList.add("open");
      if ($("searchForm")) $("searchForm").classList.add("suggesting");
    }

    function hideSearchSuggest() {
      clearTimeout(state.suggestions.timer);
      state.suggestions.timer = 0;
      state.suggestions.seq += 1;
      const panel = $("suggestPanel");
      if (panel) {
        panel.classList.remove("open");
        panel.replaceChildren();
      }
      if ($("searchForm")) $("searchForm").classList.remove("suggesting");
      state.suggestions.items = [];
      state.suggestions.keyword = "";
      if (state.suggestions.controller) {
        try { state.suggestions.controller.abort(); } catch (e) {}
        state.suggestions.controller = null;
      }
    }

    // 去除标题中的「第x季/Season x/特别篇」等季号后缀，得到可被搜索接口匹配到的纯剧名
    // 例：「怪奇物语 第四季」→「怪奇物语」；「Stranger Things Season 4」→「Stranger Things」
    function stripSeasonSuffix(title) {
      let s = String(title || "").trim();
      s = s.replace(/[\s·:：\-—]*第\s*[0-9一二三四五六七八九十百]+\s*季\s*$/u, "");
      s = s.replace(/[\s·:：\-—]*Season\s*\d+\s*$/i, "");
      s = s.replace(/[\s·:：\-—]*S\d{1,2}\s*$/i, "");
      s = s.replace(/[\s·:：\-—]*(特别篇|总集篇|番外篇)\s*$/u, "");
      s = s.trim();
      return s || String(title || "").trim();
    }

    function applySearchSuggest(title) {
      const value = stripSeasonSuffix(title);
      if (!value) return;
      $("searchInput").value = value;
      hideSearchSuggest();
      searchTmdb(value);
    }

    function enableSearchEditing() {
      if ($("searchInput")) $("searchInput").readOnly = false;
    }

    function disableSearchEditing() {
      if ($("searchInput")) $("searchInput").readOnly = true;
    }

    function recordSearchImeDiag(diag) {
      const safe = {
        reason: String(diag && diag.reason || "").slice(0, 64),
        key: String(diag && diag.key || "").slice(0, 32),
        keyCode: Number(diag && diag.keyCode || 0),
        beforeActiveId: String(diag && diag.beforeActiveId || "").slice(0, 64),
        beforeReadOnly: !!(diag && diag.beforeReadOnly),
        blurObserved: !!(diag && diag.blurObserved),
        focusObserved: !!(diag && diag.focusObserved),
        afterActiveId: String(diag && diag.afterActiveId || "").slice(0, 64),
        afterReadOnly: !!(diag && diag.afterReadOnly),
        focusReacquired: !!(diag && diag.focusReacquired),
        frameReacquireNeeded: !!(diag && diag.frameReacquireNeeded),
        scrollBefore: Number(diag && diag.scrollBefore || 0),
        scrollAfter: Number(diag && diag.scrollAfter || 0),
        beforeFocusSeq: Number(diag && diag.beforeFocusSeq || 0),
        afterFocusSeq: Number(diag && diag.afterFocusSeq || 0),
        beforeBlurSeq: Number(diag && diag.beforeBlurSeq || 0),
        afterBlurSeq: Number(diag && diag.afterBlurSeq || 0)
      };
      state.tvDiag.searchIme = safe;
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV][SEARCH_IME_DIAG]", safe); } catch (e) {}
        updateTvDiagnostic();
      }
      return safe;
    }

    function enterSearchEditMode(reason, event) {
      const input = $("searchInput");
      if (!input) return false;
      if (event && event.__nostrSearchImeHandled) return true;
      if (event) event.__nostrSearchImeHandled = true;

      const beforeActive = document.activeElement;
      const beforeReadOnly = !!input.readOnly;
      const beforeBlurSeq = Number(state.searchImeBlurSeq || 0);
      const beforeFocusSeq = Number(state.searchImeFocusSeq || 0);
      const scrollBefore = Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0);
      const key = event ? (normalizeRemoteKey(event) || event.key || "") : "";
      const keyCode = Number(event && (event.keyCode || event.which) || 0);

      // Android TV WebView 需要一次真实的 editable focus transition 才会拉起 IME。
      if (document.activeElement === input) input.blur();
      // blur handler 会把它恢复成 readonly，所以顺序必须是 blur -> editable -> focus。
      input.readOnly = false;
      try {
        input.focus({ preventScroll: true });
      } catch (e) {
        input.focus();
      }
      try {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      } catch (e) {}

      const syncBlurObserved = Number(state.searchImeBlurSeq || 0) > beforeBlurSeq;
      const syncFocusObserved = Number(state.searchImeFocusSeq || 0) > beforeFocusSeq;
      const syncReady = document.activeElement === input && input.readOnly === false;
      let frameReacquireNeeded = !syncReady;
      const getActiveId = (el) => el && el.id ? el.id : "";
      const writeDiag = () => recordSearchImeDiag({
        reason: reason || "remote_enter",
        key,
        keyCode,
        beforeActiveId: getActiveId(beforeActive),
        beforeReadOnly,
        blurObserved: syncBlurObserved || Number(state.searchImeBlurSeq || 0) > beforeBlurSeq,
        focusObserved: syncFocusObserved || Number(state.searchImeFocusSeq || 0) > beforeFocusSeq,
        afterActiveId: getActiveId(document.activeElement),
        afterReadOnly: !!input.readOnly,
        focusReacquired: document.activeElement === input && input.readOnly === false,
        frameReacquireNeeded,
        scrollBefore,
        scrollAfter: Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0),
        beforeFocusSeq,
        afterFocusSeq: Number(state.searchImeFocusSeq || 0),
        beforeBlurSeq,
        afterBlurSeq: Number(state.searchImeBlurSeq || 0)
      });
      writeDiag();

      if (typeof requestAnimationFrame === "function") {
        const frameToken = Number(state.searchImeFrameToken || 0) + 1;
        state.searchImeFrameToken = frameToken;
        requestAnimationFrame(() => {
          if (Number(state.searchImeFrameToken || 0) !== frameToken) return;
          state.searchImeFrameToken = 0;
          // TCL WebView 只允许这一帧做一次确认/补偿，禁止持续 focus 抖动。
          if (document.activeElement !== input || input.readOnly) {
            frameReacquireNeeded = true;
            input.readOnly = false;
            try {
              input.focus({ preventScroll: true });
            } catch (e) {
              input.focus();
            }
          }
          recordSearchImeDiag({
            reason: reason || "remote_enter",
            key,
            keyCode,
            beforeActiveId: getActiveId(beforeActive),
            beforeReadOnly,
            blurObserved: Number(state.searchImeBlurSeq || 0) > beforeBlurSeq,
            focusObserved: Number(state.searchImeFocusSeq || 0) > beforeFocusSeq,
            afterActiveId: getActiveId(document.activeElement),
            afterReadOnly: !!input.readOnly,
            focusReacquired: document.activeElement === input && input.readOnly === false,
            frameReacquireNeeded,
            scrollBefore,
            scrollAfter: Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0),
            beforeFocusSeq,
            afterFocusSeq: Number(state.searchImeFocusSeq || 0),
            beforeBlurSeq,
            afterBlurSeq: Number(state.searchImeBlurSeq || 0)
          });
        });
      }
      return true;
    }

    function submitSearchInput() {
      const input = $("searchInput");
      if (!input) return;
      enableSearchEditing();
      recordSearchHistory(input.value);
      searchTmdb(input.value);
    }

    function currentSearchKeyword() {
      const input = $("searchInput");
      return String(input && input.value || "").trim();
    }

    function clearSearchHold() {
      if (state.searchHold.timer) clearTimeout(state.searchHold.timer);
      state.searchHold.timer = 0;
      state.searchHold.pointer = null;
      state.searchHold.target = null;
    }

    function handleSearchNativeHoldStart(event) {
      const button = $("searchSubmitBtn");
      if (!button) return;
      if (event && event.pointerType === "mouse" && event.button !== 0) return;
      clearSearchHold();
      state.searchHold.fired = false;
      state.searchHold.target = button;
      state.searchHold.pointer = event && event.pointerId != null ? {
        id: event.pointerId,
        x: event.clientX || 0,
        y: event.clientY || 0
      } : null;
      state.searchHold.timer = setTimeout(() => {
        state.searchHold.timer = 0;
        state.searchHold.fired = true;
        state.searchHold.suppressClickUntil = Date.now() + 800;
        const keyword = currentSearchKeyword();
        hideSearchSuggest();
        nativeSearch(keyword);
      }, 650);
    }

    function handleSearchNativeHoldMove(event) {
      const pointer = state.searchHold.pointer;
      if (!pointer || !event || pointer.id !== event.pointerId) return;
      const dx = Math.abs((event.clientX || 0) - pointer.x);
      const dy = Math.abs((event.clientY || 0) - pointer.y);
      if (dx > 12 || dy > 12) clearSearchHold();
    }

    function handleSearchNativeHoldEnd() {
      const fired = state.searchHold.fired;
      clearSearchHold();
      return fired;
    }

    function consumeSearchSubmitEnterDown(el, event) {
      if (el !== $("searchSubmitBtn")) return false;
      if (homeUiRoute() !== "search") return false;
      event.preventDefault();
      event.stopPropagation();
      if (state.searchHold.timer || state.searchHold.fired) return true;
      handleSearchNativeHoldStart();
      return true;
    }

    function handleSearchSubmitEnterUp(event) {
      const key = normalizeRemoteKey(event);
      if (key !== "Enter" || state.searchHold.target !== $("searchSubmitBtn")) return false;
      event.preventDefault();
      event.stopPropagation();
      if (handleSearchNativeHoldEnd()) {
        state.searchHold.fired = false;
        return true;
      }
      if (Date.now() < Number(state.searchHold.suppressClickUntil || 0)) return true;
      state.searchHold.suppressClickUntil = Date.now() + 180;
      submitSearchInput();
      return true;
    }

    function handleSearchSubmitClick(event) {
      if (homeUiRoute() !== "search") return;
      if (Date.now() < Number(state.searchHold.suppressClickUntil || 0) || state.searchHold.fired) {
        event.preventDefault();
        event.stopPropagation();
        state.searchHold.fired = false;
        return;
      }
      event.preventDefault();
      submitSearchInput();
    }

    async function searchTmdb(keyword, options) {
      const opts = options || {};
      const input = $("searchInput");
      const live = searchLiveState();
      const kw = String(keyword || "").trim();
      if (!kw) {
        resetSearchLiveForEmpty();
        if (input) input.value = "";
        hideSearchSuggest();
        if (homeUiRoute() === "search") renderSearch();
        scheduleUiSnapshotSave();
        return;
      }

      if (live.timer) clearTimeout(live.timer);
      live.timer = 0;
      const synced = prepareSearchLiveKeyword(kw);
      const version = opts.version == null ? synced.version : Number(opts.version);
      if (version !== Number(live.inputVersion || 0) || currentSearchKeyword() !== kw) return;
      if (live.requestInFlight && live.activeKeyword === kw && Number(live.activeVersion || 0) === version) return;
      if (!live.requestInFlight
          && live.lastCompletedKeyword === kw
          && Number(live.lastCompletedVersion || 0) === version
          && live.resultKeyword === kw
          && !live.error) {
        if (homeUiRoute() === "search") renderSearch();
        return;
      }

      const seq = Number(live.requestSeq || 0) + 1;
      live.requestSeq = seq;
      live.activeKeyword = kw;
      live.activeVersion = version;
      live.lastRequestedKeyword = kw;
      live.lastRequestedVersion = version;
      live.loading = true;
      live.requestInFlight = true;
      live.error = false;
      live.resultKeyword = "";
      state.searchSubmittedKeyword = kw;
      state.searchItems = [];
      hideSearchSuggest();
      if (homeUiRoute() === "search") renderSearch();

      const isCurrent = () => Number(live.requestSeq || 0) === seq
        && Number(live.inputVersion || 0) === version
        && live.keyword === kw
        && currentSearchKeyword() === kw;
      try {
        setStatus("tmdb", `搜索 ${kw}`);
        const body = await requestJson(tmdbSearchUrl(kw), 18);
        if (!isCurrent()) return;
        const results = (body.results || []).filter((item) => item.media_type === "movie" || item.media_type === "tv");
        state.searchItems = results.map((item, index) => normalizeTmdb(item, { id: "search", title: "搜索", mediaType: item.media_type }, index)).filter(hasPoster).slice(0, 18);
        live.loading = false;
        live.requestInFlight = false;
        live.error = false;
        live.resultKeyword = kw;
        live.lastCompletedKeyword = kw;
        live.lastCompletedVersion = version;
        setStatus("tmdb", `搜索成功 ${state.searchItems.length} 条`);
        renderSearch();
        scheduleUiSnapshotSave();
      } catch (e) {
        if (!isCurrent()) return;
        live.loading = false;
        live.requestInFlight = false;
        live.error = true;
        state.searchItems = [];
        setStatus("tmdb", "搜索失败：" + (e.message || "unknown"));
        renderSearch();
        toast("搜索失败");
      } finally {
        if (isCurrent()) live.requestInFlight = false;
      }
    }

