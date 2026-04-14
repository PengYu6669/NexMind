import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { callDashscopeChatCompletion } from "@/lib/doubao";

export type NoteAiAction =
  | "summary"
  | "expand"
  | "polish"
  | "outline"
  | "qa"
  | "actions";

const ACTIONS = new Set<string>(["summary", "expand", "polish", "outline", "qa", "actions"]);

const SYSTEM: Record<NoteAiAction, string> = {
  summary:
    "你是中文笔记助手。根据用户给出的笔记全文，写一段简洁中文摘要（约 3–8 句），突出重点与结论。只输出摘要正文，不要标题、前缀或列表符号。",
  expand:
    "你是中文写作助手。根据用户给出的笔记片段进行扩写：保持原意、补充合理细节与例证，结构清晰。只输出扩写后的正文，使用 Markdown。不要输出任何前言、套话或「以下是扩写」之类说明。",
  polish:
    "你是中文编辑。请润色下列文本，使表达更通顺、简洁、有层次，不改变原意。只输出润色后的正文，使用 Markdown。不要附加解释。",
  outline:
    "你是中文助理。将下列材料整理为层级清晰的要点列表（Markdown：可用 ##、-），保留关键事实与术语，不编造。只输出列表与必要短说明，不要开场白。",
  qa:
    "你是中文教学助理。根据给定内容提炼 5-8 组高质量问答（Q/A），覆盖概念、原理、应用与易错点。输出 Markdown，格式为二级标题“## Q1 ...”并在下方给“**A：** ...”。不要输出与原文无关内容。",
  actions:
    "你是中文执行教练。根据给定内容提炼可执行行动清单。输出 Markdown，按“立即可做（今天）/短期推进（本周）/长期优化（本月）”三个小节，每节 3-6 条，使用复选框 `- [ ]`，措辞具体可执行。",
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await ctx.params;
  if (!id?.trim()) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

  const body = (await req.json()) as {
    action?: string;
    /** 由客户端传入的纯文本（当前全文或选区） */
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
    return NextResponse.json(
      { error: "没有可处理的正文，请先输入内容或选中一段文字" },
      { status: 400 }
    );
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
