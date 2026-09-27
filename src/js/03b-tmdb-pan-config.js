    function sanitizeTmdbConfig(value) {
      const raw = value && typeof value === "object" ? value : {};
      return { apiKey: String(raw.apiKey || "").trim() || DEFAULT_TMDB_API_KEY };
    }

    function tmdbApiKey() {
      return String(window.WEBHOME_CONFIG.tmdb.apiKey || "").trim() || DEFAULT_TMDB_API_KEY;
    }

    async function initTmdbConfig(options) {
      options = options || {};
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(options.timeout == null ? 1500 : options.timeout);
      if (options.preserveDirty && state.tmdb.configDirty) return;
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(cacheKey("tmdb")), null); } catch (e) { saved = null; }
      state.tmdb.config = sanitizeTmdbConfig(saved);
      window.WEBHOME_CONFIG.tmdb.apiKey = state.tmdb.config.apiKey;
      state.tmdb.configDirty = false;
      renderTmdbConfigControls();
    }

    function readTmdbConfigControls() {
      return { apiKey: $("tmdbKeyInput") ? $("tmdbKeyInput").value : "" };
    }

    function renderTmdbConfigControls() {
      const config = state.tmdb.config || sanitizeTmdbConfig(null);
      if ($("tmdbKeyInput")) {
        $("tmdbKeyInput").value = config.apiKey || DEFAULT_TMDB_API_KEY;
        disablePanelTextEditing($("tmdbKeyInput"));
      }
    }

    function resetTmdbRuntimeAfterConfigChange() {
      const tvDetail = state.tvDetail;
      if (tvDetail) {
        tvDetail.generation = Number(tvDetail.generation || 0) + 1;
        tvDetail.cache = {};
        tvDetail.cardTasks = {};
        tvDetail.cardQueue = [];
        if (tvDetail.observer) tvDetail.observer.disconnect();
        tvDetail.observer = null;
        if (tvDetail.scanTimer) clearTimeout(tvDetail.scanTimer);
        tvDetail.scanTimer = 0;
      }
      state.catalog = {};
      state.catalogPage = {};
      state.fallback = [];
      state.fallbackPage = { sourceIndex: 0, page: 0, loading: false, loaded: false, done: false };
      state.searchItems = [];
      state.gridRender = {};
      state.recommendationSource = "pending";
      renderSearch();
      renderAll({ deferContent: true });
      loadCatalog();
    }

    function curatedSourceDefaults() {
      const result = {};
      CURATED_SOURCE_DEFINITIONS.forEach((source) => {
        result[source.id] = (source.domains || []).slice();
      });
      return result;
    }

    function normalizeSourceDomain(value) {
      const text = String(value || "").trim().replace(/\/+$/, "");
      if (!/^https?:\/\//i.test(text)) return "";
      try {
        const parsed = new URL(text);
        return parsed.origin + parsed.pathname.replace(/\/+$/, "");
      } catch (e) {
        return "";
      }
    }

    function sanitizeSourceDomains(value) {
      const defaults = curatedSourceDefaults();
      const result = {};
      CURATED_SOURCE_ORDER.forEach((id) => {
        result[id] = (defaults[id] || []).slice(0, 1);
      });
      return result;
    }

    function sanitizeSourceTemplateCache(value) {
      const raw = value && typeof value === "object" ? value : {};
      const result = {};
      CURATED_SOURCE_ORDER.forEach((id) => {
        const template = String(raw[id] || "").trim();
        if (template && (template.includes("{kw}") || template.includes("{keyword}"))) result[id] = template;
      });
      return result;
    }

    function sourceDomainControls() {
      return {
        wanou: $("sourceDomainsWanou"),
        muou: $("sourceDomainsMuou"),
        duoduo: $("sourceDomainsDuoduo"),
        huban: $("sourceDomainsHuban"),
        shandian: $("sourceDomainsShandian")
      };
    }

    function setSourceDomainsOpen(open) {
      const toggle = $("sourceDomainsToggle");
      const body = $("sourceDomainsBody");
      if (!toggle || !body) return false;
      const expanded = !!open;
      body.hidden = !expanded;
      body.setAttribute("aria-hidden", expanded ? "false" : "true");
      toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
      return expanded;
    }

    function toggleSourceDomains() {
      const body = $("sourceDomainsBody");
      return setSourceDomainsOpen(!body || body.hidden);
    }

    function renderSourceDomainControls(sourceDomains) {
      const values = sanitizeSourceDomains(sourceDomains);
      const controls = sourceDomainControls();
      CURATED_SOURCE_ORDER.forEach((id) => {
        const control = controls[id];
        if (!control) return;
        control.value = (values[id] || []).join("\n");
        disablePanelTextEditing(control);
      });
    }

    function restoreSourceDomainDefaults() {
      renderSourceDomainControls(curatedSourceDefaults());
      markPanConfigDirty();
      toast("已恢复站源默认域名，请点击保存配置");
    }

    function readSourceDomainControls() {
      const controls = sourceDomainControls();
      const result = {};
      CURATED_SOURCE_ORDER.forEach((id) => {
        result[id] = String(controls[id] && controls[id].value || "")
          .split(/[\r\n,，]+/)
          .map(normalizeSourceDomain)
          .filter(Boolean);
      });
      return sanitizeSourceDomains(result);
    }

    function defaultPanConfig() {
      return {
        apiBase: window.WEBHOME_CONFIG.pan.apiBase || "https://so.252035.xyz",
        diskTypes: (window.WEBHOME_CONFIG.pan.diskTypes || []).slice(),
        username: "",
        password: "",
        token: "",
        tokenExpiresAt: 0,
        channels: [],
        sourceDomains: curatedSourceDefaults(),
        sourceTemplates: {}
      };
    }

    function normalizePanBase(value) {
      let base = String(value || "").trim() || defaultPanConfig().apiBase;
      if (!/^https?:\/\//i.test(base)) base = "https://" + base;
      return base.replace(/\/+$/, "");
    }

    function normalizePanDiskType(type) {
      const value = String(type || "").trim().toLowerCase();
      if (value === "ali" || value === "alipan") return "aliyun";
      if (value === "123pan") return "123";
      if (value === "139" || value === "caiyun") return "mobile";
      if (value === "pikpakdrive") return "pikpak";
      if (value === "guangyapan") return "guangya";
      if (value === "magnetlink" || value === "magnet:?" || value === "bt") return "magnet";
      if (value === "ed2k:") return "ed2k";
      if (value === "other") return "others";
      return value;
    }

    function resolvePanProviderForHistory(itemOrTarget) {
      const value = itemOrTarget && typeof itemOrTarget === "object" ? itemOrTarget : {};
      const allowed = new Set(PAN_DISK_TYPES.map((item) => item.id));
      const firstValid = (values) => {
        for (const candidate of values) {
          const normalized = normalizePanDiskType(candidate);
          if (normalized && allowed.has(normalized)) return normalized;
        }
        return "";
      };
      return firstValid([
        value.diskType,
        value.disk_type,
        value.panDiskType,
        value.pan_disk_type
      ]) || firstValid([
        value.panProvider,
        value.pan_provider,
        value.provider
      ]) || normalizePanDiskType(curatedDiskTypeForUrl(
        value.lastPlayUrl || value.last_play_url || value.url || value.normalizedUrl || value.normalized_url
      ));
    }

    function normalizePanChannels(value) {
      const list = Array.isArray(value) ? value : String(value || "").split(/[\n,，\s]+/);
      return Array.from(new Set(list.map((item) => String(item || "").trim()).filter(Boolean)));
    }

    function isPanCheckSupported(item) {
      return !!(item && PAN_CHECKABLE_DISK_TYPES.has(normalizePanDiskType(item.diskType)));
    }

    function canCheckPanLinks() {
      const pan = sdk().pan || {};
      return !!(state.pan.checkEnabled && pan.check);
    }

    function sanitizePanConfig(value) {
      const fallback = defaultPanConfig();
      const raw = value && typeof value === "object" ? value : {};
      const allowed = new Set(PAN_DISK_TYPES.map((item) => item.id));
      const disks = Array.isArray(raw.diskTypes) ? raw.diskTypes.map(normalizePanDiskType).filter((item) => allowed.has(item)) : fallback.diskTypes;
      return {
        apiBase: normalizePanBase(raw.apiBase || fallback.apiBase),
        diskTypes: Array.from(new Set(disks.length ? disks : fallback.diskTypes)),
        username: String(raw.username || "").trim(),
        password: String(raw.password || ""),
        token: String(raw.token || ""),
        tokenExpiresAt: Number(raw.tokenExpiresAt || 0),
        channels: normalizePanChannels(raw.channels || raw.tgChannels || raw.channel),
        sourceDomains: sanitizeSourceDomains(raw.sourceDomains),
        sourceTemplates: sanitizeSourceTemplateCache(raw.sourceTemplates)
      };
    }

    async function initPanConfig(options) {
      options = options || {};
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(options.timeout == null ? 1500 : options.timeout);
      if (options.preserveDirty && state.pan.configDirty) return;
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(cacheKey("pan")), null); } catch (e) { saved = null; }
      state.pan.config = sanitizePanConfig(saved);
      state.pan.configDirty = false;
      renderPanConfigControls();
    }

    async function savePanConfig() {
      if (window.fongmiBridge && !window.fm) await waitForNativeSdk(1500);
      if (window.fongmiBridge && !window.fm) throw new Error("App SDK 未就绪，请稍后再保存");
      const previousTmdbKey = tmdbApiKey();
      state.tmdb.config = sanitizeTmdbConfig(readTmdbConfigControls());
      window.WEBHOME_CONFIG.tmdb.apiKey = state.tmdb.config.apiKey;
      state.pan.config = sanitizePanConfig(readPanConfigControls());
      await sdk().cache.set(cacheKey("tmdb"), JSON.stringify(state.tmdb.config));
      await sdk().cache.set(cacheKey("pan"), JSON.stringify(state.pan.config));
      renderTmdbConfigControls();
      renderPanConfigControls();
      state.tmdb.configDirty = false;
      state.pan.configDirty = false;
      setPanStatus("配置已保存");
      closeConnectionPanel();
      toast("配置已保存");
      if (previousTmdbKey !== tmdbApiKey()) resetTmdbRuntimeAfterConfigChange();
    }

    function readPanConfigControls() {
      const checked = Array.from(document.querySelectorAll("#panDiskGrid input:checked")).map((input) => input.value);
      return {
        apiBase: $("panBaseInput") ? $("panBaseInput").value : "",
        username: $("panUserInput") ? $("panUserInput").value : "",
        password: $("panPassInput") ? $("panPassInput").value : "",
        token: state.pan.config && state.pan.config.token || "",
        tokenExpiresAt: state.pan.config && state.pan.config.tokenExpiresAt || 0,
        diskTypes: checked,
        channels: normalizePanChannels($("panChannelsInput") ? $("panChannelsInput").value : ""),
        sourceDomains: readSourceDomainControls(),
        sourceTemplates: state.pan.config && state.pan.config.sourceTemplates || {}
      };
    }

    function renderPanConfigControls() {
      const config = state.pan.config || defaultPanConfig();
      if ($("panBaseInput")) {
        $("panBaseInput").value = config.apiBase;
        disablePanelTextEditing($("panBaseInput"));
      }
      if ($("panChannelsInput")) {
        $("panChannelsInput").value = (config.channels || []).join("\n");
        disablePanelTextEditing($("panChannelsInput"));
      }
      if ($("panUserInput")) {
        $("panUserInput").value = config.username || "";
        disablePanelTextEditing($("panUserInput"));
      }
      if ($("panPassInput")) {
        $("panPassInput").value = config.password || "";
        disablePanelTextEditing($("panPassInput"));
      }
      renderSourceDomainControls(config.sourceDomains);
      const grid = $("panDiskGrid");
      if (!grid) return;
      const selected = new Set(config.diskTypes || []);
      grid.replaceChildren(...PAN_DISK_TYPES.map((disk) => {
        const label = document.createElement("label");
        label.innerHTML = `<input class="focusable" type="checkbox" value="${escapeAttr(disk.id)}" ${selected.has(disk.id) ? "checked" : ""}><span>${escapeHtml(disk.name)}</span>`;
        return label;
      }));
    }

    function markPanConfigDirty(event) {
      const target = event && event.target;
      if (target && target.id === "tmdbKeyInput") state.tmdb.configDirty = true;
      else state.pan.configDirty = true;
    }

    function panDiskName(type) {
      const normalized = normalizePanDiskType(type);
      const item = PAN_DISK_TYPES.find((disk) => disk.id === normalized);
      return item ? item.name : normalized || "网盘";
    }

    function panApi(path) {
      const base = normalizePanBase((state.pan.config || defaultPanConfig()).apiBase);
      if (base.endsWith("/api") && path.startsWith("/api/")) return base + path.slice(4);
      return base + path;
    }

    function panSearchDiskTypes(config) {
      const types = ((config && config.diskTypes) || []).map(normalizePanDiskType).filter(Boolean);
      return Array.from(new Set(types));
    }

    function panSearchPayload(keyword, config) {
      const payload = {
        kw: keyword,
        res: "merge",
        src: "all",
        cloud_types: panSearchDiskTypes(config)
      };
      const channels = normalizePanChannels(config && config.channels || []);
      if (channels.length) payload.channels = channels;
      return payload;
    }

    async function persistPanConfigQuietly() {
      try { await sdk().cache.set(cacheKey("pan"), JSON.stringify(state.pan.config || defaultPanConfig())); } catch (e) {}
    }

    async function ensurePanAuthHeaders() {
      const config = state.pan.config || defaultPanConfig();
      if (!config.username || !config.password) return {};
      if (config.token && Number(config.tokenExpiresAt || 0) * 1000 > Date.now() + 60000) return { Authorization: "Bearer " + config.token };
      const response = await postJson(panApi("/api/auth/login"), { username: config.username, password: config.password }, 12, {});
      const data = response && response.data ? response.data : response;
      const token = data && data.token;
      if (!token) throw new Error(response && (response.error || response.message) || "盘搜认证失败");
      state.pan.config = sanitizePanConfig(Object.assign({}, config, { token, tokenExpiresAt: data.expires_at || 0 }));
      await persistPanConfigQuietly();
      return { Authorization: "Bearer " + token };
    }

