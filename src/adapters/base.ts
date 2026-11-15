/**
 * Base adapter interface for external services
 * OS-002: Interfaces only - no real implementations
 * Re-exports from shared/types.ts to avoid circular imports
 */

export type {
  Adapter,
  SupabaseAdapter,
  RenderAdapter,
  NetlifyAdapter,
  AdapterFactory,
} from '../shared/types.js';