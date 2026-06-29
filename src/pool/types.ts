/**
 * Public types for the Browser Pool.
 */

export interface PooledContext {
  contextId: string;
  adapterId: string;
  /**
   * AC-11: Optional cancellation hook registered by the Page that is currently
   * using this context.  Scheduler calls this when a test times out so that
   * any in-flight waitForSelector polling stops before the context is recycled.
   * The field is optional to keep pool-internal code free of Page dependencies.
   */
  _cancel?: () => void;
}

export interface PoolStats {
  totalContexts: number;
  busy: number;
  idle: number;
  processes: number;
  crashes: number;
}
