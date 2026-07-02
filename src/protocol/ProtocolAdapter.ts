/**
 * ProtocolAdapter — browser-protocol-agnostic interface.
 *
 * Upper layers use this interface exclusively; no CDP or BiDi types leak
 * through (AC-1, AC-5).
 */

import type { FulfillOptions } from "../api/Route.js";

/** Opaque identifier for a browser top-level context (tab / target). */
export type ContextId = string;

/** Result of evaluating a JavaScript expression in a context. */
export type EvaluateResult = unknown;

/** A request intercepted via enableRequestInterception. */
export interface InterceptedRequest {
  requestId: string;
  url: string;
}

export interface ProtocolAdapter {
  /**
   * Launch the browser process.
   * Must be called before any other method.
   */
  launch(): Promise<void>;

  /**
   * Create a new top-level browsing context (tab / target).
   * Returns an opaque contextId.
   */
  newContext(): Promise<ContextId>;

  /**
   * Close a previously created context.
   */
  closeContext(contextId: ContextId): Promise<void>;

  /**
   * Navigate the given context to `url`.
   * Resolves when the navigation is committed.
   */
  navigate(contextId: ContextId, url: string): Promise<void>;

  /**
   * Evaluate a JavaScript expression inside the given context.
   * Returns the serialised result.
   */
  evaluate(contextId: ContextId, expression: string): Promise<EvaluateResult>;

  /**
   * Dispatch a synthetic DOM event on the first element matching `selector`
   * inside the given context.
   */
  dispatchEvent(
    contextId: ContextId,
    selector: string,
    event: string,
  ): Promise<void>;

  /**
   * Reset a context to a fully clean state without closing and recreating it.
   * Clears cookies (including HttpOnly), localStorage, IndexedDB, Service Workers,
   * and navigates to about:blank to reset DOM and JS globals.
   *
   * Much faster than closeContext() + newContext() (~20ms vs ~700ms).
   * Implementations that don't support this can omit it; BrowserPool will fall
   * back to the close+create cycle.
   */
  resetContext?(contextId: ContextId): Promise<void>;

  /**
   * Fill an input element using CDP Input.insertText — real browser-level typing
   * that triggers native input events for React, Vue, Angular, and plain HTML.
   */
  fillInput?(contextId: ContextId, selector: string, value: string): Promise<void>;

  /**
   * Dispatch a real (CDP-level) keyboard key press.
   * Triggers form submission, IME, and other browser behaviors that
   * JS-dispatched keyboard events cannot.
   */
  pressKey?(contextId: ContextId, key: string): Promise<void>;

  /**
   * Capture a PNG screenshot of the given context.
   * Returns the raw PNG bytes as a Buffer.
   * Optional — implementations that don't support this can omit it.
   */
  screenshot?(contextId: ContextId): Promise<Buffer>;

  /**
   * Enable HTTP request interception for the given context.
   * Optional — omit if not supported.
   */
  enableRequestInterception?(contextId: ContextId): Promise<void>;

  /**
   * Disable HTTP request interception for the given context.
   * Optional — omit if not supported.
   */
  disableRequestInterception?(contextId: ContextId): Promise<void>;

  /**
   * Respond to an intercepted request with a mock response.
   * Optional — omit if not supported.
   */
  fulfillRequest?(contextId: ContextId, requestId: string, opts: FulfillOptions): Promise<void>;

  /**
   * Forward an intercepted request to the real server.
   * Optional — omit if not supported.
   */
  continueRequest?(contextId: ContextId, requestId: string): Promise<void>;

  /**
   * Abort an intercepted request.
   * Optional — omit if not supported.
   */
  abortRequest?(contextId: ContextId, requestId: string): Promise<void>;

  /**
   * Register a listener for intercepted requests in a context.
   * Returns an unsubscribe function.
   * Optional — omit if not supported.
   */
  onRequest?(
    contextId: ContextId,
    handler: (req: InterceptedRequest) => void,
  ): () => void;

  /**
   * Close the browser process and release all resources.
   */
  close(): Promise<void>;
}
