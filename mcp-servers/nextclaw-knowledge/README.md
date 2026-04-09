# nextclaw-knowledge（MCP / stdio）

为 NextClaw Agent 提供：

- `nextclaw_read_note`：按 `userId` + `noteId` 读取笔记正文（去 HTML）
- `nextclaw_semantic_search`：在用户笔记向量块上语义检索（`ragSearch`）

## 运行要求

- **当前工作目录**为仓库根目录（与 `lib/`、`prisma/` 同级）
- 根目录 `.env` 已配置 `DATABASE_URL` 及向量/Embedding 相关变量（与主应用一致）

## 本地调试

```bash
npm run mcp:nextclaw-knowledge
```

进程通过 **stdin/stdout** 走 MCP，不要往 stdout 打日志；调试信息请用 `console.error`。

## 在 Cursor 里挂接（可选）

在 Cursor MCP 配置中增加一项，命令与参数示例：

- **Command**: `npx`（Windows 上可写 `npx.cmd`）
- **Args**: `tsx`, `mcp-servers/nextclaw-knowledge/run.ts`
- **Cwd**: 本仓库根目录
- **Env**: 与 `.env` 一致（至少 `DATABASE_URL`）

> 注意：在 IDE 里直连 MCP 时，`userId` 需你手动传入工具参数；NextClaw 应用内则由 `executeTool` 自动注入。

## 应用内启用

在 `.env` 中设置：

```env
NEXTCLAW_MCP_ENABLED=true
```

可选：`NEXTCLAW_MCP_KNOWLEDGE_ENTRY` 覆盖入口脚本路径（默认 `mcp-servers/nextclaw-knowledge/run.ts`）。
