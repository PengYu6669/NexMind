import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";
import { stripHtmlToText } from "@/lib/rag";

export type NextClawAutoLearnLiteCard = {
  type: "REVIEW" | "FILL_GAP" | "PITFALL" | "CONFLICT" | "RELATED" | "AUDIT";
  title: string;
  contentMd: string;
  sources?: unknown;
};

function hasHeading(content: string, heading: string): boolean {
  const re = new RegExp(`^##\\s*${heading}\\s*$`, "im");
  return re.test(content);
}

function ensureSection(content: string, heading: string, lines: string[]): string {
  if (hasHeading(content, heading)) return content;
  const block = [`## ${heading}`, ...lines.map((x) => `- ${x}`)].join("\n");
  return `${content.trim()}\n\n${block}`.trim();
}

function normalizeCardByType(card: NextClawAutoLearnLiteCard): NextClawAutoLearnLiteCard {
  const t = card.type;
  let md = (card.contentMd ?? "").trim();
  if (!md) md = "（内容待补充）";

  // 所有卡片都要有“怎么做”和“易错点”最小骨架，减少“只讲概念”空洞感
  md = ensureSection(md, "怎么做", ["先确认目标", "按步骤执行并记录关键结论"]);
  md = ensureSection(md, "易错点", ["只记结论不记条件", "缺少可验证示例"]);

  if (t === "REVIEW") {
    md = ensureSection(md, "自测问题", ["请用自己的话解释本卡核心概念，并给一个应用场景"]);
    md = ensureSection(md, "参考答案要点", ["定义", "步骤", "边界/风险"]);
  } else if (t === "FILL_GAP") {
    md = ensureSection(md, "知识缺口", ["当前认知缺少关键条件或背景"]);
  } else if (t === "PITFALL" || t === "CONFLICT") {
    md = ensureSection(md, "风险信号", ["出现反例、报错或与现有结论冲突"]);
    md = ensureSection(md, "修复策略", ["先定位冲突源，再给出可执行替代方案"]);
  } else if (t === "RELATED") {
    md = ensureSection(md, "关联理由", ["说明与当前笔记的关系和适用场景"]);
  }

  return { ...card, contentMd: md };
}

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
    "。必须严格输出 JSON（不要 Markdown 包裹，不要解释）。内容**以讲清楚为准、疏密合理**：用小标题与列表组织「是什么 / 为什么 / 怎么做 / 易错点」，可读、有留白，避免空话也避免整屏密文堆砌。" +
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
                  contentMd:
                    "string（Markdown；" +
                    (deep
                      ? "篇幅适中：约 10～16 行为宜（可略多略少），含小标题或列表；REVIEW 卡须含「自测问题」与「参考答案要点」两段"
                      : "篇幅适中：约 6～12 行为宜（可略多略少），可用小标题或列表讲清要点") +
                    "）",
                  sources: "可选，结构自由（建议带 noteId 列表或关键词）",
                },
              ],
            },
            rules: deep
              ? [
                  "cards 数量 5~8。",
                  "至少 2 张 REVIEW：每张含「自测问题」+「参考答案要点」；自测题须**改写提问角度**（如情景、对比、遮住术语让回忆、步骤排序），**不得与笔记原文连续相同句或大段照抄**；答案写凝练要点即可，可与原文措辞不同但语义一致。",
                  "至少 1 张 FILL_GAP（补位卡）与 1 张 PITFALL 或 CONFLICT。",
                  "按类型强制结构化：REVIEW 含「是什么/怎么做/易错点/自测问题/参考答案要点」；FILL_GAP 含「知识缺口/怎么做」；PITFALL|CONFLICT 含「风险信号/修复策略」；RELATED 含「关联理由/怎么做」。",
                  "每张卡用若干要点或小标题写透即可，禁止一句话敷衍，也不要为凑长度重复同义句。",
                  "RELATED 类型只能引用输入 relatedNotes 里出现的 noteId；若为空则不输出 RELATED。",
                  "避免编造外部事实；推断需标注依据来自哪条笔记片段。",
                ]
              : [
                  "cards 数量 3~6。",
                  "至少 1 张 FILL_GAP（补位卡）。",
                  "至少 1 张 PITFALL 或 CONFLICT（优先有具体风险与规避步骤）。如果没有充分证据，使用 PITFALL（通用但不夸大）。",
                  "若有 REVIEW 卡：自测题同样须改写角度、不得照抄原文句子；答案要点化。",
                  "按类型强制结构化：REVIEW 含「是什么/怎么做/易错点/自测问题/参考答案要点」；FILL_GAP 含「知识缺口/怎么做」；PITFALL|CONFLICT 含「风险信号/修复策略」；RELATED 含「关联理由/怎么做」。",
                  "每张卡若干要点即可，禁止一句话敷衍，避免密不透风的超长段落。",
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
    .map((c) => normalizeCardByType(c))
    .slice(0, deep ? 10 : 8);

  return { cards, reviewCoreIdeas };
}

