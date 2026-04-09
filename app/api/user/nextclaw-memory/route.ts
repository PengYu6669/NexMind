import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NEXTCLAW_MEMORY_SCOPE } from "@/lib/nextclaw-memory";

/** NextClaw 记忆：开关、最近快照、清空（仅 UserMemory，不删 LearningSnapshot） */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const [settings, snapshot, memoryCount] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: { nextclawMemoryEnabled: true },
    }),
    prisma.learningSnapshot.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        summary: true,
        createdAt: true,
        recommendations: true,
        quizItems: true,
      },
    }),
    prisma.userMemory.count({
      where: { userId: user.id, scope: NEXTCLAW_MEMORY_SCOPE },
    }),
  ]);

  return NextResponse.json({
    memoryEnabled: settings?.nextclawMemoryEnabled ?? true,
    memoryCount,
    latestSnapshot: snapshot,
  });
}

export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as { memoryEnabled?: unknown };
  if (typeof body.memoryEnabled !== "boolean") {
    return NextResponse.json({ error: "需要 memoryEnabled 布尔值" }, { status: 400 });
  }

  await prisma.userSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      theme: "dark",
      nextclawMemoryEnabled: body.memoryEnabled,
    },
    update: { nextclawMemoryEnabled: body.memoryEnabled },
  });

  return NextResponse.json({ ok: true, memoryEnabled: body.memoryEnabled });
}

export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const result = await prisma.userMemory.deleteMany({
    where: { userId: user.id, scope: NEXTCLAW_MEMORY_SCOPE },
  });

  return NextResponse.json({ ok: true, deleted: result.count });
}
