# Guia de Deploy na Nuvem — Apollo Installer

Este guia registra a arquitetura e o **estado real** do deploy do próprio Apollo Installer.

| Serviço | Função | Recurso |
|---------|--------|---------|
| **Supabase** | Banco PostgreSQL | Projeto `ogupqfkkgcczncgvuund`, região `sa-east-1` |
| **Render** | API + UI (Fastify/Node) | `srv-dc15somtlv9c73b5jgeg` → https://apollo-installer-api.onrender.com |
| **Netlify** | UI (legado/fallback) | Site `40f99039-10c1-4736-bb37-a19fa9bafd9f` → https://apollo-installer.netlify.app |

> **Arquitetura final:** API **e** UI são servidas juntas pelo Render. O `dist/admin` é
> servido por `@fastify/static` e o frontend chama `/api` de forma relativa
> (`VITE_API_URL` vazio no build do Render). Isso elimina a dependência do Netlify,
> cuja conta Free não permite desabilitar o SSO global (ver seção 7.1).

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
| UI no Render | ✅ Funcionando | https://apollo-installer-api.onrender.com/ → HTTP 200 (título `Apollo Installer - Admin`) |
| UI Netlify (deploy zip) | ✅ Publicado | Deploy `6b02691a0d88a7b0c6924170`, `state=ready`, restore HTTP 200 |
| UI Netlify (acesso público) | ❌ Bloqueado | HTTP 401 → `edge-access` (SSO global da conta Free — sem toggle no painel) |
| Build automático Netlify | ⏳ Falhando | `Build script returned non-zero exit code: 2` |
| Domínios no Render | ✅ Criados | `apollo-installer.apollofit.com.br` e `api.apollo-installer.apollofit.com.br` |
| DNS | ⏳ Pendente | Usuário precisa criar os dois CNAMEs apontando para `apollo-installer-api.onrender.com` |

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
| `apollo-installer.apollofit.com.br` | Render → Custom Domains (✅ já criado) | CNAME → `apollo-installer-api.onrender.com` |
| `api.apollo-installer.apollofit.com.br` | Render → Custom Domains (✅ já criado) | CNAME → `apollo-installer-api.onrender.com` |

> **Nota:** o Netlify não é mais usado para os domínios finais. O domínio
> `apollo-installer.apollofit.com.br` estava em conflito com um site órfão
> (`2719fb20-1859-4a83-ad9c-0105985e165e`), mas no Render não há conflito.

Depois que o DNS propagar:

1. Atualizar `APP_URL` no Render para `https://apollo-installer.apollofit.com.br`.
2. Atualizar `PUBLIC_API_URL` no Render para `https://api.apollo-installer.apollofit.com.br`.
3. `ALLOWED_ORIGINS` já contém ambos os domínios — conferir apenas.
4. Validar login e CORS nos domínios finais.

> Não é necessário mexer em `VITE_API_URL`: a UI servida pelo Render usa `/api` relativo.

---

## 7. Bloqueios e próximos passos

### 7.1 SSO do Netlify — não há toggle na conta Free

A conta `apollofitweb@gmail.com` tem `site_sso_login=true` com
`site_sso_login_context=all`, o que redireciona qualquer visitante para
`app.netlify.com/edge-access` (HTTP 401).

**Não existe opção "Require SSO" no painel** porque o plano é `credit-free` e a
capacidade `global_access_controls` está marcada como `included: false` na conta.
Consequências confirmadas:

- `PATCH /accounts/{id}` com `site_sso_login=false` → `422 Account is not eligible to update global access controls`
- `PUT /accounts/{id}` com o objeto completo → o mesmo 422
- `PATCH /sites/{id}` com `site_access`, `site_sso_login`, `secure_site` etc. → HTTP 200, mas nenhum campo é alterado

**Solução adotada:** a UI passou a ser servida pelo próprio Render, junto com a API,
em https://apollo-installer-api.onrender.com/ (HTTP 200, validado). O Netlify fica
apenas como fallback histórico. Se no futuro quiser voltar a usar o Netlify, será
necessário fazer upgrade para um plano que inclua `global_access_controls`.

### 7.2 Build automático do Netlify

Os deploys via Git falham com exit code 2; os logs não estão disponíveis via API
(os endpoints de log da API pública são apenas para escrita). O build local passa.
O `netlify.toml` foi simplificado (sem `npm i -g`, sem `tsc` no Netlify).
Se ainda falhar após o próximo push, copiar o log do painel:
**Deploys → deploy falhado → Deploy log**.

Enquanto isso, o deploy zip manual (`6b02691a0d88a7b0c6924170`) permanece publicado.

### 7.3 Checklist

1. [x] Confirmar que a UI funciona no Render (https://apollo-installer-api.onrender.com/).
2. [x] Criar os dois domínios customizados no Render (feito via API).
3. [ ] Configurar DNS: dois CNAMEs → `apollo-installer-api.onrender.com`.
4. [ ] Após propagação, atualizar `APP_URL` e `PUBLIC_API_URL` no Render.
5. [ ] Validar `https://apollo-installer.apollofit.com.br` e `https://api.apollo-installer.apollofit.com.br/health`.
6. [ ] (Opcional) Corrigir ou abandonar o build automático do Netlify — não impacta a produção.

---

## 8. Troubleshooting

| Sintoma | Causa | Solução |
|---------|-------|---------|
| UI 401 com `edge-access` | Conta Netlify Free sem `global_access_controls` | Usar a UI no Render (item 7.1) |
| `Build script returned non-zero exit code: 2` | Build command no Netlify | Não impacta produção; ver item 7.2 |
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
