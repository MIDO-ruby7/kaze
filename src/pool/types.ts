/**
 * Public types for the Browser Pool.
 */

export interface PooledContext {
  contextId: string;
  adapterId: string;
}

export interface PoolStats {
  totalContexts: number;
  busy: number;
  idle: number;
  processes: number;
  crashes: number;
}
