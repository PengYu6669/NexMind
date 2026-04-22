import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** 列出当前用户的文件夹（按 sortOrder、名称） */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const folders = await prisma.noteFolder.findMany({
    where: { userId: user.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true, updatedAt: true },
  });

  return NextResponse.json({ folders });
}

/** 新建文件夹 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const raw = typeof body?.name === "string" ? body.name.trim() : "";
  if (!raw || raw.length > 80) {
    return NextResponse.json({ error: "名称长度需在 1–80 字" }, { status: 400 });
  }

  const agg = await prisma.noteFolder.aggregate({
    where: { userId: user.id },
    _max: { sortOrder: true },
  });
  const nextOrder = (agg._max.sortOrder ?? -1) + 1;

  const folder = await prisma.noteFolder.create({
    data: {
      userId: user.id,
      name: raw,
      sortOrder: nextOrder,
    },
    select: { id: true, name: true, sortOrder: true },
  });

  return NextResponse.json({ folder });
}
