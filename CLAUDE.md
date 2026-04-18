# CLAUDE.md（给 Claude / AI Coding Agent 的项目说明）

这份文件的目标是：让 AI 在**不熟悉仓库**的情况下，也能快速进入状态、按项目约束修改代码，并避免“看起来能跑、实际上破坏架构/数据”的改动。

> 适用对象：Claude、Cursor Agent、以及任何会自动读取仓库根目录说明文件的 AI 工具。

---

## 项目一句话

**NexMind / NextClaw**：个人知识库 + 自治学习引擎。核心能力包括：

- RAG：PostgreSQL + pgvector 的语义检索
- Agent 工作流：LangGraph 编排的多节点学习任务（可中断恢复、步骤级追踪）
- 学习中心：SM-2 调度 + AI 评分解析的复习闭环
- 可视化：React Flow 知识图谱 / 工作流视图
- 可选 MCP：stdio 工具层（knowledge/web-reader/auditor/search/bridge）

---

## 你在这个仓库里应该从哪里开始读

优先入口（按“跑起来/改功能/改工作流”的顺序）：

- `README.md`：功能模块、快速开始、环境变量与可选外部服务
- `prisma/schema.prisma`：数据模型（LearningJob/LearningCard/ReviewItem/Note 等）
- NextClaw 工作流与工具：
  - `lib/nextclaw-langgraph.ts`：LangGraph DAG、steps 追踪与持久化策略
  - `lib/nextclaw-agent-tools.ts`：工作流工具执行（MCP 优先、失败回退）
  - `lib/nextclaw-skills/*` 与 `docs/nextclaw-skills.md`：运行时 skills（本地可测的补齐/审计/质量守门）
- RAG：
  - `lib/rag.ts`：embedding/向量检索与召回策略
- 学习中心：
  - `app/api/learn/dashboard/route.ts`：学习看板聚合接口
  - `components/learn/LearnPageClient.tsx`：/learn 三栏 UI 与 AI 评分交互

---

## 常用命令（不要瞎猜脚本名）

你可以假设以下脚本存在并优先使用：

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run db:generate`
- `npm run db:migrate`
- `npm run db:studio`

如需新增脚本，必须同时更新 `README.md` 的“常用脚本”。

---

## 环境变量与外部依赖（写代码时要遵守）

最小可用：

- `DATABASE_URL`
- `AI_API_KEY`、`AI_API_BASE_URL`（兼容 OpenAI API）
- `AI_MODEL_CHAT` / `AI_MODEL_WRITER` / `AI_MODEL_EMBEDDING`（见 `.env.example`）

可选增强：

- `SERPAPI_API_KEY`（联网搜索）
- `NEXTCLAW_MCP_ENABLED`、`NEXTCLAW_MCP_KNOWLEDGE_ENTRY` 等（MCP 工具层）
- `VOLC_TOS_*`（图片/附件存储）
- `BAIDU_OCR_*`（OCR）

约束：

- 不要把密钥写进代码/README。只写变量名与获取方式。
- `.env.example` 是“唯一真实来源”，新增环境变量时必须同步更新它。

---

## AI 作为开发者：必须遵守的改动准则

- **优先保持数据契约稳定**：API route 的 response shape 改动需要同步更新前端类型与调用处。
- **涉及 Prisma 必须出迁移**：修改 `schema.prisma` 后要生成 migration（不要只改 schema）。
- **NextClaw steps 必须可回放**：`steps` 用于 UI 展示/恢复/诊断，避免写入不可序列化对象。
- **MCP 是可选能力**：工具调用必须有降级路径；不能假设 MCP 一定可用。
- **不要为了“好看”引入新框架**：除非明确需求，优先复用现有 Tailwind/组件结构。

---

## 变更说明写法（给 AI 的提交说明模板）

当你做改动时，请在 PR/提交说明里包含：

- 改动目的（为什么）
- 影响面（哪些页面/API/模型）
- 回滚/降级策略（尤其是 MCP/外部服务）
- 最小手动验证步骤（例如：打开 `/learn` → 提交评分 → 队列切换）
