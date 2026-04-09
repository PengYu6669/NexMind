-- NextClaw 自动学习：任务队列、学习卡片、复习项（与 schema.prisma 对齐）

-- CreateEnum
CREATE TYPE "LearningJobType" AS ENUM ('NOTE_LEARN_LITE', 'NOTE_LEARN_DEEP', 'NOTE_EXTERNAL_INJECT');

-- CreateEnum
CREATE TYPE "LearningJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "LearningCardType" AS ENUM ('REVIEW', 'FILL_GAP', 'PITFALL', 'CONFLICT', 'RELATED', 'EXTERNAL');

-- CreateTable
CREATE TABLE "LearningJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT,
    "type" "LearningJobType" NOT NULL,
    "status" "LearningJobStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "noteUpdatedAt" TIMESTAMP(3),
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "budgetTokens" INTEGER,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "type" "LearningCardType" NOT NULL,
    "title" TEXT NOT NULL,
    "contentMd" TEXT NOT NULL,
    "sources" JSONB,
    "noteUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "intervalDays" INTEGER NOT NULL DEFAULT 1,
    "easeFactor" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "lastScore" INTEGER,
    "lastReviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LearningJob_userId_status_runAt_idx" ON "LearningJob"("userId", "status", "runAt");

-- CreateIndex
CREATE INDEX "LearningJob_noteId_idx" ON "LearningJob"("noteId");

-- CreateIndex
CREATE INDEX "LearningJob_userId_type_status_idx" ON "LearningJob"("userId", "type", "status");

-- CreateIndex
CREATE INDEX "LearningCard_userId_createdAt_idx" ON "LearningCard"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LearningCard_noteId_createdAt_idx" ON "LearningCard"("noteId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "LearningCard_userId_noteId_type_idx" ON "LearningCard"("userId", "noteId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewItem_userId_noteId_key" ON "ReviewItem"("userId", "noteId");

-- CreateIndex
CREATE INDEX "ReviewItem_userId_dueDate_idx" ON "ReviewItem"("userId", "dueDate");

-- CreateIndex
CREATE INDEX "ReviewItem_noteId_idx" ON "ReviewItem"("noteId");

-- AddForeignKey
ALTER TABLE "LearningJob" ADD CONSTRAINT "LearningJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningJob" ADD CONSTRAINT "LearningJob_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCard" ADD CONSTRAINT "LearningCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningCard" ADD CONSTRAINT "LearningCard_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewItem" ADD CONSTRAINT "ReviewItem_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
