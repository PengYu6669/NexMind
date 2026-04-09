/**
 * nextclaw-web-reader MCP Server（stdio）
 *
 * 工具：
 * - fetch_url(url: string): 返回清洗后的 Markdown（使用 https://r.jina.ai/{url}）
 *
 * 调试：npm run mcp:nextclaw-web-reader
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "nextclaw-web-reader", version: "0.1.0" });

function normalizeUrl(raw: string): string {
  const u = raw.trim();
  if (!u) throw new Error("URL 为空");
  // 只允许 http/https，避免 file:// 等
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
  // 超轻量抽取：优先 article，其次 main；取更长的那个
  const mArticle = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  const mMain = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  const a = mArticle?.[1]?.trim() ?? "";
  const b = mMain?.[1]?.trim() ?? "";
  const pick = a.length >= b.length ? a : b;
  return pick ? pick : null;
}

server.registerTool(
  "fetch_url",
  {
    description: "抓取网页并返回适合 LLM 阅读的 Markdown（via jina-reader r.jina.ai）。",
    inputSchema: {
      url: z.string().min(1).describe("目标 URL（http/https）"),
      timeoutMs: z.number().int().min(2000).max(45000).optional().describe("超时（毫秒），默认 20000"),
      maxChars: z.number().int().min(1000).max(200000).optional().describe("最大返回字符数，默认 60000"),
    },
  },
  async ({ url, timeoutMs, maxChars }) => {
    const target = normalizeUrl(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs ?? 20000);
    try {
      const cap = maxChars ?? 60000;

      // 1) 优先走 jina-reader
      try {
        const readerUrl = `https://r.jina.ai/${target}`;
        const res = await fetch(readerUrl, {
          method: "GET",
          headers: {
            "User-Agent": "ima-claw-nextclaw-web-reader/0.1.0",
          },
          signal: controller.signal,
        });
        const text = await res.text();
        if (res.ok) {
          const out = text.length > cap ? text.slice(0, cap) : text;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  ok: true,
                  url: target,
                  readerUrl,
                  markdown: out,
                  length: text.length,
                  truncated: text.length > cap,
                }),
              },
            ],
          };
        }
        // 非 2xx：继续 fallback 直连
      } catch {
        // jina 失败：继续 fallback 直连
      }

      // 2) fallback：直连原站（轻量清洗，尽量返回可用文本）
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
              text: JSON.stringify({
                ok: false,
                error: "FETCH_FAILED",
                status: res2.status,
                url: target,
                detail: html.slice(0, 1200),
              }),
            },
          ],
        };
      }
      const mainHtml = extractMainOrArticleHtml(html);
      const plain = stripHtmlToTextLite(mainHtml ?? html);
      const out = plain.length > cap ? plain.slice(0, cap) : plain;
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              url: target,
              readerUrl: null,
              markdown: out,
              length: plain.length,
              truncated: plain.length > cap,
              mode: "direct",
              extracted: mainHtml ? "main/article" : "full",
            }),
          },
        ],
      };
    } catch (e) {
      const msg = errorToString(e);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: false, error: "FETCH_EXCEPTION", detail: msg }),
          },
        ],
      };
    } finally {
      clearTimeout(timeout);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[nextclaw-web-reader] MCP server connected (stdio).");
}

main().catch((e) => {
  console.error("[nextclaw-web-reader] Server error:", e);
  process.exit(1);
});

