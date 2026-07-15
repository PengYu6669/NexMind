# CLAUDE.md

This file is the fast entry point for coding agents working on NexMind / NextClaw. Read `AGENTS.md` for mandatory engineering rules.

## Product In One Sentence

NexMind is a personal AI knowledge OS: notes and uploaded sources are indexed into PostgreSQL/pgvector, retrieved into chat and LangGraph learning workflows, converted into learning cards, and scheduled for review.

## Start Here

Read in this order according to the task:

1. `README.md`: current product scope, setup, commands, and project map.
2. `prisma/schema.prisma`: domain state and ownership relationships.
3. User entry route or component under `app/` / `components/`.
4. The corresponding API route under `app/api/`.
5. The domain function called by the route under `lib/`.

Do not scan the whole repository before locating the user entry and API contract.

## Critical Flows

### Notes And RAG

```text
/notes -> NoteEditor -> /api/notes/[id] -> Note
                                  -> after(indexNoteForRag)
                                  -> note_chunks / pgvector
/search -> /api/search -> ragSearch -> hybrid retrieval
```

RAG production schema is migration-owned. `ensureRagSchema` may auto-initialize in development, but production normally validates only. The current vector dimension contract is 1024.

### NextClaw Learning Job

```text
enqueue -> LearningJob(PENDING)
        -> PostgreSQL SKIP LOCKED claim
        -> LangGraph
        -> LearningCard + ReviewItem
        -> /learn review and SM-2 update
```

Graph nodes:

```text
load_and_retrieve -> supervisor -> auto_reason
  -> optional web_search -> filter -> fetch -> audit
  -> planner_node -> plan_executor -> coach -> persist -> finalize
```

Key boundaries:

- Conditional edges are pure functions in `lib/nextclaw-routing.ts` and must remain unit tested.
- Planner input normalization is in `lib/nextclaw-plan.ts`; never drop `toolInput`.
- Search with no usable source enters `WAITING_INPUT`, not `CANCELLED`.
- HITL source override replays safely on the same job ID.
- `steps` and checkpoint state must remain serializable and schema-valid.
- MCP/search/fetch/audit failures must degrade where policy allows.

### Authentication And API

- Auth identity comes from `getAuthUser()` in `lib/auth.ts`.
- Every user-owned query must include `userId` ownership filtering.
- JSON request bodies use schemas from `lib/api-inputs.ts`.
- System environment/API keys are not user-editable.
- User-provided URLs must pass `assertSafePublicHttpUrl` before storage and before fetch.

## Commands

```bash
docker compose up -d
npm run db:deploy
npm run lint
npm run typecheck
npm run test
npm run test:core
npm run build
```

Run the smallest relevant test while iterating, then the complete gate before handoff.

## Environment Rules

- `.env.example` is the documented variable source.
- Never commit `.env` or real credentials.
- New `process.env.*` usage requires `.env.example` and README updates.
- `AUTH_JWT_SECRET` is mandatory in production.
- Build must not run `db push`, reset data, or use `--accept-data-loss`.

## Known Large Modules

The following files are large and should be changed carefully:

- `lib/nextclaw-langgraph.ts`
- `lib/rag.ts`
- `components/notes/NoteEditor.tsx`
- `components/layout/AiChatPanel.tsx`

Extract pure policy/domain modules when it creates a testable boundary. Avoid mechanical rewrites that mix refactoring with behavior changes.
