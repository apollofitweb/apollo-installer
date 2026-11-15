# Auditoria Final de Segurança e Persistência - Apollo Installer (OS-002)

**Data:** 2026-11-15  
**Versão:** 0.1.0  
**Branch:** develop  
**Repositório:** C:\pollo3820\apollo-installer  

---

## Resumo Executivo

Esta auditoria compara o **design documentado** (decisões arquiteturais acordadas) com a **implementação real** do código-fonte. O objetivo é verificar conformidade, identificar lacunas de segurança, persistência e completude funcional antes de considerar o projeto pronto para OS-003.

**Veredito Final:** **NÃO APROVÁVEL** para produção (OS-003)

A implementação atual **não corresponde** ao design documentado em pontos críticos de segurança, gerenciamento de segredos, controle de concorrência e idempotência. O código reflete um estado anterior (protótipo funcional) e precisa de refatoração significativa para atender aos requisitos de OS-002.

---

## 1. Conformidade com Design Documentado

### 1.1 Número de Etapas (Steps)

| Design Documentado | Implementação Atual | Status |
|---|---|---|
| **5 etapas** (netlify_configure removido) | **6 etapas** (inclui netlify_configure) | ❌ **Não conforme** |

**Evidência:**
- `src/shared/types.ts:69-112` - `DEPLOYMENT_STEPS` define 6 etapas
- `prisma/schema.prisma:19` - `totalSteps Int @default(6)`
- `src/persistence/deployment.repository.ts:56` - `totalSteps: data.totalSteps ?? 6`
- `tests/integration/deployment-flow.test.ts:93` - Testa `steps).toHaveLength(6)`

**Impacto:** Etapa desnecessária (front resolve API via `tenants.ts` por hostname), aumenta complexidade e superfície de falha.

---

### 1.2 SecretStore e Gerenciamento de Segredos

| Design Documentado | Implementação Atual | Status |
|---|---|---|
| Interface `SecretStore` com `get(deploymentId, scope, key)` / `set(deploymentId, scope, key, value, version?)` | **Não existe** | ❌ **Ausente** |
| Escopos explícitos: `deployment` vs `global` | Segredos lidos direto de `deployment.config` (campos legados) | ❌ **Não conforme** |
| Allowlist global: apenas `netlify.siteId`, `netlify.authToken` | `jwtAccessSecret`, `jwtRefreshSecret`, `netlifySiteId` em `DeploymentConfig` | ❌ **Violação** |
| Zero segredos em database/logs/metadata | Segredos persistem em `DeploymentConfig` (campos legados) | ❌ **Violação** |
| Versionamento otimista em `SecretStore` | Não implementado | ❌ **Ausente** |
| CLI admin para injeção via stdin/arquivo (perms 600) | Não implementado | ❌ **Ausente** |
| Sem flag `--value` | N/A | - |

**Evidência de violações atuais:**
- `src/engine/deployment-engine.ts:106-107` - Valida `jwtAccessSecret`, `jwtRefreshSecret` do config
- `src/engine/deployment-engine.ts:376-385` - Passa segredos direto para `adapter.configureEnvVars()`
- `src/engine/deployment-engine.ts:499-500` - Lê `jwtAccessSecret`, `jwtRefreshSecret` de `deployment.config`
- `src/engine/deployment-engine.ts:511-513` - **Tokens hardcoded mock no resume** (`mock-supabase-token`, etc.)
- `prisma/schema.prisma:58-60` - Campos `jwtAccessSecret`, `jwtRefreshSecret`, `allowedOrigins` em `DeploymentConfig`
- `src/persistence/deployment.repository.ts:147-159` - `createConfig`/`updateConfig` persistem segredos

**Impacto Crítico:** Segredos de produção (JWT secrets, tokens) ficam armazenados em banco SQLite/PostgreSQL em texto plano, acessíveis via logs de migração, backups, `prisma studio`. Viola princípio de "zero secrets in database".

---

### 1.3 ExecutionContext e Isolamento de Segredos

| Design Documentado | Implementação Atual | Status |
|---|---|---|
| `ExecutionContext` com `secrets: Record<string, string>` injetado por step | `EngineContext.secrets` **sempre vazio** (`{}`) | ❌ **Não implementado** |
| Segredos resolvidos no início de cada step via `SecretStore` | Segredos vêm de `context.config` (DeploymentConfig) | ❌ **Não conforme** |
| Middleware de auth (JWT 15m/7d) nas rotas `/api/deployments/*` | **Nenhum middleware de auth** nas rotas | ❌ **Ausente** |
| RBAC (admin/operator/viewer) | Não implementado | ❌ **Ausente** |

**Evidência:**
- `src/engine/deployment-engine.ts:82-95` - `buildEngineContext()` retorna `secrets: {}`
- `src/api/routes/deployments.ts:187-210` - Rotas `start`/`resume` sem autenticação
- `src/api/plugins/index.ts` - Nenhum plugin de auth registrado

**Impacto Crítico:** API exposta sem autenticação/autorização. Qualquer um com acesso de rede pode criar/iniciar/retomar deployments, ler configurações com segredos.

---

### 1.4 Controle de Concorrência (Optimistic Locking)

| Design Documentado | Implementação Atual | Status |
|---|---|---|
| `version` em `Deployment` + `SecretStore` | `version` em `Deployment` **parcial** | ⚠️ **Parcial** |
| `tryAcquireForExecution` usa `version` expected | Implementado em `deploymentRepository` | ✅ **Conforme** |
| Atualizações pós-aquisição **sem** version check (já tem lock) | Implementado corretamente (`update` omite version) | ✅ **Conforme** |
| Versionamento em `SecretStore.set()` | `SecretStore` não existe | ❌ **Ausente** |

**Evidência:**
- `src/persistence/deployment.repository.ts:116-137` - `tryAcquireForExecution` correto
- `src/persistence/deployment.repository.ts:93-110` - `update` omite version quando já adquirido
- **Problema:** `updateStep` **não usa** optimistic locking (pode sobrescrever step concorrente)

---

### 1.5 Idempotência por Plataforma

| Plataforma | Design Documentado | Implementação Atual (Mock) | Status |
|---|---|---|---|
| **Supabase** | Conflito explícito (sem tags) - `createProject` falha se projeto existe | Mock sempre cria novo (`projectRef` com timestamp) | ❌ **Não testável** |
| **Render** | Conflito explícito (sem metadata confirmada) - `createWebService` falha se serviço existe | Mock sempre cria novo (`serviceId` com timestamp) | ❌ **Não testável** |
| **Netlify** | Idempotente nativo - `deploySite`/`addDomainAlias`/`configureEnvVars` reconciliam | Mock sempre cria novo (`siteId` com timestamp) | ❌ **Não testável** |

**Evidência:**
- `src/adapters/mock.ts:40` - `projectRef: \`apollo-${params.slug}-${Date.now().toString(36)}\``
- `src/adapters/mock.ts:103` - `serviceId: \`srv-${params.name}-${Date.now().toString(36)}\``
- `src/adapters/mock.ts:166` - `siteId: \`site-${Date.now().toString(36)}\``

**Impacto:** Mocks não permitem testar idempotência real. Adaptadores reais (OS-003) precisarão implementar verificações de existência antes de criar.

---

### 1.6 Verificação Integral de Seed

| Design Documentado | Implementação Atual | Status |
|---|---|---|
| Verificação completa: 66 permissions, 4 roles, UserRole, todas RolePermissions | Mock retorna apenas `{ adminCreated: true }` | ❌ **Não implementado** |
| Falha de seed = deployment FAILED (não partial) | Não verificado | ❌ **Ausente** |

**Evidência:**
- `src/adapters/mock.ts:59-63` - `runSeed` retorna apenas `adminCreated: true`
- `src/engine/deployment-engine.ts:345-349` - Chama `runSeed` mas não valida resultado além de `success`

**Referência (apollo-web seed):**
- `apollo-web/apps/api/prisma/seed.ts` - 66 permissions, 4 roles (ADMIN, MANAGER, RECEPTIONIST, INSTRUCTOR), UserRole, RolePermissions

---

### 1.7 Recuperação de Crash por Etapa

| Step | Design Documentado (Crash Recovery) | Implementação Atual |
|---|---|---|
| 1. supabase_create | Verificar projeto existente via API antes de criar; se existe, ler connection strings | Mock não verifica; resume lê metadata do step 1 |
| 2. supabase_migrate_seed | Reaplicar migrations (idempotente via Prisma migrate); reexecutar seed com verificação | Mock não idempotente; resume reexecuta |
| 3. render_create | Verificar serviço existente por nome; se existe, ler serviceId/serviceUrl | Mock não verifica; resume lê metadata do step 3 |
| 4. render_configure | `configureEnvVars` é idempotente (upsert); reexecutar seguro | Mock ok; reexecuta |
| 5. netlify_deploy | Deploy idempotente; reexecutar gera novo build | Mock ok; reexecuta |
| 6. netlify_configure | `addDomainAlias`/`configureEnvVars`/`configureRedirects` idempotentes | Mock ok; reexecuta |

**Gap:** Steps 1 e 3 não têm verificação de existência no mock. Resume depende de metadata persistida (que pode não existir se crash ocorreu antes do `updateStep`).

---

### 1.8 Rotação/Revogação de Tokens Account-Scoped

| Design Documentado | Implementação Atual | Status |
|---|---|---|
| Procedimento documentado para rotação de `SUPABASE_ACCESS_TOKEN`, `RENDER_API_TOKEN`, `NETLIFY_AUTH_TOKEN` | Não documentado nem implementado | ❌ **Ausente** |
| Revogação imediata sem quebrar deployments em andamento | Não aplicável (tokens não injetados via SecretStore) | ❌ **Ausente** |

---

## 2. Problemas de Segurança Confirmados

### 2.1 CRITICAL: API Sem Autenticação/Autorização
- **Arquivo:** `src/api/routes/deployments.ts`, `src/api/index.ts`
- **Problema:** Rotas `POST /api/deployments`, `POST /api/deployments/:id/start`, `POST /api/deployments/:id/resume`, `PATCH /api/deployments/:id/config`, `DELETE /api/deployments/:id` **não têm middleware de auth**
- **Risco:** Qualquer ator com acesso de rede pode:
  - Criar deployments arbitrários
  - Iniciar/retomar deployments
  - Ler `DeploymentConfig` contendo JWT secrets, tokens
  - Deletar deployments
- **Mitigação necessária:** Implementar JWT auth (access 15m, refresh 7d) + RBAC antes de OS-003

### 2.2 CRITICAL: Segredos em Banco de Dados (Texto Plano)
- **Arquivos:** `prisma/schema.prisma:58-60`, `src/persistence/deployment.repository.ts:147-159`, `src/engine/deployment-engine.ts:376-385,499-500`
- **Campos expostos:** `jwtAccessSecret`, `jwtRefreshSecret`, `allowedOrigins`, `smtpPass`, `netlifySiteId` (allowlist global)
- **Risco:** Vazamento via backup, `prisma studio`, logs de migração, SQL injection, acesso direto ao DB
- **Mitigação necessária:** Implementar `SecretStore` com criptografia at-rest; remover campos legados de `DeploymentConfig`

### 2.3 HIGH: Tokens Hardcoded no Resume
- **Arquivo:** `src/engine/deployment-engine.ts:511-513`
- **Código:**
  ```typescript
  accessToken: 'mock-supabase-token',
  apiToken: 'mock-render-token',
  authToken: 'mock-netlify-token',
  ```
- **Risco:** Se código for usado em produção sem SecretStore, tokens mock vazam; padrão perigoso de "fallback invisível"

### 2.4 HIGH: Ausência de Rate Limiting nas Rotas Sensíveis
- **Arquivo:** `src/api/index.ts:27` - Rate limit global apenas
- **Risco:** Brute force em `start`/`resume`, DoS criando deployments

### 2.5 MEDIUM: Logs Podem Vazar Segredos
- **Arquivo:** `src/engine/deployment-engine.ts:376-385` - `adapter.configureEnvVars` loga `count: Object.keys(params.envVars).length`
- **Risco:** Se logger nível debug, `envVars` completo pode vazar em `metadata` do step
- **Evidência:** `src/engine/deployment-engine.ts:285` - `metadata: result.data as any` persiste retorno do adapter (pode conter segredos)

---

## 3. Problemas Potenciais (Requer Investigação em OS-003)

| Item | Descrição | Risco |
|---|---|---|
| **Migração SQLite → PostgreSQL** | Schema usa `Json` para metadata; verificar compatibilidade de tipos e índices | Médio |
| **Transações Prisma** | `create` inclui steps em transação; `tryAcquireForExecution` é atomic; mas `updateStep` + `update` deployment não transacionais | Médio |
| **Cascade Delete** | `DeploymentStep` e `DeploymentConfig` têm `onDelete: Cascade` - OK | Baixo |
| **Unique Constraints** | `Deployment.slug @unique`, `DeploymentStep @@unique([deploymentId, stepNumber])`, `DeploymentConfig @@unique([deploymentId])` - OK | Baixo |
| **Índices** | Apenas `@@index([deploymentId])` em Step; considerar índice em `Deployment.status` para queries de lista | Baixo |
| **Seed Verification** | Mock não valida seed; adaptador real precisará query `Permission`, `Role`, `UserRole`, `RolePermission` | Alto |
| **Rollback Automático** | Não implementado; design prevê `ROLLED_BACK` status mas sem lógica | Alto |
| **Webhooks/Callbacks** | `WAITING_EXTERNAL` status existe mas sem implementação de callback | Médio |

---

## 4. Cobertura de Testes - Lacunas

### 4.1 Testes Existentes (Boa Cobertura Base)
- ✅ `tests/shared/types.test.ts` - Validação de entrada (slug, email, domain)
- ✅ `tests/adapters/mock.test.ts` - Todos métodos dos 3 mock adapters
- ✅ `tests/api/deployments.test.ts` - Rotas API básicas (validação, health)
- ✅ `tests/persistence/deployment.repository.test.ts` - CRUD completo, constraints
- ✅ `tests/engine/state-machine.test.ts` - Todas transições válidas/inválidas
- ✅ `tests/integration/deployment-flow.test.ts` - Fluxo completo 6 steps, resume, metadata

### 4.2 Lacunas Críticas (Não Testados)

| Área | Cenário Não Testado | Prioridade |
|---|---|---|
| **Auth/RBAC** | Nenhum teste de autenticação (middleware inexistente) | CRITICAL |
| **SecretStore** | Interface não existe; zero testes | CRITICAL |
| **Concorrência** | Dois `startDeployment` simultâneos no mesmo deployment | HIGH |
| **Idempotência Real** | Mocks não simulam conflitos (projeto/serviço/site existente) | HIGH |
| **Seed Verification** | Validação de 66 permissions, 4 roles, UserRole, RolePermissions | HIGH |
| **Crash Recovery** | Crash entre `updateStep RUNNING` e `COMPLETED`; metadata parcial | HIGH |
| **Rotação Tokens** | Cenário de rotação de `SUPABASE_ACCESS_TOKEN` mid-deployment | MEDIUM |
| **Rollback** | Transição `COMPLETED` → `ROLLED_BACK` e limpeza recursos | MEDIUM |
| **Rate Limiting** | Exceder limite em `/start` ou `/resume` | MEDIUM |
| **Log Sanitization** | Verificar que `metadata` não contém segredos | MEDIUM |

### 4.3 Configuração de Testes
- ✅ `vitest.config.ts:19` - `pool: 'forks'` para isolamento
- ✅ `tests/setup.ts:10` - DB único por PID (`test-${process.pid}.db`)
- ✅ `tests/setup.ts:14-21` - `prisma db push` automático
- ⚠️ `vitest.config.ts:17` - `globals: true` (polui namespace global)

---

## 5. Dívida Técnica e Código Morto

### 5.1 Campos Legados em `DeploymentConfig` (Devem Ser Removidos)
| Campo | Motivo | Substituto |
|---|---|---|
| `jwtAccessSecret` | Segredo - deve ir para SecretStore(deployment) | `SecretStore.get(deploymentId, 'deployment', 'jwtAccessSecret')` |
| `jwtRefreshSecret` | Segredo - deve ir para SecretStore(deployment) | `SecretStore.get(deploymentId, 'deployment', 'jwtRefreshSecret')` |
| `allowedOrigins` | Config operacional (não segredo) - OK ficar | Manter ou mover para config operacional |
| `smtpPass` | Segredo - deve ir para SecretStore(deployment) | `SecretStore.get(deploymentId, 'deployment', 'smtpPass')` |
| `netlifySiteId` | **Allowlist global** - pode ficar em DeploymentConfig/global | `SecretStore.get(deploymentId, 'global', 'netlifySiteId')` |
| `netlifyDomain` | Duplicado com `customDomain` | Remover `netlifyDomain` |
| `renderServiceId` | Duplicado com metadata step 3 | Ler de metadata step 3 |
| `supabaseProjectRef` | Duplicado com metadata step 1 | Ler de metadata step 1 |

### 5.2 Duplicação Schema vs Types
- `prisma/schema.prisma` vs `src/shared/types.ts:136-196` - Tipos duplicados (manutenção manual)

### 5.3 Step 6 Desnecessário
- `netlify_configure` - Front resolve API via `tenants.ts` por hostname; VITE_API_URL pode ser configurado no build

### 5.4 Admin Interface Placeholder
- `src/admin/index.ts` - Classe vazia, não usada em lugar nenhum

---

## 6. Checklist de Prontidão para OS-003

| Requisito OS-002 | Status | Ação Necessária |
|---|---|---|
| 5-step deployment flow | ❌ | Remover step 6 (`netlify_configure`) |
| SecretStore interface + InMemory impl (testes) | ❌ | Implementar `src/secrets/secret-store.ts` |
| DurableSecretStore interface (produção) | ❌ | Definir interface; implementação em OS-003 |
| CLI admin secret injection (stdin/file, perms 600) | ❌ | Implementar `src/admin/cli.ts` |
| Zero secrets em database/logs/metadata | ❌ | Remover campos legados; sanitizar logs |
| Global allowlist (netlify.siteId, netlify.authToken only) | ❌ | Implementar em SecretStore |
| No automatic fallback between scopes | ❌ | Garantir que `get(deployment, 'global', ...)` nunca fallback para deployment |
| Optimistic locking em SecretStore | ❌ | Adicionar `version` em `SecretStore.set()` |
| Auth middleware (JWT 15m/7d) nas rotas API | ❌ | Implementar `src/api/plugins/auth.ts` |
| RBAC (admin/operator/viewer) | ❌ | Implementar após auth |
| Idempotency strategies documentadas por plataforma | ✅ | Documentado no design (precisa implementar em adapters reais) |
| Integral seed verification (66p, 4r, UR, RP) | ❌ | Implementar em `SupabaseAdapter.runSeed` + verificação |
| Crash recovery por step documentado | ✅ | Documentado (precisa implementar em adapters reais) |
| Token rotation/revocation procedures | ❌ | Documentar procedimentos |
| Testes: concorrência, idempotência real, seed verification, crash recovery | ❌ | Adicionar testes de integração avançados |

---

## 7. Veredito Final

### ❌ NÃO APROVÁVEL para OS-003 (Produção)

**Motivos Bloqueadores:**
1. **API exposta sem autenticação/autorização** - Risco crítico de segurança
2. **Segredos (JWT secrets, tokens, SMTP password) armazenados em texto plano no banco** - Violação direta de "zero secrets in database"
3. **SecretStore não existe** - Arquitetura de segredos completamente ausente
4. **6 steps em vez de 5** - Design não implementado
5. **Tokens hardcoded no resume** - Padrão perigoso
6. **Sem CLI admin para injeção de segredos** - Requisito explícito não atendido

**Itens para Correção Antes de OS-003 (Mínimo Viável):**
1. Implementar `SecretStore` (interface + `InMemorySecretStore` para testes)
2. Remover campos legados de segredos de `DeploymentConfig` + migration
3. Implementar auth middleware JWT + RBAC básico nas rotas `/api/deployments/*`
4. Remover step 6 (`netlify_configure`) - ajustar schema, engine, tests
5. Implementar `ExecutionContext` com injeção de segredos por step via `SecretStore`
6. Remover tokens hardcoded do `resumeDeployment`
7. Sanitizar logs/metadata - não persistir segredos em `DeploymentStep.metadata`
8. Documentar procedimentos de rotação/revogação de tokens account-scoped

**Itens para OS-003 (Pós-MVP):**
1. `DurableSecretStore` implementation (Vault, AWS Secrets Manager, etc.)
2. Adaptadores reais (Supabase CLI, Render API, Netlify API) com idempotência nativa
3. Seed verification integral (query permissions/roles)
4. Crash recovery robusto por step
5. Rollback automático
6. Webhooks para `WAITING_EXTERNAL`
7. Admin UI (React/Vite)
8. Notificações (email/Slack/Teams)

---

## 8. Arquivos Alterados Necessários (Resumo)

### Novos Arquivos
- `src/secrets/secret-store.ts` - Interface `SecretStore` + `InMemorySecretStore`
- `src/secrets/durable-secret-store.ts` - Interface `DurableSecretStore` (apenas contrato)
- `src/admin/cli.ts` - CLI admin para injeção de segredos (stdin/file, chmod 600)
- `src/api/plugins/auth.ts` - JWT auth middleware + RBAC
- `src/api/plugins/rate-limit-deployments.ts` - Rate limit específico para rotas sensíveis

### Arquivos a Modificar
- `prisma/schema.prisma` - Remover campos legados de segredos; `totalSteps = 5`; remover step 6
- `src/shared/types.ts` - `DEPLOYMENT_STEPS` = 5 steps; remover `netlify_configure`; adicionar `SecretStore` types
- `src/engine/deployment-engine.ts` - Usar `SecretStore` + `ExecutionContext.secrets`; remover leitura de segredos do config; remover tokens mock
- `src/persistence/deployment.repository.ts` - Ajustar `createConfig`/`updateConfig` (sem segredos); `updateStep` com optimistic locking
- `src/api/routes/deployments.ts` - Adicionar auth middleware; remover segredos do payload de config
- `src/adapters/mock.ts` - Simular conflitos de idempotência (projeto/serviço/site existente)
- `tests/` - Adicionar testes para auth, SecretStore, concorrência, idempotência real, seed verification, crash recovery

### Arquivos a Remover/Depreciar
- `src/admin/index.ts` - Placeholder (substituir por CLI + UI futura)

---

**Fim da Auditoria**

*Auditoria realizada em modo somente leitura. Nenhum arquivo foi modificado. Nenhum commit/push executado.*