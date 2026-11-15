/**
 * Secrets module exports
 */

export { InMemorySecretStore, SecretVersionConflictError, createSecretStore, createDurableSecretStore, GLOBAL_ALLOWLIST } from './secret-store.js';
export type { SecretStore, SecretMetadata, SecretEntry, SecretScope } from './secret-store.js';