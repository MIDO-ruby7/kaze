/**
 * kaze performance regression check.
 *
 * Reads benchmark/perf-results.json and compares each metric against
 * benchmark/perf-baseline.json. Exits non-zero if any metric exceeds its baseline.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const resultsPath = join(__dirname, "perf-results.json");
const baselinePath = join(__dirname, "perf-baseline.json");

// Check files exist
if (!existsSync(resultsPath)) {
  console.error(`Error: ${resultsPath} not found. Run 'pnpm bench' first.`);
  process.exit(1);
}

if (!existsSync(baselinePath)) {
  console.error(`Error: ${baselinePath} not found.`);
  process.exit(1);
}

interface PerfResults {
  timestamp: string;
  gitCommit: string;
  results: Record<string, number>;
}

const resultsFile = JSON.parse(readFileSync(resultsPath, "utf8")) as PerfResults;
const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as Record<string, number>;

const results = resultsFile.results;

// Label formatting for display
const labelMap: Record<string, string> = {
  contextReset_ms: "contextReset_ms",
  navigate_ms: "navigate_ms",
  evaluate_ms: "evaluate_ms",
  newContext_ms: "newContext_ms",
  throughput_10_ms_per_test: "throughput_10",
  throughput_20_ms_per_test: "throughput_20",
};

const unitMap: Record<string, string> = {
  contextReset_ms: "ms",
  navigate_ms: "ms",
  evaluate_ms: "ms",
  newContext_ms: "ms",
  throughput_10_ms_per_test: "ms/t",
  throughput_20_ms_per_test: "ms/t",
};

console.log("Performance check:");

let hasRegression = false;

for (const key of Object.keys(baseline)) {
  const actual = results[key];
  const limit = baseline[key];
  const label = labelMap[key] ?? key;
  const unit = unitMap[key] ?? "ms";

  // If metric is 0 (KAZE_SKIP_E2E placeholder), skip the check
  if (actual === 0) {
    console.log(`  ${label.padEnd(22)}: skipped (KAZE_SKIP_E2E)`);
    continue;
  }

  const actualStr = `${actual}${unit}`;
  const baselineStr = `${limit}${unit}`;

  if (actual > limit) {
    const ratio = (actual / limit).toFixed(1);
    console.log(
      `  ${label.padEnd(22)}: ${actualStr.padStart(10)}  x REGRESSION (baseline: ${baselineStr}, ${ratio}x over limit)`,
    );
    hasRegression = true;
  } else {
    console.log(
      `  ${label.padEnd(22)}: ${actualStr.padStart(10)}  v (baseline: ${baselineStr})`,
    );
  }
}

console.log("");

if (hasRegression) {
  console.log("Performance regression detected! Run `pnpm bench` to investigate.");
  process.exit(1);
} else {
  console.log("All performance checks passed.");
  process.exit(0);
}
