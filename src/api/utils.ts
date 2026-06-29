/**
 * Shared utilities for the API layer.
 */

/**
 * Escape a CSS selector string for safe embedding inside a single-quoted
 * JavaScript string literal (e.g. `document.querySelector('...')`).
 *
 * Escapes backslashes first, then single-quotes.
 */
export function escapeSelector(selector: string): string {
  return selector.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
