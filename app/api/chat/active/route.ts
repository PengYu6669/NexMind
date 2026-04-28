import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const requestedId = searchParams.get("conversationId")?.trim();
  const purpose = searchParams.get("purpose")?.trim();

  const includeMessages = {
    messages: {
      orderBy: { createdAt: "asc" as const },
      take: 80,
    },
  };

  let conversation =
    requestedId &&
    (await prisma.conversation.findFirst({
      where: { id: requestedId, userId: user.id },
      include: includeMessages,
    }));

  const nextClawPurpose = purpose === "nextclaw" || purpose === "companion";
  if (!conversation && nextClawPurpose) {
    conversation = await prisma.conversation.findFirst({
      where: {
        userId: user.id,
        title: { in: ["NextClaw", "学伴"] },
      },
      orderBy: { updatedAt: "desc" },
      include: includeMessages,
    });
    if (conversation?.title === "学伴") {
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { title: "NextClaw" },
      });
    }
    if (!conversation) {
      conversation = await prisma.conversation.create({
        data: { userId: user.id, title: "NextClaw" },
        include: includeMessages,
      });
    }
  }

  if (!conversation) {
    conversation = await prisma.conversation.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      include: includeMessages,
    });
  }

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { userId: user.id, title: "新对话" },
      include: includeMessages,
    });
  }

  return NextResponse.json({
    conversationId: conversation.id,
    messages: conversation.messages.map((m: { id: string; role: string; content: string; createdAt: Date }) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  });
}

