import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";
import { runNextClawSkill } from "@/lib/nextclaw-skills";

export type AutonomousDecision = {
  needSearch: boolean;
  /** 需要搜索时给出的查询词 */
  query?: string;
  /** 给用户看的短解释（用于 steps 展示） */
  reason?: string;
};

export type WebSearchPick = {
  announce: string;
  selectedIndex: number;
  selectedUrl: string;
  selectedTitle?: string;
  top3: { title: string; url: string; why: string }[];
};

function asStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function asBool(x: unknown): boolean {
  return x === true;
}

function normalizeDecision(raw: unknown): AutonomousDecision {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const needSearch = asBool(r.needSearch);
  const query = asStr(r.query).trim();
  const reason = asStr(r.reason).trim();
  return {
    needSearch,
    ...(query ? { query } : {}),
    ...(reason ? { reason } : {}),
  };
}

function normalizePick(raw: unknown): WebSearchPick {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const announce = asStr(r.announce).trim() || "我找到了 3 个来源，准备优先分析第 1 个。";
  const selectedIndex = Number.isFinite(Number(r.selectedIndex)) ? Math.max(1, Math.floor(Number(r.selectedIndex))) : 1;
  const selectedUrl = asStr(r.selectedUrl).trim();
  const selectedTitle = asStr(r.selectedTitle).trim() || undefined;
  const top3Raw = Array.isArray(r.top3) ? (r.top3 as unknown[]) : [];
  const top3 = top3Raw
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({
      title: asStr(x.title).trim(),
      url: asStr(x.url).trim(),
      why: asStr(x.why).trim(),
    }))
    .filter((x) => x.title && x.url && x.why)
    .slice(0, 3);

  if (!selectedUrl && top3[0]?.url) {
    return {
      announce,
      selectedIndex: 1,
      selectedUrl: top3[0].url,
      selectedTitle: top3[0].title,
      top3,
    };
  }

  return { announce, selectedIndex, selectedUrl, selectedTitle, top3 };
}

export async function decideNeedWebSearch(params: {
  noteTitle: string;
  noteText: string;
  kbDigest: string;
}): Promise<AutonomousDecision> {
  const model =
    process.env.AI_MODEL_WRITER ||
    process.env.AI_MODEL_CHAT ||
    "Doubao-Seed-2.0-lite";

  const system =
    "你是 NextClaw 的自主学习决策器。你要判断：当前知识库信息是否足以完成学习任务，若不足则给出一个高质量搜索 query。\n" +
    "只输出 JSON（不要 Markdown，不要解释）。输出格式：{ needSearch: boolean, query?: string, reason?: string }。\n" +
    "约束：\n" +
    "- **默认倾向 needSearch=false**：仅当知识库明显缺权威定义、缺可核对事实、或主题强依赖实时/外链文档时才置为 true。\n" +
    "- needSearch=true 时必须提供 query（中文优先，包含：官网、GitHub、文档、教程等关键词）。\n" +
    "- 如果调用环境偏向中国站点可访问性，请优先选择中文来源或在 query 中加入 site:.cn（不要把 sitemap 当作目标）。\n" +
    "- reason 给用户看，最多 1 句话。\n";

  const user = JSON.stringify({
    noteTitle: params.noteTitle,
    noteSnippet: params.noteText.slice(0, 1600),
    kbDigest: params.kbDigest.slice(0, 2200),
  });

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = extractJsonFromText(raw);
  const d = normalizeDecision(parsed);
  if (d.needSearch && !d.query) {
    return {
      needSearch: true,
      query: `学习 ${params.noteTitle}（官网 GitHub 文档 教程）`,
      reason: d.reason || "现有笔记信息不足，需要先补齐权威来源。",
    };
  }
  return d;
}

/**
 * 启发式 URL 筛选（替代 LLM-based pickBestFromWebResults）。
 * 基于 source_trust 对结果打分，选取最高分 URL。
 * 避免额外 LLM 调用，秒级提速。
 */
export function pickBestByHeuristic(
  results: { title?: string; url?: string; description?: string }[],
): { selectedUrl: string; selectedTitle?: string; announce: string } {
  const valid = results.filter((r) => r.url && /^https?:\/\//.test(r.url));
  if (!valid.length) {
    return { selectedUrl: "", announce: "无可用来源链接" };
  }

  // 按 source_trust 得分排序
  const scored = valid.map((r) => {
    const trust = runNextClawSkill("source_trust", {
      url: r.url ?? "",
      title: r.title ?? "",
      snippet: r.description ?? "",
      markdown: "",
    });
    return { ...r, score: trust.score, level: trust.level };
  });
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0]!;
  return {
    selectedUrl: best.url ?? "",
    selectedTitle: best.title,
    announce: `来源评估后优先分析「${best.title || best.url}」`,
  };
}

export async function pickBestFromWebResults(params: {
  query: string;
  results: { title?: string; url?: string; description?: string }[];
}): Promise<WebSearchPick> {
  const model =
    process.env.AI_MODEL_WRITER ||
    process.env.AI_MODEL_CHAT ||
    "Doubao-Seed-2.0-lite";

  const system =
    "你是 NextClaw 的来源筛选器。根据搜索结果，挑选最值得优先阅读的 1 个来源，并给出要展示给用户的‘评估与跳转’一句话。\n" +
    "只输出 JSON。格式：{\n" +
    "  announce: string,\n" +
    "  top3: [{title,url,why}],\n" +
    "  selectedIndex: 1|2|3,\n" +
    "  selectedUrl: string,\n" +
    "  selectedTitle?: string\n" +
    "}。\n" +
    "规则：\n" +
    "- top3 里优先：官方文档 / GitHub / 权威教程；避免聚合站与低质量转载。\n" +
    "- 明确排除：sitemap、rss、tag、archive、search、站点地图、目录页（这些通常不可读或价值低）。\n" +
    "- announce 需符合：\"我找到了以下 3 个来源，准备优先分析第 X 个...\"。\n";

  const user = JSON.stringify({
    query: params.query,
    results: params.results
      .filter((r) => r && typeof r.url === "string" && r.url.startsWith("http"))
      .slice(0, 5)
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        description: (r.description ?? "").slice(0, 240),
      })),
  });

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = extractJsonFromText(raw);
  const pick = normalizePick(parsed);
  if (!pick.selectedUrl) {
    // 兜底：选择第一个可用 URL
    const first = params.results.find((x) => typeof x.url === "string" && x.url.startsWith("http"));
    return {
      announce: "我找到了以下 3 个来源，准备优先分析第 1 个…",
      top3: [],
      selectedIndex: 1,
      selectedUrl: first?.url ?? "",
      selectedTitle: first?.title,
    };
  }
  return pick;
}

