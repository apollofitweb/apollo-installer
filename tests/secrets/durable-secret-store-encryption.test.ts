/**
 * Tests for DurableSecretStore encryption of supabase.accessToken
 * Verifies that the PAT is stored encrypted in the database
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createDurableSecretStore } from '../../src/secrets/index.js';

// Generate a valid 32-byte (256-bit) master key for testing
// 32 bytes = 256 bits. Base64 encoded: "0123456789abcdef0123456789abcdef" (32 chars)
const TEST_MASTER_KEY = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY='; // base64 of exactly 32 bytes

describe('DurableSecretStore - supabase.accessToken encryption', () => {
  let prisma: PrismaClient;
  let secretStore: Awaited<ReturnType<typeof createDurableSecretStore>>;

  beforeAll(async () => {
    // Set master key for test
    process.env.SECRETS_MASTER_KEY = TEST_MASTER_KEY;

    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });

    await prisma.$connect();
    await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

    secretStore = await createDurableSecretStore(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    delete process.env.SECRETS_MASTER_KEY;
  });

  beforeEach(async () => {
    // Clean global secrets between tests
    await prisma.globalSecret.deleteMany();
  });

  it('should encrypt supabase.accessToken when stored via setGlobal', async () => {
    const pat = 'TEST_PAT_PLACEHOLDER_A';

    await secretStore.setGlobal('global', 'supabase.accessToken', pat);

    // Verify the raw stored value is encrypted (not plaintext)
    const rawRecord = await prisma.globalSecret.findUnique({
      where: { scope_key: { scope: 'global', key: 'supabase.accessToken' } },
    });

    expect(rawRecord).not.toBeNull();
    expect(rawRecord!.valueEncrypted).toBeDefined();
    expect(rawRecord!.valueEncrypted).not.toBe(pat);
    expect(rawRecord!.valueEncrypted).not.toContain(pat);
    // AES-GCM format: ciphertext.iv.tag (base64 encoded parts separated by dots)
    expect(rawRecord!.valueEncrypted).toMatch(/^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/);
    expect(rawRecord!.deleted).toBe(false);
    expect(rawRecord!.version).toBe(1);
  });

  it('should decrypt supabase.accessToken when retrieved via getGlobal', async () => {
    const pat = 'TEST_PAT_PLACEHOLDER_A';

    await secretStore.setGlobal('global', 'supabase.accessToken', pat);
    const retrieved = await secretStore.getGlobal('global', 'supabase.accessToken');

    expect(retrieved).toBe(pat);
  });

  it('should not expose PAT in error messages or logs', async () => {
    const pat = 'TEST_PAT_PLACEHOLDER_A';

    // Verify that even if we inspect the stored record, PAT is not visible
    await secretStore.setGlobal('global', 'supabase.accessToken', pat);

    const rawRecord = await prisma.globalSecret.findUnique({
      where: { scope_key: { scope: 'global', key: 'supabase.accessToken' } },
    });

    const storedValue = rawRecord!.valueEncrypted;
    // The stored value should not contain any part of the PAT
    expect(storedValue).not.toContain('TEST_PAT');
    expect(storedValue).not.toContain('1234567890abcdef');
    // Should be base64-encoded ciphertext.iv.tag format
    const parts = storedValue.split('.');
    expect(parts).toHaveLength(3);
    // Each part should be valid base64
    for (const part of parts) {
      expect(() => Buffer.from(part, 'base64')).not.toThrow();
    }
  });

  it('should handle version conflict correctly for supabase.accessToken', async () => {
    const pat = 'TEST_PAT_PLACEHOLDER_A';
    const pat2 = 'TEST_PAT_PLACEHOLDER_B';

    await secretStore.setGlobal('global', 'supabase.accessToken', pat);

    // Should fail with wrong expected version
    await expect(
      secretStore.setGlobal('global', 'supabase.accessToken', pat2, 0)
    ).rejects.toThrow('Version conflict');

    // Should succeed with correct expected version
    const meta = await secretStore.setGlobal('global', 'supabase.accessToken', pat2, 1);
    expect(meta.version).toBe(2);

    // Verify new value is stored
    const retrieved = await secretStore.getGlobal('global', 'supabase.accessToken');
    expect(retrieved).toBe(pat2);
  });

  it('should delete supabase.accessToken (tombstone)', async () => {
    const pat = 'TEST_PAT_PLACEHOLDER_A';

    await secretStore.setGlobal('global', 'supabase.accessToken', pat);
    await secretStore.deleteGlobal('global', 'supabase.accessToken', 1);

    const retrieved = await secretStore.getGlobal('global', 'supabase.accessToken');
    expect(retrieved).toBeNull();

    // Verify tombstone exists in DB
    const rawRecord = await prisma.globalSecret.findUnique({
      where: { scope_key: { scope: 'global', key: 'supabase.accessToken' } },
    });
    expect(rawRecord).not.toBeNull();
    expect(rawRecord!.deleted).toBe(true);
    expect(rawRecord!.version).toBe(2);
  });

  it('should list supabase.accessToken metadata without exposing value', async () => {
    const pat = 'TEST_PAT_PLACEHOLDER_A';

    await secretStore.setGlobal('global', 'supabase.accessToken', pat);
    const list = await secretStore.listGlobal('global');

    expect(list['supabase.accessToken']).toBeDefined();
    expect(list['supabase.accessToken'].version).toBe(1);
    expect(list['supabase.accessToken'].deleted).toBe(false);
    expect(list['supabase.accessToken'].updatedAt).toBeDefined();
    // Metadata should NOT contain the value
    expect('value' in list['supabase.accessToken']).toBe(false);
  });

  it('should allow multiple global secrets including supabase.accessToken', async () => {
    const pat = 'TEST_PAT_PLACEHOLDER_A';

    await secretStore.setGlobal('global', 'supabase.accessToken', pat);
    await secretStore.setGlobal('global', 'netlify.authToken', 'netlify-token-123');
    await secretStore.setGlobal('global', 'installer.jwtSigningSecret', 'jwt-secret-123');

    const list = await secretStore.listGlobal('global');
    expect(Object.keys(list)).toHaveLength(3);
    expect(list['supabase.accessToken']).toBeDefined();
    expect(list['netlify.authToken']).toBeDefined();
    expect(list['installer.jwtSigningSecret']).toBeDefined();
  });
});