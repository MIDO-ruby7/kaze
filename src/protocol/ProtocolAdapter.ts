/**
 * ProtocolAdapter — browser-protocol-agnostic interface.
 *
 * Upper layers use this interface exclusively; no CDP or BiDi types leak
 * through (AC-1, AC-5).
 */

/** Opaque identifier for a browser top-level context (tab / target). */
export type ContextId = string;

/** Result of evaluating a JavaScript expression in a context. */
export type EvaluateResult = unknown;

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
   * Close the browser process and release all resources.
   */
  close(): Promise<void>;
}
