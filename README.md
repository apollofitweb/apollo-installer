# Apollo Installer - Instalador Automatizado de Novas Filiais

Projeto independente para automatização da implantação de novas filiais Apollo Fit.

## Arquitetura

```
apollo-installer/
├── src/
│   ├── admin/          # Interface administrativa (placeholder OS-002)
│   ├── api/            # API REST (Fastify)
│   │   ├── plugins/    # Error handler, logger, swagger
│   │   └── routes/     # Health, deployments
│   ├── engine/         # Motor de implantação
│   │   ├── deployment-engine.ts
│   │   └── state-machine.ts
│   ├── adapters/       # Interfaces para integrações externas
│   │   ├── base.ts     # Interfaces (Supabase, Render, Netlify)
│   │   └── mock.ts     # Mock implementations (OS-002)
│   ├── persistence/    # Camada de dados (Prisma)
│   │   ├── prisma.ts
│   │   └── deployment.repository.ts
│   ├── config/         # Configuração e validação
│   │   ├── env.ts
│   │   └── validation.ts
│   └── shared/         # Tipos, erros, logger compartilhados
├── tests/              # Testes unitários e integração
├── prisma/
│   └── schema.prisma   # Schema do banco (SQLite dev / PostgreSQL prod)
└── package.json
```

## Componentes

### 1. API do Instalador (`src/api/`)
- **Fastify 5** com TypeScript
- Rotas: `/health`, `/api/deployments`
- Plugins: error handler, request logger, Swagger/OpenAPI
- Validação com Zod

### 2. Motor de Implantação (`src/engine/`)
- **DeploymentEngine**: Orquestra etapas sequenciais com retry
- **StateMachine**: Garante transições válidas de estado
- Independente da interface admin e dos adaptadores

### 3. Adaptadores (`src/adapters/`)
- **Interfaces apenas** em OS-002 (SupabaseAdapter, RenderAdapter, NetlifyAdapter)
- **Mock implementations** para desenvolvimento/teste
- Fábrica de adaptadores para injeção de dependência

### 4. Persistência (`src/persistence/`)
- **Prisma Client** com SQLite (dev) / PostgreSQL (prod)
- Repository pattern para Deployments, Steps, Configs
- Schema: Deployment, DeploymentStep, DeploymentConfig

### 5. Configuração (`src/config/`)
- Validação de env com Zod (`env.ts`)
- Validação de entrada de filial (`validation.ts`)

### 6. Interface Admin (`src/admin/`)
- Placeholder em OS-002
- Será dashboard React/Vue para acompanhamento visual

## Fluxo de Implantação (6 etapas)

1. **supabase_create** - Criar projeto Supabase + connection strings
2. **supabase_migrate_seed** - Aplicar migrations + seed admin
3. **render_create** - Criar web service Render (Docker)
4. **render_configure** - Configurar env vars (DATABASE_URL, JWT, CORS, etc.)
5. **netlify_deploy** - Deploy frontend no site compartilhado Netlify
6. **netlify_configure** - Adicionar domínio + VITE_API_URL + redirects

## Comandos

```bash
# Install dependencies
pnpm install

# Generate Prisma client
pnpm db:generate

# Push schema to database (dev)
pnpm db:push

# Run development server
pnpm dev

# Run tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Lint
pnpm lint

# Build
pnpm build

# Start production
pnpm start
```

## Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha:

```bash
cp .env.example .env
```

Obrigatórias em produção:
- `JWT_ACCESS_SECRET` (min 32 chars)
- `JWT_REFRESH_SECRET` (min 32 chars)
- `ALLOWED_ORIGINS` (lista explícita, nunca `*`)
- `DATABASE_URL` (PostgreSQL)

## Segurança

- `.env` no `.gitignore`
- Segredos apenas via variáveis de ambiente
- Bcrypt para senhas
- JWT access (15m) + refresh (7d)
- Helmet, CORS, Rate-limit no Fastify
- Validação estrita de entrada com Zod

## Testes

```bash
pnpm test
```

Cobertura alvo: >80% nos módulos core (engine, persistence, validation, adapters).

## OS-002 Status

✅ Estrutura-base criada
✅ Separação arquitetural (admin, api, engine, adapters, persistence, config)
✅ Interfaces de adaptadores (Supabase, Render, Netlify)
✅ Mock implementations para desenvolvimento
✅ Prisma schema para persistência
✅ Validação de entrada (Zod)
✅ State machine para transições
✅ Deployment engine com retry
✅ API routes (health, deployments CRUD, start/resume)
✅ Testes unitários (types, state-machine, mock adapters, API)
✅ Testes de integração (API com Fastify inject)

## Próximos Passos (OS-003+)

- Implementações reais dos adaptadores (Supabase CLI, Render API, Netlify API)
- Interface administrativa (React + Vite)
- Gestão segura de segredos (Vault/Key Management)
- Webhooks para callbacks assíncronos
- Rollback automático em falhas
- Notificações (e-mail, Slack, Teams)