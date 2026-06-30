/**
 * Public types for the Scheduler.
 */

import type { PooledContext } from "../pool/types.js";

export type { PooledContext };

export interface TestCase {
  id: string;
  name: string;
  fn: (ctx: PooledContext) => Promise<void>;
  /** Timeout in milliseconds. Defaults to 30000.
   * timeout は1試行あたりに適用される（全試行の合計ではない）。
   * 例: retries=2, timeout=5000 の場合、最大 15000ms かかりうる。
   */
  timeout?: number;
  /** Number of times to retry this test on failure. 0 means no retry. */
  retries?: number;
}

export interface TestResult {
  id: string;
  name: string;
  status: "passed" | "failed" | "timedOut";
  durationMs: number;
  error?: string;
  /** Path to the screenshot captured on failure/timeout. Only set when screenshot was taken. */
  screenshotPath?: string;
  /** Number of retries configured for this test. */
  retries?: number;
  /** Error messages from each failed attempt (excluding final passing attempt). */
  attempts?: string[];
}
