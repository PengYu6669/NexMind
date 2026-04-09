import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { generateChatToNoteResult } from "@/lib/doubao";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as {
    conversationId?: string;
    /** 若传入且非空：只整理这些消息（须属于该会话） */
    messageIds?: string[];
    /** true = 不走 AI，直接保存原文对话 */
    raw?: boolean;
  };

  let conversationId = body.conversationId;
  if (!conversationId) {
    const conv = await prisma.conversation.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!conv) return NextResponse.json({ error: "会话不存在" }, { status: 400 });
    conversationId = conv.id;
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!conversation || conversation.userId !== user.id) {
    return NextResponse.json({ error: "会话不存在" }, { status: 404 });
  }

  const rawIds = Array.isArray(body.messageIds) ? body.messageIds : [];
  const idSet = new Set(rawIds.map((id) => String(id).trim()).filter(Boolean));

  let picked = conversation.messages;
  let partialSelection = false;

  if (idSet.size > 0) {
    partialSelection = true;
    const allowed = new Set(conversation.messages.map((m) => m.id));
    for (const id of idSet) {
      if (!allowed.has(id)) {
        return NextResponse.json({ error: "存在不属于当前会话的消息" }, { status: 400 });
      }
    }
    picked = conversation.messages.filter((m) => idSet.has(m.id));
    if (picked.length === 0) {
      return NextResponse.json({ error: "所选消息无效" }, { status: 400 });
    }
  }

  const conversationText = picked
    .map((m) => `${m.role === "USER" ? "用户" : m.role === "ASSISTANT" ? "助手" : "系统"}：${m.content}`)
    .join("\n");

  const rawMode = Boolean(body.raw);
  const ai = rawMode
    ? {
        title: partialSelection ? "对话原文（节选）" : "对话原文",
        markdown: conversationText,
        tags: [] as string[],
      }
    : await generateChatToNoteResult({
        conversationText,
        partialSelection,
      });
  const tags = rawMode ? [] : (ai.tags ?? []);

  const tagIds: string[] = [];
  for (const tagName of tags) {
    const name = tagName.startsWith("#") ? tagName : `#${tagName}`;
    const existed = await prisma.tag.findFirst({
      where: { userId: user.id, name },
      select: { id: true },
    });
    if (existed?.id) {
      tagIds.push(existed.id);
      continue;
    }
    const created = await prisma.tag.create({
      data: { userId: user.id, name },
      select: { id: true },
    });
    tagIds.push(created.id);
  }

  const excerpt = ai.markdown.replace(/[#>*_\-\n]/g, " ").slice(0, 180);

  const note = await prisma.note.create({
    data: {
      title: ai.title || "对话笔记",
      content: ai.markdown,
      excerpt: excerpt || undefined,
      sourceType: "chat",
      userId: user.id,
      conversationId,
      tags:
        !rawMode && tagIds.length > 0
          ? {
              create: tagIds.map((tagId) => ({ tagId })),
            }
          : undefined,
    },
    select: { id: true },
  });

  return NextResponse.json({ noteId: note.id });
}

