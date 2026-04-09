/**
 * nextclaw-search MCP Server（stdio）
 *
 * 工具：
 * - web_search(query: string): SerpAPI 返回候选链接（默认 Baidu）
 *
 * 依赖环境变量：
 * - SERPAPI_API_KEY：SerpAPI Key
 *
 * 调试：npm run mcp:nextclaw-search
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

const server = new McpServer({ name: "nextclaw-search", version: "0.1.0" });

server.registerTool(
  "web_search",
  {
    description: "使用 SerpAPI 搜索网页，返回候选链接（标题/摘要/URL）。",
    inputSchema: {
      query: z.string().min(1).describe("搜索关键词（自然语言）"),
      topK: z.number().int().min(1).max(10).optional().describe("返回条数，默认 5，最大 10"),
      freshness: z
        .enum(["day", "week", "month", "year", "all"])
        .optional()
        .describe("时效过滤（可选）"),
      engine: z
        .enum(["baidu", "google", "bing"])
        .optional()
        .describe("搜索引擎（可选），默认 baidu"),
      gl: z.string().optional().describe("地区（可选），如 us/cn"),
      hl: z.string().optional().describe("语言（可选），如 en/zh-CN"),
    },
  },
  async ({ query, topK, freshness, engine, gl, hl }) => {
    const apiKey = process.env.SERPAPI_API_KEY?.trim();
    if (!apiKey) {
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: false, error: "MISSING_SERPAPI_API_KEY" }),
          },
        ],
      };
    }

    const k = topK ?? 5;
    try {
      const preferredEngine = (engine ?? process.env.NEXTCLAW_SERPAPI_ENGINE ?? "baidu").toLowerCase();
      const fallbackEngine = preferredEngine === "baidu" ? "google" : "baidu";
      const executeSearch = async (engineName: string) => {
      const u = new URL("https://serpapi.com/search.json");
      u.searchParams.set("api_key", apiKey);
      u.searchParams.set("engine", engineName);
      u.searchParams.set("q", query);
      u.searchParams.set("num", String(Math.min(10, Math.max(1, k))));
      if (gl && gl.trim()) u.searchParams.set("gl", gl.trim());
      if (hl && hl.trim()) u.searchParams.set("hl", hl.trim());
      // SerpAPI: 用 as_qdr 做简易时效过滤（不是所有引擎都严格支持，但不影响）
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
        if (!res.ok) {
          return { ok: false as const, error: "SERPAPI_HTTP_ERROR", detail: { status: res.status, data } };
        }
        if (data?.error) {
          return { ok: false as const, error: "SERPAPI_ERROR", detail: String(data.error) };
        }
        const results = (data?.organic_results ?? []) as any[];
        const simplified = results.slice(0, k).map((r) => ({
          title: String(r?.title ?? "").trim(),
          url: String(r?.link ?? r?.url ?? "").trim(),
          description: String(r?.snippet ?? r?.description ?? "").trim(),
          source: String(r?.source ?? "").trim() || null,
        }));
        return { ok: true as const, engine: engineName, results: simplified };
      };

      let found = await executeSearch(preferredEngine);
      const noResultError =
        !found.ok &&
        found.error === "SERPAPI_ERROR" &&
        typeof found.detail === "string" &&
        /hasn't returned any results/i.test(found.detail);
      if (noResultError) {
        found = await executeSearch(fallbackEngine);
      }

      if (!found.ok) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: found.error, detail: found.detail }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, query, engine: found.engine, results: found.results }),
          },
        ],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: false, error: "SERPAPI_SEARCH_FAILED", detail: msg }),
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[nextclaw-search] MCP server connected (stdio).");
}

main().catch((e) => {
  console.error("[nextclaw-search] Server error:", e);
  process.exit(1);
});

