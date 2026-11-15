#!/usr/bin/env node
/**
 * CLI Admin para Apollo Installer - Injeção de Segredos
 *
 * Uso:
 *   pnpm admin secret set <deploymentId> <key> --stdin
 *   pnpm admin secret set <deploymentId> <key> --file <path>
 *   pnpm admin secret get <deploymentId> <key>
 *   pnpm admin secret get-meta <deploymentId> <key>
 *   pnpm admin secret delete <deploymentId> <key> --version <n>
 *   pnpm admin secret list <deploymentId>
 *   pnpm admin secret set-global <key> --stdin
 *   pnpm admin secret get-global <key>
 *   pnpm admin secret get-global-meta <key>
 *   pnpm admin secret delete-global <key> --version <n>
 *   pnpm admin secret list-global
 *
 * Escopos: deployment | global
 * Chaves globais permitidas: netlify.siteId | netlify.authToken | installer.jwtSigningSecret
 *
 * Segurança:
 *   - NÃO aceita --value (evita segredos em histórico de shell/processos)
 *   - --stdin: lê de stdin (pode usar pipe ou heredoc)
 *   - --file: lê de arquivo (valida permissões 600 / ACL restrita)
 */

import { Command } from 'commander';
import { createDurableSecretStore, InMemorySecretStore } from '../secrets/index.js';
import { PrismaClient } from '@prisma/client';
import { readFileSync, statSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('admin')
  .description('Apollo Installer - Admin CLI para gerenciamento de segredos')
  .version('0.1.0');

// Initialize secret store based on environment
// If SECRETS_MASTER_KEY is set, use DurableSecretStore for persistence across invocations
// Otherwise use InMemorySecretStore for development/testing
let secretStore: InMemorySecretStore | Awaited<ReturnType<typeof createDurableSecretStore>>;

async function initializeSecretStore(): Promise<void> {
  const masterKey = process.env.SECRETS_MASTER_KEY;
  if (masterKey) {
    // Production mode with durable storage
    const prisma = new PrismaClient();
    secretStore = await createDurableSecretStore(prisma);
    console.log('[CLI] Using DurableSecretStore (SECRETS_MASTER_KEY detected)');
  } else {
    // Development mode - in-memory only (no persistence across invocations)
    secretStore = new InMemorySecretStore();
    console.log('[CLI] Using InMemorySecretStore (no SECRETS_MASTER_KEY - dev mode)');
  }
}

// Valida permissões de arquivo (600 no POSIX, ACL restrita no Windows)
function validateFilePermissions(filePath: string): void {
  const stats = statSync(filePath);
  const mode = stats.mode & 0o777;

  if (process.platform !== 'win32') {
    if (mode !== 0o600) {
      throw new Error(`Arquivo ${filePath} deve ter permissões 600 (atual: ${mode.toString(8)}). Use: chmod 600 ${filePath}`);
    }
  } else {
    // Windows: verificar se não é legível por "Everyone"
    // statSync não expõe ACLs completas, mas pelo menos avisa
    console.warn('[AVISO] No Windows, certifique-se de que o arquivo tem ACL restrita (apenas seu usuário).');
  }
}

async function readSecretFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { resolve(data.trim()); });
  });
}

async function readSecretFromFile(filePath: string): Promise<string> {
  const absolutePath = resolve(filePath);
  validateFilePermissions(absolutePath);
  return readFileSync(absolutePath, 'utf-8').trim();
}

// ===== SECRET COMMAND (parent) =====
const secretCmd = program.command('secret').description('Gerenciamento de segredos');

// ===== DEPLOYMENT-SCOPED SECRETS (subcommands under 'secret') =====
secretCmd
  .command('set <deploymentId> <key>')
  .description('Define um segredo no escopo de deployment')
  .option('--stdin', 'Ler segredo do stdin (recomendado)')
  .option('--file <path>', 'Ler segredo de arquivo (permissões 600 obrigatórias)')
  .option('--expected-version <n>', 'Versão esperada para optimistic locking', '0')
  .action(async (deploymentId: string, key: string, options) => {
    if (!options.stdin && !options.file) {
      console.error('Erro: deve especificar --stdin ou --file (--value não é permitido por segurança)');
      process.exit(1);
    }

    if (options.stdin && options.file) {
      console.error('Erro: use apenas --stdin OU --file');
      process.exit(1);
    }

    try {
      const value = options.stdin ? await readSecretFromStdin() : await readSecretFromFile(options.file);
      const expectedVersion = parseInt(options.expectedVersion, 10);

      const metadata = await secretStore.set(deploymentId, 'deployment', key, value, expectedVersion);
      console.log(`Segredo "${key}" definido com sucesso`);
      console.log(`Versão: ${metadata.version}`);
      console.log(`Atualizado em: ${metadata.updatedAt}`);
      console.log(`Atualizado por: ${metadata.updatedBy}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('get <deploymentId> <key>')
  .description('Obtém o valor de um segredo do escopo de deployment')
  .action(async (deploymentId: string, key: string) => {
    try {
      const value = await secretStore.get(deploymentId, 'deployment', key);
      if (value === null) {
        console.log('Segredo não encontrado');
        process.exit(1);
      }
      console.log('*** VALOR DO SEGREDO ***');
      console.log(value);
      console.log('*** FIM ***');
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('get-meta <deploymentId> <key>')
  .description('Obtém metadados de um segredo (NÃO retorna o valor)')
  .action(async (deploymentId: string, key: string) => {
    try {
      const list = await secretStore.list(deploymentId, 'deployment');
      const meta = list[key];
      if (!meta) {
        console.log('Segredo não encontrado');
        process.exit(1);
      }
      console.log(`Key: ${key}`);
      console.log(`Versão: ${meta.version}`);
      console.log(`Atualizado em: ${meta.updatedAt}`);
      console.log(`Atualizado por: ${meta.updatedBy}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('delete <deploymentId> <key>')
  .description('Remove um segredo do escopo de deployment (cria tombstone)')
  .requiredOption('--expected-version <n>', 'Versão atual esperada (obrigatória para optimistic locking)')
  .action(async (deploymentId: string, key: string, options) => {
    try {
      const expectedVersion = parseInt(options.expectedVersion, 10);
      await secretStore.delete(deploymentId, 'deployment', key, expectedVersion);
      console.log(`Segredo "${key}" removido (tombstone criado)`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('list <deploymentId>')
  .description('Lista segredos do escopo de deployment (apenas metadados)')
  .action(async (deploymentId: string) => {
    try {
      const list = await secretStore.list(deploymentId, 'deployment');
      if (Object.keys(list).length === 0) {
        console.log('Nenhum segredo encontrado');
        return;
      }
      console.table(Object.entries(list).map(([key, meta]) => ({
        Key: key,
        Versão: meta.version,
        Atualizado: meta.updatedAt,
        Por: meta.updatedBy,
      })));
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

// ===== GLOBAL-SCOPED SECRETS (ALLOWLIST ONLY) =====
const GLOBAL_KEYS = ['netlify.siteId', 'netlify.authToken', 'installer.jwtSigningSecret'] as const;

secretCmd
  .command('set-global <key>')
  .description('Define um segredo global (allowlist: netlify.siteId, netlify.authToken, installer.jwtSigningSecret)')
  .option('--stdin', 'Ler segredo do stdin (recomendado)')
  .option('--file <path>', 'Ler segredo de arquivo (permissões 600 obrigatórias)')
  .option('--expected-version <n>', 'Versão esperada para optimistic locking', '0')
  .action(async (key: string, options) => {
    if (!GLOBAL_KEYS.includes(key as any)) {
      console.error(`Erro: chave global não permitida. Permitidas: ${GLOBAL_KEYS.join(', ')}`);
      process.exit(1);
    }

    if (!options.stdin && !options.file) {
      console.error('Erro: deve especificar --stdin ou --file (--value não é permitido por segurança)');
      process.exit(1);
    }

    if (options.stdin && options.file) {
      console.error('Erro: use apenas --stdin OU --file');
      process.exit(1);
    }

    try {
      const value = options.stdin ? await readSecretFromStdin() : await readSecretFromFile(options.file);
      const expectedVersion = parseInt(options.expectedVersion, 10);

      const metadata = await secretStore.setGlobal('global', key as any, value, expectedVersion);
      console.log(`Segredo global "${key}" definido com sucesso`);
      console.log(`Versão: ${metadata.version}`);
      console.log(`Atualizado em: ${metadata.updatedAt}`);
      console.log(`Atualizado por: ${metadata.updatedBy}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('get-global <key>')
  .description('Obtém um segredo global (retorna o valor)')
  .action(async (key: string) => {
    if (!GLOBAL_KEYS.includes(key as any)) {
      console.error(`Erro: chave global não permitida. Permitidas: ${GLOBAL_KEYS.join(', ')}`);
      process.exit(1);
    }

    try {
      const value = await secretStore.getGlobal('global', key as any);
      if (value === null) {
        console.log('Segredo não encontrado');
        process.exit(1);
      }
      console.log('*** VALOR DO SEGREDO GLOBAL ***');
      console.log(value);
      console.log('*** FIM ***');
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('get-global-meta <key>')
  .description('Obtém metadados de um segredo global (NÃO retorna o valor)')
  .action(async (key: string) => {
    if (!GLOBAL_KEYS.includes(key as any)) {
      console.error(`Erro: chave global não permitida. Permitidas: ${GLOBAL_KEYS.join(', ')}`);
      process.exit(1);
    }

    try {
      const list = await secretStore.listGlobal('global');
      const meta = list[key];
      if (!meta) {
        console.log('Segredo não encontrado');
        process.exit(1);
      }
      console.log(`Key: ${key}`);
      console.log(`Versão: ${meta.version}`);
      console.log(`Atualizado em: ${meta.updatedAt}`);
      console.log(`Atualizado por: ${meta.updatedBy}`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('delete-global <key>')
  .description('Remove um segredo global (cria tombstone)')
  .requiredOption('--expected-version <n>', 'Versão atual esperada (obrigatória para optimistic locking)')
  .action(async (key: string, options) => {
    if (!GLOBAL_KEYS.includes(key as any)) {
      console.error(`Erro: chave global não permitida. Permitidas: ${GLOBAL_KEYS.join(', ')}`);
      process.exit(1);
    }

    try {
      const expectedVersion = parseInt(options.expectedVersion, 10);
      await secretStore.deleteGlobal('global', key as any, expectedVersion);
      console.log(`Segredo global "${key}" removido (tombstone criado)`);
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

secretCmd
  .command('list-global')
  .description('Lista segredos globais (apenas metadados)')
  .action(async () => {
    try {
      const list = await secretStore.listGlobal('global');
      if (Object.keys(list).length === 0) {
        console.log('Nenhum segredo global encontrado');
        return;
      }
      console.table(Object.entries(list).map(([key, meta]) => ({
        Key: key,
        Versão: meta.version,
        Atualizado: meta.updatedAt,
        Por: meta.updatedBy,
      })));
    } catch (error) {
      if (error instanceof Error) {
        console.error(`Erro: ${error.message}`);
      } else {
        console.error('Erro desconhecido');
      }
      process.exit(1);
    }
  });

// Initialize secret store before parsing commands
await initializeSecretStore();

program.parse(process.argv);