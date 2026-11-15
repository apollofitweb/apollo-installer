/**
 * DurableSecretStore - Persistent secret storage with AES-GCM encryption
 * OS-002: Production-ready secret store implementation
 * Zero secrets in logs, metadata, or database (only encrypted values)
 */

import { PrismaClient } from '@prisma/client';
import type { SecretStore, SecretMetadata } from './secret-store.js';
import { SecretVersionConflictError } from './secret-store.js';

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

interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64 (auth tag)
}

export class DurableSecretStore implements SecretStore {
  private readonly prisma: PrismaClient;
  private readonly masterKeyB64: string;
  private encryptionKey: globalThis.CryptoKey | null = null;
  private algorithm = 'AES-GCM';
  private keyLength = 256;
  private initialized = false;

  constructor(prisma: PrismaClient, masterKeyB64: string) {
    this.prisma = prisma;
    this.masterKeyB64 = masterKeyB64;
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    this.encryptionKey = await this.importKey(this.masterKeyB64);
    this.initialized = true;
  }

  private async importKey(masterKeyB64: string): Promise<globalThis.CryptoKey> {
    const keyData = Uint8Array.from(atob(masterKeyB64), c => c.charCodeAt(0));
    if (keyData.length !== 32) {
      throw new Error('Master key must be 32 bytes (256 bits) for AES-256-GCM');
    }
    return crypto.subtle.importKey(
      'raw',
      keyData,
      { name: this.algorithm },
      false,
      ['encrypt', 'decrypt']
    );
  }

  private async encrypt(plaintext: string, aad: string): Promise<EncryptedPayload> {
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV for GCM
    const aadData = encoder.encode(aad);

    const ciphertext = await crypto.subtle.encrypt(
      { name: this.algorithm, iv, additionalData: aadData },
      this.encryptionKey!,
      encoder.encode(plaintext)
    );

    // AES-GCM appends auth tag to ciphertext (last 16 bytes)
    const ciphertextArray = new Uint8Array(ciphertext);
    const tag = ciphertextArray.slice(-16);
    const actualCiphertext = ciphertextArray.slice(0, -16);

    return {
      ciphertext: btoa(String.fromCharCode(...actualCiphertext)),
      iv: btoa(String.fromCharCode(...iv)),
      tag: btoa(String.fromCharCode(...tag)),
    };
  }

  private async decrypt(payload: EncryptedPayload, aad: string): Promise<string> {
    const encoder = new TextEncoder();
    const aadData = encoder.encode(aad);

    const ciphertext = Uint8Array.from(atob(payload.ciphertext), c => c.charCodeAt(0));
    const iv = Uint8Array.from(atob(payload.iv), c => c.charCodeAt(0));
    const tag = Uint8Array.from(atob(payload.tag), c => c.charCodeAt(0));

    // Reconstruct ciphertext with tag appended
    const combined = new Uint8Array(ciphertext.length + tag.length);
    combined.set(ciphertext);
    combined.set(tag, ciphertext.length);

    try {
      const decrypted = await crypto.subtle.decrypt(
        { name: this.algorithm, iv, additionalData: aadData },
        this.encryptionKey!,
        combined
      );
      return new TextDecoder().decode(decrypted);
    } catch {
      throw new Error('Failed to decrypt secret: authentication failed or key mismatch');
    }
  }

  private buildAAD(deploymentId: string, scope: string, key: string): string {
    return `${deploymentId}:${scope}:${key}`;
  }

  // Deployment-scoped secrets
  async get(deploymentId: string, scope: 'deployment', key: string): Promise<string | null> {
    await this.initialize();
    const record = await this.prisma.deploymentSecret.findUnique({
      where: { deploymentId_scope_key: { deploymentId, scope, key } },
    });

    if (!record || record.deleted) return null;

    const aad = this.buildAAD(deploymentId, scope, key);
    const payload: EncryptedPayload = {
      ciphertext: record.valueEncrypted.split('.')[0],
      iv: record.valueEncrypted.split('.')[1],
      tag: record.valueEncrypted.split('.')[2],
    };

    return this.decrypt(payload, aad);
  }

  async set(deploymentId: string, scope: 'deployment', key: string, value: string, expectedVersion = 0): Promise<SecretMetadata> {
    await this.initialize();
    const current = await this.prisma.deploymentSecret.findUnique({
      where: { deploymentId_scope_key: { deploymentId, scope, key } },
    });

    const aad = this.buildAAD(deploymentId, scope, key);
    const payload = await this.encrypt(value, aad);
    const valueEncrypted = `${payload.ciphertext}.${payload.iv}.${payload.tag}`;

    if (current && !current.deleted) {
      if (current.version !== expectedVersion) {
        throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, current.version);
      }
      const newVersion = current.version + 1;
      await this.prisma.deploymentSecret.update({
        where: { deploymentId_scope_key: { deploymentId, scope, key } },
        data: {
          valueEncrypted,
          version: newVersion,
          updatedBy: 'system',
          deleted: false,
          updatedAt: new Date(),
        },
      });
      return { version: newVersion, updatedAt: new Date().toISOString(), updatedBy: 'system', deleted: false };
    }

    if (current && current.deleted) {
      if (current.version !== expectedVersion) {
        throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, current.version);
      }
      // Restore from tombstone
      await this.prisma.deploymentSecret.update({
        where: { deploymentId_scope_key: { deploymentId, scope, key } },
        data: {
          valueEncrypted,
          version: current.version + 1,
          updatedBy: 'system',
          deleted: false,
          updatedAt: new Date(),
        },
      });
      return { version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: 'system', deleted: false };
    }

    // New entry
    await this.prisma.deploymentSecret.create({
      data: {
        deploymentId,
        scope,
        key,
        valueEncrypted,
        version: 1,
        updatedBy: 'system',
        deleted: false,
      },
    });
    return { version: 1, updatedAt: new Date().toISOString(), updatedBy: 'system', deleted: false };
  }

  async delete(deploymentId: string, scope: 'deployment', key: string, expectedVersion: number): Promise<void> {
    await this.initialize();
    const current = await this.prisma.deploymentSecret.findUnique({
      where: { deploymentId_scope_key: { deploymentId, scope, key } },
    });

    if (!current) {
      if (expectedVersion !== 0) {
        throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, 0);
      }
      return;
    }

    if (current.version !== expectedVersion) {
      throw new SecretVersionConflictError(deploymentId, scope, key, expectedVersion, current.version);
    }

    await this.prisma.deploymentSecret.update({
      where: { deploymentId_scope_key: { deploymentId, scope, key } },
      data: {
        deleted: true,
        version: current.version + 1,
        updatedBy: 'system',
        updatedAt: new Date(),
      },
    });
  }

  async list(deploymentId: string, scope: 'deployment'): Promise<Record<string, SecretMetadata>> {
    await this.initialize();
    const records = await this.prisma.deploymentSecret.findMany({
      where: { deploymentId, scope, deleted: false },
    });

    const result: Record<string, SecretMetadata> = {};
    for (const record of records) {
      result[record.key] = {
        version: record.version,
        updatedAt: record.updatedAt.toISOString(),
        updatedBy: record.updatedBy,
        deleted: record.deleted,
      };
    }
    return result;
  }

  // Global scope methods
  async getGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken'): Promise<string | null> {
    await this.initialize();
    assertGlobalKey(key);
    const record = await this.prisma.globalSecret.findUnique({
      where: { scope_key: { scope, key } },
    });

    if (!record || record.deleted) return null;

    const aad = this.buildAAD('global', scope, key);
    const payload: EncryptedPayload = {
      ciphertext: record.valueEncrypted.split('.')[0],
      iv: record.valueEncrypted.split('.')[1],
      tag: record.valueEncrypted.split('.')[2],
    };

    return this.decrypt(payload, aad);
  }

  async setGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken', value: string, expectedVersion = 0): Promise<SecretMetadata> {
    await this.initialize();
    assertGlobalKey(key);
    const current = await this.prisma.globalSecret.findUnique({
      where: { scope_key: { scope, key } },
    });

    const aad = this.buildAAD('global', scope, key);
    const payload = await this.encrypt(value, aad);
    const valueEncrypted = `${payload.ciphertext}.${payload.iv}.${payload.tag}`;

    if (current && !current.deleted) {
      if (current.version !== expectedVersion) {
        throw new SecretVersionConflictError('global', scope, key, expectedVersion, current.version);
      }
      const newVersion = current.version + 1;
      await this.prisma.globalSecret.update({
        where: { scope_key: { scope, key } },
        data: {
          valueEncrypted,
          version: newVersion,
          updatedBy: 'system',
          deleted: false,
          updatedAt: new Date(),
        },
      });
      return { version: newVersion, updatedAt: new Date().toISOString(), updatedBy: 'system', deleted: false };
    }

    if (current && current.deleted) {
      if (current.version !== expectedVersion) {
        throw new SecretVersionConflictError('global', scope, key, expectedVersion, current.version);
      }
      await this.prisma.globalSecret.update({
        where: { scope_key: { scope, key } },
        data: {
          valueEncrypted,
          version: current.version + 1,
          updatedBy: 'system',
          deleted: false,
          updatedAt: new Date(),
        },
      });
      return { version: current.version + 1, updatedAt: new Date().toISOString(), updatedBy: 'system', deleted: false };
    }

    await this.prisma.globalSecret.create({
      data: {
        scope,
        key,
        valueEncrypted,
        version: 1,
        updatedBy: 'system',
        deleted: false,
      },
    });
    return { version: 1, updatedAt: new Date().toISOString(), updatedBy: 'system', deleted: false };
  }

  async deleteGlobal(scope: 'global', key: 'netlify.siteId' | 'netlify.authToken' | 'installer.jwtSigningSecret' | 'supabase.accessToken', expectedVersion: number): Promise<void> {
    await this.initialize();
    assertGlobalKey(key);
    const current = await this.prisma.globalSecret.findUnique({
      where: { scope_key: { scope, key } },
    });

    if (!current) {
      if (expectedVersion !== 0) {
        throw new SecretVersionConflictError('global', scope, key, expectedVersion, 0);
      }
      return;
    }

    if (current.version !== expectedVersion) {
      throw new SecretVersionConflictError('global', scope, key, expectedVersion, current.version);
    }

    await this.prisma.globalSecret.update({
      where: { scope_key: { scope, key } },
      data: {
        deleted: true,
        version: current.version + 1,
        updatedBy: 'system',
        updatedAt: new Date(),
      },
    });
  }

  async listGlobal(scope: 'global'): Promise<Record<string, SecretMetadata>> {
    await this.initialize();
    const records = await this.prisma.globalSecret.findMany({
      where: { scope, deleted: false },
    });

    const result: Record<string, SecretMetadata> = {};
    for (const record of records) {
      result[record.key] = {
        version: record.version,
        updatedAt: record.updatedAt.toISOString(),
        updatedBy: record.updatedBy,
        deleted: record.deleted,
      };
    }
    return result;
  }
}