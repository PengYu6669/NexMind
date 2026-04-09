import {
  callDashscopeChatCompletion,
  extractJsonFromText,
} from "@/lib/doubao";

export type NextClawStudyAnalyzeResult = {
  title: string;
  tags: string[];
  snapshotSummary: string;
  coreIdeas: string[];
  keywords: string[];
  enrichedPoints: string[];
  questions: { question: string; answerKeyPoints: string[] }[];
  relatedNotes: { noteId: string; title: string; reason: string }[];
};

export type NextClawStudyCard = { front: string; back: string };

export type NextClawStudyNoteResult = {
  title: string;
  tags: string[];
  snapshotSummary: string;
  markdown: string;
  quizItems: { question: string; answerKeyPoints: string[] }[];
  cards: NextClawStudyCard[];
};

export async function generateNextClawStudyNoteResult(params: {
  userText: string;
  assistantText: string;
  focusNoteTitle?: string | null;
  relatedNotes: { noteId: string; title: string; snippet: string }[];
}): Promise<NextClawStudyNoteResult> {
  const analyze = await generateNextClawStudyAnalyzeResult({
    userText: params.userText,
    assistantText: params.assistantText,
    focusNoteTitle: params.focusNoteTitle,
    relatedNotes: params.relatedNotes,
  });

  return generateNextClawStudyNoteFromAnalyzeResult({
    analysis: analyze,
  });
}

export async function generateNextClawStudyAnalyzeResult(params: {
  userText: string;
  assistantText: string;
  focusNoteTitle?: string | null;
  relatedNotes: { noteId: string; title: string; snippet: string }[];
}): Promise<NextClawStudyAnalyzeResult> {
  const related = params.relatedNotes.slice(0, 5);

  const model =
    process.env.AI_MODEL_WRITER ||
    process.env.AI_MODEL_CHAT ||
    "Doubao-Seed-2.0-lite";

  const system =
    "你是 NexMind 的学习分析器。你需要把用户的学习意图与助手回答，提取为结构化学习分析 JSON。必须严格输出 JSON（不要 Markdown 包裹，不要解释）。";

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          input: {
            focusNoteTitle: params.focusNoteTitle ?? null,
            userText: params.userText.slice(0, 4000),
            assistantText: params.assistantText.slice(0, 8000),
            relatedNotes: related,
          },
          requirements: {
            outputJson: {
              title: "string",
              tags: "string[]（建议带 # 前缀）",
              snapshotSummary: "string（给学习快照注入/展示）",
              coreIdeas: "string[]（3~7）",
              keywords: "string[]（5~15）",
              enrichedPoints: "string[]（5~12，每条可包含“术语：定义/要点 + 小例子/误区”）",
              questions: [
                "{ question: string, answerKeyPoints: string[] }",
              ],
              relatedNotes: [
                "{ noteId: string, title: string, reason: string }",
              ],
            },
            rules: [
              "coreIdeas 数量 3~7。",
              "keywords 数量 5~15。",
              "questions 数量 5~10，answerKeyPoints 2~5 条即可。",
              "relatedNotes 的 noteId 只能从输入 relatedNotes 提供的 noteId 中选取；如果输入不足，则 relatedNotes 允许为空数组。",
            ],
          },
        }),
      },
    ],
  });

  const parsed = extractJsonFromText(raw) as {
    title?: unknown;
    tags?: unknown;
    snapshotSummary?: unknown;
    coreIdeas?: unknown;
    keywords?: unknown;
    enrichedPoints?: unknown;
    questions?: unknown;
    relatedNotes?: unknown;
  };

  if (
    !parsed ||
    typeof parsed.title !== "string" ||
    !Array.isArray(parsed.tags) ||
    typeof parsed.snapshotSummary !== "string" ||
    !Array.isArray(parsed.coreIdeas) ||
    !Array.isArray(parsed.keywords) ||
    !Array.isArray(parsed.enrichedPoints) ||
    !Array.isArray(parsed.questions) ||
    !Array.isArray(parsed.relatedNotes)
  ) {
    throw new Error("AI 返回学习分析 JSON 结构不符合预期");
  }

  const tags = parsed.tags.map((x) => {
    const s = String(x).trim();
    return s.startsWith("#") ? s : `#${s}`;
  });

  const coreIdeas = parsed.coreIdeas.map((x) => String(x).trim()).filter(Boolean);
  const keywords = parsed.keywords.map((x) => String(x).trim()).filter(Boolean);
  const enrichedPoints = parsed.enrichedPoints.map((x) => String(x).trim()).filter(Boolean);

  const questions = (parsed.questions as unknown[]).map((q) => {
    const qq = q as { question?: unknown; answerKeyPoints?: unknown; answerKeyPoint?: unknown };
    const question = String(qq.question ?? "").trim();
    const pointsRaw = Array.isArray(qq.answerKeyPoints)
      ? qq.answerKeyPoints
      : Array.isArray(qq.answerKeyPoint)
        ? qq.answerKeyPoint
        : [];
    const answerKeyPoints = (pointsRaw as unknown[]).map((x) => String(x).trim()).filter(Boolean);
    return { question, answerKeyPoints };
  });

  const relatedNotes = (parsed.relatedNotes as unknown[]).map((r) => {
    const rr = r as { noteId?: unknown; title?: unknown; reason?: unknown };
    return {
      noteId: String(rr.noteId ?? "").trim(),
      title: String(rr.title ?? "").trim(),
      reason: String(rr.reason ?? "").trim(),
    };
  }).filter((x) => x.noteId);

  return {
    title: parsed.title.trim(),
    tags,
    snapshotSummary: parsed.snapshotSummary.trim(),
    coreIdeas,
    keywords,
    enrichedPoints,
    questions,
    relatedNotes,
  };
}

export async function generateNextClawStudyNoteFromAnalyzeResult(params: {
  analysis: NextClawStudyAnalyzeResult;
}): Promise<NextClawStudyNoteResult> {
  const model =
    process.env.AI_MODEL_WRITER ||
    process.env.AI_MODEL_CHAT ||
    "Doubao-Seed-2.0-lite";

  const system =
    "你是 NexMind 的学习笔记渲染器。你需要把结构化学习分析 JSON，生成“学习笔记版”Markdown，以及学习卡片 front/back，并输出严格 JSON（不要 Markdown 包裹，不要解释）。";

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          analysis: params.analysis,
          requirements: {
            outputJson: {
              title: "string",
              tags: "string[]（带 # 前缀）",
              snapshotSummary: "string",
              markdown:
                "string（必须包含以下段落标题：## 核心观点、## 关键术语、## 补充知识点、## 拓展问题与自测、## 关联笔记、## 学习卡片（Front/Back））",
              quizItems: [
                "{ question: string, answerKeyPoints: string[] }",
              ],
              cards: [
                "{ front: string, back: string }",
              ],
            },
            markdownRules: [
              "## 关键术语：每个术语一行，并给一句释义/要点。",
              "## 拓展问题与自测：列出 5~10 个问题，每个问题下面用“答案要点：”列 2~5 条。",
              "## 学习卡片（Front/Back）：用列表呈现 front/back，便于直接背诵。",
              "## 关联笔记：只使用 analysis.relatedNotes 里出现的 noteId；每条写 reason。",
            ],
          },
        }),
      },
    ],
  });

  const parsed = extractJsonFromText(raw) as {
    title?: unknown;
    tags?: unknown;
    snapshotSummary?: unknown;
    markdown?: unknown;
    quizItems?: unknown;
    cards?: unknown;
  };

  if (
    !parsed ||
    typeof parsed.title !== "string" ||
    !Array.isArray(parsed.tags) ||
    typeof parsed.snapshotSummary !== "string" ||
    typeof parsed.markdown !== "string" ||
    !Array.isArray(parsed.quizItems) ||
    !Array.isArray(parsed.cards)
  ) {
    throw new Error("AI 返回学习笔记 JSON 结构不符合预期");
  }

  const tags = parsed.tags.map((x) => {
    const s = String(x).trim();
    return s.startsWith("#") ? s : `#${s}`;
  });

  const quizItems = (parsed.quizItems as unknown[]).map((q) => {
    const qq = q as { question?: unknown; answerKeyPoints?: unknown; answerKeyPoint?: unknown };
    const question = String(qq.question ?? "").trim();
    const pointsRaw = Array.isArray(qq.answerKeyPoints)
      ? qq.answerKeyPoints
      : Array.isArray(qq.answerKeyPoint)
        ? qq.answerKeyPoint
        : [];
    const answerKeyPoints = (pointsRaw as unknown[]).map((x) => String(x).trim()).filter(Boolean);
    return { question, answerKeyPoints };
  });

  const cards = (parsed.cards as unknown[]).map((c) => {
    const cc = c as { front?: unknown; back?: unknown };
    const front = String(cc.front ?? "").trim();
    const back = String(cc.back ?? "").trim();
    return { front, back };
  }).filter((x) => x.front && x.back);

  return {
    title: parsed.title.trim(),
    tags,
    snapshotSummary: parsed.snapshotSummary.trim(),
    markdown: parsed.markdown.trim(),
    quizItems,
    cards,
  };
}

