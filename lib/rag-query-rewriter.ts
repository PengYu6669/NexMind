/**
 * RAG 查询改写器。
 *
 * 将自然语言问题改写为搜索友好的关键词，
 * 去除口语化噪音，提取核心检索意图。
 *
 * 失败时退回原始 query，不影响主流程。
 */

import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";

type RewriteResult = {
  /** 空格分隔的关键词，用于 lexical 检索（FTS/trigram） */
  keywords: string;
  /** 拆解后的子查询（可选），可用于多路召回 */
  subQueries: string[];
};

const REWRITE_PROMPT = `你是搜索引擎查询改写器。将用户输入改写为搜索关键词，去掉口语化噪音。

规则：
- keywords: 提取 3-8 个核心关键词，用空格分隔，保留英文术语原文（如 transformer、BERT、RAG）
- subQueries: 可选，将复杂问题拆为 1-3 个子查询；简单问题返回空数组
- 只输出 JSON，不要 markdown、不要解释

示例：
输入："上周看的那篇关于 transformer 注意力机制的文章，里面讲的 multi-head 具体怎么实现的？"
输出：{"keywords":"transformer 注意力机制 multi-head 实现原理","subQueries":["transformer multi-head attention 原理","multi-head attention 计算过程"]}

输入："帮我复习一下 RAG 的 hybrid search 怎么做"
输出：{"keywords":"RAG hybrid search 混合检索 实现","subQueries":[]}`;

export async function rewriteQueryForRag(
  rawQuery: string,
): Promise<RewriteResult> {
  const q = rawQuery.trim();
  if (!q) return { keywords: "", subQueries: [] };

  // 快速路径：很短的查询不需要改写
  if (q.length < 10) {
    return { keywords: q, subQueries: [] };
  }

  const model =
    process.env.AI_MODEL_CHAT || "Doubao-Seed-2.0-lite";

  try {
    const raw = await callDashscopeChatCompletion({
      model,
      messages: [
        { role: "system", content: REWRITE_PROMPT },
        { role: "user", content: q },
      ],
      // 轻量调用
    });

    const parsed = extractJsonFromText(raw);
    if (!parsed || typeof parsed !== "object") throw new Error("非 JSON 输出");

    const obj = parsed as Record<string, unknown>;
    const keywords =
      typeof obj.keywords === "string" && obj.keywords.trim()
        ? obj.keywords.trim()
        : q;
    const subQueries = Array.isArray(obj.subQueries)
      ? obj.subQueries.filter(
          (s: unknown): s is string =>
            typeof s === "string" && s.trim().length > 0,
        )
      : [];

    return { keywords, subQueries };
  } catch {
    // 任何失败退回原始 query
    return { keywords: q, subQueries: [] };
  }
}
