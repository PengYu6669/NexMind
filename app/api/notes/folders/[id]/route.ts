import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await context.params;
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const raw = typeof body?.name === "string" ? body.name.trim() : "";
  if (!raw || raw.length > 80) {
    return NextResponse.json({ error: "名称长度需在 1–80 字" }, { status: 400 });
  }

  const updated = await prisma.noteFolder.updateMany({
    where: { id, userId: user.id },
    data: { name: raw },
  });

  if (updated.count === 0) {
    return NextResponse.json({ error: "文件夹不存在" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

/** 删除文件夹：同时删除文件夹内所有笔记（不可撤销） */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await context.params;

  const folder = await prisma.noteFolder.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!folder) {
    return NextResponse.json({ error: "文件夹不存在" }, { status: 404 });
  }

  const r = await prisma.$transaction(async (tx: any) => {
    const notesDeleted = await tx.note.deleteMany({
      where: { userId: user.id, folderId: id },
    });
    const folderDeleted = await tx.noteFolder.deleteMany({
      where: { id, userId: user.id },
    });
    return { notesDeleted: notesDeleted.count, folderDeleted: folderDeleted.count };
  });

  return NextResponse.json({ ok: true, ...r });
}
