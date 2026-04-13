/**
 * nextclaw-bridge MCP Server（stdio）
 *
 * 目标：同仓单进程暴露多工具，方便应用内只 spawn 一个 MCP 子进程。
 *
 * 工具汇总：
 * - nextclaw_read_note / nextclaw_semantic_search（知识库）
 * - web_search（SerpAPI）
 * - fetch_url（web-reader）
 * - audit_content（knowledge-auditor）
 *
 * 调试：npm run mcp:nextclaw-bridge
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const envFile = resolve(process.cwd(), ".env");
if (existsSync(envFile)) {
  config({ path: envFile });
}

const server = new McpServer({ name: "nextclaw-bridge", version: "0.1.0" });

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) throw new Error("URL 为空");
  if (!/^https?:\/\//i.test(u)) throw new Error("仅支持 http/https URL");
  return u;
}

function errorToString(e: unknown): string {
  if (e instanceof Error) {
    const anyE = e as Error & { cause?: unknown };
    const cause = anyE.cause ? `; cause=${String(anyE.cause)}` : "";
    return `${e.name}: ${e.message}${cause}`;
  }
  return String(e);
}

function stripHtmlToTextLite(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractMainOrArticleHtml(html: string): string | null {
  const mArticle = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const mMain = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const a = mArticle?.[1]?.trim() ?? "";
  const b = mMain?.[1]?.trim() ?? "";
  const pick = a.length >= b.length ? a : b;
  return pick ? pick : null;
}

server.registerTool(
  "nextclaw_read_note",
  {
    description: "读取指定用户一篇笔记的正文（去除 HTML）。",
    inputSchema: {
      userId: z.string().min(1),
      noteId: z.string().min(1),
      maxChars: z.number().int().min(200).max(12000).optional(),
    },
  },
  async ({ userId, noteId, maxChars }) => {
    try {
      const { prisma } = await import("../../lib/prisma");
      const { stripHtmlToText } = await import("../../lib/rag");
      const note = await prisma.note.findFirst({
        where: { id: noteId, userId },
        select: { title: true, content: true },
      });
      if (!note) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "NOTE_NOT_FOUND", noteId }) }],
        };
      }
      const plain = stripHtmlToText(note.content);
      const cap = maxChars ?? 8000;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              title: note.title,
              plainText: plain.slice(0, cap),
              length: plain.length,
              truncated: plain.length > cap,
            }),
          },
        ],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "READ_NOTE_FAILED", detail: msg }) }] };
    }
  }
);

server.registerTool(
  "nextclaw_semantic_search",
  {
    description: "语义检索用户知识库（note_chunks）。",
    inputSchema: {
      userId: z.string().min(1),
      query: z.string().min(1),
      topK: z.number().int().min(1).max(10).optional(),
    },
  },
  async ({ userId, query, topK }) => {
    try {
      const { ragSearch } = await import("../../lib/rag");
      const hits = await ragSearch({ userId, query, topK: topK ?? 5 });
      const simplified = hits.map((h) => ({
        noteId: h.noteId,
        noteTitle: h.noteTitle,
        chunkIndex: h.chunkIndex,
        distance: h.distance,
        content: h.content.slice(0, 520),
      }));
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, hits: simplified }) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "SEMANTIC_SEARCH_FAILED", detail: msg }) }] };
    }
  }
);

server.registerTool(
  "web_search",
  {
    description: "使用 SerpAPI 搜索网页，返回候选链接（标题/摘要/URL）。",
    inputSchema: {
      query: z.string().min(1),
      topK: z.number().int().min(1).max(10).optional(),
      freshness: z.enum(["day", "week", "month", "year", "all"]).optional(),
      // 约束：NextClaw 默认只用百度，避免 Google 引擎在国内/网络环境下失败造成阻塞。
      engine: z.enum(["baidu", "bing"]).optional(),
      gl: z.string().optional(),
      hl: z.string().optional(),
    },
  },
  async ({ query, topK, freshness, engine, gl, hl }) => {
    const apiKey = process.env.SERPAPI_API_KEY?.trim();
    if (!apiKey) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "MISSING_SERPAPI_API_KEY" }) }],
      };
    }
    const k = topK ?? 5;
    try {
      const preferredEngine = (engine ?? process.env.NEXTCLAW_SERPAPI_ENGINE ?? "baidu").toLowerCase();
      // 强制限制：只允许 baidu/bing；任何未知/不被支持的值都回退到 baidu
      const normalizedEngine = preferredEngine === "bing" ? "bing" : "baidu";
      const executeSearch = async (engineName: string) => {
      const u = new URL("https://serpapi.com/search.json");
      u.searchParams.set("api_key", apiKey);
      u.searchParams.set("engine", engineName);
      u.searchParams.set("q", query);
      u.searchParams.set("num", String(Math.min(10, Math.max(1, k))));
      if (gl && gl.trim()) u.searchParams.set("gl", gl.trim());
      if (hl && hl.trim()) u.searchParams.set("hl", hl.trim());
      if (freshness && freshness !== "all") {
        const map: Record<string, string> = { day: "d", week: "w", month: "m", year: "y" };
        const v = map[freshness];
        if (v) u.searchParams.set("as_qdr", v);
      }

        const res = await fetch(u.toString(), {
          method: "GET",
          headers: {
            Accept: "application/json",
            "User-Agent": "ima-claw-nextclaw-search/0.1.0",
          },
        });
        const data = (await res.json().catch(() => null)) as any;
        if (!res.ok) return { ok: false as const, error: "SERPAPI_HTTP_ERROR", detail: { status: res.status, data } };
        if (data?.error) {
          const detail = String(data.error);
          // 无结果属于“可降级”情况：返回 ok=true + 空 results，让上层跳过联网继续跑，而不是整条链路失败。
          if (/hasn't returned any results/i.test(detail)) {
            return { ok: true as const, engine: engineName, results: [] as any[], warning: detail };
          }
          return { ok: false as const, error: "SERPAPI_ERROR", detail };
        }
        const results = (data?.organic_results ?? []) as any[];
        const simplified = results.slice(0, k).map((r) => ({
          title: String(r?.title ?? "").trim(),
          url: String(r?.link ?? r?.url ?? "").trim(),
          description: String(r?.snippet ?? r?.description ?? "").trim(),
        }));
        return { ok: true as const, engine: engineName, results: simplified };
      };

      const found = await executeSearch(normalizedEngine);

      if (!found.ok) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: found.error, detail: found.detail }) }],
        };
      }
      const warning = (found as any).warning;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              query,
              engine: found.engine,
              results: found.results,
              ...(warning ? { warning } : {}),
            }),
          },
        ],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "SERPAPI_SEARCH_FAILED", detail: msg }) }] };
    }
  }
);

server.registerTool(
  "fetch_url",
  {
    description: "抓取网页并返回适合 LLM 阅读的 Markdown（via jina-reader r.jina.ai）。",
    inputSchema: {
      url: z.string().min(1),
      timeoutMs: z.number().int().min(2000).max(45000).optional(),
      maxChars: z.number().int().min(1000).max(200000).optional(),
    },
  },
  async ({ url, timeoutMs, maxChars }) => {
    try {
      const target = normalizeUrl(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 20000);
      try {
        const readerUrl = `https://r.jina.ai/${target}`;
        const cap = maxChars ?? 60000;

        // 1) 优先 jina
        try {
          const res = await fetch(readerUrl, {
            method: "GET",
            headers: { "User-Agent": "ima-claw-nextclaw-web-reader/0.1.0" },
            signal: controller.signal,
          });
          const text = await res.text();
          if (res.ok) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify({
                    ok: true,
                    url: target,
                    readerUrl,
                    markdown: text.slice(0, cap),
                    length: text.length,
                    truncated: text.length > cap,
                  }),
                },
              ],
            };
          }
        } catch {
          // ignore, fallback direct
        }

        // 2) fallback direct
        const res2 = await fetch(target, {
          method: "GET",
          headers: { "User-Agent": "ima-claw-nextclaw-web-reader/0.1.0" },
          signal: controller.signal,
        });
        const html = await res2.text();
        if (!res2.ok) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ ok: false, error: "FETCH_FAILED", status: res2.status, url: target, detail: html.slice(0, 1200) }),
              },
            ],
          };
        }
        const mainHtml = extractMainOrArticleHtml(html);
        const plain = stripHtmlToTextLite(mainHtml ?? html);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: true,
                url: target,
                readerUrl: null,
                markdown: plain.slice(0, cap),
                length: plain.length,
                truncated: plain.length > cap,
                mode: "direct",
                extracted: mainHtml ? "main/article" : "full",
              }),
            },
          ],
        };
      } finally {
        clearTimeout(timeout);
      }
    } catch (e) {
      const msg = errorToString(e);
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "FETCH_EXCEPTION", detail: msg }) }] };
    }
  }
);

server.registerTool(
  "audit_content",
  {
    description: "审计新内容与相关笔记片段：冲突/补位/建议关联 noteId。",
    inputSchema: {
      newContent: z.string().min(1),
      relatedNotes: z
        .array(
          z.object({
            noteId: z.string().optional(),
            title: z.string().optional(),
            content: z.string().min(1),
          })
        )
        .max(10),
      maxItems: z.number().int().min(3).max(12).optional(),
    },
  },
  async ({ newContent, relatedNotes, maxItems }) => {
    try {
      const { callDashscopeChatCompletion, extractJsonFromText } = await import("../../lib/doubao");
      const model = process.env.AI_MODEL_WRITER || process.env.AI_MODEL_CHAT || "Doubao-Seed-2.0-lite";
      const cap = maxItems ?? 6;
      const system =
        "你是 NextClaw 的知识审计员（Knowledge Auditor）。输出仅 JSON：{ conflicts: string[], fillGaps: string[], suggestedNoteIds: string[] }。\\n" +
        `每类最多 ${cap} 条，宁缺毋滥。不要编造外部事实，只基于输入判断。`;
      const user = JSON.stringify({
        newContent: newContent.slice(0, 20000),
        relatedNotes: relatedNotes.map((n) => ({
          noteId: n.noteId ?? null,
          title: n.title ?? null,
          content: n.content.slice(0, 1200),
        })),
      });
      const raw = await callDashscopeChatCompletion({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      });
      const parsed = extractJsonFromText(raw) as { conflicts?: unknown; fillGaps?: unknown; suggestedNoteIds?: unknown };
      const conflicts = Array.isArray(parsed.conflicts) ? parsed.conflicts.map((x) => String(x).trim()).filter(Boolean).slice(0, cap) : [];
      const fillGaps = Array.isArray(parsed.fillGaps) ? parsed.fillGaps.map((x) => String(x).trim()).filter(Boolean).slice(0, cap) : [];
      const suggestedNoteIds = Array.isArray(parsed.suggestedNoteIds)
        ? parsed.suggestedNoteIds.map((x) => String(x).trim()).filter(Boolean).slice(0, cap)
        : [];
      return { content: [{ type: "text" as const, text: JSON.stringify({ ok: true, conflicts, fillGaps, suggestedNoteIds }) }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ ok: false, error: "AUDIT_FAILED", detail: msg }) }] };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[nextclaw-bridge] MCP server connected (stdio).");
}

main().catch((e) => {
  console.error("[nextclaw-bridge] Server error:", e);
  process.exit(1);
});

