/**
 * Route — represents an intercepted HTTP request.
 *
 * AC-2: Provides fulfill / continue / abort methods.
 */

export interface FulfillOptions {
  /** HTTP status code. Defaults to 200. */
  status?: number;
  /** Response headers. */
  headers?: Record<string, string>;
  /** Raw response body as a string. */
  body?: string;
  /** JSON body — serialised and sent with Content-Type: application/json. */
  json?: unknown;
}

export class Route {
  /**
   * AC-7: Guard flag — set to true once any of fulfill/continue/abort is called.
   * Subsequent calls on the same Route instance will throw "Route already settled".
   * Also used by Page._handleInterceptedRequest to detect handlers that forgot to
   * call any of these methods (fallback to continue()).
   */
  _handled = false;

  constructor(
    /** Opaque requestId provided by the adapter (e.g. CDP Fetch requestId). */
    readonly requestId: string,
    private readonly _fulfill: (opts: FulfillOptions) => Promise<void>,
    private readonly _continue: () => Promise<void>,
    private readonly _abort: () => Promise<void>,
  ) {}

  /**
   * Respond to the intercepted request with a mock response.
   * AC-2: route.fulfill({ status?, headers?, body?, json? })
   */
  async fulfill(options: FulfillOptions): Promise<void> {
    if (this._handled) throw new Error("Route already settled");
    this._handled = true;
    await this._fulfill(options);
  }

  /**
   * Forward the request to the real server unchanged.
   * AC-2: route.continue()
   */
  async continue(): Promise<void> {
    if (this._handled) throw new Error("Route already settled");
    this._handled = true;
    await this._continue();
  }

  /**
   * Abort the request.
   * AC-2: route.abort()
   */
  async abort(): Promise<void> {
    if (this._handled) throw new Error("Route already settled");
    this._handled = true;
    await this._abort();
  }
}
