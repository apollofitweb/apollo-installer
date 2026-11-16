/**
 * Adapters module exports
 * OS-004 Fase 4: Inclui RealSupabaseAdapter para produção
 * MockSupabaseAdapter preservado para testes e desenvolvimento
 */

export * from './base.js';
export * from './mock.js';
export * from './supabase/real-adapter.js';
export * from './supabase/client.js';
export * from './supabase/errors.js';
export * from './supabase/migrations.js';

import type { AdapterFactory } from '../shared/types.js';
import { createMockSupabaseAdapter, createMockRenderAdapter, createMockNetlifyAdapter } from './mock.js';
import { RealSupabaseAdapter, createRealSupabaseAdapter, type RealSupabaseAdapterConfig } from './supabase/real-adapter.js';

/**
 * Creates an adapter factory that can use real or mock adapters based on configuration.
 *
 * @param config - Configuration object
 * @param config.useRealAdapters - If true, uses real Supabase adapter with Management API
 * @param config.supabaseConfig - Configuration for RealSupabaseAdapter (accessToken, getGlobalSecret, etc.)
 *
 * When useRealAdapters is true and supabaseConfig.getGlobalSecret is provided,
 * the PAT is retrieved from SecretStore at initialization time, never exposed in logs.
 */
export function createAdapterFactory(config: {
  useRealAdapters?: boolean;
  supabaseConfig?: RealSupabaseAdapterConfig;
} = {}): AdapterFactory {
  const { useRealAdapters = false, supabaseConfig = {} } = config;

  let realSupabaseAdapter: RealSupabaseAdapter | null = null;

  return {
    createSupabaseAdapter: async (_config: Record<string, unknown>) => {
      if (useRealAdapters) {
        if (!realSupabaseAdapter) {
          realSupabaseAdapter = await createRealSupabaseAdapter(supabaseConfig);
        }
        return realSupabaseAdapter;
      }
      return createMockSupabaseAdapter();
    },
    createRenderAdapter: (_config: Record<string, unknown>) => createMockRenderAdapter(),
    createNetlifyAdapter: (_config: Record<string, unknown>) => createMockNetlifyAdapter(),
  };
}

/**
 * Backward-compatible synchronous factory for tests and development.
 * Always returns mock adapters.
 */
export function createMockAdapterFactory(): AdapterFactory {
  return {
    createSupabaseAdapter: () => createMockSupabaseAdapter(),
    createRenderAdapter: () => createMockRenderAdapter(),
    createNetlifyAdapter: () => createMockNetlifyAdapter(),
  };
}