import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { callDashscopeChatCompletion } from "@/lib/doubao";
import { prisma } from "@/lib/prisma";

export type NoteAiAction = "summary" | "expand" | "polish" | "outline" | "qa" | "actions";

const ACTIONS = new Set<string>(["summary", "expand", "polish", "outline", "qa", "actions"]);

const SYSTEM: Record<NoteAiAction, string> = {
  summary:
    "你是中文笔记助手。根据用户给出的笔记全文，写一段简洁中文摘要，约 3-5 句，突出重点、结论与可复用信息。只输出摘要正文，不要标题、前缀或列表符号。",
  expand:
    "你是中文写作助手。根据用户给出的笔记片段扩写内容：保持原意，补充合理细节、背景、例子和逻辑连接。输出 Markdown 正文，不要寒暄，不要说“以下是扩写”。",
  polish:
    "你是中文编辑。润色用户给出的文本，让表达更通顺、简洁、有层次，不改变原意。输出 Markdown 正文，不要附加解释。",
  outline:
    "你是中文助理。把用户给出的材料整理成层级清晰的大纲，使用 Markdown 标题和列表，保留关键事实与术语，不编造。只输出大纲内容。",
  qa:
    "你是中文教学助理。根据给定内容提炼 5-8 组高质量问答，覆盖概念、原理、应用与易错点。输出 Markdown，格式为二级标题“## Q1 ...”，下方给出“**A：** ...”。不要输出与原文无关内容。",
  actions:
    "你是中文执行教练。根据给定内容提炼可执行行动清单。输出 Markdown，按“立即可做（今天）/短期推进（本周）/长期优化（本月）”三个小节组织，每节 3-6 条，使用复选框 `- [ ]`，措辞具体可执行。",
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id?.trim()) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const body = (await req.json()) as {
    action?: string;
    plainText?: string;
  };

  const action = body.action?.trim() as NoteAiAction;
  if (!action || !ACTIONS.has(action)) {
    return NextResponse.json({ error: "无效的操作" }, { status: 400 });
  }

  const note = await prisma.note.findFirst({
    where: { id, userId: user.id, archived: false },
    select: { id: true, title: true },
  });
  if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

  const plain = (typeof body.plainText === "string" ? body.plainText : "").trim().slice(0, 12000);
  if (!plain) {
    return NextResponse.json({ error: "没有可处理的正文，请先输入内容或选中一段文字" }, { status: 400 });
  }

  const model = process.env.AI_MODEL_CHAT || "Doubao-Seed-2.0-lite";
  const userContent = `笔记标题：${note.title}\n\n---\n\n${plain}`;

  const markdown = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: SYSTEM[action] },
      { role: "user", content: userContent },
    ],
  });

  return NextResponse.json({ markdown: markdown.trim() });
}
