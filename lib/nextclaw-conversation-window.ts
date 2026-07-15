/**
 * Token 感知的对话窗口组装。
 *
 * 替代原有硬截断 30 条的做法，改为：
 * 1. 按 token 预算（默认 4000）决定窗口大小
 * 2. 最近 N 条消息保留原文（默认 8 条）
 * 3. 更早消息滚动压缩为 conversation_summary
 * 4. 返回裁剪后的消息列表 + 摘要
 */

import { CONVERSATION_MAX_TOKENS, CONVERSATION_KEEP_RECENT } from "@/lib/nextclaw-agent-config";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type ConversationWindowResult = {
  /** 裁剪后应发送给 AI 的消息列表 */
  windowMessages: ChatMessage[];
  /** 更早消息的摘要文本（空字符串表示无需摘要） */
  summary: string;
  /** 是否有消息被截断 */
  truncated: boolean;
  /** 估算的总 token 数 */
  estimatedTokens: number;
};

/**
 * 粗略估算 token 数。
 * 中文场景：汉字 ~1.5 token/字，英文 ~0.25 token/字（即 ~4 字/token）。
 * 混合文本取加权平均。
 */
export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified
      (code >= 0x3400 && code <= 0x4dbf) || // CJK Ext-A
      (code >= 0x20000 && code <= 0x2a6df) || // CJK Ext-B+
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compat
      (code >= 0x3000 && code <= 0x303f) || // CJK Symbols
      (code >= 0xff00 && code <= 0xffef) // Fullwidth
    ) {
      cjk += 1;
    } else if (code > 0x7f || (code >= 0x20 && code <= 0x7e)) {
      other += 1;
    }
  }
  // CJK ~1.5 chars/token，英文 ~4 chars/token
  return Math.ceil(cjk / 1.5 + other / 4);
}

/** 生成对话摘要的简单模板（不调 LLM，纯规则压缩） */
function summarizeMessages(messages: ChatMessage[]): string {
  if (!messages.length) return "";
  const parts: string[] = [];
  let userCount = 0;
  let assistantCount = 0;
  const topics = new Set<string>();

  for (const m of messages) {
    if (m.role === "user") {
      userCount += 1;
      // 尝试提取关键词作为主题
      const keywords = m.content
        .replace(/[，。！？\s,.\!?]+/g, " ")
        .split(" ")
        .filter((w) => w.length >= 2 && w.length <= 10)
        .slice(0, 3);
      keywords.forEach((k) => topics.add(k));
    } else {
      assistantCount += 1;
    }
  }

  parts.push(`早期对话概览：用户发言 ${userCount} 轮，助手回复 ${assistantCount} 轮`);
  if (topics.size > 0) {
    parts.push(`涉及话题：${[...topics].slice(0, 8).join("、")}`);
  }
  // 取首尾各一条用户消息作为上下文锚点
  const userMsgs = messages.filter((m) => m.role === "user");
  if (userMsgs.length > 0) {
    const first = userMsgs[0]!.content.replace(/\s+/g, " ").slice(0, 200);
    parts.push(`最早用户提问："${first}${first.length >= 200 ? "…" : ""}"`);
  }
  if (userMsgs.length > 1) {
    const last = userMsgs[userMsgs.length - 1]!.content.replace(/\s+/g, " ").slice(0, 200);
    parts.push(`最近早期提问："${last}${last.length >= 200 ? "…" : ""}"`);
  }

  // 限制摘要长度在 600 字以内
  let summary = parts.join("；");
  if (summary.length > 600) summary = summary.slice(0, 597) + "…";
  return summary;
}

export type BuildWindowOptions = {
  /** token 预算上限，默认 CONVERSATION_MAX_TOKENS */
  maxTokens?: number;
  /** 最近保留原文的消息条数，默认 CONVERSATION_KEEP_RECENT */
  keepRecent?: number;
};

/**
 * 按 token 预算组装对话窗口。
 *
 * 策略：
 * - 计算所有消息的总 token 数
 * - 若总 token 未超预算，直接全量返回
 * - 若超预算：
 *   1. 从尾部向前保留 `keepRecent` 条消息
 *   2. 剩余消息生成摘要
 *   3. 摘要 + 最近消息 = 最终窗口
 */
export function buildConversationWindow(
  messages: ChatMessage[],
  options: BuildWindowOptions = {},
): ConversationWindowResult {
  const maxTokens = options.maxTokens ?? CONVERSATION_MAX_TOKENS;
  const keepRecent = options.keepRecent ?? CONVERSATION_KEEP_RECENT;

  if (!messages.length) {
    return { windowMessages: [], summary: "", truncated: false, estimatedTokens: 0 };
  }

  // 快速路径：消息很少时不截断
  const totalEstimate = messages.reduce((sum, m) => sum + estimateTokenCount(m.content), 0);
  if (totalEstimate <= maxTokens) {
    return {
      windowMessages: messages,
      summary: "",
      truncated: false,
      estimatedTokens: totalEstimate,
    };
  }

  // 需要截断：从后往前保留 keepRecent 条
  const recent = messages.slice(-keepRecent);
  const older = messages.slice(0, messages.length - keepRecent);

  if (!older.length) {
    // 即使只有 keepRecent 条也超预算 → 只保留最近的一半
    const half = Math.max(2, Math.floor(keepRecent / 2));
    const trimmed = messages.slice(-half);
    return {
      windowMessages: trimmed,
      summary: `对话过长（${messages.length} 条），已截断至最近 ${half} 条`,
      truncated: true,
      estimatedTokens: trimmed.reduce((s, m) => s + estimateTokenCount(m.content), 0),
    };
  }

  const summary = summarizeMessages(older);
  const recentEstimate = recent.reduce((s, m) => s + estimateTokenCount(m.content), 0);
  const summaryTokens = estimateTokenCount(summary);

  return {
    windowMessages: recent,
    summary,
    truncated: true,
    estimatedTokens: summaryTokens + recentEstimate,
  };
}
