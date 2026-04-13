# NextClaw → LangGraph 多节点编排重构任务清单（把它做成“真正的 Agent”）

**更新日期**：2026/04/13  
**目标**：将 NextClaw 从「单 Runner 串行多角色」升级为「LangGraph 状态机 + 多节点编排 + checkpoint 可恢复 + 可视化工作流」，让用户能清晰看到 Agent 在做什么、为什么这么做、做到哪一步、可否介入与恢复。

---

## 0. 依赖与环境准备（需要你帮忙安装的话就做这一步）

### 0.1 必装依赖
- **LangGraph.js**：图编排/路由/并行/人类介入（HITL）基础能力
- **Checkpoint**：断点恢复与“线程级记忆”

建议安装命令（npm）：

```bash
npm i @langchain/langgraph @langchain/langgraph-checkpoint
```

### 0.2（可选）生产级 checkpoint 后端
如果我们希望 checkpoint 真正落到数据库（而不是内存），再加：

```bash
npm i @langchain/langgraph-checkpoint-postgres
```

（未来若要用 Redis，换成 `@langchain/langgraph-checkpoint-redis` 即可。）

### 0.3 Next.js serverExternalPackages（可能需要）
当前 `next.config.ts` 只有 `@modelcontextprotocol/sdk`。如果 LangGraph/Checkpoint 在 server runtime 打包有问题，再把以下包加入白名单：
- `@langchain/langgraph`
- `@langchain/langgraph-checkpoint`
- `@langchain/langgraph-checkpoint-postgres`（若用）

---

## 1. 设计目标与“非目标”（避免堆功能）

### 1.1 设计目标（必须达成）
- **可观测**：每个 Node 都产出用户可读的进度事件（开始/结束/失败/降级），并形成可回放的执行轨迹。
- **可恢复**：任务可暂停/继续；失败后可从 checkpoint 恢复；支持“从失败节点重试”。
- **可解释**：Agent 的关键决策点（例如“是否需要联网搜索”“为何选这个来源”）必须以清晰文本展示。
- **可扩展**：新增角色/工具时，只需增加 Node/Edge，不要改 Runner 主流程。

### 1.2 非目标（先不做）
- 不做“多进程微服务化”作为第一阶段目标（LangGraph 先把执行模型升级到位）。
- 不追求一次性最强并行（先把图与 checkpoint 跑通，再做并行优化）。

---

## 2. 后端重构（LangGraph Core）

> 总原则：**把现在 `learning-jobs-runner.ts` 的脚本式流程，迁移为 Graph**；状态从“函数局部变量”迁移到统一 State；把工具调用与重试/降级策略做成可复用的节点/包装器。

### 2.1 统一 State Schema（M0）
- **任务基础字段**：`jobId/userId/noteId/jobType`
- **输入正文**：`noteTitle/noteHtml/noteText`
- **检索上下文**：`relatedNotes/relatedLines/kbDigest`
- **外部来源**：`webSearchResults/fetchedMarkdown/auditResult`
- **计划与执行**：`plan`（steps[]）、`toolTraceLines`
- **策略与度量**：`metrics/roleStats/degraded/needHumanIntervention`
- **可观测事件**：`steps: LearningJobStepRecord[]`（可保留旧结构，或升级为“node events + step view model”）

**验收**：
- 能把现有 Runner 的所有关键中间态塞进 State，不再依赖函数局部变量传递。

### 2.2 Node 划分（M0）
建议最小节点集合（先对齐当前实现）：
- **RetrieveRagNode**：RAG 检索 + 去重扩容策略 + 生成 `kbDigest`
- **PlannerNode**：生成/复用 plan
- **AutonomousLoopSubgraph**（可选子图）：Reason → WebSearch → Filter → FetchUrl → Audit（支持 0..N 轮）
- **PlanExecutorNode**：执行 `plan.steps` 的工具链
- **CoachNode**：生成 cards（`generateNextClawAutoLearnLite`）
- **SchedulerNode**：写 reviewItem（后续增强到 SM2+周目标联动）
- **PersistNode**：写入 cards / job status / evaluation

**验收**：
- 每个节点可独立单测（输入 State，输出 patch/partial state）。
- 失败时能定位到具体 node。

### 2.3 工具调用包装器（M0）
把以下逻辑从 Runner 中抽出来复用：
- `policyOf(role)` + `shouldRetryTool()` + `markToolFailureEffect()`
- `executeTool(toolName, ctx)`
- `flushSteps()`（或 event sink）

目标：提供 `runToolWithPolicy({ role, toolName, args, onAttemptEvent })`，让所有节点统一获得：
- **重试次数统计**
- **降级标记**
- **一步一步写入可观测事件**

**验收**：
- 任何 tool 的失败都能给到用户“可读的失败摘要 + 是否降级 + 下一步怎么做”。

### 2.4 Checkpoint 与恢复（M1）
分两阶段做：
- **M1a（短期）**：先用 `MemorySaver`（仅用于验证 HITL/恢复流程正确）
- **M1b（中期）**：切换到 `PostgresSaver`（与 Prisma/PG 统一），将 thread_id 绑定到 jobId

并对齐你现有 API 行为：
- pause：任务进入“可恢复”状态（不丢 state）
- resume：继续同一个 thread/job 的执行（不要必须创建新 job）
- retry_from_node：指定 node/edge 回退重试（替代 `__resume.completedStepIds` 的 hack）

**验收**：
- 任务跑到一半 pause，再 resume，能从最近 checkpoint 继续。
- 失败后 retry_from_node 可从失败节点重跑，不必从头。

### 2.5 并行（M2）
在图稳定后再开并行：
- WebSearch 并行多个 query 或多个搜索策略
- FetchUrl 并行抓取多个候选来源（设上限与预算）
- Auditor 并行对多来源做对账，再汇总

**验收**：
- 并行带来的成本上升可控（有预算/上限），成功率或信息质量显著提升。

---

## 3. 前端升级（让用户“看懂 Agent 在干嘛”）

> 你说前端大改可以，那我们就把体验拉到“像一个真正的 agent 控制台”，不是简单的 steps 列表。

### 3.1 工作流可视化（M0）
用 `reactflow`（项目已依赖）做一个 **Graph 视图**：
- 节点：Planner/Retriever/Auditor/Coach/Scheduler + Tool nodes（web_search/fetch_url/audit_content…）
- 边：状态流转与条件路由（needSearch? / degrade? / retry?）
- 节点状态：idle/running/done/failed/degraded（颜色 + icon）
- 点击节点：右侧展示该节点的“输入摘要 / 输出摘要 / 证据链接 / 调用次数 / 重试”

**验收**：
- 用户能在 10 秒内回答：“现在卡在哪里？”“下一步会做什么？”“为什么要联网？”

### 3.2 事件流与时间线（M0）
把后端的 node events 显示为“时间线”：
- 每条事件包含：node、阶段（think/tool）、摘要、耗时、可展开详情（tool args 摘要、截断后的返回）

**验收**：
- 不看代码也能追踪执行过程；失败原因可读、可定位。

### 3.3 HITL：人工介入点（M1）
在图的关键路由点加“可介入”能力：
- 选择来源（Filter node）：用户可 override 选中的 URL
- 审计冲突（Audit node）：用户可标记“接受/忽略/补充笔记”
- 生成卡片（Coach node）：用户可要求“更短/更难/更多例子/更偏面试”

**验收**：
- 用户介入后，图继续跑；介入内容进入 checkpoint，后续回放可见。

### 3.4 实时性（M1）
从轮询升级为：
- **SSE 优先**（实现简单、符合 Next.js server）
- 或 WebSocket（如果后续要强实时与多事件通道）

**验收**：
- 节点状态切换延迟 < 1s（体感）。

---

## 4. 数据/接口改造（支撑 Graph UI）

### 4.1 事件存储模型（M0）
两种路线选一条（建议先 A 后 B）：
- **A. 兼容旧结构**：继续写 `learningJob.steps: LearningJobStepRecord[]`，但把 `id/label/toolName` 规范化成“node/event”风格
- **B. 新增 events 表**：`LearningJobEvent(jobId, seq, node, type, payload, ts)`，前端按事件流渲染；steps 仅做摘要

**验收**：
- UI 能稳定渲染，不依赖“猜 label”判断角色（减少脆弱性）。

### 4.2 API（M0）
- `GET /api/nextclaw/tasks/:jobId/events`（若走 events 表）
- `POST /api/nextclaw/tasks/:jobId/control`：pause/resume/retry_from_node/override_input
- `GET /api/nextclaw/graph/:jobId`：返回节点状态与边（用于 ReactFlow）

**验收**：
- 前端不再需要从 steps 里做复杂推断。

---

## 5. 迁移策略（避免一次性推倒重来）

### 5.1 PoC（1-2 天）
- 只迁 `RetrieveRagNode → PlannerNode → CoachNode → PersistNode`
- 用 `MemorySaver` checkpoint
- UI 先用“时间线 + 简版 Graph”

### 5.2 全量迁移（3-7 天）
- 把 AutonomousLoop + PlanExecutor 全迁进图
- resume/retry 改造成“基于 checkpoint 的同 job 恢复”

### 5.3 体验打磨（持续迭代）
- 并行、预算、HITL、来源证据、失败自愈策略

---

## 6. 最终验收标准（我们要的“提升”）

- **Agent 感**：用户明确感知“它在计划→检索→审计→生成→调度”，不是黑盒跑完。
- **稳定性**：失败可恢复；可从失败节点重试；长期任务可暂停继续。
- **效率**：工具重试/降级策略清晰，不会“堆功能式”盲目调用工具。
- **可迭代**：新增 Node/策略是增量改动，不需要改 Runner 主流程。

