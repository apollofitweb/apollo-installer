# Guia de Deploy na Nuvem — Apollo Installer

Este guia registra a arquitetura e o **estado real** do deploy do próprio Apollo Installer.

| Serviço | Função | Recurso |
|---------|--------|---------|
| **Supabase** | Banco PostgreSQL | Projeto `ogupqfkkgcczncgvuund`, região `sa-east-1` |
| **Render** | API (Fastify/Node) | `srv-dc15somtlv9c73b5jgeg` → https://apollo-installer-api.onrender.com |
| **Netlify** | UI (React/Vite) | Site `40f99039-10c1-4736-bb37-a19fa9bafd9f` → https://apollo-installer.netlify.app |

> **Arquitetura:** API no Render + UI no Netlify, com `VITE_API_URL` apontando para a API e CORS configurado via `ALLOWED_ORIGINS`.

---

## 0. Contas utilizadas (decisão do usuário)

| Serviço | Conta | Observação |
|---------|-------|------------|
| **GitHub** | Conta existente `apollofitweb` | Repo `apollofitweb/apollo-installer` |
| **Netlify** | Conta existente `apollofitweb@gmail.com` | account id `6acb8fddfc7dc07061d5118f` |
| **Supabase** | Conta nova | Organização `Apollo Installer` (`aisgnpywlxlbfmlzocrp`) |
| **Render** | Conta nova | `admin.apolloinstaller@gmail.com`, owner `tea-dc152o2jnfac73fnmrpg` |

> A conta Render antiga (`GK-TOP-FITNESS`, owner `tea-dbuva6on74is739hura0`) continua responsável pelo deployment `apollo-gk-top-fitness`. O token antigo segue em `render.apiToken`; o token da conta nova está em `render.installerApiToken`. **Não misturar.**

---

## 1. Status atual (validado em 22/11/2026)

| Item | Estado | Detalhe |
|------|--------|---------|
| Repo GitHub | ✅ Publicado | `apollofitweb/apollo-installer`, branch `main` |
| Supabase | ✅ Ativo | `ACTIVE_HEALTHY`, schema + dados aplicados |
| Render | ✅ Live | Deploy `dep-dc16cfafngtc73eohrmg`, `/health` HTTP 200 `database=connected` |
| Login na API | ✅ OK | `admin@apollofit.com.br` / `ApolloInstaller#2026` |
| Leitura de segredos na nuvem | ✅ OK | `netlify.siteId`, `render.installerApiToken` etc. |
| Dados migrados | ✅ OK | deployments=1, steps=5, configs=1, secrets=5, global_secrets=6 |
| UI Netlify (deploy zip) | ✅ Publicado | Deploy `6b02691a0d88a7b0c6924170`, `state=ready`, restore HTTP 200 |
| UI Netlify (acesso público) | ⏳ Bloqueado | HTTP 401 → redirect `app.netlify.com/edge-access` (SSO global da conta) |
| Build automático Netlify | ⏳ Falhando | `Build script returned non-zero exit code: 2` |
| Domínios customizados | ⏳ Pendente | DNS ainda não configurado; domínio da UI está em conflito |

---

## 2. Arquivos de deploy versionados

| Arquivo | Finalidade |
|---------|------------|
| `render.yaml` | Blueprint do Render — `startCommand=pnpm start`, sem `db push` |
| `netlify.toml` | Build da UI (publish `dist/admin`, redirects SPA) |
| `prisma/schema.production.prisma` | Schema PostgreSQL usado para gerar o SQL |
| `database/schema.sql` | DDL aplicado no Supabase via Management API |
| `database/seed.sql` | Dados migrados do SQLite |
| `database/README.md` | Como aplicar o SQL e cuidados com `SECRETS_MASTER_KEY` |
| `scripts/deploy-cloud.ps1` | Automação de criação dos recursos via APIs |
| `src/api/plugins/cors.ts` | CORS com origens explícitas de `ALLOWED_ORIGINS` |

---

## 3. Detalhes críticos da configuração

### 3.1 Banco de dados

- **Usar sempre o transaction pooler**: `aws-0-sa-east-1.pooler.supabase.com:6543`,
  usuário `postgres.ogupqfkkgcczncgvuund`, com `?pgbouncer=true&sslmode=require`.
- O host direct `db.ogupqfkkgcczncgvuund.supabase.co:5432` está **inalcançável** (P1001).
  por isso `DATABASE_URL` e `DIRECT_URL` apontam para o pooler.
- O schema **não** é aplicado no start. Foi aplicado via
  `POST /v1/projects/{ref}/database/query` da Management API (ver `database/README.md`).
- `prisma db push` trava no pooler transacional — não usar.

### 3.2 Render

- Runtime `node`, plano `free` (`starter` retornou 402 — exige cartão).
- `startCommand = pnpm start`.
- `SECRETS_MASTER_KEY` é **a mesma** do `.env` local, necessária para ler os segredos
  criptografados migrados. Gerar uma chave nova quebra a leitura.
- `PUT /services/{id}/env-vars` **substitui todas** as variáveis. Ao alterar uma,
  reenviar o conjunto completo de 14 chaves.

### 3.3 Netlify

- Env vars são configuradas em `/api/v1/accounts/{account_id}/env?site_id={site_id}`.
- Deploy por upload: `POST /sites/{site_id}/deploys` com `Content-Type: application/zip`
  (multipart gera deploy preso em `state=new`). Publicar com
  `POST /sites/{site_id}/deploys/{deploy_id}/restore`.
- O deploy zip é o fallback enquanto o build automático não é estabilizado.

---

## 4. Deploy automático

```powershell
.\scripts\deploy-cloud.ps1           # cria recursos (idempotente parcial)
.\scripts\deploy-cloud.ps1 -WhatIf   # só valida tokens
```

Flags: `-SkipSupabase`, `-SkipRender`, `-SkipNetlify`, `-SecretsMasterKey <chave>`.

O script lê os tokens dos segredos globais da API local (ou cloud), valida os três
tokens e cria projeto Supabase, serviço Render e site Netlify com as configurações
corrigidas desta seção.

---

## 5. Verificação pós-deploy

```powershell
# API
Invoke-WebRequest 'https://apollo-installer-api.onrender.com/health'
# 200 {"status":"ok","database":"connected"}

# Login
$body = @{ email='admin@apollofit.com.br'; password='ApolloInstaller#2026' } | ConvertTo-Json
$login = Invoke-RestMethod 'https://apollo-installer-api.onrender.com/api/auth/login' `
  -Method Post -Body $body -ContentType 'application/json'
$h = @{ Authorization = "Bearer $($login.data.token)" }
Invoke-RestMethod 'https://apollo-installer-api.onrender.com/api/deployments' -Headers $h

# CORS
$req = [System.Net.HttpWebRequest]::Create('https://apollo-installer-api.onrender.com/api/deployments')
$req.Headers.Add('Origin', 'https://apollo-installer.netlify.app')
$req.Method = 'OPTIONS'
$resp = $req.GetResponse()
$resp.Headers['Access-Control-Allow-Origin']
```

---

## 6. Domínios personalizados

| Domínio | Onde configurar | Destino |
|---------|-----------------|---------|
| `apollo-installer.apollofit.com.br` | Netlify → Domain management | CNAME → `apollo-installer.netlify.app` |
| `api.apollo-installer.apollofit.com.br` | Render → Custom Domains (já criado) | CNAME → `apollo-installer-api.onrender.com` |

Depois que o DNS propagar:

1. Atualizar `ALLOWED_ORIGINS` no Render com a URL final da UI.
2. Atualizar `VITE_API_URL` no Netlify com a URL final da API e fazer rebuild.
3. Atualizar `APP_URL` e `PUBLIC_API_URL` no Render.
4. Validar login e CORS nos domínios finais.

> ⚠️ **Conflito conhecido:** a API do Netlify recusa atribuir
> `apollo-installer.apollofit.com.br` ao site do instalador (422: domínio pertence ao
> site `2719fb20-1859-4a83-ad9c-0105985e165e`, que retorna 404). É necessário liberar
> o domínio no painel ou escolher um nome alternativo.

---

## 7. Bloqueios e próximos passos

### 7.1 Acesso público da UI (ação no painel Netlify)

A conta `apollofitweb@gmail.com` tem `site_sso_login=True` com
`site_sso_login_context=all`. Isso redirece qualquer visitante para
`app.netlify.com/edge-access`, resultando em HTTP 401 mesmo com deploy publicado.

A API retorna `422 Account is not eligible to update global access controls` ao tentar
desabilitar via `PATCH /accounts/{id}`. **Só é possível alterar no painel:**

1. Login em https://app.netlify.com com `apollofitweb@gmail.com`.
2. Abrir **Team settings → Security** (ou **Access & security**).
3. Em **Site access / SSO**, alterar de "Require SSO for all sites" para
   "Public" / desmarcar a exigência de login para o site `apollo-installer`.
4. Salvar e testar: https://apollo-installer.netlify.app → esperado HTTP 200.

### 7.2 Build automático do Netlify

Os deploys via Git falham com exit code 2; os logs não estão disponíveis via API
(os endpoints de log da API pública são apenas para escrita). O build local passa.
O `netlify.toml` foi simplificado (sem `npm i -g`, sem `tsc` no Netlify).
Se ainda falhar após o próximo push, copiar o log do painel:
**Deploys → deploy falhado → Deploy log**.

Enquanto isso, o deploy zip manual (`6b02691a0d88a7b0c6924170`) permanece publicado.

### 7.3 Checklist

1. [ ] Desabilitar SSO/Edge Access no painel Netlify e validar UI HTTP 200.
2. [ ] Fazer push das configurações sincronizadas e acompanhar o build do Netlify.
3. [ ] Liberar ou substituir o domínio `apollo-installer.apollofit.com.br`.
4. [ ] Configurar DNS dos dois domínios.
5. [ ] Atualizar `ALLOWED_ORIGINS`, `VITE_API_URL`, `APP_URL`, `PUBLIC_API_URL` para os domínios finais.
6. [ ] Validar login e CORS nos domínios finais.

---

## 8. Troubleshooting

| Sintoma | Causa | Solução |
|---------|-------|---------|
| UI 401 com `edge-access` | SSO global da conta Netlify | Painel → Team settings → Security (item 7.1) |
| `Build script returned non-zero exit code: 2` | Build command no Netlify | Ver item 7.2; fallback: deploy zip |
| `P1001 Can't reach database` | Host direct 5432 | Usar pooler 6543 com `sslmode=require` |
| `db push` trava no pooler | Transação não suportada | Aplicar `database/schema.sql` via Management API |
| Segredos ilegíveis na nuvem | `SECRETS_MASTER_KEY` diferente | Replicar a chave do `.env` no Render |
| `422 must be unique` no domínio | Domínio em outro site Netlify | Item 7.3 |
| CORS bloqueado | Origem ausente em `ALLOWED_ORIGINS` | Adicionar origem exata (sem barra final) |
| Render env vars perdidas | `PUT` substitui todas | Reenviar conjunto completo de 14 chaves |

---

## 9. Custos

| Serviço | Plano | Observação |
|---------|-------|------------|
| Supabase | Free | 500 MB, suficiente para começar |
| Render | Free | Adormece após inatividade; `starter` exige cartão |
| Netlify | Free | 100 GB bandwidth/mês |
