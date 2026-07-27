# NexMind / NextClaw

> A personal knowledge OS that turns notes and sources into searchable context, traceable Agent workflows, and spaced-repetition learning.

NexMind is a full-stack AI knowledge workspace built with Next.js. It connects a rich-text knowledge base, hybrid RAG search, streaming chat, and a LangGraph learning workflow that can retrieve, search, audit, plan, generate cards, and schedule review.

## Why This Project

Most AI note apps stop at chat or semantic search. NexMind treats learning as an observable workflow:

```text
capture -> index -> retrieve -> decide -> search/audit -> plan -> execute -> coach -> persist -> review
```

Every learning job records serializable `steps`, tool outcomes, retries, degradation, HITL state, and final status. Optional capabilities such as MCP, web search, OCR, and object storage have explicit fallback paths.

## Core Capabilities

| Area | What it does |
| --- | --- |
| Knowledge base | Tiptap notes, folders, tags, archive/pin, links, attachments |
| Conversation | Multi-session chat with SSE streaming and note/card context |
| RAG | PostgreSQL + pgvector hybrid retrieval with structured chunking and FTS |
| NextClaw | LangGraph DAG with supervisor, retrieval, web source audit, planner, executor, coach, and persistence nodes |
| Learning | Learning cards, SM-2 scheduling, AI answer scoring, matched/missing keypoints |
| Graph | React Flow knowledge and workflow visualization |
| Tools | Optional stdio MCP servers for knowledge, search, web reading, and auditing |
| Safety | Zod API contracts, ownership checks, SSRF URL guard, auth/cron protection, rate limits |

## Architecture

- **Web boundary**: Next.js App Router pages and API routes.
- **Domain boundary**: `lib/` contains auth, RAG, learning jobs, Agent policies, routing, and tool adapters.
- **Workflow boundary**: `lib/nextclaw-langgraph.ts` owns graph assembly and execution; pure routing and plan normalization live in `lib/nextclaw-routing.ts` and `lib/nextclaw-plan.ts`.
- **Persistence boundary**: Prisma models business entities; raw vector tables are managed by reviewed migrations and RAG schema validation.
- **Async boundary**: `LearningJob` is claimed atomically with PostgreSQL `SKIP LOCKED`, supports leases, bounded retries, backoff, and `WAITING_INPUT`.

## Local Development

### Requirements

- Node.js 20+
- Docker Desktop
- PostgreSQL with pgvector, provided locally by Compose
- An OpenAI-compatible chat/embedding provider for AI features

### Start the database

```bash
docker compose up -d
```

Before starting Compose, set `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` in the ignored local `.env` file. The bundled database is exposed at `localhost:55432`; construct `DATABASE_URL` with the same credentials:

```env
POSTGRES_USER="<DB_USER>"
POSTGRES_PASSWORD="<GENERATE_A_RANDOM_DATABASE_PASSWORD>"
POSTGRES_DB="<DB_NAME>"
DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@localhost:55432/<DB_NAME>?schema=public"
```

### Install, migrate, and run

```bash
npm install
npm run db:generate
npm run db:deploy
npm run dev
```

The default development URL is `http://localhost:3000`. Use `npm run dev -- -p 3002` when port 3000 is occupied.

### Environment

Copy `.env.example` to `.env`. Minimum required values:

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `AI_API_KEY`
- `AI_API_BASE_URL`
- `AI_MODEL_CHAT`
- `AI_MODEL_EMBEDDING`
- `AI_EMBEDDING_DIMENSION` (the current migration contract is 1024)

Optional integrations include `SERPAPI_API_KEY`, `NEXTCLAW_MCP_ENABLED`, `VOLC_TOS_*`, `BAIDU_OCR_*`, and `INTERNAL_CRON_TOKEN`. System-level keys are configured through the environment, not through user settings.

## Commands

```bash
npm run dev          # development server
npm run build        # Prisma client + production build; does not mutate the database
npm run start        # production server
npm run lint         # ESLint, zero-error gate
npm run typecheck    # TypeScript check
npm run test         # Vitest unit tests
npm run test:core    # PostgreSQL/RAG/task lifecycle integration check
npm run db:migrate   # create a development migration
npm run db:deploy    # apply reviewed migrations
npm run db:reset     # reset a development database
```

## Verification

The current regression baseline includes:

- Vitest coverage for API contracts, RAG chunking, retry/degradation policy, rate limiting, URL safety, Agent routing, and plan normalization.
- A real PostgreSQL integration check for migrations, vector schema, RAG chunking, cron auth, and learning job lifecycle.
- HTTP smoke coverage for registration, login, note creation/update, settings ownership, and health readiness.
- `lint`, `typecheck`, and `build` gates.

Health endpoints:

- `GET /api/health/live`: process liveness.
- `GET /api/health/ready`: database and RAG schema readiness.

## Project Map

- `docs/项目地图.md`: ownership checklist, code-reading routes, and interview Q&A
- `app/`: routes and API boundaries
- `components/`: user-facing UI
- `lib/nextclaw-langgraph.ts`: workflow graph and node execution
- `lib/nextclaw-routing.ts`: pure conditional-edge decisions
- `lib/nextclaw-agent-tools.ts`: MCP-first tools with local fallback
- `lib/rag.ts`: chunk indexing, embeddings, hybrid retrieval, schema validation
- `lib/learning-jobs-runner.ts`: atomic queue claim, leases, retry, and execution
- `prisma/schema.prisma`: relational domain model
- `prisma/migrations/`: reviewed database history
- `tests/`: fast unit and policy tests
- `scripts/test-core-chain.ts`: real database integration check

## License

Private project. Add a license before public distribution.
