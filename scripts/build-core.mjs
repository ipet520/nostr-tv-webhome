import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";

const scriptsDir = fileURLToPath(new URL(".", import.meta.url));
export const repoRoot = resolve(scriptsDir, "..");
export const sourceRoot = resolve(repoRoot, "src");
export const templatePath = resolve(sourceRoot, "index.template.html");
export const outputPath = resolve(repoRoot, "index.html");

export const cssManifest = Object.freeze([
  ["__WEBHOME_BUILD_CSS_00__", "css/00-base.css"],
  ["__WEBHOME_BUILD_CSS_01__", "css/01-detail-cover.css"],
  ["__WEBHOME_BUILD_CSS_02__", "css/02-capsule.css"],
  ["__WEBHOME_BUILD_CSS_03__", "css/03-button-glow.css"],
  ["__WEBHOME_BUILD_CSS_04__", "css/04-dark-theme.css"],
  ["__WEBHOME_BUILD_CSS_05__", "css/05-home-tv.css"],
  ["__WEBHOME_BUILD_CSS_06__", "css/06-tv-diagnostic.css"],
  ["__WEBHOME_BUILD_CSS_07__", "css/07-direct-play-status.css"],
  ["__WEBHOME_BUILD_CSS_08__", "css/08-return-controls.css"],
  ["__WEBHOME_BUILD_CSS_09__", "css/09-home-utility.css"],
  ["__WEBHOME_BUILD_CSS_10__", "css/10-detail-action-colors.css"],
]);

export const fixedScriptManifest = Object.freeze([
  ["__WEBHOME_BUILD_SCRIPT_HEAD__", "js/00-head-bootstrap.js"],
  ["__WEBHOME_BUILD_SCRIPT_NOSTR__", "js/01-nostr-tools-shim.js"],
]);

export const applicationSlot = "__WEBHOME_BUILD_SCRIPT_APPLICATION__";
export const applicationFiles = Object.freeze([
  "02-runtime-config-device.js",
  "03-weekly-tmdb-pan-config.js",
  "04-nostr-hot-storage.js",
  "05-relay-network-pan-session.js",
  "06-tmdb-history-model.js",
  "07-detail-playback-race.js",
  "08-catalog-recent-management.js",
  "09-route-search.js",
  "10-sidebar-navigation.js",
  "11-home-rendering-data.js",
  "12-secondary-query-nostr.js",
  "13-secondary-catalog-render.js",
  "14-grid-card-focus.js",
  "15-recent-canonical-search-return.js",
  "16-detail-rendering.js",
  "17-pan-direct-health.js",
  "18-curated-discovery-health.js",
  "19-pan-results-handoff-return.js",
  "20-nostr-publish-relays.js",
  "21-bindings-focus-anchor.js",
  "22-snapshot-resume-boot.js",
]);

export const semanticMarkers = Object.freeze([
  ["WEBHOME_CONFIG", "window.WEBHOME_CONFIG"],
  ["state", "const state ="],
  ["detail preparation", "prepareDetailPlayback"],
  ["provider commit", "tryCommitDetailProvider"],
  ["Direct terminalization", "terminalizeDirectDiscoveryAfterProviderCommit"],
  ["Curated candidate", "resolveCuratedPlaybackCandidate"],
  ["Direct playback", "playBestQuark"],
  ["Home anchor", "HOME_RAIL_ANCHOR_OFFSET"],
  ["Home anchor alignment", "alignHomeRailToAnchor"],
  ["Home focus reveal", "revealHomeFocusedTarget"],
  ["Nostr tools", "NostrTools"],
  ["Nostr Home", "homeNostrSignalKey"],
  ["Nostr Secondary", "secondaryLoadNostrHotItems"],
  ["diagnostic loader", "loadTvDiagnostics"],
  ["diagnostic path", "tests/tv-diagnostics.js"],
  ["boot", "boot().catch"],
]);

export function countOccurrences(source, token) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(token, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + token.length;
  }
}

export function readSourceText(relativePath) {
  return readFileSync(resolve(sourceRoot, relativePath), "utf8");
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sorted(values) {
  return [...values].sort();
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sourceFiles(relativeDirectory) {
  const directory = resolve(sourceRoot, relativeDirectory);
  const entries = readdirSync(directory, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error(`Source directory contains a non-file entry: ${relativeDirectory}`);
  }
  return entries.map((entry) => `${relativeDirectory}/${entry.name}`);
}

function assertUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`${label} contains duplicate: ${value}`);
    seen.add(value);
  }
}

export function validateManifest() {
  const cssPaths = cssManifest.map(([, relativePath]) => relativePath);
  const fixedScriptPaths = fixedScriptManifest.map(([, relativePath]) => relativePath);
  const applicationPaths = applicationFiles.map((name) => `js/${name}`);

  if (cssManifest.length !== 11) throw new Error(`CSS manifest expected 11 files, found ${cssManifest.length}`);
  if (applicationFiles.length !== 21) throw new Error(`Application manifest expected 21 files, found ${applicationFiles.length}`);
  assertUnique(cssPaths, "CSS manifest");
  assertUnique(fixedScriptPaths, "Fixed script manifest");
  assertUnique(applicationFiles, "Application manifest");
  if (applicationFiles.includes("02-application.js")) {
    throw new Error("Application manifest must not contain 02-application.js");
  }
  if (applicationFiles[applicationFiles.length - 1] !== "22-snapshot-resume-boot.js") {
    throw new Error("Boot fragment must be the last application fragment");
  }
  const bindingsIndex = applicationFiles.indexOf("21-bindings-focus-anchor.js");
  const bootIndex = applicationFiles.indexOf("22-snapshot-resume-boot.js");
  if (bindingsIndex < 0 || bootIndex < 0 || bindingsIndex >= bootIndex) {
    throw new Error("Bindings fragment must precede boot fragment");
  }

  const allManifestPaths = [...cssPaths, ...fixedScriptPaths, ...applicationPaths];
  for (const relativePath of allManifestPaths) {
    if (!existsSync(resolve(sourceRoot, relativePath))) {
      throw new Error(`Manifest file is missing: ${relativePath}`);
    }
  }

  const actualCssPaths = sorted(sourceFiles("css"));
  const expectedCssPaths = sorted(cssPaths);
  if (!sameList(actualCssPaths, expectedCssPaths)) {
    throw new Error(`CSS source directory does not match manifest. Expected ${expectedCssPaths.join(", ")}; found ${actualCssPaths.join(", ")}`);
  }

  const actualJsPaths = sorted(sourceFiles("js"));
  const expectedJsPaths = sorted([...fixedScriptPaths, ...applicationPaths]);
  if (!sameList(actualJsPaths, expectedJsPaths)) {
    throw new Error(`JS source directory does not match manifest. Expected ${expectedJsPaths.join(", ")}; found ${actualJsPaths.join(", ")}`);
  }

  return {
    cssPaths,
    fixedScriptPaths,
    applicationPaths,
    cssCount: cssManifest.length,
    applicationCount: applicationFiles.length,
  };
}

function applicationSourceFromManifest() {
  const parts = applicationFiles.map((name) => readSourceText(`js/${name}`));
  return {
    parts,
    source: parts.join(""),
  };
}

function replaceSlot(output, slot, content) {
  const count = countOccurrences(output, slot);
  if (count !== 1) throw new Error(`Build slot ${slot} expected exactly once, found ${count}`);
  return output.replace(slot, () => content);
}

export function extractInlineBlocks(text, tag) {
  const blocks = [];
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let offset = 0;
  while (true) {
    const start = text.indexOf(open, offset);
    if (start === -1) break;
    const contentStart = text.indexOf(">", start) + 1;
    const contentEnd = text.indexOf(close, contentStart);
    if (contentStart <= 0 || contentEnd === -1) throw new Error(`Unclosed <${tag}> block`);
    blocks.push({ start, content: text.slice(contentStart, contentEnd) });
    offset = contentEnd + close.length;
  }
  return blocks;
}

export function renderIndex() {
  const manifest = validateManifest();
  let output = readFileSync(templatePath, "utf8");
  const seenSlots = new Set();

  for (const [slot, relativePath] of [...cssManifest, ...fixedScriptManifest]) {
    if (seenSlots.has(slot)) throw new Error(`Duplicate build slot: ${slot}`);
    seenSlots.add(slot);
    output = replaceSlot(output, slot, readSourceText(relativePath));
  }

  if (seenSlots.has(applicationSlot)) throw new Error(`Duplicate build slot: ${applicationSlot}`);
  const application = applicationSourceFromManifest();
  output = replaceSlot(output, applicationSlot, application.source);

  const unknownSlots = output.match(/__WEBHOME_BUILD_[A-Z0-9_]+__/g);
  if (unknownSlots) throw new Error(`Unknown build slot(s): ${[...new Set(unknownSlots)].join(", ")}`);

  return { output, application, manifest };
}

export function semanticMarkerReport(text) {
  return semanticMarkers.map(([name, marker]) => ({ name, marker, present: text.includes(marker) }));
}

export function validateRenderedArtifact(output) {
  const styleBlocks = extractInlineBlocks(output, "style");
  const scriptBlocks = extractInlineBlocks(output, "script");
  if (styleBlocks.length !== cssManifest.length) {
    throw new Error(`Expected ${cssManifest.length} style blocks, found ${styleBlocks.length}`);
  }
  if (scriptBlocks.length !== 3) throw new Error(`Expected 3 static script blocks, found ${scriptBlocks.length}`);

  const expectedStyles = cssManifest.map(([, relativePath]) => readSourceText(relativePath));
  for (let index = 0; index < expectedStyles.length; index += 1) {
    if (styleBlocks[index].content !== expectedStyles[index]) {
      throw new Error(`CSS source integrity failed at manifest index ${index}`);
    }
  }

  const application = applicationSourceFromManifest();
  const expectedScripts = [
    readSourceText("js/00-head-bootstrap.js"),
    readSourceText("js/01-nostr-tools-shim.js"),
    application.source,
  ];
  for (let index = 0; index < expectedScripts.length; index += 1) {
    if (scriptBlocks[index].content !== expectedScripts[index]) {
      throw new Error(`JavaScript source integrity failed at script slot ${index + 1}`);
    }
    new vm.Script(scriptBlocks[index].content, { filename: `index-inline-script-${index + 1}.js` });
  }

  const markers = semanticMarkerReport(output);
  const missingMarkers = markers.filter((entry) => !entry.present);
  if (missingMarkers.length) {
    throw new Error(`Missing semantic marker(s): ${missingMarkers.map((entry) => entry.name).join(", ")}`);
  }

  return {
    styleCount: styleBlocks.length,
    scriptCount: scriptBlocks.length,
    application,
    markers,
  };
}
