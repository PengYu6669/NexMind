# mcp-servers

NextClaw 的 MCP 能力由**单一 stdio server** 提供：`nextclaw-bridge`。

## 架构

```text
Next.js 进程（lib/nextclaw-mcp-client.ts）
  └─ spawn: npx tsx mcp-servers/nextclaw-bridge/run.ts   （stdio 子进程）
        ├─ nextclaw_read_note        读取用户笔记正文（prisma）
        ├─ nextclaw_semantic_search  知识库语义检索（lib/rag ragSearch）
        ├─ web_search                SerpAPI 搜索（baidu/bing）
        ├─ fetch_url                 网页抓取（jina-reader 优先，直连兜底；SSRF 校验）
        └─ audit_content             LLM 知识审计（冲突/补位/关联）
```

- 客户端按 knowledge / web / audit 三个 channel 各维护一个子进程连接，RPC 串行化，失败自动重建。
- 早期的 nextclaw-knowledge / nextclaw-web-reader / nextclaw-knowledge-auditor / nextclaw-search
  单体 server 已合并进 bridge 并删除；调试入口只保留 `npm run mcp:nextclaw-bridge`。

## 运行要求

- **工作目录必须是仓库根**（bridge 会动态 import `lib/prisma`、`lib/rag`、`lib/doubao`）。
- 根目录 `.env` 提供 `DATABASE_URL`、AI/Embedding 变量；`SERPAPI_API_KEY` 缺失时 `web_search` 返回显式错误（上层可降级）。
- `tsx` 是生产依赖；生产容器内同样通过 `npx tsx` 启动（见 `Dockerfile`）。

## 约定

- stdio 纪律：stdout 只走 MCP 协议，日志一律 `console.error`。
- 工具输出统一为单个 text block，内容是 JSON：成功 `{ ok: true, ... }`，失败 `{ ok: false, error, detail? }` 且 `isError: true`。
- 输入用 Zod inputSchema 声明；`fetch_url` 必须经过 `assertSafePublicHttpUrl`。

## 本地调试

```bash
npm run mcp:nextclaw-bridge
```

应用内启用：`.env` 设 `NEXTCLAW_MCP_ENABLED=true`（入口可用 `NEXTCLAW_MCP_KNOWLEDGE_ENTRY` 覆盖，默认即 bridge）。

在 IDE（Cursor 等）挂接：Command `npx`（Windows 用 `npx.cmd`），Args `tsx mcp-servers/nextclaw-bridge/run.ts`，Cwd 仓库根，Env 与 `.env` 一致。IDE 直连时 `userId` 需手动传参；应用内由 `executeTool` 自动注入。
