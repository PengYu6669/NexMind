# AGENTS.md

## Scope And Ownership

- The main agent handles work by default. Create sub-agents only when explicitly requested or when independent cross-module review materially reduces risk.
- Search from the user entry, route, configuration, or changed file and follow the actual call chain.
- Preserve unrelated worktree changes. Do not mix unrelated refactors into a feature change.
- Prefer updating an existing durable document over creating status reports, comparison files, or implementation diaries.

## Non-Negotiable Contracts

### API

- API request bodies use Zod schemas from `lib/api-inputs.ts` or an equally explicit local schema.
- Response-shape changes require synchronized frontend type/rendering updates.
- Every user-owned read/write includes `userId` ownership filtering.
- Do not expose secrets, internal stack traces, or raw provider payloads in production responses.

### Database

- Every Prisma schema change requires a migration.
- Production applies `prisma migrate deploy`; never use `db push`, `migrate reset`, or `--accept-data-loss` in build/deploy paths.
- Verify the complete migration history against an empty PostgreSQL database.
- Raw RAG tables are intentionally outside Prisma models; do not accept generated diffs that drop `note_chunks` or `source_embedding_chunks`.

### Learning Jobs And LangGraph

- Job claim remains atomic (`FOR UPDATE SKIP LOCKED`).
- `PENDING`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`, `WAITING_INPUT`, and `SKIPPED` have distinct semantics.
- HITL waiting uses `WAITING_INPUT`; user cancellation uses `CANCELLED`.
- `steps`, plans, tool inputs, checkpoint state, and event payloads must be serializable JSON.
- Conditional-edge behavior belongs in `lib/nextclaw-routing.ts` and requires tests.
- Optional MCP, search, web read, audit, OCR, and object storage capabilities must have a usable fallback or an explicit degraded state.
- Never fetch a user-provided URL without `assertSafePublicHttpUrl` at both API and tool boundaries.

### RAG

- Embedding dimension must match migrations, inserts, queries, and indexes.
- Production request paths validate RAG schema; they do not silently mutate it unless explicitly enabled for an emergency.
- Retrieval changes require focused tests or evaluation evidence; do not claim quality improvements from implementation alone.

### Frontend

- Keep desktop navigation and mobile bottom navigation usable.
- New fixed-width surfaces require responsive constraints and overflow handling.
- Test at least one desktop and one mobile viewport for layout changes.
- Do not introduce a new UI framework for a local component change.

## Change Workflow

1. Locate the user-visible entry and backend/domain call chain.
2. State the behavior and data contract before editing.
3. Make the smallest complete change across UI, API, domain, and persistence boundaries.
4. Add tests proportional to failure impact.
5. Run the complete gate before handoff.

## Required Gate

```bash
npm run lint
npm run typecheck
npm run test
npm run test:core
npm run build
```

For database changes, additionally apply every migration to a fresh database. For UI changes, inspect desktop and mobile rendering.

## Handoff

Summaries should cover no more than five high-value points:

- user entry
- core data flow
- key files
- primary failure/degradation path
- important design choice

Do not generate duplicate weekly reports, before/after documents, or completion checklists unless the user explicitly requests them.
