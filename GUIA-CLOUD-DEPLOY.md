# Guia de Deploy na Nuvem — Apollo Installer

Este guia registra a arquitetura e o **estado real** do deploy do próprio Apollo Installer.

| Serviço | Função | Recurso |
|---------|--------|---------|
| **Supabase** | Banco PostgreSQL | Projeto `ogupqfkkgcczncgvuund`, região `sa-east-1` |
| **Render** | API + UI (Fastify/Node) | `srv-dc15somtlv9c73b5jgeg` → https://apollo-installer-api.onrender.com |
| **Netlify** | UI (conta nova) | Site `ab4aeaa5-e63a-4a02-a7ea-69b15bbf9a91` → https://apollo-installer-gilbrandao.netlify.app |

> **Arquitetura final:** API no Render e UI no Netlify (conta `gilbrandaoalves`).
> O frontend usa `VITE_API_URL=https://apollo-installer-api.onrender.com`.
> O Render também continua servindo `dist/admin` em
> https://apollo-installer-api.onrender.com/ como fallback. A conta Netlify antiga
> (`apollofitweb@gmail.com`) foi abandonada porque o SSO global não pode ser
> desligado no plano Free (ver seção 7.1).

---

## 0. Contas utilizadas (decisão do usuário)

| Serviço | Conta | Observação |
|---------|-------|------------|
| **GitHub** | Conta existente `apollofitweb` | Repo `apollofitweb/apollo-installer` |
| **Netlify** | Conta nova `gilbrandaoalves@gmail.com` | account id `67ce102ff7d773f82846f608`, slug `gilbrandaoalves` |
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
| UI no Render | ✅ Funcionando | https://apollo-installer-api.onrender.com/ → HTTP 200 (título `Apollo Installer - Admin`, fallback) |
| Site Netlify (conta nova) | ✅ Criado | `ab4aeaa5-e63a-4a02-a7ea-69b15bbf9a91` → https://apollo-installer-gilbrandao.netlify.app |
| Token Netlify novo | ✅ No cofre | `netlify.authToken` versão 11 (conta `gilbrandaoalves`, token validado) |
| Acesso público Netlify | ✅ Sem SSO | `site_sso_login=false`, `has_site_password=false` na conta nova |
| Build automático Netlify | ⏳ Validando | Causa raiz encontrada: falta de `pnpm-workspace.yaml` (corrigido no commit atual) |
| Domínios no Render | ⚠️ Ajustar | `api.apollo-installer.apollofit.com.br` permanece; `apollo-installer.apollofit.com.br` será movido para o Netlify |
| DNS | ⏳ Pendente | UI → `apollo-installer-gilbrandao.netlify.app`; API → `apollo-installer-api.onrender.com` |

---

## 2. Arquivos de deploy versionados

| Arquivo | Finalidade |
|---------|------------|
| `render.yaml` | Blueprint do Render — `startCommand=pnpm start`, sem `db push` |
| `netlify.toml` | Build da UI (publish `dist/admin`, redirects SPA) |
| `pnpm-workspace.yaml` | Inclui `src/admin` no workspace — necessário para o build limpo no Netlify |
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
- O site foi criado com `account_slug=gilbrandaoalves` e nome
  `apollo-installer-gilbrandao` (o nome `apollo-installer` está ocupado pela conta antiga).
- A integração GitHub usa deploy key `6b035b0429f0a31bd2c3a520` (chave pública
  instalada no repo como `netlify-apollo-installer-gilbrandao`, somente leitura).
- Build hook `deploy-main` (`6b035b5d46a3576369bc4e3a`) dispara builds manuais.
- O build falhava com exit code 2 porque não havia `pnpm-workspace.yaml`: em um
  clone limpo, `pnpm install` na raiz não instalava as dependências de `src/admin`.
  O arquivo foi adicionado e o `pnpm-lock.yaml` regenerado com o importer `src/admin`.

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
| `apollo-installer.apollofit.com.br` | Netlify → Domains (conta nova) | CNAME → `apollo-installer-gilbrandao.netlify.app` |
| `api.apollo-installer.apollofit.com.br` | Render → Custom Domains (✅ já criado) | CNAME → `apollo-installer-api.onrender.com` |

> **Nota:** o domínio da UI sai do Render e vai para o novo site Netlify, agora que
> a conta `gilbrandaoalves` não tem SSO/senha de site. O site
> `2719fb20-1859-4a83-ad9c-0105985e165e` (`apollo-fit-web`, `custom=apollofit.com.br`)
> pertence a essa mesma conta, mas usa o domínio raiz — não conflita com o subdomínio.

Depois que o DNS propagar:

1. Atualizar `APP_URL` no Render para `https://apollo-installer.apollofit.com.br`.
2. Atualizar `PUBLIC_API_URL` no Render para `https://api.apollo-installer.apollofit.com.br`.
3. `ALLOWED_ORIGINS` já contém ambos os domínios — conferir apenas.
4. Validar login e CORS nos domínios finais.

> Não é necessário mexer em `VITE_API_URL`: a UI servida pelo Render usa `/api` relativo.

---

## 7. Bloqueios e próximos passos

### 7.1 SSO do Netlify — não há toggle na conta Free

A conta antiga `apollofitweb@gmail.com` tem `site_sso_login=true` com
`site_sso_login_context=all`, o que redireciona qualquer visitante para
`app.netlify.com/edge-access` (HTTP 401).

**Não existe opção "Require SSO" no painel** porque o plano é `credit-free` e a
capacidade `global_access_controls` está marcada como `included: false` na conta.
Consequências confirmadas:

- `PATCH /accounts/{id}` com `site_sso_login=false` → `422 Account is not eligible to update global access controls`
- `PUT /accounts/{id}` com o objeto completo → o mesmo 422
- `PATCH /sites/{id}` com `site_access`, `site_sso_login`, `secure_site` etc. → HTTP 200, mas nenhum campo é alterado

**Solução adotada:** migração para a conta nova `gilbrandaoalves@gmail.com`
(account `67ce102ff7d773f82846f608`). Embora também seja Free e tenha
`global_access_controls.included=false`, ela está com `site_sso_login=false` e
`has_site_password=false`, então o site é público. A UI no Render permanece como
fallback em https://apollo-installer-api.onrender.com/.

### 7.2 Build automático do Netlify

Os deploys via Git falhavam com `Build script returned non-zero exit code: 2` nas
duas contas. A API pública não permite ler o log (os endpoints de log são somente
escrita), então a causa foi identificada por reprodução local: faltava
`pnpm-workspace.yaml`. Sem ele, `pnpm install` na raiz de um clone limpo não
instalava as dependências de `src/admin`, e o `vite build` falhava.

Correção aplicada: `pnpm-workspace.yaml` criado, `pnpm-lock.yaml` regenerado com os
importers `.` e `src/admin`, e `packageManager: pnpm@9.15.9` adicionado ao
`package.json`. O build local com o comando exato do `netlify.toml` passa.

Se ainda falhar após o push, copiar o log do painel:
**Deploys → deploy falhado → Deploy log**.

O deploy zip manual antigo (`6b02691a0d88a7b0c6924170`) pertence à conta antiga e
não é mais usado.

### 7.3 Checklist

1. [x] Validar token da conta Netlify nova e salvar em `netlify.authToken` (v11).
2. [x] Confirmar que a conta nova não tem SSO/senha de site.
3. [x] Criar site `apollo-installer-gilbrandao` na conta nova.
4. [x] Instalar deploy key no GitHub e associar ao site.
5. [x] Configurar `VITE_API_URL` e build hook `deploy-main`.
6. [x] Corrigir `pnpm-workspace.yaml` / lockfile para o build limpo.
7. [ ] Fazer push e validar build automático no Netlify.
8. [ ] Mover `apollo-installer.apollofit.com.br` do Render para o Netlify.
9. [ ] Configurar DNS: UI → `apollo-installer-gilbrandao.netlify.app`; API → `apollo-installer-api.onrender.com`.
10. [ ] Validar UI, API, login e CORS nos domínios finais.

---

## 8. Troubleshooting

| Sintoma | Causa | Solução |
|---------|-------|---------|
| UI 401 com `edge-access` | Conta Netlify antiga com SSO global | Usar a conta nova (item 7.1) |
| `Build script returned non-zero exit code: 2` | Falta `pnpm-workspace.yaml` | Ver item 7.2 |
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
