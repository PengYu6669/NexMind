import { prisma } from "@/lib/prisma";
import { extractNoteRefIdsFromHtml } from "@/lib/note-ref";

/** 根据正文 HTML 同步本笔记的出链（NoteLink：fromNoteId → toNoteId），与正文一致 */
export async function syncOutgoingNoteLinksFromContent(params: {
  userId: string;
  fromNoteId: string;
  html: string;
}) {
  const { userId, fromNoteId, html } = params;
  const raw = extractNoteRefIdsFromHtml(html);
  const unique = [...new Set(raw)].filter((id) => id !== fromNoteId);

  if (unique.length === 0) {
    await prisma.noteLink.deleteMany({ where: { userId, fromNoteId } });
    return;
  }

  const validNotes = await prisma.note.findMany({
    where: {
      userId,
      archived: false,
      id: { in: unique },
    },
    select: { id: true },
  });
  const validIds = validNotes.map((n) => n.id);

  await prisma.$transaction(async (tx) => {
    await tx.noteLink.deleteMany({ where: { userId, fromNoteId } });
    if (validIds.length === 0) return;
    await tx.noteLink.createMany({
      data: validIds.map((toNoteId) => ({ userId, fromNoteId, toNoteId })),
      skipDuplicates: true,
    });
  });
}
