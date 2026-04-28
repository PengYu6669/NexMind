import { prisma } from "@/lib/prisma";
import type { PlanToolName } from "@/lib/nextclaw-agent-types";
import {
  NEXTCLAW_MCP_TOOL_READ_NOTE,
  NEXTCLAW_MCP_TOOL_SEMANTIC_SEARCH,
  NEXTCLAW_MCP_TOOL_FETCH_URL,
  NEXTCLAW_MCP_TOOL_AUDIT_CONTENT,
  NEXTCLAW_MCP_TOOL_WEB_SEARCH,
} from "@/lib/nextclaw-mcp-constants";
import { callNextClawKnowledgeTool, nextClawMcpKnowledgeEnabled } from "@/lib/nextclaw-mcp-client";
import { SEARCH_CN_ONLY, SEARCH_PREFER_CN } from "@/lib/nextclaw-agent-config";
import { stripHtmlToText } from "@/lib/rag";

export type ExecuteToolContext = {
  userId: string;
  note: { id: string; title: string; content: string };
  relatedNotes: { noteId: string; title: string; snippet: string; distance?: number }[];
  /** 来自 Plan 的可选参数，例如指定 read_note 的目标 noteId（后续接 MCP 时扩展） */
  toolInput?: Record<string, unknown>;
};

export type ExecuteToolResult = {
  ok: boolean;
  /** 写入步骤 trace / Prompt 的一句话摘要 */
  summary: string;
  /** 可选：供 Runner 串联下一步的结构化输出 */
  data?: unknown;
};

async function mcpSemanticSearch(ctx: ExecuteToolContext): Promise<ExecuteToolResult | null> {
  if (!nextClawMcpKnowledgeEnabled()) return null;
  try {
    const q =
      typeof ctx.toolInput?.query === "string" && ctx.toolInput.query.trim()
        ? ctx.toolInput.query.trim()
        : `${ctx.note.title}\n${stripHtmlToText(ctx.note.content).slice(0, 600)}`;
    const topKRaw = ctx.toolInput?.topK;
    const topK =
      typeof topKRaw === "number" && Number.isFinite(topKRaw)
        ? Math.min(10, Math.max(1, Math.floor(topKRaw)))
        : 5;
    const r = await callNextClawKnowledgeTool(NEXTCLAW_MCP_TOOL_SEMANTIC_SEARCH, {
      userId: ctx.userId,
      query: q,
      topK,
    });
    if (r.isError || !r.ok) {
      return {
        ok: false,
        summary: `semantic_search（MCP）：${r.text.slice(0, 240)}${r.text.length > 240 ? "…" : ""}`,
      };
    }
    const data = r.json as { hits?: { noteTitle?: string; noteId?: string; content?: string }[] } | null;
    const hits = data?.hits ?? [];
    const sig = (s: string) =>
      s
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 180);
    const sigs = hits.map((h) => sig(String(h.content ?? ""))).filter(Boolean);
    const unique = new Set(sigs);
    const dupRatio = sigs.length ? 1 - unique.size / sigs.length : 0;
    const titles = hits
      .slice(0, 5)
      .map((h) => h.noteTitle)
      .filter(Boolean) as string[];
    return {
      ok: true,
      summary: `semantic_search（MCP）：命中 ${hits.length} 段${titles.length ? `（${titles.join("；")}）` : ""}${
        dupRatio >= 0.45 ? "；结果相似度偏高，建议扩大范围或换关键词" : ""
      }`,
      data: dupRatio >= 0.45 ? { duplicateRatio: dupRatio } : undefined,
    };
  } catch (e) {
    console.warn("[executeTool] MCP semantic_search failed, using inline path:", e);
    return null;
  }
}

async function mcpReadNote(ctx: ExecuteToolContext, targetId: string): Promise<ExecuteToolResult | null> {
  if (!nextClawMcpKnowledgeEnabled()) return null;
  try {
    const r = await callNextClawKnowledgeTool(NEXTCLAW_MCP_TOOL_READ_NOTE, {
      userId: ctx.userId,
      noteId: targetId,
      maxChars: 8000,
    });
    if (r.isError || !r.ok) {
      return {
        ok: false,
        summary: `read_note（MCP）：${r.text.slice(0, 240)}${r.text.length > 240 ? "…" : ""}`,
      };
    }
    const data = r.json as {
      title?: string;
      plainText?: string;
      length?: number;
      truncated?: boolean;
    } | null;
    const title = data?.title ?? "（无标题）";
    const len = typeof data?.length === "number" ? data.length : (data?.plainText?.length ?? 0);
    const trunc = data?.truncated ? "，已截断" : "";
    return {
      ok: true,
      summary: `read_note（MCP）：《${title}》正文约 ${len} 字${trunc}`,
    };
  } catch (e) {
    console.warn("[executeTool] MCP read_note failed, using inline path:", e);
    return null;
  }
}

async function mcpFetchUrl(ctx: ExecuteToolContext): Promise<ExecuteToolResult | null> {
  if (!nextClawMcpKnowledgeEnabled()) return null;
  const raw = ctx.toolInput?.url;
  const url = typeof raw === "string" ? raw.trim() : "";
  if (!url) {
    return { ok: false, summary: "fetch_url（MCP）：缺少 url 参数（toolInput.url）" };
  }
  try {
    const r = await callNextClawKnowledgeTool(NEXTCLAW_MCP_TOOL_FETCH_URL, {
      url,
      timeoutMs: 20000,
      maxChars: 25000,
    });
    if (r.isError || !r.ok) {
      return { ok: false, summary: `fetch_url（MCP）：${r.text.slice(0, 240)}${r.text.length > 240 ? "…" : ""}` };
    }
    const data = r.json as { markdown?: string; url?: string; length?: number; truncated?: boolean } | null;
    const md = data?.markdown ?? "";
    const len = typeof data?.length === "number" ? data.length : md.length;
    return {
      ok: true,
      summary: `fetch_url（MCP）：已抓取 ${data?.url ?? url}（约 ${len} 字${data?.truncated ? "，已截断" : ""}）`,
      data: { markdown: md, url: data?.url ?? url },
    };
  } catch (e) {
    console.warn("[executeTool] MCP fetch_url failed:", e);
    return null;
  }
}

async function mcpAuditContent(ctx: ExecuteToolContext): Promise<ExecuteToolResult | null> {
  if (!nextClawMcpKnowledgeEnabled()) return null;
  const raw = ctx.toolInput?.newContent;
  const newContent = typeof raw === "string" ? raw : "";
  if (!newContent.trim()) {
    return { ok: true, summary: "audit_content（MCP）：跳过（未抓取到正文内容）" };
  }
  try {
    const r = await callNextClawKnowledgeTool(NEXTCLAW_MCP_TOOL_AUDIT_CONTENT, {
      newContent,
      relatedNotes: ctx.relatedNotes.slice(0, 8).map((n) => ({
        noteId: n.noteId,
        title: n.title,
        content: n.snippet,
      })),
      maxItems: 6,
    });
    if (r.isError || !r.ok) {
      return { ok: false, summary: `audit_content（MCP）：${r.text.slice(0, 240)}${r.text.length > 240 ? "…" : ""}` };
    }
    const data = r.json as {
      conflicts?: string[];
      fillGaps?: string[];
      suggestedNoteIds?: string[];
    } | null;
    const c = data?.conflicts?.length ?? 0;
    const g = data?.fillGaps?.length ?? 0;
    const s = data?.suggestedNoteIds?.length ?? 0;
    return {
      ok: true,
      summary: `audit_content（MCP）：冲突 ${c} · 补位 ${g} · 关联建议 ${s}`,
      data,
    };
  } catch (e) {
    console.warn("[executeTool] MCP audit_content failed:", e);
    return null;
  }
}

async function mcpWebSearch(ctx: ExecuteToolContext): Promise<ExecuteToolResult | null> {
  if (!nextClawMcpKnowledgeEnabled()) return null;
  const raw = ctx.toolInput?.query;
  const query = typeof raw === "string" ? raw.trim() : "";
  if (!query) {
    return { ok: false, summary: "web_search（MCP）：缺少 query 参数（toolInput.query）" };
  }
  const topKRaw = ctx.toolInput?.topK;
  const topK =
    typeof topKRaw === "number" && Number.isFinite(topKRaw)
      ? Math.min(10, Math.max(1, Math.floor(topKRaw)))
      : 5;
  try {
    const q =
      SEARCH_CN_ONLY && !/\bsite:\.cn\b/i.test(query) ? `${query} site:.cn` : query;
    const r = await callNextClawKnowledgeTool(NEXTCLAW_MCP_TOOL_WEB_SEARCH, {
      query: q,
      topK,
      freshness: "month",
      engine: "baidu",
      ...(SEARCH_PREFER_CN ? { gl: "cn", hl: "zh-CN" } : {}),
    });
    if (r.isError || !r.ok) {
      return { ok: false, summary: `web_search（MCP）：${r.text.slice(0, 240)}${r.text.length > 240 ? "…" : ""}` };
    }
    const data = r.json as { engine?: string; results?: { title?: string; url?: string }[] } | null;
    const results = data?.results ?? [];
    const titles = results
      .slice(0, 3)
      .map((x) => x.title)
      .filter(Boolean) as string[];
    return {
      ok: true,
      summary: `web_search（MCP-${data?.engine ?? "unknown"}）：关键词「${q}」命中 ${results.length} 条${titles.length ? `（${titles.join("；")}）` : ""}`,
      data: { query: q, results },
    };
  } catch (e) {
    console.warn("[executeTool] MCP web_search failed:", e);
    return null;
  }
}

/**
 * MCP 工具钩子：`NEXTCLAW_MCP_ENABLED=true` 时经 stdio 调用 `mcp-servers/nextclaw-knowledge`；
 * 失败或未开启时回退为进程内 Prisma / Mock。
 */
export async function executeTool(
  tool: PlanToolName,
  ctx: ExecuteToolContext
): Promise<ExecuteToolResult> {
  switch (tool) {
    case "search_notes": {
      const mcp = await mcpSemanticSearch(ctx);
      if (mcp) return mcp;
      const titles = ctx.relatedNotes.slice(0, 5).map((n) => n.title);
      return {
        ok: true,
        summary: `search_notes：命中 ${ctx.relatedNotes.length} 条相关笔记${titles.length ? `（${titles.join("；")}）` : ""}`,
      };
    }
    case "read_note": {
      const raw = ctx.toolInput?.noteId;
      const targetId = typeof raw === "string" && raw.trim() ? raw.trim() : ctx.note.id;
      const mcp = await mcpReadNote(ctx, targetId);
      if (mcp) return mcp;

      if (targetId === ctx.note.id) {
        const plain = stripHtmlToText(ctx.note.content);
        return {
          ok: true,
          summary: `read_note：已读取当前笔记正文（${Math.min(plain.length, 8000)} 字内片段用于对齐）`,
        };
      }
      const other = await prisma.note.findFirst({
        where: { id: targetId, userId: ctx.userId },
        select: { title: true, content: true },
      });
      if (!other) {
        return { ok: false, summary: `read_note：未找到笔记 ${targetId}` };
      }
      const plain = stripHtmlToText(other.content).slice(0, 2000);
      return {
        ok: true,
        summary: `read_note：《${other.title}》摘录 ${plain.slice(0, 240)}${plain.length > 240 ? "…" : ""}`,
      };
    }
    case "web_search": {
      const mcp = await mcpWebSearch(ctx);
      if (mcp) return mcp;
      return { ok: false, summary: "web_search：MCP 未启用或调用失败（暂无本地实现）" };
    }
    case "fetch_url": {
      const mcp = await mcpFetchUrl(ctx);
      if (mcp) return mcp;
      return { ok: false, summary: "fetch_url：MCP 未启用或调用失败（暂无本地实现）" };
    }
    case "audit_content": {
      const mcp = await mcpAuditContent(ctx);
      if (mcp) return mcp;
      return { ok: false, summary: "audit_content：MCP 未启用或调用失败（暂无本地实现）" };
    }
    case "synthesize":
      return { ok: true, summary: "synthesize：进入结构化生成（学习卡片）阶段" };
    case "noop":
    default:
      return { ok: true, summary: "noop：无工具调用" };
  }
}
