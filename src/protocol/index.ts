/**
 * Protocol adapter factory.
 *
 * Usage:
 *   import { createAdapter } from './protocol/index.js';
 *   const adapter = createAdapter({ protocol: 'cdp' });
 *   await adapter.launch();
 */

import { CdpAdapter, type CdpAdapterOptions } from "./CdpAdapter.js";
import type { ProtocolAdapter } from "./ProtocolAdapter.js";

export type { ProtocolAdapter, ContextId, EvaluateResult } from "./ProtocolAdapter.js";
// GAP-4: CdpAdapterOptions is intentionally NOT re-exported here.
// Callers must use CreateAdapterOptions and never import CDP-internal types directly.

export type SupportedProtocol = "cdp"; // 'bidi' will be added in a future PR

export interface CreateAdapterOptions {
  protocol: SupportedProtocol;
  cdp?: CdpAdapterOptions;
}

/**
 * Factory that returns a `ProtocolAdapter` for the requested protocol.
 * The caller never imports CDP-specific types directly (AC-3, AC-5).
 */
export function createAdapter(options: CreateAdapterOptions): ProtocolAdapter {
  switch (options.protocol) {
    case "cdp":
      return new CdpAdapter(options.cdp);
    // When BiDi lands, add: case 'bidi': return new BidiAdapter(options.bidi);
    default: {
      const _exhaustive: never = options.protocol;
      throw new Error(`Unsupported protocol: ${String(_exhaustive)}`);
    }
  }
}
