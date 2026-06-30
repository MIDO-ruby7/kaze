/**
 * reporter.ts — formats test results as verbose or dot output.
 */

import type { TestResult } from "../scheduler/types.js";

export type ReporterMode = "verbose" | "dot" | "html";

export interface ReportSummary {
  passed: number;
  failed: number;
  timedOut: number;
  totalMs: number;
}

/**
 * Print results and return a summary.
 *
 * @param shard  When provided, prints a `[Shard N/M]` prefix line in verbose mode (AC-5).
 */
export function report(
  results: TestResult[],
  mode: ReporterMode,
  shard?: { index: number; total: number }
): ReportSummary {
  let passed = 0;
  let failed = 0;
  let timedOut = 0;
  let totalMs = 0;

  // AC-5: show shard prefix in verbose mode
  if (mode === "verbose" && shard) {
    console.log(`[Shard ${shard.index}/${shard.total}]`);
  }

  if (mode === "dot") {
    const dots: string[] = [];
    for (const r of results) {
      totalMs += r.durationMs;
      if (r.status === "passed") {
        passed++;
        dots.push(".");
      } else if (r.status === "timedOut") {
        timedOut++;
        dots.push("T");
      } else {
        failed++;
        dots.push("F");
      }
    }
    process.stdout.write(dots.join("") + "\n\n");
  } else {
    // verbose
    for (const r of results) {
      totalMs += r.durationMs;
      if (r.status === "passed") {
        passed++;
        console.log(`  ✓ ${r.name} (${r.durationMs}ms)`);
      } else if (r.status === "timedOut") {
        timedOut++;
        const attemptCount = r.attempts?.length ?? 1;
        const retryLabel = attemptCount > 1 ? ` (failed after ${attemptCount} attempts)` : " (timed out)";
        console.log(`  T ${r.name}${retryLabel}`);
        if (r.attempts && r.attempts.length > 0) {
          r.attempts.forEach((msg, i) => {
            console.log(`    Attempt ${i + 1}: ${msg}`);
          });
        } else if (r.error) {
          console.log(`    └ ${r.error}`);
        }
        if (r.screenshotPath) {
          console.log(`    screenshot: ${r.screenshotPath}`);
        }
      } else {
        failed++;
        const attemptCount = r.attempts?.length ?? 0;
        const retryLabel = attemptCount > 1 ? ` (failed after ${attemptCount} attempts)` : "";
        console.log(`  ✗ ${r.name}${retryLabel}`);
        if (r.attempts && r.attempts.length > 0) {
          r.attempts.forEach((msg, i) => {
            console.log(`    Attempt ${i + 1}: ${msg}`);
          });
        } else if (r.error) {
          console.log(`    └ ${r.error}`);
        }
        if (r.screenshotPath) {
          console.log(`    screenshot: ${r.screenshotPath}`);
        }
      }
    }
    console.log("");
  }

  const total = passed + failed + timedOut;
  const parts: string[] = [];
  if (passed > 0) parts.push(`${passed} passed`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (timedOut > 0) parts.push(`${timedOut} timed out`);
  const timeS = (totalMs / 1000).toFixed(1);
  console.log(`Tests: ${parts.join(", ")}  Total: ${total}  Time: ${timeS}s`);

  return { passed, failed, timedOut, totalMs };
}
