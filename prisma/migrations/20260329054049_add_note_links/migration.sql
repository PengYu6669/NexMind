-- CreateTable
CREATE TABLE "NoteLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromNoteId" TEXT NOT NULL,
    "toNoteId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteLink_userId_idx" ON "NoteLink"("userId");

-- CreateIndex
CREATE INDEX "NoteLink_fromNoteId_idx" ON "NoteLink"("fromNoteId");

-- CreateIndex
CREATE INDEX "NoteLink_toNoteId_idx" ON "NoteLink"("toNoteId");

-- CreateIndex
CREATE UNIQUE INDEX "NoteLink_fromNoteId_toNoteId_key" ON "NoteLink"("fromNoteId", "toNoteId");

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_fromNoteId_fkey" FOREIGN KEY ("fromNoteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_toNoteId_fkey" FOREIGN KEY ("toNoteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;
