# NextClaw 模块进度报告

**文档版本**: V1.0
**更新日期**: 2026/04/13
**对应 PRD**: [NextClaw.prd](../NextClaw.prd)

---

## 1. 当前实现概览

### 1.1 核心文件架构

| 文件 | 职责 | 状态 |
|------|------|------|
| [lib/learning-jobs-runner.ts](../lib/learning-jobs-runner.ts) | 核心任务执行器，编排所有 Agent 角色 | ✅ 已实现 |
| [lib/nextclaw-multi-agent.ts](../lib/nextclaw-multi-agent.ts) | 5个 Agent 角色定义与契约 | ✅ 已实现 |
| [lib/nextclaw-orchestrator-policy.ts](../lib/nextclaw-orchestrator-policy.ts) | 编排策略表（重试/降级/启用） | ✅ 已实现 |
| [lib/nextclaw-workflow-policy.ts](../lib/nextclaw-workflow-policy.ts) | 执行度量与重试判断逻辑 | ✅ 已实现 |
| [lib/nextclaw-agent-tools.ts](../lib/nextclaw-agent-tools.ts) | MCP 工具调用封装 | ✅ 已实现 |
| [lib/nextclaw-autonomous-loop.ts](../lib/nextclaw-autonomous-loop.ts) | 自主决策（是否搜索、来源筛选） | ✅ 已实现 |
| [lib/nextclaw-agent-config.ts](../lib/nextclaw-agent-config.ts) | 可调参数（RAG topK、重试次数等） | ✅ 已实现 |
| [components/nextclaw/AgentOpsPanel.tsx](../components/nextclaw/AgentOpsPanel.tsx) | Agent 列表监控面板 | ✅ 已实现 |
| [components/nextclaw/NextClawTaskDesk.tsx](../components/nextclaw/NextClawTaskDesk.tsx) | 任务工作台（创建/控制/查看） | ✅ 已实现 |
| [app/api/nextclaw/tasks/[jobId]/route.ts](../app/api/nextclaw/tasks/[jobId]/route.ts) | 任务控制 API（中断/继续/删除） | ✅ 已实现 |

### 1.2 Agent 角色实现

当前已定义 5 个 Agent 角色，符合 PRD 第 5 节设计：

| 角色 | 职责 | 实现方式 | 真正独立执行 |
|------|------|----------|--------------|
| **Planner** | 生成执行计划（JSON steps） | `generateLearningPlan()` | ❌ 同进程调用 |
| **Retriever** | 本地优先检索，必要时外部检索 | `decideNeedWebSearch()` + `pickBestSource()` | ❌ 同进程调用 |
| **Auditor** | 一致性/冲突/补位审计 | `summarizeAuditCounts()` | ❌ 同进程调用 |
| **Coach** | 生成学习卡片与讲解内容 | `generateNextClawAutoLearnLite()` | ❌ 同进程调用 |
| **Scheduler** | 生成与调整复习计划（SM2 + 规则） | `nextDueDate()` | ❌ 同进程调用 |

**关键结论**: 当前是"**单 Runner + 多角色职责分层**"，所有 Agent 仍在同一进程内串行执行，并非真正的多 Agent 协作。

---

## 2. PRD 里程碑进度

### 2.1 P0（立即）—— ✅ 100% 已完成

| 功能 | 状态 | 实现位置 |
|------|------|----------|
| 规则化重试/降级策略接入 Runner | ✅ | `nextclaw-workflow-policy.ts:shouldRetryTool()` |
| 任务评估日志标准化 | ✅ | `learning-jobs-runner.ts:733-741` (evaluation 步骤) |
| 任务失败可恢复（重试/继续执行） | ✅ | `app/api/nextclaw/tasks/[jobId]/route.ts:52-99` (resume action) |
| 断点恢复基础能力 | ✅ | `learning-jobs-runner.ts:73-86` (__resume meta 解析) |
| 轻量多智能体契约 | ✅ | `nextclaw-multi-agent.ts` (5角色定义) |
| 多 Agent MVP 编排落地 | ✅ | `learning-jobs-runner.ts:724-730` (orchestrator-mvp 步骤) |

### 2.2 P1（短期）—— 🔄 30% 已完成

| 功能 | 状态 | 说明 |
|------|------|------|
| 多智能体协作 MVP | ✅ 部分 | 已有角色契约，但仍是串行编排，未真正并行协作 |
| Scheduler 强化 | ❌ 未开始 | 复习队列与周目标联动尚未实现 |
| 多角色提示词分层与质量评估 | ❌ 未开始 | 当前各角色共用相同模型，缺少角色级质量指标 |

### 2.3 P2（中期）—— ❌ 0% 未开始

| 功能 | 状态 | 说明 |
|------|------|------|
| 多 Agent 进程化拆分 | ❌ | 核心升级目标 |
| 策略自动调参 | ❌ | 需历史效果数据支撑 |
| 个性化学习路径推荐 | ❌ | 依赖 Scheduler 强化完成 |
| 可视化增强项 | ❌ | 评估看板已迁出至学习计划模块 |

---

## 3. 升级为真正 Agent 的路径

### 3.1 当前痛点

1. **串行执行瓶颈**: 所有 Agent 在同一 Runner 内串行调用，无法并行处理
2. **无独立状态**: Agent 间无法持久化自己的状态，依赖父 Runner 传递
3. **无跨进程通信**: 缺少消息队列，无法实现真正的异步协作
4. **扩展性受限**: 新增 Agent 需改动 Runner 主流程，耦合度高

### 3.2 升级方案（PRD P2 目标）

#### 方案 A: LangGraph 多节点编排（推荐）

```
┌─────────────────────────────────────────────────────────────┐
│                     Orchestrator (主调度)                    │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │
│  │ Planner │→ │Retriever│→ │ Auditor │→ │  Coach  │        │
│  │  Node   │  │  Node   │  │  Node   │  │  Node   │        │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │
│       ↓            ↓            ↓            ↓              │
│  ┌─────────────────────────────────────────────────┐       │
│  │              Scheduler Node (复习调度)          │       │
│  └─────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────┘
```

**实现要点**:
- 每个角色作为 LangGraph 的独立 Node
- Node 间通过 State Channel 传递数据
- 支持并行分支（Retriever 可同时调用多个 MCP 工具）
- 内置 Checkpoint 实现断点恢复

#### 方案 B: 消息队列 + 微服务（重度拆分）

```
┌──────────┐    ┌──────────┐    ┌──────────┐
│ Planner  │    │Retriever │    │ Auditor  │
│ Service  │    │ Service  │    │ Service  │
└────┬─────┘    └────┬─────┘    └────┬─────┘
     │               │               │
     └───────────────┼───────────────┘
                     │
              ┌──────┴──────┐
              │  Redis MQ   │
              │  (事件总线) │
              └──────┬──────┘
                     │
              ┌──────┴──────┐
              │ Orchestrator│
              │  (调度中心) │
              └─────────────┘
```

**实现要点**:
- 每个 Agent 作为独立微服务进程
- Redis/RabbitMQ 作为消息总线
- Orchestrator 监听事件并调度下一步
- 支持横向扩展和故障隔离

### 3.3 推荐升级步骤（优先级排序）

| 步骤 | 任务 | 依赖 | 预估工作量 |
|------|------|------|------------|
| 1 | 引入 LangGraph 依赖 | 无 | 0.5 天 |
| 2 | 将 Planner/Retriever/Auditor/Coach/Scheduler 拆为 Graph Node | 步骤1 | 2 天 |
| 3 | 定义 State Schema 与 Node 间数据流 | 步骤2 | 1 天 |
| 4 | 实现并行分支（Retriever 同时检索多来源） | 步骤3 | 1 天 |
| 5 | 接入 LangGraph Checkpointer 实现断点恢复 | 步骤4 | 0.5 天 |
| 6 | 移除 `learning-jobs-runner.ts` 中的串行编排逻辑 | 步骤5 | 1 天 |
| 7 | 前端 AgentOpsPanel 改为实时订阅 Node 状态 | 步骤6 | 1 天 |

**总计预估**: 5-7 天（LangGraph 方案）

---

## 4. 当前可观测性

### 4.1 Agent 列表监控（AgentOpsPanel）

- ✅ 展示每个 Agent 角色的执行状态（idle/running/done/failed）
- ✅ 展示任务进度条与当前步骤
- ✅ 展示队列中待执行任务数

### 4.2 任务工作台（NextClawTaskDesk）

- ✅ 创建任务（链接提取 / 全库学习）
- ✅ 选择轻量/深度模式
- ✅ 查看任务步骤详情（含 toolSummary）
- ✅ 中断/继续执行/删除任务
- ✅ 断点恢复展示

### 4.3 评估指标（per task）

每个任务已记录以下评估摘要（写入 steps）：

```typescript
{
  toolCalls: number;      // 工具调用次数
  retries: number;        // 重试次数
  degraded: boolean;      // 是否发生降级
  needHumanIntervention: boolean; // 是否需要人工介入
  durationMs: number;     // 执行耗时
}
```

---

## 5. 下一步行动建议

### 5.1 立即可做（本周）

1. **验证 LangGraph 可行性**: 创建 PoC 分支，将 Planner Node 先拆出测试
2. **完善 Scheduler**: 实现 SM2 复习调度与周目标联动（PRD P1）
3. **添加角色级质量评估**: 统计各 Agent 的成功率/耗时分布

### 5.2 短期规划（2-4 周）

1. **完成 LangGraph 迁移**: 将所有 Agent 角色转为 Graph Node
2. **实现并行检索**: Retriever 可同时调用本地 RAG + 外部搜索
3. **优化前端实时性**: 改用 SSE/WebSocket 推送 Node 状态变化

### 5.3 中期规划（4-8 周）

1. **策略自动调参**: 基于历史评估数据优化 maxRetries/topK 等
2. **个性化学习路径**: 结合用户偏好调整 Planner 生成策略
3. **评估看板集成**: 将任务评估数据接入学习计划模块

---

## 6. 风险与边界

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LangGraph 学习成本 | 迁移延期 | 先做 PoC 验证，逐步迁移 |
| 并行执行成本上升 | 耗时增加 | 用成功率抵消，保证可恢复性 |
| MCP 工具稳定性 | 外部检索失败 | 已有重试/降级策略，可继续优化 |
| 前端实时性要求高 | 状态同步复杂 | 可先用轮询，后续升级为 WebSocket |

---

## 7. 附录：核心代码位置索引

| 功能 | 代码位置 |
|------|----------|
| 任务执行主流程 | [learning-jobs-runner.ts:152-780](../lib/learning-jobs-runner.ts#L152-L780) |
| Agent 角色定义 | [nextclaw-multi-agent.ts:40-89](../lib/nextclaw-multi-agent.ts#L40-L89) |
| 编排策略表 | [nextclaw-orchestrator-policy.ts:14-20](../lib/nextclaw-orchestrator-policy.ts#L14-L20) |
| 重试判断逻辑 | [nextclaw-workflow-policy.ts:23-32](../lib/nextclaw-workflow-policy.ts#L23-L32) |
| 断点恢复解析 | [learning-jobs-runner.ts:73-86](../lib/learning-jobs-runner.ts#L73-L86) |
| 任务控制 API | [app/api/nextclaw/tasks/[jobId]/route.ts](../app/api/nextclaw/tasks/[jobId]/route.ts) |
| Agent 监控面板 | [AgentOpsPanel.tsx](../components/nextclaw/AgentOpsPanel.tsx) |
| 自主决策（搜索判断） | [nextclaw-autonomous-loop.ts:69-111](../lib/nextclaw-autonomous-loop.ts#L69-L111) |
| 来源筛选 | [nextclaw-autonomous-loop.ts:113-171](../lib/nextclaw-autonomous-loop.ts#L113-L171) |

---

**文档维护者**: Claude Code
**下次更新**: 完成 LangGraph PoC 后