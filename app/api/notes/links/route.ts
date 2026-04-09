import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

type LinkBody = { fromNoteId?: string; toNoteId?: string };

async function assertNotesOwnedAndActive(
  userId: string,
  fromNoteId: string,
  toNoteId: string
) {
  if (fromNoteId === toNoteId) {
    return { error: "不能将笔记关联到自身" as const };
  }
  const [a, b] = await Promise.all([
    prisma.note.findFirst({
      where: { id: fromNoteId, userId, archived: false },
      select: { id: true },
    }),
    prisma.note.findFirst({
      where: { id: toNoteId, userId, archived: false },
      select: { id: true },
    }),
  ]);
  if (!a || !b) {
    return { error: "笔记不存在或已归档" as const };
  }
  return { ok: true as const };
}

/** 创建一条有向边：from → to */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as LinkBody;
  const fromNoteId = body.fromNoteId?.trim();
  const toNoteId = body.toNoteId?.trim();
  if (!fromNoteId || !toNoteId) {
    return NextResponse.json({ error: "需要 fromNoteId 与 toNoteId" }, { status: 400 });
  }

  const check = await assertNotesOwnedAndActive(user.id, fromNoteId, toNoteId);
  if ("error" in check) {
    return NextResponse.json({ error: check.error }, { status: 400 });
  }

  try {
    const link = await prisma.noteLink.create({
      data: {
        userId: user.id,
        fromNoteId,
        toNoteId,
      },
      select: { id: true, fromNoteId: true, toNoteId: true, createdAt: true },
    });
    return NextResponse.json({ ok: true, link });
  } catch (e: unknown) {
    const code = e && typeof e === "object" && "code" in e ? (e as { code?: string }).code : undefined;
    if (code === "P2002") {
      return NextResponse.json({ error: "该关联已存在" }, { status: 409 });
    }
    throw e;
  }
}

/** 删除有向边 from → to */
export async function DELETE(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let fromNoteId: string | undefined;
  let toNoteId: string | undefined;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as LinkBody;
    fromNoteId = body.fromNoteId?.trim();
    toNoteId = body.toNoteId?.trim();
  } else {
    const url = new URL(req.url);
    fromNoteId = url.searchParams.get("from")?.trim() ?? undefined;
    toNoteId = url.searchParams.get("to")?.trim() ?? undefined;
  }

  if (!fromNoteId || !toNoteId) {
    return NextResponse.json({ error: "需要 fromNoteId 与 toNoteId" }, { status: 400 });
  }

  const deleted = await prisma.noteLink.deleteMany({
    where: { userId: user.id, fromNoteId, toNoteId },
  });

  if (deleted.count === 0) {
    return NextResponse.json({ error: "关联不存在" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
