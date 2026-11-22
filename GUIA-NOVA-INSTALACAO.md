# Guia de Nova Instalação — Apollo Installer

Guia operacional para provisionar uma nova filial Apollo Fit com o Apollo Installer.
Cobre execução local (mock), execução em produção (adaptadores reais), credenciais,
DNS, verificação e solução de problemas.

> Não remova nem edite `INSTRUÇÕES E INFORMES/resumo.txt` — ele é o histórico da OS-006.

---

## 1. Visão geral

O instalador automatiza 5 etapas sequenciais:

| # | Etapa | O que faz | Adaptador |
|---|-------|-----------|-----------|
| 1 | `supabase_create` | Cria/adota projeto Supabase e obtém connection strings | Supabase |
| 2 | `supabase_migrate_seed` | Aplica migrations e cria o admin da filial | Supabase |
| 3 | `render_create` | Cria/adota web service Docker da API | Render |
| 4 | `render_configure` | Configura env vars (DATABASE_URL, JWT, CORS etc.) | Render |
| 5 | `netlify_deploy` | Associa o domínio da filial ao site compartilhado | Netlify |

O motor (`DeploymentEngine`) valida a configuração de cada etapa no momento da
execução, propaga as saídas de uma etapa para as seguintes (`projectRef`,
`databaseUrl`, `directUrl`, `renderServiceId`, `serviceUrl`, `siteId`) e faz retry
automático (3 tentativas, intervalo progressivo de 5s).

**Modos de execução:**
- `NODE_ENV=development` → adaptadores **mock** (padrão, seguro para testar o fluxo).
- `NODE_ENV=production` → adaptadores **reais** (Supabase Management API, Render API v1, Netlify API v1).

---

## 2. Pré-requisitos

- Node `20.19.5` e pnpm `9.15.9` (conforme `engines` do `package.json`).
- Repositório `apollofitweb/apollo-web` acessível (branch padrão `develop`, Dockerfile `docker/Dockerfile`).
- Para produção: tokens de Supabase, Render e Netlify (ver §5).
- Para domínios customizados: acesso ao DNS para criar os registros (ver §7).

---

## 3. Instalação e execução local (mock)

```powershell
# 1. Dependências
pnpm install

# 2. Configuração
Copy-Item .env.example .env
# Edite .env: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, ADMIN_PASSWORD,
# SECRETS_MASTER_KEY e ALLOWED_ORIGINS (veja §4)

# 3. Banco local (SQLite)
pnpm db:generate
pnpm db:push

# 4. API (porta 3334)
pnpm exec tsx src/api/index.ts

# 5. Interface admin (porta 5174) — outro terminal
cd src/admin
pnpm dev -- --host 0.0.0.0 --port 5174
```

Endereços locais:

| Serviço | URL |
|---------|-----|
| API | `http://localhost:3334` (`/health`, `/docs`) |
| UI | `http://localhost:5174` |
| UI na rede | `http://192.168.1.13:5174` |
| Login | `http://localhost:5174/login` |

> A porta `5173` pode pertencer a outro projeto. Use `5174`.

### Credenciais de login (ambiente local atual)

- E-mail: `admin@apollofit.com.br`
- Senha: `ApolloInstaller#2026`

Elas vêm de `ADMIN_EMAIL` / `ADMIN_PASSWORD` no `.env` local (não commitado).
Em outro ambiente, use as credenciais definidas no `.env` correspondente.

### Testes e build

```powershell
pnpm exec tsc --noEmit
pnpm exec vitest run --hookTimeout 30000 --testTimeout 30000
pnpm build
```

Última execução: **12 arquivos / 285 testes aprovados**, `tsc` limpo e build OK
(backend + `dist/admin`: app 63,3 kB, vendor 223,4 kB, CSS 14,5 kB).

---

## 4. Variáveis de ambiente

Copie `.env.example` para `.env`. Principais variáveis:

| Variável | Uso | Obrigatória |
|----------|-----|-------------|
| `NODE_ENV` | `development` (mock) ou `production` (real) | sim |
| `PORT` | Porta da API (padrão `3334`) | não |
| `DATABASE_URL` | `file:./dev.db` (dev) ou PostgreSQL (prod) | sim |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | JWT do instalador (mín. 32 chars) | sim |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Login da UI | sim |
| `SECRETS_MASTER_KEY` | AES-256-GCM dos segredos persistidos (base64 de 32 bytes) | sim (persistência) |
| `ALLOWED_ORIGINS` | Origens permitidas (nunca `*`) | sim |
| `RENDER_API_TOKEN` / `RENDER_OWNER_ID` | Fallback Render (prefira segredos globais) | não |
| `RENDER_REGION` / `RENDER_PLAN` | Região (`oregon`) e plano (`starter`) do serviço | não |
| `SUPABASE_MIGRATIONS_DIR` / `SUPABASE_SEED_SQL_PATH` | Origem das migrations/seed | não |

Gerar valores:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"  # JWT
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" # SECRETS_MASTER_KEY
```

Se `SECRETS_MASTER_KEY` não estiver definido, a CLI usa store em memória e os
segredos **não sobrevivem** ao restart. Defina-a sempre em produção.

---

## 5. Credenciais

### 5.1 Segredos globais (compartilhados entre filiais)

Gerenciados em **Credenciais → Segredos Globais** na UI, pela CLI (`pnpm admin secret ...`)
ou via API. Allowlist (API, CLI e UI):

| Chave | Finalidade |
|-------|------------|
| `supabase.accessToken` | PAT da Supabase Management API |
| `render.apiToken` | API token da Render |
| `render.ownerId` | Owner/workspace da Render (opcional; descoberto via `/v1/owners`) |
| `netlify.authToken` | API token da Netlify |
| `netlify.siteId` | ID do site **compartilhado** (Matrix) na Netlify |
| `installer.jwtSigningSecret` | Assinatura auxiliar do instalador |

> `netlify.siteId` é o site compartilhado. Se estiver com valor placeholder
> (`global-netlify.siteId`), a etapa 5 não consegue associar domínios — corrija
> antes de provisionar.

Injeção via CLI (sem expor o valor no histórico):

```powershell
"TOKEN_AQUI" | pnpm admin secret set-global render.apiToken --stdin
"TOKEN_AQUI" | pnpm admin secret set-global supabase.accessToken --stdin
"TOKEN_AQUI" | pnpm admin secret set-global netlify.authToken --stdin
"SITE_ID"   | pnpm admin secret set-global netlify.siteId --stdin
pnpm admin secret list-global   # apenas metadados
```

### 5.2 Segredos por filial (escopo `deployment`)

| Chave | Usada na etapa |
|-------|----------------|
| `dbPassword` | 1 — senha do banco Supabase |
| `supabaseAdminPasswordHash` | 2 — hash bcrypt do admin criado no seed |
| `jwtAccessSecret` | 4 — JWT da API da filial |
| `jwtRefreshSecret` | 4 — refresh token da API da filial |
| `allowedOrigins` | 4 — CORS da API da filial (também aceito na config operacional) |

Na UI: **Credenciais → Segredos por Filial → selecione a filial**.
Pela API (com token admin):

```powershell
$headers = @{ Authorization = "Bearer $TOKEN" }
$body = @{ key = 'dbPassword'; value = 'SENHA_FORTE'; expectedVersion = 0 } | ConvertTo-Json
Invoke-RestMethod -Uri 'http://localhost:3334/api/deployments/<ID>/secrets' `
  -Method Post -Headers $headers -Body $body -ContentType 'application/json'
```

Valores nunca são exibidos na tela de Credenciais — apenas metadados (versão,
data, autor). A edição usa optimistic locking (`expectedVersion`).

### 5.3 Migrations e seed

O adaptador Supabase procura, nesta ordem:

1. `SUPABASE_MIGRATIONS_DIR` / `SUPABASE_SEED_SQL_PATH` (se definidos);
2. `../apollo-web/apps/api/prisma`;
3. `./apps/api/prisma`;
4. `./prisma`.

O diretório `prisma/migrations/` **não é mais ignorado** pelo `.gitignore` —
migrations são parte do código e devem ser versionadas.

---

## 6. Criando e executando uma nova instalação

### 6.1 Pela interface (recomendado)

1. Acesse `http://localhost:5174` e faça login.
2. **Nova Instalação** → preencha:
   - **Slug**: `minúsculas, números e hífens`, 2–50 chars. É o identificador único
     e define os subdomínios. Ex.: `filial-sp`.
   - **Nome**, **E-mail do Admin**, **Nome do Admin**, **Senha do Admin** (mín. 8).
   - **Domínio**: gerado automaticamente como `<slug>.apollofit.com.br`.
   - Marque **Usar domínio personalizado** apenas se for configurar DNS próprio.
   - Mercado Pago (sandbox/produção) e SMTP são opcionais.
   - **Configurações Operacionais**: deixe os padrões
     (`apollofitweb/apollo-web`, `develop`, `docker/Dockerfile`,
     `https://api.<slug>.apollofit.com.br`).
3. Clique em **Criar Instalação**. Você será levado ao detalhe do deployment.
4. Em **Credenciais**, preencha os segredos da filial (§5.2).
5. No detalhe do deployment, clique em **Configurar** se precisar ajustar
   `supabaseRegion` (padrão `sa-east-1`), `allowedOrigins`, `repo`, `branch`, etc.
6. Clique em **Iniciar**. A tela atualiza a cada 5s enquanto está ativa.
7. Se falhar, corrija a causa e use **Retomar** (a etapa falha é repetida).

### 6.2 Pela API

```powershell
$login = Invoke-RestMethod -Uri 'http://localhost:3334/api/auth/login' -Method Post `
  -Body (@{ email = 'admin@apollofit.com.br'; password = 'ApolloInstaller#2026' } | ConvertTo-Json) `
  -ContentType 'application/json'
$h = @{ Authorization = "Bearer $($login.data.token)" }

$payload = @{
  slug = 'filial-sp'
  name = 'Filial São Paulo'
  adminEmail = 'admin@filial-sp.apollofit.com.br'
  adminName = 'Administrador da Filial'
  adminPassword = 'SENHA_FORTE'
  repo = 'apollofitweb/apollo-web'
  branch = 'develop'
  dockerfilePath = 'docker/Dockerfile'
  publicApiUrl = 'https://api.filial-sp.apollofit.com.br'
} | ConvertTo-Json

$created = Invoke-RestMethod -Uri 'http://localhost:3334/api/deployments' `
  -Method Post -Headers $h -Body $payload -ContentType 'application/json'
$id = $created.data.id

# Segredos da filial (repita para cada chave da §5.2)
$secret = @{ key = 'dbPassword'; value = 'SENHA_FORTE'; expectedVersion = 0 } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3334/api/deployments/$id/secrets" `
  -Method Post -Headers $h -Body $secret -ContentType 'application/json' | Out-Null

# Iniciar
Invoke-RestMethod -Uri "http://localhost:3334/api/deployments/$id/start" -Method Post -Headers $h

# Acompanhar
Invoke-RestMethod -Uri "http://localhost:3334/api/deployments/$id" -Headers $h
```

Endpoints úteis: `GET /api/deployments`, `GET /api/deployments/:id`,
`POST /api/deployments/:id/start`, `POST /api/deployments/:id/resume`,
`PATCH /api/deployments/:id/config`, `DELETE /api/deployments/:id`,
rotas de segredos em `/api/deployments/:id/secrets[...]` e `/api/secrets/global[...]`.

---

## 7. DNS e domínios

Padrão de domínios por filial:

| Finalidade | Domínio | Onde termina |
|------------|---------|--------------|
| Site (frontend) | `<slug>.apollofit.com.br` | Netlify (site compartilhado) |
| API | `api.<slug>.apollofit.com.br` | Render (web service, CNAME) |

- O instalador **não cria registros DNS**. Ele apenas associa o alias no Netlify
  (etapa 5) e configura `ALLOWED_ORIGINS` / `PUBLIC_API_URL` no Render (etapa 4).
- Para **domínio customizado**, marque a opção na criação e configure CNAME no
  provedor de DNS. O domínio customizado da API precisa ser adicionado ao serviço
  Render (`/v1/services/:id/custom-domains`) e verificado.
- Se `customDomain` estiver desmarcado, a etapa 5 usa `<slug>.apollofit.com.br`.

### Verificação de domínio (exemplo real — GK Top Fitness)

```powershell
# DNS
Resolve-DnsName api.apollo-gk-top-fitness.apollofit.com.br

# Health da API
Invoke-WebRequest 'https://api.apollo-gk-top-fitness.apollofit.com.br/health' -UseBasicParsing
# esperado: 200 {"success":true,"data":{"status":"ok","service":"apollo-web-api","database":"connected"}}

# Domínio verificado no Render (com o token)
Invoke-RestMethod -Uri 'https://api.render.com/v1/services/<SERVICE_ID>/custom-domains' `
  -Headers @{ Authorization = "Bearer $RENDER_TOKEN"; Accept = 'application/json' }
```

> O `/health` do Render responde na raiz (`/` do domínio da API). `/api/health`
> retorna 404 nesta API — não use essa path para checar.

---

## 8. Verificação final (checklist)

- [ ] Deployment com `status = COMPLETED`, `currentStep = 5/5`.
- [ ] Todas as 5 etapas com `status = COMPLETED` e `errorMessage = null`.
- [ ] `config` com `supabaseProjectRef`, `renderServiceId`, `publicApiUrl` e `allowedOrigins` preenchidos.
- [ ] `GET https://<domínio-da-api>/health` → 200 com `database: connected`.
- [ ] Site `<slug>.apollofit.com.br` → 200 (SPA da Apollo Fit Web).
- [ ] Domínio da API verificado no Render (`verificationStatus: verified`).
- [ ] Segredos da filial presentes (metadados visíveis em Credenciais).
- [ ] Nenhum segredo órfão no banco (ver §10).

---

## 9. Falhas comuns e solução

| Sintoma | Causa provável | Ação |
|---------|----------------|------|
| `Configuração obrigatória ... ausente: slug` | Slug não propagado | Conferir criação do deployment; usar **Retomar** |
| `supabaseProjectRef inválido` | Ref informado com tamanho/caractere errado | Ref Supabase válido = 20 chars `[a-z0-9]`; deixe vazio para criar |
| `Adapter ... validation failed` | Token global faltando | Preencher `supabase.accessToken`, `render.apiToken`, `netlify.authToken` (§5.1) |
| `Render API token não configurado` | Falta `render.apiToken` ou `RENDER_API_TOKEN` | Injetar segredo global ou env var |
| `Render ownerId não encontrado` | Token sem acesso a `/v1/owners` | Definir `render.ownerId` ou `RENDER_OWNER_ID` |
| Render 409 ao criar serviço | Serviço já existe | Adaptador adota por nome (idempotente) — não cria duplicata |
| `databaseUrl e directUrl são obrigatórios` | Etapa 1 não gerou metadata | Refazer etapa 1 (retomar do início) |
| Domínio não resolve | DNS não configurado | Criar CNAME; aguardar propagação |
| Netlify 401/404 | Token inválido ou `siteId` placeholder | Corrigir `netlify.authToken` / `netlify.siteId` |
| Segredo some após restart | `SECRETS_MASTER_KEY` ausente | Definir chave mestra persistente |
| `Iniciar` desabilitado | Status não é `PENDING`/`FAILED` | Use **Retomar** em `FAILED`/`ROLLED_BACK` |

`DeploymentSecret` **não tem FK/cascade** com `Deployment` (ao contrário de steps
e config). Ao excluir uma filial, remova também os segredos órfãos (§10).

---

## 10. Limpeza e prevenção de duplicatas

- O `slug` é **único** no banco. Nunca crie duas filiais para o mesmo projeto.
- O Render é idempotente por **nome** (`apollofit-api-<slug>`); o adaptador adota
  o serviço existente em vez de duplicar.
- A etapa Netlify é idempotente por **alias de domínio**.
- Antes de excluir uma filial duplicada:
  1. Compare config, metadata das etapas, segredos e **domínios reais/DNS**.
  2. Preserve a credencial mais recente (ex.: migrar `dbPassword` v2 para a filial retida).
  3. `DELETE /api/deployments/:id`.
  4. Remova os segredos órfãos do ID excluído:

```powershell
# Exemplo (ajuste o ID)
node -e "const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();(async()=>{const r=await p.deploymentSecret.deleteMany({where:{deploymentId:'<ID_EXCLUIDO>'}});console.log('removidos',r.count);await p.$disconnect()})()"
```

**Caso resolvido — GK Top Fitness (21/11/2026):**

- **Removido:** `gktopfitness` (`8f13d5e3-863e-45f0-957b-bf25343fb398`) — config antiga com
  `renderServiceId` inválido (`srv-...-rnhnn`, 404), `netlifySiteId` inacessível e
  `api.gktopfitness.apollofit.com.br` em NXDOMAIN.
- **Mantido:** `apollo-gk-top-fitness` (`5f22015d-012e-4bea-9671-1361452d5df0`) — único
  serviço Render real (`srv-dbv3nkc9v7es738j7i5g`, `apollofit-api-gktopfitness`), domínio
  `api.apollo-gk-top-fitness.apollofit.com.br` verificado e `/health` 200.
- `dbPassword` v2 (rotacionado em `2026-11-21T02:54:26Z`) foi migrado para o deployment retido.
- Resultado: 1 deployment, 0 segredos órfãos, health 200, domínio verificado.

---

## 11. Produção (build servido pelo backend)

```powershell
$env:NODE_ENV = 'production'
pnpm build
pnpm start          # node dist/api/index.js — serve API + dist/admin (SPA fallback)
```

Validação já executada na porta 3335: `GET /`, `/login`, `/deployments/1` (SPA),
assets, `POST /api/auth/login`, `GET /api/auth/me`, `GET /api/deployments` (401 sem token).

Use `NODE_ENV=production` **somente** quando os segredos globais reais estiverem
configurados — caso contrário o motor tentará provisionar recursos reais.

---

## 12. Referências

- `README.md` — arquitetura e comandos.
- `INSTRUÇÕES E INFORMES/resumo.txt` — histórico da OS-006 (não remover).
- `.env.example` — todas as variáveis.
- `src/engine/deployment-engine.ts` — orquestração e factories.
- `src/adapters/{supabase,render,netlify}/real-adapter.ts` — integrações reais.
- `src/admin/cli.ts` — gerenciamento de segredos via CLI.
