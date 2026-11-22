<#
.SYNOPSIS
    Deploy do Apollo Installer na nuvem: Supabase (Postgres) + Render (API/UI) + Netlify (UI).

.DESCRIPTION
    Lê os tokens dos segredos globais da API local e cria:
      1. Projeto Supabase PostgreSQL (via Management API)
      2. Web service no Render (via Render API v1)
      3. Site no Netlify (via Netlify API v1)

    PRE-REQUISITOS:
      - API local rodando em http://localhost:3334
      - Segredo global supabase.accessToken = PAT válido do Supabase
      - Segredo global render.installerApiToken = API token válido do Render
      - Segredo global netlify.authToken = Personal Access Token válido do Netlify
      - Repo GitHub apollofitweb/apollo-installer publicado (ou token GitHub)

.EXAMPLE
    .\scripts\deploy-cloud.ps1
#>

param(
    [string]$LocalApi = 'http://localhost:3334',
    [string]$AdminEmail = 'admin@apollofit.com.br',
    [string]$AdminPassword = 'ApolloInstaller#2026',
    [string]$RenderServiceName = 'apollo-installer-api',
    [string]$NetlifySiteName = 'apollo-installer-gilbrandao',
    [string]$NetlifyAccountSlug = 'gilbrandaoalves',
    [string]$SupabaseProjectName = 'apollo-installer',
    [string]$Region = 'sa-east-1',
    [string]$Repo = 'apollofitweb/apollo-installer',
    [string]$Branch = 'main',
    [string]$SecretsMasterKey = '',
    [switch]$SkipSupabase,
    [switch]$SkipRender,
    [switch]$SkipNetlify,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

# A chave mestra precisa ser a MESMA usada ao criptografar os segredos migrados.
# Se não for informada, tenta ler do .env local.
if (-not $SecretsMasterKey -and (Test-Path .env)) {
    $match = Select-String -Path .env -Pattern '^SECRETS_MASTER_KEY=(.*)$' | Select-Object -First 1
    if ($match) { $SecretsMasterKey = $match.Matches.Groups[1].Value.Trim() }
}

function Write-Step($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [AVISO] $msg" -ForegroundColor Yellow }

# ===== 1. Login e leitura de segredos =====
Write-Step '1. Conectando na API local e lendo segredos globais'

$loginBody = @{ email = $AdminEmail; password = $AdminPassword } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$LocalApi/api/auth/login" -Method Post -Body $loginBody -ContentType 'application/json' -TimeoutSec 15
$headers = @{ Authorization = "Bearer $($login.data.token)" }

$secrets = @{}
foreach ($key in 'supabase.accessToken', 'render.installerApiToken', 'netlify.authToken', 'netlify.siteId') {
    $res = Invoke-RestMethod -Uri "$LocalApi/api/secrets/global/$key" -Headers $headers -TimeoutSec 15
    $secrets[$key] = $res.data.value
}

function Test-Token($name, $url, $token) {
    try {
        $r = Invoke-WebRequest -Uri $url -Headers @{ Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 15
        if ($r.StatusCode -eq 200) { Write-Ok "$name : token valido"; return $true }
    } catch {
        $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 'ERR' }
        Write-Warn "$name : token INVALIDO (HTTP $code)"
        return $false
    }
    return $false
}

$renderOk = Test-Token 'Render' 'https://api.render.com/v1/owners?limit=1' $secrets['render.installerApiToken']
$supabaseOk = Test-Token 'Supabase' 'https://api.supabase.com/v1/projects' $secrets['supabase.accessToken']
$netlifyOk = Test-Token 'Netlify' 'https://api.netlify.com/api/v1/sites' $secrets['netlify.authToken']

if ($WhatIf) {
    Write-Warn 'Modo WhatIf: nenhum recurso sera criado.'
}

# ===== 2. Supabase =====
$dbUrl = $null
$directUrl = $null
if (-not $SkipSupabase -and $supabaseOk) {
    Write-Step '2. Criando projeto PostgreSQL no Supabase'
    $orgs = Invoke-RestMethod -Uri 'https://api.supabase.com/v1/organizations' -Headers @{ Authorization = "Bearer $($secrets['supabase.accessToken'])" } -TimeoutSec 20
    $orgId = $orgs[0].id
    Write-Ok "Organizacao: $orgId"

    $dbPassword = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
    $payload = @{
        name = $SupabaseProjectName
        organization_id = $orgId
        region = $Region
        db_pass = $dbPassword
    } | ConvertTo-Json

    if (-not $WhatIf) {
        $project = Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects' -Method Post `
            -Headers @{ Authorization = "Bearer $($secrets['supabase.accessToken'])"; 'Content-Type' = 'application/json' } `
            -Body $payload -TimeoutSec 60
        $ref = $project.ref
        Write-Ok "Projeto criado: ref=$ref"
        # Aguardar provisionamento
        for ($i = 0; $i -lt 30; $i++) {
            Start-Sleep -Seconds 10
            $p = Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref" -Headers @{ Authorization = "Bearer $($secrets['supabase.accessToken'])" } -TimeoutSec 20
            if ($p.status -eq 'ACTIVE') { Write-Ok 'Projeto ACTIVE'; break }
        }
        $poolerCfg = (Invoke-RestMethod -Uri "https://api.supabase.com/v1/projects/$ref/config/database/pooler" -Headers @{ Authorization = "Bearer $($secrets['supabase.accessToken'])" } -TimeoutSec 20)[0]
        # Usar SEMPRE o transaction pooler (6543). O host direct (5432) fica
        # inalcançável a partir do Render nesta conta Supabase.
        $dbUrl = "postgresql://$($poolerCfg.db_user):$dbPassword@$($poolerCfg.db_host):$($poolerCfg.db_port)/$($poolerCfg.db_name)?pgbouncer=true&sslmode=require"
        $directUrl = $dbUrl
        Write-Ok "Connection strings obtidas (transaction pooler)"
    }
} elseif ($SkipSupabase) {
    Write-Warn 'Supabase pulado (-SkipSupabase)'
} else {
    Write-Warn 'Supabase NAO sera criado (token invalido)'
}

# ===== 3. Render =====
if (-not $SkipRender -and $renderOk) {
    Write-Step '3. Criando web service no Render'
    $owners = Invoke-RestMethod -Uri 'https://api.render.com/v1/owners?limit=10' -Headers @{ Authorization = "Bearer $($secrets['render.installerApiToken'])" } -TimeoutSec 20
    $ownerId = if ($owners[0].owner) { $owners[0].owner.id } else { $owners[0].id }
    Write-Ok "Owner: $ownerId"

    # Gerar secrets (a chave mestra é reaproveitada para não quebrar os segredos migrados)
    $jwtAccess = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    $jwtRefresh = -join ((48..57) + (97..102) | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    $masterKey = if ($SecretsMasterKey) { $SecretsMasterKey } else { [Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Max 256 })) }

    $envVars = @(
        @{ key = 'NODE_ENV'; value = 'production' },
        @{ key = 'PORT'; value = '10000' },
        @{ key = 'DATABASE_URL'; value = $dbUrl },
        @{ key = 'DIRECT_URL'; value = $directUrl },
        @{ key = 'JWT_ACCESS_SECRET'; value = $jwtAccess },
        @{ key = 'JWT_REFRESH_SECRET'; value = $jwtRefresh },
        @{ key = 'ADMIN_EMAIL'; value = $AdminEmail },
        @{ key = 'ADMIN_PASSWORD_HASH'; value = '$2b$12$lcL7zleC9RumqswKBYhJ2eQCteZNpAZQIkqGvxBap8tahpG/xHO8G' },
        @{ key = 'SECRETS_MASTER_KEY'; value = $masterKey },
        @{ key = 'ALLOWED_ORIGINS'; value = "https://$NetlifySiteName.netlify.app,https://apollo-installer.apollofit.com.br" },
        @{ key = 'PUBLIC_API_URL'; value = "https://$RenderServiceName.onrender.com" },
        @{ key = 'APP_URL'; value = "https://$NetlifySiteName.netlify.app" },
        @{ key = 'RENDER_REGION'; value = 'oregon' },
        @{ key = 'RENDER_PLAN'; value = 'free' }
    )

    $svcPayload = @{
        type = 'web_service'
        name = $RenderServiceName
        ownerId = $ownerId
        repo = "https://github.com/$Repo"
        branch = $Branch
        autoDeploy = 'yes'
        envVars = $envVars
        serviceDetails = @{
            runtime = 'node'
            plan = 'free'
            region = 'oregon'
            healthCheckPath = '/health'
            envSpecificDetails = @{
                buildCommand = 'npm i -g pnpm@9.15.9 && pnpm install --no-frozen-lockfile --prod=false && pnpm exec prisma generate --schema prisma/schema.production.prisma && pnpm build'
                # O schema é aplicado via SQL na Management API do Supabase
                # (database/schema.sql e database/seed.sql). Nunca usar `prisma db push` aqui.
                startCommand = 'pnpm start'
            }
        }
    } | ConvertTo-Json -Depth 10

    if (-not $WhatIf) {
        try {
            $svc = Invoke-RestMethod -Uri 'https://api.render.com/v1/services' -Method Post `
                -Headers @{ Authorization = "Bearer $($secrets['render.installerApiToken'])" } `
                -ContentType 'application/json' -Body $svcPayload -TimeoutSec 60
            Write-Ok "Servico Render criado: $($svc.service.id)"
        } catch {
            Write-Warn "Render: $($_.Exception.Message)"
        }
    }
} elseif ($SkipRender) {
    Write-Warn 'Render pulado (-SkipRender)'
} else {
    Write-Warn 'Render NAO sera criado (token invalido)'
}

# ===== 4. Netlify =====
if (-not $SkipNetlify -and $netlifyOk) {
    Write-Step '4. Criando site no Netlify'
    $payload = @{
        name = $NetlifySiteName
        account_slug = $NetlifyAccountSlug
        repo = @{
            provider = 'github'
            repo = $Repo
            branch = $Branch
            build = @{
                command = 'pnpm install --no-frozen-lockfile --prod=false && pnpm --filter @apollo-installer/admin-ui exec vite build'
                publish = 'dist/admin'
            }
        }
    } | ConvertTo-Json -Depth 6

    if (-not $WhatIf) {
        try {
            $site = Invoke-RestMethod -Uri 'https://api.netlify.com/api/v1/sites' -Method Post `
                -Headers @{ Authorization = "Bearer $($secrets['netlify.authToken'])"; 'Content-Type' = 'application/json' } `
                -Body $payload -TimeoutSec 60
            Write-Ok "Site Netlify criado: $($site.id) - $($site.ssl_url)"
            $envPayload = ConvertTo-Json -InputObject @(@{
                key = 'VITE_API_URL'
                values = @(@{ value = "https://$RenderServiceName.onrender.com"; context = 'all' })
            }) -Depth 8
            try {
                Invoke-RestMethod -Uri "https://api.netlify.com/api/v1/accounts/$($site.account_id)/env?site_id=$($site.id)" -Method Post `
                    -Headers @{ Authorization = "Bearer $($secrets['netlify.authToken'])" } `
                    -ContentType 'application/json' -Body $envPayload -TimeoutSec 30 | Out-Null
                Write-Ok "VITE_API_URL configurada no Netlify"
            } catch {
                Write-Warn "Netlify env: $($_.Exception.Message)"
            }
        } catch {
            Write-Warn "Netlify: $($_.Exception.Message)"
        }
    }
} elseif ($SkipNetlify) {
    Write-Warn 'Netlify pulado (-SkipNetlify)'
} else {
    Write-Warn 'Netlify NAO sera criado (token invalido)'
}

Write-Step 'Resumo'
"Render token valido: $renderOk"
"Supabase token valido: $supabaseOk"
"Netlify token valido: $netlifyOk"
if ($dbUrl) { "DATABASE_URL obtida: sim" } else { "DATABASE_URL obtida: NAO" }
