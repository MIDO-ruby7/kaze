/**
 * html-reporter.ts — generates a self-contained HTML test report.
 *
 * AC-1: invoked when --reporter=html or config reporter: "html"
 * AC-2: output path is <outputDir>/index.html (default: .kaze/report)
 * AC-3: includes summary, test list, error messages, inline screenshots
 * AC-4: no external resources — styles are inlined in <style> tag
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { TestResult } from "../scheduler/types.js";

// ---------------------------------------------------------------------------
// HTML generation
// ---------------------------------------------------------------------------

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function statusLabel(status: TestResult["status"]): string {
  switch (status) {
    case "passed":
      return "PASSED";
    case "failed":
      return "FAILED";
    case "timedOut":
      return "TIMED OUT";
  }
}

function statusClass(status: TestResult["status"]): string {
  switch (status) {
    case "passed":
      return "passed";
    case "failed":
      return "failed";
    case "timedOut":
      return "timedout";
  }
}

function screenshotToBase64(filePath: string): string | null {
  try {
    const data = fs.readFileSync(filePath);
    const b64 = data.toString("base64");
    // Detect image type by magic bytes
    const sig = data.slice(0, 4);
    let mime = "image/png";
    if (sig[0] === 0xff && sig[1] === 0xd8) mime = "image/jpeg";
    else if (sig[0] === 0x47 && sig[1] === 0x49) mime = "image/gif";
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  }
}

/**
 * Generates a complete, self-contained HTML report string.
 */
export function generateHtml(
  results: TestResult[],
  opts?: { title?: string; duration?: number }
): string {
  const title = opts?.title ?? "kaze test report";
  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const timedOut = results.filter((r) => r.status === "timedOut").length;
  const durationStr =
    opts?.duration !== undefined ? (opts.duration / 1000).toFixed(1) + "s" : "—";

  const testRows = results
    .map((r) => {
      const cls = statusClass(r.status);
      const label = statusLabel(r.status);
      const dur = r.durationMs + "ms";

      let errorBlock = "";
      if (r.error && r.status !== "passed") {
        errorBlock = `<div class="error"><pre>${escapeHtml(r.error)}</pre></div>`;
      }
      if (r.attempts && r.attempts.length > 0) {
        const attemptsHtml = r.attempts
          .map((a, i) => `<div>Attempt ${i + 1}: ${escapeHtml(a)}</div>`)
          .join("");
        errorBlock += `<div class="attempts">${attemptsHtml}</div>`;
      }

      let screenshotBlock = "";
      if (r.screenshotPath) {
        const dataUrl = screenshotToBase64(r.screenshotPath);
        if (dataUrl) {
          screenshotBlock = `<div class="screenshot"><img src="${dataUrl}" alt="screenshot" /></div>`;
        }
      }

      return `
    <div class="test ${cls}">
      <div class="test-header">
        <span class="status-badge ${cls}">${label}</span>
        <span class="test-name">${escapeHtml(r.name)}</span>
        <span class="test-duration">${dur}</span>
      </div>
      ${errorBlock}${screenshotBlock}
    </div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
      background: #f5f5f5;
      color: #333;
    }
    h1 { font-size: 1.5rem; margin-bottom: 16px; }
    .summary {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      background: #fff;
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .summary-item { text-align: center; min-width: 80px; }
    .summary-item .value { font-size: 2rem; font-weight: bold; }
    .summary-item .label { font-size: 0.75rem; color: #666; text-transform: uppercase; }
    .summary-item.passed .value { color: #16a34a; }
    .summary-item.failed .value { color: #dc2626; }
    .summary-item.timedout .value { color: #d97706; }
    .summary-item.total .value { color: #2563eb; }
    .summary-item.duration .value { font-size: 1.5rem; }
    .tests { display: flex; flex-direction: column; gap: 8px; }
    .test {
      background: #fff;
      border-radius: 6px;
      padding: 12px 16px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.08);
      border-left: 4px solid #d1d5db;
    }
    .test.passed { border-left-color: #16a34a; }
    .test.failed { border-left-color: #dc2626; }
    .test.timedout { border-left-color: #d97706; }
    .test-header {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .status-badge {
      font-size: 0.7rem;
      font-weight: bold;
      padding: 2px 6px;
      border-radius: 3px;
      text-transform: uppercase;
      flex-shrink: 0;
    }
    .status-badge.passed { background: #dcfce7; color: #16a34a; }
    .status-badge.failed { background: #fee2e2; color: #dc2626; }
    .status-badge.timedout { background: #fef3c7; color: #d97706; }
    .test-name { flex: 1; font-size: 0.95rem; }
    .test-duration { font-size: 0.8rem; color: #888; flex-shrink: 0; }
    .error {
      margin-top: 8px;
      background: #fff0f0;
      border-left: 3px solid #dc2626;
      padding: 8px 12px;
      border-radius: 0 4px 4px 0;
    }
    .error pre {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 0.85rem;
      white-space: pre-wrap;
      word-break: break-all;
      color: #b91c1c;
    }
    .attempts {
      margin-top: 6px;
      font-size: 0.82rem;
      color: #666;
    }
    .screenshot { margin-top: 10px; }
    .screenshot img { max-width: 100%; border-radius: 4px; border: 1px solid #e5e7eb; }
    footer { margin-top: 24px; font-size: 0.75rem; color: #aaa; text-align: center; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="summary">
    <div class="summary-item total">
      <div class="value">${total}</div>
      <div class="label">Total</div>
    </div>
    <div class="summary-item passed">
      <div class="value">${passed}</div>
      <div class="label">Passed</div>
    </div>
    <div class="summary-item failed">
      <div class="value">${failed}</div>
      <div class="label">Failed</div>
    </div>
    <div class="summary-item timedout">
      <div class="value">${timedOut}</div>
      <div class="label">Timed Out</div>
    </div>
    <div class="summary-item duration">
      <div class="value">${durationStr}</div>
      <div class="label">Duration</div>
    </div>
  </div>
  <div class="tests">
${testRows}
  </div>
  <footer>Generated by kaze</footer>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// File output
// ---------------------------------------------------------------------------

/**
 * Writes the HTML report to <outputDir>/index.html.
 * Creates the directory if it does not exist.
 * Returns the absolute path of the written file.
 */
export async function writeHtmlReport(
  results: TestResult[],
  outputDir: string,
  opts?: { duration?: number; title?: string }
): Promise<string> {
  fs.mkdirSync(outputDir, { recursive: true });
  const html = generateHtml(results, opts);
  const outPath = path.join(outputDir, "index.html");
  fs.writeFileSync(outPath, html, "utf8");
  return outPath;
}
