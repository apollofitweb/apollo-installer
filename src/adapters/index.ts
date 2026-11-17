/**
 * Adapters module exports
 * OS-004 Fase 4: Inclui RealSupabaseAdapter para produção
 * OS-005: Inclui RealNetlifyAdapter para produção
 * Mock adapters preservados para testes e desenvolvimento
 */

export * from './base.js';
export * from './mock.js';
export * from './supabase/real-adapter.js';
export * from './supabase/client.js';
export * from './supabase/errors.js';
export * from './supabase/migrations.js';
export * from './netlify/real-adapter.js';

import type { AdapterFactory } from '../shared/types.js';
import { createMockSupabaseAdapter, createMockRenderAdapter, createMockNetlifyAdapter } from './mock.js';
import { RealSupabaseAdapter, createRealSupabaseAdapter, type RealSupabaseAdapterConfig } from './supabase/real-adapter.js';
import { RealNetlifyAdapter, createRealNetlifyAdapter, type RealNetlifyAdapterConfig } from './netlify/real-adapter.js';

/**
 * Creates an adapter factory that can use real or mock adapters based on configuration.
 *
 * @param config - Configuration object
 * @param config.useRealAdapters - If true, uses real adapters (Supabase, Netlify) with Management APIs
 * @param config.supabaseConfig - Configuration for RealSupabaseAdapter (accessToken, getGlobalSecret, etc.)
 * @param config.netlifyConfig - Configuration for RealNetlifyAdapter (authToken, getGlobalSecret, etc.)
 *
 * When useRealAdapters is true and getGlobalSecret is provided,
 * secrets are retrieved from SecretStore at initialization time, never exposed in logs.
 */
export function createAdapterFactory(config: {
  useRealAdapters?: boolean;
  supabaseConfig?: RealSupabaseAdapterConfig;
  netlifyConfig?: RealNetlifyAdapterConfig;
} = {}): AdapterFactory {
  const { useRealAdapters = false, supabaseConfig = {}, netlifyConfig = {} } = config;

  let realSupabaseAdapter: RealSupabaseAdapter | null = null;
  let realNetlifyAdapter: RealNetlifyAdapter | null = null;

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
    createNetlifyAdapter: async (_config: Record<string, unknown>) => {
      if (useRealAdapters) {
        if (!realNetlifyAdapter) {
          realNetlifyAdapter = await createRealNetlifyAdapter(netlifyConfig);
        }
        return realNetlifyAdapter;
      }
      return createMockNetlifyAdapter();
    },
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