-- Reconcile fields already used by the application but missing from the
-- migration history. Keep raw pgvector tables managed by the RAG layer.
ALTER TYPE "LearningCardType" ADD VALUE IF NOT EXISTS 'AUDIT';

ALTER TABLE "LearningJob"
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "plan" JSONB,
  ADD COLUMN IF NOT EXISTS "steps" JSONB;

ALTER TABLE "User"
  ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
