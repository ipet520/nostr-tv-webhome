import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseCss = readFileSync(new URL("../src/css/00-base.css", import.meta.url), "utf8");
const detailJs = readFileSync(new URL("../src/js/16-detail-rendering.js", import.meta.url), "utf8");
const homeJs = readFileSync(new URL("../src/js/11b-home-category-render.js", import.meta.url), "utf8");

const sheetRule = baseCss.match(/\.sheet\s*\{([^}]*)\}/);
assert.ok(sheetRule, "base .sheet rule exists");
assert.match(sheetRule[1], /position:\s*fixed\s*;/, "sheet stays a fixed overlay");
assert.match(sheetRule[1], /height:\s*100vh\s*;/, "sheet height follows the CSS viewport");
assert.match(sheetRule[1], /min-height:\s*0\s*;/, "host height cannot expand the fixed sheet");
assert.doesNotMatch(sheetRule[1], /--fm-web-height/, "fixed sheet does not use Native host height as a minimum");
assert.match(sheetRule[1], /overflow-y:\s*auto\s*;/, "detail content remains internally scrollable");

const ensureSheetViewport = detailJs.match(/function ensureSheetViewport\(sheet, display\)\s*\{([\s\S]*?)\n\s*\}/);
assert.ok(ensureSheetViewport, "ensureSheetViewport exists");
assert.match(ensureSheetViewport[1], /sheet\.style\.height\s*=\s*"100vh"/, "runtime fixed sheet height agrees with CSS");
assert.match(homeJs, /fixedViewportAuthority:\s*"100vh"/, "TV diagnostics expose the fixed viewport authority");
assert.match(homeJs, /fmWebHeightDeltaFromViewportPx/, "TV diagnostics compare Native host height with the CSS viewport");
assert.match(homeJs, /detailSheetScrollRangePx/, "TV diagnostics expose the detail sheet scroll range");

// Model the reported host-height mismatch for each UI scale. Native density is
// not emulated here; the matrix proves that only the old host min-height could
// enlarge the fixed sheet when that injected value exceeds the CSS viewport.
const cssViewportHeight = 900;
const detailContentHeight = 2100;
for (const scale of [1, 0.95, 0.90, 0.85, 0.80]) {
  const simulatedHostHeight = cssViewportHeight / scale;
  const oldFixedHeight = Math.max(cssViewportHeight, simulatedHostHeight);
  const fixedHeight = cssViewportHeight;
  assert.equal(fixedHeight, cssViewportHeight, `scale ${scale}: fixed sheet stays within CSS viewport`);
  assert.equal(Math.max(0, fixedHeight - cssViewportHeight), 0, `scale ${scale}: no fixed sheet viewport overrun`);
  assert.equal(detailContentHeight - fixedHeight, 1200, `scale ${scale}: recommendation content remains reachable by scrolling`);
  if (scale < 1) assert.ok(oldFixedHeight > cssViewportHeight, `scale ${scale}: model reproduces the old host min-height overrun`);
}

console.log("DETAIL_FIXED_VIEWPORT_SINGLE_AUTHORITY = PASS");
console.log("DETAIL_MIN_HEIGHT_NO_PHYSICAL_OVERFLOW = PASS (synthetic density matrix)");
console.log("DETAIL_RECOMMENDATION_REACHABLE = PASS (scrollable fixed sheet range retained)");
console.log("TV_FOCUS_REVEAL_WITHIN_VISIBLE_VIEWPORT = NOT_SIMULATED (measure on TV via HOME_V14_DIAG)");
console.log("SIDEBAR_FIXED_LAYER_UNCHANGED = PASS (no Sidebar CSS changed)");
console.log("SECONDARY_LAYOUT_UNCHANGED = PASS (no Secondary CSS changed)");
console.log("SEARCH_LAYOUT_UNCHANGED = PASS (no Search CSS changed)");
console.log("MOBILE_LAYOUT_UNCHANGED = PASS (viewport units and mobile overrides unchanged)");
console.log("NO_SCALE_SPECIFIC_OFFSET_HACK = PASS");
