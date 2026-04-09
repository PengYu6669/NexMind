/**
 * NextClaw 知识库 MCP Server（stdio）
 *
 * 工作目录须为仓库根目录，以便加载 .env 与 lib/prisma。
 * 手动调试：npm run mcp:nextclaw-knowledge
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

const server = new McpServer({
  name: "nextclaw-knowledge",
  version: "0.1.0",
});

async function main() {
  // 重要：dotenv 必须在导入 prisma 前执行，否则 DATABASE_URL 读不到。
  const { prisma } = await import("../../lib/prisma");
  const { ragSearch, stripHtmlToText } = await import("../../lib/rag");

  server.registerTool(
    "nextclaw_read_note",
    {
      description:
        "读取指定用户一篇笔记的正文（去除 HTML）。仅供已鉴权的 NextClaw Agent 调用：调用方必须传入该用户的 userId 与目标 noteId。",
      inputSchema: {
        userId: z.string().min(1).describe("笔记所属用户 ID"),
        noteId: z.string().min(1).describe("笔记 cuid"),
        maxChars: z
          .number()
          .int()
          .min(200)
          .max(12000)
          .optional()
          .describe("返回正文最大字符数，默认 8000"),
      },
    },
    async ({ userId, noteId, maxChars }) => {
      const note = await prisma.note.findFirst({
        where: { id: noteId, userId },
        select: { title: true, content: true },
      });
      if (!note) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: "NOTE_NOT_FOUND", noteId }),
            },
          ],
        };
      }
      const plain = stripHtmlToText(note.content);
      const cap = maxChars ?? 8000;
      const truncated = plain.length > cap;
      const body = plain.slice(0, cap);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              title: note.title,
              plainText: body,
              length: plain.length,
              truncated,
            }),
          },
        ],
      };
    }
  );

  server.registerTool(
    "nextclaw_semantic_search",
    {
      description:
        "在当前用户知识库（笔记向量分块）中做语义检索，返回相关片段、距离与笔记标题。需已建立 note_chunks 与向量索引。",
      inputSchema: {
        userId: z.string().min(1).describe("用户 ID"),
        query: z.string().min(1).describe("检索查询（自然语言）"),
        topK: z.number().int().min(1).max(10).optional().describe("返回条数，默认 5，最大 10"),
      },
    },
    async ({ userId, query, topK }) => {
      try {
        const hits = await ragSearch({ userId, query, topK: topK ?? 5 });
        const simplified = hits.map((h) => ({
          noteId: h.noteId,
          noteTitle: h.noteTitle,
          chunkIndex: h.chunkIndex,
          distance: h.distance,
          content: h.content.slice(0, 520),
        }));
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: true, hits: simplified }),
            },
          ],
        };
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ ok: false, error: "SEMANTIC_SEARCH_FAILED", detail: message }),
            },
          ],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // 注意：stdio 模式不要往 stdout 打日志；如需调试请用 stderr。
  console.error("[nextclaw-knowledge] MCP server connected (stdio).");
}

main().catch((e) => {
  console.error("[nextclaw-knowledge] Server error:", e);
  process.exit(1);
});
