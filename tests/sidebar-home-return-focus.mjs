import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
const sidebarSource = read("src/js/10-sidebar-navigation.js");
const homeReturnSource = read("src/js/15d-home-return-focus.js");

function functionSource(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const open = source.indexOf("{", start + marker.length);
  let depth = 0;
  let quote = "";
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === "*" && next === "/") { blockComment = false; i++; }
      continue;
    }
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "/" && next === "/") { lineComment = true; i++; continue; }
    if (ch === "/" && next === "*") { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; continue; }
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unterminated function ${name}`);
}

function bind(source, name, deps) {
  const names = Object.keys(deps);
  return new Function(...names, `return (${functionSource(source, name)});`)(...names.map((key) => deps[key]));
}

const openSidebarSource = functionSource(sidebarSource, "openSidebar");
assert.ok(openSidebarSource.includes("state.homeV14.sidebarReturnTarget = target && target.isConnected ? target : null"));
assert.ok(openSidebarSource.includes("state.homeV14.sidebarReturnFocus = target ? homeFocusSnapshot(target, target.__mediaItem || null) : null"));
const mediaResolverSource = functionSource(homeReturnSource, "findHomeReturnMediaTarget");
assert.ok(mediaResolverSource.includes("let key = focus.key || saved.mediaKey || \"\""));
assert.ok(mediaResolverSource.includes("el.dataset.mediaKey || \"\""));
assert.ok(mediaResolverSource.includes("Number(focus.cardIndex)"));

function makeReturnRecorder(findTarget) {
  const focused = [];
  const fallbacks = [];
  const scrolled = [];
  const restore = bind(sidebarSource, "restoreSidebarFocus", {
    homeFocusUserEpoch: () => 9,
    isSidebarRouteActive: () => true,
    homeUiRoute: () => "home",
    isVisibleFocusable: (target) => !!(target && target.connected && target.visible),
    applyHomeScrollTop: (value) => scrolled.push(value),
    $: () => null,
    findHomeReturnTarget: findTarget,
    focusHomeReturnTarget: (target) => focused.push(target),
    focusSidebarCurrentPageDefault: () => fallbacks.push("home-default"),
    requestAnimationFrame: (callback) => callback()
  });
  return { restore, focused, fallbacks, scrolled };
}

const A = { id: "card-A", connected: true, visible: true };
const direct = makeReturnRecorder(() => null);
direct.restore({ target: A, focus: { type: "media", key: "A" }, route: "home", scrollY: 17 });
assert.deepEqual(direct.focused, [A], "A: connected original Home target is restored");
assert.deepEqual(direct.fallbacks, []);
assert.deepEqual(direct.scrolled, [17]);

const replacementA = { id: "card-A-rebuilt", connected: true, visible: true };
const rebuilt = makeReturnRecorder((saved) => saved.focus.key === "A" ? replacementA : null);
rebuilt.restore({ target: { connected: false, visible: false }, focus: { type: "media", key: "A" }, route: "home", scrollY: 0 });
assert.deepEqual(rebuilt.focused, [replacementA], "B: a rebuilt card resolves from the saved Home focus identity");
assert.deepEqual(rebuilt.fallbacks, []);

const hero = { id: "homeHero", connected: true, visible: true };
const heroReturn = makeReturnRecorder(() => hero);
heroReturn.restore({ target: hero, focus: { type: "id", key: "homeHeroAction" }, route: "home", scrollY: 0 });
assert.deepEqual(heroReturn.focused, [hero], "C: Hero remains the return target when it was the original focus");

const missing = makeReturnRecorder(() => null);
missing.restore({ target: { connected: false, visible: false }, focus: { type: "media", key: "removed" }, route: "home", scrollY: 0 });
assert.deepEqual(missing.focused, []);
assert.deepEqual(missing.fallbacks, ["home-default"], "E: Home default is used only when identity resolution fails");

const closeSource = functionSource(sidebarSource, "closeSidebar");
assert.ok(closeSource.includes("const context = sidebarReturnContext()"));
assert.ok(closeSource.includes("state.homeV14.sidebarReturnTarget = null"));
assert.ok(closeSource.includes("state.homeV14.sidebarReturnFocus = null"));
assert.ok(closeSource.includes("if (restore) restoreSidebarFocus(context)"));
assert.ok(closeSource.includes("state.homeV14.sidebarReturnInvalidated = false"));

const missingCloseHome = {
  sidebarHistoryBackPending: false,
  sidebarOpen: true,
  sidebarReturnTarget: { connected: false },
  sidebarReturnFocus: { type: "media", key: "removed" },
  sidebarReturnScrollY: 42,
  sidebarReturnGridScrollTop: 0,
  sidebarReturnGridScrollLeft: 0,
  sidebarReturnRoute: "home",
  sidebarReturnInvalidated: false
};
const closeFallback = makeReturnRecorder(() => null);
const closeSidebar = bind(sidebarSource, "closeSidebar", {
  state: { homeV14: missingCloseHome },
  $: () => ({
    setAttribute() {},
    classList: { remove() {}, add() {} }
  }),
  isConnectionPanelOpen: () => false,
  closeConnectionPanel() {},
  sidebarReturnContext: () => ({ target: null, focus: { type: "media", key: "removed" }, route: "home", scrollY: 42, invalidated: false }),
  isMobileSidebarDevice: () => false,
  isSidebarRouteActive: () => true,
  syncSidebarMobilePresentation() {},
  scheduleSidebarClose() {},
  restoreSidebarFocus: closeFallback.restore,
  focusSidebarCurrentPageDefault() {},
  settleMobileSidebarHistory() {}
});
closeSidebar();
assert.equal(missingCloseHome.sidebarReturnTarget, null);
assert.equal(missingCloseHome.sidebarReturnFocus, null);
assert.equal(missingCloseHome.sidebarReturnScrollY, 0);
assert.equal(missingCloseHome.sidebarReturnInvalidated, false);
assert.deepEqual(closeFallback.fallbacks, ["home-default"], "E: closing consumes saved focus state before fallback");

const navigationState = {
    sidebarOpen: true,
    secondaryListId: "",
    sidebarReturnTarget: A,
    sidebarReturnFocus: { type: "media", key: "A" },
    sidebarReturnInvalidated: false
  };
const request = bind(sidebarSource, "requestSidebarNavigation", {
  state: { activeList: "all", homeV14: navigationState },
  isMobileSidebarDevice: () => false,
  isTvLikeDevice: () => false,
  normalizeLegacyCategoryId: (id) => id,
  homeUiRoute: () => "home",
  isSidebarRouteActive: () => true,
  performSidebarNavigation: () => true
});
assert.equal(request({ type: "live" }), true);
assert.equal(navigationState.sidebarReturnTarget, A, "B: Native Live handoff keeps the Home return element");
assert.deepEqual(navigationState.sidebarReturnFocus, { type: "media", key: "A" });
assert.equal(navigationState.sidebarReturnInvalidated, false);

navigationState.sidebarReturnTarget = A;
navigationState.sidebarReturnFocus = { type: "media", key: "A" };
navigationState.sidebarReturnInvalidated = false;
assert.equal(request({ type: "secondary", listId: "movie" }), true);
assert.equal(navigationState.sidebarReturnTarget, null, "D: existing non-Live category invalidation remains unchanged");
assert.equal(navigationState.sidebarReturnFocus, null);
assert.equal(navigationState.sidebarReturnInvalidated, true);

console.log("SIDEBAR_HOME_RETURN_FOCUS = PASS");
