import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const sourceRoot = resolve(repoRoot, "src");
const templatePath = resolve(sourceRoot, "index.template.html");
const outputPath = resolve(repoRoot, "index.html");

const cssFiles = [
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
];

const scriptFiles = [
  ["__WEBHOME_BUILD_SCRIPT_HEAD__", "js/00-head-bootstrap.js"],
  ["__WEBHOME_BUILD_SCRIPT_NOSTR__", "js/01-nostr-tools-shim.js"],
];

const applicationSlot = "__WEBHOME_BUILD_SCRIPT_APPLICATION__";
const applicationFiles = [
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
];

function countOccurrences(source, token) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(token, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + token.length;
  }
}

function readExact(relativePath) {
  return readFileSync(resolve(sourceRoot, relativePath), "utf8");
}

function replaceSlot(output, slot, content) {
  const count = countOccurrences(output, slot);
  if (count !== 1) {
    throw new Error(`Build slot ${slot} expected exactly once, found ${count}`);
  }
  return output.replace(slot, () => content);
}

function applicationSource() {
  if (applicationFiles.length !== 21) {
    throw new Error(`Application manifest expected 21 fragments, found ${applicationFiles.length}`);
  }
  const seenFiles = new Set();
  for (const relativePath of applicationFiles) {
    if (relativePath === "02-application.js") {
      throw new Error("Application manifest must not contain 02-application.js");
    }
    if (seenFiles.has(relativePath)) {
      throw new Error(`Duplicate application fragment: ${relativePath}`);
    }
    seenFiles.add(relativePath);
  }
  return applicationFiles.map((relativePath) => readExact(`js/${relativePath}`)).join("");
}

function build() {
  let output = readFileSync(templatePath, "utf8");
  const seenSlots = new Set();

  for (const [slot, relativePath] of [...cssFiles, ...scriptFiles]) {
    if (seenSlots.has(slot)) {
      throw new Error(`Duplicate manifest slot: ${slot}`);
    }
    seenSlots.add(slot);
    output = replaceSlot(output, slot, readExact(relativePath));
  }

  if (seenSlots.has(applicationSlot)) {
    throw new Error(`Duplicate manifest slot: ${applicationSlot}`);
  }
  seenSlots.add(applicationSlot);
  output = replaceSlot(output, applicationSlot, applicationSource());

  const unknownSlots = output.match(/__WEBHOME_BUILD_[A-Z0-9_]+__/g);
  if (unknownSlots) {
    throw new Error(`Unknown build slot(s): ${[...new Set(unknownSlots)].join(", ")}`);
  }

  writeFileSync(outputPath, output, "utf8");
}

try {
  build();
} catch (error) {
  console.error(`WebHome build failed: ${error.message}`);
  process.exitCode = 1;
}
