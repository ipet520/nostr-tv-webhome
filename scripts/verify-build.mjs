import { readFileSync, statSync } from "node:fs";
import * as vm from "node:vm";
import {
  applicationFiles,
  outputPath,
  readSourceText,
  renderIndex,
  semanticMarkerReport,
  sha256,
  validateRenderedArtifact,
} from "./build-core.mjs";

function assertCheck(condition, name, detail) {
  if (!condition) throw new Error(`${name}: ${detail}`);
}

function syntaxCheck(source, filename) {
  new vm.Script(source, { filename });
}

try {
  const beforeStat = statSync(outputPath);
  const first = renderIndex();
  const second = renderIndex();
  const expectedBytes = Buffer.from(first.output, "utf8");
  const secondBytes = Buffer.from(second.output, "utf8");
  const actualBytes = readFileSync(outputPath);
  const actualText = actualBytes.toString("utf8");

  assertCheck(expectedBytes.equals(secondBytes), "IN_MEMORY_REPRODUCIBLE_BUILD", "two in-memory renders differ");
  assertCheck(actualBytes.equals(expectedBytes), "ROOT_INDEX_MATCHES_SOURCE", "root index.html is stale; run:\nnode scripts/build.mjs");
  assertCheck(sha256(actualBytes) === sha256(expectedBytes), "ROOT_INDEX_SHA256_MATCH", "root index.html SHA-256 differs from the current source render");

  const artifact = validateRenderedArtifact(actualText);
  const markerReport = semanticMarkerReport(actualText);
  assertCheck(markerReport.every((entry) => entry.present), "CORE_SEMANTIC_MARKERS", "one or more required authority markers are missing");
  assertCheck(actualText.includes('new URL("tests/tv-diagnostics.js", document.baseURI || window.location.href)'), "DIAGNOSTICS_RELATIVE_URL_UNCHANGED", "diagnostic URL construction changed");

  const headSource = readSourceText("js/00-head-bootstrap.js");
  const nostrSource = readSourceText("js/01-nostr-tools-shim.js");
  syntaxCheck(headSource, "00-head-bootstrap.js");
  syntaxCheck(nostrSource, "01-nostr-tools-shim.js");
  syntaxCheck(first.application.source, "application-concat.js");

  const applicationBytes = first.application.parts.reduce((sum, part) => sum + Buffer.byteLength(part, "utf8"), 0);
  assertCheck(applicationBytes === Buffer.byteLength(first.application.source, "utf8"), "APPLICATION_SOURCE_INTEGRITY", "application fragment byte sum differs from concatenated source");

  const afterStat = statSync(outputPath);
  assertCheck(beforeStat.size === afterStat.size && beforeStat.mtimeMs === afterStat.mtimeMs, "VERIFY_IS_READ_ONLY", "verify changed index.html metadata");

  console.log("VERIFY_EXIT_CODE = 0");
  console.log("VERIFY_IS_READ_ONLY = PASS");
  console.log(`CSS_MANIFEST_COUNT = ${first.manifest.cssCount}`);
  console.log(`APPLICATION_MANIFEST_COUNT = ${first.manifest.applicationCount}`);
  console.log("CSS_MANIFEST_UNIQUE = PASS");
  console.log("APPLICATION_MANIFEST_UNIQUE = PASS");
  console.log("APPLICATION_FILES_EXIST = PASS");
  console.log("OLD_APPLICATION_MONOLITH_ABSENT = PASS");
  console.log("BOOT_FRAGMENT_IS_LAST = PASS");
  console.log("BINDINGS_BEFORE_BOOT = PASS");
  console.log("UNMANIFESTED_JS_DETECTION = PASS");
  console.log("UNMANIFESTED_CSS_DETECTION = PASS");
  console.log(`SCRIPT_SLOT_COUNT = ${artifact.scriptCount}`);
  console.log(`STYLE_BLOCK_COUNT = ${artifact.styleCount}`);
  console.log("THREE_SCRIPT_SLOT_MODEL = PASS");
  console.log("NOSTR_TOOLS_SLOT_ORDER = PASS");
  console.log("APPLICATION_SOURCE_INTEGRITY = PASS");
  console.log("CSS_SOURCE_INTEGRITY_ALL = PASS");
  console.log("HEAD_BOOTSTRAP_SYNTAX = PASS");
  console.log("NOSTR_SHIM_SYNTAX = PASS");
  console.log("APPLICATION_CONCAT_SYNTAX = PASS");
  console.log("FINAL_INLINE_SCRIPT_SYNTAX = PASS");
  console.log("CORE_SEMANTIC_MARKERS = PASS");
  console.log("HOME_ANCHOR_MARKER_PRESENT = PASS");
  console.log("DIAGNOSTICS_PATH_MARKER = PASS");
  console.log("DIAGNOSTICS_RELATIVE_URL_UNCHANGED = PASS");
  console.log("ROOT_INDEX_MATCHES_SOURCE = PASS");
  console.log("IN_MEMORY_REPRODUCIBLE_BUILD = PASS");
  console.log("BUILD_PERFORMS_POST_RENDER_VALIDATION = PASS");
  console.log("PERMANENT_BASELINE_HASH_HARDCODED = NO");
  console.log("VERSIONS_USED_AS_BUILD_INPUT = NO");
  console.log(`APPLICATION_CONCAT_SHA256 = ${sha256(first.application.source)}`);
  console.log(`ROOT_INDEX_SHA256 = ${sha256(actualBytes)}`);
} catch (error) {
  console.error(`WebHome build verification failed: ${error.message}`);
  process.exitCode = 1;
}
