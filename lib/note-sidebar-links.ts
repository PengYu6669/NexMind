import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export type SidebarLinkItem = { id: string; title: string };

function isMissingNoteLinkRelation(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2021") {
    return true;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return /42P01|relation\s+"NoteLink"\s+does not exist|does not exist/i.test(msg);
}

/**
 * 拉取笔记侧栏「本文引用 / 引用本文」。
 * 优先用 prisma.noteLink；若 Client 与 schema 不同步可退回 $queryRaw。
 * 若尚未执行迁移、表不存在，返回空数组（避免 500）。
 */
export async function getNoteSidebarLinks(
  noteId: string,
  userId: string
): Promise<{ outgoing: SidebarLinkItem[]; incoming: SidebarLinkItem[] }> {
  const empty = (): { outgoing: SidebarLinkItem[]; incoming: SidebarLinkItem[] } => ({
    outgoing: [],
    incoming: [],
  });

  try {
    const [outgoingRows, incomingRows] = await Promise.all([
      prisma.noteLink.findMany({
        where: { fromNoteId: noteId, userId },
        include: { toNote: { select: { id: true, title: true } } },
        orderBy: { createdAt: "asc" },
      }),
      prisma.noteLink.findMany({
        where: { toNoteId: noteId, userId },
        include: { fromNote: { select: { id: true, title: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    return {
      outgoing: outgoingRows.map((l) => ({ id: l.toNote.id, title: l.toNote.title })),
      incoming: incomingRows.map((l) => ({ id: l.fromNote.id, title: l.fromNote.title })),
    };
  } catch (e) {
    if (isMissingNoteLinkRelation(e)) return empty();
    try {
      const outgoing = await prisma.$queryRaw<SidebarLinkItem[]>`
        SELECT n.id, n.title
        FROM "NoteLink" nl
        INNER JOIN "Note" n ON n.id = nl."toNoteId"
        WHERE nl."fromNoteId" = ${noteId}
          AND nl."userId" = ${userId}
          AND n."userId" = ${userId}
        ORDER BY nl."createdAt" ASC
      `;
      const incoming = await prisma.$queryRaw<SidebarLinkItem[]>`
        SELECT n.id, n.title
        FROM "NoteLink" nl
        INNER JOIN "Note" n ON n.id = nl."fromNoteId"
        WHERE nl."toNoteId" = ${noteId}
          AND nl."userId" = ${userId}
          AND n."userId" = ${userId}
        ORDER BY nl."createdAt" ASC
      `;
      return {
        outgoing: outgoing.map((r) => ({ id: r.id, title: r.title })),
        incoming: incoming.map((r) => ({ id: r.id, title: r.title })),
      };
    } catch (e2) {
      if (isMissingNoteLinkRelation(e2)) return empty();
      throw e2;
    }
  }
}
