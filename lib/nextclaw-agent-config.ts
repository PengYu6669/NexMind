/**
 * NextClaw 自治 Agent 可调参数（环境变量覆盖，便于线上调优）。
 */

function intEnv(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** RAG 命中条数：轻量学习 */
export const RAG_TOPK_LITE = intEnv("NEXTCLAW_RAG_TOPK_LITE", 5);

/** RAG 命中条数：深度学习（更广上下文） */
export const RAG_TOPK_DEEP = intEnv("NEXTCLAW_RAG_TOPK_DEEP", 8);

/** LLM Plan 最多步数（含 synthesize），防止计划膨胀 */
export const MAX_PLAN_STEPS = intEnv("NEXTCLAW_MAX_PLAN_STEPS", 10);

/** 自主学习循环：最多轮次（避免递归爆炸） */
export const AUTONOMOUS_MAX_ROUNDS = intEnv("NEXTCLAW_AUTONOMOUS_MAX_ROUNDS", 1);

function boolEnv(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v == null) return fallback;
  const s = String(v).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "yes" || s === "on") return true;
  if (s === "0" || s === "false" || s === "no" || s === "off") return false;
  return fallback;
}

/** 搜索结果偏向中文/中国地区（gl=cn、hl=zh-CN） */
export const SEARCH_PREFER_CN = boolEnv("NEXTCLAW_SEARCH_PREFER_CN", true);

/** 强制只检索中国域名（在 query 中追加 site:.cn） */
export const SEARCH_CN_ONLY = boolEnv("NEXTCLAW_SEARCH_CN_ONLY", false);
