import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * 知识图谱工作流：
 * - input: 用户笔记（note）
 * - agent: NextClaw 执行产物（learning card）
 * - output: 任务执行输出（succeeded learning job）
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const [notes, links, cards, jobs] = await Promise.all([
    prisma.note.findMany({
      where: { userId: user.id, archived: false },
      orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
      select: { id: true, title: true, excerpt: true, updatedAt: true },
    }),
    prisma.noteLink.findMany({
      where: {
        userId: user.id,
        fromNote: { archived: false },
        toNote: { archived: false },
      },
      select: { fromNoteId: true, toNoteId: true },
    }),
    prisma.learningCard.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: { id: true, noteId: true, type: true, title: true, contentMd: true, createdAt: true },
    }),
    prisma.learningJob.findMany({
      where: { userId: user.id, status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
      take: 60,
      select: { id: true, noteId: true, type: true, status: true, steps: true, finishedAt: true, updatedAt: true },
    }),
  ]);

  const degree = new Map<string, number>();
  const edgeList: Array<{
    source: string;
    target: string;
    kind: "LINK" | "DERIVED_FROM" | "PRODUCES" | "CONFLICT_HINT";
  }> = [];
  const pushEdge = (
    source: string,
    target: string,
    kind: "LINK" | "DERIVED_FROM" | "PRODUCES" | "CONFLICT_HINT",
  ) => {
    edgeList.push({ source, target, kind });
    degree.set(source, (degree.get(source) ?? 0) + 1);
    degree.set(target, (degree.get(target) ?? 0) + 1);
  };

  for (const n of notes) degree.set(`note:${n.id}`, 0);
  for (const c of cards) degree.set(`card:${c.id}`, 0);
  for (const j of jobs) degree.set(`job:${j.id}`, 0);

  for (const e of links) {
    pushEdge(`note:${e.fromNoteId}`, `note:${e.toNoteId}`, "LINK");
  }
  for (const c of cards) {
    pushEdge(`note:${c.noteId}`, `card:${c.id}`, "DERIVED_FROM");
    if (c.type === "CONFLICT") {
      pushEdge(`card:${c.id}`, `note:${c.noteId}`, "CONFLICT_HINT");
    }
  }
  for (const j of jobs) {
    if (!j.noteId) continue;
    const latestCard = cards.find((c) => c.noteId === j.noteId);
    if (latestCard) pushEdge(`card:${latestCard.id}`, `job:${j.id}`, "PRODUCES");
    else pushEdge(`note:${j.noteId}`, `job:${j.id}`, "PRODUCES");
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
          "与其关联的学习卡片可用于补位、冲突识别与复习。",
        ],
      })),
      ...cards.map((c) => ({
        id: `card:${c.id}`,
        nodeKind: "card" as const,
        title: c.title,
        degree: degree.get(`card:${c.id}`) ?? 0,
        excerpt: c.contentMd.slice(0, 220),
        updatedAt: c.createdAt.toISOString(),
        reasoningLog: [
          `卡片类型：${c.type}`,
          `来源笔记：${c.noteId}`,
          c.contentMd.slice(0, 120) || "内容为空",
        ],
      })),
      ...jobs.map((j) => ({
        id: `job:${j.id}`,
        nodeKind: "job" as const,
        title: `任务输出：${j.type}`,
        degree: degree.get(`job:${j.id}`) ?? 0,
        excerpt: j.status === "SUCCEEDED" ? "执行记录：用于回溯，不代表实时状态。" : "任务未成功。",
        updatedAt: (j.finishedAt ?? j.updatedAt).toISOString(),
        reasoningLog: Array.isArray(j.steps)
          ? (j.steps as Array<{ label?: unknown; status?: unknown }>).slice(-4).map((s) => `${String(s.label ?? "step")} [${String(s.status ?? "")}]`)
          : ["执行记录为空"],
      })),
    ],
    edges: edgeList,
  });
}
