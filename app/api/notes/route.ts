import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createNoteInputSchema, firstValidationMessage } from "@/lib/api-inputs";

/** 工作台对话区 / 关联笔记选择器：query limit 默认 50，最大 200 */
export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const raw = new URL(req.url).searchParams.get("limit");
  const parsed = raw ? parseInt(raw, 10) : 50;
  const take = Number.isFinite(parsed) ? Math.min(200, Math.max(1, parsed)) : 50;

  const notes = await prisma.note.findMany({
    where: { userId: user.id, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take,
    select: { id: true, title: true, updatedAt: true },
  });

  return NextResponse.json({ notes });
}

/** 新建笔记：返回 noteId，随后前端跳转 /notes/:id */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = createNoteInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });
  const body = parsed.data;
  const titleRaw = body.title ?? "";
  const title = titleRaw || "无标题";

  let folderId: string | null | undefined;
  if (body.folderId !== undefined) {
    if (body.folderId === null) {
      folderId = null;
    } else {
      const fo = await prisma.noteFolder.findFirst({
        where: { id: body.folderId, userId: user.id },
        select: { id: true },
      });
      if (!fo) {
        return NextResponse.json({ error: "文件夹不存在" }, { status: 400 });
      }
      folderId = body.folderId;
    }
  }

  const note = await prisma.note.create({
    data: {
      userId: user.id,
      title,
      content: "",
      sourceType: "manual",
      ...(folderId !== undefined ? { folderId } : {}),
    },
    select: { id: true },
  });

  return NextResponse.json({ noteId: note.id });
}
