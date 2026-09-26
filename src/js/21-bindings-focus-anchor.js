    // 详情页背景：随滚动渐变高斯模糊 + 压暗（参考美化最终.html，排除 TV 端）
    // ease 0→1：0=顶部正常，1=完全模糊压暗
    function setDetailHeroBlur(blurPx, ease) {
      const heroBg = $("detailHeroBg");
      if (!heroBg) return;
      if (isTvLikeDevice()) { heroBg.style.filter = ""; return; } // TV 端交还给 CSS，不做模糊
      const e = (ease !== undefined) ? Math.min(1, Math.max(0, ease)) : Math.min(1, (blurPx || 0) / 20);
      const brightness = (0.78 - e * 0.46).toFixed(3); // 顶部 0.78 → 压暗到 0.32
      heroBg.style.filter = `brightness(${brightness}) saturate(1.05) blur(${(blurPx || 0).toFixed(1)}px)`;
    }

    function bindActions() {
      $("refreshNostrBtn").addEventListener("click", () => {
        forceRefreshNostrRanking().catch((e) => toast(e.message || "刷新榜单失败"));
      });
      $("mirrorRelayBtn").addEventListener("click", () => {
        mirrorHotEventsToRelays().catch((e) => {
          setMirrorProgress(["镜像失败", e.message || String(e || "")]);
          toast(e.message || "镜像失败");
        });
      });
      $("syncBtn").addEventListener("click", openSync);
      $("closeSyncBtn").addEventListener("click", () => closeSync(false));
      $("saveNsecBtn").addEventListener("click", async () => {
        try {
          await setIdentity($("nsecInput").value);
          toast("同步身份已导入");
        } catch (e) {
          toast(e.message || "导入失败");
        }
      });
      $("newNsecBtn").addEventListener("click", async () => {
        await waitForNostrTools();
        if (!window.NostrTools) return toast("Nostr 工具未加载");
        const nsec = window.NostrTools.nip19.nsecEncode(window.NostrTools.generateSecretKey());
        await setIdentity(nsec);
        $("nsecInput").value = nsec;
        toast("已生成新身份");
      });
      (function setupStatusToggle() {
        const toggle = $("connectionToggle");
        if (!toggle) return;
        const LONG_MS = 500;
        let timer = 0;
        let fired = false;
        let suppressClickUntil = 0;
        function startHold() {
          fired = false;
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => {
            timer = 0;
            fired = true;
            suppressClickUntil = Date.now() + 700;
            try { closeConnectionPanel(); } catch (e) {}
            openSettingHome();
          }, LONG_MS);
        }
        function cancelHold() {
          if (timer) { clearTimeout(timer); timer = 0; }
        }
        toggle.addEventListener("pointerdown", startHold);
        toggle.addEventListener("pointerup", cancelHold);
        toggle.addEventListener("pointerleave", cancelHold);
        toggle.addEventListener("pointercancel", cancelHold);
        toggle.addEventListener("click", (event) => {
          if (fired || Date.now() < suppressClickUntil) {
            event.preventDefault();
            event.stopPropagation();
            fired = false;
            return;
          }
          toggleConnectionPanel(event);
        });
        toggle.addEventListener("keydown", (event) => {
          const key = normalizeRemoteKey(event);
          if (key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (event.repeat) return;
          startHold();
        });
        toggle.addEventListener("keyup", (event) => {
          const key = normalizeRemoteKey(event);
          if (key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          cancelHold();
          if (fired) { fired = false; return; }
          toggleConnectionPanel(event);
        });
      })();
      $("deleteDataBtn").addEventListener("click", () => {
        closeConnectionPanel();
        setStatus("publish", "后台删除数据中");
        toast("已开始后台删除数据");
        deleteAllPreferenceData().catch((e) => toast(e.message || "删除失败"));
      });
      $("savePanConfigBtn").addEventListener("click", () => {
        savePanConfig().catch((e) => toast(e.message || "保存失败"));
      });
      if ($("sourceDomainsToggle")) $("sourceDomainsToggle").addEventListener("click", toggleSourceDomains);
      if ($("sourceDomainsResetBtn")) $("sourceDomainsResetBtn").addEventListener("click", restoreSourceDomainDefaults);
      document.querySelectorAll("[data-home-fullscreen]").forEach((button) => {
        button.addEventListener("click", () => {
          setHomeFullscreenEnabled(button.dataset.homeFullscreen !== "off").catch(() => {});
        });
        button.addEventListener("keydown", (event) => {
          handleConnectionSegmentedDirectionalKey(button, event);
        });
      });
      const panConfig = document.querySelector(".pan-config");
      if (panConfig) {
        panConfig.addEventListener("input", markPanConfigDirty);
        panConfig.addEventListener("change", markPanConfigDirty);
      }
      (function () {
        const sheet = $("detailSheet");
        if (sheet) {
          let rafId = 0;
          let blurStart = -1;
          let blurEnd = -1;
          const measureBlurRange = () => {
            const spacer = sheet.querySelector(".detail-spacer");
            const spacerH = spacer ? spacer.offsetHeight : window.innerHeight * 0.42;
            blurStart = Math.round(spacerH * 0.05); // 开始渐入模糊
            blurEnd   = Math.round(spacerH * 0.90); // 完全模糊
          };
          sheet.addEventListener("scroll", () => {
            updateMobileDetailBackButton();
            scheduleUiSnapshotSave();
            if (isTvLikeDevice()) return;       // 排除 TV 端
            if (rafId) return;
            rafId = requestAnimationFrame(() => {
              rafId = 0;
              if (blurStart < 0) measureBlurRange();
              const scrollTop = sheet.scrollTop || 0;
              const range = Math.max(1, blurEnd - blurStart);
              const pct = Math.min(1, Math.max(0, (scrollTop - blurStart) / range));
              // easeInOut 让两端过渡更柔和
              const ease = pct < 0.5 ? 2 * pct * pct : 1 - Math.pow(-2 * pct + 2, 2) / 2;
              const blurPx = parseFloat((ease * 20).toFixed(1)); // 最大 20px
              setDetailHeroBlur(blurPx, ease);
            });
          }, { passive: true });
        }
      })();
      bindHomeHeroSwipe();
      bindDetailCoverSwipe();
      $("detailMoreBtn").addEventListener("click", toggleDetailTextMore);
      $("detailText").addEventListener("click", handleDetailTextClick);
      $("panTabs").addEventListener("click", handlePanTabEvent);
      $("panTabs").addEventListener("touchend", handlePanTabEvent);
      $("panTabs").addEventListener("keydown", (event) => {
        const key = normalizeRemoteKey(event);
        if (key !== "Enter" && event.key !== " ") return;
        handlePanTabEvent(event);
      });
      $("panTabs").addEventListener("keyup", (event) => {
        const key = normalizeRemoteKey(event);
        if (key !== "Enter" && event.key !== " ") return;
        handlePanTabEvent(event);
      });
      $("searchInput").addEventListener("input", handleSearchInputChanged);
      $("searchInput").addEventListener("compositionstart", beginSearchComposition);
      $("searchInput").addEventListener("compositionupdate", beginSearchComposition);
      $("searchInput").addEventListener("compositionend", endSearchComposition);
      $("searchInput").addEventListener("pointerdown", enableSearchEditing);
      $("searchInput").addEventListener("mousedown", enableSearchEditing);
      $("searchInput").addEventListener("touchstart", enableSearchEditing, { passive: true });
      $("searchInput").addEventListener("focus", () => {
        state.searchImeFocusSeq = Number(state.searchImeFocusSeq || 0) + 1;
        if ($("searchInput").readOnly) hideSearchSuggest();
      });
      $("searchInput").addEventListener("blur", () => {
        state.searchImeBlurSeq = Number(state.searchImeBlurSeq || 0) + 1;
        disableSearchEditing();
      });
      document.querySelectorAll("#connectionBody input, #connectionBody textarea").forEach((el) => {
        el.addEventListener("pointerdown", () => enablePanelTextEditing(el));
        el.addEventListener("mousedown", () => enablePanelTextEditing(el));
        el.addEventListener("touchstart", () => enablePanelTextEditing(el), { passive: true });
        el.addEventListener("blur", () => disablePanelTextEditing(el));
      });
      $("searchInput").addEventListener("keydown", (event) => {
        if (document.activeElement !== $("searchInput")) return;
        const key = normalizeRemoteKey(event);
        if (key === "ArrowDown" && isSearchSuggestOpen()) {
          const first = firstSearchSuggestItem();
          event.preventDefault();
          event.stopPropagation();
          if (first) focusSearchSuggestTarget(first);
          return;
        }
        if (key === "ArrowDown" && $("searchInput").readOnly) {
          event.preventDefault();
          event.stopPropagation();
          const target = isTvLikeDevice() ? firstSearchHistoryFocusTarget() || firstSearchResultFocusTarget() || firstSearchHotFocusTarget() : null;
          if (target) focusRemoteTarget(target);
          else if (homeUiRoute() !== "search") focusInitialHomeNow();
          return;
        }
        if (key === "Enter" && $("searchInput").readOnly) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          enterSearchEditMode("search_input_keydown", event);
          return;
        }
      });
      document.addEventListener("click", (event) => {
        if (!$("searchForm").contains(event.target)) hideSearchSuggest();
      });
      $("searchForm").addEventListener("submit", (event) => {
        event.preventDefault();
        submitSearchInput();
      });
      const searchSubmit = $("searchSubmitBtn") || $("searchForm").querySelector("button[type='submit']");
      searchSubmit.addEventListener("pointerdown", handleSearchNativeHoldStart);
      searchSubmit.addEventListener("pointermove", handleSearchNativeHoldMove);
      searchSubmit.addEventListener("pointerup", handleSearchNativeHoldEnd);
      searchSubmit.addEventListener("pointercancel", clearSearchHold);
      searchSubmit.addEventListener("pointerleave", clearSearchHold);
      searchSubmit.addEventListener("contextmenu", (event) => {
        if (Date.now() < Number(state.searchHold.suppressClickUntil || 0)) event.preventDefault();
      });
      searchSubmit.addEventListener("blur", clearSearchHold);
      searchSubmit.addEventListener("click", handleSearchSubmitClick);
      if ($("searchPageBack")) $("searchPageBack").addEventListener("click", requestCloseSearchPage);
      if ($("searchHistoryClear")) $("searchHistoryClear").addEventListener("click", clearSearchHistory);
      if ($("secondaryCatalogBack")) $("secondaryCatalogBack").addEventListener("click", requestCloseSecondaryCatalog);
      if ($("recentManageBtn")) $("recentManageBtn").addEventListener("click", enterRecentManageMode);
      if ($("recentManageSelectAll")) $("recentManageSelectAll").addEventListener("click", toggleRecentManageSelectAll);
      if ($("recentManageDelete")) $("recentManageDelete").addEventListener("click", armRecentManageDelete);
      if ($("recentManageCancel")) $("recentManageCancel").addEventListener("click", handleRecentManageCancel);
      if ($("homeSearchLauncher")) $("homeSearchLauncher").addEventListener("click", openSearchPage);
      if ($("homeMenuLauncher")) $("homeMenuLauncher").addEventListener("click", () => {
        if (isSidebarOpen()) closeSidebar();
        else openSidebar();
      });
      if ($("homeSidebarBackdrop")) $("homeSidebarBackdrop").addEventListener("click", () => {
        if (isMobileSidebarDevice() && isSidebarOpen() && isConnectionPanelOpen()) {
          closeConnectionPanel();
          return;
        }
        closeSidebar();
      });
      if ($("connectionOverlayBackdrop")) $("connectionOverlayBackdrop").addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeConnectionPanel();
      });
      if ($("homeRecentMore")) $("homeRecentMore").addEventListener("click", () => openSecondaryCatalog("recent", { originSection: "recent", originTarget: $("homeRecentMore") }));
      if ($("homeHotMore")) $("homeHotMore").addEventListener("click", () => openSecondaryCatalog("now-playing", { originSection: "now-playing", originTarget: $("homeHotMore") }));
      document.querySelectorAll("[data-home-hot-source]").forEach((button) => {
        if (button.dataset.homeHotSourceBound === "1") return;
        button.dataset.homeHotSourceBound = "1";
        button.addEventListener("click", () => setHomeHotSource(button.dataset.homeHotSource).catch(() => {}));
        button.addEventListener("keydown", (event) => {
          handleConnectionSegmentedDirectionalKey(button, event);
        });
      });
      (function () {
        const clearBtn = $("clearSearchBtn");
        if (clearBtn) {
          // 点清空时阻止按钮抢走输入框焦点：键盘全程不动，避免收起后又回弹
          const keepSearchFocus = (event) => {
            if (document.activeElement === $("searchInput")) event.preventDefault();
          };
          clearBtn.addEventListener("pointerdown", keepSearchFocus);
          clearBtn.addEventListener("mousedown", keepSearchFocus);
          clearBtn.addEventListener("click", clearSearchResults);
        }
      })();
      if ($("closeDetailBtn")) $("closeDetailBtn").addEventListener("click", () => closeDetail(false));
      // mobileDetailBackBtn 已移除
      $("detailContinueBtn").addEventListener("click", handleDetailPrimaryAction);
      $("detailSearchBtn").addEventListener("click", async () => {
        if (!state.selected) return;
        try { await resolveCanonicalResourceTitle(state.selected); } catch (e) {}
        nativeSearch(resourceSearchKeyword(state.selected)).catch(() => {});
      });
      $("panSearchBtn").addEventListener("click", async () => {
        const item = state.selected;
        if (!item) return;
        if (canonicalResourceKey(item)) {
          try { await resolveCanonicalResourceTitle(item); } catch (e) {}
          if (state.selected !== item) return;
        }
        clearDirectPlayStatus(0, "manual_pan");
        searchPanResources(item, { origin: "manual", forceNewSession: true });
      });
      $("backTopBtn").addEventListener("click", () => {
        scrollHomeToTop();
      });
    }

    function bindDetailCoverSwipe() {
      const cover = $("detailImage") && $("detailImage").parentElement;
      if (!cover) return;
      cover.addEventListener("touchstart", (event) => {
        if (document.documentElement.classList.contains("tv-mode") || state.detailCover.images.length <= 1) return;
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        state.detailCover.swipe = { x: touch.clientX, y: touch.clientY, at: Date.now(), moved: false };
      }, { passive: true });
      cover.addEventListener("touchmove", (event) => {
        const swipe = state.detailCover.swipe;
        const touch = event.touches && event.touches[0];
        if (!swipe || !touch) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.25) {
          swipe.moved = true;
          event.preventDefault();
        }
      }, { passive: false });
      cover.addEventListener("touchend", (event) => {
        const swipe = state.detailCover.swipe;
        state.detailCover.swipe = null;
        if (!swipe || !swipe.moved || state.detailCover.images.length <= 1) return;
        const touch = event.changedTouches && event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - swipe.x;
        const dy = touch.clientY - swipe.y;
        if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(dy) * 1.25 || Date.now() - swipe.at > 900) return;
        event.preventDefault();
        event.stopPropagation();
        shiftDetailCover(dx < 0 ? 1 : -1);
      }, { passive: false });
      cover.addEventListener("touchcancel", () => {
        state.detailCover.swipe = null;
      }, { passive: true });
    }

    function scrollHomeToTop() {
      try {
        if (isTvLikeDevice()) window.scrollTo(0, 0);
        else window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (e) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
      setTimeout(() => {
        updateBackTopButton();
        const button = $("backTopBtn");
        if (button && document.activeElement === button && !isVisibleFocusable(button)) {
          const target = homeUiRoute() === "secondary" ? $("secondaryCatalogBack") : homeFirstTarget();
          if (target) focusRemoteTarget(target);
          else if (button.blur) button.blur();
        }
      }, 260);
    }

    function wrappedFocusable(root, current, delta, selector) {
      if (!root || !current) return null;
      const items = Array.from(root.querySelectorAll(selector || ".focusable,button,input,textarea")).filter(isVisibleFocusable);
      if (!items.length) return null;
      const index = items.indexOf(current);
      if (index < 0) return null;
      return items[(index + delta + items.length) % items.length] || current;
    }

    function firstSearchResultFocusTarget() {
      const section = $("searchSection");
      const rail = $("searchRail");
      if (!section || !rail || section.style.display === "none" || section.hidden || section.getAttribute("aria-hidden") === "true") return null;
      return Array.from(rail.querySelectorAll(".card")).find(isVisibleFocusable) || null;
    }

    function firstSearchHistoryFocusTarget() {
      const section = $("searchHistorySection");
      const rail = $("searchHistoryRail");
      if (!section || !rail || section.hidden || section.getAttribute("aria-hidden") === "true") return null;
      return Array.from(rail.querySelectorAll(".search-history-item")).find(isVisibleFocusable) || null;
    }

    function firstSearchHotFocusTarget() {
      const section = $("searchHotSection");
      const rail = $("searchHotRail");
      if (!section || !rail || section.hidden || !isVisibleFocusable(rail.querySelector(".card"))) return null;
      return Array.from(rail.querySelectorAll(".card")).find(isVisibleFocusable) || null;
    }

    function handleHomeHeroDirectionalKey(key, event) {
      if (!isTvLikeDevice() || focusScopeRoot() !== document || isConnectionPanelOpen() || isSearchSuggestOpen()) return false;
      if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
      const hero = $("homeHero");
      if (state.activeList !== "all" || !hero || document.activeElement !== hero || !isVisibleFocusable(hero)) return false;
      const items = Array.isArray(state.homeV14.heroItems) ? state.homeV14.heroItems : [];
      if (items.length <= 1) return false;
      const delta = key === "ArrowRight" ? 1 : -1;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      setHomeHeroIndex(Number(state.homeV14.heroIndex || 0) + delta, { manual: true });
      return true;
    }

    function installRemoteKeys() {
      document.addEventListener("pointerdown", (event) => {
        const recentDelete = state.recentDelete;
        if (!recentDelete || !(recentDelete.armedKey || recentDelete.pendingKey)) return;
        const card = recentWatchingCard(event.target);
        if (!card || card !== recentDelete.armedCard && card !== recentDelete.pendingCard) cancelRecentDeleteArm();
      }, true);
      document.addEventListener("focusin", (event) => {
        if (isSidebarOpen() && event.target && event.target.closest && event.target.closest("#homeSidebar")) {
          state.homeV14.sidebarFocusId = event.target.dataset && event.target.dataset.sidebarKey || state.homeV14.sidebarFocusId || "";
        }
        const recentDelete = state.recentDelete;
        const trackedCard = recentDelete && (recentDelete.armedCard || recentDelete.pendingCard || recentDelete.remotePressCard);
        if (trackedCard && !trackedCard.contains(document.activeElement)) cancelRecentDeleteArm();
      });
      // Hero -> Detail opens and focuses the Detail primary action on a
      // short timer.  Consume the remainder of the same physical Confirm
      // lifecycle at capture time so its keyup cannot activate that newly
      // focused action.  The guard is released by the matching keyup; its
      // short timer is only a lost-event safety net.
      document.addEventListener("keydown", (event) => {
        consumeHomeHeroConfirmGuard(event);
      }, true);
      document.addEventListener("keyup", (event) => {
        consumeHomeHeroConfirmGuard(event);
      }, true);
      document.addEventListener("keydown", (event) => {
        const key = normalizeRemoteKey(event);
        if (key === "Escape" || key === "Backspace") recordBackDiag(event, "bubble_keydown", { bubbleKeydownObserved: true });
        if (!key) return;
        if (isTvDiagnosticEnabled()) {
          state.tvDiag.key = key;
          state.tvDiag.from = focusDiagnosticLabel(document.activeElement);
          updateTvDiagnostic();
        }
        const el = document.activeElement;
        if (isTvLikeDevice() && isHomeRouteActive() && focusScopeRoot() === document
          && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
          markHomeUserNavigation();
        }
        if (key === "Menu" && handleSidebarMenuKey(event)) return;
        const editing = isTextEditingElement(el);
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key) && state.recentDelete && (state.recentDelete.armedKey || state.recentDelete.pendingKey || state.recentDelete.remotePressLocked)) cancelRecentDeleteArm();
        if (!editing && shouldThrottleRemoteNav(key, event, el)) {
          event.preventDefault();
          return;
        }
        if (key !== "Enter" && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key) && ensureRemoteActiveFocus()) {
          event.preventDefault();
          return;
        }
        if (key === "Enter") {
          const recentCard = recentWatchingCard(el);
          if (consumeRecentCardEnterDown(recentCard, event)) return;
          const blockCard = blockableRecommendCard(el);
          if (consumeBlockCardEnterDown(blockCard, event)) return;
          if (handleConnectionPanelEnterKey(event)) return;
          if (consumeSearchSubmitEnterDown(el, event)) return;
          if (el === $("searchInput") && el.readOnly) {
            event.preventDefault();
            event.stopPropagation();
            if (event.stopImmediatePropagation) event.stopImmediatePropagation();
            enterSearchEditMode("remote_enter", event);
            return;
          }
          if (activateFocusedElement(el, event)) return;
          return;
        }
        if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
          if (handleSidebarDirectionalKey(key, event)) return;
          if (handleHomeHeroDirectionalKey(key, event)) return;
          if (handleSearchSuggestDirectionalKey(key, event)) return;
          if (handleClearSearchDirectionalKey(key, event)) return;
          if (handleSearchFormDirectionalKey(key, event)) return;
          if (handleConnectionPanelDirectionalKey(key, event)) return;
        }
        if ((key === "Escape" || key === "Backspace") && handleConnectionPanelBackKey(event)) return;
        if (editing) {
          if (el === $("searchInput") && el.readOnly && key === "ArrowDown") {
            event.preventDefault();
            el.blur();
            focusInitialHomeNow();
            return;
          }
          if (key === "Escape") {
            event.preventDefault();
            el.blur();
          }
          if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) {
            const target = nearestFocusable(key, el);
            if (!target) return;
            event.preventDefault();
            el.blur();
            focusRemoteTarget(target);
          }
          return;
        }
        if (key === "Escape" || key === "Backspace") {
          if (handleSidebarBackKey(event)) return;
          if (exitBlockSelectMode()) {
            event.preventDefault();
            return;
          }
          if (handleSearchSuggestBackKey(event)) return;
          if (handleConnectionPanelBackKey(event)) return;
          if (handlePanBackKey(event)) return;
          // Detail is an overlay even when its caller route is Search.  Keep
          // it ahead of page-level Search/Secondary handlers so Search Result
          // -> Detail -> Back returns through the existing detail history.
          if ($("detailSheet").classList.contains("active")) { event.preventDefault(); recordBackDiag(event, "history.back", { historyBackCalled: true }); return history.back(); }
          if (handleSecondaryBackKey(event)) return;
          if (handleSearchBackKey(event)) return;
          if ($("syncSheet").classList.contains("active")) { event.preventDefault(); recordBackDiag(event, "history.back", { historyBackCalled: true }); return history.back(); }
          // TV 端：主页处于持久全屏时，首次返回先退出全屏（消费本次返回键）
          if (tvFullscreenActive() && uiSnapshotRoute() === "home") {
            event.preventDefault();
            exitTvFullscreen();
            if (sdk().back) { recordBackDiag(event, "sdk.back", { sdkBackCalled: true }); return sdk().back(); }
            return;
          }
          // 主页（非全屏）：退出 App。优先调用原生 back；
          // 若原生未提供 back，则不拦截本次返回键，交给原生硬件返回去关闭 App，
          // 避免 preventDefault 把退出动作一并吞掉导致“按返回退不出去”。
          if (sdk().back) {
            event.preventDefault();
            recordBackDiag(event, "sdk.back", { sdkBackCalled: true });
            return sdk().back();
          }
          recordBackDiag(event, "native_fallback", { nativeFallbackPossible: true });
          return;
        }
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return;
        if (handlePanDirectionalKey(key, event)) return;
        if (handleDetailDirectionalKey(key, event)) return;
        if (key === "ArrowLeft" && isHomeLeftBoundary(el)) {
          event.preventDefault();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          openSidebar();
          return;
        }
        const target = fastHomeDirectionalTarget(key, el) || nearestFocusable(key);
        if (target) {
          event.preventDefault();
          if (!isPanFocusTarget(target)) state.pan.focusMode = "";
          focusRemoteTarget(target);
        }
      });
      document.addEventListener("keydown", (event) => {
        const key = normalizeRemoteKey(event);
        if (key !== "Escape" && key !== "Backspace") return;
        recordBackDiag(event, "capture_keydown", { captureKeydownObserved: true });
        // 软键盘 Backspace 是删字：正在编辑可输入文本框（非只读）时直接放行，
        // 不当作“返回/清空”，避免删一个字符就收起键盘 / 清空搜索框后回弹。
        // TV 端同步手机端逻辑：物理返回键映射为 Escape，不受影响；这里仅放行输入法删除键。
        if (key === "Backspace") {
          const el = document.activeElement;
          if (el && isTextEditingElement(el) && !el.readOnly) return;
        }
        if (handleSidebarBackKey(event)) return;
        if (isRecentManagePage() && recentManageRuntime().active && handleSecondaryBackKey(event)) return;
        if (state.recentDelete && (state.recentDelete.armedKey || state.recentDelete.pendingKey || state.recentDelete.remotePressLocked)) {
          cancelRecentDeleteArm();
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          return;
        }
        if (state.blocked.selecting) return;
        // 状态面板打开时优先收起并回到状态按钮（面板是最上层浮层，返回键应先关它）。
        // 必须排在搜索/建议返回处理之前：状态按钮本身在搜索表单内，
        // 否则有搜索结果时返回键会先去清空搜索而不是收起面板。
        if (handleConnectionPanelBackKey(event)) return;
        if (handleSearchSuggestBackKey(event)) return;
        if (handlePanBackKey(event)) return;
        if ($("detailSheet") && $("detailSheet").classList.contains("active")) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          recordBackDiag(event, "history.back", { historyBackCalled: true });
          return history.back();
        }
        if (handleSecondaryBackKey(event)) return;
        if (handleSearchBackKey(event)) return;
      }, true);
      document.addEventListener("keyup", (event) => {
        const key = normalizeRemoteKey(event);
        if (key === "Escape" || key === "Backspace") recordBackDiag(event, "keyup", { keyupObserved: true });
      }, true);
      document.addEventListener("keyup", (event) => {
        const key = normalizeRemoteKey(event);
        if (key !== "Enter") return;
        if (handleSearchSubmitEnterUp(event)) return;
        if (handleRecentCardEnterUp(event)) return;
        if (handleBlockCardEnterUp(event)) return;
        clearBlockLongPress();
      }, true);
    }

    function activateFocusedElement(el, event) {
      if (!isVisibleFocusable(el)) return false;
      if (isTextEditingElement(el)) return false;
      // 状态按钮（呼吸灯）有自己的 keydown/keyup（短按开面板、长按进设置）。
      // 这里不要再 click 它，否则 TV 端会出现 keydown 开、keyup 关的“闪一下就没了”。
      if (el === $("connectionToggle")) return false;
      event.preventDefault();
      event.stopPropagation();
      if (state.blocked.longPressFired) {
        state.blocked.longPressFired = false;
        return true;
      }
      const blockCard = blockableRecommendCard(el);
      if (state.blocked.selecting && blockCard) return true;
      const panType = getPanTypeFromElement(el);
      if (panType) {
        selectPanType(panType);
        return true;
      }
      if (el === $("homeHero")) armHomeHeroConfirmGuard(event);
      if (typeof el.click === "function") {
        el.click();
      } else {
        const click = document.createEvent("MouseEvents");
        click.initMouseEvent("click", true, true, window, 1, 0, 0, 0, 0, false, false, false, false, 0, null);
        el.dispatchEvent(click);
      }
      return true;
    }

    function isTextEditingElement(el) {
      if (!el) return false;
      if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
      if (el.tagName !== "INPUT") return false;
      const type = String(el.getAttribute("type") || "text").toLowerCase();
      return !["button", "checkbox", "radio", "submit", "reset", "range", "color"].includes(type);
    }

    function isPanelTextField(el) {
      return !!(el && $("connectionBody") && $("connectionBody").contains(el) && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" && !["button", "checkbox", "radio", "submit", "reset", "range", "color"].includes(String(el.getAttribute("type") || "text").toLowerCase())));
    }

    function enablePanelTextEditing(el) {
      if (!isPanelTextField(el)) return false;
      el.readOnly = false;
      el.classList.add("panel-editing");
      try {
        el.focus({ preventScroll: true });
      } catch (e) {
        el.focus();
      }
      return true;
    }

    function disablePanelTextEditing(el) {
      if (!isPanelTextField(el)) return false;
      el.readOnly = true;
      el.classList.remove("panel-editing");
      return true;
    }

    function disableConnectionTextEditing() {
      const body = $("connectionBody");
      if (!body) return;
      body.querySelectorAll("input,textarea").forEach((el) => {
        if (isPanelTextField(el)) disablePanelTextEditing(el);
      });
    }

    function handleConnectionPanelEnterKey(event) {
      if (!isConnectionPanelOpen()) return false;
      const active = document.activeElement;
      const dock = $("connectionDock");
      const body = $("connectionBody");
      const inDock = !!(active && dock && dock.contains(active));
      const inBody = !!(active && body && body.contains(active));
      if (!active || !inDock && !inBody) return false;
      if (active === $("connectionToggle")) return false;
      if (active.matches && active.matches("input[type='checkbox']")) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        active.click();
        if (!active.dataset || !active.dataset.homeFullscreen) markPanConfigDirty();
        return true;
      }
      if (isPanelTextField(active)) {
        if (active.readOnly) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          enablePanelTextEditing(active);
          return true;
        }
        return false;
      }
      return false;
    }

    function closePanSearchToDetail() {
      const returnTarget = $("panSearchBtn") || detailPrimaryActionButton();
      resetPanSearchState(true);
      if (returnTarget) requestAnimationFrame(() => {
        if (isTvLikeDevice() && isDetailPrimaryAction(returnTarget)) {
          restoreDetailTopAnchor({ reason: "pan_return", target: returnTarget });
        } else {
          focusRemoteTarget(returnTarget);
        }
      });
      scheduleUiSnapshotSave();
      return true;
    }

    function handlePanBackKey(event) {
      const tabs = $("panTabs");
      const list = $("panResultList");
      const detail = $("detailSheet");
      const active = document.activeElement;
      const inResults = !!(tabs && list && active && list.contains(active));
      const inTabs = !!(tabs && active && tabs.contains(active));
      const inActiveDetail = !!(detail && detail.classList.contains("active") && active && detail.contains(active));
      const tvPanEntry = isTvLikeDevice() && isPanSearchActive() && inActiveDetail;
      if (!tabs || !list || !inResults && !inTabs && !tvPanEntry && state.pan.focusMode !== "results") return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      const resultsBack = inResults || !tvPanEntry && state.pan.focusMode === "results";
      if (resultsBack) {
        // Results -> tabs is the first Back step inside the Pan scope.
        focusPanTabFromResults();
        scheduleUiSnapshotSave();
      } else {
        // Tabs / Pan entry -> detail.  Keep the existing Pan reset routine so
        // polling, observers, and temporary result state are cleaned up in the
        // same way as the existing UI close path.
        closePanSearchToDetail();
      }
      return true;
    }

    function handleSecondaryBackKey(event) {
      if (homeUiRoute() !== "secondary") return false;
      const page = $("secondaryCatalog");
      if (!page || page.hidden) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (isRecentManagePage() && recentManageRuntime().active) {
        exitRecentManageMode({ focus: true });
        return true;
      }
      requestCloseSecondaryCatalog();
      return true;
    }

    let _backDiagSeq = 0;

    function backDiagElement(el) {
      if (!el || el === document || el === document.body || el === document.documentElement) return { id: "", tag: "document", className: "" };
      return {
        id: String(el.id || ""),
        tag: String(el.tagName || "").toLowerCase(),
        className: String(el.className || "").slice(0, 180)
      };
    }

    function recordBackDiag(event, phase, patch) {
      if (!isTvDiagnosticEnabled()) return null;
      const key = event ? normalizeRemoteKey(event) : "";
      let diag = event && event.__nostrBackDiag || null;
      const current = state.tvDiag && state.tvDiag.back;
      const isKeydown = !!(event && event.type === "keydown");
      if (!diag && !isKeydown && current && current.normalizedKey === key && Date.now() - Number(current.startedAt || 0) < 3000) diag = current;
      // Every physical keydown starts a new sequence.  The capture and bubble
      // handlers share the event marker, while keyup is joined to the latest
      // sequence for a short bounded window.
      if (!diag) {
        const active = document.activeElement;
        const scope = focusScopeRoot();
        diag = {
          seq: ++_backDiagSeq,
          startedAt: Date.now(),
          eventType: event && event.type || "",
          key: event && event.key || "",
          code: event && event.code || "",
          keyCode: Number(event && event.keyCode || 0),
          which: Number(event && event.which || 0),
          normalizedKey: key,
          route: homeUiRoute(),
          snapshotRoute: uiSnapshotRoute(),
          activeElement: backDiagElement(active),
          activeLabel: focusDiagnosticLabel(active),
          focusScopeRoot: scope === document ? "document" : focusDiagnosticLabel(scope),
          preventDefaultCalled: false,
          defaultPrevented: !!(event && event.defaultPrevented),
          sdkBackCalled: false,
          historyBackCalled: false,
          keydownObserved: isKeydown,
          keyupObserved: !!(event && event.type === "keyup"),
          lastPhase: String(phase || "")
        };
        if (event) {
          try { event.__nostrBackDiag = diag; } catch (e) {}
        }
      } else {
        diag.lastPhase = String(phase || "");
        if (event && event.type === "keyup") diag.keyupObserved = true;
      }
      Object.assign(diag, patch || {});
      diag.defaultPrevented = !!(event && event.defaultPrevented) || !!diag.defaultPrevented;
      diag.preventDefaultCalled = diag.defaultPrevented;
      state.tvDiag.back = diag;
      try { console.debug("[Nostr TV] BACK_DIAG", Object.assign({}, diag)); } catch (e) {}
      updateTvDiagnostic();
      return diag;
    }

    function handleSearchBackKey(event) {
      if (homeUiRoute() === "search") {
        const input = $("searchInput");
        const page = $("searchPage");
        const active = document.activeElement;
        // Let the active editable input/native IME consume its own Back first.
        if (active === input && input && !input.readOnly) return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        if (active === input || active === $("searchPageBack")) requestCloseSearchPage();
        else if (page && page.contains(active) && input) focusRemoteTarget(input);
        else if (input) focusRemoteTarget(input);
        return true;
      }
      return false;
    }

    function handleSearchSuggestBackKey(event) {
      if (!isSearchSuggestOpen()) return false;
      const active = document.activeElement;
      const input = $("searchInput");
      const panel = $("suggestPanel");
      const form = $("searchForm");
      const inSuggest = active && (active === input || panel && panel.contains(active) || form && form.contains(active));
      if (!inSuggest) return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      hideSearchSuggest();
      disableSearchEditing();
      if (input) requestAnimationFrame(() => focusRemoteTarget(input));
      return true;
    }

    function handleSearchSuggestDirectionalKey(key, event) {
      if (!isSearchSuggestOpen() || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return false;
      const input = $("searchInput");
      const panel = $("suggestPanel");
      const form = $("searchForm");
      const active = document.activeElement;
      if (!active || active !== input && !(panel && panel.contains(active)) && !(form && form.contains(active))) return false;
      const items = searchSuggestItems();
      let target = null;
      if (active === input || form && form.contains(active) && !(panel && panel.contains(active))) {
        if (active === input && key === "ArrowRight") return false;
        if (key === "ArrowDown") target = items[0] || input;
        else target = input;
      } else if (panel && panel.contains(active)) {
        const index = items.indexOf(active);
        if (key === "ArrowDown") target = items[Math.min(items.length - 1, index + 1)] || active;
        else if (key === "ArrowUp") target = index <= 0 ? input : items[index - 1];
        else target = active;
      }
      event.preventDefault();
      event.stopPropagation();
      if (target) focusSearchSuggestTarget(target);
      return true;
    }

    function handleSearchFormDirectionalKey(key, event) {
      if (!$("searchForm") || homeUiRoute() !== "search") return false;
      const input = $("searchInput");
      const submit = $("searchForm").querySelector("button[type='submit']") || $("searchSubmitBtn");
      const active = document.activeElement;
      const pageBack = $("searchPageBack");
      const historyClear = $("searchHistoryClear");
      if (active === pageBack || active === historyClear) {
        let target = active;
        if (active === pageBack && key === "ArrowRight" && isVisibleFocusable(historyClear)) target = historyClear;
        else if (active === historyClear && key === "ArrowLeft") target = pageBack || active;
        else if (key === "ArrowDown" && isVisibleFocusable(input)) target = input;
        if (target) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          focusRemoteTarget(target);
          return true;
        }
      }
      if (!active || !$("searchForm").contains(active)) return false;
      if (active === input && input && !input.readOnly && (key === "ArrowLeft" || key === "ArrowRight")) return false;
      let target = null;
      if (key === "ArrowRight" && active === input) target = submit;
      else if (key === "ArrowLeft" && active === submit) target = input;
      else if (key === "ArrowDown") target = firstSearchHistoryFocusTarget() || firstSearchResultFocusTarget() || firstSearchHotFocusTarget() || active;
      else if (key === "ArrowUp") target = pageBack || active;
      if (!target || target === active && key !== "ArrowDown") return false;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      focusRemoteTarget(target);
      return true;
    }
    function handleClearSearchDirectionalKey(key, event) {
      if (!isTvLikeDevice() || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return false;
      const clear = $("clearSearchBtn");
      if (!clear || document.activeElement !== clear) return false;
      let target = null;
      if (key === "ArrowUp") {
        const input = $("searchInput");
        const form = $("searchForm");
        const submit = form && form.querySelector("button[type='submit']") || $("searchSubmitBtn");
        target = [input, submit, $("connectionToggle")].find(isVisibleFocusable) || clear;
      } else {
        target = key === "ArrowDown" ? firstSearchResultFocusTarget() || clear : clear;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      focusRemoteTarget(target);
      return true;
    }

    function isSearchSuggestOpen() {
      const panel = $("suggestPanel");
      return !!(panel && panel.classList.contains("open") && panel.querySelector(".suggest-item"));
    }

    function searchSuggestItems() {
      const panel = $("suggestPanel");
      return panel ? Array.from(panel.querySelectorAll(".suggest-item")).filter(isVisibleFocusable) : [];
    }

    function firstSearchSuggestItem() {
      return searchSuggestItems()[0] || null;
    }

    function focusSearchSuggestTarget(target) {
      if (!target) return;
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        target.focus();
      }
      keepSearchSuggestItemVisible(target);
    }

    function keepSearchSuggestItemVisible(target) {
      const panel = $("suggestPanel");
      if (!panel || !target || !panel.contains(target)) return;
      const itemRect = target.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      const topDelta = itemRect.top - panelRect.top;
      const bottomDelta = itemRect.bottom - panelRect.bottom;
      if (topDelta < 0) panel.scrollTop += topDelta;
      else if (bottomDelta > 0) panel.scrollTop += bottomDelta;
    }

    function handleConnectionPanelBackKey(event) {
      if (!isConnectionPanelOpen()) return false;
      const active = document.activeElement;
      if (isPanelTextField(active) && !active.readOnly) {
        if (normalizeRemoteKey(event) === "Backspace") return false;
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        disablePanelTextEditing(active);
        focusRemoteTarget(active);
        return true;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      if (isTvLikeDevice() && connectionHistoryEntryActive()) {
        try { history.back(); } catch (e) { closeConnectionPanel(); }
      } else {
        closeConnectionPanel();
      }
      return true;
    }

    function handleConnectionPanelDirectionalKey(key, event) {
      if (!isConnectionPanelOpen() || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return false;
      const dock = $("connectionDock");
      const body = $("connectionBody");
      const toggle = $("connectionToggle");
      if (!dock || !body) return false;
      const active = document.activeElement;
      const bodyItems = connectionPanelItems();
      const inDock = active && dock.contains(active);
      const inBody = active && body.contains(active);
      let target = null;
      if (isTvLikeDevice() && inBody && key === "ArrowUp" && isConnectionPanelTopFocusRow(active)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        body.scrollTop = 0;
        return true;
      }
      if (inBody) {
        target = nearestFocusableFromList(key, active, bodyItems);
        if (!target && key === "ArrowUp") target = toggle || bodyItems[0];
        if (!target) target = active;
      } else if (!inDock || active === toggle) {
        target = key === "ArrowDown" ? bodyItems[0] || toggle : toggle || bodyItems[0];
      } else {
        target = bodyItems[0] || toggle;
      }
      event.preventDefault();
      event.stopPropagation();
      if (target) focusRemoteTarget(target);
      return true;
    }

    function restoreConnectionPanelFocus() {
      if (!isConnectionPanelOpen()) return false;
      const dock = $("connectionDock");
      const body = $("connectionBody");
      const active = document.activeElement;
      if (active && ((dock && dock.contains(active)) || (body && body.contains(active))) && isVisibleFocusable(active)) return false;
      const target = $("connectionToggle") || connectionPanelItems()[0];
      if (!target) return false;
      focusRemoteTarget(target);
      return true;
    }

    function isConnectionPanelOpen() {
      const dock = $("connectionDock");
      const body = $("connectionBody");
      return !!(dock && body && dock.classList.contains("open") && body.classList.contains("open"));
    }

    function connectionPanelItems() {
      const body = $("connectionBody");
      return body ? Array.from(body.querySelectorAll(".focusable,button,input,textarea")).filter(isVisibleFocusable) : [];
    }

    function isConnectionPanelTopFocusRow(target) {
      if (!isTvLikeDevice()) return false;
      const body = $("connectionBody");
      if (!body || !target || !body.contains(target) || !target.getBoundingClientRect) return false;
      const first = connectionPanelItems()[0];
      if (!first || !first.getBoundingClientRect) return false;
      const firstRect = first.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (!firstRect.height || !targetRect.height) return false;
      const tolerance = Math.max(8, Math.min(20, Math.max(firstRect.height, targetRect.height) * .45));
      return Math.abs(targetRect.top - firstRect.top) <= tolerance;
    }

    function nearestFocusableFromList(key, current, list) {
      const items = (list || []).filter((item) => item && item !== current && isVisibleFocusable(item));
      if (!current || !items.length) return null;
      const from = center(current.getBoundingClientRect());
      const vertical = key === "ArrowUp" || key === "ArrowDown";
      const forward = key === "ArrowRight" || key === "ArrowDown";
      let best = null;
      let bestScore = Infinity;
      for (const el of items) {
        const to = center(el.getBoundingClientRect());
        const main = vertical ? to.y - from.y : to.x - from.x;
        const cross = vertical ? Math.abs(to.x - from.x) : Math.abs(to.y - from.y);
        if (forward ? main <= 4 : main >= -4) continue;
        const score = Math.abs(main) * 1.25 + cross * 1.9;
        if (score < bestScore) {
          best = el;
          bestScore = score;
        }
      }
      return best;
    }

    function focusPanTabFromResults() {
      const tabs = $("panTabs");
      if (!tabs) return false;
      const target = findByDataset(tabs, "panType", state.pan.activeType) || tabs.querySelector(".chip.active") || tabs.querySelector(".chip");
      if (!target) return false;
      state.pan.focusMode = "tabs";
      focusPanTarget(target);
      return true;
    }

    function handlePanDirectionalKey(key, event) {
      const tabs = $("panTabs");
      const list = $("panResultList");
      const active = document.activeElement;
      if (!tabs || !list || !active) return false;
      const inTabs = tabs.contains(active);
      const inResults = list.contains(active);
      if (!inTabs && !inResults) {
        if ((active === $("detailContinueBtn") || active === $("panSearchBtn") || active === $("detailSearchBtn")) && key === "ArrowDown" && isPanSearchActive()) {
          const target = tabs.querySelector(".chip.active") || tabs.querySelector(".chip") || list.querySelector(".pan-result-item");
          if (target) {
            event.preventDefault();
            state.pan.focusMode = tabs.contains(target) ? "tabs" : "results";
            focusPanTarget(target, { keepBlockPosition: true });
            return true;
          }
        }
        if (isPanSearchActive() && $("detailSheet") && $("detailSheet").contains(active)) {
          const panRect = $("panSearchBlock").getBoundingClientRect();
          const activeRect = active.getBoundingClientRect ? active.getBoundingClientRect() : null;
          if (key === "ArrowDown" && activeRect && activeRect.bottom <= panRect.bottom + 8) {
            event.preventDefault();
            const target = tabs.querySelector(".chip.active") || tabs.querySelector(".chip") || list.querySelector(".pan-result-item");
            if (target) {
              state.pan.focusMode = tabs.contains(target) ? "tabs" : "results";
              focusPanTarget(target, { keepBlockPosition: true });
            } else {
              centerPanSearchBlock();
            }
            return true;
          }
        }
        state.pan.focusMode = "";
        return false;
      }
      let target = null;
      if (inTabs && key === "ArrowDown") target = panResultByColumn(active) || list.querySelector(".pan-result-item");
      else if (inResults && key === "ArrowUp" && isFirstVisiblePanResult(active)) target = findByDataset(tabs, "panType", state.pan.activeType) || tabs.querySelector(".chip.active") || tabs.querySelector(".chip");
      else if (inTabs && (key === "ArrowLeft" || key === "ArrowRight")) target = isTvLikeDevice()
        ? wrappedFocusable(tabs, active, key === "ArrowRight" ? 1 : -1, ".chip") || active
        : siblingFocusable(tabs, active, key === "ArrowRight" ? 1 : -1);
      else if (inResults && (key === "ArrowUp" || key === "ArrowDown")) target = siblingFocusable(list, active, key === "ArrowDown" ? 1 : -1);
      if (!target) {
        if (inTabs && key === "ArrowDown" || inResults && key === "ArrowDown") {
          event.preventDefault();
          centerPanSearchBlock();
          return true;
        }
        return false;
      }
      event.preventDefault();
      if (list.contains(target)) {
        state.pan.focusKey = target.dataset.panKey || state.pan.focusKey;
        state.pan.focusMode = "results";
        focusPanTarget(target, { keepBlockPosition: true });
      } else {
        state.pan.focusMode = "tabs";
        const panType = getPanTypeFromElement(target);
        if (panType && panType !== state.pan.activeType) selectPanType(panType);
        focusPanTarget(target, { keepBlockPosition: true });
      }
      return true;
    }

    function isPanFocusTarget(target) {
      return !!(target && (($("panTabs") && $("panTabs").contains(target)) || ($("panResultList") && $("panResultList").contains(target))));
    }

    function panResultByColumn(tab) {
      const list = $("panResultList");
      const items = list ? Array.from(list.querySelectorAll(".pan-result-item")).filter(isVisibleFocusable) : [];
      if (!items.length) return null;
      const from = center(tab.getBoundingClientRect());
      let best = null;
      let bestScore = Infinity;
      for (const item of items.slice(0, 5)) {
        const rect = item.getBoundingClientRect();
        const to = center(rect);
        if (to.y < from.y - 4) continue;
        const score = Math.abs(to.x - from.x) * 1.15 + Math.max(0, to.y - from.y) * .35;
        if (score < bestScore) {
          best = item;
          bestScore = score;
        }
      }
      return best || items[0];
    }

    function handleDetailDirectionalKey(key, event) {
      const sheet = $("detailSheet");
      const active = document.activeElement;
      if (!sheet || !sheet.classList.contains("active") || !active || !sheet.contains(active)) return false;
      if (isPanSearchActive() && isPanFocusTarget(active)) return false;
      if (key === "ArrowUp" && isTvLikeDevice() && isDetailPrimaryAction(active)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        restoreDetailTopAnchor({ reason: "primary_arrow_up", fromTarget: active, target: active });
        return true;
      }
      if (active === $("closeDetailBtn") && useLargeDetailLayout()) {
        event.preventDefault();
        event.stopPropagation();
        focusRemoteTarget(detailPrimaryActionButton() || $("panSearchBtn"));
        return true;
      }
      const currentBlock = detailFocusBlock(active);
      if (!currentBlock) return false;
      let target = null;
      if (key === "ArrowLeft" || key === "ArrowRight") target = detailHorizontalTarget(currentBlock, active, key === "ArrowRight" ? 1 : -1);
      else target = detailVerticalTarget(currentBlock, active, key === "ArrowDown" ? 1 : -1);
      if (!target && isTvLikeDevice() && (key === "ArrowLeft" || key === "ArrowRight")) {
        const row = active.closest && active.closest("#castRail, #personWorkRail, #recommendWorkRail, #panTabs, .actions");
        if (row) {
          event.preventDefault();
          event.stopPropagation();
          if (event.stopImmediatePropagation) event.stopImmediatePropagation();
          revealFocusedTarget(active);
          updateTvDiagnostic();
          return true;
        }
      }
      if (!target && isTvLikeDevice() && (key === "ArrowUp" || key === "ArrowDown")) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        revealFocusedTarget(active);
        updateTvDiagnostic();
        return true;
      }
      if (!target) return false;
      event.preventDefault();
      event.stopPropagation();
      state.pan.focusMode = "";
      if (key === "ArrowUp" && isTvLikeDevice() && isDetailPrimaryAction(target)) {
        restoreDetailTopAnchor({ reason: "focus_return_from_below", fromTarget: active, target });
        return true;
      }
      focusRemoteTarget(target);
      return true;
    }

    function detailFocusBlock(el) {
      if (el === $("closeDetailBtn")) return useLargeDetailLayout() ? null : { id: "closeDetailBtn", root: $("closeDetailBtn") };
      if (el === $("detailMoreBtn")) return { id: "detailInfo", root: el.closest(".detail-info") };
      if (el === $("detailContinueBtn") || el === $("detailSearchBtn") || el === $("panSearchBtn")) return { id: "detailActions", root: el.closest(".actions") };
      const ids = ["panSearchBlock", "castBlock", "personWorkBlock", "recommendBlock"];
      for (const id of ids) {
        const root = $(id);
        if (root && root.contains(el)) return { id, root };
      }
      return null;
    }

    function detailBlockOrderIds() {
      return ["panSearchBlock", "castBlock", "personWorkBlock", "recommendBlock"];
    }

    function detailBlockOrder() {
      const order = [];
      if (!useLargeDetailLayout() && isVisibleFocusable($("closeDetailBtn"))) order.push({ id: "closeDetailBtn", root: $("closeDetailBtn") });
      const info = $("detailMoreBtn") && $("detailMoreBtn").closest(".detail-info");
      if (info && detailBlockFocusables(info).length) order.push({ id: "detailInfo", root: info });
      const actions = $("detailSearchBtn") && $("detailSearchBtn").closest(".actions");
      if (actions && detailBlockFocusables(actions).length) order.push({ id: "detailActions", root: actions });
      detailBlockOrderIds().forEach((id) => {
        const root = $(id);
        if (root && root.style.display !== "none" && root.getAttribute("aria-hidden") !== "true" && detailBlockFocusables(root).length) order.push({ id, root });
      });
      return order;
    }

    function detailVerticalTarget(currentBlock, active, delta) {
      const order = detailBlockOrder();
      const index = order.findIndex((block) => block.id === currentBlock.id);
      if (index < 0) return null;
      const blocks = delta > 0 ? order.slice(index + 1) : order.slice(0, index).reverse();
      for (const block of blocks) {
        const target = detailClosestInBlock(block.root, active, delta);
        if (target) return target;
      }
      return null;
    }

    function detailHorizontalTarget(currentBlock, active, delta) {
      const row = active && active.closest && active.closest("#castRail, #personWorkRail, #recommendWorkRail, #panTabs, .actions");
      const items = detailBlockFocusables(row || currentBlock.root);
      const index = items.indexOf(active);
      if (index < 0) return null;
      return items[index + delta] || null;
    }

    function detailClosestInBlock(root, active, delta) {
      const items = detailBlockFocusables(root);
      if (!items.length) return null;
      if (!active || !active.getBoundingClientRect) return delta > 0 ? items[0] : items[items.length - 1];
      const from = center(active.getBoundingClientRect());
      let best = null;
      let bestScore = Infinity;
      for (const item of items) {
        const rect = item.getBoundingClientRect();
        const to = center(rect);
        const vertical = Math.max(0, delta > 0 ? rect.top - from.y : from.y - rect.bottom);
        const cross = Math.abs(to.x - from.x);
        const score = vertical * 1.1 + cross * 1.5;
        if (score < bestScore) {
          best = item;
          bestScore = score;
        }
      }
      return best || (delta > 0 ? items[0] : items[items.length - 1]);
    }

    function detailBlockFocusables(root) {
      if (!root) return [];
      if (root.matches && root.matches(".focusable,button,input,textarea")) return isVisibleFocusable(root) ? [root] : [];
      return Array.from(root.querySelectorAll(".focusable,button,input,textarea")).filter(isVisibleFocusable);
    }

    function isFirstVisiblePanResult(el) {
      const list = $("panResultList");
      if (!list || !list.contains(el)) return false;
      let item = list.firstElementChild;
      while (item) {
        if (item.classList && item.classList.contains("pan-result-item") && isVisibleFocusable(item)) return item === el;
        item = item.nextElementSibling;
      }
      return false;
    }

    function siblingFocusable(root, current, delta) {
      if (!root || !current) return null;
      if (root.id === "panResultList" && current.classList && current.classList.contains("pan-result-item")) {
        let target = delta > 0 ? current.nextElementSibling : current.previousElementSibling;
        while (target) {
          if (target.classList && target.classList.contains("pan-result-item") && isVisibleFocusable(target)) return target;
          target = delta > 0 ? target.nextElementSibling : target.previousElementSibling;
        }
        return null;
      }
      const items = Array.from(root.querySelectorAll(".focusable,button,input,textarea")).filter(isVisibleFocusable);
      const index = items.indexOf(current);
      if (index < 0) return null;
      return items[index + delta] || null;
    }

    function normalizeRemoteKey(event) {
      if (["Enter", "Escape", "Backspace", "BrowserBack", "GoBack", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Menu", "ContextMenu"].includes(event.key)) return event.key === "BrowserBack" || event.key === "GoBack" ? "Escape" : event.key === "ContextMenu" ? "Menu" : event.key;
      const map = { 13: "Enter", 23: "Enter", 66: "Enter", 4: "Escape", 8: "Backspace", 27: "Escape", 82: "Menu", 10009: "Escape", 461: "Escape", 19: "ArrowUp", 20: "ArrowDown", 21: "ArrowLeft", 22: "ArrowRight" };
      return map[event.keyCode || event.which] || "";
    }

    function shouldThrottleRemoteNav(key, event, active) {
      if (!isTvLikeDevice() || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return false;
      if (focusScopeRoot() !== document || isConnectionPanelOpen() || isSearchSuggestOpen()) return false;
      if ($("searchForm") && active && $("searchForm").contains(active)) return false;
      const now = window.performance && performance.now ? performance.now() : Date.now();
      const gate = state.remoteKeyGate || { key: "", at: 0 };
      const minGap = gate.key === key ? 56 : 38;
      if (gate.at && now - gate.at < minGap) return true;
      state.remoteKeyGate = { key, at: now };
      return false;
    }

    function visibleBackTopTarget() {
      const target = $("backTopBtn");
      return isVisibleFocusable(target) ? target : null;
    }

    function homeRailSections() {
      const home = $("home");
      if (!home || !isHomeRouteActive()) return [];
      return Array.from(home.querySelectorAll("#homeRecentSection, #recommendSection, #listStack > .home-dynamic-section")).filter((section) => !section.hidden && !section.closest("[hidden]"));
    }

    function homeRailContextForTarget(target) {
      if (!isTvLikeDevice() || !isHomeRouteActive() || isSidebarOpen() || !target || !target.closest) return null;
      const home = $("home");
      if (!home || !home.contains(target)) return null;
      const section = target.closest(".home-section");
      if (!section || section.hidden || section.closest("[hidden]")) return null;
      const rail = section.querySelector(".home-rail");
      if (!rail) return null;
      return {
        key: String(rail.dataset.railKey || rail.dataset.homeListId || rail.id || section.id || ""),
        section,
        rail,
        head: section.querySelector(".home-section-head")
      };
    }

    function homeSectionCards(section) {
      return section ? Array.from(section.querySelectorAll(".home-rail > .card")).filter((card) => !card.classList.contains("home-more-card") && canFastHomeFocus(card)) : [];
    }

    function rememberBackTopFocusOrigin(target) {
      const button = visibleBackTopTarget();
      if (!button || !target) return null;
      button.__focusOrigin = {
        route: homeUiRoute(),
        listId: state.homeV14 && state.homeV14.secondaryListId || "",
        target,
        mediaKey: String(target.dataset && target.dataset.mediaKey || target.__mediaItem && mediaDomKey(target.__mediaItem) || "")
      };
      return button;
    }

    function resolveBackTopFocusOrigin(button) {
      const origin = button && button.__focusOrigin;
      if (!origin || origin.route !== homeUiRoute()) return null;
      if (origin.route === "secondary" && origin.listId !== String(state.homeV14 && state.homeV14.secondaryListId || "")) return null;
      if (origin.target && document.contains(origin.target) && isVisibleFocusable(origin.target)) return origin.target;
      if (!origin.mediaKey) return null;
      if (origin.route === "secondary") {
        const grid = $("secondaryCatalogGrid");
        const weekly = !!(grid && grid.classList.contains("weekly-secondary-rail"));
        const cards = weekly ? weeklySecondaryFocusableCards(grid) : grid ? Array.from(grid.querySelectorAll(".card")).filter(canFastHomeFocus) : [];
        return cards.find((card) => String(card.dataset && card.dataset.mediaKey || card.__mediaItem && mediaDomKey(card.__mediaItem) || "") === origin.mediaKey) || null;
      }
      const sections = homeRailSections();
      for (const section of sections) {
        const cards = homeSectionCards(section);
        const target = cards.find((card) => String(card.dataset && card.dataset.mediaKey || card.__mediaItem && mediaDomKey(card.__mediaItem) || "") === origin.mediaKey);
        if (target) return target;
      }
      return null;
    }

    function homeFirstTarget() {
      for (const section of homeRailSections()) {
        const cards = homeSectionCards(section);
        if (cards.length) return cards[0];
        const more = section.querySelector(".home-section-more");
        if (isVisibleFocusable(more)) return more;
      }
      return $("homeHero") && isVisibleFocusable($("homeHero")) ? $("homeHero") : currentHomeFocus();
    }

    function homeTarget(key, active) {
      if (!isTvLikeDevice() || !isHomeRouteActive() || focusScopeRoot() !== document) return null;
      const home = $("home");
      if (!home || !active) return null;
      const searchLauncher = $("homeSearchLauncher");
      const hero = $("homeHero");
      const backTop = $("backTopBtn");
      if (active === backTop) {
        if (key === "ArrowUp" || key === "ArrowLeft") {
          const origin = resolveBackTopFocusOrigin(backTop);
          if (origin) return origin;
          const sections = homeRailSections();
          for (let index = sections.length - 1; index >= 0; index--) {
            const cards = homeSectionCards(sections[index]);
            if (cards.length) return cards[cards.length - 1];
          }
          return isVisibleFocusable(hero) ? hero : active;
        }
        return active;
      }
      if (active === searchLauncher) {
        if (key === "ArrowDown") return isVisibleFocusable(hero) ? hero : homeFirstTarget() || active;
        if (key === "ArrowUp" || key === "ArrowLeft" || key === "ArrowRight") return active;
        return null;
      }
      if (active === hero) {
        if (key === "ArrowUp") return isVisibleFocusable(searchLauncher) ? searchLauncher : active;
        if (key === "ArrowDown") {
          const target = homeFirstTarget() || active;
          if (target !== active && target.closest && target.closest(".home-section")) state.homeV14.homeSectionEntryTarget = target;
          return target;
        }
        if (key === "ArrowLeft" || key === "ArrowRight") return active;
        return null;
      }
      const more = active.closest && active.closest(".home-section-more");
      const section = active.closest && active.closest(".home-section");
      if (!section) return null;
      const sections = homeRailSections();
      const sectionIndex = sections.indexOf(section);
      const currentCards = homeSectionCards(section);
      const ownMore = section.querySelector && section.querySelector(".home-section-more");
      const railMore = section.querySelector && section.querySelector(".home-rail > .home-more-card");
      if (more) {
        if (key === "ArrowUp") {
          for (let previous = sectionIndex - 1; previous >= 0; previous--) {
            const previousCards = homeSectionCards(sections[previous]);
            if (previousCards.length) return previousCards[0];
          }
          return isVisibleFocusable(hero) ? hero : more;
        }
        if (key === "ArrowDown") {
          for (let next = sectionIndex + 1; next < sections.length; next++) {
            const nextCards = homeSectionCards(sections[next]);
            if (nextCards.length) return nextCards[0];
          }
          return rememberBackTopFocusOrigin(more) || more;
        }
        if (key === "ArrowLeft") return isVisibleFocusable(railMore) ? railMore : currentCards[currentCards.length - 1] || more;
        if (key === "ArrowRight") return more;
        return null;
      }
      const rail = active.closest && active.closest(".home-rail");
      if (!rail || !active.classList.contains("card")) return null;
      const cards = Array.from(rail.children).filter((child) => child.classList && child.classList.contains("card") && canFastHomeFocus(child));
      const index = cards.indexOf(active);
      if (index < 0) return active;
      if (key === "ArrowLeft") return cards[index - 1] || active;
      if (key === "ArrowRight") {
        if (cards[index + 1]) return cards[index + 1];
        if (isVisibleFocusable(ownMore)) return ownMore;
        return rememberBackTopFocusOrigin(active) || active;
      }
      if (key === "ArrowDown") {
        for (let next = sectionIndex + 1; next < sections.length; next++) {
          const nextCards = homeSectionCards(sections[next]);
          if (nextCards.length) return nextCards[Math.min(index, nextCards.length - 1)];
          const nextMore = sections[next].querySelector(".home-section-more");
          if (isVisibleFocusable(nextMore)) return nextMore;
        }
        return rememberBackTopFocusOrigin(active) || active;
      }
      if (key === "ArrowUp") {
        for (let previous = sectionIndex - 1; previous >= 0; previous--) {
          const previousCards = homeSectionCards(sections[previous]);
          if (previousCards.length) return previousCards[Math.min(index, previousCards.length - 1)];
          const previousMore = sections[previous].querySelector(".home-section-more");
          if (isVisibleFocusable(previousMore)) return previousMore;
        }
        return isVisibleFocusable(hero) ? hero : currentHomeFocus() || active;
      }
      return null;
    }

    function secondaryCatalogDirectionalTarget(key, active) {
      if (homeUiRoute() !== "secondary" || !active || key.indexOf("Arrow") !== 0) return null;
      const back = $("secondaryCatalogBack"), host = $("secondaryCatalogFilters"), grid = $("secondaryCatalogGrid"), rows = host ? Array.from(host.querySelectorAll(".secondary-filter-row")) : [];
      const buttons = (row) => row ? Array.from(row.querySelectorAll(".secondary-filter-option")).filter(canFastHomeFocus) : [];
      const weeklySecondary = !!(grid && state.homeV14 && state.homeV14.secondaryListId === "now-playing" || grid && grid.classList.contains("weekly-secondary-rail"));
      const cards = weeklySecondary
        ? weeklySecondaryFocusableCards(grid)
        : grid ? Array.from(grid.querySelectorAll(".card")).filter(canFastHomeFocus) : [];
      const firstCard = cards[0] || null;
      const backTop = visibleBackTopTarget();
      const recentHeaderItems = state.homeV14 && state.homeV14.secondaryListId === "recent"
        ? [
          back,
          recentManageRuntime().active ? $("recentManageSelectAll") : $("recentManageBtn"),
          recentManageRuntime().active ? $("recentManageDelete") : null,
          recentManageRuntime().active ? $("recentManageCancel") : null
        ].filter(canFastHomeFocus)
        : [];
      if (recentHeaderItems.length && recentHeaderItems.indexOf(active) >= 0) {
        const headerIndex = recentHeaderItems.indexOf(active);
        if (key === "ArrowLeft" || key === "ArrowRight") {
          const target = recentHeaderItems[headerIndex + (key === "ArrowRight" ? 1 : -1)];
          return target || active;
        }
        if (key === "ArrowDown") return firstCard || active;
        if (key === "ArrowUp") return headerIndex > 0 ? recentHeaderItems[headerIndex - 1] : active;
        return active;
      }
      if (active === backTop) {
        if (key === "ArrowUp" || key === "ArrowLeft") return resolveBackTopFocusOrigin(backTop) || cards[cards.length - 1] || back || active;
        return active;
      }
      if (active === back) {
        if (weeklySecondary) return key === "ArrowDown" ? firstCard || active : active;
        if (key === "ArrowDown") return rows.length ? secondaryFilterFocusTarget(rows[0], back.getBoundingClientRect().left) || firstCard || active : firstCard || active;
        return active;
      }
      const row = active.closest && active.closest(".secondary-filter-row");
      if (row) {
        const list = buttons(row), index = list.indexOf(active), rowIndex = rows.indexOf(row);
        if (index < 0) return active;
        if (key === "ArrowLeft" || key === "ArrowRight") return list[index + (key === "ArrowRight" ? 1 : -1)] || active;
        if (key === "ArrowUp") {
          const previous = rows[rowIndex - 1];
          return previous ? secondaryFilterFocusTarget(previous, active.getBoundingClientRect().left) || active : back || active;
        }
        if (key === "ArrowDown") {
          const next = rows[rowIndex + 1];
          if (next) return secondaryFilterFocusTarget(next, active.getBoundingClientRect().left) || active;
          return firstCard || active;
        }
        return active;
      }
      if (grid && grid.contains(active) && active.classList && active.classList.contains("card")) {
        if (weeklySecondary && active.classList.contains("weekly-card")) {
          const index = cards.indexOf(active);
          if (key === "ArrowLeft") return cards[index - 1] || active;
          if (key === "ArrowRight") return cards[index + 1] || (index === cards.length - 1 ? rememberBackTopFocusOrigin(active) || active : active);
          if (key === "ArrowUp") return back || active;
          return active;
        }
        const index = cards.indexOf(active), columns = Math.max(1, gridColumns(grid)), rowIndex = index >= 0 ? Math.floor(index / columns) : 0;
        if (index < 0) return active;
        if (key === "ArrowLeft") return index % columns > 0 ? cards[index - 1] : active;
        if (key === "ArrowRight") {
          const next = cards[index + 1];
          if (index % columns < columns - 1 && next) return next;
          return rememberBackTopFocusOrigin(active) || active;
        }
        if (key === "ArrowUp") {
          if (rowIndex > 0) return cards[index - columns] || cards[Math.max(0, index - 1)] || active;
          if (recentHeaderItems.length) return recentHeaderItems[1] || recentHeaderItems[0] || active;
          const lastRow = rows[rows.length - 1];
          return lastRow ? secondaryFilterFocusTarget(lastRow, active.getBoundingClientRect().left) || back || active : back || active;
        }
        if (key === "ArrowDown") {
          const next = cards[index + columns];
          if (next) return next;
          const canLoadMore = secondaryCanLoadMore();
          if (canLoadMore) {
            secondaryLoadNextPage();
            return active;
          }
          return rememberBackTopFocusOrigin(active) || active;
        }
      }
      return null;
    }

    function fastHomeDirectionalTarget(key, active) {
      if (!isTvLikeDevice() || focusScopeRoot() !== document || isConnectionPanelOpen() || isSearchSuggestOpen()) return null;
      if (!active || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(key)) return null;
      if (isTextEditingElement(active)) return null;
      if ($("connectionDock") && $("connectionDock").contains(active)) return null;
      if ($("searchForm") && $("searchForm").contains(active)) return null;
      return secondaryCatalogDirectionalTarget(key, active)
        || homeTarget(key, active)
        || fastHomeGridTarget(key, active)
        || fastHomeSearchRailTarget(key, active)
        || fastHomeLiveEntryTarget(key, active);
    }

    function fastHomeGridTarget(key, active) {
      const card = active && active.classList && active.classList.contains("card") ? active : null;
      const grid = card && card.closest && card.closest(".media-grid");
      if (!grid || grid.closest && grid.closest(".list-panel[hidden]")) return null;
      if (grid !== activeMediaGrid()) return null;
      let index = Number(card.dataset.cardIndex || -1);
      if (!Number.isFinite(index) || index < 0) index = Array.prototype.indexOf.call(grid.children, card);
      if (index < 0) return null;
      const columns = Math.max(1, gridColumns(grid));
      const count = grid.children.length;
      let targetIndex = -1;
      if (key === "ArrowLeft" && index % columns > 0) targetIndex = index - 1;
      else if (key === "ArrowRight" && index % columns < columns - 1) targetIndex = index + 1;
      else if (key === "ArrowUp") targetIndex = index - columns;
      else if (key === "ArrowDown") targetIndex = index + columns;
      if (targetIndex >= 0 && targetIndex < count) return homeGridCardAt(grid, targetIndex);
      if (key === "ArrowDown" && targetIndex >= count && appendGridBatch(grid)) {
        observeInfiniteScroll();
        return homeGridCardAt(grid, targetIndex);
      }
      if (key === "ArrowUp" && index < columns) return currentHomeFocus() || active;
      if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowDown" || key === "ArrowUp") return active;
      return null;
    }

    function fastHomeSearchRailTarget(key, active) {
      const rail = active && active.closest && active.closest("#searchRail, #searchHotRail, #searchHistoryRail");
      if (!rail || !rail.contains(active)) return null;
      if (key === "ArrowLeft" || key === "ArrowRight") {
        const selector = rail.id === "searchHistoryRail" ? ".search-history-item" : ".card";
        return fastHomeSibling(rail, active, key === "ArrowRight" ? 1 : -1, selector) || active;
      }
      if (key === "ArrowDown" && rail.id === "searchHistoryRail") return firstSearchHotFocusTarget() || active;
      if (key === "ArrowUp" && rail.id === "searchHistoryRail") return isVisibleFocusable($("searchInput")) ? $("searchInput") : active;
      if (key === "ArrowUp" && rail.id === "searchHotRail") return isVisibleFocusable($("searchInput")) ? $("searchInput") : active;
      if (key === "ArrowUp") return isVisibleFocusable($("clearSearchBtn")) ? $("clearSearchBtn") : active;
      return null;
    }

    function fastHomeLiveEntryTarget(key, active) {
      const live = active && active.closest && active.closest(".live-entry-card");
      if (!live || !live.contains(active) && live !== active) return null;
      if (key === "ArrowUp") return currentHomeFocus() || live;
      if (key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight") return live;
      return null;
    }

    function homeGridCardAt(grid, index) {
      const target = grid && index >= 0 ? grid.children[index] : null;
      return target && target.classList && target.classList.contains("card") && canFastHomeFocus(target) ? target : null;
    }

    function fastHomeSibling(root, current, delta, selector) {
      let target = delta > 0 ? current.nextElementSibling : current.previousElementSibling;
      while (target && root.contains(target)) {
        if (target.matches && target.matches(selector) && canFastHomeFocus(target)) return target;
        target = delta > 0 ? target.nextElementSibling : target.previousElementSibling;
      }
      return null;
    }

    function canFastHomeFocus(el) {
      return !!(el && el.matches && el.matches(".focusable,button,input,textarea") && !el.disabled && el.getAttribute("tabindex") !== "-1" && !el.hidden && !el.closest("[hidden]") && !el.closest('[aria-hidden="true"]'));
    }

    function syncFocusedCardHalo(target) {
      const previous = document.querySelectorAll(".focus-halo-edge-left, .focus-halo-edge-right, .focus-halo-edge-both");
      Array.from(previous).forEach((card) => card.classList.remove("focus-halo-edge-left", "focus-halo-edge-right", "focus-halo-edge-both"));
      if (!isTvLikeDevice() || !target || !target.closest) return;
      const card = target.closest(".card, .person-card");
      const container = card && card.closest(".home-rail, .rail, .media-grid");
      if (!card || !container) return;
      const cards = Array.from(container.children || []).filter((item) => item.matches && item.matches(".card, .person-card"));
      const index = cards.indexOf(card);
      if (index < 0) return;
      let columns = 1;
      const isGrid = container.classList.contains("media-grid");
      if (isGrid) {
        try { columns = Math.max(1, Number(gridColumns(container)) || 1); } catch (e) { columns = 1; }
      }
      const leftEdge = index === 0 || isGrid && index % columns === 0;
      const rightEdge = index === cards.length - 1 || isGrid && index % columns === columns - 1;
      if (leftEdge) card.classList.add("focus-halo-edge-left");
      if (rightEdge) card.classList.add("focus-halo-edge-right");
      if (leftEdge && rightEdge) card.classList.add("focus-halo-edge-both");
    }

    document.addEventListener("focusin", (event) => {
      syncDetailPlaybackStatusVisibility(event.target);
      syncFocusedCardHalo(event.target);
    }, true);

    function focusRemoteTarget(target, options) {
      if (!target) return;
      const home = state.homeV14;
      const previous = document.activeElement;
      const heroSectionEntry = previous === $("homeHero") && isHomeRouteActive() && target.closest && target.closest(".home-section");
      const sectionEntry = !!((home && home.homeSectionEntryTarget === target) || heroSectionEntry);
      if (sectionEntry) home.homeSectionEntryTarget = null;
      const focusOptions = Object.assign({}, options || {}, sectionEntry ? { alignHomeSectionHead: true } : {});
      try {
        target.focus({ preventScroll: true });
      } catch (e) {
        target.focus();
      }
      syncDetailPlaybackStatusVisibility(target);
      syncFocusedCardHalo(target);
      if (isTvDiagnosticEnabled()) {
        state.tvDiag.from = focusDiagnosticLabel(previous);
        state.tvDiag.to = focusDiagnosticLabel(target);
        state.tvDiag.scope = focusDiagnosticScope(target);
        state.tvDiag.scrollScope = focusDiagnosticScrollScope(target);
        state.tvDiag.activeRail = focusDiagnosticRail(target);
        state.tvDiag.revealDeltaX = 0;
        state.tvDiag.revealDeltaY = 0;
        updateTvDiagnostic();
      }
      maybeAppendGridForFocus(target);
      scheduleFocusInView(target, focusOptions);
    }
    function scheduleFocusInView(target, options) {
      state.focusScrollTarget = target;
      state.focusScrollOptions = options || null;
      if (state.focusScrollTimer) return;
      state.focusScrollTimer = requestAnimationFrame(() => {
        const target = state.focusScrollTarget;
        const options = state.focusScrollOptions;
        state.focusScrollTimer = 0;
        state.focusScrollTarget = null;
        state.focusScrollOptions = null;
        const liveTarget = document.activeElement && document.activeElement.isConnected ? document.activeElement : target;
        if (liveTarget && liveTarget.isConnected) {
          syncFocusedCardHalo(liveTarget);
          keepFocusInView(liveTarget, options);
        }
      });
    }

    function focusDiagnosticLabel(el) {
      if (!el || el === document.body || el === document.documentElement) return "document";
      if (el.id) return "#" + el.id;
      const chip = el.closest && el.closest(".chip");
      if (chip) return "chip:" + (chip.dataset.chipId || chip.id || "");
      const card = el.closest && el.closest(".card,.person-card,.pan-result-item,.live-entry-card");
      if (card) return (card.className || "focusable").split(/\s+/)[0] + ":" + (card.dataset.mediaKey || card.dataset.episodeNumber || card.dataset.panKey || card.dataset.cardIndex || "");
      return (el.tagName || "element").toLowerCase() + (el.className ? "." + String(el.className).split(/\s+/)[0] : "");
    }

    function focusDiagnosticScope(el) {
      if (!el) return "";
      if (el.closest && el.closest("#homeSidebar")) return "SIDEBAR";
      if (el.closest && el.closest("#panTabs, #panResultList")) return "PAN_RESULTS";
      if (el.closest && el.closest("#detailSheet")) return "DETAIL";
      if (el.closest && el.closest("#searchForm")) return "SEARCH";
      if (el.closest && el.closest("#syncSheet, #connectionBody, #suggestPanel")) return "OVERLAY";
      if (el.closest && el.closest(".media-grid, #searchRail")) return "HOME_GRID";
      return "HOME";
    }

    function focusDiagnosticScrollScope(el) {
      if (!el) return "";
      if (el.closest && el.closest("#homeSidebar")) return "SIDEBAR";
      if (el.closest && el.closest("#syncSheet, #connectionBody, #suggestPanel")) return "OVERLAY";
      if (el.closest && el.closest("#panResultList")) return "PAN_RESULTS";
      if (el.closest && el.closest(".rail, #panTabs")) return "HORIZONTAL_RAIL";
      if (el.closest && el.closest("#detailSheet")) return "DETAIL";
      return "HOME";
    }

    function focusDiagnosticRail(el) {
      if (!el || !el.closest) return "";
      const rail = el.closest(".rail");
      return rail ? (rail.id || rail.dataset.listId || rail.className || "rail") : "";
    }

    function tvDiagnosticTestSummary() {
      const tests = Array.isArray(state.tvDiag.tests) ? state.tvDiag.tests : [];
      if (!tests.length) return "pending";
      const staticChecks = tests.filter((item) => item.kind === "STATIC_HOOK");
      const domAssertions = tests.filter((item) => item.kind === "DOM_ASSERTION");
      const runtimeRequired = tests.filter((item) => item.kind === "RUNTIME_REQUIRED");
      const legacyWarnings = tests.filter((item) => item.kind === "LEGACY_WARNING");
      const passed = (items) => `${items.filter((item) => item.pass === true).length}/${items.length}`;
      return [
        `STATIC_HOOK: ${passed(staticChecks)}`,
        `DOM_ASSERTION: ${passed(domAssertions)}`,
        `LEGACY_WARNING: ${legacyWarnings.length ? legacyWarnings.length : "none"}`,
        `RUNTIME_REQUIRED: ${runtimeRequired.length ? "NOT_RUN" : "none"}`
      ].join(" | ");
    }

    function updateTvDiagnostic() {
      if (!isTvDiagnosticEnabled()) return;
      const panel = $("tvDiagnostic");
      const output = $("tvDiagnosticText");
      if (!panel || !output) return;
      panel.hidden = false;
      panel.setAttribute("aria-hidden", "false");
      const active = document.activeElement;
      const detail = $("detailSheet");
      const rail = active && active.closest && active.closest(".rail, .chips");
      const activeScope = focusDiagnosticScope(active);
      const activeScrollScope = focusDiagnosticScrollScope(active);
      const activeRail = rail ? (rail.id || rail.dataset.listId || "rail") : "";
      const root = document.documentElement;
      const panDiag = state.tvDiag.panDirectPlay;
      const requestDiag = state.tvDiag.panSearchRequest;
      const sessionDiag = state.tvDiag.panSearchSession;
      const recoveryDiag = state.tvDiag.panForegroundRecovery;
      const handoffDiag = state.tvDiag.panForegroundHandoff;
      const directStatusDiag = state.tvDiag.directPlayStatus;
      const detailRaceDiag = state.tvDiag.detailRace;
      const directSessionDiag = state.tvDiag.directPlaySession;
      const foregroundSessionDiag = state.tvDiag.foregroundSession;
      const topAnchorDiag = state.tvDiag.detailTopAnchor;
      const historyCompatDiag = state.tvDiag.historyCompat;
      const historyItemDiag = state.tvDiag.historyItem;
      const nativeDeleteDiag = state.tvDiag.nativeHistoryDelete;
      const nativeDeleteProbeDiag = state.tvDiag.nativeHistoryDeleteProbe;
      const nativeProgressDiag = state.tvDiag.nativeHistoryProgress;
      const searchImeDiag = state.tvDiag.searchIme;
      const homeV14Diag = state.tvDiag.homeV14;
      const backDiag = state.tvDiag.back;
      const lines = [
        "deviceMode: " + (state.deviceMode || "unknown"),
        "nativeLeanback: " + (isNativeLeanbackClient() ? "yes" : "no"),
        "tvMode: " + (isTvMode() ? "yes" : "no"),
        "previewMode: " + (isTvPreviewMode() ? "yes" : "no"),
        "active: " + focusDiagnosticLabel(active),
        "scope: " + activeScope,
        "focused chip: " + (active && active.dataset && active.dataset.chipId || ""),
        "scroll scope: " + activeScrollScope,
        "window scrollY: " + Math.round(window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0),
        "detailSheet.scrollTop: " + (detail ? Math.round(detail.scrollTop || 0) : 0),
        "active rail: " + activeRail,
        "rail.scrollLeft: " + (rail ? Math.round(rail.scrollLeft || 0) : 0),
        "KEY: " + (state.tvDiag.key || ""),
        "FROM: " + (state.tvDiag.from || ""),
        "TO: " + (state.tvDiag.to || ""),
        "REVEAL_DELTA_X: " + Math.round(state.tvDiag.revealDeltaX || 0),
        "REVEAL_DELTA_Y: " + Math.round(state.tvDiag.revealDeltaY || 0),
        "detail top anchor: " + (topAnchorDiag ? [
          topAnchorDiag.reason || "",
          "from=" + (topAnchorDiag.fromTargetId || ""),
          "to=" + (topAnchorDiag.toTargetId || ""),
          "before=" + Number(topAnchorDiag.scrollTopBefore || 0),
          "after=" + Number(topAnchorDiag.scrollTopAfter || 0)
        ].filter(Boolean).join(" ") : "none"),
        "direct status: " + (directStatusDiag ? [
          "action=" + Number(directStatusDiag.actionId || 0),
          directStatusDiag.phase || "",
          directStatusDiag.visible ? "visible" : "hidden",
          directStatusDiag.textKey || "",
          "elapsed=" + Number(directStatusDiag.elapsedMs || 0) + "ms",
          directStatusDiag.reason || ""
        ].filter(Boolean).join(" ") : "none"),
        "detail race: " + (detailRaceDiag ? [
          detailRaceDiag.event || "",
          detailRaceDiag.provider || detailRaceDiag.lateProvider || "",
          detailRaceDiag.identityVerdict || "",
          detailRaceDiag.candidateLabel || "",
          "elapsed=" + Number(detailRaceDiag.elapsedMs || 0) + "ms"
        ].filter(Boolean).join(" ") : "none"),
        "pan direct: " + (panDiag ? [
          panDiag.stage || "",
          panDiag.lifecyclePhase || "",
          "total=" + Number(panDiag.total || 0),
          "quark=" + Number(panDiag.quarkCount || 0),
          "baidu=" + Number(panDiag.baiduCount || 0),
          panDiag.selectedCandidate && panDiag.selectedCandidate.diskType || ""
        ].filter(Boolean).join(" ") : "none"),
        "pan request: " + (requestDiag ? [
          requestDiag.mode || "",
          requestDiag.phase || "",
          "round=" + Number(requestDiag.round || 0),
          "attempt=" + Number(requestDiag.attempt || 0),
          "elapsed=" + Number(requestDiag.elapsedMs || 0) + "ms",
          "timeout=" + Number(requestDiag.timeoutMs || requestDiag.requestTimeout || 0) + "ms",
          "actual=" + Number(requestDiag.actualRequestAttempts || 0),
          requestDiag.failureKind || "",
          requestDiag.result || ""
        ].filter(Boolean).join(" ") : "none"),
        "pan session: " + (sessionDiag ? [
          sessionDiag.event || "",
          "id=" + Number(sessionDiag.sessionId || 0),
          sessionDiag.origin || "",
          "elapsed=" + Number(sessionDiag.elapsedMs || 0) + "ms",
          "initial=" + Number(sessionDiag.initialAttempts || 0),
          "poll=" + Number(sessionDiag.pollRoundsCompleted || 0) + "/" + Number(sessionDiag.pollRoundsStarted || 0),
          "recovery=" + Number(sessionDiag.foregroundRecoveryCount || 0),
          "results=" + Number(sessionDiag.resultCount || 0),
          "actual=" + Number(sessionDiag.actualRequestAttempts || 0),
          sessionDiag.terminal ? "terminal" : "active",
          sessionDiag.terminalReason || ""
        ].filter(Boolean).join(" ") : "none"),
        "direct session: " + (directSessionDiag ? [
          "action=" + Number(directSessionDiag.actionId || 0),
          "old=" + Number(directSessionDiag.oldSessionId || 0),
          directSessionDiag.oldLifecycle || "",
          directSessionDiag.oldTerminal ? "old-terminal" : "old-active-or-none",
          directSessionDiag.reuseDecision || "",
          "new=" + Number(directSessionDiag.newSessionId || 0),
          "initial=" + Number(directSessionDiag.newInitialAttemptCount || 0),
          "actual=" + Number(directSessionDiag.actualRequestAttempts || 0)
        ].filter(Boolean).join(" ") : "none"),
        "foreground session: " + (foregroundSessionDiag ? [
          "source=" + Number(foregroundSessionDiag.sourceActionId || 0),
          "old=" + Number(foregroundSessionDiag.oldDirectSessionId || 0),
          "new=" + Number(foregroundSessionDiag.foregroundSessionId || 0),
          "initial=" + Number(foregroundSessionDiag.initialAttemptCount || 0),
          "retry=" + Number(foregroundSessionDiag.initialRetryCount || 0),
          "age=" + Number(foregroundSessionDiag.startedAtAgeMs || 0) + "ms",
          "remaining=" + Number(foregroundSessionDiag.deadlineRemainingMs || 0) + "ms",
          "actual=" + Number(foregroundSessionDiag.actualRequestAttempts || 0),
          foregroundSessionDiag.terminalReason || ""
        ].filter(Boolean).join(" ") : "none"),
        "pan recovery: " + (recoveryDiag ? [
          recoveryDiag.reason || "",
          recoveryDiag.previousFailureKind || "",
          recoveryDiag.newLifecycleStarted ? "started" : "not-started"
        ].filter(Boolean).join(" ") : "none"),
        "pan handoff: " + (handoffDiag ? [
          handoffDiag.reason || "",
          "old=" + Number(handoffDiag.oldSessionId || 0),
          "new=" + Number(handoffDiag.newSessionId || 0),
          "previous=" + (handoffDiag.previousFailureKind || "none"),
          "lifecycle=" + (handoffDiag.newLifecycle || ""),
          "failure=" + (handoffDiag.newFailureKind || "none"),
          handoffDiag.panVisible ? "visible" : "hidden",
          "first=" + (handoffDiag.firstRenderedState || "")
        ].filter(Boolean).join(" ") : "none"),
        "history compat: " + (historyCompatDiag ? [
          "raw=" + Number(historyCompatDiag.rawCount || 0),
          "visible=" + Number(historyCompatDiag.visibleCount || 0),
          "hidden=" + Number(historyCompatDiag.hiddenCount || 0),
          "restorable=" + Number(historyCompatDiag.restorableCount || 0),
          "non-restorable-visible=" + Number(historyCompatDiag.nonRestorableVisibleCount || 0),
          "duplicates=" + Number(historyCompatDiag.duplicateCount || 0)
        ].filter(Boolean).join(" ") : "none"),
        "history item: " + (historyItemDiag ? [
          historyItemDiag.siteKind || "",
          historyItemDiag.replayKind || "",
          historyItemDiag.hasTitle ? "title" : "no-title",
          historyItemDiag.hasPoster ? "poster" : "no-poster",
          historyItemDiag.hasPosition ? "position" : "no-position",
          historyItemDiag.hasDuration ? "duration" : "no-duration",
          historyItemDiag.hasCreateTime ? "create-time" : "no-create-time",
          historyItemDiag.visible ? "visible" : "hidden",
          historyItemDiag.restorable ? "restorable" : "non-restorable",
          historyItemDiag.hiddenReason || ""
        ].filter(Boolean).join(" ") : "none"),
        "native delete: " + (nativeDeleteDiag ? [
          nativeDeleteDiag.NATIVE_DELETE_ENDPOINT || "",
          "status=" + Number(nativeDeleteDiag.NATIVE_DELETE_HTTP_STATUS || 0),
          "deleted=" + Number(nativeDeleteDiag.NATIVE_DELETE_BATCH_DELETED || 0),
          "skipped=" + Number(nativeDeleteDiag.NATIVE_DELETE_BATCH_SKIPPED || 0),
          "failed=" + Number(nativeDeleteDiag.NATIVE_DELETE_BATCH_FAILED || 0),
          nativeDeleteDiag.NATIVE_DELETE_ITEM_ACTION || "",
          nativeDeleteDiag.NATIVE_DELETE_ITEM_MESSAGE || ""
        ].filter(Boolean).join(" ") : "none"),
        "native delete probe:\n" + (nativeDeleteProbeDiag ? nativeDeleteProbeDiag.probes.map((probe, index) => [
          ["WRITE OPTIONS:", "DELETE API OPTIONS:", "DELETE ALIAS OPTIONS:"][index] || "OPTIONS:",
          "url=" + (probe.PROBE_URL || ""),
          "status=" + Number(probe.PROBE_STATUS || 0),
          probe.PROBE_ERROR ? "error=" + String(probe.PROBE_ERROR).slice(0, 300) : "body=" + String(probe.PROBE_BODY || "").slice(0, 300)
        ].join("\n")).join("\n") : "none"),
        "native progress: " + (nativeProgressDiag ? [
          "status=" + Number(nativeProgressDiag.status || 0),
          nativeProgressDiag.action || "",
          nativeProgressDiag.outcome || "",
          nativeProgressDiag.message || ""
        ].filter(Boolean).join(" ") : "none"),
        "home v14: " + (homeV14Diag ? [
          "sections=" + Number(homeV14Diag.sectionCount || 0),
          "rendered=" + Number(homeV14Diag.renderedSectionCount || 0),
          "loaded=" + Number(homeV14Diag.loadedSectionCount || 0),
          "portrait=" + Number(homeV14Diag.portraitCardCount || 0),
          "landscape=" + Number(homeV14Diag.landscapeCardCount || 0),
          "recent=" + Number(homeV14Diag.recentCardCount || 0),
          "src=" + Number(homeV14Diag.imageSrcCount || 0),
          "deferred=" + Number(homeV14Diag.imageDeferredCount || 0),
          "requests=" + Number(homeV14Diag.activeListRequestCount || 0),
          "concurrent=" + Number(homeV14Diag.homeListConcurrentRequests || 0),
          "hero=" + Number(homeV14Diag.heroCandidateCount || 0),
          "hero-extra=" + Number(homeV14Diag.heroExtraTmdbRequestCount || 0)
        ].join(" ") : "none"),
        "search ime: " + (searchImeDiag ? [
          searchImeDiag.reason || "",
          "key=" + (searchImeDiag.key || ""),
          "keyCode=" + Number(searchImeDiag.keyCode || 0),
          "before=" + (searchImeDiag.beforeActiveId || ""),
          searchImeDiag.beforeReadOnly ? "before-readonly" : "before-editable",
          searchImeDiag.blurObserved ? "blur" : "no-blur",
          searchImeDiag.focusObserved ? "focus" : "no-focus",
          "after=" + (searchImeDiag.afterActiveId || ""),
          searchImeDiag.afterReadOnly ? "after-readonly" : "after-editable",
          searchImeDiag.focusReacquired ? "ready" : "not-ready",
          searchImeDiag.frameReacquireNeeded ? "frame-reacquire" : "no-frame-reacquire",
          "blurSeq=" + Number(searchImeDiag.afterBlurSeq || 0),
          "focusSeq=" + Number(searchImeDiag.afterFocusSeq || 0),
          "scroll=" + Number(searchImeDiag.scrollBefore || 0) + ">" + Number(searchImeDiag.scrollAfter || 0)
        ].filter(Boolean).join(" ") : "none"),
        "BACK_DIAG: " + (backDiag ? [
          "seq=" + Number(backDiag.seq || 0),
          backDiag.eventType || "",
          "key=" + (backDiag.key || ""),
          "code=" + (backDiag.code || ""),
          "keyCode=" + Number(backDiag.keyCode || 0),
          "normalized=" + (backDiag.normalizedKey || ""),
          "route=" + (backDiag.route || ""),
          "snapshot=" + (backDiag.snapshotRoute || ""),
          "active=" + (backDiag.activeLabel || backDiag.activeElement && backDiag.activeElement.id || ""),
          backDiag.preventDefaultCalled ? "prevented" : "not-prevented",
          backDiag.defaultPrevented ? "defaultPrevented" : "default-not-prevented",
          backDiag.sdkBackCalled ? "sdk.back" : "no-sdk.back",
          backDiag.historyBackCalled ? "history.back" : "no-history.back",
          backDiag.keydownObserved ? "keydown" : "no-keydown",
          backDiag.keyupObserved ? "keyup" : "no-keyup",
          backDiag.nativeFallbackPossible ? "native-fallback-possible" : ""
        ].filter(Boolean).join(" ") : "none"),
        "tests: " + tvDiagnosticTestSummary()
      ];
      output.textContent = lines.join("\n");
      try { console.debug("[Nostr TV]", lines.join(" | ")); } catch (e) {}
    }

    function tvFocusSafeInsets(container) {
      const height = (container && container.clientHeight) || window.innerHeight || document.documentElement.clientHeight || 0;
      const tv = isTvLikeDevice();
      if (!tv) return { top: 24, bottom: 24, left: 8, right: 8 };
      if (container === $("detailSheet")) {
        return {
          // The original TV detail uses generous CSS padding, so Reveal only
          // needs a modest visual buffer here; do not reuse V1's expanded UI
          // safe-area values.
          top: Math.max(36, Math.min(48, Math.round(height * .045))),
          bottom: Math.max(44, Math.min(56, Math.round(height * .055))),
          left: 16,
          right: 16
        };
      }
      return {
        top: Math.max(20, Math.min(32, Math.round(height * .04))),
        bottom: Math.max(28, Math.min(40, Math.round(height * .055))),
        left: 12,
        right: 12
      };
    }

    function focusOuterBounds(target) {
      const rect = target && target.getBoundingClientRect ? target.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
      let bleed = 0;
      try {
        const cssLength = (value) => {
          const match = String(value || "").match(/-?\d*\.?\d+/);
          return match ? Number(match[0]) || 0 : 0;
        };
        const style = getComputedStyle(target);
        const outlineWidth = cssLength(style.outlineWidth);
        const outlineOffset = cssLength(style.outlineOffset);
        bleed = Math.max(bleed, Math.max(0, outlineWidth + outlineOffset));
        const shadow = String(style.boxShadow || "");
        if (shadow && shadow !== "none") {
          shadow.split(/,(?![^()]*\))/).forEach((part) => {
            if (/\binset\b/i.test(part)) return;
            const lengths = (part.match(/-?\d*\.?\d+px/g) || []).map((value) => Math.abs(cssLength(value)));
            if (lengths.length) {
              const x = lengths[0] || 0;
              const y = lengths[1] || 0;
              const blur = lengths[2] || 0;
              const spread = lengths[3] || 0;
              bleed = Math.max(bleed, x + blur + spread, y + blur + spread);
            }
          });
        }
      } catch (e) {}
      return {
        left: rect.left - bleed,
        right: rect.right + bleed,
        top: rect.top - bleed,
        bottom: rect.bottom + bleed,
        width: rect.width + bleed * 2,
        height: rect.height + bleed * 2
      };
    }

    function revealHorizontalInContainer(target, container) {
      if (!target || !container || !container.getBoundingClientRect) return { x: 0, y: 0 };
      const itemRect = focusOuterBounds(target);
      const containerRect = container.getBoundingClientRect();
      const safe = tvFocusSafeInsets(container);
      if (container.classList && container.classList.contains("home-rail") && container.closest("#home")) {
        const style = window.getComputedStyle ? getComputedStyle(container) : null;
        const leftGutter = style ? parseFloat(style.paddingLeft) || 0 : 0;
        const rightGutter = style ? parseFloat(style.paddingRight) || 0 : 0;
        safe.left = Math.max(safe.left, leftGutter);
        safe.right = Math.max(safe.right, rightGutter);
      }
      const leftLimit = containerRect.left + safe.left;
      const rightLimit = containerRect.right - safe.right;
      let delta = 0;
      if (itemRect.width > rightLimit - leftLimit) delta = itemRect.left - leftLimit;
      else if (itemRect.left < leftLimit) delta = itemRect.left - leftLimit;
      else if (itemRect.right > rightLimit) delta = itemRect.right - rightLimit;
      const before = Number(container.scrollLeft || 0);
      const max = Math.max(0, Number(container.scrollWidth || 0) - Number(container.clientWidth || 0));
      const firstFilterOption = container.classList && container.classList.contains("secondary-filter-row")
        ? container.querySelector(".secondary-filter-option")
        : null;
      const next = target === firstFilterOption ? 0 : Math.max(0, Math.min(max, before + delta));
      if (Math.abs(next - before) > .5) container.scrollLeft = next;
      return { x: next - before, y: 0 };
    }

    function revealVerticalInContainer(target, container, topSafe, bottomSafe) {
      if (!target || !container || !container.getBoundingClientRect) return { x: 0, y: 0 };
      const itemRect = focusOuterBounds(target);
      const containerRect = container.getBoundingClientRect();
      const safe = tvFocusSafeInsets(container);
      const top = topSafe == null ? safe.top : topSafe;
      const bottom = bottomSafe == null ? safe.bottom : bottomSafe;
      const topLimit = containerRect.top + top;
      const bottomLimit = containerRect.bottom - bottom;
      let delta = 0;
      if (itemRect.height > bottomLimit - topLimit) delta = itemRect.top - topLimit;
      else if (itemRect.top < topLimit) delta = itemRect.top - topLimit;
      else if (itemRect.bottom > bottomLimit) delta = itemRect.bottom - bottomLimit;
      const before = Number(container.scrollTop || 0);
      const max = Math.max(0, Number(container.scrollHeight || 0) - Number(container.clientHeight || 0));
      const next = Math.max(0, Math.min(max, before + delta));
      if (Math.abs(next - before) > .5) container.scrollTop = next;
      return { x: 0, y: next - before };
    }

    function alignHomeRailToAnchor(context) {
      if (!context || !context.rail || !context.rail.getBoundingClientRect) return { x: 0, y: 0 };
      const root = document.scrollingElement || document.documentElement;
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const anchor = context.section && context.section.getBoundingClientRect ? context.section : context.rail;
      const anchorRect = anchor.getBoundingClientRect();
      const before = homeScrollTop();
      const max = Math.max(0, Number(root.scrollHeight || document.documentElement.scrollHeight || 0) - Number(root.clientHeight || height || 0));
      const desired = before + anchorRect.top - HOME_RAIL_ANCHOR_OFFSET;
      const next = Math.max(0, Math.min(max, desired));
      if (Math.abs(next - before) > .5) applyHomeScrollTop(next);
      return { x: 0, y: next - before };
    }

    function revealHomeFocusedTarget(target, options) {
      const opts = options || {};
      const root = document.scrollingElement || document.documentElement;
      const homeHero = $("homeHero");
      if (isHomeRouteActive() && target === homeHero) {
        if (state.homeV14) state.homeV14.lastHomeFocusedRail = "";
        const beforeTop = homeScrollTop();
        if (beforeTop > 0) applyHomeScrollTop(0);
        return { x: 0, y: -beforeTop };
      }
      const homeRail = homeRailContextForTarget(target);
      if (homeRail && homeRail.key) {
        const lastRail = String(state.homeV14 && state.homeV14.lastHomeFocusedRail || "");
        if (homeRail.key === lastRail) return { x: 0, y: 0 };
        const anchorDelta = alignHomeRailToAnchor(homeRail);
        if (state.homeV14) state.homeV14.lastHomeFocusedRail = homeRail.key;
        return anchorDelta;
      }
      const itemRect = focusOuterBounds(target);
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const safe = tvFocusSafeInsets(null);
      const topLimit = safe.top;
      const bottomLimit = height - safe.bottom;
      const section = target && target.closest ? target.closest(".home-section") : null;
      const sectionHead = section && section.querySelector ? section.querySelector(".home-section-head") : null;
      const headRect = sectionHead && sectionHead.getBoundingClientRect ? sectionHead.getBoundingClientRect() : null;
      if (opts.alignHomeSectionHead && headRect && headRect.height > 0) {
        const before = homeScrollTop();
        const desired = before + headRect.top - topLimit;
        const max = Math.max(0, Number(root.scrollHeight || document.documentElement.scrollHeight || 0) - Number(root.clientHeight || height || 0));
        const next = Math.max(0, Math.min(max, desired));
        if (Math.abs(next - before) > .5) applyHomeScrollTop(next);
        return { x: 0, y: next - before };
      }
      const groupHeight = headRect ? itemRect.bottom - headRect.top : 0;
      const groupFits = !!(headRect && headRect.height > 0 && itemRect.height > 0 && groupHeight <= bottomLimit - topLimit);
      let delta = 0;
      if (groupFits) {
        if (headRect.top < topLimit) delta = headRect.top - topLimit;
        else if (itemRect.bottom > bottomLimit) delta = itemRect.bottom - bottomLimit;
      } else if (itemRect.height > bottomLimit - topLimit) delta = itemRect.top - topLimit;
      else if (itemRect.top < topLimit) delta = itemRect.top - topLimit;
      else if (itemRect.bottom > bottomLimit) delta = itemRect.bottom - bottomLimit;
      const before = homeScrollTop();
      const max = Math.max(0, Number(root.scrollHeight || document.documentElement.scrollHeight || 0) - Number(root.clientHeight || height || 0));
      const next = Math.max(0, Math.min(max, before + delta));
      if (Math.abs(next - before) > .5) applyHomeScrollTop(next);
      return { x: 0, y: next - before };
    }
    function revealSecondaryFocusedTarget(target) {
      if (!target || homeUiRoute() !== "secondary" || !target.getBoundingClientRect) return { x: 0, y: 0 };
      const root = document.scrollingElement || document.documentElement;
      const height = window.innerHeight || document.documentElement.clientHeight || 0;
      const safe = tvFocusSafeInsets(null);
      const itemRect = focusOuterBounds(target);
      const topLimit = safe.top;
      const bottomLimit = height - safe.bottom;
      let delta = 0;
      if (itemRect.height > bottomLimit - topLimit) delta = itemRect.top - topLimit;
      else if (itemRect.top < topLimit) delta = itemRect.top - topLimit;
      else if (itemRect.bottom > bottomLimit) delta = itemRect.bottom - bottomLimit;
      const before = homeScrollTop();
      const max = Math.max(0, Number(root.scrollHeight || document.documentElement.scrollHeight || 0) - Number(root.clientHeight || height || 0));
      const next = Math.max(0, Math.min(max, before + delta));
      if (Math.abs(next - before) > .5) applyHomeScrollTop(next);
      return { x: 0, y: next - before };
    }

    function revealFocusedTarget(target, options) {
      if (!target || !target.getBoundingClientRect || !isTvLikeDevice()) return { x: 0, y: 0 };
      let deltaX = 0;
      let deltaY = 0;
      const horizontal = target.closest && target.closest(".rail, #panTabs, .secondary-filter-row");
      const panList = $("panResultList");
      const connectionBody = $("connectionBody");
      const sidebar = $("homeSidebar");
      const suggestPanel = $("suggestPanel");
      const detail = $("detailSheet");
      const sync = $("syncSheet");
      const secondary = $("secondaryCatalog");
      if (horizontal) {
        const horizontalDelta = revealHorizontalInContainer(target, horizontal);
        deltaX += horizontalDelta.x;
      }
      if (panList && panList.contains(target)) {
        const listDelta = revealVerticalInContainer(target, panList, 20, 20);
        deltaY += listDelta.y;
      } else if (connectionBody && connectionBody.contains(target)) {
        if (isConnectionPanelTopFocusRow(target)) {
          const before = Number(connectionBody.scrollTop || 0);
          connectionBody.scrollTop = 0;
          deltaY -= before;
          requestAnimationFrame(() => {
            if (!connectionBody.isConnected || !connectionBody.classList.contains("open")) return;
            if (document.activeElement !== target) return;
            if (isConnectionPanelTopFocusRow(target) && connectionBody.scrollTop !== 0) connectionBody.scrollTop = 0;
          });
        } else {
          const panelDelta = revealVerticalInContainer(target, connectionBody, 24, 24);
          deltaY += panelDelta.y;
        }
      } else if (sidebar && sidebar.contains(target)) {
        const sidebarDelta = revealVerticalInContainer(target, sidebar, 24, 24);
        deltaY += sidebarDelta.y;
      } else if (suggestPanel && suggestPanel.contains(target)) {
        const suggestDelta = revealVerticalInContainer(target, suggestPanel, 18, 18);
        deltaY += suggestDelta.y;
      }
      if (detail && detail.classList.contains("active") && detail.contains(target)) {
        const detailDelta = revealVerticalInContainer(target, detail);
        deltaY += detailDelta.y;
      } else if (sync && sync.classList.contains("active") && sync.contains(target)) {
        const syncDelta = revealVerticalInContainer(target, sync);
        deltaY += syncDelta.y;
      } else if (secondary && !secondary.hidden && secondary.contains(target)) {
        const secondaryDelta = revealSecondaryFocusedTarget(target);
        deltaY += secondaryDelta.y;
      } else if (!(connectionBody && connectionBody.contains(target))
        && !(sidebar && sidebar.contains(target))
        && !(suggestPanel && suggestPanel.contains(target))) {
        const homeDelta = revealHomeFocusedTarget(target, options);
        deltaY += homeDelta.y;
      }
      if (isTvDiagnosticEnabled()) {
        state.tvDiag.scrollScope = focusDiagnosticScrollScope(target);
        state.tvDiag.activeRail = focusDiagnosticRail(target);
        state.tvDiag.revealDeltaX = deltaX;
        state.tvDiag.revealDeltaY = deltaY;
        updateTvDiagnostic();
      }
      return { x: deltaX, y: deltaY };
    }

    let tvDiagnosticsLoadPromise = null;

    function loadTvDiagnostics() {
      if (!isTvDiagnosticEnabled()) return Promise.resolve(false);
      if (tvDiagnosticsLoadPromise) return tvDiagnosticsLoadPromise;
      tvDiagnosticsLoadPromise = new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = new URL("tests/tv-diagnostics.js", document.baseURI || window.location.href).toString();
        script.async = true;
        script.onload = () => {
          try {
            const tvTests = window.WEBHOME_RUN_TV_SELF_TESTS;
            if (typeof tvTests === "function") tvTests();
            const movieTests = window.WEBHOME_RUN_MOVIE_DETAIL_SHARED_SELF_TESTS;
            if (typeof movieTests === "function") Promise.resolve(movieTests()).catch(() => {});
            setTimeout(() => {
              try {
                if (typeof window.WEBHOME_RUN_TV_SELF_TESTS === "function") window.WEBHOME_RUN_TV_SELF_TESTS();
              } catch (e) {
                try { console.warn("[Nostr TV] diagnostics rerun failed", e); } catch (e2) {}
              }
            }, 320);
            resolve(true);
          } catch (e) {
            try { console.warn("[Nostr TV] diagnostics execution failed", e); } catch (e2) {}
            resolve(false);
          }
        };
        script.onerror = () => {
          try { console.warn("[Nostr TV] diagnostics script unavailable", script.src); } catch (e) {}
          resolve(false);
        };
        (document.head || document.documentElement).appendChild(script);
      });
      return tvDiagnosticsLoadPromise;
    }

