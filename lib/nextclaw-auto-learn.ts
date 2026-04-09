import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";
import { stripHtmlToText } from "@/lib/rag";

export type NextClawAutoLearnLiteCard = {
  type: "REVIEW" | "FILL_GAP" | "PITFALL" | "CONFLICT" | "RELATED" | "AUDIT";
  title: string;
  contentMd: string;
  sources?: unknown;
};

export async function generateNextClawAutoLearnLite(params: {
  noteTitle: string;
  noteHtml: string;
  relatedNotes: { noteId: string; title: string; snippet: string; distance?: number }[];
  /** 知识库侧摘要，注入 System Prompt（参考书） */
  kbDigest?: string;
  /** Plan 执行期工具 Mock / MCP 摘要，注入 System Prompt */
  toolTrace?: string;
  /** lite：默认卡片规模；deep：更广相关笔记引用与更多卡片 */
  mode?: "lite" | "deep";
}): Promise<{
  cards: NextClawAutoLearnLiteCard[];
  reviewCoreIdeas: string[];
}> {
  const model =
    process.env.AI_MODEL_WRITER ||
    process.env.AI_MODEL_CHAT ||
    "Doubao-Seed-2.0-lite";

  const deep = params.mode === "deep";
  const noteText = stripHtmlToText(params.noteHtml).slice(0, deep ? 12000 : 8000);
  const related = params.relatedNotes.slice(0, deep ? 8 : 5).map((n) => ({
    noteId: n.noteId,
    title: n.title,
    snippet: (n.snippet || "").slice(0, 800),
    distance: n.distance ?? null,
  }));

  const kb = (params.kbDigest ?? "").trim();
  const trace = (params.toolTrace ?? "").trim();
  const system =
    "你是 NextClaw 的自动学习引擎。你需要基于用户刚保存的笔记，以及检索到的历史相关笔记片段，生成" +
    (deep ? "「深度学习」自动学习卡片（更全、可含自测导向）" : "「轻量」自动学习卡片") +
    "。必须严格输出 JSON（不要 Markdown 包裹，不要解释）。卡片要短、可执行、偏踩坑与补位，避免空泛鸡汤。" +
    (kb ? `\n\n${kb}` : "") +
    (trace ? `\n\n【工具与规划执行摘要】\n${trace}` : "");

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          input: {
            noteTitle: params.noteTitle,
            noteText,
            relatedNotes: related,
          },
          requirements: {
            outputJson: {
              reviewCoreIdeas: "string[]（3~7，复习要点）",
              cards: [
                {
                  type: `"REVIEW" | "FILL_GAP" | "PITFALL" | "CONFLICT" | "RELATED"`,
                  title: "string（短标题）",
                  contentMd: "string（Markdown，2~8 行，包含清单/要点更佳）",
                  sources: "可选，结构自由（建议带 noteId 列表或关键词）",
                },
              ],
            },
            rules: deep
              ? [
                  "cards 数量 5~8。",
                  "至少 2 张 REVIEW：每张含清晰自测问题 + 参考答案要点（Markdown）。",
                  "至少 1 张 FILL_GAP（补位卡）与 1 张 PITFALL 或 CONFLICT。",
                  "RELATED 类型只能引用输入 relatedNotes 里出现的 noteId；若为空则不输出 RELATED。",
                  "避免编造外部事实；推断需标注依据来自哪条笔记片段。",
                ]
              : [
                  "cards 数量 3~6。",
                  "至少 1 张 FILL_GAP（补位卡）。",
                  "至少 1 张 PITFALL 或 CONFLICT（优先有具体风险与规避步骤）。如果没有充分证据，使用 PITFALL（通用但不夸大）。",
                  "RELATED 类型只能引用输入 relatedNotes 里出现的 noteId；如果 relatedNotes 为空，则不要输出 RELATED 卡。",
                  "避免编造外部事实；只基于输入笔记与 relatedNotes 的片段做推断。",
                ],
          },
        }),
      },
    ],
  });

  const parsed = extractJsonFromText(raw) as {
    reviewCoreIdeas?: unknown;
    cards?: unknown;
  };

  if (!parsed || !Array.isArray(parsed.reviewCoreIdeas) || !Array.isArray(parsed.cards)) {
    throw new Error("AI 返回自动学习 JSON 结构不符合预期");
  }

  const reviewCoreIdeas = (parsed.reviewCoreIdeas as unknown[])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 7);

  const cards = (parsed.cards as unknown[])
    .map((c) => c as { type?: unknown; title?: unknown; contentMd?: unknown; sources?: unknown })
    .map((c) => ({
      type: String(c.type ?? "").trim() as NextClawAutoLearnLiteCard["type"],
      title: String(c.title ?? "").trim(),
      contentMd: String(c.contentMd ?? "").trim(),
      sources: c.sources,
    }))
    .filter((c) => c.title && c.contentMd)
    .slice(0, deep ? 10 : 8);

  return { cards, reviewCoreIdeas };
}

