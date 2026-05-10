import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 知识图谱：仅展示笔记节点与笔记之间引用关系。 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const reqUrl = new URL(req.url);
  const folderIdRaw = reqUrl.searchParams.get("folderId")?.trim() ?? "";
  const folderFilter =
    folderIdRaw === "__all__" || !folderIdRaw
      ? { mode: "all" as const }
      : folderIdRaw === "__uncat__"
        ? { mode: "uncat" as const }
        : { mode: "folder" as const, folderId: folderIdRaw };

  if (folderFilter.mode === "folder") {
    const ok = await prisma.noteFolder.findFirst({
      where: { id: folderFilter.folderId, userId: user.id },
      select: { id: true },
    });
    if (!ok) {
      return NextResponse.json({ error: "文件夹不存在" }, { status: 400 });
    }
  }

  const [notes, links] = await Promise.all([
    prisma.note.findMany({
      where: {
        userId: user.id,
        archived: false,
        ...(folderFilter.mode === "folder" ? { folderId: folderFilter.folderId } : {}),
        ...(folderFilter.mode === "uncat" ? { folderId: null } : {}),
      },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { id: true, title: true, excerpt: true, updatedAt: true, folderId: true },
    }),
    prisma.noteLink.findMany({
      where: {
        userId: user.id,
        fromNote: { archived: false },
        toNote: { archived: false },
      },
      select: { fromNoteId: true, toNoteId: true },
    }),
  ]);
  const noteIdSet = new Set(notes.map((n) => n.id));
  const linksFiltered = links.filter((e) => noteIdSet.has(e.fromNoteId) && noteIdSet.has(e.toNoteId));

  const degree = new Map<string, number>();
  const edgeList: Array<{
    source: string;
    target: string;
    kind: "LINK" | "DERIVED_FROM" | "PRODUCES" | "CONFLICT_HINT";
  }> = [];
  const edgeKeys = new Set<string>();
  const pushEdge = (
    source: string,
    target: string,
    kind: "LINK" | "DERIVED_FROM" | "PRODUCES" | "CONFLICT_HINT",
  ) => {
    const k = `${source}->${target}`;
    if (edgeKeys.has(k)) return;
    edgeKeys.add(k);
    edgeList.push({ source, target, kind });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  };

  for (const n of notes) degree.set(`note:${n.id}`, 0);

  for (const e of linksFiltered) {
    pushEdge(`note:${e.fromNoteId}`, `note:${e.toNoteId}`, "LINK");
  }

  return NextResponse.json({
    nodes: [
      ...notes.map((n) => ({
        id: `note:${n.id}`,
        nodeKind: "note" as const,
        title: n.title,
        degree: degree.get(`note:${n.id}`) ?? 0,
        excerpt: n.excerpt,
        updatedAt: n.updatedAt.toISOString(),
        reasoningLog: [
          `知识源：${n.title || "无标题"}`,
          "点击节点可直接跳转到对应笔记。",
        ],
      })),
    ],
    edges: edgeList,
  });
}
