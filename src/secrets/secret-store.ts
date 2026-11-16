/**
 * SecretStore - Gerenciamento seguro de segredos para Apollo Installer
 * Interface + InMemory implementation para testes (OS-002)
 * DurableSecretStore para produção (OS-002) com criptografia AES-GCM
 */

import { PrismaClient } from '@prisma/client';

export type SecretScope = 'deployment' | 'global';

export interface SecretMetadata {
  version: number;
  updatedAt: string;
  updatedBy: string;
  deleted?: boolean;
}

export interface SecretEntry {
  value: string;
  metadata: SecretMetadata;
}

export interface SecretStore {
  // Deployment-scoped secrets
  get(deploymentId: string, scope: 'deployment', key: string): Promise<string | null>;
  set(deploymentId: string, scope: 'deployment', key: string, value: string, expectedVersion?: number): Promise<SecretMetadata>;
  delete(deploymentId: string, scope: 'deployment', key: string, expectedVersion: number): Promise<void>;
  list(deploymentId: string, scope: 'deployment'): Promise<Record<string, SecretMetadata>>;

  // Global-scoped secrets (allowlist only: netlify.siteId, netlify.authToken, installer.jwtSigningSecret, supabase.accessToken)
  getGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken'): Promise<string | null>;
  setGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken', value: string, expectedVersion?: number): Promise<SecretMetadata>;
  deleteGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken', expectedVersion: number): Promise<void>;
  listGlobal(scope: 'global'): Promise<Record<string, SecretMetadata>>;
}

export class SecretVersionConflictError extends Error {
  constructor(
    public readonly deploymentId: string,
    public readonly scope: SecretScope,
    public readonly key: string,
    public readonly expectedVersion: number,
    public readonly currentVersion: number
  ) {
    super(
      `Version conflict for ${scope}/${key} in ${deploymentId}: expected ${expectedVersion}, current ${currentVersion}`
    );
    this.name = 'SecretVersionConflictError';
  }
}

// Allowlist of global-scoped keys
const GLOBAL_ALLOWLIST = new Set<string>([
  'netlify.siteId',
  'netlify.authToken',
  'installer.jwtSigningSecret',
  'supabase.accessToken',
]);

function assertGlobalKey(key: string): asserts key is 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken' {
  if (!GLOBAL_ALLOWLIST.has(key)) {
    throw new Error(`Global key not in allowlist: ${key}. Allowed: ${Array.from(GLOBAL_ALLOWLIST).join(', ')}`);
  }
}

interface InMemoryStore {
  deployments: Record<string, Record<string, Record<string, SecretEntry>>>;
  global: Record<string, SecretEntry>;
}

/**
 * InMemorySecretStore - Implementação em memória para testes
 * Não persistente entre reinicializações
 * USA SOMENTE EM TESTES (vitest)
 */
export class InMemorySecretStore implements SecretStore {
  private store: InMemoryStore = {
    deployments: {},
    global: {},
  };

  private getActor(): string {
    return 'test';
  }

  private getDeploymentScope(deploymentId: string, scope: 'deployment'): Record<string, SecretEntry> {
    if (!this.store.deployments[deploymentId]) {
      this.store.deployments[deploymentId] = { deployment: {} };
    }
    if (!this.store.deployments[deploymentId][scope]) {
      this.store.deployments[deploymentId][scope] = {};
    }
    return this.store.deployments[deploymentId][scope];
  }

  async get(deploymentId: string, scope: 'deployment', key: string): Promise<string | null> {
    const scopeData = this.getDeploymentScope(deploymentId, scope);
    const entry = scopeData[key];
    if (!entry || entry.metadata.deleted) return null;
    return entry.value;
  }

  async set(deploymentId: string, scope: 'deployment', key: string, value: string, expectedVersion = 0): Promise<SecretMetadata> {
    const scopeData = this.getDeploymentScope(deploymentId, scope);
    const current = scopeData[key];

    if (current && !current.metadata.deleted) {
      if (current.metadata.version !== expectedVersion) {
        throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, current.metadata.version);
      }
      const newVersion = current.metadata.version + 1;
      scopeData[key] = {
        value,
        metadata: {
          version: newVersion,
          updatedAt: new Date().toISOString(),
          updatedBy: this.getActor(),
          deleted: false,
        },
      };
      return scopeData[key].metadata;
    }

    if (current && current.metadata.deleted) {
      if (current.metadata.version !== expectedVersion) {
        throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, current.metadata.version);
      }
      // Restore from tombstone
      scopeData[key] = {
        value,
        metadata: {
          version: current.metadata.version + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: this.getActor(),
          deleted: false,
        },
      };
      return scopeData[key].metadata;
    }

    // New entry
    scopeData[key] = {
      value,
      metadata: {
        version: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: this.getActor(),
        deleted: false,
      },
    };
    return scopeData[key].metadata;
  }

  async delete(deploymentId: string, scope: 'deployment', key: string, expectedVersion: number): Promise<void> {
    const scopeData = this.getDeploymentScope(deploymentId, scope);
    const current = scopeData[key];

    if (!current) {
      if (expectedVersion !== 0) {
        throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, 0);
      }
      return; // Already doesn't exist (idempotent)
    }

    if (current.metadata.version !== expectedVersion) {
      throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, current.metadata.version);
    }

    // Tombstone: keep entry with deleted=true and incremented version
    scopeData[key] = {
      value: '',
      metadata: {
        version: current.metadata.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: this.getActor(),
        deleted: true,
      },
    };
  }

  async list(deploymentId: string, scope: 'deployment'): Promise<Record<string, SecretMetadata>> {
    const scopeData = this.getDeploymentScope(deploymentId, scope);
    const result: Record<string, SecretMetadata> = {};
    for (const [key, entry] of Object.entries(scopeData)) {
      if (!entry.metadata.deleted) {
        result[key] = entry.metadata;
      }
    }
    return result;
  }

  // Global scope methods
  async getGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken'): Promise<string | null> {
    assertGlobalKey(key);
    const entry = this.store.global[key];
    if (!entry || entry.metadata.deleted) return null;
    return entry.value;
  }

  async setGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken', value: string, expectedVersion = 0): Promise<SecretMetadata> {
    assertGlobalKey(key);
    const current = this.store.global[key];

    if (current && !current.metadata.deleted) {
      if (current.metadata.version !== expectedVersion) {
        throw new SecretVersionConflictError('global', scope, key, expectedVersion, current.metadata.version);
      }
      const newVersion = current.metadata.version + 1;
      this.store.global[key] = {
        value,
        metadata: {
          version: newVersion,
          updatedAt: new Date().toISOString(),
          updatedBy: this.getActor(),
          deleted: false,
        },
      };
      return this.store.global[key].metadata;
    }

    if (current && current.metadata.deleted) {
      if (current.metadata.version !== expectedVersion) {
        throw new SecretVersionConflictError('global', scope, key, expectedVersion, current.metadata.version);
      }
      this.store.global[key] = {
        value,
        metadata: {
          version: current.metadata.version + 1,
          updatedAt: new Date().toISOString(),
          updatedBy: this.getActor(),
          deleted: false,
        },
      };
      return this.store.global[key].metadata;
    }

    this.store.global[key] = {
      value,
      metadata: {
        version: 1,
        updatedAt: new Date().toISOString(),
        updatedBy: this.getActor(),
        deleted: false,
      },
    };
    return this.store.global[key].metadata;
  }

  async deleteGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken', expectedVersion: number): Promise<void> {
    assertGlobalKey(key);
    const current = this.store.global[key];

    if (!current) {
      if (expectedVersion !== 0) {
        throw new SecretVersionConflictError('global', scope, key, expectedVersion, 0);
      }
      return;
    }

    if (current.metadata.version !== expectedVersion) {
      throw new SecretVersionConflictError('global', scope, key, expectedVersion, current.metadata.version);
    }

    this.store.global[key] = {
      value: '',
      metadata: {
        version: current.metadata.version + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: this.getActor(),
        deleted: true,
      },
    };
  }

  async listGlobal(_scope: 'global'): Promise<Record<string, SecretMetadata>> {
    const result: Record<string, SecretMetadata> = {};
    for (const [key, entry] of Object.entries(this.store.global)) {
      if (!entry.metadata.deleted) {
        result[key] = entry.metadata;
      }
    }
    return result;
  }

  // Test helper - clear all data
  clear(): void {
    this.store = { deployments: {}, global: {} };
  }
}

/**
 * Factory para criar SecretStore apropriado (synchronous for tests)
 * Em testes: InMemorySecretStore
 * Em produção: use createDurableSecretStore (async)
 */
export function createSecretStore(): SecretStore {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) {
    return new InMemorySecretStore();
  }
  throw new Error('Use createDurableSecretStore() for production (requires PrismaClient and SECRETS_MASTER_KEY)');
}

/**
 * Async factory for production DurableSecretStore
 */
export async function createDurableSecretStore(prisma: PrismaClient): Promise<SecretStore> {
  const masterKey = process.env.SECRETS_MASTER_KEY;
  if (!masterKey) {
    throw new Error('SECRETS_MASTER_KEY environment variable required for DurableSecretStore');
  }
  const { DurableSecretStore } = await import('./durable-secret-store.js');
  return new DurableSecretStore(prisma, masterKey);
}

export { GLOBAL_ALLOWLIST };