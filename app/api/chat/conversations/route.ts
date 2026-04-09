import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

/** 工作台：历史会话列表（卡片用） */
export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const rows = await prisma.conversation.findMany({
    where: {
      userId: user.id,
      NOT: { title: { in: ["NextClaw", "学伴"] } },
    },
    orderBy: { updatedAt: "desc" },
    take: 40,
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true, role: true },
      },
    },
  });

  const conversations = rows.map((c) => {
    const last = c.messages[0];
    const preview = last?.content?.replace(/\s+/g, " ").trim().slice(0, 80) || "暂无消息";
    return {
      id: c.id,
      title: c.title?.trim() || "新对话",
      preview: preview.length >= 80 ? `${preview}…` : preview,
      updatedAt: c.updatedAt.toISOString(),
    };
  });

  return NextResponse.json({ conversations });
}

/** 新建空会话 */
export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { title?: string };
  const title = body.title?.trim() || "新对话";

  const c = await prisma.conversation.create({
    data: { userId: user.id, title },
    select: { id: true, title: true, updatedAt: true },
  });

  return NextResponse.json({
    conversationId: c.id,
    title: c.title,
    updatedAt: c.updatedAt.toISOString(),
  });
}
