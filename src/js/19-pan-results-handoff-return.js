    function normalizePanUrl(url) {
      try {
        const parsed = new URL(url);
        parsed.hash = "";
        parsed.hostname = parsed.hostname.toLowerCase();
        return parsed.toString();
      } catch (e) {
        return String(url || "").trim();
      }
    }

    function panHealthKey(item) {
      return item ? `${item.diskType}|${normalizePanUrl(item.url)}` : "";
    }

    function getPanHealth(item) {
      const key = panHealthKey(item);
      if (state.pan.pending[key]) return { state: "pending", summary: "检测中" };
      return state.pan.health[key] || { state: "idle", summary: "未检测" };
    }

    function panContextIsCurrent(context) {
      if (!context) return true;
      if (context.directAction && context.directAction.cancelReason === "provider_committed") return false;
      if (context.raceRun) return detailPlaybackIsCurrent(context.raceRun) && state.selected === context.item;
      return state.pan.viewToken === context.token && state.selected === context.item;
    }

    function invalidateAutomaticReadyForHealth(candidate, stateValue, context) {
      const normalizedState = String(stateValue || "").toLowerCase();
      const invalidationReason = {
        bad: "LATE_HEALTH_BAD",
        locked: "LATE_HEALTH_LOCKED",
        unavailable: "LATE_HEALTH_UNAVAILABLE"
      }[normalizedState];
      if (!candidate || !invalidationReason) return false;
      if (context && !panContextIsCurrent(context)) return false;
      const item = context && context.item || state.selected;
      if (!item) return false;
      if (context && context.raceOwner === "curated") return false;
      const currentRun = state.detailPlayback;
      if (currentRun && currentRun.providerCommitted) return false;
      const candidateKey = detailDirectPlayCandidateKey(candidate);
      let invalidated = false;
      const ready = state.pan.directReady;
      if (ready
        && ready.itemKey === panSearchItemKey(item)
        && Number(ready.sessionId || 0) === Number(state.pan.sessionId || 0)
        && ready.candidateKey
        && ready.candidateKey === candidateKey) {
        state.pan.directReady = null;
        invalidated = true;
      }
      const run = currentRun;
      if (run && detailPlaybackIsCurrent(run) && run.candidate
        && detailDirectPlayCandidateKey(run.candidate) === candidateKey) {
        run.candidate = null;
        run.error = "late_health_" + normalizedState;
        invalidated = true;
      }
      if (!invalidated) return false;
      recordDirectReadyEvent("DIRECT_READY_INVALIDATED", item, candidate, invalidationReason, normalizedState);
      if (state.selected === item) updateDetailContinueButton();
      return true;
    }

    function isPanHealthFresh(item) {
      const key = panHealthKey(item);
      const health = state.pan.health[key];
      if (!health || !health.checkedAt) return false;
      const expiresAt = Number(health.expiresAt || 0);
      if (expiresAt > 0 && expiresAt <= Date.now()) return false;
      return true;
    }

    function isPanHealthBad(item) {
      const health = getPanHealth(item);
      return health && health.state === "bad" && isPanHealthFresh(item);
    }

    function panAutoHealthAdmission(item, freshHealth) {
      if (!item) return { accepted: false, state: "unconfirmed", reason: "NO_CANDIDATE" };
      const key = panHealthKey(item);
      const hasFreshResult = !!(freshHealth && Object.prototype.hasOwnProperty.call(freshHealth, key));
      const cached = state.pan.health[key] || null;
      const cachedFresh = !!(cached && isPanHealthFresh(item));
      const cachedState = cachedFresh ? String(cached.state || "").toLowerCase() : "";
      const explicitState = hasFreshResult
        ? String(freshHealth[key] || "").toLowerCase()
        : cachedState;
      if (["bad", "locked", "unavailable"].includes(explicitState)) {
        return { accepted: false, state: explicitState, reason: hasFreshResult ? "FRESH_REJECTED" : "CACHED_REJECTED" };
      }
      // 盘类型或当前 Bridge 不支持检测时保持既有兼容：不能因不可检测而永久禁止自动播放。
      if (!isPanCheckSupported(item) || !panCheckAvailable()) {
        return { accepted: true, state: "unsupported", reason: "UNSUPPORTED" };
      }
      if (explicitState === "ok") {
        return { accepted: true, state: "ok", reason: hasFreshResult ? "FRESH_OK" : "CACHED_OK" };
      }
      return { accepted: false, state: explicitState || "unconfirmed", reason: hasFreshResult ? "FRESH_UNCONFIRMED" : "NO_FRESH_OK" };
    }

    function panHealthSnapshot(items) {
      const snapshot = {};
      (items || []).forEach((item) => {
        const key = panHealthKey(item);
        if (!key) return;
        const health = state.pan.health[key];
        snapshot[key] = health ? Object.assign({}, health) : null;
      });
      return snapshot;
    }

    function panPreflightState(item, freshHealth) {
      const key = panHealthKey(item);
      if (freshHealth && Object.prototype.hasOwnProperty.call(freshHealth, key)) {
        const health = getPanHealth(item);
        return { state: String(freshHealth[key] || health.state || "uncertain"), summary: String(health.summary || "") };
      }
      if (!isPanCheckSupported(item)) return { state: "unsupported", summary: "暂不支持检测" };
      const health = getPanHealth(item);
      return { state: String(health.state || "idle"), summary: String(health.summary || "") };
    }

    function panPreflightCheckErrorCount(items, freshHealth) {
      return (items || []).filter((item) => {
        if (!isPanCheckSupported(item)) return false;
        return !Object.prototype.hasOwnProperty.call(freshHealth || {}, panHealthKey(item));
      }).length;
    }

    // 这是通用的 preflight 淘汰工具；自动播放随后还必须经过 panAutoHealthAdmission，
    // 因此 timeout/error/uncertain 不会因为“不是 bad”而直接成为 Ready。手动盘搜不经过自动选择器。
    function panPreflightCandidates(items, freshHealth, previousHealth, options) {
      const opts = options || {};
      const list = (items || []).filter(Boolean);
      const bad = list.filter((item) => {
        const key = panHealthKey(item);
        return Object.prototype.hasOwnProperty.call(freshHealth || {}, key) && isPanHealthBad(item);
      });
      const allBadBatch = !!(list.length && bad.length === list.length);
      const confirmedBad = bad.filter((item) => {
        const prior = previousHealth && previousHealth[panHealthKey(item)];
        return prior && prior.state === "bad" && prior.checkedAt;
      });
      if (!bad.length) return { candidates: list, allBadBatch: false, confirmedBadCount: 0 };
      if (allBadBatch && opts.rejectAllBad) {
        return {
          candidates: [],
          allBadBatch: true,
          confirmedBadCount: confirmedBad.length
        };
      }
      if (allBadBatch) {
        return {
          candidates: confirmedBad.length === list.length ? [] : list.filter((item) => !confirmedBad.includes(item)),
          allBadBatch: true,
          confirmedBadCount: confirmedBad.length
        };
      }
      return { candidates: list.filter((item) => !bad.includes(item)), allBadBatch: false, confirmedBadCount: confirmedBad.length };
    }

    function recordPanPreflightResult(items, freshHealth, checkError, selectedCandidate, allBadBatch) {
      const describe = (item) => {
        if (!item) return null;
        const health = panPreflightState(item, freshHealth);
        return {
          diskType: normalizePanDiskType(item.diskType),
          health: { state: health.state, summary: health.summary }
        };
      };
      const details = (items || []).map(describe).filter(Boolean);
      const result = {
        total: details.length,
        ok: 0,
        bad: 0,
        uncertain: 0,
        unsupported: 0,
        locked: 0,
        checkError: Math.max(0, Number(checkError || 0)),
        selectedCandidate: describe(selectedCandidate),
        candidates: details,
        PAN_PREFLIGHT_ALL_BAD: !!allBadBatch
      };
      state.pan.preflight = result;
      details.forEach((entry) => {
        const stateValue = entry.health.state;
        if (Object.prototype.hasOwnProperty.call(result, stateValue) && typeof result[stateValue] === "number") result[stateValue] += 1;
      });
      if (isTvDiagnosticEnabled()) {
        try { console.debug("[Nostr TV] PAN_PREFLIGHT_RESULT", result); } catch (e) {}
      }
      return result;
    }

    function panHealthPriority(item) {
      const health = getPanHealth(item);
      const value = health && health.state || "idle";
      return PAN_HEALTH_PRIORITY[value] == null ? PAN_HEALTH_PRIORITY.idle : PAN_HEALTH_PRIORITY[value];
    }

    function panAvailableTypes() {
      const counts = new Map();
      state.pan.results.forEach((item) => {
        const type = normalizePanDiskType(item.diskType);
        if (type) counts.set(type, (counts.get(type) || 0) + 1);
      });
      const known = new Set(PAN_DISK_TYPES.map((item) => item.id));
      const ordered = PAN_DISK_TYPES
        .filter((type) => counts.has(type.id))
        .map((type) => ({ id: type.id, name: type.name, count: counts.get(type.id) || 0 }));
      const extras = Array.from(counts.entries())
        .filter(([id]) => !known.has(id))
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, count]) => ({ id, name: panDiskName(id), count }));
      return ordered.concat(extras);
    }

    function ensureActivePanType() {
      const types = panAvailableTypes();
      if (!types.length) {
        state.pan.activeType = "";
        return "";
      }
      if (!state.pan.activeType || !types.some((type) => type.id === state.pan.activeType)) {
        state.pan.activeType = types[0].id;
      }
      return state.pan.activeType;
    }

    function rankedPanResults(type) {
      const activeType = type || "";
      const source = state.pan.results.filter((item) => {
        if (activeType && normalizePanDiskType(item.diskType) !== activeType) return false;
        const health = getPanHealth(item);
        if (health && health.state === "bad" && isPanHealthFresh(item)) return false; // 新鲜确认失效的资源不显示
        return true;
      });
      return source
        .map((item, index) => ({ item, index, priority: panHealthPriority(item), quality: panQualityInfo(item) }))
        .sort((a, b) =>
          (b.quality.count - a.quality.count) ||
          (b.quality.score - a.quality.score) ||
          (a.priority - b.priority) ||
          (Number(a.item.index || a.index) - Number(b.item.index || b.index)) ||
          (a.index - b.index)
        )
        .map(({ item }) => item);
    }

    function renderPanTabs() {
      const tabs = $("panTabs");
      if (!tabs) return;
      const types = panAvailableTypes();
      const active = ensureActivePanType();
      const activeEl = document.activeElement;
      const restoreId = activeEl && tabs.contains(activeEl) && getPanTypeFromElement(activeEl) || "";
      const tabKeys = types.map((type) => `${type.id}:${type.count}`).join("\n");
      if (!types.length) {
        state.pan.tabKeys = "";
        tabs.replaceChildren();
        return;
      }
      if (tabKeys === state.pan.tabKeys && tabs.children.length === types.length) {
        Array.from(tabs.children).forEach((button) => {
          const buttonType = getPanTypeFromElement(button);
          const isActive = buttonType === active;
          button.classList.toggle("active", isActive);
          const type = types.find((item) => item.id === buttonType);
          if (type) button.textContent = `${type.name} ${type.count}`;
        });
        if (state.pan.focusMode === "tabs") lockPanFocus(findByDataset(tabs, "panType", active) || tabs.querySelector(".chip.active") || tabs.querySelector(".chip"), "tabs");
        return;
      }
      state.pan.tabKeys = tabKeys;
      tabs.replaceChildren(...types.map((type) => {
        const button = document.createElement("button");
        button.className = "chip focusable" + (type.id === active ? " active" : "");
        button.type = "button";
        button.dataset.panType = type.id;
        button.setAttribute("data-pan-type", type.id);
        button.textContent = `${type.name} ${type.count}`;
        button.addEventListener("focus", () => { state.pan.focusMode = "tabs"; });
        return button;
      }));
      const restoreTarget = restoreId ? findByDataset(tabs, "panType", restoreId) : state.pan.focusMode === "tabs" ? tabs.querySelector(".chip.active") || tabs.querySelector(".chip") : null;
      if (restoreTarget) lockPanFocus(restoreTarget, "tabs");
    }

    function getPanTypeFromElement(el) {
      return el ? String(el.getAttribute("data-pan-type") || el.dataset && el.dataset.panType || "") : "";
    }

    function handlePanTabEvent(event) {
      const tabs = $("panTabs");
      if (!tabs) return false;
      const target = event && event.target && closestPanTab(event.target);
      if (!target || !tabs.contains(target)) return false;
      const typeId = getPanTypeFromElement(target);
      if (!typeId) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      selectPanType(typeId);
      return true;
    }

    function closestPanTab(el) {
      while (el && el !== document && el !== $("panTabs")) {
        if (el.getAttribute && el.getAttribute("data-pan-type")) return el;
        el = el.parentNode;
      }
      return null;
    }

    function selectPanType(typeId) {
      if (!typeId) return;
      const now = Date.now();
      if (state.pan.lastTypeSelect && state.pan.lastTypeSelect.type === typeId && now - state.pan.lastTypeSelect.at < 520) return;
      state.pan.lastTypeSelect = { type: typeId, at: now };
      if (state.pan.activeType === typeId) {
        state.pan.focusMode = "results";
        focusFirstPanResult();
        return;
      }
      const detailTop = $("detailSheet") ? $("detailSheet").scrollTop : 0;
      state.pan.keepBlockPositionUntil = now + 600;
      state.pan.activeType = typeId;
      state.pan.renderKeys = "";
      state.pan.focusMode = "tabs";
      const list = $("panResultList");
      if (list) list.scrollTop = 0;
      updatePanTabActive(typeId);
      renderPanResults();
      if ($("detailSheet")) $("detailSheet").scrollTop = detailTop;
      requestAnimationFrame(() => { if ($("detailSheet")) $("detailSheet").scrollTop = detailTop; });
      lockPanFocus(findByDataset($("panTabs"), "panType", typeId) || $("panTabs").querySelector(".chip.active"), "tabs", { keepBlockPosition: true });
      scheduleUiSnapshotSave();
    }

    function updatePanTabActive(typeId) {
      const tabs = $("panTabs");
      if (!tabs) return;
      Array.from(tabs.querySelectorAll("[data-pan-type]")).forEach((button) => {
        button.classList.toggle("active", getPanTypeFromElement(button) === typeId);
      });
    }

    function focusFirstPanTab() {
      const target = $("panTabs") && ($("panTabs").querySelector(".chip.active") || $("panTabs").querySelector(".chip"));
      if (target) {
        centerPanSearchBlock();
        lockPanFocus(target, "tabs");
      }
    }

    function isPanSearchActive() {
      const block = $("panSearchBlock");
      return !!(block && block.classList.contains("active") && block.style.display !== "none");
    }

    function updatePostPanFocusState() {
      const panActive = isPanSearchActive();
      ["castBlock", "personWorkBlock", "recommendBlock"].forEach((id) => {
        const block = $(id);
        if (!block) return;
        block.setAttribute("aria-hidden", panActive ? "true" : "false");
        block.querySelectorAll(".focusable,button,input,textarea").forEach((el) => {
          if (panActive) {
            if (!el.dataset.panFocusLocked) {
              el.dataset.panFocusLocked = "1";
              el.dataset.panPrevTabindex = el.hasAttribute("tabindex") ? el.getAttribute("tabindex") || "" : "__none__";
            }
            el.setAttribute("tabindex", "-1");
          } else if (el.dataset.panFocusLocked) {
            const previous = el.dataset.panPrevTabindex;
            if (previous && previous !== "__none__") el.setAttribute("tabindex", previous);
            else el.removeAttribute("tabindex");
            delete el.dataset.panFocusLocked;
            delete el.dataset.panPrevTabindex;
          }
        });
      });
      syncDetailPlaybackStatusVisibility(document.activeElement);
    }

    function detailPlaybackStatusHiddenFor(target) {
      const sheet = $("detailSheet");
      if (!sheet) return false;
      const lowerBlock = target && target.closest
        ? target.closest("#castBlock, #castRail, #personWorkBlock, #personWorkRail, #recommendBlock, #recommendWorkRail")
        : null;
      return !!(lowerBlock && sheet.contains(lowerBlock));
    }

    function syncDetailPlaybackStatusVisibility(target) {
      const sheet = $("detailSheet");
      if (!sheet) return;
      const focusTarget = target || document.activeElement;
      sheet.classList.toggle(
        "detail-focus-below-episodes",
        detailPlaybackStatusHiddenFor(focusTarget)
      );
      renderDirectPlayStatus(focusTarget);
    }

    function panEmptyStateText() {
      const progress = state.pan.progress || {};
      if (progress.active && progress.phase === "initial") return "正在搜索盘搜资源…";
      if (progress.active && progress.phase === "retry") return "盘搜连接异常，正在重新请求…";
      if (progress.active && progress.phase === "polling") return "暂未发现资源，正在继续检索…";
      if (progress.phase === "initial-failed") return "连接失败，请手动重试";
      if (progress.phase === "session-timeout") return panFinalFailureStatusText(state.pan.lastFailureKind || "timeout");
      if (progress.phase === "complete-empty" || progress.phase === "complete") return "未找到盘搜资源";
      return "暂无盘搜资源";
    }

    function renderPanResults() {
      const list = $("panResultList");
      if (!list) return;
      renderPanTabs();
      const active = ensureActivePanType();
      const items = rankedPanResults(active);
      const total = state.pan.results.length;
      const activeName = active ? panDiskName(active) : "";
      const progress = state.pan.progress || { active: false, phase: "" };
      if (!total) {
        state.pan.renderKeys = "";
        const emptyText = panEmptyStateText();
        let hintText = state.pan.keyword ? `${state.pan.keyword} · 未找到资源` : "";
        if (progress.active && progress.phase === "initial") {
          hintText = state.pan.keyword ? `${state.pan.keyword} · 正在搜索` : "正在搜索盘搜资源...";
        } else if (progress.active && progress.phase === "retry") {
          hintText = state.pan.keyword ? `${state.pan.keyword} · 连接异常，正在重试` : "连接异常，正在重试";
        } else if (progress.active && progress.phase === "polling") {
          hintText = state.pan.keyword ? `${state.pan.keyword} · 暂未发现资源，正在继续检索` : "正在继续检索盘搜资源...";
        } else if (progress.phase === "initial-failed") {
          hintText = state.pan.keyword ? `${state.pan.keyword} · 搜索失败` : "搜索失败";
        } else if (progress.phase === "session-timeout") {
          hintText = state.pan.keyword ? `${state.pan.keyword} · 搜索超时` : "搜索超时";
        }
        $("panSearchHint").textContent = hintText;
        list.replaceChildren(emptyNode(emptyText));
        return;
      }
      if (progress.active && progress.phase === "retry") {
        $("panSearchHint").textContent = `${state.pan.keyword} · 连接异常，正在重试`;
      } else if (progress.active) {
        $("panSearchHint").textContent = `${state.pan.keyword} · 共 ${total} 条 · 正在继续更新`;
      } else {
        $("panSearchHint").textContent = state.pan.keyword ? `${state.pan.keyword} · 共 ${total} 条${activeName ? " · " + activeName + " " + items.length : ""}` : "";
      }
      if (!items.length) {
        state.pan.renderKeys = "";
        list.replaceChildren(emptyNode("当前网盘暂无资源"));
        return;
      }
      const keys = `${active}\n` + items.map((item) => `${item.key}:${getPanHealth(item).state}:${item.normalizedUrl || ""}`).join("\n");
      const activeEl = document.activeElement;
      const shouldRestore = !!(activeEl && list.contains(activeEl)) || state.pan.focusMode === "results";
      const restoreKey = shouldRestore && activeEl.dataset.panKey || state.pan.focusKey || "";
      list.setAttribute("tabindex", "-1");
      list.setAttribute("role", "listbox");
      if (patchPanResultList(list, items, active, shouldRestore, restoreKey)) return;
      if (keys === state.pan.renderKeys && list.children.length === items.length) {
        restorePanResultFocus(list, restoreKey, shouldRestore);
        return;
      }
      state.pan.renderKeys = keys;
      list.replaceChildren(...items.map(panResultNode));
      observePanVisibleItems();
      restorePanResultFocus(list, restoreKey, shouldRestore);
    }

    function patchPanResultList(list, items, active, shouldRestore, restoreKey) {
      const existing = Array.from(list.querySelectorAll(".pan-result-item"));
      if (!existing.length || existing.some((node) => !items.some((item) => item.key === node.dataset.panKey))) return false;
      const nodes = new Map(existing.map((node) => [node.dataset.panKey, node]));
      const ordered = items.map((item) => {
        const node = nodes.get(item.key);
        if (node) {
          updatePanResultNode(node, item);
          return node;
        }
        return panResultNode(item);
      });
      let reference = list.firstChild;
      ordered.forEach((node) => {
        if (node === reference) {
          reference = reference.nextSibling;
          return;
        }
        list.insertBefore(node, reference);
      });
      state.pan.renderKeys = `${active}\n` + items.map((item) => `${item.key}:${getPanHealth(item).state}:${item.normalizedUrl || ""}`).join("\n");
      observePanVisibleItems();
      restorePanResultFocus(list, restoreKey, shouldRestore);
      return true;
    }

    function updatePanResultNode(button, item) {
      const health = getPanHealth(item);
      button.className = "pan-result-item focusable" + (health.state === "bad" ? " is-bad" : "");
      button.dataset.panKey = item.key;
      button.innerHTML = panResultHtml(item, health);
    }

    function restorePanResultFocus(list, key, shouldRestore) {
      if (!shouldRestore || !list) return;
      const target = key ? findByDataset(list, "panKey", key) : null;
      const fallback = list.querySelector(".pan-result-item");
      lockPanFocus(target || fallback, "results", { keepBlockPosition: true, once: true });
    }

    function lockPanFocus(target, mode, options) {
      if (!target) return;
      const opts = options || {};
      const apply = () => {
        if (!$("panSearchBlock") || $("panSearchBlock").style.display === "none") return;
        if (mode && state.pan.focusMode && state.pan.focusMode !== mode) return;
        const active = document.activeElement;
        const inPan = active && ($("panTabs").contains(active) || $("panResultList").contains(active));
        if (inPan && mode && state.pan.focusMode !== mode) return;
        if (inPan && active === target) return;
        if (!isVisibleFocusable(target)) return;
        state.pan.focusMode = mode || state.pan.focusMode;
        focusPanTarget(target, opts);
      };
      requestAnimationFrame(apply);
      if (opts.once) return;
      setTimeout(apply, 80);
      setTimeout(apply, 220);
    }

    function focusPanTarget(target, options) {
      if (!target) return;
      const opts = options || {};
      const list = $("panResultList");
      const tabs = $("panTabs");
      const keepBlockPosition = opts.keepBlockPosition || Date.now() < Number(state.pan.keepBlockPositionUntil || 0);
      if (tabs && tabs.contains(target) && !keepBlockPosition) centerPanSearchBlock();
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        target.focus();
      }
      if (list && list.contains(target)) {
        if (isTvLikeDevice()) {
          revealFocusedTarget(target);
          return;
        }
        keepPanResultItemVisible(target, list);
        if (!opts.keepBlockPosition) ensurePanListViewport();
        return;
      }
      if (tabs && tabs.contains(target)) {
        if (isTvLikeDevice()) revealFocusedTarget(target);
        return;
      }
      if (isTvLikeDevice()) {
        revealFocusedTarget(target);
        return;
      }
      const rect = target.getBoundingClientRect();
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      if (height && (rect.top < 48 || rect.bottom > height - 48)) {
        try { target.scrollIntoView({ block: "nearest", inline: "nearest" }); } catch (e) { target.scrollIntoView(false); }
      }
    }

    function centerPanSearchBlock() {
      const block = $("panSearchBlock");
      const detail = $("detailSheet");
      if (!block || !detail || !detail.classList.contains("active")) return;
      if (isTvLikeDevice()) {
        revealVerticalInContainer(block, detail);
        return;
      }
      try {
        block.scrollIntoView({ block: "center", inline: "nearest" });
      } catch (e) {
        const blockRect = block.getBoundingClientRect();
        const detailRect = detail.getBoundingClientRect();
        const height = detail.clientHeight || window.innerHeight || 0;
        if (!height) return;
        detail.scrollTop += blockRect.top - detailRect.top - Math.round((height - Math.min(blockRect.height, height * .72)) / 2);
      }
    }

    function ensurePanListViewport() {
      const list = $("panResultList");
      const detail = $("detailSheet");
      if (!list || !detail || !detail.classList.contains("active")) return;
      if (isTvLikeDevice()) {
        revealVerticalInContainer(list, detail);
        return;
      }
      const listRect = list.getBoundingClientRect();
      const detailRect = detail.getBoundingClientRect();
      const height = detail.clientHeight || window.innerHeight || 0;
      if (!height) return;
      const topLimit = detailRect.top + Math.max(34, height * .1);
      const bottomLimit = detailRect.top + height - Math.max(50, height * .1);
      if (listRect.top < topLimit) detail.scrollTop += listRect.top - topLimit;
      else if (listRect.bottom > bottomLimit && listRect.top > topLimit) detail.scrollTop += Math.min(listRect.top - topLimit, listRect.bottom - bottomLimit);
    }

    function keepPanResultItemVisible(target, list) {
      if (isTvLikeDevice()) {
        revealVerticalInContainer(target, list, 20, 20);
        return;
      }
      const itemRect = target.getBoundingClientRect();
      const listRect = list.getBoundingClientRect();
      const topDelta = itemRect.top - listRect.top;
      const bottomDelta = itemRect.bottom - listRect.bottom;
      if (topDelta < 0) list.scrollTop += topDelta;
      else if (bottomDelta > 0) list.scrollTop += bottomDelta;
    }

    function findByDataset(root, name, value) {
      if (!root) return null;
      return Array.from(root.querySelectorAll("[data-" + name.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) + "]"))
        .find((el) => String(el.dataset[name] || "") === String(value || "")) || null;
    }

    function panResultNode(item) {
      const health = getPanHealth(item);
      const button = document.createElement("button");
      button.className = "pan-result-item focusable" + (health.state === "bad" ? " is-bad" : "");
      button.type = "button";
      button.dataset.panKey = item.key;
      button.innerHTML = panResultHtml(item, health);
      button.addEventListener("focus", () => { state.pan.focusKey = item.key; state.pan.focusMode = "results"; });
      button.addEventListener("click", () => playPanResult(item));
      return button;
    }

    function panResultHtml(item, health) {
      const quality = panQualityInfo(item);
      // 合并规则：
      // 1. DolbyVision + 杜比全景声同时命中 → 合并为「双杜比」
      // 2. 4K + 1080P 同时命中 → 只保留 4K，去掉 1080P
      const _hasDV    = quality.tags.some(t => t.cls === "dv");
      const _hasAtmos = quality.tags.some(t => t.label === "杜比全景声");
      const _has4K    = quality.tags.some(t => t.label === "4K");
      let _tags = quality.tags;
      if (_hasDV && _hasAtmos)
        _tags = [{ label: "双杜比", cls: "dv" }, ..._tags.filter(t => t.cls !== "dv" && t.label !== "杜比")];
      if (_has4K)
        _tags = _tags.filter(t => t.label !== "1080P");
      const qualityTags = _tags.map((t) => `<span class="pan-tag quality${t.cls ? " " + t.cls : ""}">${escapeHtml(t.label)}</span>`).join("");
      return `
        <div class="pan-result-title">
          <span>${escapeHtml(item.title || state.pan.keyword || "盘搜资源")}</span>
          ${panHealthIndicatorHtml(item, health)}
        </div>
        ${qualityTags ? `<div class="pan-result-meta">${qualityTags}</div>` : ""}
      `;
    }

    async function rememberPanPlaybackReturn(item, episodeTarget) {
      const detail = $("detailSheet");
      const list = $("panResultList");
      const key = item && item.key || state.pan.focusKey || "";
      const lastPlayUrl = item && (item.normalizedUrl || item.normalized_url || item.url) || "";
      const panProvider = resolvePanProviderForHistory({
        diskType: item && (item.diskType || item.disk_type),
        panProvider: item && (item.panProvider || item.pan_provider),
        provider: item && item.provider,
        lastPlayUrl
      });
      // 先更新内存态，再做 best-effort 的持久化，避免 Native handoff 被 cache 阻塞。
      state.pan.playbackReturn = {
        key,
        activeType: state.pan.activeType || "",
        detailScrollTop: detail ? Math.round(detail.scrollTop || 0) : 0,
        listScrollTop: list ? Math.round(list.scrollTop || 0) : 0,
        episodeTarget: episodeTarget || currentPlaybackTargetForItem(state.selected) || null,
        item: state.selected ? normalizeSnapshot(state.selected) : null,
        panProvider,
        panPassword: item && (item.password || item.pwd || item.passcode) || "",
        panTitle: item && (item.title || item.note) || "",
        panFileName: item && (item.fileName || item.file_name || item.filename) || "",
        panFileId: item && (item.fileId || item.file_id) || "",
        resourceId: item && (item.resourceId || item.resource_id) || "",
        lastPlayUrl,
        at: Date.now()
      };
      state.pan.focusKey = key;
      state.pan.focusMode = "results";
      await saveUiSnapshotNow();
    }

    async function persistPlaybackBeforeNativeHandoff(item, episodeTarget, panItem, handoffAction) {
      const tasks = [];
      const enqueue = (taskFactory) => {
        try {
          tasks.push(Promise.resolve(taskFactory()));
        } catch (error) {
          tasks.push(Promise.reject(error));
        }
      };
      // 三项在同一轮启动；总 barrier 只有一个 800ms 上限，不为每项分别计时。
      enqueue(() => rememberPanPlaybackReturn(panItem, episodeTarget));
      if (item) {
        enqueue(() => saveHistoryPlaybackContext(item, episodeTarget, panItem, { refreshRecent: false }));
        enqueue(() => upsertContinueIndex(item, episodeTarget, panItem, { refreshRecent: false }));
      }
      const allSettled = Promise.all(tasks.map((task) => Promise.resolve(task).then(
        (value) => ({ status: "fulfilled", value }),
        (reason) => ({ status: "rejected", reason })
      )));
      let timer = 0;
      const result = await Promise.race([
        allSettled.then((values) => ({ status: "settled", values })),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ status: "timeout" }), PLAYBACK_SNAPSHOT_TIMEOUT_MS);
        })
      ]);
      clearTimeout(timer);
      if (handoffAction) {
        recordPanDirectHandoffStage(result && result.status === "settled" ? "SNAPSHOT_OK" : "SNAPSHOT_TIMEOUT", handoffAction.item, handoffAction, {
          snapshotOutcome: result && result.status || "timeout",
          snapshotTaskCount: tasks.length
        });
      }
      return result;
    }

    function restorePanPlaybackReturn(options) {
      const opts = options || {};
      const saved = state.pan.playbackReturn;
      if (!saved) return false;
      const detail = $("detailSheet");
      const block = $("panSearchBlock");
      if (!detail || !detail.classList.contains("active") || !block || !block.classList.contains("active")) return false;
      if (saved.episodeTarget) state.detailEpisodeTarget = normalizePlaybackTarget(state.selected, saved.episodeTarget);
      if (saved.activeType) state.pan.activeType = saved.activeType;
      state.pan.focusKey = saved.key || state.pan.focusKey || "";
      state.pan.focusMode = "results";
      if (!opts.skipRender) renderPanResults();
      const apply = () => {
        const currentDetail = $("detailSheet");
        const currentList = $("panResultList");
        if (currentDetail) currentDetail.scrollTop = Number(saved.detailScrollTop || 0);
        if (currentList) currentList.scrollTop = Number(saved.listScrollTop || 0);
        const target = saved.key ? findByDataset(currentList, "panKey", saved.key) : null;
        const fallback = currentList && currentList.querySelector(".pan-result-item");
        if (target || fallback) lockPanFocus(target || fallback, "results");
      };
      requestAnimationFrame(apply);
      setTimeout(apply, 80);
      setTimeout(apply, 240);
      state.pan.playbackReturn = null;
      scheduleUiSnapshotSave();
      return true;
    }

    function panHealthLabel(state) {
      return ({ ok: "链接有效", bad: "链接失效", locked: "需要提取码", unsupported: "暂不支持检测", uncertain: "检测结果不确定", pending: "检测中", idle: "未检测" })[state] || "未检测";
    }

    function panHealthIndicatorHtml(item, health) {
      if (!canCheckPanLinks() || !isPanCheckSupported(item)) return "";
      const stateValue = health && health.state || "idle";
      const title = health && health.summary ? `${panHealthLabel(stateValue)}：${health.summary}` : panHealthLabel(stateValue);
      return `<span class="pan-health ${escapeAttr(stateValue)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}"></span>`;
    }

    function observePanVisibleItems() {
      const list = $("panResultList");
      if (state.pan.observer) state.pan.observer.disconnect();
      if (!canCheckPanLinks()) return;
      if (!list || !rankedPanResults(state.pan.activeType).some(isPanCheckSupported) || !("IntersectionObserver" in window)) {
        queueAllVisiblePanFallback();
        return;
      }
      state.pan.observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.25) return;
          const key = entry.target.dataset.panKey;
          const item = state.pan.results.find((value) => value.key === key);
          queuePanCheck(item);
        });
      }, { root: list, threshold: [0.25, 0.6] });
      list.querySelectorAll(".pan-result-item").forEach((node) => state.pan.observer.observe(node));
      scheduleVisiblePanCheck();
    }

    function scheduleVisiblePanCheck() {
      clearTimeout(scheduleVisiblePanCheck.timer);
      scheduleVisiblePanCheck.timer = setTimeout(queueVisiblePanChecks, 90);
    }

    function queueVisiblePanChecks() {
      if (!canCheckPanLinks()) return;
      const list = $("panResultList");
      if (!list) return;
      const listRect = list.getBoundingClientRect();
      const bottomLimit = listRect.bottom + Math.max(80, listRect.height * .35);
      Array.from(list.querySelectorAll(".pan-result-item")).some((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.bottom < listRect.top || rect.top > bottomLimit) return false;
        const item = state.pan.results.find((value) => value.key === node.dataset.panKey);
        queuePanCheck(item);
        return state.pan.queued.size + state.pan.inFlight.size >= 10;
      });
    }

    function queueAllVisiblePanFallback() {
      if (!canCheckPanLinks()) return;
      queueVisiblePanChecks();
    }

    function queuePanCheck(item) {
      if (!item || !canCheckPanLinks() || !isPanCheckSupported(item)) return;
      const key = panHealthKey(item);
      if (!key || isPanHealthFresh(item) || state.pan.pending[key] || state.pan.queued.has(key) || state.pan.inFlight.has(key)) return;
      state.pan.queued.set(key, item);
      schedulePanCheckFlush();
    }

    function schedulePanCheckFlush() {
      if (state.pan.flushTimer) return;
      state.pan.flushTimer = setTimeout(() => {
        state.pan.flushTimer = 0;
        flushPanCheckQueue();
      }, 180);
    }

    async function flushPanCheckQueue() {
      if (!canCheckPanLinks()) {
        state.pan.queued.clear();
        return;
      }
      if (!state.pan.queued.size) return;
      const entries = Array.from(state.pan.queued.entries()).slice(0, 10);
      entries.forEach(([key]) => state.pan.queued.delete(key));
      entries.forEach(([key]) => {
        state.pan.pending[key] = true;
        state.pan.inFlight.add(key);
      });
      const context = { token: state.pan.viewToken, item: state.selected };
      renderPanResults();
      try {
        const response = await sdk().pan.check(entries.map(([, item]) => ({ type: item.diskType, url: item.url, password: item.password })));
        if (!panContextIsCurrent(context)) return;
        const results = response && Array.isArray(response.results) ? response.results : [];
        entries.forEach(([originalKey, fallback], index) => {
          const result = results[index] || {};
          const normalizedUrl = String(result.normalized_url || result.normalizedUrl || "").trim();
          if (normalizedUrl) fallback.normalizedUrl = normalizedUrl;
          const health = {
            state: result.state || "uncertain",
            summary: result.summary || "",
            checkedAt: result.checked_at || Date.now(),
            expiresAt: result.expires_at || Date.now() + 300000
          };
          state.pan.health[originalKey] = health;
          invalidateAutomaticReadyForHealth(fallback, health.state, context);
          const resultKey = panHealthKey({ diskType: normalizePanDiskType(result.type || fallback.diskType), url: result.url || fallback.url });
          if (resultKey && resultKey !== originalKey) {
            state.pan.health[resultKey] = health;
            invalidateAutomaticReadyForHealth({
              diskType: normalizePanDiskType(result.type || fallback.diskType),
              url: result.url || fallback.url
            }, health.state, context);
          }
        });
        setPanStatus(`已检测 ${checkedPanCount()}/${checkablePanCount()}`);
      } catch (e) {
        if (panContextIsCurrent(context)) {
          entries.forEach(([, item]) => {
            state.pan.health[panHealthKey(item)] = { state: "uncertain", summary: e.message || "检测失败", checkedAt: Date.now(), expiresAt: Date.now() + 300000 };
          });
          setPanStatus("检测不可用");
        }
      } finally {
        if (panContextIsCurrent(context)) {
          entries.forEach(([key]) => {
            delete state.pan.pending[key];
            state.pan.inFlight.delete(key);
          });
          renderPanResults();
          scheduleVisiblePanCheck();
          if (state.pan.queued.size) schedulePanCheckFlush();
        }
      }
    }

    function checkedPanCount() {
      return state.pan.results.filter((item) => isPanCheckSupported(item) && !!state.pan.health[panHealthKey(item)]).length;
    }

    function checkablePanCount() {
      return state.pan.results.filter(isPanCheckSupported).length;
    }

    function panPasswordParam(item, url) {
      const type = normalizePanDiskType(item && item.diskType);
      const target = String(url || "").toLowerCase();
      if (type === "115" || /(^|\/\/)([^/]*\.)?(115|115cdn|anxia)\./i.test(target)) return "password";
      return "pwd";
    }

    function hasPanPassword(url) {
      return /(?:[?&#])(pwd|password|passcode|code)=/i.test(String(url || ""));
    }

    function addPanPassword(url, password, item) {
      let target = String(url || "").trim();
      const code = String(password || "").trim();
      if (!target || !code || hasPanPassword(target)) return target;
      if (/^(magnet:|ed2k:\/\/)/i.test(target)) return target;
      const param = panPasswordParam(item, target);
      try {
        const parsed = new URL(target);
        parsed.searchParams.set(param, code);
        return parsed.toString();
      } catch (e) {
        const hashIndex = target.indexOf("#");
        const base = hashIndex >= 0 ? target.slice(0, hashIndex) : target;
        const hash = hashIndex >= 0 ? target.slice(hashIndex) : "";
        const sep = base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?";
        return base + sep + param + "=" + encodeURIComponent(code) + hash;
      }
    }

    function buildPanPlayPayload(item) {
      let url = String(item && (item.normalizedUrl || item.normalized_url || item.url) || "").trim();
      if (!url) return null;
      if (/^push:\/\//i.test(url)) url = url.replace(/^push:\/\//i, "");
      return {
        type: normalizePanDiskType(item && item.diskType),
        url,
        password: item && item.password || "",
        title: item && (item.title || state.pan.keyword || item.url) || ""
      };
    }

    async function freshPanPreflight(item, context, options) {
      const opts = options || {};
      const checkable = !!(item && isPanCheckSupported(item));
      if (!item || !checkable || !panCheckAvailable()) {
        recordPanPreflightResult(item ? [item] : [], {}, checkable ? 1 : 0, item, false);
        return { available: false, cancelled: false, timedOut: false, checkError: false };
      }
      const checked = opts.playback
        ? await playbackPanHealthPreflight([item], context)
        : { states: await probePanHealth([item], { context }), timedOut: false, checkError: false };
      const states = checked.states || {};
      if (!panContextIsCurrent(context)) return { available: false, cancelled: true };
      const key = item.key || panHealthKey(item);
      const available = Object.prototype.hasOwnProperty.call(states, key);
      recordPanPreflightResult([item], states, available ? 0 : 1, item, false);
      if (!available) return { available: false, cancelled: false, timedOut: !!checked.timedOut, checkError: !!checked.checkError };
      return { available: true, cancelled: false, state: states[key] || "uncertain", timedOut: false, checkError: false };
    }

    async function playPanResult(item, options) {
      const opts = options || {};
      const selectedItem = state.selected;
      const episodeTarget = normalizePlaybackTarget(selectedItem, opts.episodeTarget || currentPlaybackTargetForItem(selectedItem));
      const payload = buildPanPlayPayload(item);
      if (!payload) {
        if (opts.handoffAction) updateDirectPlayStatus(opts.handoffAction.token, "FINAL_ERROR", DIRECT_PLAY_STATUS_TEXT.FINAL_ERROR, "invalid_payload");
        toast("播放资源无效，请重新选择资源");
        return;
      }
      if (!opts.prechecked) {
        const context = { token: state.pan.viewToken, item: selectedItem };
        if (opts.handoffAction) recordPanDirectHandoffStage("HEALTH_CHECK_START", selectedItem, opts.handoffAction, { healthCheckCandidateCount: 1 });
        const preflight = await freshPanPreflight(item, context, { playback: true });
        if (opts.handoffAction) {
          recordPanDirectHandoffStage(preflight.timedOut ? "HEALTH_CHECK_TIMEOUT" : "HEALTH_CHECK_OK", selectedItem, opts.handoffAction, {
            healthCheckTimedOut: !!preflight.timedOut,
            healthCheckError: !!preflight.checkError,
            healthCheckAvailable: !!preflight.available
          });
        }
        if (preflight.cancelled) return;
        if (preflight.available && preflight.state === "bad") {
          toast("该资源检测可能失效，仍尝试播放");
        }
      }
      if (opts.handoffAction) recordPanDirectHandoffStage("SNAPSHOT_START", selectedItem, opts.handoffAction);
      if (selectedItem) {
        const nativeIdentity = {
          siteKey: "push_agent",
          vodId: payload.url,
          episodeUrl: payload.url,
          episodeName: item && (item.fileName || item.file_name || item.filename || item.panFileName || item.title) || selectedItem && selectedItem.title || "",
          flag: item && (item.flag || item.diskType || item.provider) || "",
          playbackOrigin: "pan-push"
        };
        rememberWatchIntent(selectedItem, "search", episodeTarget, nativeIdentity);
        startWatchTracking(selectedItem, episodeTarget, nativeIdentity);
      }
      // Native handoff 前把播放器返回、History Context、Continue Index 做成
      // 一个有界 best-effort barrier；任何单项失败都不得阻塞 pan.play。
      await persistPlaybackBeforeNativeHandoff(selectedItem, episodeTarget, item, opts.handoffAction);
      try {
        const pan = sdk().pan || {};
        if (!pan.play) throw new Error("当前 App 不支持 pan.play");
        // 用 localStorage 持久化标记，WebView 被挂起后 JS 内存会丢失
        // 但 localStorage 会保留，visibilitychange/pageshow/fmresume 恢复时可以读到
        localStorage.setItem("fm_pan_playing", "1");
        state.pan.isPlaying = true;
        cancelPendingDirectPlay("play_started");
        const result = pan.play(payload);  // 不 await，原生接管后 Promise 可能永不 resolve
        if (opts.handoffAction) recordPanDirectHandoffStage("PAN_PLAY_CALLED", selectedItem, opts.handoffAction, { panPlayReturnedThenable: !!(result && typeof result.then === "function") });
        if (result && typeof result.catch === "function") {
          result.catch((error) => {
            if (typeof opts.onPlayFailure === "function") opts.onPlayFailure(error);
            else handlePanPlayFailure(selectedItem, error, opts.handoffAction && opts.handoffAction.token);
          });
        }
      } catch (e) {
        if (typeof opts.onPlayFailure === "function") opts.onPlayFailure(e);
        else handlePanPlayFailure(selectedItem, e, opts.handoffAction && opts.handoffAction.token);
      }
    }

    function handlePanPlayFailure(item, error, actionId) {
      localStorage.removeItem("fm_pan_playing");
      state.pan.isPlaying = false;
      state.pan.playbackReturn = null;
      if (actionId && updateDirectPlayStatus(actionId, "FINAL_ERROR", DIRECT_PLAY_STATUS_TEXT.FINAL_ERROR, "play_failure")) {
        const status = state.directPlayStatus;
        clearTimeout(status.clearTimer);
        status.clearTimer = setTimeout(() => clearDirectPlayStatus(actionId, "final_error_timeout"), DIRECT_PLAY_STATUS_FINAL_ERROR_MS);
      }
      toast("播放失败：" + (error && error.message || "unknown"));
    }

    function emptyNode(text) {
      const node = document.createElement("div");
      node.className = "empty";
      node.textContent = text;
      return node;
    }

    function closeDetail(fromPopState) {
      const sheet = $("detailSheet");
      if (!sheet) return;
      clearDirectPlayStatus(0, "route_leave");
      cancelPendingDirectPlay("detail_closed");
      cancelDetailPlaybackPreparation("detail_closed");
      state.detailHistoryHandoff = null;
      // 防止动画期间重复触发
      if (sheet.classList.contains("sheet-closing")) return;

      // 停止轮播和盘搜
      stopDetailCoverCarousel(true);
      resetPanSearch();
      // TV 持久全屏：返回主页时保持工具栏隐藏；其余情形恢复工具栏
      if (tvFullscreenActive()) {
        setNativeToolbarVisible(false);
      } else {
        setNativeToolbarVisible(true);
      }

      const heroBgEl = $("detailHeroBg");
      const blurEl = $("detailBlurLayer");
      // hero-bg：加 closing 触发 0.22s 快速淡出，而非直接移除 active（0.45s 慢淡会导致背景残留模糊底部卡片）
      if (heroBgEl) {
        heroBgEl.classList.remove("active");
        heroBgEl.classList.add("closing");
      }
      // blur-layer：加 transition 后淡出再隐藏，避免还没开始关闭动画就瞬间消失
      if (blurEl) {
        blurEl.style.transition = "opacity 0.22s ease";
        blurEl.style.opacity = "0";
      }

      const FADE = 240;
      // 关闭详情时需要回退 history：从 #detail pop 回主页哨兵
      const needBack = !fromPopState && location.hash === "#detail";

      // 触发整体淡出动画
      sheet.classList.add("sheet-closing");
      state.detailClosing = true;
      document.body.classList.add("detail-closing");

      // fromPopState 路径：history.back() 已发生，立即补哨兵防止动画期间再按返回退出 App
      if (!needBack) {
        ensureHomeHistoryEntry();
      }
      setTimeout(() => {
        state.detailClosing = false;
        document.body.classList.remove("detail-closing");
        sheet.classList.remove("active");
        sheet.classList.remove("sheet-closing");
        sheet.classList.remove("detail-large");
        sheet.style.display = "";
        sheet.setAttribute("aria-hidden", "true");
        document.body.classList.remove("detail-active");
        state.detailReturn = null;
        state.detailMode = "FIRST_PLAY";
        state.detailModeItemKey = "";
        state.detailHistory = null;
        if (heroBgEl) {
          heroBgEl.classList.remove("active", "closing");
          heroBgEl.style.backgroundImage = "none";
        }
        if (blurEl) {
          blurEl.style.transition = "";
          blurEl.style.opacity = "";
          blurEl.classList.remove("active");
        }
        const savedHomeScrollY = state.homeReturn && Number.isFinite(Number(state.homeReturn.scrollY))
          ? Math.max(0, Number(state.homeReturn.scrollY))
          : null;
        restoreHomeReturn();
        scheduleUiSnapshotSave();
        if (needBack) {
          // 保存当前主页滚动位置，history.back() 后 popstate 会重置它
          _pendingHomeScrollY = savedHomeScrollY != null
            ? Math.round(savedHomeScrollY)
            : Math.round(homeScrollTop());
          history.back();
        } else {
          // 系统返回键路径：popstate 里保存的位置，动画结束后还原
          if (_pendingHomeScrollY > 0) {
            const _sy = _pendingHomeScrollY;
            _pendingHomeScrollY = 0;
            window.scrollTo(0, _sy);
            document.documentElement.scrollTop = _sy;
            document.body.scrollTop = _sy;
          }
        }
      }, FADE);
    }

    function openSync(options) {
      const opts = options || {};
      ensureSheetViewport($("syncSheet"));
      $("syncSheet").classList.add("active");
      $("syncSheet").setAttribute("aria-hidden", "false");
      $("nsecInput").value = state.identity ? state.identity.nsec : "";
      if (!opts.skipHistory && location.hash !== "#sync") history.pushState({ sheet: "sync" }, "", "#sync");
      scheduleUiSnapshotSave();
      if (!opts.restore) setTimeout(() => focusRemoteTarget($("saveNsecBtn")), 40);
    }

    function closeSync(fromPopState) {
      const sheet = $("syncSheet");
      sheet.classList.remove("active");
      sheet.style.display = "";
      sheet.setAttribute("aria-hidden", "true");
      scheduleUiSnapshotSave();
      if (!fromPopState && location.hash === "#sync") history.back();
    }

    function nativeSearchReturnMarkerFor() {
      let marker = null;
      try {
        const raw = localStorage.getItem("fm_detail_native_search_return");
        marker = raw ? JSON.parse(raw) : null;
      } catch (e) {
        try { localStorage.removeItem("fm_detail_native_search_return"); } catch (e) {}
        return null;
      }
      if (!marker || !marker.itemKey || !Number(marker.at)
        || Date.now() - Number(marker.at) > 30 * 60 * 1000) {
        try { localStorage.removeItem("fm_detail_native_search_return"); } catch (e) {}
        return null;
      }
      return marker;
    }

    function nativeSearchHistorySnapshotFor(item, history) {
      if (!item) return null;
      const candidate = arguments.length > 1 ? history : recentNativeHistoryWinnerFor(item);
      if (!candidate || !detailHasAuthoritativeNativeHistory(candidate) || !detailHistoryMatches(item, candidate)) return null;
      return {
        itemKey: panSearchItemKey(item),
        siteKey: String(candidate.siteKey || candidate.nativeSiteKey || "").trim(),
        vodId: String(candidate.vodId || candidate.nativeVodId || "").trim(),
        nativeHistoryKey: String(candidate.nativeHistoryKey || candidate.historyKey || "").trim(),
        episodeUrl: String(candidate.episodeUrl || "").trim(),
        episode: Number(candidate.episodeNumber || 0) || 0,
        episodeName: String(candidate.episodeTitle || "").trim(),
        position: historyPlaybackPositionValue(candidate),
        progress: Number(candidate.progress || 0) || 0,
        createTime: Number(candidate.createTime || 0) || 0,
        updatedAt: Number(candidate.updatedAt || 0) || 0
      };
    }

    function nativeSearchHistoryChangeReason(item, marker, winner) {
      if (!item || !marker || marker.itemKey !== panSearchItemKey(item)) return "";
      const before = marker.historySnapshot && marker.historySnapshot.itemKey === marker.itemKey
        ? marker.historySnapshot
        : null;
      const after = nativeSearchHistorySnapshotFor(item, winner);
      if (!after) return "";
      if (!before) return "new-history";

      const beforeSite = String(before.siteKey || "").trim();
      const afterSite = String(after.siteKey || "").trim();
      const beforeVod = String(before.vodId || "").trim();
      const afterVod = String(after.vodId || "").trim();
      const beforeKey = String(before.nativeHistoryKey || "").trim();
      const afterKey = String(after.nativeHistoryKey || "").trim();
      if (beforeSite !== afterSite || beforeVod !== afterVod || beforeKey && afterKey && beforeKey !== afterKey) {
        return "identity-change";
      }

      const beforeEpisodeUrl = String(before.episodeUrl || "").trim();
      const afterEpisodeUrl = String(after.episodeUrl || "").trim();
      if (beforeEpisodeUrl && afterEpisodeUrl && beforeEpisodeUrl !== afterEpisodeUrl) return "episode-change";
      const beforeEpisode = Number(before.episode || 0) || 0;
      const afterEpisode = Number(after.episode || 0) || 0;
      if (beforeEpisode > 0 && afterEpisode > 0 && beforeEpisode !== afterEpisode) return "episode-change";
      const beforePosition = Number(before.position || 0) || 0;
      const afterPosition = historyPlaybackPositionValue(after);
      if (afterPosition > beforePosition) return "progress-advanced";
      const beforeProgress = Number(before.progress || 0) || 0;
      const afterProgress = Number(after.progress || 0) || 0;
      if (afterProgress > beforeProgress) return "progress-advanced";
      return "";
    }

    function nativeSearchHistoryChanged(item, marker, winner) {
      return !!nativeSearchHistoryChangeReason(item, marker, winner);
    }

    function setNativeSearchReturnMarker(item) {
      if (!item) return;
      const detailRun = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        ? state.detailPlayback
        : null;
      try {
        localStorage.setItem("fm_detail_native_search_return", JSON.stringify({
          itemKey: panSearchItemKey(item),
          mediaKey: recentWatchingMediaKey(item),
          at: Date.now(),
          detailRunToken: Number(detailRun && detailRun.token || 0) || 0,
          detailRunItemKey: String(detailRun && detailRun.itemKey || panSearchItemKey(item)),
          historySnapshot: nativeSearchHistorySnapshotFor(item)
        }));
      } catch (e) {}
    }

    function clearNativeSearchReturnMarker() {
      try { localStorage.removeItem("fm_detail_native_search_return"); } catch (e) {}
    }

    async function nativeSearch(title) {
      if (!title) return;
      const item = state.selected;
      if (item && $("detailSheet") && $("detailSheet").classList.contains("active")) {
        setNativeSearchReturnMarker(item);
      }
      rememberDetailReturn($("detailSearchBtn"));
      try {
        await sdk().search(title, { direct: true });
      } catch (e) {
        clearNativeSearchReturnMarker();
        throw e;
      }
      toast("已发起原生搜索");
    }

    async function openLiveHome() {
      try {
        const api = sdk();
        if (window.fm && api.openLive) {
          await api.openLive();
          toast("已打开直播");
        } else if (api.openLive) {
          await api.openLive();
        } else if (window.fongmi && window.fongmi.app && window.fongmi.app.openLive) {
          await window.fongmi.app.openLive();
          toast("已打开直播");
        } else {
          toast("当前环境不支持打开直播");
        }
      } catch (e) {
        toast("打开直播失败：" + (e.message || "unknown"));
      }
    }

    async function openKeepHome() {
      try {
        const api = sdk();
        if (window.fm && api.openKeep) {
          await api.openKeep();
          toast("已打开收藏");
        } else if (api.openKeep) {
          await api.openKeep();
        } else if (window.fongmi && window.fongmi.app && window.fongmi.app.openKeep) {
          await window.fongmi.app.openKeep();
          toast("已打开收藏");
        } else {
          toast("当前环境不支持打开收藏");
        }
      } catch (e) {
        toast("打开收藏失败：" + (e.message || "unknown"));
      }
    }

    async function openSettingHome() {
      rememberFocusReturn();
      try {
        const api = sdk();
        if (window.fm && api.openSetting) {
          await api.openSetting();
          toast("已打开设置");
        } else if (api.openSetting) {
          await api.openSetting();
        } else if (window.fongmi && window.fongmi.app && window.fongmi.app.openSetting) {
          await window.fongmi.app.openSetting();
          toast("已打开设置");
        } else {
          toast("当前环境不支持打开设置");
        }
      } catch (e) {
        toast("打开设置失败：" + (e.message || "unknown"));
      }
    }

    function rememberDetailReturn(target) {
      const detail = $("detailSheet");
      if (!detail || !detail.classList.contains("active")) return;
      state.detailReturn = {
        scrollTop: Math.round(detail.scrollTop || 0),
        targetId: target && target.id || document.activeElement && document.activeElement.id || "detailSearchBtn",
        episodeTarget: currentPlaybackTargetForItem(state.selected),
        at: Date.now()
      };
      saveUiSnapshotNow();
    }

    function restoreDetailReturn() {
      const saved = state.detailReturn;
      if (!saved) return false;
      const detail = $("detailSheet");
      if (!detail || !detail.classList.contains("active")) return false;
      const apply = () => {
        if (saved.episodeTarget) state.detailEpisodeTarget = normalizePlaybackTarget(state.selected, saved.episodeTarget);
        const savedTarget = saved.targetId && $(saved.targetId);
        const target = isVisibleFocusable(savedTarget) ? savedTarget : detailPrimaryActionButton() || $("closeDetailBtn");
        if (isTvLikeDevice() && isDetailPrimaryAction(target)) {
          restoreDetailTopAnchor({ reason: "player_return", fromTarget: document.activeElement, target });
          return;
        }
        if ($("detailSheet")) $("detailSheet").scrollTop = Number(saved.scrollTop || 0);
        if (target) focusRemoteTarget(target);
      };
      requestAnimationFrame(apply);
      setTimeout(apply, 80);
      setTimeout(apply, 220);
      state.detailReturn = null;
      scheduleUiSnapshotSave();
      return true;
    }

    function rememberWatchIntent(item, action, playbackTarget, nativeIdentity) {
      if (!item) return;
      const normalizedIdentity = nativeIdentity
        ? normalizeNativeHistoryProgressIdentity(item, playbackTarget, nativeIdentity)
        : null;
      state.watch = {
        item: normalizeSnapshot(item),
        timer: state.watch.timer,
        bestMs: state.watch.bestMs || 0,
        durationMs: state.watch.durationMs || 0,
        lastAt: Date.now(),
        published: false,
        intentAction: action || "view",
        playbackTarget: normalizePlaybackTarget(item, playbackTarget || currentPlaybackTargetForItem(item)),
        playbackOrigin: normalizedIdentity ? normalizedIdentity.playbackOrigin : "",
        nativeHistoryIdentity: normalizedIdentity,
        nativeHistoryWrite: null
      };
      savePendingWatch();
    }

    function playbackOriginForNativeIdentity(item, identity) {
      const source = identity && typeof identity === "object" ? identity : {};
      const selected = item && typeof item === "object" ? item : {};
      const explicit = String(source.playbackOrigin || source.origin || "").trim().toLowerCase();
      if (explicit === "native-vod" || explicit === "pan-push") return explicit;
      const siteKey = String(source.siteKey || selected.nativeSiteKey || selected.siteKey || "").trim().toLowerCase();
      const vodId = String(source.vodId || selected.nativeVodId || selected.vodId || "").trim();
      const replayKind = String(selected.historyReplayKind || "").trim().toUpperCase();
      if (siteKey === "push_agent" || replayKind === "PAN_NATIVE" || replayKind === "URL_NATIVE" || /^https?:\/\//i.test(vodId)) {
        return "pan-push";
      }
      return siteKey && vodId ? "native-vod" : "pan-push";
    }

    function playbackOriginForWatch(watch) {
      if (!watch) return "pan-push";
      const explicit = String(watch.playbackOrigin || watch.nativeHistoryIdentity && watch.nativeHistoryIdentity.playbackOrigin || "").trim().toLowerCase();
      if (explicit === "native-vod" || explicit === "pan-push") return explicit;
      return playbackOriginForNativeIdentity(watch.item, watch.nativeHistoryIdentity);
    }

    function normalizeNativeHistoryProgressIdentity(item, playbackTarget, identity) {
      const source = identity && typeof identity === "object" ? identity : {};
      const target = playbackTarget && typeof playbackTarget === "object" ? playbackTarget : {};
      const selected = item && typeof item === "object" ? item : {};
      return {
        siteKey: String(source.siteKey || selected.nativeSiteKey || selected.siteKey || "").trim(),
        vodId: String(source.vodId || selected.nativeVodId || selected.vodId || "").trim(),
        flag: String(source.flag || selected.flag || selected.sourceType || "").trim(),
        episodeName: String(source.episodeName || target.episodeTitle || selected.episodeTitle || "").trim(),
        episodeUrl: String(source.episodeUrl || source.vodId || "").trim(),
        playbackOrigin: playbackOriginForNativeIdentity(selected, source)
      };
    }

    function nativeHistoryProgressEpisodeName(watch) {
      const item = watch && watch.item || {};
      const target = watch && watch.playbackTarget || {};
      const identity = watch && watch.nativeHistoryIdentity || {};
      const direct = [
        identity.episodeName,
        target.episodeTitle,
        item.episodeTitle,
        item.panFileName,
        item.panTitle,
        item.title || item.vodName
      ].map((value) => String(value || "").trim()).find(Boolean);
      if (direct) return direct;
      const season = Math.max(0, Number(target.seasonNumber || item.seasonNumber || 0));
      const episode = Math.max(0, Number(target.episodeNumber || item.episodeNumber || 0));
      return season > 0 && episode > 0
        ? "S" + String(season).padStart(2, "0") + "E" + String(episode).padStart(2, "0")
        : "";
    }

    function buildNativeHistoryProgressPayload(watch, status) {
      const item = watch && watch.item || {};
      const identity = watch && watch.nativeHistoryIdentity || {};
      const positionMs = Math.max(0, Math.round(Number(watch && watch.bestMs || status && status.position || 0)));
      const durationMs = Math.max(0, Math.round(Number(watch && watch.durationMs || status && status.duration || 0)));
      const siteKey = String(identity.siteKey || "").trim();
      const vodId = String(identity.vodId || "").trim();
      const episodeUrl = String(identity.episodeUrl || vodId).trim();
      if (!siteKey || !vodId || positionMs <= 0 || durationMs <= 0 || !episodeUrl) return null;
      const speedValue = Number(status && (status.speed != null ? status.speed : status.playbackRate != null ? status.playbackRate : status.rate));
      const speed = Number.isFinite(speedValue) && speedValue > 0 ? speedValue : 1;
      return {
        siteKey,
        vodId,
        vodName: String(item.title || item.vodName || "").trim(),
        vodPic: String(item.pic || item.vodPic || item.image || "").trim(),
        flag: String(identity.flag || item.flag || item.sourceType || "").trim(),
        episodeName: nativeHistoryProgressEpisodeName(watch),
        episodeUrl,
        positionMs,
        durationMs,
        speed,
        completed: positionMs >= durationMs * 0.92,
        updatedAt: Date.now()
      };
    }

    function nativeHistoryProgressBody(response) {
      const hasNestedBody = !!(response && (response.body != null || response.data != null));
      const body = response && response.body != null ? response.body : response && response.data;
      if (body && typeof body === "object") return body;
      if (typeof body === "string") return safeJson(body, {});
      if (!hasNestedBody && response && typeof response === "object") return response;
      return {};
    }

    function nativeHistoryProgressAction(data) {
      const body = data && typeof data === "object" ? data : {};
      const items = Array.isArray(body.items) ? body.items : [];
      const itemAction = items[0] && items[0].action;
      const directAction = String(itemAction || body.action || "").trim().toLowerCase();
      if (directAction) return directAction;
      if (Number(body.created || 0) > 0) return "created";
      if (Number(body.updated || 0) > 0) return "updated";
      return "";
    }

    function recordNativeHistoryProgressDiag(payload, endpoint, response, data, outcome, error) {
      if (!isTvDiagnosticEnabled()) return null;
      const body = data && typeof data === "object" ? data : {};
      const items = Array.isArray(body.items) ? body.items : [];
      const item = items[0] && typeof items[0] === "object" ? items[0] : {};
      const diag = {
        endpoint: String(endpoint || ""),
        request: payload || null,
        status: Number(response && (response.status || response.code) || 0),
        action: nativeHistoryProgressAction(body),
        message: String(item.message || body.message || body.error || error || ""),
        outcome: String(outcome || "")
      };
      state.tvDiag.nativeHistoryProgress = diag;
      try { console.debug("[Nostr TV][NATIVE_HISTORY_PROGRESS_DIAG]", diag); } catch (e) {}
      updateTvDiagnostic();
      return diag;
    }

    async function nativeHistoryProgressRequestContext() {
      const context = await nativeHistoryLocalRequestContext("/api/playback/progress");
      return context && typeof context.request === "function" ? context : null;
    }

    function nativeHistoryProgressPosition(history) {
      const value = historyNestedValue(history, [
        "positionMs",
        "position_ms",
        "position",
        "playbackPosition",
        "playback_position"
      ]);
      const position = Number(value || 0);
      return Number.isFinite(position) && position > 0 ? position : 0;
    }

    async function verifyNativeHistoryProgressVisible(payload, expectedPositionMs) {
      const expected = Math.max(0, Number(expectedPositionMs || payload && payload.positionMs || 0));
      const tolerance = Math.max(3000, Math.min(8000, Math.round(expected * 0.01)));
      const maxAttempts = 3;
      const retryDelay = 220;
      let lastPosition = 0;
      let lastError = "";
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
          const list = await sdk().history();
          const histories = Array.isArray(list) ? list : [];
          const match = histories.find((history) => {
            const parts = historyKeyParts(history);
            return String(parts.siteKey || "").trim() === String(payload && payload.siteKey || "").trim()
              && String(parts.vodId || "").trim() === String(payload && payload.vodId || "").trim();
          });
          lastPosition = match ? nativeHistoryProgressPosition(match) : 0;
          if (match && lastPosition + tolerance >= expected) {
            try {
              console.debug("RECENT_PROGRESS_READBACK_OK =", {
                attempt: attempt + 1,
                identity: String(payload && payload.siteKey || "") + "\u001f" + String(payload && payload.vodId || ""),
                expectedPositionMs: expected,
                actualPositionMs: lastPosition,
                toleranceMs: tolerance
              });
            } catch (e) {}
            return {
              ok: true,
              attempts: attempt + 1,
              expectedPositionMs: expected,
              actualPositionMs: lastPosition,
              toleranceMs: tolerance
            };
          }
        } catch (e) {
          lastError = String(e && e.message || e || "最近观看回读失败");
        }
        try {
          console.debug("RECENT_PROGRESS_READBACK_ATTEMPT =", {
            attempt: attempt + 1,
            expectedPositionMs: expected,
            actualPositionMs: lastPosition,
            error: lastError
          });
        } catch (e) {}
        if (attempt < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
      try {
        console.debug("RECENT_PROGRESS_READBACK_TIMEOUT =", {
          attempts: maxAttempts,
          expectedPositionMs: expected,
          actualPositionMs: lastPosition,
          toleranceMs: tolerance,
          error: lastError
        });
      } catch (e) {}
      return {
        ok: false,
        attempts: maxAttempts,
        expectedPositionMs: expected,
        actualPositionMs: lastPosition,
        toleranceMs: tolerance,
        error: lastError
      };
    }

    function startWatchTracking(item, playbackTarget, nativeIdentity) {
      if (!item || !window.fm) return;
      const normalizedIdentity = normalizeNativeHistoryProgressIdentity(
        item,
        playbackTarget,
        nativeIdentity || state.watch.nativeHistoryIdentity
      );
      state.watch = {
        item: normalizeSnapshot(item),
        timer: state.watch.timer,
        bestMs: 0,
        durationMs: 0,
        lastAt: Date.now(),
        published: false,
        intentAction: state.watch.intentAction || "",
        playbackTarget: normalizePlaybackTarget(item, playbackTarget || state.watch.playbackTarget || currentPlaybackTargetForItem(item)),
        playbackOrigin: normalizedIdentity.playbackOrigin,
        nativeHistoryIdentity: normalizedIdentity,
        nativeHistoryWrite: null
      };
      savePendingWatch();
      if (!state.watch.timer) state.watch.timer = setInterval(sampleWatchStatus, 12000);
      sampleWatchStatus({ skipNativeHistorySync: true });
    }

    async function savePendingWatch() {
      const watch = state.watch;
      if (!watch || !watch.item) return;
      try {
        await sdk().cache.set(cacheKey("pendingWatch"), JSON.stringify({
          item: watch.item,
          intentAction: watch.intentAction,
          playbackTarget: watch.playbackTarget || null,
          nativeHistoryIdentity: watch.nativeHistoryIdentity || null,
          startedAt: watch.lastAt || Date.now(),
          published: !!watch.published
        }));
      } catch (e) {}
    }

    async function loadPendingWatch() {
      if (state.watch && state.watch.item) return state.watch;
      try {
        const text = await sdk().cache.get(cacheKey("pendingWatch"));
        const data = text ? JSON.parse(text) : null;
        if (!data || !data.item) return null;
        const pendingIdentity = data.nativeHistoryIdentity
          ? normalizeNativeHistoryProgressIdentity(data.item, data.playbackTarget, data.nativeHistoryIdentity)
          : null;
        state.watch = {
          item: normalizeSnapshot(data.item),
          timer: state.watch.timer,
          bestMs: 0,
          durationMs: 0,
          lastAt: data.startedAt || Date.now(),
          published: !!data.published,
          intentAction: data.intentAction || "search",
          playbackTarget: data.playbackTarget || normalizePlaybackTarget(data.item, data.item),
          playbackOrigin: pendingIdentity ? pendingIdentity.playbackOrigin : "",
          nativeHistoryIdentity: pendingIdentity,
          nativeHistoryWrite: null
        };
        return state.watch;
      } catch (e) {
        return null;
      }
    }

    async function clearPendingWatch() {
      try { await sdk().cache.del(cacheKey("pendingWatch")); } catch (e) {}
    }

    async function sampleWatchStatus(options) {
      const opts = options || {};
      const watch = state.watch;
      if (!watch || !watch.item || !window.fm) return;
      try {
        const status = await fm.stat();
        if (state.watch !== watch) return;
        const position = Math.max(0, Number(status && status.position || 0));
        const duration = Math.max(0, Number(status && status.duration || 0));
        if (duration > 0) watch.durationMs = duration;
        if (position > watch.bestMs) watch.bestMs = position;
        const completion = watch.durationMs > 0 ? watch.bestMs / watch.durationMs : 0;
        if (watch.bestMs >= WATCH_HEAT_MS && hasHeatIntent(watch) && !watch.published) {
          if (await hasPublishedHeat(watch.item)) {
            watch.published = true;
            await savePendingWatch();
            await clearPendingWatch();
            return;
          }
          watch.published = true;
          savePendingWatch();
          await recordPreference(watch.item, "watch", {
            watchMs: Math.round(watch.bestMs),
            durationMs: Math.round(watch.durationMs),
            completion: Number(Math.min(1, completion).toFixed(3)),
            intentAction: watch.intentAction,
            playState: status && status.state,
            playTitle: status && status.title || ""
          });
          await clearPendingWatch();
        }
        if (completion >= .92 && watch.bestMs > 0) stopWatchTracking(false);
      } catch (e) {}
    }

    async function settleWatchFromHistory() {
      const watch = await loadPendingWatch();
      if (!watch || !watch.item || watch.published) return;
      if (await hasPublishedHeat(watch.item)) {
        watch.published = true;
        await savePendingWatch();
        await clearPendingWatch();
        return;
      }
      try {
        const list = await sdk().history();
        const history = findWatchHistory(watch.item, Array.isArray(list) ? list : []);
        if (!history) return;
        const position = Math.max(0, Number(history.position || 0));
        const duration = Math.max(0, Number(history.duration || 0));
        if (position < WATCH_HEAT_MS || !hasHeatIntent(watch)) return;
        if (await hasPublishedHeat(watch.item)) {
          await clearPendingWatch();
          return;
        }
        watch.bestMs = position;
        watch.durationMs = duration;
        watch.published = true;
        await savePendingWatch();
        await recordPreference(watch.item, "watch", {
          watchMs: Math.round(position),
          durationMs: Math.round(duration),
          completion: duration > 0 ? Number(Math.min(1, position / duration).toFixed(3)) : 0,
          intentAction: watch.intentAction,
          historyKey: history.key || "",
          siteKey: history.siteKey || "",
          vodId: history.vodId || "",
          playTitle: history.vodName || ""
        });
        await clearPendingWatch();
        toast("已同步观看偏好");
      } catch (e) {}
    }

    async function settlePlayerReturnHistory() {
      const watch = state.watch && state.watch.item ? state.watch : await loadPendingWatch();
      const playbackOrigin = playbackOriginForWatch(watch);
      const nativeAuthoritative = playbackOrigin === "native-vod" || playbackOrigin === "pan-push";
      try {
        console.debug("PLAYER_RETURN_HISTORY_MODE=" + (nativeAuthoritative ? "native-authoritative" : "unknown"));
        console.debug("PLAYBACK_ORIGIN=" + playbackOrigin);
      } catch (e) {}
      if (watch && watch.item && window.fm) {
        // Both native VOD and PAN/PUSH are owned by the Native Player.
        // Keep the final fm.stat() sample for watch metrics, but never write
        // the sampled position back through WebHome or perform read-back.
        await sampleWatchStatus({ skipNativeHistorySync: true, refreshRecent: false });
      }
      await settleWatchFromHistory();
    }

    function retireDetailPreparedPlaybackAfterNativeSearch(item, marker, reason) {
      if (!item || state.selected !== item || !marker) return false;
      const itemKey = panSearchItemKey(item);
      if (String(marker.itemKey || "") !== itemKey) return false;
      const capturedRunToken = Number(marker.detailRunToken || 0) || 0;
      const capturedRunItemKey = String(marker.detailRunItemKey || "").trim();
      const run = state.detailPlayback && detailPlaybackIsCurrent(state.detailPlayback)
        ? state.detailPlayback
        : null;
      const capturedRunMatches = !!(run && capturedRunToken
        && capturedRunItemKey === itemKey
        && String(run.itemKey || "") === capturedRunItemKey
        && Number(run.token || 0) === capturedRunToken);
      if (!capturedRunMatches) {
        try {
          console.debug("NATIVE_SEARCH_PREPARED_RETIRE_SKIPPED", JSON.stringify({
            itemKey,
            reason: reason || "native_search_history_changed",
            capturedRunToken,
            currentRunToken: Number(run && run.token || 0),
            capturedRunItemKey,
            currentRunItemKey: String(run && run.itemKey || "")
          }));
        } catch (e) {}
        return false;
      }
      clearDirectPlayStatus(run.token, reason || "native_search_history_changed");
      run.candidate = null;
      run.continueResource = null;
      run.playRequested = false;
      run.handoffStarted = false;
      cancelDetailPlaybackPreparation(reason || "native_search_history_changed");
      if (state.detailHistoryHandoff && state.detailHistoryHandoff.item === item) state.detailHistoryHandoff = null;
      state.historyResume = null;
      state.detailEpisodeTarget = null;
      if (state.pan && state.pan.directReady && state.pan.directReady.itemKey === itemKey) {
        state.pan.directReady = null;
      }
      if (state.pan && state.pan.directFailure && state.pan.directFailure.itemKey === itemKey) {
        state.pan.directFailure = null;
      }
      try {
        console.debug("NATIVE_SEARCH_PREPARED_RETIRED", JSON.stringify({
          itemKey,
          reason: reason || "native_search_history_changed",
          runToken: Number(run.token || 0),
          capturedRunToken
        }));
      } catch (e) {}
      return true;
    }

    function reconcileDetailAfterNativeReturn(item, origin) {
      const detail = $("detailSheet");
      if (!detail || !detail.classList.contains("active") || !item || state.selected !== item) return false;
      if (state.recent && state.recent.error) return false;
      let marker = null;
      let nativeSearchChangeReason = "";
      if (origin === "native-search") {
        marker = nativeSearchReturnMarkerFor();
        if (!marker || marker.itemKey !== panSearchItemKey(item)) return false;
      }
      const winner = recentNativeHistoryWinnerFor(item);
      const history = winner && detailHasAuthoritativeNativeHistory(winner)
        && detailHistoryMatches(item, winner) ? winner : null;
      if (origin === "native-search") {
        const historyChanged = nativeSearchHistoryChanged(item, marker, history);
        nativeSearchChangeReason = historyChanged ? nativeSearchHistoryChangeReason(item, marker, history) : "";
        if (history) {
          retireDetailPreparedPlaybackAfterNativeSearch(
            item,
            marker,
            nativeSearchChangeReason || "native_search_authoritative_history"
          );
        }
        try {
          console.debug("NATIVE_SEARCH_HISTORY_CHANGED", JSON.stringify({
            itemKey: panSearchItemKey(item),
            changed: !!nativeSearchChangeReason,
            reason: nativeSearchChangeReason || "unchanged"
          }));
        } catch (e) {}
      }
      syncDetailMode(item, history, { freshNative: true });
      updateDetailContinueButton();
      try {
        console.debug("DETAIL_RETURN_RECONCILE", JSON.stringify({
          itemKey: panSearchItemKey(item),
          historyFound: !!history,
          nativeProgress: history ? historyPlaybackPositionValue(history) : 0,
          finalMode: history ? "CONTINUE" : "FIRST_PLAY",
          historyChanged: !!nativeSearchChangeReason,
          origin: origin || "native-return"
        }));
      } catch (e) {}
      return true;
    }

    // 滚动恢复：closeDetail(needBack) 路径下 history.back() 会重置 scrollY，用此变量暂存
    let _pendingHomeScrollY = 0;

    function ensureHomeHistoryEntry() {
      if (!location.hash) {
        const _sy = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
        history.pushState({ sheet: "home" }, "", location.pathname + location.search);
        if (_sy > 0) {
          window.scrollTo(0, _sy);
          document.documentElement.scrollTop = _sy;
          document.body.scrollTop = _sy;
        }
      }
    }

    function scheduleHistorySettlement() {
      settleWatchFromHistory();
      setTimeout(settleWatchFromHistory, 1200);
      setTimeout(settleWatchFromHistory, 4000);
    }

    function findWatchHistory(item, list) {
      const title = normalizeTitle(item.title || "");
      const tmdbId = item.tmdbId ? String(item.tmdbId) : "";
      return list
        .filter((history) => history && Number(history.position || 0) > 0)
        .filter((history) => !state.watch.lastAt || Number(history.createTime || 0) >= state.watch.lastAt - 30000)
        .sort((a, b) => Number(b.createTime || 0) - Number(a.createTime || 0))
        .find((history) => {
          const name = normalizeTitle(history.vodName || "");
          if (title && name && (title === name || title.includes(name) || name.includes(title))) return true;
          if (tmdbId && String(history.vodId || "").includes(tmdbId)) return true;
          return false;
        });
    }

    async function hasPublishedHeat(item) {
      const identity = state.identity && state.identity.pubkey;
      if (!identity || !item) return false;
      const mediaKeyValue = mediaHeatKey(item);
      if (!mediaKeyValue) return false;
      const vector = await hotGetMyVector();
      return hotVectorHasMedia(vector, mediaKeyValue);
    }

    function stopWatchTracking(flush) {
      const watch = state.watch;
      if (flush && watch && watch.item && watch.bestMs >= WATCH_HEAT_MS && hasHeatIntent(watch) && !watch.published) {
        const completion = watch.durationMs > 0 ? watch.bestMs / watch.durationMs : 0;
        trackPreference(watch.item, "watch", {
          watchMs: Math.round(watch.bestMs),
          durationMs: Math.round(watch.durationMs),
          completion: Number(Math.min(1, completion).toFixed(3)),
          intentAction: watch.intentAction
        });
      }
      if (watch && watch.timer) clearInterval(watch.timer);
      state.watch = { item: null, timer: 0, bestMs: 0, durationMs: 0, lastAt: 0, published: false, intentAction: "", playbackTarget: null, playbackOrigin: "", nativeHistoryIdentity: null };
    }

    function trackPreference(item, action, extra) {
      recordPreference(item, action, extra).catch(() => {});
    }

    async function recordPreference(item, action, extra) {
      if (action !== "watch") return;
      if (await isPreferencePublishBlocked()) {
        setStatus("publish", "删除保护中，暂停发布");
        return;
      }
      if (action === "watch" && await hasPublishedHeat(item)) return;
      const event = await createPreferenceEvent(item, action, extra || {});
      if (!event) return;
      event.local = true;
      await hotIngestEvent(event);
      scheduleRender();
      publishEvent(event);
    }

    async function createPreferenceEvent(item, action, extra) {
      const identity = await ensureIdentity();
      if (!identity) return null;
      if (action === "watch" && Math.max(0, Number(extra.watchMs || extra.position || 0)) < WATCH_HEAT_MS) return null;
      const snapshot = normalizeSnapshot(item);
      const currentItem = hotVectorItemFromSnapshot(snapshot, hotToday());
      if (!currentItem) return null;
      const oldVector = await hotGetMyVector();
      const createdAt = Math.max(hotNow(), Number(oldVector && oldVector.ts || 0) + 1);
      const expiresAt = hotExpiresAt(createdAt);
      const items = hotWireItemsForPublish(oldVector, currentItem, createdAt);
      const content = { v: HOT_VECTOR_VERSION, i: items };
      const tags = [
        ["d", HOT_VECTOR_D],
        ["t", window.WEBHOME_CONFIG.nostr.tag],
        ["app", "fongmi-webhome"],
        ["expiration", String(expiresAt)]
      ];
      const draft = { kind: window.WEBHOME_CONFIG.nostr.kind, created_at: createdAt, tags, content: JSON.stringify(content) };
      if (identity && identity.secret && window.NostrTools) return window.NostrTools.finalizeEvent(draft, identity.secret);
      if (window.nostr && window.nostr.signEvent) return await window.nostr.signEvent(draft);
      return Object.assign({ id: HOT_VECTOR_D, pubkey: "" }, draft);
    }
