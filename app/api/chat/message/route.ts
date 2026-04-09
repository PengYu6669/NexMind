import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import {
  fetchOpenAiChatCompletionsStream,
  pipeChatStreamPersistMetadata,
} from "@/lib/doubao";
import { ragSearch, stripHtmlToText } from "@/lib/rag";
import {
  buildNextClawMemoryBlock,
  extractNextClawMemoriesFromTurn,
  isNextClawMemoryInjectEnabled,
} from "@/lib/nextclaw-memory";
import { nextClawAntiFillInBlankExtraPrompt } from "@/lib/nextclaw-intent";

function mapToAiRole(role: "USER" | "ASSISTANT" | "SYSTEM"): "user" | "assistant" | "system" {
  if (role === "USER") return "user";
  if (role === "ASSISTANT") return "assistant";
  return "system";
}

type AiChatMessage = { role: "user" | "assistant" | "system"; content: string };

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as {
    content?: string;
    conversationId?: string;
    noteId?: string;
    /** 智能流卡片追问：注入卡片上下文并默认聚焦其所属笔记 */
    learningCardId?: string;
    /** @deprecated 使用 nextclaw */
    companion?: boolean;
    nextclaw?: boolean;
    /** NextClaw 预设自动执行：由后端在回答结束后自动生成“学习笔记版”并落库 */
    autonomousStudy?: boolean;
  };
  const content = body.content?.trim();
  if (!content) return NextResponse.json({ error: "缺少 content" }, { status: 400 });
  const nextClawMode = Boolean(body.nextclaw ?? body.companion);
  const autonomousStudy = Boolean(body.autonomousStudy);

  let focusNoteId = body.noteId?.trim() || "";
  let focusNote: { title: string; content: string } | null = null;
  let learningCardBlock = "";

  const learningCardId = body.learningCardId?.trim();
  if (learningCardId) {
    const card = await prisma.learningCard.findFirst({
      where: { id: learningCardId, userId: user.id },
      select: {
        noteId: true,
        type: true,
        title: true,
        contentMd: true,
        note: { select: { title: true, content: true, archived: true } },
      },
    });
    if (!card) {
      return NextResponse.json({ error: "学习卡片不存在" }, { status: 404 });
    }
    if (card.note.archived) {
      return NextResponse.json({ error: "所属笔记已归档" }, { status: 400 });
    }
    if (focusNoteId && focusNoteId !== card.noteId) {
      return NextResponse.json({ error: "noteId 与卡片所属笔记不一致" }, { status: 400 });
    }
    focusNoteId = card.noteId;
    focusNote = { title: card.note.title, content: card.note.content };
    const excerpt = (card.contentMd || "")
      .replace(/```[\s\S]*?```/g, "\n")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2000);
    learningCardBlock = `【用户正在追问一张学习卡片（请结合卡片与笔记正文作答）】\n类型：${card.type}\n标题：${card.title}\n卡片摘录：\n${excerpt}\n`;
  } else if (focusNoteId) {
    const owned = await prisma.note.findFirst({
      where: { id: focusNoteId, userId: user.id, archived: false },
      select: { title: true, content: true },
    });
    if (!owned) {
      return NextResponse.json({ error: "笔记不存在或无权访问" }, { status: 403 });
    }
    focusNote = owned;
  }

  let conversationId = body.conversationId?.trim();
  if (conversationId) {
    const owns = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: user.id },
      select: { id: true },
    });
    if (!owns) {
      return NextResponse.json({ error: "会话不存在" }, { status: 404 });
    }
  } else if (nextClawMode) {
    const conv = await prisma.conversation.findFirst({
      where: {
        userId: user.id,
        title: { in: ["NextClaw", "学伴"] },
      },
      orderBy: { updatedAt: "desc" },
      select: { id: true, title: true },
    });
    if (conv?.title === "学伴") {
      await prisma.conversation.update({ where: { id: conv.id }, data: { title: "NextClaw" } });
    }
    if (!conv) {
      const created = await prisma.conversation.create({
        data: { userId: user.id, title: "NextClaw" },
        select: { id: true },
      });
      conversationId = created.id;
    } else {
      conversationId = conv.id;
    }
  } else {
    const conv = await prisma.conversation.findFirst({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });
    if (!conv) {
      return NextResponse.json({ error: "会话不存在" }, { status: 400 });
    }
    conversationId = conv.id;
  }

  const msgCountBefore = await prisma.message.count({ where: { conversationId } });

  // 1) 写入用户消息
  const userCreated = await prisma.message.create({
    data: {
      conversationId,
      role: "USER",
      content,
    },
    select: { id: true },
  });
  const lastUserMessageId = userCreated.id;

  const GENERIC_TITLES = new Set(["新对话", "默认对话", ""]);
  const convRow = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { title: true },
  });
  const titleTrim = convRow?.title?.trim() ?? "";
  const isGenericTitle = GENERIC_TITLES.has(titleTrim);
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      updatedAt: new Date(),
      ...(msgCountBefore === 0 && isGenericTitle
        ? {
            title:
              content.replace(/\s+/g, " ").slice(0, 40) + (content.length > 40 ? "…" : ""),
          }
        : {}),
    },
  });

  // 2) 读取上下文（截断最近 N 条）
  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { role: true, content: true },
  });

  // 2.1) RAG：全库或「仅选中笔记」内检索；无向量时退回正文摘录
  // 选中单篇笔记时：必须始终注入正文摘录，不能只依赖向量片段（否则模型往往只看到标题或与问题弱相关的 chunk）
  let ragBlock = "";
  try {
    if (focusNoteId && focusNote) {
      const plain = stripHtmlToText(focusNote.content).slice(0, 12000);
      const focusHeader =
        `用户已选中笔记《${focusNote.title}》。请优先依据下方「正文摘录」作答，不要编造；可辅以「检索片段」对照；末尾可给出引用编号。`;

      let hits: Awaited<ReturnType<typeof ragSearch>> = [];
      try {
        hits = await ragSearch({
          userId: user.id,
          query: content,
          topK: 5,
          noteId: focusNoteId,
        });
      } catch {
        hits = [];
      }

      const parts: string[] = [focusHeader];
      if (plain) {
        parts.push(`【笔记正文摘录】\n${plain}`);
      } else {
        parts.push("（该笔记正文为空或暂无法从 HTML 解析出文本。）");
      }
      if (hits.length) {
        parts.push(
          `【与当前问题语义最接近的片段（供对照）】\n` +
            hits.map((h, idx) => `[${idx + 1}]\n${h.content}`).join("\n\n")
        );
      } else if (!plain) {
        parts.push(
          "（当前该笔记无可用正文且无向量检索结果；若刚保存过笔记，可稍后重试或检查向量索引是否已建立。）"
        );
      }
      ragBlock = parts.join("\n\n");
    } else {
      const topK = nextClawMode ? 5 : 3;
      const hits = await ragSearch({ userId: user.id, query: content, topK });
      if (hits.length) {
        ragBlock =
          "以下是从用户笔记中检索到的相关片段（仅供参考，回答时请优先基于这些片段，并在末尾给出引用编号）：\n" +
          hits
            .map((h, idx) => {
              const title = h.noteTitle ? `《${h.noteTitle}》` : "（未命名）";
              return `[${idx + 1}] ${title}\n${h.content}`;
            })
            .join("\n\n");
      }
    }
  } catch {
    if (focusNoteId && focusNote) {
      try {
        const plain = stripHtmlToText(focusNote.content).slice(0, 12000);
        if (plain) {
          ragBlock =
            `用户已选中笔记《${focusNote.title}》。请依据下方正文作答。\n\n【笔记正文摘录】\n${plain}\n\n（上下文组装时检索失败，已仅使用正文摘录。）`;
        }
      } catch {
        ragBlock = "";
      }
    } else {
      ragBlock = "";
    }
  }

  const defaultAssistant =
    "你是 NextClaw 的 AI 助手。请用中文回答，尽量结构化，保持简洁高质量。若提供了“笔记片段”，请优先使用并在回答末尾输出“引用：[1][2]”这样的编号引用。";
  const focusAssistant = focusNote
    ? `你是 NextClaw 的 AI 助手。用户正在针对笔记《${focusNote.title}》提问：请严格围绕该笔记已给出的正文/片段作答；信息不足时请直接说明，不要臆测。若提供了编号片段，回答末尾输出「引用：[1][2]」等形式。`
    : defaultAssistant;

  const nextClawPrompt =
    "你是 NextClaw 智能助手：根据下方知识库片段，帮助用户复习、拓展学习、自测、列计划或整理草稿。要求：语气友好、少黑话；优先依据片段作答、不编造；尽量用短列表与可执行步骤；信息不足时说明缺口并建议补记哪类内容；有编号片段时在末尾标注引用。";

  const systemPrompt = nextClawMode
    ? focusNote
      ? `${nextClawPrompt}\n\n${focusAssistant}`
      : nextClawPrompt
    : focusAssistant;

  const nextClawNoteExtra =
    nextClawMode ? nextClawAntiFillInBlankExtraPrompt(content) : null;

  const nextClawMemoryOn =
    nextClawMode && (await isNextClawMemoryInjectEnabled(user.id));

  let memoryBlock = "";
  if (nextClawMemoryOn) {
    try {
      memoryBlock = await buildNextClawMemoryBlock(user.id);
    } catch {
      memoryBlock = "";
    }
  }
  const memorySection = memoryBlock
    ? `【用户长期上下文（来自历史记忆与学习快照，请酌情使用，勿编造）】\n${memoryBlock}`
    : "";

  const systemContent = [systemPrompt, nextClawNoteExtra, memorySection, learningCardBlock, ragBlock]
    .filter(Boolean)
    .join("\n\n");

  const aiMessages: AiChatMessage[] = [
    {
      role: "system" as const,
      content: systemContent,
    },
    ...messages.map((m) => ({
      role: mapToAiRole(m.role as "USER" | "ASSISTANT" | "SYSTEM"),
      content: m.content,
    })),
  ];

  // 3) 调用 AI：透传 OpenAI 兼容 SSE，结束后写入助手消息并下发 nexmind_done
  const model = process.env.AI_MODEL_CHAT || "Doubao-Seed-2.0-lite";

  let upstream: Response;
  try {
    upstream = await fetchOpenAiChatCompletionsStream({
      model,
      messages: aiMessages,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "调用 AI 失败" },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const errBody = (await upstream.json().catch(() => null)) as {
      error?: { message?: string };
      message?: string;
    } | null;
    const msg =
      errBody?.error?.message ||
      (typeof errBody?.message === "string" ? errBody.message : null) ||
      "调用 AI 失败";
    return NextResponse.json({ error: msg }, { status: upstream.status >= 400 ? upstream.status : 502 });
  }

  if (!upstream.body) {
    return NextResponse.json({ error: "AI 流式响应为空" }, { status: 502 });
  }

  const stream = pipeChatStreamPersistMetadata(upstream.body, async (fullText) => {
    const assistantText = fullText || "（未生成内容）";
    const assistant = await prisma.message.create({
      data: {
        conversationId,
        role: "ASSISTANT",
        content: assistantText,
      },
      select: { id: true, role: true, content: true, createdAt: true },
    });

    if (nextClawMemoryOn) {
      void extractNextClawMemoriesFromTurn(user.id, content, assistantText).catch(() => {});
    }

    // NextClaw 自主学习：自动生成学习笔记版并落库
    if (nextClawMode && autonomousStudy) {
      void (async () => {
        try {
          // 相关笔记（用于“关联你之前的笔记”）
          const relatedHits = await ragSearch({
            userId: user.id,
            query: `${content}\n${assistantText}`.slice(0, 6000),
            topK: 5,
          });
          const relatedNotesForAi = relatedHits.map((h) => ({
            noteId: h.noteId,
            title: h.noteTitle || "无标题",
            snippet: (h.content || "").slice(0, 600),
          }));

          const focusTitle = focusNote?.title;

          // 生成学习笔记版（含学习卡片候选/自测题）
          const studyAi = await (await import("@/lib/nextclaw-study")).generateNextClawStudyNoteResult({
            userText: content,
            assistantText,
            focusNoteTitle: focusTitle,
            relatedNotes: relatedNotesForAi,
          });

          // 落库：创建学习笔记（作为新 Note）
          const tagsNormalized = (studyAi.tags ?? []).map((t) => {
            const s = String(t).trim();
            return s.startsWith("#") ? s : `#${s}`;
          });

          const tagIds: string[] = [];
          for (const tagName of tagsNormalized) {
            const name = tagName.slice(0, 24) || "#学习";
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

          const excerpt = studyAi.markdown.replace(/[#>*_\-\n]/g, " ").slice(0, 180);
          await prisma.note.create({
            data: {
              title: studyAi.title || "学习笔记版",
              content: studyAi.markdown,
              excerpt: excerpt || undefined,
              sourceType: "nextclaw_study",
              userId: user.id,
              conversationId,
              tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
            },
          });

          // 落库：更新 learningSnapshot（为后续 system 注入准备）
          await prisma.learningSnapshot.create({
            data: {
              userId: user.id,
              summary: studyAi.snapshotSummary || "最近学习快照（自动生成）",
              recommendations: {
                recentNoteTitles: relatedHits.map((h) => h.noteTitle || "无标题").slice(0, 5),
              },
              quizItems: { quizItems: studyAi.quizItems ?? [], cards: studyAi.cards ?? [] },
            },
          });

          // 不强依赖返回结果；为 debug 可保留 console
          // console.log("[autonomousStudy] saved note/snapshot", note.id, snapshot.id);
        } catch (err) {
          // 学习笔记生成失败不影响主对话
          console.error("[autonomousStudy] 学习笔记生成/落库失败:", err);
        }
      })();
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return {
      conversationId,
      lastUserMessageId,
      message: {
        id: assistant.id,
        role: assistant.role,
        content: assistant.content,
        createdAt: assistant.createdAt.toISOString(),
      },
    };
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

