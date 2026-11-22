# SQL de deploy — Apollo Installer

Estes arquivos reproduzem o banco em produção (Supabase `ogupqfkkgcczncgvuund`).

| Arquivo | Finalidade |
|---------|------------|
| `schema.sql` | Cria enums e tabelas (`Deployment`, `DeploymentStep`, `DeploymentConfig`, `DeploymentSecret`, `GlobalSecret`) |
| `seed.sql` | Importa os dados migrados do SQLite local (1 deployment GK, 5 steps, 1 config, 5 secrets de deployment, 6 global secrets) |

## Como aplicar no Supabase

O host direct (`:5432`) não é alcançável a partir do Render nesta conta. Use a
**Management API** do Supabase com o PAT salvo em `supabase.accessToken`:

```powershell
$st = (Invoke-RestMethod 'http://localhost:3334/api/secrets/global/supabase.accessToken' `
  -Headers @{ Authorization = "Bearer $jwt" }).data.value
$sql = Get-Content database/schema.sql -Raw
$payload = @{ query = [string]$sql } | ConvertTo-Json -Compress
Invoke-RestMethod 'https://api.supabase.com/v1/projects/ogupqfkkgcczncgvuund/database/query' `
  -Method Post -Headers @{ Authorization = "Bearer $st" } `
  -ContentType 'application/json' -Body $payload
```

> **Atenção:** o PowerShell transforma SQL multilinha em objeto se o `ConvertTo-Json`
> receber o arquivo diretamente. Sempre converter com `[string]` e `-Compress`,
> ou gerar o payload com `node -e "JSON.stringify({query: ...})"`.

Depois de aplicar `schema.sql`, aplique `seed.sql` da mesma forma. Para conferir:

```sql
SELECT
  (SELECT count(*) FROM "Deployment") AS deployments,
  (SELECT count(*) FROM "DeploymentStep") AS steps,
  (SELECT count(*) FROM "DeploymentConfig") AS configs,
  (SELECT count(*) FROM "DeploymentSecret") AS secrets,
  (SELECT count(*) FROM "GlobalSecret") AS global_secrets;
```

Resultado esperado: `1, 5, 1, 5, 6`.

## Segredos criptografados

Os valores em `GlobalSecret.valueEncrypted` foram cifrados com o `SECRETS_MASTER_KEY`
do `.env` local. A mesma chave foi replicada no Render. **Nunca gere uma chave nova**
no blueprint se quiser continuar lendo esses segredos.
