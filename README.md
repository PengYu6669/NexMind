# NexMind / NextClaw

一个基于 Next.js 构建的个人 **AI 第二大脑**：把「笔记/知识库」与「自治学习工作流」打通，支持 **RAG 语义检索**、**学习任务（LangGraph 编排）**、**智能复习（SM-2 + AI 评分解析）**与 **知识图谱/工作流可视化（React Flow）**。

---

## 功能模块（按用户路径）

- **笔记与知识库（/notes）**
  - 富文本编辑（Tiptap）、标签、归档/置顶、笔记链接（NoteLink）
  - 笔记图片上传（可选接入火山 TOS；未配置时可降级本地）
- **对话工作台（/dashboard）**
  - 多会话、流式返回（SSE）
  - 可注入笔记上下文与学习卡片上下文继续追问
- **RAG 语义检索（PostgreSQL + pgvector）**
  - 笔记/资料的向量召回（同义/近义/上下文相关）
  - 支持 embedding 可用性自检接口（见 `/api/rag/embedding-test`）
- **NextClaw 自治学习引擎（/nextclaw）**
  - 基于 **LangGraph** 的多节点 DAG（检索 → 决策是否联网 →（可选）搜索/抓取/审计 → 规划 → 执行 → 产卡 → 入库）
  - 步骤级 `steps` 持久化与可视化（中断恢复、失败定位）
  - HITL：无可用来源时可等待用户粘贴 URL 再继续
- **学习中心（/learn）**
  - 聚合入口：**待复习队列** / **今日新卡片** / **进行中任务**
  - 复习主路径：作答 → `AI 评分` → `matched/missing keypoints` 解析 → SM-2 更新 → 自动切下一条
- **学习卡片体系（LearningCard）**
  - 卡片类型：`REVIEW / FILL_GAP / PITFALL / CONFLICT / RELATED / AUDIT / EXTERNAL`
  - Coach 生成阶段对卡片内容做结构化补齐（“怎么做/易错点/自测/答案要点”等）
- **知识图谱（/graph）**
  - React Flow 工作流视图（Input/Agent/Output 分层）
  - 边语义：`LINK / DERIVED_FROM / CONFLICT_HINT / PRODUCES`
  - 默认弱化执行记录（job 节点可切换显示，避免与实时工作流重复）
- **Skills（运行时技能函数）**
  - 贴合 NextClaw 工作流：来源可信度评估、冲突/补位审计兜底、自测题补齐、卡片质量守门（详见 `docs/nextclaw-skills.md`）
- **MCP 工具服务层（可选）**
  - `mcp-servers/` 内提供 knowledge/web-reader/auditor/search/bridge 等工具入口
  - `NEXTCLAW_MCP_ENABLED=true` 时工作流工具调用优先走 MCP；失败自动回退

---

## 路由一览

- `/`：落地页
- `/dashboard`：工作台（对话为主）
- `/notes`、`/notes/[id]`、`/notes/new`：知识库与编辑
- `/search`：语义搜索
- `/nextclaw`：NextClaw 自治学习引擎与任务台
- `/learn`：学习中心（复习队列与 AI 评分解析）
- `/graph`：知识图谱 / 工作流视图
- `/settings`：设置

---

## 技术栈

- **Web**：Next.js 16（App Router）、React 19、TypeScript、Tailwind CSS
- **编辑器**：Tiptap
- **数据层**：PostgreSQL、Prisma
- **向量检索**：pgvector
- **Agent / 编排**：LangChain、LangGraph（checkpoint 可选 Postgres）
- **可视化**：React Flow
- **工具协议（可选）**：MCP（stdio）

---

## 快速开始（本地）

### 0) 前置要求

- Node.js 20+
- PostgreSQL 14+（建议 15+）
- 数据库启用 `pgvector` 扩展：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

### 1) 安装依赖

```bash
npm install
```

### 2) 配置环境变量

项目提供 `.env.example`（直接复制即可）：

```bash
cp .env.example .env
```

至少需要填写：

- `DATABASE_URL`
- `AI_API_KEY`、`AI_API_BASE_URL`（兼容 OpenAI 协议的 Chat/Embeddings 服务）

### 3) 初始化数据库

```bash
npm run db:generate
npm run db:migrate
```

### 4) 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000`。

---

## 需要申请哪些 API Key / 服务？

下面按“可跑最小集”与“增强能力”分层列出。

### 必需（建议）

#### 1) LLM / Embeddings（兼容 OpenAI 协议）

用于 Chat、RAG embedding、学习任务生成与复习评分：

- `AI_API_KEY`
- `AI_API_BASE_URL`
- `AI_MODEL_CHAT` / `AI_MODEL_WRITER` / `AI_MODEL_EMBEDDING` 等（见 `.env.example`）

> 项目默认示例填的是火山方舟 Doubao 的 BaseURL；你也可以替换为任意兼容 OpenAI API 的提供方。

#### 2) PostgreSQL + pgvector

- `DATABASE_URL`

### 可选增强

#### 3) SerpAPI（联网搜索）

用于 `mcp-servers/nextclaw-search` 或 `nextclaw-bridge`：

- `SERPAPI_API_KEY`
- `NEXTCLAW_SERPAPI_ENGINE`（可选；默认 `baidu`）

#### 4) MCP（工具接入）

启用 MCP 后，NextClaw 工作流在工具调用上会优先走 stdio MCP：

- `NEXTCLAW_MCP_ENABLED=true|false`
- `NEXTCLAW_MCP_KNOWLEDGE_ENTRY`（可选，默认可指向 `mcp-servers/nextclaw-bridge/run.ts`）
- `NEXTCLAW_MCP_WEB_READER_ENTRY` / `NEXTCLAW_MCP_AUDITOR_ENTRY`（可选）

你也可以单独启动 MCP：

```bash
npm run mcp:nextclaw-bridge
# 或
npm run mcp:nextclaw-knowledge
npm run mcp:nextclaw-web-reader
npm run mcp:nextclaw-knowledge-auditor
npm run mcp:nextclaw-search
```

#### 5) 火山 TOS（图片/附件存储）

用于图片上传、附件存储等（未配置时部分功能会降级）：

- `VOLC_TOS_REGION`
- `VOLC_TOS_BUCKET`
- `VOLC_TOS_ACCESS_KEY`
- `VOLC_TOS_SECRET_KEY`
- `VOLC_TOS_ENDPOINT`
- `VOLC_TOS_PREFIX`（可选）
- `VOLC_TOS_PUBLIC_BASE_URL`（可选，绑定 CDN/自定义域名时更友好）

#### 6) 百度 OCR（可选）

用于图片文字识别能力（至少配置一种鉴权方式）：

- `BAIDU_OCR_ACCESS_TOKEN` **或**
- `BAIDU_OCR_API_KEY` + `BAIDU_OCR_SECRET_KEY` **或**
- `BAIDU_OCR_BEARER_TOKEN`

#### 7) 内部任务触发（可选）

若你通过内部路由触发 batch runner：

- `INTERNAL_CRON_TOKEN`

---

## 常用脚本

```bash
npm run dev
npm run build
npm run start
npm run lint

npm run db:generate
npm run db:migrate
npm run db:studio

# MCP（可选）
npm run mcp:nextclaw-bridge
```

---

## License

本仓库未内置 License 文件；如需开源发布建议补充（MIT / Apache-2.0）。
