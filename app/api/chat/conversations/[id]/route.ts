import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

const NEXTCLAW_TITLES = ["NextClaw", "学伴"];

async function getOwnedConversation(userId: string, id: string) {
  return prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true, title: true },
  });
}

/** 删除整个会话（含消息） */
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id?.trim()) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const conv = await getOwnedConversation(user.id, id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  const title = conv.title?.trim() ?? "";
  if (NEXTCLAW_TITLES.includes(title)) {
    return NextResponse.json({ error: "NextClaw 会话请在 NextClaw 页清空记录" }, { status: 400 });
  }

  await prisma.conversation.delete({ where: { id: conv.id } });
  return NextResponse.json({ ok: true });
}

/** body: { action: 'clearMessages' } — 仅清空消息，保留会话（用于 NextClaw 等） */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id?.trim()) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action !== "clearMessages") {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }

  const conv = await getOwnedConversation(user.id, id);
  if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 404 });

  // 单次 update：删光子表消息并刷新 updatedAt（比 deleteMany + update 少一次往返）
  await prisma.conversation.update({
    where: { id: conv.id },
    data: {
      updatedAt: new Date(),
      messages: { deleteMany: {} },
    },
  });

  return NextResponse.json({ ok: true });
}
