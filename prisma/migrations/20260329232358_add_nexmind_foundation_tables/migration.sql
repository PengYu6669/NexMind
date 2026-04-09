-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mimeType" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "storageKey" TEXT,
    "sourceUrl" TEXT,
    "parseStatus" TEXT NOT NULL DEFAULT 'pending',
    "indexStatus" TEXT NOT NULL DEFAULT 'pending',
    "extractedText" TEXT,
    "parseError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceChunk" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "pageStart" INTEGER,
    "pageEnd" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudyProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyProjectNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyProjectNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyProjectSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyProjectSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'nextclaw',
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "importance" INTEGER NOT NULL DEFAULT 1,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "recommendations" JSONB,
    "quizItems" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KnowledgeSource_userId_createdAt_idx" ON "KnowledgeSource"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "KnowledgeSource_userId_parseStatus_idx" ON "KnowledgeSource"("userId", "parseStatus");

-- CreateIndex
CREATE INDEX "KnowledgeSource_userId_indexStatus_idx" ON "KnowledgeSource"("userId", "indexStatus");

-- CreateIndex
CREATE INDEX "SourceChunk_userId_sourceId_idx" ON "SourceChunk"("userId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceChunk_sourceId_chunkIndex_key" ON "SourceChunk"("sourceId", "chunkIndex");

-- CreateIndex
CREATE INDEX "StudyProject_userId_status_idx" ON "StudyProject"("userId", "status");

-- CreateIndex
CREATE INDEX "StudyProject_userId_updatedAt_idx" ON "StudyProject"("userId", "updatedAt" DESC);

-- CreateIndex
CREATE INDEX "StudyProjectNote_userId_projectId_idx" ON "StudyProjectNote"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyProjectNote_projectId_noteId_key" ON "StudyProjectNote"("projectId", "noteId");

-- CreateIndex
CREATE INDEX "StudyProjectSource_userId_projectId_idx" ON "StudyProjectSource"("userId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyProjectSource_projectId_sourceId_key" ON "StudyProjectSource"("projectId", "sourceId");

-- CreateIndex
CREATE INDEX "UserMemory_userId_scope_importance_idx" ON "UserMemory"("userId", "scope", "importance");

-- CreateIndex
CREATE UNIQUE INDEX "UserMemory_userId_scope_key_key" ON "UserMemory"("userId", "scope", "key");

-- CreateIndex
CREATE INDEX "LearningSnapshot_userId_createdAt_idx" ON "LearningSnapshot"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LearningSnapshot_userId_projectId_idx" ON "LearningSnapshot"("userId", "projectId");

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceChunk" ADD CONSTRAINT "SourceChunk_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceChunk" ADD CONSTRAINT "SourceChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProject" ADD CONSTRAINT "StudyProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProjectNote" ADD CONSTRAINT "StudyProjectNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProjectNote" ADD CONSTRAINT "StudyProjectNote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StudyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProjectNote" ADD CONSTRAINT "StudyProjectNote_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProjectSource" ADD CONSTRAINT "StudyProjectSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProjectSource" ADD CONSTRAINT "StudyProjectSource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StudyProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyProjectSource" ADD CONSTRAINT "StudyProjectSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSnapshot" ADD CONSTRAINT "LearningSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSnapshot" ADD CONSTRAINT "LearningSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "StudyProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
