# NextClaw（ima-claw）

基于 Next.js 构建的个人 **AI 第二大脑**：把「笔记 / 知识库」和「AI 交互」打通，让你用自然语言完成收藏、检索与内容生产。

> 项目目标：对标腾讯 IMA 等知识助手产品，但更偏向“个人知识资产”的沉淀与复用。

## 项目核心模块

- **Capture 收藏入口**：把链接/文本快速入库，作为后续检索与生成的原始素材。
- **AI 工作台（RAG 对话）**：支持多会话、流式输出、知识库限定检索，并可将对话结果保存为笔记。
- **笔记系统**：包含笔记列表、详情、富文本编辑（Tiptap）、标签与自动保存，承载长期知识沉淀。
- **语义检索引擎**：基于 PostgreSQL + pgvector 的向量检索，为“有据回答”提供上下文召回能力。
- **NextClaw 助手**：通过低学习成本的预设任务（复习/拓展/自测/草稿）降低使用门槛，结果可回流到知识库。
- **知识图谱**：基于笔记间引用关系构建可视化图谱，辅助发现主题连接与知识盲区。

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
