-- AlterTable
ALTER TABLE "KnowledgeSource" ADD COLUMN IF NOT EXISTS "conversationId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KnowledgeSource_conversationId_idx" ON "KnowledgeSource"("conversationId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'KnowledgeSource_conversationId_fkey'
  ) THEN
    ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
