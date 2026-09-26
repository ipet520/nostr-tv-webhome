import { writeFileSync } from "node:fs";
import {
  outputPath,
  renderIndex,
  validateRenderedArtifact,
} from "./build-core.mjs";

try {
  const rendered = renderIndex();
  validateRenderedArtifact(rendered.output);
  writeFileSync(outputPath, rendered.output, "utf8");
} catch (error) {
  console.error(`WebHome build failed: ${error.message}`);
  process.exitCode = 1;
}
