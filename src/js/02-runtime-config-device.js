
    window.WEBHOME_CONFIG = {
      siteKey: "",
      tmdb: {
        apiKey: "d7040155454e7fdf547c4d889ebbcca7",
        apiBase: "https://api.tmdb.org/3",
        language: "zh-CN",
        imageBase: "https://image.tmdb.org/t/p/w342",
        backdropBase: "https://image.tmdb.org/t/p/w1920_and_h800_multi_faces",
        lists: [
          {
            id: "now-playing",
            title: "本周更新",
            hint: "本自然周更新的影视内容",
            mediaType: "all",
            sources: []
          },
          {
            id: "all",
            title: "推荐",
            hint: "近期国内外最新上线",
            mediaType: "all",
            sources: [
              { endpoint: "discover/tv", mediaType: "tv", params: { with_original_language: "zh", with_origin_country: "CN", without_genres: "10764,10766,10767", sort_by: "popularity.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-90", "first_air_date_lte": "today", vote_count_gte: "2" } },
              { endpoint: "discover/movie", mediaType: "movie", params: { with_original_language: "zh", sort_by: "popularity.desc", "primary_release_date_gte": "today-90", "primary_release_date_lte": "today", vote_count_gte: "2" } },
              { endpoint: "movie/now_playing", mediaType: "movie", params: { language: "zh-CN" } },
              { endpoint: "discover/tv", mediaType: "tv", params: { with_original_language: "en", with_origin_country: "US|GB", without_genres: "10764,10767,10766,16", with_watch_providers: "8|337|350|384|9|15|386|531", watch_region: "US", sort_by: "popularity.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-60", "first_air_date_lte": "today" } },
              { endpoint: "discover/movie", mediaType: "movie", params: { with_original_language: "en", with_watch_providers: "8|337|350|384|9|15|386|531", watch_region: "US", sort_by: "popularity.desc", "primary_release_date_gte": "today-90", "primary_release_date_lte": "today", vote_count_gte: "5" } },
              { endpoint: "discover/tv", mediaType: "tv", params: { with_original_language: "ko", with_origin_country: "KR", without_genres: "10764,10767,10766,16", sort_by: "popularity.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-60", "first_air_date_lte": "today" } },
              { endpoint: "discover/tv", mediaType: "tv", params: { with_original_language: "ja", with_origin_country: "JP", without_genres: "10764,10767,10766,16", sort_by: "popularity.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-60", "first_air_date_lte": "today" } }
            ]
          },
          {
            id: "tv",
            title: "电视剧",
            hint: "华语、日韩、欧美等地区剧集",
            mediaType: "tv",
            sources: [
              { endpoint: "discover/tv", mediaType: "tv", params: { with_origin_country: "CN|HK|TW|KR|JP|US|GB", without_genres: "16,99,10763,10764,10766,10767", sort_by: "popularity.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-180", "first_air_date_lte": "today" } },
              { endpoint: "discover/tv", mediaType: "tv", params: { with_origin_country: "CN|HK|TW|KR|JP|US|GB", without_genres: "16,99,10763,10764,10766,10767", sort_by: "first_air_date.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-180", "first_air_date_lte": "today" } }
            ]
          },
          {
            id: "movie",
            title: "电影",
            hint: "最新上映·流媒体",
            mediaType: "movie",
            sources: [
              { endpoint: "movie/now_playing", mediaType: "movie", params: { language: "zh-CN" } },
              { endpoint: "discover/movie", mediaType: "movie", params: { with_original_language: "zh", sort_by: "popularity.desc", "primary_release_date_gte": "today-120" } },
              { endpoint: "discover/movie", mediaType: "movie", params: { with_watch_providers: "8|337|350|384|9|15|386|531", watch_region: "US", sort_by: "popularity.desc", "primary_release_date_gte": "today-90", vote_count_gte: "10" } }
            ]
          },
          {
            id: "anime",
            title: "动画",
            hint: "国内外最新动画",
            mediaType: "tv",
            sources: [
              { endpoint: "discover/tv", mediaType: "tv", params: { with_genres: "16", with_original_language: "ja", with_origin_country: "JP", sort_by: "first_air_date.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-120", "first_air_date_lte": "today" } },
              { endpoint: "discover/tv", mediaType: "tv", params: { with_genres: "16", with_original_language: "zh", sort_by: "first_air_date.desc", include_null_first_air_dates: "false", "first_air_date_gte": "today-120", "first_air_date_lte": "today" } },
              { endpoint: "discover/movie", mediaType: "movie", params: { with_genres: "16", sort_by: "primary_release_date.desc", "primary_release_date_gte": "today-120", "primary_release_date_lte": "today" } }
            ]
          },
          {
            id: "documentary",
            title: "纪录片",
            hint: "全球最热门纪录片",
            mediaType: "all",
            sources: [
              { endpoint: "discover/movie", mediaType: "movie", params: { with_genres: "99", sort_by: "popularity.desc", vote_count_gte: "50", language: "zh-CN" } },
              { endpoint: "discover/tv", mediaType: "tv", params: { with_genres: "99", sort_by: "popularity.desc", vote_count_gte: "20", language: "zh-CN" } },
              { endpoint: "discover/movie", mediaType: "movie", params: { with_genres: "99", with_original_language: "zh", sort_by: "vote_average.desc", vote_count_gte: "20", language: "zh-CN" } }
            ]
          },
          {
            id: "variety",
            title: "综艺",
            hint: "真人秀与脱口秀",
            mediaType: "tv",
            sources: [
              { endpoint: "discover/tv", mediaType: "tv", params: { with_genres: "10764|10767", sort_by: "popularity.desc", include_null_first_air_dates: "false" } }
            ]
          },
        ]
      },
      nostr: {
        kind: 30078,
        tag: "fish2018-home-v1",
        eventsKey: "fish2018_home_v1_events",
        nsecKey: "fish2018_home_v1_nsec",
        relays: [
          "wss://x.kojira.io",
          "wss://relay.lovelana.org",
          "wss://relay.wellorder.net",
          "wss://nostr.mom"
        ]
      },
      pan: {
        apiBase: "https://so.252035.xyz",
        cacheKey: "fish2018_home_v1_pan_config",
        diskTypes: ["quark", "aliyun", "baidu", "uc", "tianyi", "xunlei", "123", "115", "mobile", "pikpak", "guangya", "magnet", "ed2k"],
        checkableDiskTypes: ["quark", "aliyun", "baidu", "uc", "tianyi", "xunlei", "123", "115", "mobile"],
        pollIntervals: [4500, 9000]
      }
    };

    const $ = (id) => document.getElementById(id);
    const DEFAULT_TMDB_API_KEY = String(window.WEBHOME_CONFIG.tmdb.apiKey || "").trim();
    const PAN_DISK_TYPES = [
      { id: "quark", name: "夸克" },
      { id: "aliyun", name: "阿里" },
      { id: "baidu", name: "百度" },
      { id: "uc", name: "UC" },
      { id: "tianyi", name: "天翼" },
      { id: "xunlei", name: "迅雷" },
      { id: "123", name: "123" },
      { id: "115", name: "115" },
      { id: "mobile", name: "移动" },
      { id: "pikpak", name: "PikPak" },
      { id: "guangya", name: "光鸭" },
      { id: "magnet", name: "磁力" },
      { id: "ed2k", name: "电驴" }
    ];
    const PAN_CHECKABLE_DISK_TYPES = new Set(window.WEBHOME_CONFIG.pan.checkableDiskTypes || ["quark", "aliyun", "baidu", "uc", "tianyi", "xunlei", "123", "115", "mobile"]);
    const PAN_HEALTH_PRIORITY = { ok: 0, locked: 1, pending: 2, idle: 3, unsupported: 4, uncertain: 5, bad: 6 };
    const CURATED_SOURCE_ORDER = ["wanou", "muou", "duoduo", "huban", "shandian"];
    const CURATED_SEARCH_URL_TEMPLATES = [
      "/index.php/vod/search/page/{p}/wd/{kw}.html",
      "/vodsearch/-------------.html?wd={kw}&page={p}",
      "/index.php/vod/search/wd/{kw}.html",
      "/vodsearch/{kw}----------{p}---.html",
      "/index.php/vod/search.html?wd={kw}",
      "/search.html?wd={kw}"
    ];
    const CURATED_SOURCE_DEFINITIONS = [
      { id: "wanou", name: "玩偶", domains: ["https://www.wogg.net"], searchUrl: "/vodsearch/-------------.html?wd={kw}&page={p}", searchApi: "https://woog.nxog.eu.org/api.php/provide/vod?ac=detail&wd={kw}" },
      { id: "muou", name: "木偶", domains: ["https://666.666291.xyz"] },
      { id: "duoduo", name: "多多", domains: ["https://tv.yydsys.cc"] },
      { id: "huban", name: "虎斑", domains: ["http://xhban.xyz"] },
      { id: "shandian", name: "闪电", domains: ["http://shandian.blog"] }
    ];
    const CURATED_DISCOVERY_WINDOW_MS = 3000;
    const CURATED_QUALITY_GRACE_MS = 700;
    const CURATED_MIN_REQUEST_START_MS = 1000;
    const CURATED_PREFLIGHT_BUDGET_MS = 700;
    const CURATED_PREFLIGHT_PER_SOURCE = 2;
    const CURATED_MAX_AUTO_CHECK_PER_SOURCE = 6;
    const DETAIL_CONTINUE_GATE_MAX_MS = 300;
    const DETAIL_NATIVE_HISTORY_GATE_MAX_MS = 800;
    const CURATED_REQUEST_TIMEOUT_SEC = 6;
    const CURATED_REQUEST_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36";
    // 画质关键词优先级（score 越高排越前）：
    // DV/HDR10+ > HDR10/HLG > 4K/2160P > REMUX > BluRay > 高码率 > 杜比全景声 > 120fps > 60fps > 1080P > 720P > SDR
    const PAN_QUALITY_KEYWORDS = [
      { re: /(^|[^A-Za-z])DV(?!D)|dolby.?vision|杜比视界/i, score: 10, label: "DolbyVision", cls: "dv" },
      { re: /hdr10\+|hdr10plus/i,                           score: 9,  label: "HDR10+",      cls: "hdrp" },
      { re: /hdr(?!10\+)|hlg|hdr10(?!\+)/i,               score: 8,  label: "HDR" },
      { re: /4k|2160p|uhd/i,                                score: 7,  label: "4K" },
      { re: /remux/i,                                        score: 6,  label: "REMUX" },
      { re: /blu[\-.]?ray/i,                                score: 5,  label: "BluRay" },
      { re: /高码|高码率/i,                                   score: 4,  label: "高码" },
      { re: /vivid/i,                                        score: 4,  label: "Vivid" },
      { re: /杜比(?!视界)|atmos/i,                           score: 3,  label: "杜比全景声" },
      { re: /120fps|120p/i,                                  score: 2,  label: "120fps" },
      { re: /60fps|60p/i,                                    score: 1,  label: "60fps" },
      { re: /1080p|1080i|全高清|fhd/i,                       score: 2,  label: "1080P",       cls: "fhd" },
      { re: /720p/i,                                         score: 1,  label: "720P",        cls: "hd" },
      { re: /480p|576p/i,                                    score: 0,  label: "SD",          cls: "sd" },
      { re: /sdr/i,                                          score: 0,  label: "SDR" },
    ];
    function panQualityInfo(item) {
      const title = String((item && item.title) || "");
      let count = 0, score = 0;
      const tags = [];
      PAN_QUALITY_KEYWORDS.forEach((q) => {
        if (q.re.test(title)) { count++; score += q.score; tags.push({ label: q.label, cls: q.cls || null }); }
      });
      return { count, score, tags };
    }
    const PAGE_OPENED_AT = window.WEBHOME_PAGE_OPENED_AT || Date.now();
    const GRID_INITIAL_ROWS = 3;
    const GRID_APPEND_ROWS = 2;
    const RECENT_UI_TTL_MS = 30000;
    const RECENT_MAX_MEDIA = 100;
    const RECENT_MAX_AGE_DAYS = 180;
    const RECENT_MAX_AGE_MS = RECENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const RECENT_DOUBLE_PRESS_WINDOW_MS = 350;
    const DETAIL_TEXT_CLAMP_LIMIT = 150;
    const DETAIL_TEXT_CLAMP_LIMIT_LARGE = 210;
    const canonicalResourceTitleCache = new Map();
    const canonicalResourceTitlePromises = new Map();

    function canonicalResourceAuthority(value) {
      const authority = String(value || "").trim().toUpperCase();
      if (authority === "EXACT_DETAIL") return "EXACT_DETAIL";
      if (authority === "ITEM_FALLBACK") return "ITEM_FALLBACK";
      return "SEARCH_MULTI_FALLBACK";
    }

    function canonicalResourceCacheEntry(value) {
      if (typeof value === "string") {
        return {
          title: value,
          resourceSearchTitle: value,
          aliases: [],
          authority: "SEARCH_MULTI_FALLBACK"
        };
      }
      if (!value || typeof value !== "object") return null;
      return Object.assign({}, value, {
        authority: canonicalResourceAuthority(value.authority)
      });
    }

    const state = {
      config: null,
      identity: null,
      selected: null,
      detail: null,
      activeList: "all",
      catalog: {},
      catalogPage: {},
      recent: { items: [], loading: false, loadingPromise: null, loaded: false, error: "", refreshedAt: 0, diag: null, nativeItems: [], nativeLoaded: false, nativeLoading: false, nativeRefreshedAt: 0, nativeKeyFlow: {}, runSeq: 0, activeRun: null, pendingRefresh: false, pendingRefreshSilent: true, pendingRefreshReconcileDetail: true },
      movieDetail: { cache: {} },
      tvDetail: { cache: {}, cardTasks: {}, cardQueue: [], cardActive: 0, observer: null, scrollBound: false, scanTimer: 0, generation: 0 },
      homeLatest: { items: [], loading: false, loaded: false, error: "", loadedAt: 0, lastRefreshAt: 0, requestSeq: 0, diag: null, promise: null, cacheChecked: false, cacheHydrated: false, cacheWeekStart: "", cacheSavedAt: 0, cacheItemCount: 0, cacheHydratedAt: 0, networkRefreshReason: "", networkRefreshSucceeded: false, refreshStartedAt: 0, firstRenderableAt: 0 },
      gridRender: {},
      gridColumnCache: {},
      fallback: [],
      fallbackPage: { sourceIndex: 0, page: 0, loading: false, loaded: false, done: false },
      loadingMore: false,
      railScroll: {},
      homeV14: {
        categoryFeeds: {},
        sections: {},
        sectionObserver: null,
        imageObserver: null,
        loadQueue: [],
        activeLoads: 0,
        maxConcurrent: 0,
        requestCount: 0,
        renderedSectionCount: 0,
        loadedSectionCount: 0,
        portraitCardCount: 0,
        landscapeCardCount: 0,
        recentCardCount: 0,
        imageSrcCount: 0,
        imageDeferredCount: 0,
        heroCandidateCount: 0,
        heroExtraTmdbRequestCount: 0,
        heroFeed: {
          items: [],
          loading: false,
          loaded: false,
          loadedAt: 0,
          error: "",
          promise: null,
          requestSeq: 0,
          poolCount: 0,
          detailRequests: 0,
          weeklyMerged: false,
          sourceStats: null
        },
        heroItems: [],
        heroIndex: 0,
        heroItem: null,
        heroTimer: 0,
        heroAutoplayPaused: false,
        heroAutoplayResumeTimer: 0,
        heroBackdropSeq: 0,
        heroBackdropCache: {},
        heroConfirmGuard: null,
        heroSwipe: null,
        heroSwipeSuppressClickUntil: 0,
        weeklyBackdropToken: 0,
        resizeFrame: 0,
        route: "home",
        secondaryListId: "",
        secondaryFilters: {},
        secondaryPage: 1,
        secondaryQueries: {},
        secondaryActiveQueryKey: "",
        secondaryQueryPlan: null,
        secondaryNostrMetaCache: {},
        secondaryNostrAnimeMetaCache: {},
        secondaryNostrTmdbMemoryCache: {},
        nostrTmdbMeta: { version: 1, loaded: false, loading: false, promise: null, entries: {}, dirty: false, dirtyVersion: 0, saveTimer: 0, savePromise: null, lastLoadAt: 0, lastSaveAt: 0, expiredCount: 0, evictedCount: 0 },
        secondaryNostrAnimeResolver: null,
        secondaryNostrAnimeMetrics: null,
        secondaryNostrVarietyResolver: null,
        secondaryNostrVarietyMetrics: null,
        secondaryFocusRestore: null,
        secondaryMediaFocusRestore: null,
        secondaryWeeklyInitialFocusPending: false,
        secondaryReturn: null,
        secondaryHistoryBackPending: false,
        searchHistoryBackPending: false,
        sidebarOpen: false,
        sidebarHistoryEntry: false,
        sidebarHistoryBackPending: false,
        sidebarDeferredAction: null,
        sidebarReturnTarget: null,
        sidebarReturnScrollY: 0,
        sidebarFocusId: "",
        initialHomeFocusPending: false,
        coldHomeFocusPending: false,
        coldHomeFocusEpoch: 0,
        coldHomeFallbackTarget: null,
        focusUserEpoch: 0,
        homeSectionEntryTarget: null,
        lastHomeFocusedRail: "",
        snapshotBound: {}
      },
      searchItems: [],
      searchSubmittedKeyword: "",
      searchLive: {
        timer: 0,
        composing: false,
        keyword: "",
        inputVersion: 0,
        requestSeq: 0,
        activeKeyword: "",
        activeVersion: 0,
        lastRequestedKeyword: "",
        lastRequestedVersion: 0,
        lastCompletedKeyword: "",
        lastCompletedVersion: 0,
        resultKeyword: "",
        loading: false,
        requestInFlight: false,
        error: false
      },
      searchHold: { timer: 0, fired: false, suppressClickUntil: 0, pointer: null, target: null },
      searchImeBlurSeq: 0,
      searchImeFocusSeq: 0,
      searchImeFrameToken: 0,
      suggestions: { keyword: "", items: [], loading: false, timer: 0, seq: 0, controller: null },
      hot: { db: null, dbPromise: null, idb: false, ready: false, version: 0, items: [], media: new Map(), users: new Map(), ingestQueue: Promise.resolve(), refreshTimer: 0 },
      searchHot: { items: [], loading: false, loaded: false, error: "", loadedAt: 0, requestSeq: 0 },
      relay: { connected: 0, published: 0, total: 0, lastOk: 0, lastDone: 0, statuses: {}, subscribeStarted: false, subscribeDone: 0, subscribeFinished: {}, subscribeToken: 0, refresh: null, backfillBusy: {}, backfillTimers: {}, backfillState: {}, queryAborters: new Set(), subscriptionAborters: new Set(), fallbackReadyAt: 0, fallbackTimer: 0, fallbackPrefetchTimer: 0 },
      recommendationSource: "pending",
      status: {
        sdk: "检测中",
        tmdb: "等待请求",
        nostr: "等待连接",
        pan: "未搜索",
        publish: "暂无发布",
        identity: "未就绪",
        refresh: "未执行"
      },
      deleteState: { loaded: false, users: {} },
      tmdb: { config: null, configDirty: false },
      uiPrefs: { loaded: false, homeFullscreenEnabled: true, homeHotSource: "tmdb" },
      blocked: { loaded: false, items: {}, selecting: false, holdTimer: 0, holdTarget: null, longPressFired: false, pointer: null, suppressClickUntil: 0 },
      pan: { config: null, configDirty: false, loading: false, keyword: "", activeType: "", results: [], health: {}, pending: {}, queued: new Map(), inFlight: new Set(), observer: null, flushTimer: 0, pollTimers: [], pollRound: 0, pollRoundStarted: {}, panSnapshotSeq: 0, requestSeq: 0, actualRequestAttempts: 0, lifecycleSeq: 0, sessionId: 0, sessionOrigin: "", sessionItemKey: "", sessionStartedAt: 0, sessionTerminal: false, sessionTerminalReason: "", sessionEndRecorded: false, sessionStartCount: 0, sessionEndCount: 0, sessionTimer: 0, initialAttempts: 0, pollRoundsStarted: 0, pollRoundsCompleted: 0, foregroundRecoveryCount: 0, viewToken: "", searchMode: "", initialSucceeded: false, initialResultState: "", lastFailureKind: "", retryRemaining: 0, finalFailure: false, directTransportExhausted: false, renderKeys: "", tabKeys: "", checkEnabled: false, focusKey: "", focusMode: "", playbackReturn: null, progress: { active: false, phase: "", round: 0, totalRounds: 0 }, preflight: null, directReady: null, directFailure: null, sessionDiag: null, isPlaying: false },
      directPlayStatus: { active: false, actionId: 0, phase: "", text: "", startedAt: 0, clearTimer: 0 },
      watch: { item: null, timer: 0, bestMs: 0, durationMs: 0, lastAt: 0, published: false, intentAction: "", playbackTarget: null, playbackOrigin: "", nativeHistoryIdentity: null },
      historyContexts: { loaded: false, loading: false, promise: null, entries: [], diag: null },
      continueIndex: { loaded: false, loading: false, promise: null, entries: [], diag: null },
      recentDelete: { armedKey: "", armedCard: null, pendingKey: "", pendingCard: null, pendingTimer: 0, remotePressLocked: false, remotePressCard: null, remotePressKey: "" },
      recentManage: { active: false, selectedKeys: {}, deleting: false, deleteArmed: false, deleteArmTimer: 0 },
      detailCover: { images: [], index: 0, timer: 0, token: 0, swipe: null },
      deviceMode: "unknown",
      previewMode: false,
      tvFullscreen: false,
      detailReturn: null,
      detailHistoryHandoff: null,
      detailPlayback: { seq: 0, token: "", itemKey: "", active: false, promise: null, candidate: null, sourceId: "", provider: "", playRequested: false, handoffStarted: false, history: null, historyVerified: false, episodeTarget: null, directAction: null, error: "", raceActive: false, providerCommitted: false, providerCommitCount: 0 },
      detailEpisodeTarget: null,
      historyResume: null,
      detailMode: "FIRST_PLAY",
      detailModeItemKey: "",
      detailHistory: null,
      homeReturn: null,
      focusReturnEl: null,
      remoteInitialFocused: false,
      renderTimer: 0,
      homeContentTimer: 0,
      homeContentSeq: 0,
      activeGridAppendTimer: 0,
      activeGridAppendId: "",
      focusScrollTimer: 0,
      focusScrollTarget: null,
      focusScrollOptions: null,
      tvDiag: {
        key: "",
        from: "",
        to: "",
        scope: "",
        scrollScope: "",
        activeRail: "",
        revealDeltaX: 0,
         revealDeltaY: 0,
         panDirectPlay: null,
         panSearchRequest: null,
         panSearchSession: null,
         panForegroundRecovery: null,
         panForegroundHandoff: null,
         directPlayStatus: null,
         directPlaySession: null,
         foregroundSession: null,
         detailTopAnchor: null,
         historyCompat: null,
         historyItem: null,
         nativeHistoryDelete: null,
         nativeHistoryDeleteProbe: null,
         nativeHistoryProgress: null,
         recentWatching: null,
         homeLatest: null,
         searchIme: null,
         back: null,
         homeV14: null,
         detailRace: null,
         detailRaceLog: [],
         tests: []
      },
      remoteKeyGate: { key: "", at: 0 },
      scrollingUntil: 0,
      infiniteObserver: null,
      scrollLoadTimer: 0,
      resume: { timer: 0, lastAt: 0 }
    };

    const WATCH_HEAT_MS = 10 * 60 * 1000;
    const FALLBACK_PREFETCH_MS = 1000;
    const FALLBACK_SHOW_MS = 1500;
    const HOT_WINDOW_DAYS = 90;
    const HOT_DAY_SECONDS = 24 * 60 * 60;
    const HOT_WINDOW_SECONDS = HOT_WINDOW_DAYS * 24 * 60 * 60;
    const HOT_WINDOW_MS = HOT_WINDOW_SECONDS * 1000;
    const HOT_DB_NAME = "fish2018_home_v1_hot_compact_index";
    const HOT_DB_VERSION = 1;
    const HOT_VECTOR_D = "heat:user:90d:v2";
    const HOT_VECTOR_VERSION = 5;
    const HOT_USER_VECTOR_LIMIT = 300;
    const HOT_TITLE_LIMIT = 60;
    const HOT_POSTER_LIMIT = 96;
    const HOT_PAGE_LIMIT = 1000;
    const HOT_SUBSCRIBE_LIMIT = 500;
    const HOT_RECENT_PAGES_PER_RELAY = 6;
    const HOT_HISTORY_PAGES_PER_RELAY = 10;
    const HOT_BACKFILL_IDLE_MS = 650;
    const HOT_BACKFILL_RETRY_MS = 30000;
    const HOT_BACKFILL_RETRY_MAX_MS = 5 * 60 * 1000;
    const HOT_BACKFILL_MAX_FAILURES = 3;
    const HOT_BACKUP_WINDOW_SECONDS = 7 * HOT_DAY_SECONDS;
    const HOT_REFRESH_IDLE_MS = 260;
    const HOT_REFRESH_BACKFILL_MS = 900;
    const HOT_PRUNE_BATCH = 1000;
    const HOT_RENDER_LIMIT = 1000;
    const UI_SNAPSHOT_TTL_MS = 2 * 60 * 60 * 1000;
    const HISTORY_CONTEXT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const DELETE_REPUBLISH_BLOCK_MS = 24 * 60 * 60 * 1000;
    const DELETE_TOMBSTONE_TTL_MS = HOT_WINDOW_MS + HOT_DAY_SECONDS * 1000;
    const HOME_V14_MAX_CONCURRENT = 2;
    const HOME_V14_SECTION_ROOT_MARGIN = "760px 0px";
    const HOME_V14_IMAGE_ROOT_MARGIN = "700px 250px";
    // Keep only a minimal safety gap above the active Home section.  The
    // section itself, rather than its title or card row, is the anchor.
    const HOME_RAIL_ANCHOR_OFFSET = 8;

    let nativeSdkWait = null;

    function waitForNativeSdk(timeout) {
      if (window.fm || !window.fongmiBridge) return Promise.resolve(!!window.fm);
      if (nativeSdkWait) return nativeSdkWait;
      nativeSdkWait = new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.removeEventListener("fmsdk", finish);
          nativeSdkWait = null;
          resolve(!!window.fm);
        };
        window.addEventListener("fmsdk", finish);
        setTimeout(finish, timeout == null ? 1500 : timeout);
      });
      return nativeSdkWait;
    }

    function sdk() {
      if (window.fm) {
        const pan = window.fm.pan || {};
        return Object.assign({}, window.fm, { pan, check: pan.check || window.fm.check });
      }
      const check = async (items) => ({ results: (items || []).map((item) => ({ type: item.type, url: item.url, normalized_url: item.url, state: "idle", summary: "浏览器预览不检测", cache_hit: false, checked_at: Date.now(), expires_at: Date.now() + 300000 })) });
      const play = async (payload) => {
        const item = payload || {};
        const url = addPanPassword(String(item.url || ""), item.password || "", { diskType: item.type });
        if (url) window.open(url, "_blank", "noopener,noreferrer");
      };
      return {
        req: browserRequest,
        res: (url) => url,
        play: async (url, title) => window.open(url, "_blank", "noopener,noreferrer"),
        search: async (kw) => toast("原生搜索：" + kw),
        openLive: async () => toast("请在 App 中打开直播"),
        openKeep: async () => toast("请在 App 中打开收藏"),
        openSetting: async () => toast("请在 App 中打开设置"),
        history: async () => [],
        vod: async (siteKey, vodId, title) => toast("原生播放：" + (title || vodId || siteKey || "")),
        pan: { check, play },
        check,
        ui: { setToolbar: async () => {} },
        cache: {
          get: async (key) => localStorage.getItem("fm_" + key) || "",
          set: async (key, value) => localStorage.setItem("fm_" + key, value),
          del: async (key) => localStorage.removeItem("fm_" + key)
        },
        site: async () => ({ key: "browser", name: "浏览器预览" }),
        config: async () => ({ id: "browser", url: location.href, driveCheck: false }),
        device: async () => ({ type: 1 })
      };
    }

    function isTvMode() {
      return document.documentElement.classList.contains("tv-mode");
    }

    function isTvPreviewRequested() {
      const search = String(window.location && window.location.search || "");
      try {
        return new URLSearchParams(search).get("_tv") === "1";
      } catch (e) {
        return /(?:^|[?&])_tv=1(?:&|$)/.test(search);
      }
    }

    function isTvPreviewMode() {
      return !!(state.previewMode || document.documentElement.classList.contains("tv-preview"));
    }

    function isTvDiagnosticEnabled() {
      if (document.documentElement.classList.contains("tv-diagnostic-enabled")) return true;
      const search = String(window.location && window.location.search || "");
      try {
        return new URLSearchParams(search).get("_tv_diag") === "1";
      } catch (e) {
        return /(?:^|[?&])_tv_diag=1(?:&|$)/.test(search);
      }
    }

    // 兜底 TV 检测：WebView 被系统回收重建后，"tv-mode" class 可能还没来得及挂上
    // （setTvMode 要等 isNativeLeanbackClient() 为真才执行），此时若仍用 isTvMode()
    // 判断会误判为非 TV，导致全屏 hero-bg / 4 层渐变模糊层错误激活，
    // 在 TV 上表现为播放器返回后整页冻结的毛玻璃模糊（看起来像"空白"）+ 严重卡顿。
    function isTvLikeDevice() {
      return isTvMode() || isTvPreviewMode() || state.deviceMode === "leanback" || isNativeLeanbackClient();
    }

    function isNativeMobileClient() {
      const client = window.fongmiClient || {};
      if (client.isMobile === true) return true;
      if (String(client.mode || "").toLowerCase() === "mobile") return true;
      return false;
    }

    function isNativeLeanbackClient() {
      const client = window.fongmiClient || {};
      if (client.isLeanback === true) return true;
      if (String(client.mode || "").toLowerCase() === "leanback") return true;
      return false;
    }

    function syncClientModeClasses() {
      document.documentElement.classList.toggle("native-mobile-app", isNativeMobileClient());
    }

    function setTvMode(tv) {
      document.documentElement.classList.toggle("tv-mode", !!tv);
      syncClientModeClasses();
      syncNativeToolbarForRoute();
      updateTvDiagnostic();
    }

    function isHomeFullscreenEnabled() {
      return !state.uiPrefs || state.uiPrefs.homeFullscreenEnabled !== false;
    }

    function setNativeToolbarVisible(visible, force) {
      if (!force && !isTvLikeDevice() && !isNativeMobileClient()) return;
      try {
        const ui = sdk().ui || {};
        if (isNativeLeanbackClient() && ui.setChrome) {
          ui.setChrome({ mode: visible ? (isHomeFullscreenEnabled() ? "edge" : "tv-normal") : "tv-full" });
          return;
        }
        if (isNativeMobileClient() && ui.setChrome) {
          ui.setChrome({
            mode: visible ? (isHomeFullscreenEnabled() ? "edge" : "normal") : "immersive",
            statusBarStyle: "light",
            navigationBarStyle: "light",
            restoreAffordance: visible ? "auto" : "none",
            startup: visible
          });
          return;
        }
        if (ui.setToolbar) ui.setToolbar(visible);
      } catch (e) {}
    }

    function syncNativeToolbarForRoute() {
      // TV 端：进过一次详情页后进入"持久全屏"，回到主页也保持工具栏隐藏，
      // 直到用户在主页再次按遥控返回键才退出（见按键处理里的 exitTvFullscreen）。
      if (tvFullscreenActive()) {
        setNativeToolbarVisible(false);
        return;
      }
      setNativeToolbarVisible(uiSnapshotRoute() === "home");
    }

    // TV 端是否处于持久全屏状态
    function tvFullscreenActive() {
      return isTvLikeDevice() && !!state.tvFullscreen;
    }

    // 退出 TV 持久全屏：恢复工具栏
    function exitTvFullscreen() {
      state.tvFullscreen = false;
      setNativeToolbarVisible(true);
    }

    async function detectDeviceMode() {
      const previewRequested = isTvPreviewRequested();
      try {
        if (window.fongmiBridge && !window.fm) await waitForNativeSdk(1500);
        const api = sdk();
        if (isNativeLeanbackClient()) {
          state.deviceMode = "leanback";
          state.previewMode = false;
          document.documentElement.classList.remove("tv-preview");
          setTvMode(true);
          return true;
        }
        if (isNativeMobileClient()) state.deviceMode = "mobile";
        if (!api.device) {
          setNativeToolbarVisible(true, true);
          state.previewMode = !isNativeMobileClient() && previewRequested;
          document.documentElement.classList.toggle("tv-preview", state.previewMode);
          setTvMode(state.previewMode);
          syncClientModeClasses();
          return state.previewMode;
        }
        const device = await api.device();
        const mode = String(device && device.mode || "").toLowerCase();
        const tv = Number(device && device.type) === 0 || mode === "leanback";
        const nativeClient = !!(window.fm || window.fongmiBridge || window.fongmiClient);
        state.deviceMode = tv ? "leanback" : nativeClient && (Number(device && device.type) === 1 || mode === "mobile") ? "mobile" : "browser";
        state.previewMode = state.deviceMode === "browser" && previewRequested;
        document.documentElement.classList.toggle("tv-preview", state.previewMode);
        setTvMode(state.deviceMode === "leanback" || state.previewMode);
        updateTvDiagnostic();
        return state.deviceMode === "leanback" || state.previewMode;
      } catch (e) {
        setNativeToolbarVisible(true, true);
        state.deviceMode = isNativeMobileClient() ? "mobile" : "browser";
        state.previewMode = state.deviceMode === "browser" && previewRequested;
        document.documentElement.classList.toggle("tv-preview", state.previewMode);
        setTvMode(state.deviceMode === "browser" && state.previewMode);
        syncClientModeClasses();
        updateTvDiagnostic();
        return state.previewMode;
      }
    }
