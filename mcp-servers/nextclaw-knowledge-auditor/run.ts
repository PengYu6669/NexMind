/**
 * nextclaw-knowledge-auditor MCP Server（stdio）
 *
 * 工具：
 * - audit_content(newContent: string, relatedNotes: {noteId?, title?, content}[])
 *
 * 输出 JSON：
 * - conflicts: string[]
 * - fillGaps: string[]
 * - suggestedNoteIds: string[]
 *
 * 调试：npm run mcp:nextclaw-knowledge-auditor
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

const server = new McpServer({ name: "nextclaw-knowledge-auditor", version: "0.1.0" });

server.registerTool(
  "audit_content",
  {
    description:
      "审计新内容与既有知识库：输出冲突点、补位点、建议关联的 noteId（如果 relatedNotes 提供 noteId）。",
    inputSchema: {
      newContent: z.string().min(1).describe("新抓取/新输入的内容（建议 Markdown/纯文本）"),
      relatedNotes: z
        .array(
          z.object({
            noteId: z.string().optional().describe("可选：笔记 ID"),
            title: z.string().optional().describe("可选：笔记标题"),
            content: z.string().min(1).describe("相关笔记片段/摘要"),
          })
        )
        .max(10)
        .describe("相关笔记片段（通常来自语义搜索 TopK）"),
      maxItems: z.number().int().min(3).max(12).optional().describe("每类最多条数，默认 6"),
    },
  },
  async ({ newContent, relatedNotes, maxItems }) => {
    try {
      // 延迟导入：保证 dotenv 在 prisma/doubao 读取 env 前执行
      const { callDashscopeChatCompletion, extractJsonFromText } = await import("../../lib/doubao");

      const model =
        process.env.AI_MODEL_WRITER || process.env.AI_MODEL_CHAT || "Doubao-Seed-2.0-lite";
      const cap = maxItems ?? 6;

      const system =
        "你是 NextClaw 的知识审计员（Knowledge Auditor）。你会对比【新内容】与【相关笔记片段】并输出仅 JSON。\\n" +
        "输出 JSON 结构：{ conflicts: string[], fillGaps: string[], suggestedNoteIds: string[] }。\\n" +
        "规则：\\n" +
        "- conflicts：指出新内容与旧笔记的矛盾/不一致/风险点（用短句）。\\n" +
        "- fillGaps：指出旧知识库中缺失但新内容补充的关键点（用短句）。\\n" +
        "- suggestedNoteIds：从 relatedNotes 中挑最该关联的笔记 ID（若没有 noteId 则输出空数组）。\\n" +
        `- 每类最多 ${cap} 条，宁缺毋滥。不要编造外部事实，只基于输入判断。`;

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

      const parsed = extractJsonFromText(raw) as {
        conflicts?: unknown;
        fillGaps?: unknown;
        suggestedNoteIds?: unknown;
      };

      const conflicts = Array.isArray(parsed.conflicts)
        ? parsed.conflicts.map((x) => String(x).trim()).filter(Boolean).slice(0, cap)
        : [];
      const fillGaps = Array.isArray(parsed.fillGaps)
        ? parsed.fillGaps.map((x) => String(x).trim()).filter(Boolean).slice(0, cap)
        : [];
      const suggestedNoteIds = Array.isArray(parsed.suggestedNoteIds)
        ? parsed.suggestedNoteIds.map((x) => String(x).trim()).filter(Boolean).slice(0, cap)
        : [];

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: true, conflicts, fillGaps, suggestedNoteIds }),
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
            text: JSON.stringify({ ok: false, error: "AUDIT_FAILED", detail: msg }),
          },
        ],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[nextclaw-knowledge-auditor] MCP server connected (stdio).");
}

main().catch((e) => {
  console.error("[nextclaw-knowledge-auditor] Server error:", e);
  process.exit(1);
});

