# Guia de Deploy na Nuvem — Apollo Installer

Este guia explica como hospedar o **próprio Apollo Installer** (API + interface admin) na nuvem usando:

| Serviço | Função | O que hospeda |
|---------|--------|---------------|
| **Supabase** | Banco PostgreSQL | Dados de deployments, steps, configs e segredos criptografados |
| **Render** | API + UI (ou só API) | Fastify (Node) em `NODE_ENV=production`, servindo `dist/admin` |
| **Netlify** | UI (opcional) | React/Vite (build de `src/admin`) |

> **Arquitetura recomendada:** API no **Render** + UI no **Netlify**, com `VITE_API_URL` apontando para a API e CORS configurado. Alternativamente, Render serve tudo (API + UI) numa única URL — mais simples.

---

## 0. Contas utilizadas (decisão do usuário)

| Serviço | Conta | Observação |
|---------|-------|------------|
| **GitHub** | Conta existente `apollofitweb` | Onde já estão todos os projetos armazenados |
| **Netlify** | Conta existente | Onde estão os projetos atuais |
| **Supabase** | **Conta nova** | Exclusiva do instalador |
| **Render** | **Conta nova** | Exclusiva do instalador |

> A conta Render atual (`GK-TOP-FITNESS`, owner `tea-dbuva6on74is739hura0`) continua responsável pelo deployment `apollo-gk-top-fitness` e **não será alterada**. O token atual deve ser preservado. O deploy do instalador usará um token da conta nova.

---

## 1. Status atual do ambiente (diagnóstico executado)

| Item | Estado | Detalhe |
|------|--------|---------|
| Token Render (conta antiga) | ✅ Válido (HTTP 200) | Owner `tea-dbuva6on74is739hura0` (GK-TOP-FITNESS) — preservado para a loja GK |
| Token Render (conta nova) | ⏳ A criar | Será salvo em `render.installerApiToken` e usado pelo instalador |
| Token Supabase | ❌ Placeholder (`global-supab...`) | HTTP 401 — precisa de PAT real |
| Token Netlify | ❌ Placeholder (`global-netli...`) | HTTP 401 — precisa de Personal Access Token real |
| Repo GitHub `apollofitweb/apollo-installer` | ❌ Não existe (404) | Precisa ser criado e publicado |
| Remote Git local | ❌ Ausente | `git remote -v` vazio |
| `DATABASE_URL` / `DIRECT_URL` | ❌ Placeholder (`host:5432`) | Precisa vir do Supabase |
| Docker local | ❌ Indisponível | Não é necessário — Render usa runtime Node |

**Conclusão:** os arquivos de configuração estão prontos, mas a criação automática dos recursos está bloqueada até que os tokens e o repositório sejam fornecidos.

---

## 2. Arquivos criados para o deploy

| Arquivo | Finalidade |
|---------|------------|
| `render.yaml` | Blueprint do Render (serviço web Node, env vars, health check) |
| `netlify.toml` | Build da UI no Netlify (publish `dist/admin`, redirects SPA) |
| `prisma/schema.production.prisma` | Schema PostgreSQL (Supabase) com `directUrl` |
| `src/api/plugins/cors.ts` | Plugin CORS (origem explícita de `ALLOWED_ORIGINS`) |
| `src/admin/.env.production.example` | Exemplo de `VITE_API_URL` para a UI |
| `scripts/deploy-cloud.ps1` | Script que cria os recursos via APIs (quando tokens válidos) |
| `.dockerignore` | Exclusões (caso queira usar Docker depois) |
| `package.json` | Novos scripts `db:generate:prod`, `db:push:prod` |

---

## 3. Pré-requisitos (o que falta)

### 3.1 Tokens reais

Gere e injete no cofre do instalador (ou defina no `.env` do Render):

```powershell
# Supabase PAT: https://supabase.com/dashboard/account/tokens
"SEU_PAT_SUPABASE" | pnpm admin secret set-global supabase.accessToken --stdin

# Netlify Personal Access Token: https://app.netlify.com/user/applications#personal-access-tokens
"SEU_TOKEN_NETLIFY" | pnpm admin secret set-global netlify.authToken --stdin
```

> O token da conta Render antiga (`render.apiToken`) já está válido e deve ser **preservado** — ele controla a loja GK.
> Para o instalador, use um token da **conta nova**, em uma chave separada:
> `"SEU_TOKEN_RENDER_NOVO" | pnpm admin secret set-global render.installerApiToken --stdin`

### 3.2 Repositório GitHub

Render e Netlify fazem deploy a partir de um repositório. Crie o repo `apollofitweb/apollo-installer` e faça push:

```powershell
git remote add origin https://github.com/apollofitweb/apollo-installer.git
git branch -M main
git push -u origin main
```

> **Importante:** o repo precisa conter todo o projeto (não apenas `src/admin`), pois a API no Render roda `pnpm build` (que compila backend + UI) e `prisma db push`.

---

## 4. Deploy automático (após pré-requisitos)

```powershell
.\scripts\deploy-cloud.ps1
```

O script:
1. Valida os três tokens (Render, Supabase, Netlify).
2. Cria projeto Supabase PostgreSQL em `sa-east-1` e obtém connection strings.
3. Cria web service no Render com toutes as env vars (JWT, `SECRETS_MASTER_KEY`, `ALLOWED_ORIGINS`, etc.).
4. Cria site no Netlify apontando para `dist/admin`.

Para testar sem criar nada:

```powershell
.\scripts\deploy-cloud.ps1 -WhatIf
```

Para pular um serviço: `-SkipSupabase`, `-SkipRender` ou `-SkipNetlify`.

---

## 5. Deploy manual (alternativo)

### 5.1 Supabase (banco)

1. Crie projeto em https://database.new → nome `apollo-installer`, região `sa-east-1`.
2. Em **Project Settings → Database**, copie:
   - **Connection string → Transaction pooler** → `DATABASE_URL`
   - **Connection string → Direct connection** → `DIRECT_URL`
3. A aplicação aplica o schema automaticamente no start (`prisma db push --schema prisma/schema.production.prisma`).

### 5.2 Render (API + UI)

1. https://dashboard.render.com → **New → Web Service** → conecte o repo.
2. Configuração:
   - **Name:** `apollo-installer-api`
   - **Runtime:** Node
   - **Branch:** `main`
   - **Build Command:**
     ```
     pnpm install --no-frozen-lockfile && pnpm --filter @apollo-installer/admin-ui install --no-frozen-lockfile && pnpm exec prisma generate --schema prisma/schema.production.prisma && pnpm build
     ```
   - **Start Command:**
     ```
     pnpm exec prisma db push --schema prisma/schema.production.prisma --skip-generate && pnpm start
     ```
   - **Health Check Path:** `/health`
3. Env vars (veja `render.yaml` para a lista completa). Marque como *Secret* as sensíveis.
4. Após o deploy, anote a URL: `https://apollo-installer-api.onrender.com`.

> O Render define automaticamente `PORT=10000`. O código já lê `process.env.PORT`.

### 5.3 Netlify (UI)

1. https://app.netlify.com → **Add new site → Import an existing project** → GitHub → `apollo-installer`.
2. Configuração de build (já em `netlify.toml`):
   - **Build command:** `pnpm install --no-frozen-lockfile && pnpm --filter @apollo-installer/admin-ui build`
   - **Publish directory:** `dist/admin`
3. Em **Site settings → Environment variables**, adicione:
   - `VITE_API_URL = https://apollo-installer-api.onrender.com/api`
4. **Important:** configure `ALLOWED_ORIGINS` no Render incluindo a URL do Netlify:
   ```
   ALLOWED_ORIGINS=https://apollo-installer.netlify.app,https://apollo-installer.apollofit.com.br
   ```
5. O `netlify.toml` já contém o redirect SPA (`/* → /index.html`) para rotas como `/login`.

---

## 6. Domínios personalizados

| Domínio | Onde configurar |
|---------|-----------------|
| `apollo-installer.apollofit.com.br` | Netlify → Domain management (CNAME para `<site>.netlify.app`) |
| `api.apollo-installer.apollofit.com.br` | Render → Custom Domains (CNAME para `<service>.onrender.com`) |

Depois de adicionar os domínios:

- Atualize `ALLOWED_ORIGINS` no Render com a URL final da UI.
- Atualize `VITE_API_URL` no Netlify com a URL final da API e faça rebuild.
- Atualize `APP_URL` e `PUBLIC_API_URL` no Render.

---

## 7. Migração de dados locais → nuvem

O banco local (`dev.db`, SQLite) tem 1 deployment (`apollo-gk-top-fitness`) e segredos globais. Para migrar:

1. Aplique o schema no Supabase (`prisma db push --schema prisma/schema.production.prisma`).
2. Use a API da instância na nuvem para re-injetar segredos globais:
   ```powershell
   $login = Invoke-RestMethod -Uri 'https://api.apollo-installer.apollofit.com.br/api/auth/login' -Method Post `
     -Body (@{ email='admin@apollofit.com.br'; password='SUA_SENHA' } | ConvertTo-Json) -ContentType 'application/json'
   $h = @{ Authorization = "Bearer $($login.data.token)" }
   # Para cada chave global — inclua AMBAS as chaves Render:
   $body = @{ key='render.apiToken'; value='TOKEN_CONTA_ANTIGA_GK'; expectedVersion=0 } | ConvertTo-Json
   Invoke-RestMethod -Uri 'https://api.apollo-installer.apollofit.com.br/api/secrets/global' -Method Post -Headers $h -Body $body -ContentType 'application/json'
   $body = @{ key='render.installerApiToken'; value='TOKEN_CONTA_NOVA'; expectedVersion=0 } | ConvertTo-Json
   Invoke-RestMethod -Uri 'https://api.apollo-installer.apollofit.com.br/api/secrets/global' -Method Post -Headers $h -Body $body -ContentType 'application/json'
   ```
3. Recrie o deployment GK (ou exporte/importe via Prisma — o schema é idêntico).

> **Segurança:** nunca commite `.env`. O `SECRETS_MASTER_KEY` da nuvem deve ser diferente do local.

---

## 8. Verificação pós-deploy

```powershell
# API (Render)
Invoke-WebRequest 'https://apollo-installer-api.onrender.com/health'
# esperado: 200 {"status":"ok","database":"connected"}

# UI (Netlify)
Invoke-WebRequest 'https://apollo-installer.netlify.app/login'
# esperado: 200 (SPA)

# CORS (teste a partir da origem da UI)
$req = [System.Net.HttpWebRequest]::Create('https://apollo-installer-api.onrender.com/api/deployments')
$req.Headers.Add('Origin', 'https://apollo-installer.netlify.app')
$req.Method = 'OPTIONS'
$resp = $req.GetResponse()
"Access-Control-Allow-Origin: $($resp.Headers['Access-Control-Allow-Origin'])"
```

---

## 9. Troubleshooting

| Sintoma | Causa | Solução |
|---------|-------|---------|
| `CORS blocked` no navegador | `ALLOWED_ORIGINS` não inclui a URL da UI | Adicionar origem exata (sem barra final) no Render |
| `401` na UI | `VITE_API_URL` errado | Deve terminar em `/api` |
| `P1001 Can't reach database` | `DATABASE_URL` inválida | Usar connection string do pooler do Supabase |
| `Missing required env var` | Env var não definida no Render | Verificar lista do `render.yaml` |
| Build falha no Render | `pnpm --filter` sem workspace | Verificar se `src/admin/package.json` foi commitado |
| SPA 404 no Netlify | Redirect ausente | `netlify.toml` já tem `/* → /index.html` |
| Prisma client desatualizado | Schema de produção não gerado | `pnpm db:generate:prod` no build |

---

## 10. Custos

| Serviço | Plano sugerido | Observação |
|---------|----------------|------------|
| Supabase | Free | Suficiente para começar (500 MB) |
| Render | Starter (US$ 7/mês) | Free tier adormece após inatividade |
| Netlify | Free | 100 GB bandwidth/mês |

---

## 11. Próximos passos imediatos

1. ✅ Arquivos de deploy criados e validados (`tsc`, 285 testes, build).
2. ⏳ Usuário fornece: PAT Supabase, PAT Netlify e cria repo `apollofitweb/apollo-installer`.
3. ⏳ Executar `.\scripts\deploy-cloud.ps1`.
4. ⏳ Configurar domínios personalizados e migrar segredos.
5. ⏳ Validar health, CORS e login na nuvem.
