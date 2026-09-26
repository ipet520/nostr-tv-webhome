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
  ["__WEBHOME_BUILD_SCRIPT_APPLICATION__", "js/02-application.js"],
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

function build() {
  let output = readFileSync(templatePath, "utf8");
  const slots = [...cssFiles, ...scriptFiles];
  const seenSlots = new Set();

  for (const [slot, relativePath] of slots) {
    if (seenSlots.has(slot)) {
      throw new Error(`Duplicate manifest slot: ${slot}`);
    }
    seenSlots.add(slot);

    const count = countOccurrences(output, slot);
    if (count !== 1) {
      throw new Error(`Build slot ${slot} expected exactly once, found ${count}`);
    }

    const content = readFileSync(resolve(sourceRoot, relativePath), "utf8");
    output = output.replace(slot, () => content);
  }

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
