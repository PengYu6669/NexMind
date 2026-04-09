# NextClaw

基于 Next.js 构建的个人 **AI 第二大脑**：把「笔记 / 知识库」和「AI 交互」打通，让你用自然语言完成收藏、检索与内容生产。

## 项目核心模块

- **Capture 收藏入口**：负责接收链接或文本输入，完成基础清洗与入库，沉淀为后续检索、问答与内容生成可复用的知识源。
- **知识库与笔记管理**：提供笔记列表、详情、编辑与组织能力，支持标签、来源、引用关系、自动保存，保证内容可长期维护与迭代。
- **富文本编辑层（Tiptap）**：在笔记编辑场景提供结构化内容编辑能力，便于沉淀摘要、要点、学习卡片、草稿与最终文档。
- **对话工作台（Chat + RAG）**：支持多会话与流式返回，在会话中可选择全库或指定笔记范围做上下文检索，并将结果一键保存为笔记资产。
- **语义检索引擎（PostgreSQL + pgvector）**：对笔记与知识分块进行向量化召回，处理“同义/近义/上下文相关”问题，为回答提供证据片段。
- **NextClaw 智能助手（/nextclaw）**：通过预设任务模板（复习、拓展、自测、草稿）降低操作门槛，把“提问”升级为“可复用的学习流程”。
- **学习任务与卡片体系**：围绕笔记生成学习任务、复习条目与结构化卡片（如 REVIEW/FILL_GAP/RELATED 等），支持持续学习闭环。
- **知识图谱（/graph）**：依据笔记间链接关系构建可视化网络，帮助用户发现主题关联、知识断点与可进一步探索的路径。
- **MCP 工具服务层**：在 `mcp-servers/` 中提供知识库、搜索、Web 阅读与桥接能力，为后续 Agent 化编排与自动化任务提供扩展接口。

## 路由一览（与 PRD 对齐）

- `/`：落地页
- `/dashboard`：工作台（对话为主）
- `/notes`、`/notes/[id]`、`/notes/new`：知识库与编辑
- `/search`：语义搜索
- `/nextclaw`：NextClaw 助手
- `/graph`：知识图谱

## 技术栈

- **Web**：Next.js（App Router）、React、TypeScript、Tailwind CSS
- **富文本**：Tiptap
- **数据层**：PostgreSQL、Prisma
- **向量检索**：pgvector（以及 Node 侧 `pgvector` 依赖）
- **LLM / RAG**：LangChain（支持兼容 OpenAI 接口的模型；也可对接豆包等）
- **MCP**：内置多个 MCP Server（见 `mcp-servers/`）

## 本地开发

### 前置要求

- Node.js（建议 20+）
- PostgreSQL（建议 14+）
- 数据库启用 `pgvector` 扩展

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

本项目通过 Prisma 读取 `DATABASE_URL`（见 `prisma.config.ts`）。

在项目根目录创建 `.env`（已被 `.gitignore` 忽略，不会上传到 GitHub），至少包含：

- `DATABASE_URL=postgresql://USER:PASSWORD@HOST:PORT/DB_NAME`

如果你启用了登录、对象存储、LLM 提供方等能力，还需要补充对应变量（以代码实现为准）。

### 3) 初始化数据库

确保目标库已启用向量扩展（不同托管环境可能需要管理员权限）：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

然后执行 Prisma：

```bash
npm run db:generate
npm run db:migrate
```

### 4) 启动开发服务器

```bash
npm run dev
```

启动后访问 `http://localhost:3000`。

## MCP Servers

项目在 `mcp-servers/` 内提供知识库、Web 阅读、审计、桥接、搜索等工具化服务，作为后续 Agent 能力扩展的基础设施。

## TODO

- [ ] 补充 `LICENSE`（建议 MIT 或 Apache-2.0）
- [ ] 提供 `.env.example`，标注最小必需环境变量
- [ ] 增加系统架构图与数据流说明（Capture -> 索引 -> 检索 -> 生成）
- [ ] 完善 MCP Server 使用文档（启动方式、输入输出、典型场景）
- [ ] 增加核心页面截图或录屏（`/dashboard`、`/nextclaw`、`/graph`）
- [ ] 补充部署文档（本地、云数据库、生产环境注意事项）
- [ ] 建立基础测试（至少覆盖关键 API 与核心交互）

## 贡献指南

欢迎提 Issue / PR：

- 新功能：建议先开 Issue 对齐目标与边界
- Bug：请提供复现步骤、期望行为、实际行为与日志

## License

待补充（例如 MIT / Apache-2.0）。
