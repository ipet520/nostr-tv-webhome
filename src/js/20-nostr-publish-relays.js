    function hotVectorItemFromSnapshot(snapshot, day) {
      if (!snapshot || (snapshot.mediaType !== "movie" && snapshot.mediaType !== "tv") || !snapshot.tmdbId) return null;
      return hotNormalizeWireItem([
        hotMediaTypeCode(snapshot.mediaType),
        Number(snapshot.tmdbId) || String(snapshot.tmdbId),
        day,
        snapshot.title || "",
        snapshot.pic || snapshot.image || ""
      ], day, false);
    }

    function hotWireItemsForPublish(oldVector, currentItem, createdAt) {
      const map = new Map();
      (oldVector && oldVector.i || []).forEach((item) => {
        const wire = hotWireItemFromStored(item);
        if (wire) map.set(hotVectorItemMediaKey(wire), wire);
      });
      map.set(hotVectorItemMediaKey(currentItem), currentItem);
      return normalizeWireVectorItems(Array.from(map.values()), createdAt);
    }

    function hotWireItemFromStored(item) {
      const mediaKey = hotVectorItemMediaKey(item);
      const media = mediaKey ? state.hot.media.get(mediaKey) : null;
      if (!media || !media.t || !media.p) return null;
      return hotNormalizeWireItem([
        hotMediaTypeCode(media.mt),
        Number(media.tid) || media.tid,
        hotVectorItemDay(item),
        media.t,
        media.p
      ], hotToday(), false);
    }

    async function ensureIdentity() {
      if (state.identity) return state.identity;
      await waitForNostrTools();
      if (!window.NostrTools) return null;
      let nsec = await sdk().cache.get(cacheKey("nsec"));
      if (!nsec) {
        nsec = window.NostrTools.nip19.nsecEncode(window.NostrTools.generateSecretKey());
        await sdk().cache.set(cacheKey("nsec"), nsec);
      }
      return setIdentity(nsec);
    }

    async function setIdentity(nsec) {
      await waitForNostrTools();
      if (!window.NostrTools) throw new Error("nostr-tools 加载失败");
      const decoded = window.NostrTools.nip19.decode(nsec.trim());
      if (decoded.type !== "nsec") throw new Error("请输入 nsec 私钥");
      const secret = decoded.data;
      const pubkey = window.NostrTools.getPublicKey(secret);
      const npub = window.NostrTools.nip19.npubEncode(pubkey);
      state.identity = { nsec: nsec.trim(), secret, pubkey, npub };
      await sdk().cache.set(cacheKey("nsec"), state.identity.nsec);
      await hotLoadMyVector().catch(() => null);
      setStatus("identity", shortKey(npub));
      renderMetrics();
      return state.identity;
    }

    function waitForNostrTools() {
      if (window.NostrTools) return Promise.resolve();
      return new Promise((resolve) => {
        let tries = 0;
        const timer = setInterval(() => {
          if (window.NostrTools || tries++ > 40) {
            clearInterval(timer);
            if (!window.NostrTools) setStatus("identity", "nostr-tools 加载失败");
            resolve();
          }
        }, 100);
      });
    }

    function subscribeNostr(generation) {
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      const subscribeToken = generation == null ? resetRelaySubscribeState() : generation;
      if (subscribeToken !== state.relay.subscribeToken) return;
      state.relay.subscribeStarted = true;
      setStatus("nostr", "连接中");
      relays.forEach((relay, index) => {
        try {
          setRelayStatus(relay, "连接中");
          const ws = new WebSocket(relay);
          const subId = "fongmi_pref_" + index + "_" + Date.now();
          let backfillStarted = false;
          let eventQueue = [];
          let flushTimer = 0;
          let timer = 0;
          let closed = false;
          let registered = false;
          let abort = null;
          const active = () => subscribeToken === state.relay.subscribeToken;
          const unregister = () => {
            if (!registered) return;
            const aborters = state.relay.subscriptionAborters;
            if (aborters && abort) aborters.delete(abort);
            registered = false;
          };
          const cleanup = (sendClose) => {
            if (flushTimer) {
              clearTimeout(flushTimer);
              flushTimer = 0;
            }
            if (timer) {
              clearTimeout(timer);
              timer = 0;
            }
            eventQueue = [];
            if (!closed) {
              closed = true;
              if (sendClose) {
                try { ws.send(JSON.stringify(["CLOSE", subId])); } catch (e) {}
              }
              try { ws.close(); } catch (e) {}
            }
            unregister();
          };
          const flushQueue = () => {
            if (flushTimer) {
              clearTimeout(flushTimer);
              flushTimer = 0;
            }
            if (!active()) {
              eventQueue = [];
              return;
            }
            const batch = eventQueue;
            eventQueue = [];
            if (!batch.length) {
              maybeFinishNostrRefresh(subscribeToken);
              return;
            }
            hotIngestEvents(batch, { generation: subscribeToken }).then((changed) => {
              if (changed && active()) {
                scheduleHotRefresh(HOT_REFRESH_IDLE_MS);
                if (isNostrRefreshActive(subscribeToken)) updateNostrRefreshProgress({ phase: "写入索引", indexed: state.hot.items.length });
              }
              maybeFinishNostrRefresh(subscribeToken);
            });
          };
          const startBackfill = () => {
            if (!active() || backfillStarted) return;
            backfillStarted = true;
            syncRelayBackfill(relay, subscribeToken).catch(() => {});
          };
          abort = () => cleanup(false);
          if (!state.relay.subscriptionAborters) state.relay.subscriptionAborters = new Set();
          state.relay.subscriptionAborters.add(abort);
          registered = true;
          if (!active()) {
            abort();
            return;
          }
          timer = setTimeout(() => {
            if (!active()) {
              cleanup(false);
              return;
            }
            flushQueue();
            if (state.relay.statuses[relay] === "已连接") startBackfill();
            finishRelaySubscribe(relay, state.relay.statuses[relay] === "已连接" ? "" : "失败");
            maybeFinishNostrRefresh(subscribeToken);
            cleanup(false);
          }, 8000);
          ws.onopen = () => {
            if (!active()) {
              cleanup(false);
              return;
            }
            state.relay.connected += 1;
            if (isNostrRefreshActive(subscribeToken)) updateNostrRefreshProgress({ phase: "订阅近7天", connected: state.relay.connected, relay: shortRelay(relay) });
            setRelayStatus(relay, "已连接");
            setStatus("nostr", "已连接");
            renderMetrics();
            try {
              ws.send(JSON.stringify(["REQ", subId, {
                kinds: [window.WEBHOME_CONFIG.nostr.kind],
                "#t": [window.WEBHOME_CONFIG.nostr.tag],
                "#d": [HOT_VECTOR_D],
                since: hotBackupWindowStart(),
                limit: HOT_SUBSCRIBE_LIMIT
              }]));
            } catch (e) {
              cleanup(false);
              if (!active()) return;
              finishRelaySubscribe(relay, "失败");
              maybeFinishNostrRefresh(subscribeToken);
            }
          };
          ws.onmessage = async (message) => {
            if (closed) return;
            if (!active()) {
              cleanup(false);
              return;
            }
            const data = safeJson(message.data, []);
            if (data[0] === "EOSE") {
              flushQueue();
              finishRelaySubscribe(relay, "");
              if (isNostrRefreshActive(subscribeToken)) updateNostrRefreshProgress({ subscribeDone: state.relay.subscribeDone, indexed: state.hot.items.length });
              startBackfill();
              maybeFinishNostrRefresh(subscribeToken);
              cleanup(true);
              return;
            }
            if (data[0] === "CLOSED") {
              flushQueue();
              finishRelaySubscribe(relay, "断开");
              maybeFinishNostrRefresh(subscribeToken);
              cleanup(false);
              return;
            }
            if (data[0] !== "EVENT" || !data[2]) return;
            if (isNostrRefreshActive(subscribeToken)) updateNostrRefreshProgress({ phase: "接收订阅", subEvents: Number(state.relay.refresh && state.relay.refresh.subEvents || 0) + 1, relay: shortRelay(relay) });
            eventQueue.push(data[2]);
            if (!flushTimer) flushTimer = setTimeout(flushQueue, 100);
          };
          ws.onclose = () => {
            if (closed) return;
            flushQueue();
            cleanup(false);
            if (!active()) return;
            finishRelaySubscribe(relay, "断开");
            maybeFinishNostrRefresh(subscribeToken);
          };
          ws.onerror = () => {
            if (closed) return;
            flushQueue();
            cleanup(false);
            if (!active()) return;
            finishRelaySubscribe(relay, "失败");
            if (!Object.values(state.relay.statuses).includes("已连接")) setStatus("nostr", "连接失败");
            maybeFinishNostrRefresh(subscribeToken);
          };
        } catch (e) {
          if (subscribeToken !== state.relay.subscribeToken) return;
          finishRelaySubscribe(relay, "失败");
          maybeFinishNostrRefresh(subscribeToken);
        }
      });
    }

    function queryRelayHotPage(relay, filter, timeout, generation) {
      return new Promise((resolve) => {
        const events = [];
        const subId = "fongmi_hot_" + Date.now() + "_" + Math.random().toString(16).slice(2);
        let settled = false;
        let closed = false;
        let registered = false;
        let timer = 0;
        let ws = null;
        let abort = null;
        const unregister = () => {
          if (!registered) return;
          const aborters = state.relay.queryAborters;
          if (aborters && abort) aborters.delete(abort);
          registered = false;
        };
        const cleanup = (sendClose) => {
          if (timer) {
            clearTimeout(timer);
            timer = 0;
          }
          if (!closed) {
            closed = true;
            if (sendClose && ws) {
              try { ws.send(JSON.stringify(["CLOSE", subId])); } catch (e) {}
            }
            if (ws) {
              try { ws.close(); } catch (e) {}
            }
          }
          unregister();
        };
        const done = (complete, failureKind, sendClose) => {
          if (settled) return;
          settled = true;
          cleanup(!!sendClose);
          events.complete = !!complete;
          events.failureKind = String(failureKind || "");
          resolve(events);
        };
        abort = () => done(false, "stale", false);
        try {
          ws = new WebSocket(relay);
          if (generation != null) {
            if (!state.relay.queryAborters) state.relay.queryAborters = new Set();
            state.relay.queryAborters.add(abort);
            registered = true;
            if (generation !== state.relay.subscribeToken) {
              abort();
              return;
            }
          }
          timer = setTimeout(() => done(false, "timeout", false), timeout || 9000);
          ws.onopen = () => {
            if (settled) return;
            if (generation != null && generation !== state.relay.subscribeToken) {
              abort();
              return;
            }
            ws.send(JSON.stringify(["REQ", subId, filter]));
          };
          ws.onmessage = (message) => {
            if (settled) return;
            if (generation != null && generation !== state.relay.subscribeToken) {
              abort();
              return;
            }
            const data = safeJson(message.data, []);
            if (data[0] === "EVENT" && data[2]) events.push(data[2]);
            if (data[0] === "CLOSED") {
              done(false, data[2] || "closed", false);
              return;
            }
            if (data[0] === "EOSE") done(true, "", true);
          };
          ws.onclose = () => done(false, "closed", false);
          ws.onerror = () => done(false, "error", false);
        } catch (e) {
          done(false, e && e.message || "error", false);
        }
      });
    }

    const RELAY_MIRROR_PAGE_LIMIT = 1000;
    const RELAY_MIRROR_MAX_PAGES_PER_SOURCE = 120;

    function normalizeRelayUrl(value) {
      const text = String(value || "").trim();
      if (!text) return "";
      try {
        const url = new URL(text);
        if (url.protocol !== "wss:" && url.protocol !== "ws:") return "";
        url.hash = "";
        return url.toString().replace(/\/$/, "");
      } catch (e) {
        return "";
      }
    }

    function parseRelayList(value) {
      return Array.from(new Set(String(value || "")
        .split(/[\s,，]+/)
        .map(normalizeRelayUrl)
        .filter(Boolean)));
    }

    function setupRelayMirrorDefaults() {
      const source = $("mirrorSourceInput");
      const target = $("mirrorTargetInput");
      if (source && !source.value.trim()) source.value = window.WEBHOME_CONFIG.nostr.relays.join("\n");
      if (target) target.value = target.value || "";
      disablePanelTextEditing(source);
      disablePanelTextEditing(target);
    }

    function setMirrorProgress(lines) {
      const el = $("mirrorProgress");
      if (!el) return;
      el.textContent = Array.isArray(lines) ? lines.filter(Boolean).join("\n") : String(lines || "镜像未执行");
    }

    function isMirrorableHotEvent(event) {
      return !!(event && event.id && event.pubkey && event.sig && event.kind === window.WEBHOME_CONFIG.nostr.kind && getD(event) === HOT_VECTOR_D && !eventExpired(event));
    }

    function mirrorEventKey(event) {
      return eventAddress(event) || String(event && event.id || "");
    }

    function mirrorEventIsNewer(next, old) {
      if (!old) return true;
      const nextCreated = Number(next && next.created_at || 0);
      const oldCreated = Number(old && old.created_at || 0);
      if (nextCreated !== oldCreated) return nextCreated > oldCreated;
      return String(next && next.id || "") > String(old && old.id || "");
    }

    async function queryMirrorEventsFromRelay(relay, since, progress) {
      const byId = new Map();
      let until = hotNow();
      let pages = 0;
      while (until > since && pages < RELAY_MIRROR_MAX_PAGES_PER_SOURCE) {
        pages += 1;
        setMirrorProgress([
          `拉取中：${shortRelay(relay)}`,
          `第 ${pages} 页，已收到 ${byId.size} 条`,
          progress
        ]);
        const events = await queryRelayHotPage(relay, {
          kinds: [window.WEBHOME_CONFIG.nostr.kind],
          "#t": [window.WEBHOME_CONFIG.nostr.tag],
          "#d": [HOT_VECTOR_D],
          since,
          until,
          limit: RELAY_MIRROR_PAGE_LIMIT
        }, 12000);
        events.filter(isMirrorableHotEvent).forEach((event) => byId.set(event.id, event));
        if (!events.length || !events.complete) break;
        let oldest = until;
        for (const event of events) oldest = Math.min(oldest, Number(event.created_at || oldest));
        if (events.length < RELAY_MIRROR_PAGE_LIMIT || oldest >= until) break;
        until = oldest - 1;
      }
      return Array.from(byId.values());
    }

    async function publishMirrorEventToRelay(relay, event, timeout) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (ok, text) => {
          if (settled) return;
          settled = true;
          resolve({ ok, text: text || "" });
        };
        try {
          const ws = new WebSocket(relay);
          const timer = setTimeout(() => {
            try { ws.close(); } catch (e) {}
            done(false, "超时");
          }, timeout || 9000);
          ws.onopen = () => ws.send(JSON.stringify(["EVENT", stripLocal(event)]));
          ws.onmessage = (message) => {
            const data = safeJson(message.data, []);
            if (data[0] !== "OK") return;
            clearTimeout(timer);
            try { ws.close(); } catch (e) {}
            done(!!data[2], data[2] ? "OK" : data[3] || "拒绝");
          };
          ws.onerror = () => {
            clearTimeout(timer);
            done(false, "失败");
          };
          ws.onclose = () => done(false, "断开");
        } catch (e) {
          done(false, e.message || "失败");
        }
      });
    }

    async function mirrorHotEventsToRelays() {
      if (mirrorHotEventsToRelays.busy) return;
      const sources = parseRelayList($("mirrorSourceInput") && $("mirrorSourceInput").value || window.WEBHOME_CONFIG.nostr.relays.join("\n"));
      const targets = parseRelayList($("mirrorTargetInput") && $("mirrorTargetInput").value || "");
      if (!sources.length) return toast("请填写源 relay");
      if (!targets.length) return toast("请填写目标 relay");
      mirrorHotEventsToRelays.busy = true;
      const button = $("mirrorRelayBtn");
      if (button) button.textContent = "镜像中";
      try {
        const since = hotWindowStart();
        const eventsByAddress = new Map();
        for (const relay of sources) {
          const events = await queryMirrorEventsFromRelay(relay, since, `源 ${sources.indexOf(relay) + 1}/${sources.length} · 用户 ${eventsByAddress.size} 个`);
          events.forEach((event) => {
            const key = mirrorEventKey(event);
            if (key && mirrorEventIsNewer(event, eventsByAddress.get(key))) eventsByAddress.set(key, event);
          });
          setMirrorProgress([
            `源完成：${shortRelay(relay)}`,
            `本源有效 ${events.length} 条`,
            `按用户去重后 ${eventsByAddress.size} 条`
          ]);
        }
        const events = Array.from(eventsByAddress.values()).sort((a, b) => Number(b.created_at || 0) - Number(a.created_at || 0));
        if (!events.length) {
          setMirrorProgress(["镜像完成", "没有从源 relay 拉到可镜像的榜单事件"]);
          toast("没有可镜像事件");
          return;
        }
        let ok = 0;
        let rejected = 0;
        let failed = 0;
        let done = 0;
        for (const target of targets) {
          let targetOk = 0;
          let targetRejected = 0;
          let targetFailed = 0;
          for (const event of events) {
            done += 1;
            setMirrorProgress([
              `发布中：${shortRelay(target)}`,
              `事件 ${done}/${events.length * targets.length}`,
              `总计 OK ${ok} · 拒绝 ${rejected} · 失败 ${failed}`
            ]);
            const result = await publishMirrorEventToRelay(target, event, 9000);
            if (result.ok) {
              ok += 1;
              targetOk += 1;
            } else if (/duplicate|exists|already|newer|older|replace/i.test(result.text || "")) {
              ok += 1;
              targetOk += 1;
            } else if ((result.text || "").includes("拒绝")) {
              rejected += 1;
              targetRejected += 1;
            } else {
              failed += 1;
              targetFailed += 1;
            }
          }
          setMirrorProgress([
            `目标完成：${shortRelay(target)}`,
            `OK ${targetOk} · 拒绝 ${targetRejected} · 失败 ${targetFailed}`,
            `总计 OK ${ok} · 拒绝 ${rejected} · 失败 ${failed}`
          ]);
        }
        setMirrorProgress([
          "镜像完成",
          `源 relay ${sources.length} 个，目标 relay ${targets.length} 个`,
          `最新用户事件 ${events.length} 条`,
          `发布 OK ${ok} · 拒绝 ${rejected} · 失败 ${failed}`
        ]);
        toast(`镜像完成：${events.length} 条事件`);
      } finally {
        mirrorHotEventsToRelays.busy = false;
        if (button) button.textContent = "镜像榜单";
      }
    }

    async function syncRelayBackfill(relay, token) {
      const runToken = token == null ? state.relay.subscribeToken : token;
      if (runToken !== state.relay.subscribeToken) return;
      if (state.relay.backfillBusy[relay]) return;
      const relayState = getRelayBackfillState(relay);
      if (relayState.terminal) return;
      state.relay.backfillBusy[relay] = true;
      setRelayBackfillState(relay, { loading: true, startedAt: hotNow() });
      let cursor = null;
      try {
        const db = await openHotDb();
        if (runToken !== state.relay.subscribeToken) return;
        if (!db) {
          markRelayBackfillTerminal(relay, "failed", "本地索引不可用", runToken);
          if (isNostrRefreshActive(runToken)) updateNostrRefreshProgress({ active: false, phase: "本地索引不可用", finishedAt: Date.now() });
          return;
        }
        if (isNostrRefreshActive(runToken)) updateNostrRefreshProgress({ phase: "回填近7天 + 90天历史", relay: shortRelay(relay) });
        const since = hotWindowStart();
        const now = hotNow();
        cursor = normalizeRelayCursor(await hotStoreGet("relayCursor", relay), relay, since, now);
        if (runToken !== state.relay.subscribeToken) return;
        if (cursor.nextRetryAt && cursor.nextRetryAt > now) return;
        let changed = false;
        changed = await syncRelayRecent(relay, cursor, since, now, runToken) || changed;
        if (!cursor.recentUntil && !cursor.historyDone && !cursor.historyFailed && !cursor.historyTimedOut) {
          changed = await syncRelayHistory(relay, cursor, since, now, runToken) || changed;
        }
        if (runToken !== state.relay.subscribeToken) return;
        cursor.updatedAt = hotNow();
        const tx = db.transaction("relayCursor", "readwrite");
        tx.objectStore("relayCursor").put(cursor);
        await idbDone(tx).catch(() => {});
        if (relayBackfillDone(cursor)) {
          markRelayBackfillTerminal(relay, cursor.historyTimedOut ? "timeout" : cursor.historyFailed ? "failed" : "done", cursor.error, runToken);
        }
        if (changed) {
          scheduleHotRefresh(HOT_REFRESH_BACKFILL_MS);
          setStatus("nostr", `已同步 ${shortRelay(relay)}`);
          if (isNostrRefreshActive(runToken)) updateNostrRefreshProgress({ phase: "写入索引", indexed: state.hot.items.length, relay: shortRelay(relay) });
        }
      } catch (e) {
        if (runToken === state.relay.subscribeToken) {
          const error = e && e.message || "回填失败";
          if (cursor) {
            cursor.recentUntil = 0;
            cursor.recentHigh = 0;
            cursor.recentTarget = 0;
            cursor.historyUntil = Number(cursor.since || 0) - 1;
            cursor.historyDone = false;
            cursor.historyFailed = true;
            cursor.historyTimedOut = false;
            cursor.error = error;
          }
          markRelayBackfillTerminal(relay, "failed", error, runToken);
        }
      } finally {
        if (runToken === state.relay.subscribeToken) {
          delete state.relay.backfillBusy[relay];
          const current = getRelayBackfillState(relay);
          current.loading = false;
          if (cursor && !relayBackfillDone(cursor) && !current.terminal) scheduleRelayBackfill(relay, relayBackfillDelay(cursor), runToken);
          maybeFinishNostrRefresh(runToken);
        }
      }
    }

    function relayBackfillDone(cursor) {
      return !cursor.recentUntil && (cursor.historyDone || cursor.historyFailed || cursor.historyTimedOut);
    }

    function relayBackfillDelay(cursor) {
      const nextRetryAt = Number(cursor && cursor.nextRetryAt || 0);
      if (nextRetryAt > hotNow()) return Math.max(HOT_BACKFILL_IDLE_MS, (nextRetryAt - hotNow()) * 1000);
      return HOT_BACKFILL_IDLE_MS;
    }

    function markRelayBackfillRetry(relay, cursor, phase, events, token) {
      const failureKind = events && events.failureKind === "timeout" ? "timeout" : "failed";
      const detail = events && events.failureKind ? `：${events.failureKind}` : "";
      const error = `${phase || "回填"}${failureKind === "timeout" ? "超时" : "失败"}${detail}`;
      cursor.failures = Math.min(HOT_BACKFILL_MAX_FAILURES, Number(cursor.failures || 0) + 1);
      cursor.error = error;
      if (cursor.failures >= HOT_BACKFILL_MAX_FAILURES) {
        cursor.nextRetryAt = 0;
        cursor.recentHigh = 0;
        cursor.recentUntil = 0;
        cursor.recentTarget = 0;
        cursor.historyUntil = Number(cursor.since || 0) - 1;
        cursor.historyDone = false;
        cursor.historyFailed = failureKind === "failed";
        cursor.historyTimedOut = failureKind === "timeout";
        markRelayBackfillTerminal(relay, failureKind, error, token);
        return true;
      }
      const delay = Math.min(HOT_BACKFILL_RETRY_MAX_MS, HOT_BACKFILL_RETRY_MS * Math.pow(2, cursor.failures - 1));
      cursor.nextRetryAt = hotNow() + Math.ceil(delay / 1000);
      setRelayBackfillState(relay, { error, terminal: false, terminalState: "retrying" });
      return false;
    }

    function clearRelayBackfillRetry(cursor) {
      cursor.failures = 0;
      cursor.nextRetryAt = 0;
      cursor.error = "";
    }

    function scheduleRelayBackfill(relay, delay, token) {
      if (getRelayBackfillState(relay).terminal) return;
      clearTimeout(state.relay.backfillTimers[relay]);
      const runToken = token == null ? state.relay.subscribeToken : token;
      state.relay.backfillTimers[relay] = setTimeout(() => {
        delete state.relay.backfillTimers[relay];
        if (isNostrRefreshActive(runToken)) updateNostrRefreshProgress({ phase: "回填排队完成", relay: shortRelay(relay) });
        syncRelayBackfill(relay, runToken).catch(() => {});
      }, Number.isFinite(delay) ? delay : HOT_BACKFILL_IDLE_MS);
      if (isNostrRefreshActive(runToken)) updateNostrRefreshProgress({ phase: "等待回填", relay: shortRelay(relay) });
    }

    function normalizeRelayCursor(row, relay, since, now) {
      if (!row) {
        return {
          relay,
          since,
          newest: now,
          recentHigh: 0,
          recentUntil: 0,
          recentTarget: 0,
          historyUntil: now,
          historyDone: false,
          historyFailed: false,
          historyTimedOut: false,
          error: "",
          updatedAt: 0,
          failures: 0,
          nextRetryAt: 0
        };
      }
      const cursor = row || {};
      const previousSince = Number(cursor.since || 0);
      const expandedWindow = previousSince > since;
      const newest = Math.max(Number(cursor.newest || 0), since - 1);
      let historyUntil = Number(cursor.historyUntil || cursor.until || 0);
      if (expandedWindow) historyUntil = Math.max(since, previousSince - 1);
      if (!historyUntil || historyUntil < since) historyUntil = Math.max(newest, now);
      const historyDone = expandedWindow ? false : cursor.historyDone === true || cursor.done === true && historyUntil <= since;
      return {
        relay,
        since,
        newest,
        recentHigh: Math.max(Number(cursor.recentHigh || 0), 0),
        recentUntil: Math.max(Number(cursor.recentUntil || 0), 0),
        recentTarget: Math.max(Number(cursor.recentTarget || 0), 0),
        historyUntil,
        historyDone,
        historyFailed: false,
        historyTimedOut: false,
        error: "",
        updatedAt: Number(cursor.updatedAt || 0),
        failures: Number(cursor.failures || 0),
        nextRetryAt: Number(cursor.nextRetryAt || 0)
      };
    }

    async function syncRelayRecent(relay, cursor, since, now, token) {
      if (!cursor.recentUntil && now > cursor.newest) {
        cursor.recentHigh = now;
        cursor.recentUntil = now;
        cursor.recentTarget = Math.max(since, Number(cursor.newest || 0) + 1);
      }
      if (!cursor.recentUntil) return false;
      let changed = false;
      for (let page = 0; page < HOT_RECENT_PAGES_PER_RELAY; page++) {
        if (cursor.recentUntil < cursor.recentTarget) break;
        const events = await queryRelayHotPage(relay, {
          kinds: [window.WEBHOME_CONFIG.nostr.kind],
          "#t": [window.WEBHOME_CONFIG.nostr.tag],
          "#d": [HOT_VECTOR_D],
          since: cursor.recentTarget,
          until: cursor.recentUntil,
          limit: HOT_PAGE_LIMIT
        }, 9000, token);
        if (token != null && token !== state.relay.subscribeToken) break;
        if (isNostrRefreshActive(token)) {
          updateNostrRefreshProgress({
            phase: "回填近7天",
            relay: shortRelay(relay),
            recentPages: Number(state.relay.refresh && state.relay.refresh.recentPages || 0) + 1,
            recentEvents: Number(state.relay.refresh && state.relay.refresh.recentEvents || 0) + events.length
          });
        }
        if (!events.length) {
          if (!events.complete) {
            markRelayBackfillRetry(relay, cursor, "近7天", events, token);
            break;
          }
          clearRelayBackfillRetry(cursor);
          finishRelayRecent(cursor);
          break;
        }
        let oldest = cursor.recentUntil;
        for (const event of events) oldest = Math.min(oldest, Number(event.created_at || oldest));
        const ingested = await hotIngestEvents(events, { generation: token });
        if (token != null && token !== state.relay.subscribeToken) break;
        if (ingested) {
          changed = true;
          if (isNostrRefreshActive(token)) updateNostrRefreshProgress({ phase: "写入索引", indexed: state.hot.items.length, relay: shortRelay(relay) });
        }
        cursor.recentUntil = oldest - 1;
        if (!events.complete) {
          markRelayBackfillRetry(relay, cursor, "近7天", events, token);
          break;
        }
        clearRelayBackfillRetry(cursor);
        if (events.length < HOT_PAGE_LIMIT || cursor.recentUntil < cursor.recentTarget) {
          finishRelayRecent(cursor);
          break;
        }
        if (token != null && token !== state.relay.subscribeToken) break;
      }
      return changed;
    }

    function finishRelayRecent(cursor) {
      const historyCeiling = Number(cursor.recentTarget || 0) - 1;
      cursor.newest = Math.max(Number(cursor.newest || 0), Number(cursor.recentHigh || 0));
      if (historyCeiling <= Number(cursor.since || 0)) {
        cursor.historyDone = true;
        cursor.historyUntil = Number(cursor.since || 0) - 1;
      } else if (!cursor.historyDone && (!cursor.historyUntil || cursor.historyUntil > historyCeiling)) {
        cursor.historyUntil = historyCeiling;
      }
      cursor.recentHigh = 0;
      cursor.recentUntil = 0;
      cursor.recentTarget = 0;
    }

    async function syncRelayHistory(relay, cursor, since, now, token) {
      if (cursor.historyDone || cursor.historyFailed || cursor.historyTimedOut) return false;
      if (!cursor.historyUntil || cursor.historyUntil < since) cursor.historyUntil = Math.max(cursor.newest || 0, now);
      let changed = false;
      for (let page = 0; page < HOT_HISTORY_PAGES_PER_RELAY; page++) {
        if (token != null && token !== state.relay.subscribeToken) break;
        if (cursor.historyUntil <= since) {
          cursor.historyDone = true;
          break;
        }
        const events = await queryRelayHotPage(relay, {
          kinds: [window.WEBHOME_CONFIG.nostr.kind],
          "#t": [window.WEBHOME_CONFIG.nostr.tag],
          "#d": [HOT_VECTOR_D],
          since,
          until: cursor.historyUntil,
          limit: HOT_PAGE_LIMIT
        }, 9000, token);
        if (token != null && token !== state.relay.subscribeToken) break;
        if (isNostrRefreshActive(token)) {
          updateNostrRefreshProgress({
            phase: "回填历史",
            relay: shortRelay(relay),
            historyPages: Number(state.relay.refresh && state.relay.refresh.historyPages || 0) + 1,
            historyEvents: Number(state.relay.refresh && state.relay.refresh.historyEvents || 0) + events.length
          });
        }
        if (!events.length) {
          if (!events.complete) {
            markRelayBackfillRetry(relay, cursor, "历史90天", events, token);
            break;
          }
          clearRelayBackfillRetry(cursor);
          cursor.historyDone = true;
          break;
        }
        let oldest = cursor.historyUntil;
        for (const event of events) oldest = Math.min(oldest, Number(event.created_at || oldest));
        const ingested = await hotIngestEvents(events, { generation: token });
        if (token != null && token !== state.relay.subscribeToken) break;
        if (ingested) {
          changed = true;
          if (isNostrRefreshActive(token)) updateNostrRefreshProgress({ phase: "写入索引", indexed: state.hot.items.length, relay: shortRelay(relay) });
        }
        cursor.historyUntil = oldest - 1;
        if (!events.complete) {
          markRelayBackfillRetry(relay, cursor, "历史90天", events, token);
          break;
        }
        clearRelayBackfillRetry(cursor);
        cursor.historyDone = events.length < HOT_PAGE_LIMIT || cursor.historyUntil <= since;
        if (cursor.historyDone) break;
      }
      return changed;
    }

    function publishEvent(event) {
      if (!event || !event.sig) {
        setStatus("publish", "未签名，未发布");
        return;
      }
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      state.relay.total = relays.length;
      let done = 0;
      let ok = 0;
      state.relay.lastOk = 0;
      state.relay.lastDone = 0;
      setStatus("publish", `发布中 0/${relays.length}`);
      relays.forEach((relay) => {
        try {
          const ws = new WebSocket(relay);
          const finish = (success, text) => {
            done += 1;
            if (success) ok += 1;
            state.relay.lastOk = ok;
            state.relay.lastDone = done;
            setStatus("publish", `发布 ${ok}/${done}/${relays.length}${text ? " · " + text : ""}`);
            renderMetrics();
          };
          const timer = setTimeout(() => {
            finish(false, shortRelay(relay) + " 超时");
            try { ws.close(); } catch (e) {}
          }, 6000);
          ws.onopen = () => ws.send(JSON.stringify(["EVENT", stripLocal(event)]));
          ws.onmessage = (message) => {
            const data = safeJson(message.data, []);
            if (data[0] === "OK") {
              clearTimeout(timer);
              if (data[2]) state.relay.published += 1;
              finish(!!data[2], `${shortRelay(relay)} ${data[2] ? "OK" : data[3] || "拒绝"}`);
              try { ws.close(); } catch (e) {}
            }
          };
          ws.onerror = () => {
            clearTimeout(timer);
            finish(false, shortRelay(relay) + " 失败");
          };
        } catch (e) {
          done += 1;
          state.relay.lastOk = ok;
          state.relay.lastDone = done;
          setStatus("publish", `发布 ${ok}/${done}/${relays.length} · ${shortRelay(relay)} 失败`);
        }
      });
    }

    function eventAddress(event) {
      const d = getD(event);
      if (!event || !event.kind || !event.pubkey || !d) return "";
      return `${event.kind}:${event.pubkey}:${d}`;
    }

    function createDeleteEvent(events, identity) {
      const ids = Array.from(new Set(events.map((event) => event && event.id).filter(Boolean)));
      const addresses = Array.from(new Set(events.map(eventAddress).filter(Boolean)));
      const tags = ids.map((id) => ["e", id]).concat(addresses.map((addr) => ["a", addr]));
      tags.push(["t", window.WEBHOME_CONFIG.nostr.tag], ["app", "fongmi-webhome"]);
      const draft = {
        kind: 5,
        created_at: Math.floor(Date.now() / 1000),
        tags,
        content: "delete fongmi webhome preference events"
      };
      return window.NostrTools.finalizeEvent(draft, identity.secret);
    }

    function publishToRelay(relay, event, timeout) {
      return new Promise((resolve) => {
        let settled = false;
        const done = (ok, text) => {
          if (settled) return;
          settled = true;
          resolve({ ok, text });
        };
        try {
          const ws = new WebSocket(relay);
          const timer = setTimeout(() => {
            try { ws.close(); } catch (e) {}
            done(false, "超时");
          }, timeout || 7000);
          ws.onopen = () => ws.send(JSON.stringify(["EVENT", event]));
          ws.onmessage = (message) => {
            const data = safeJson(message.data, []);
            if (data[0] !== "OK") return;
            clearTimeout(timer);
            try { ws.close(); } catch (e) {}
            done(!!data[2], data[2] ? "OK" : data[3] || "拒绝");
          };
          ws.onerror = () => {
            clearTimeout(timer);
            done(false, "失败");
          };
        } catch (e) {
          done(false, e.message || "失败");
        }
      });
    }

    async function queryRelayEventsPaged(relay, pubkey, since) {
      const events = [];
      let until = Math.floor(Date.now() / 1000);
      for (let page = 0; page < 20; page++) {
        const batch = await queryRelayHotPage(relay, {
          kinds: [window.WEBHOME_CONFIG.nostr.kind],
          authors: [pubkey],
          "#t": [window.WEBHOME_CONFIG.nostr.tag],
          "#d": [HOT_VECTOR_D],
          since,
          until,
          limit: HOT_PAGE_LIMIT
        }, 9000);
        if (!batch.length) break;
        events.push(...batch);
        until = Math.min(...batch.map((event) => Number(event.created_at || until))) - 1;
        if (batch.length < HOT_PAGE_LIMIT) break;
      }
      return events;
    }

    async function clearLocalPreferenceData() {
      await clearLocalEvents(false);
      setStatus("publish", "已清理本机缓存");
      toast("本机偏好缓存已清理");
    }

    async function clearMyNostrData(identity) {
      identity = identity || await ensureIdentity();
      if (!identity || !identity.pubkey || !identity.secret) return toast("请先同步或生成身份");
      setStatus("publish", "查询我的事件");
      const since = hotWindowStart();
      const relays = window.WEBHOME_CONFIG.nostr.relays;
      const found = [];
      for (const relay of relays) found.push(...await queryRelayEventsPaged(relay, identity.pubkey, since));
      const events = Array.from(new Map(found.filter((event) => event && event.id).map((event) => [event.id, event])).values());
      if (!events.length) {
        await clearLocalEvents(true);
        setStatus("publish", "没有找到我的远端事件");
        toast("没有找到需要删除的数据");
        return;
      }
      const deleteEvent = createDeleteEvent(events, identity);
      let ok = 0;
      let done = 0;
      setStatus("publish", `删除中 0/${relays.length}`);
      for (const relay of relays) {
        const result = await publishToRelay(relay, deleteEvent, 7000);
        done += 1;
        if (result.ok) ok += 1;
        setStatus("publish", `删除 ${ok}/${done}/${relays.length} · ${shortRelay(relay)} ${result.text || ""}`);
      }
      await clearLocalEvents(true);
      toast(`删除请求已发送 ${ok}/${relays.length}`);
    }

    async function deleteAllPreferenceData() {
      const identity = await ensureIdentity();
      await markIdentityDeletedLocally(identity);
      stopWatchTracking(false);
      await clearPendingWatch();
      await clearLocalPreferenceData();
      await clearMyNostrData(identity);
    }

    function stripLocal(event) {
      const copy = Object.assign({}, event);
      delete copy.local;
      return copy;
    }

    function getD(event) {
      const tag = (event && event.tags || []).find((item) => item && item[0] === "d");
      return tag && tag[1];
    }

    function eventContent(event) {
      const content = event && event.content;
      if (content && typeof content === "object") return content;
      return safeJson(content, null);
    }

