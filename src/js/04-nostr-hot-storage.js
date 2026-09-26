    function openHotDb() {
      if (!("indexedDB" in window)) return Promise.resolve(null);
      if (state.hot.db) return Promise.resolve(state.hot.db);
      if (state.hot.dbPromise) return state.hot.dbPromise;
      state.hot.dbPromise = new Promise((resolve) => {
        const req = indexedDB.open(HOT_DB_NAME, HOT_DB_VERSION);
        req.onupgradeneeded = () => {
          const db = req.result;
          db.createObjectStore("media", { keyPath: "m" });
          const store = db.createObjectStore("userVector", { keyPath: "u" });
          store.createIndex("u", "u", { unique: false });
          store.createIndex("e", "e", { unique: false });
          store.createIndex("x", "x", { unique: false });
          db.createObjectStore("relayCursor", { keyPath: "relay" });
        };
        req.onsuccess = () => {
          state.hot.db = req.result;
          state.hot.dbPromise = null;
          state.hot.idb = true;
          resolve(state.hot.db);
        };
        req.onerror = () => {
          state.hot.dbPromise = null;
          resolve(null);
        };
        req.onblocked = () => setStatus("nostr", "本地索引升级等待");
      });
      return state.hot.dbPromise;
    }

    function hotWindowStart() {
      return Math.floor((Date.now() - HOT_WINDOW_MS) / 1000);
    }

    function hotBackupWindowStart() {
      return Math.max(hotWindowStart(), hotNow() - HOT_BACKUP_WINDOW_SECONDS);
    }

    function hotNow() {
      return Math.floor(Date.now() / 1000);
    }

    function hotToday() {
      return Math.floor(hotNow() / HOT_DAY_SECONDS);
    }

    function hotExpiresAt(createdAt) {
      return Number(createdAt || hotNow()) + HOT_WINDOW_SECONDS;
    }

    function hotExpiresDay(expiresAt) {
      return Math.ceil(Number(expiresAt || hotNow()) / HOT_DAY_SECONDS);
    }

    function hotUserKey(pubkey) {
      return String(pubkey || "").slice(0, 32);
    }

    function normalizeDeleteState(raw) {
      const now = Date.now();
      const users = {};
      Object.entries(raw && raw.users || {}).forEach(([pubkey, marker]) => {
        const key = String(pubkey || "").trim();
        if (!key || !marker || typeof marker !== "object") return;
        const expiresAt = Number(marker.expiresAt || 0);
        if (expiresAt && expiresAt <= now) return;
        users[key] = {
          cutoff: Math.max(0, Number(marker.cutoff || 0)),
          blockPublishUntil: Math.max(0, Number(marker.blockPublishUntil || 0)),
          expiresAt: expiresAt || now + DELETE_TOMBSTONE_TTL_MS,
          updatedAt: Math.max(0, Number(marker.updatedAt || 0))
        };
      });
      return { loaded: true, users };
    }

    async function ensureDeleteStateLoaded() {
      if (state.deleteState.loaded) return state.deleteState;
      let saved = null;
      try { saved = safeJson(await sdk().cache.get(cacheKey("deleteState")), null); } catch (e) { saved = null; }
      state.deleteState = normalizeDeleteState(saved);
      return state.deleteState;
    }

    async function persistDeleteState() {
      await sdk().cache.set(cacheKey("deleteState"), JSON.stringify({ users: state.deleteState.users || {} }));
    }

    async function markIdentityDeletedLocally(identity) {
      if (!identity || !identity.pubkey) return null;
      await ensureDeleteStateLoaded();
      const now = Date.now();
      const marker = {
        cutoff: hotNow() + 1,
        blockPublishUntil: now + DELETE_REPUBLISH_BLOCK_MS,
        expiresAt: now + DELETE_TOMBSTONE_TTL_MS,
        updatedAt: now
      };
      state.deleteState.users[identity.pubkey] = marker;
      await persistDeleteState().catch(() => {});
      return marker;
    }

    function localDeleteMarker(pubkey) {
      const marker = state.deleteState.users && state.deleteState.users[String(pubkey || "")];
      if (!marker) return null;
      if (Number(marker.expiresAt || 0) && Number(marker.expiresAt || 0) <= Date.now()) {
        delete state.deleteState.users[String(pubkey || "")];
        persistDeleteState().catch(() => {});
        return null;
      }
      return marker;
    }

    function isLocallyDeletedPreferenceEvent(event) {
      const pubkey = eventUserKey(event);
      const marker = localDeleteMarker(pubkey);
      if (!marker) return false;
      return Number(event && event.created_at || 0) <= Number(marker.cutoff || 0);
    }

    async function isPreferencePublishBlocked() {
      await ensureDeleteStateLoaded();
      const pubkey = state.identity && state.identity.pubkey;
      const marker = localDeleteMarker(pubkey);
      return !!(marker && Number(marker.blockPublishUntil || 0) > Date.now());
    }

    function eventExpiration(event) {
      const tag = (event && event.tags || []).find((item) => item && item[0] === "expiration");
      const value = tag ? Number(tag[1]) : 0;
      return Number.isFinite(value) ? value : 0;
    }

    function eventExpired(event) {
      const expiration = eventExpiration(event);
      return expiration > 0 && expiration <= hotNow();
    }

    function idbRequest(req) {
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }

    function idbDone(tx) {
      return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    async function hotStoreGet(storeName, key) {
      const db = await openHotDb();
      if (!db) return null;
      return idbRequest(db.transaction(storeName, "readonly").objectStore(storeName).get(key)).catch(() => null);
    }

    function markHomeHotVersion() {
      state.hot.version = Number(state.hot.version || 0) + 1;
      if (typeof invalidateHomeCategoryFeeds === "function") invalidateHomeCategoryFeeds();
    }

    async function hotLoadIndex() {
      const db = await openHotDb();
      if (!db) {
        state.hot.ready = true;
        markHomeHotVersion();
        scheduleRender();
        return;
      }
      try {
        const tx = db.transaction("media", "readonly");
        const media = await idbRequest(tx.objectStore("media").getAll());
        state.hot.media = new Map((media || []).filter((item) => item && item.m).map((item) => [item.m, item]));
        state.hot.items = buildHotItemsFromIndex();
        hotPruneExpired().catch(() => {});
        state.hot.ready = true;
      } catch (e) {
        state.hot.ready = true;
      }
      markHomeHotVersion();
      useNostrRecommendationsIfReady();
      refreshActiveNostrSecondaryQuery(true);
      scheduleRender();
    }

    async function hotIngestEvent(event) {
      const changed = await hotIngestEvents([event]);
      if (changed) hotRefreshItems();
      return changed;
    }

    function isHotIngestGenerationActive(generation) {
      return generation == null || generation === state.relay.subscribeToken;
    }

    function hotIngestEvents(events, options) {
      const batch = Array.isArray(events) ? events.slice() : [];
      const generation = options && options.generation != null ? options.generation : null;
      const run = () => {
        if (!isHotIngestGenerationActive(generation)) return false;
        return hotIngestEventsNow(batch, generation).catch(() => false);
      };
      state.hot.ingestQueue = state.hot.ingestQueue.then(run, run);
      return state.hot.ingestQueue;
    }

    async function hotIngestEventsNow(events, generation) {
      if (!isHotIngestGenerationActive(generation)) return false;
      await ensureDeleteStateLoaded();
      if (!isHotIngestGenerationActive(generation)) return false;
      const incoming = new Map();
      for (const event of events || []) {
        const vector = heatVectorFromEvent(event);
        if (!vector) continue;
        const old = incoming.get(vector.u);
        if (!old || hotIsNewerVector(vector, old)) incoming.set(vector.u, vector);
      }
      if (!incoming.size) return false;
      const vectors = Array.from(incoming.values());
      const db = await openHotDb();
      if (!isHotIngestGenerationActive(generation)) return false;
      const existing = await hotGetVectors(vectors.map((vector) => vector.u), db);
      if (!isHotIngestGenerationActive(generation)) return false;
      const changedMedia = new Set();
      const vectorWrites = [];
      let changed = false;
      if (!isHotIngestGenerationActive(generation)) return false;
      for (const vector of vectors) {
        const old = existing.get(vector.u) || (!db ? state.hot.users.get(vector.u) : null);
        if (old && !hotIsNewerVector(vector, old)) continue;
        if (!old && !vector.i.length) continue;
        const mediaKeys = hotApplyVectorDiffToState(old, vector);
        mediaKeys.forEach((key) => changedMedia.add(key));
        vectorWrites.push(vector);
        hotCacheVector(hotPersistVector(vector), db);
        changed = true;
      }
      if (!changed) return false;
      if (db) {
        const tx = db.transaction(["media", "userVector"], "readwrite");
        const mediaStore = tx.objectStore("media");
        const vectorStore = tx.objectStore("userVector");
        changedMedia.forEach((mediaKey) => {
          const media = state.hot.media.get(mediaKey);
          if (media && Number(media.c || 0) > 0) mediaStore.put(media);
          else mediaStore.delete(mediaKey);
        });
        vectorWrites.forEach((vector) => vectorStore.put(hotPersistVector(vector)));
        await idbDone(tx).catch(() => {});
        if (!isHotIngestGenerationActive(generation)) return false;
      }
      return true;
    }

    function heatVectorFromEvent(event) {
      if (eventExpired(event) || getD(event) !== HOT_VECTOR_D) return null;
      if (isLocallyDeletedPreferenceEvent(event)) return null;
      const content = eventContent(event);
      if (!content || content.v !== HOT_VECTOR_VERSION) return null;
      const pubkey = eventUserKey(event);
      if (!pubkey || pubkey === "local") return null;
      const userKey = hotUserKey(pubkey);
      if (!userKey) return null;
      const createdAt = Number(event.created_at || 0);
      if (!Number.isFinite(createdAt) || createdAt <= 0) return null;
      const expiresAt = eventExpiration(event) || hotExpiresAt(createdAt);
      const expiresDay = hotExpiresDay(expiresAt);
      if (expiresDay <= hotToday()) return null;
      const wireItems = normalizeWireVectorItems(content.i || [], createdAt);
      const items = wireItems.map(hotStoredVectorItem).filter(Boolean);
      return {
        u: userKey,
        ts: createdAt,
        id: event.id || "",
        e: expiresDay,
        x: hotVectorNextPruneDay(items, expiresDay),
        i: items,
        meta: wireItems
      };
    }

    function normalizeWireVectorItems(items, createdAt) {
      const map = new Map();
      const fallbackDay = Math.floor(Number(createdAt || hotNow()) / HOT_DAY_SECONDS);
      (Array.isArray(items) ? items : []).forEach((raw) => {
        const item = hotNormalizeWireItem(raw, fallbackDay, false);
        if (!item) return;
        const key = hotVectorItemMediaKey(item);
        const old = map.get(key);
        if (!old || hotVectorItemDay(item) >= hotVectorItemDay(old)) map.set(key, item);
      });
      return Array.from(map.values())
        .sort((a, b) => hotVectorItemDay(b) - hotVectorItemDay(a) || hotVectorItemMediaKey(a).localeCompare(hotVectorItemMediaKey(b)))
        .slice(0, HOT_USER_VECTOR_LIMIT);
    }

    function normalizeStoredVectorItems(items, createdAt) {
      const map = new Map();
      const fallbackDay = Math.floor(Number(createdAt || hotNow()) / HOT_DAY_SECONDS);
      (Array.isArray(items) ? items : []).forEach((raw) => {
        const item = hotNormalizeStoredItem(raw, fallbackDay, false);
        if (!item) return;
        const key = hotVectorItemMediaKey(item);
        const old = map.get(key);
        if (!old || hotVectorItemDay(item) >= hotVectorItemDay(old)) map.set(key, item);
      });
      return Array.from(map.values())
        .sort((a, b) => hotVectorItemDay(b) - hotVectorItemDay(a) || hotVectorItemMediaKey(a).localeCompare(hotVectorItemMediaKey(b)))
        .slice(0, HOT_USER_VECTOR_LIMIT);
    }

    function hotNormalizeWireItem(raw, fallbackDay, keepExpired) {
      const item = hotNormalizeVectorParts(raw, fallbackDay, keepExpired);
      if (!item) return null;
      const title = String(item.title || "").trim().slice(0, HOT_TITLE_LIMIT);
      const poster = hotCompactPoster(item.poster || "").slice(0, HOT_POSTER_LIMIT);
      if (!title || !poster) return null;
      return [item.typeCode, item.tmdbId, item.day, title, poster];
    }

    function hotNormalizeStoredItem(raw, fallbackDay, keepExpired) {
      const item = hotNormalizeVectorParts(raw, fallbackDay, keepExpired);
      return item ? [item.typeCode, item.tmdbId, item.day] : null;
    }

    function hotNormalizeVectorParts(raw, fallbackDay, keepExpired) {
      let mediaType = "";
      let tmdbId = "";
      let day = fallbackDay;
      let title = "";
      let poster = "";
      if (Array.isArray(raw)) {
        mediaType = String(raw[0] || "");
        tmdbId = raw[1];
        day = Number(raw[2] || fallbackDay);
        title = String(raw[3] || "");
        poster = String(raw[4] || "");
      } else if (raw && typeof raw === "object") {
        mediaType = String(raw.mt || raw.mediaType || raw.c || "");
        tmdbId = raw.tid || raw.tmdbId || raw.id || "";
        day = Number(raw.d || raw.day || fallbackDay);
        title = String(raw.t || raw.title || "");
        poster = String(raw.p || raw.pic || raw.poster || "");
      }
      const typeCode = hotMediaTypeCode(mediaType);
      if (!typeCode || tmdbId === "" || tmdbId === null || tmdbId === undefined || !Number.isFinite(day)) return null;
      const idNumber = Number(tmdbId);
      tmdbId = Number.isInteger(idNumber) && idNumber > 0 ? idNumber : String(tmdbId);
      day = Math.floor(day);
      if (!keepExpired && day < hotMinItemDay()) return null;
      if (day > hotToday()) day = hotToday();
      return { typeCode, tmdbId, day, title, poster };
    }

    function hotStoredVectorItem(item) {
      return hotNormalizeStoredItem(item, hotToday(), true);
    }

    function hotPersistVector(vector) {
      return {
        u: vector.u,
        ts: vector.ts,
        id: vector.id || "",
        e: vector.e,
        x: vector.x,
        i: normalizeStoredVectorItems(vector.i || [], vector.ts || hotNow())
      };
    }

    function hotMediaTypeCode(mediaType) {
      const value = String(mediaType || "");
      if (value === "t" || value === "tv") return "t";
      if (value === "m" || value === "movie") return "m";
      return "";
    }

    function hotMediaTypeFromCode(code) {
      const value = String(code || "");
      if (value === "t") return "tv";
      if (value === "m") return "movie";
      return value === "tv" || value === "movie" ? value : "";
    }

    function hotCompactPoster(url) {
      const value = String(url || "").trim();
      if (!value) return "";
      if (value.startsWith("/")) return value;
      const bases = [window.WEBHOME_CONFIG.tmdb.imageBase, window.WEBHOME_CONFIG.tmdb.backdropBase].filter(Boolean);
      for (const base of bases) {
        if (value.startsWith(base)) return value.slice(base.length) || "";
      }
      try {
        const parsed = new URL(value);
        if (parsed.hostname === "image.tmdb.org" || parsed.hostname === "images.tmdb.org") return parsed.pathname.replace(/^\/t\/p\/[^/]+/, "") || parsed.pathname;
      } catch (e) {}
      return value;
    }

    function hotPosterUrl(path) {
      const value = String(path || "").trim();
      if (!value) return "";
      if (/^https?:\/\//i.test(value)) return value;
      return value.startsWith("/") ? imageUrl(value, false) : value;
    }

    function hotMinItemDay() {
      return hotToday() - HOT_WINDOW_DAYS + 1;
    }

    function hotVectorNextPruneDay(items, expiresDay) {
      let day = Number(expiresDay || hotToday() + HOT_WINDOW_DAYS);
      (items || []).forEach((item) => {
        day = Math.min(day, hotVectorItemDay(item) + HOT_WINDOW_DAYS);
      });
      return Math.max(1, Math.floor(day || hotToday() + HOT_WINDOW_DAYS));
    }

    function hotVectorItemMediaKey(item) {
      const mediaType = hotMediaTypeFromCode(item && item[0] || "");
      const tmdbId = item && item[1] !== undefined && item[1] !== null ? String(item[1]) : "";
      return mediaType && tmdbId ? `tmdb:${mediaType}:${tmdbId}` : "";
    }

    function hotVectorItemDay(item) {
      return Math.floor(Number(item && item[2] || 0));
    }

    function hotVectorItemLatest(item) {
      return hotVectorItemDay(item) * HOT_DAY_SECONDS;
    }

    function hotVectorItemMedia(item) {
      const mediaType = hotMediaTypeFromCode(item && item[0] || "");
      const tmdbId = item && item[1] !== undefined && item[1] !== null ? String(item[1]) : "";
      return {
        m: hotVectorItemMediaKey(item),
        t: item && item[3] || "",
        mt: mediaType,
        tid: tmdbId,
        p: hotCompactPoster(item && item[4] || "")
      };
    }

    function hotVectorItemMap(items) {
      const map = new Map();
      (Array.isArray(items) ? items : []).forEach((item) => {
        const key = hotVectorItemMediaKey(item);
        if (!key) return;
        const old = map.get(key);
        if (!old || hotVectorItemDay(item) >= hotVectorItemDay(old)) map.set(key, item);
      });
      return map;
    }

    function hotActiveVectorItems(vector) {
      return normalizeStoredVectorItems(vector && vector.i || [], vector && vector.ts || hotNow());
    }

    function hotVectorHasMedia(vector, mediaKey) {
      if (!vector || !mediaKey) return false;
      return hotVectorItemMap(hotActiveVectorItems(vector)).has(mediaKey);
    }

    function hotIsNewerVector(next, old) {
      if (!old) return true;
      const nextTs = Number(next && next.ts || 0);
      const oldTs = Number(old && old.ts || 0);
      if (nextTs !== oldTs) return nextTs > oldTs;
      return String(next && next.id || "") > String(old && old.id || "");
    }

    function hotIsLocalUserKey(userKey) {
      return !!(state.identity && userKey && hotUserKey(state.identity.pubkey) === userKey);
    }

    function hotCacheVector(vector, db) {
      if (!vector || !vector.u) return;
      if (!db || hotIsLocalUserKey(vector.u)) state.hot.users.set(vector.u, vector);
      else state.hot.users.delete(vector.u);
    }

    function hotApplyVectorDiffToState(oldVector, newVector) {
      const oldMap = hotVectorItemMap(oldVector && oldVector.i || []);
      const newMap = hotVectorItemMap(newVector && newVector.i || []);
      const metaMap = hotVectorItemMap(newVector && newVector.meta || []);
      const changedMedia = new Set();
      oldMap.forEach((item, mediaKey) => {
        if (newMap.has(mediaKey)) return;
        const media = state.hot.media.get(mediaKey);
        if (!media) return;
        media.c = Math.max(0, Number(media.c || 0) - 1);
        if (media.c > 0) state.hot.media.set(mediaKey, media);
        else state.hot.media.delete(mediaKey);
        changedMedia.add(mediaKey);
      });
      newMap.forEach((item, mediaKey) => {
        const oldMedia = state.hot.media.get(mediaKey);
        const delta = oldMap.has(mediaKey) && oldMedia ? 0 : 1;
        const meta = metaMap.get(mediaKey) || item;
        const media = mergeHotMedia(oldMedia, hotVectorItemMedia(meta), hotVectorItemLatest(item), delta);
        if (media.c > 0 && media.t && media.p) state.hot.media.set(mediaKey, media);
        changedMedia.add(mediaKey);
      });
      return changedMedia;
    }

    function hotGetVectors(userKeys, db) {
      const uniqueKeys = Array.from(new Set((userKeys || []).filter(Boolean)));
      const map = new Map();
      if (!uniqueKeys.length) return Promise.resolve(map);
      if (!db) {
        uniqueKeys.forEach((key) => {
          const vector = state.hot.users.get(key);
          if (vector) map.set(key, vector);
        });
        return Promise.resolve(map);
      }
      return new Promise((resolve) => {
        try {
          const tx = db.transaction("userVector", "readonly");
          const store = tx.objectStore("userVector");
          uniqueKeys.forEach((key) => {
            const req = store.get(key);
            req.onsuccess = () => {
              if (req.result) map.set(key, req.result);
            };
          });
          tx.oncomplete = () => resolve(map);
          tx.onerror = () => resolve(map);
          tx.onabort = () => resolve(map);
        } catch (e) {
          resolve(map);
        }
      });
    }

    async function hotGetUserVector(userKey, db) {
      if (!userKey) return null;
      const map = await hotGetVectors([userKey], db || await openHotDb());
      return map.get(userKey) || state.hot.users.get(userKey) || null;
    }

    async function hotGetMyVector() {
      const identity = state.identity && state.identity.pubkey;
      if (!identity) return null;
      const userKey = hotUserKey(identity);
      const vector = await hotGetUserVector(userKey);
      if (vector) state.hot.users.set(userKey, vector);
      return vector;
    }

    async function hotLoadMyVector() {
      const vector = await hotGetMyVector();
      renderMetrics();
      return vector;
    }

    async function hotPruneExpired() {
      const db = await openHotDb();
      if (!db) return;
      let changed = false;
      for (;;) {
        const vectors = await hotGetPrunableVectors(db, hotToday(), HOT_PRUNE_BATCH);
        if (!vectors.length) break;
        const changedMedia = new Set();
        const vectorWrites = [];
        const vectorDeletes = [];
        for (const old of vectors) {
          const expiresDay = Number(old && old.e || 0);
          const nextItems = expiresDay > hotToday() ? normalizeStoredVectorItems(old.i || [], old.ts || hotNow()) : [];
          const next = expiresDay > hotToday()
            ? Object.assign({}, old, { i: nextItems, x: hotVectorNextPruneDay(nextItems, expiresDay) })
            : null;
          if (next && hotSameVectorItems(old.i || [], next.i || []) && Number(old.x || 0) === Number(next.x || 0)) continue;
          hotApplyVectorDiffToState(old, next).forEach((key) => changedMedia.add(key));
          if (next) {
            vectorWrites.push(next);
            hotCacheVector(hotPersistVector(next), db);
          } else {
            vectorDeletes.push(old.u);
            state.hot.users.delete(old.u);
          }
          changed = true;
        }
        if (changedMedia.size || vectorWrites.length || vectorDeletes.length) {
          const tx = db.transaction(["media", "userVector"], "readwrite");
          const mediaStore = tx.objectStore("media");
          const vectorStore = tx.objectStore("userVector");
          changedMedia.forEach((mediaKey) => {
            const media = state.hot.media.get(mediaKey);
            if (media && Number(media.c || 0) > 0) mediaStore.put(media);
            else mediaStore.delete(mediaKey);
          });
          vectorWrites.forEach((vector) => vectorStore.put(hotPersistVector(vector)));
          vectorDeletes.forEach((userKey) => vectorStore.delete(userKey));
          await idbDone(tx).catch(() => {});
        }
        if (vectors.length < HOT_PRUNE_BATCH) break;
      }
      if (changed) scheduleHotRefresh();
    }

    function hotSameVectorItems(a, b) {
      return JSON.stringify(a || []) === JSON.stringify(b || []);
    }

    function hotGetPrunableVectors(db, expiresDay, limit) {
      return new Promise((resolve) => {
        const vectors = [];
        try {
          const tx = db.transaction("userVector", "readonly");
          const index = tx.objectStore("userVector").index("x");
          const req = index.openCursor(IDBKeyRange.upperBound(expiresDay));
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            vectors.push(cursor.value);
            if (limit && vectors.length >= limit) return;
            cursor.continue();
          };
          tx.oncomplete = () => resolve(vectors);
          tx.onerror = () => resolve(vectors);
          tx.onabort = () => resolve(vectors);
        } catch (e) {
          resolve(vectors);
        }
      });
    }

    function hotRefreshItems() {
      clearTimeout(state.hot.refreshTimer);
      state.hot.refreshTimer = 0;
      state.hot.items = buildHotItemsFromIndex();
      markHomeHotVersion();
      useNostrRecommendationsIfReady();
      refreshActiveNostrSecondaryQuery(true);
      if (isNostrRefreshActive()) {
        updateNostrRefreshProgress({ indexed: state.hot.items.length });
        maybeFinishNostrRefresh();
      }
      if (homeUiRoute() === "home") scheduleRender();
    }

    function scheduleHotRefresh(delay) {
      clearTimeout(state.hot.refreshTimer);
      const busy = Object.keys(state.relay.backfillBusy || {}).length > 0;
      const wait = Number.isFinite(delay) ? delay : busy ? HOT_REFRESH_BACKFILL_MS : HOT_REFRESH_IDLE_MS;
      state.hot.refreshTimer = setTimeout(() => {
        state.hot.refreshTimer = 0;
        hotRefreshItems();
        scheduleRender();
      }, wait);
    }

    function mergeHotMedia(oldMedia, media, latestAt, countDelta) {
      const value = {
        m: media && media.m || oldMedia && oldMedia.m || "",
        t: media && media.t || oldMedia && oldMedia.t || "",
        mt: media && media.mt || oldMedia && oldMedia.mt || "",
        tid: media && media.tid || oldMedia && oldMedia.tid || "",
        p: media && hotCompactPoster(media.p) || oldMedia && oldMedia.p || "",
        c: Math.max(0, Number(oldMedia && oldMedia.c || 0) + Number(countDelta || 0)),
        l: Math.max(Number(oldMedia && oldMedia.l || 0), Number(latestAt || 0))
      };
      return value;
    }

    function buildHotItemsFromIndex() {
      return Array.from(state.hot.media.values())
        .map((item) => {
          const pic = hotPosterUrl(item.p || "");
          const people = Number(item.c || 0);
          return {
            id: item.m,
            mediaKey: item.m,
            title: item.t || "",
            mediaType: item.mt || "",
            tmdbId: item.tid || "",
            source: "tmdb",
            pic,
            image: pic,
            people,
            count: people,
            latest: item.l || 0,
            lastEventAt: item.l || 0,
            remark: ""
          };
        })
        .filter((item) => item && item.people > 0 && hasPoster(item))
        .sort((a, b) => b.people - a.people || b.lastEventAt - a.lastEventAt)
        .slice(0, HOT_RENDER_LIMIT);
    }

    async function hotClearIndex(onlyMine) {
      const db = await openHotDb();
      if (!db) {
        state.hot.media.clear();
        state.hot.users.clear();
        state.hot.items = [];
        markHomeHotVersion();
        return;
      }
      if (!onlyMine) {
        const tx = db.transaction(["media", "userVector", "relayCursor"], "readwrite");
        tx.objectStore("media").clear();
        tx.objectStore("userVector").clear();
        tx.objectStore("relayCursor").clear();
        await idbDone(tx).catch(() => {});
        state.hot.media.clear();
        state.hot.users.clear();
        state.hot.items = [];
        markHomeHotVersion();
        return;
      }
      const identity = state.identity && state.identity.pubkey;
      if (!identity) return;
      const mine = await hotGetUserVector(hotUserKey(identity), db);
      if (mine) await hotRemoveVectors([mine]);
    }

    async function hotClearRankingIndexForRefresh() {
      const db = await openHotDb();
      const localKey = state.identity ? hotUserKey(state.identity.pubkey) : "";
      const localVector = localKey ? await hotGetUserVector(localKey, db) : null;
      const localMedia = [];
      hotActiveVectorItems(localVector).forEach((item) => {
        const mediaKey = hotVectorItemMediaKey(item);
        const media = mediaKey ? state.hot.media.get(mediaKey) : null;
        if (media && media.m) localMedia.push(Object.assign({}, media, { c: 1 }));
      });
      await hotClearIndex(false);
      if (localVector && localVector.u) state.hot.users.set(localVector.u, localVector);
      localMedia.forEach((media) => state.hot.media.set(media.m, media));
      if (db && (localVector && localVector.u || localMedia.length)) {
        const tx = db.transaction(["media", "userVector"], "readwrite");
        const mediaStore = tx.objectStore("media");
        const vectorStore = tx.objectStore("userVector");
        if (localVector && localVector.u) vectorStore.put(localVector);
        localMedia.forEach((media) => mediaStore.put(media));
        await idbDone(tx).catch(() => {});
      }
      state.hot.items = buildHotItemsFromIndex();
      markHomeHotVersion();
    }

    async function hotRemoveVectors(vectors, options) {
      const rows = (vectors || []).filter((vector) => vector && vector.u);
      if (!rows.length) return;
      const db = await openHotDb();
      const changedMedia = new Set();
      rows.forEach((vector) => {
        hotApplyVectorDiffToState(vector, null).forEach((key) => changedMedia.add(key));
        state.hot.users.delete(vector.u);
      });
      if (db) {
        const tx = db.transaction(["media", "userVector"], "readwrite");
        const mediaStore = tx.objectStore("media");
        const vectorStore = tx.objectStore("userVector");
        changedMedia.forEach((mediaKey) => {
          const media = state.hot.media.get(mediaKey);
          if (media && Number(media.c || 0) > 0) mediaStore.put(media);
          else mediaStore.delete(mediaKey);
        });
        rows.forEach((vector) => vectorStore.delete(vector.u));
        await idbDone(tx).catch(() => {});
      }
      if (!options || options.refresh !== false) scheduleHotRefresh();
    }

    function setStatus(key, value) {
      state.status[key] = value;
      renderConnection();
    }

    function setPanStatus(value) {
      state.status.pan = value;
      renderConnection();
    }

    function setPanProgress(active, phase, round, totalRounds) {
      state.pan.progress = {
        active: !!active,
        phase: String(phase || ""),
        round: Math.max(0, Number(round || 0)),
        totalRounds: Math.max(0, Number(totalRounds || 0))
      };
      const progress = $("panSearchProgress");
      if (progress) {
        progress.classList.toggle("active", state.pan.progress.active);
        progress.setAttribute("aria-hidden", "true");
      }
      if (state.selected && $("detailSheet") && $("detailSheet").classList.contains("active")) {
        updateDetailContinueButton();
      }
      return state.pan.progress;
    }

    function setRefreshStatus(value) {
      state.status.refresh = value || "未执行";
      renderConnection();
    }

    function updateNostrRefreshProgress(patch) {
      const current = state.relay.refresh || {};
      state.relay.refresh = Object.assign({
        active: false,
        phase: "未执行",
        connected: 0,
        subscribeDone: 0,
        subEvents: 0,
        recentPages: 0,
        recentEvents: 0,
        historyPages: 0,
        historyEvents: 0,
        indexed: 0,
        relay: "",
        startedAt: 0,
        finishedAt: 0
      }, current, patch || {});
      const info = state.relay.refresh;
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      const phase = info.phase || "刷新中";
      const connected = Number(info.connected || state.relay.connected || 0);
      const subscribeDone = Number(info.subscribeDone || state.relay.subscribeDone || 0);
      const subEvents = Number(info.subEvents || 0);
      const recentPages = Number(info.recentPages || 0);
      const recentEvents = Number(info.recentEvents || 0);
      const historyPages = Number(info.historyPages || 0);
      const historyEvents = Number(info.historyEvents || 0);
      const backfillBusy = Object.keys(state.relay.backfillBusy || {}).length;
      const backfillTimers = Object.values(state.relay.backfillTimers || {}).filter(Boolean).length;
      const parts = [];
      if (phase === "完成") parts.push("已完成");
      else if (info.active) parts.push(`进行中：${phase}`);
      else parts.push(phase);
      if (phase !== "未执行") {
        parts.push(`连接 ${connected}/${relays.length}，订阅完成 ${subscribeDone}/${relays.length}`);
        parts.push(`订阅事件 ${subEvents} 条`);
        parts.push(`近7天回填 ${recentPages} 页 / ${recentEvents} 条`);
        parts.push(`历史回填 ${historyPages} 页 / ${historyEvents} 条`);
        if (info.active && (backfillBusy || backfillTimers)) parts.push(`回填队列 ${backfillBusy} 个执行中 / ${backfillTimers} 个等待`);
        if (info.active && state.hot.refreshTimer) parts.push("榜单列表待更新");
        if (info.relay) parts.push(`当前 relay：${info.relay}`);
      }
      parts.push(`当前榜单 ${state.hot.items.length} 条`);
      setRefreshStatus(parts.join("\n"));
    }

