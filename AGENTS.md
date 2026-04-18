# AGENTS.md（团队/多 Agent 协作约定）

在 AI 项目里，`AGENTS.md` 通常用来做两件事：

1) **把“怎么干活”写清楚**：不同角色（Planner/Coach/Auditor/Tooling/UI/DB）分工、输入输出约定、常见踩坑与回退策略。  
2) **作为多 Agent 协作的单一事实来源**：当你用 Cursor/Claude/其他 Agent 并行改仓库时，它能降低“每个 Agent 自己发挥导致架构发散”的风险。

> 本仓库的“项目入口说明”放在 `CLAUDE.md`；这里更偏“协作方式/改动约束/验收标准”。

---

## 角色分工（建议）

- **App/UI Agent**
  - 负责页面与组件：`components/**`、`app/**`（除 DB/migration）
  - 目标：UX 清晰、信息分层（先可用，再可展开）
- **Workflow Agent（NextClaw / LangGraph）**
  - 负责：`lib/nextclaw-langgraph.ts`、`lib/nextclaw-*.ts`
  - 目标：steps 可追踪、可恢复、可降级（MCP/联网失败不把任务炸掉）
- **RAG/Data Agent**
  - 负责：`lib/rag.ts`、召回策略、embedding 参数、索引/分块
  - 目标：可解释、可测、避免“无证据胡写”
- **DB Agent（Prisma）**
  - 负责：`prisma/schema.prisma` + migrations
  - 目标：迁移可回滚（至少不破坏已有数据），字段变更同步 API/前端类型
- **Tools Agent（MCP / 搜索 / Web reader）**
  - 负责：`mcp-servers/**`、`lib/nextclaw-mcp-client.ts`
  - 目标：stdio 规范（stdout 不写日志）、错误可诊断（stderr），主应用有回退路径

---

## 产物/契约（必须遵守）

- **API response shape**：改 `app/api/**` 的返回字段时，必须同步更新对应前端的类型/渲染。
- **`steps` 记录**：写入 `steps` 的内容必须是可序列化 JSON，避免塞函数/类实例。
- **可选能力必须可降级**：MCP/联网/对象存储/OCR 任何一个不可用时，主流程应尽量提供可用的回退（并在 UI/steps 里给出提示）。
- **环境变量新增规则**：新增任何 `process.env.*` 必须同步 `.env.example` 与 `README.md`（“需要申请哪些 API Key”那一节）。

---

## 修改流程（给 Agent 的工作方式）

当你要改一个功能，请按这个顺序工作（避免返工）：

1) **先定位入口文件**（见 `CLAUDE.md` 的“从哪里开始读”）
2) **明确“用户可见行为”** 与 **数据契约**（API/DB/steps）
3) **最小改动闭环**：保证功能可用再优化体验
4) **检查 lint**：至少对改动文件跑 lint（或全量 `npm run lint`）

---

## 验收标准（建议写进 PR 描述）

每个 PR 至少包含：

- **Summary**：1-3 条说明“改了什么/为什么”
- **Test plan（手动）**：列出 3-5 步可复现验证（例如 `/learn`：选择复习条目→提交 AI 评分→插入缺失要点→下一条）
- **风险与降级**：外部依赖缺失时的表现（例如 `SERPAPI_API_KEY` 未配置、`NEXTCLAW_MCP_ENABLED=false`）
