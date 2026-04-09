## NextClaw 自动学习（重新设计稿）

> 一句话定义：NextClaw 不再是“等你来问”的聊天页，而是一个 **主动型知识中枢**：在你记录之后，它会自动理解、串联、补位、捉虫、安排复习，并把结果以卡片/任务流的方式“侵入”到你的知识体系里（可控、可解释、可关闭）。

---

### 0. 设计目标与边界

- **目标**
  - 让用户“记完笔记就算完成”：NextClaw 自动产出可复习、可执行、可避坑的学习产物。
  - 让系统“看起来真的在学习”：不仅总结，还会发现冲突、补齐缺口、追踪版本变化、安排复习节奏。
- **边界（避免变成通知轰炸）**
  - 默认只做 **轻量** 自动学习（低成本、低打扰）。
  - 深度能力（外部注入/大图谱/全库扫描）必须满足：用户显式开启或强信号触发 + 有预算上限。

---

### 1. 用户可见产物（What）

> 自动学习一定要有“可见产物”，否则用户感知不到“它在替我学习”。

- **智能流（Intelligence Feed）**：类似活动流/通知流，但以“学习卡片”呈现，不是纯消息。
  - 例：⚠️ 潜在坑位、✅ 已补齐对比表、📌 建议复习、🧭 学习路线更新
- **知识回声（Echo）**：你在写/看某篇笔记时，提示与历史笔记的强相关点，支持“一键合并/对比/补位”。
- **复习任务（日历/任务墙）**：展示“今天最该复习的 3 个点”，点击直接弹出要点卡片/自测题，而不是让用户重读长文。
  - **UI 形态建议（见 §8）**：优先 **侧边悬浮任务条** 或 **时间轴（Timeline）**，避免占满全屏的“死板整页日历”。
- **记忆快照可视化（轻量脑图）**：某篇笔记触发自动学习后，对应节点亮起并产生连线，让用户看见“串起来了”。
- **思维链透明化（Thought Trace，见 §7.1）**：学习任务进行时，在 NextClaw/笔记侧展示极简步骤文案，让用户感到“真的在动脑”，而非后台静默跑脚本。

---

### 2. 自动学习触发时机（When）

#### 2.1 触发类型

- **即时触发（Real-time，低成本）**
  - 时机：用户保存/自动保存后，笔记进入“稳定期”再触发（防抖）。
  - 用途：做 1～2 个最关键动作（例如：相似笔记检索 + 冲突/补位候选）。
- **批处理触发（Batch，预算控制）**
  - 时机：每日固定时间窗（例如凌晨 2 点）或用户空闲时段。
  - 用途：外部更新注入、全库主题聚合、第二天复习任务生成。

#### 2.2 笔记稳定期（防抖与幂等）

- **稳定期判断（建议默认）**
  - 字数 ≥ 300 或编辑时长 ≥ 2 分钟
  - 最近 30 秒无编辑
- **幂等规则**
  - 同一 `noteId + jobType + noteVersion` 只执行一次
  - 若用户继续编辑产生新版本：旧任务自动取消或降级

#### 2.3 深度触发信号（决定“做多深”）

满足以下任一强信号，可进入深度队列：

- 24 小时内反复打开/反复提问/频繁修改（关注度高）
- 标签命中（todo/问题/计划/踩坑/版本号）
- 用户显式点击「为这篇笔记启动深度自动学习」

---

### 3. 自动学习流水线（How）

> 自动学习不是“一次总结”，而是可拆分、可重试、可缓存的异步流水线。

#### 3.1 三个引擎（保留你的设计，但落到产物）

- **引擎 A：智能遗忘曲线（Smart Ebbinghaus）**
  - 输入：笔记要点 + 自测表现（0-5 掌握分）
  - 输出：下一次复习 `dueDate` 与“今日最需要巩固的 3 个点”
  - 算法建议：`supermemo-2`（先用规则+SM2，后续再用模型校正）
- **引擎 B：捉虫与补位（Claw Agent）**
  - 输入：新笔记向量 + 相似旧笔记 TopK
  - 输出：
    - **冲突卡**：新旧笔记观点/结论矛盾或风险提示
    - **补位卡**：缺失的对比面、缺失的基础概念、缺失的边界条件
- **引擎 C：外部知识注入（External Context Injection）**
  - 输入：技术关键词/版本号/库名（可从笔记中抽取）
  - 输出：
    - **变更卡**：Release Note 摘要 + 影响范围 + 迁移建议
    - **过时预警**：弃用/破坏性变更提示
  - 约束：默认关闭或低频；只对“明确版本号/明确项目名”的笔记触发
  - **精准度强化（见 §7.3）**：外部注入必须经由 **技术栈指纹（Tech Stack Fingerprint）** 过滤，避免把“全网新闻”刷成用户侧噪声

#### 3.2 一次自动学习最小闭环（MVP）

触发一次 `note-learn-lite` 任务，产出最小可见价值：

- 相似笔记 Top3（用于回声）
- 1 张冲突/风险卡（若无则给“暂无冲突”的静默结果，不推送）
- 1 张补位卡（对比/边界/缺口）
- 3～7 条复习要点（用于复习任务）

#### 3.3 深度自动学习闭环（V2）

在 `note-learn-deep` 中补齐：

- 自测题（Q + 答案要点）
- “踩坑清单”（为什么会踩、如何规避、检查清单）
- 复习节奏（根据掌握分动态调整）
- 可一键沉淀为新笔记/追加到原笔记

---

### 4. 数据与接口（落地所需最小结构）

> 这部分写清楚，工程才好拆任务；不需要一次写很细，但要有“最小结构”。

- **学习任务表**：`learning_jobs`
  - 字段建议：`id, userId, noteId, noteVersion, jobType(lite/deep/external), status, priority, budgetTokens, runAt, retries, error`
  - **`plan Json?`**：Runner 在检索后调用 LLM 产出的 **JSON 执行计划**（`steps[]` + 每步建议 `tool`：`search_notes | read_note | synthesize | noop`），用于审计与 UI「展开计划」。
  - **思维链步骤（Thought Trace）**：`steps Json?` —— 由 worker **逐步写入** `LearningJobStepRecord[]`（`phase/status/label/toolSummary`），与 §7.1 对齐；任务台默认展示当前进度与一步说明，展开可看全链路。
- **学习卡片表**：`learning_cards`
  - 字段建议：`id, userId, noteId, type(pitfall/conflict/fill-gap/review/external), title, contentMd, sources[], createdAt`
- **复习任务表**：`review_items`
  - 字段建议：`id, userId, noteId, dueDate, easeFactor, intervalDays, lastScore(0-5)`
- **贡献与用户成长（可选表或并入 `UserSettings` / 独立 `user_learning_stats`）**：见 §7.2

---

### 4.1 自治 Agent 执行模型（工程落地：五项）

> 目标：把「自动学习 worker」升级为 **可规划、可观测、可接工具** 的自治链路；与 §3 引擎产物兼容，不替代业务规则（幂等、预算、降噪）。

1. **Plan-Based 执行（Runner）**  
   - 任务进入 `RUNNING` 后：先完成 **RAG 检索** → 调用 LLM 输出 **严格 JSON Plan**（`generateLearningPlan`）→ 将 `plan` 写入 `learning_jobs.plan`。  
   - 按计划逐步执行；最终 **统一调用** `generateNextClawAutoLearnLite` 生成学习卡片（避免在 Plan 循环内重复生成）。

2. **任务状态机（`learning_jobs.steps`）**  
   - 每步具备：`id / phase / label / status / toolName? / toolSummary? / at`。  
   - `phase` 建议取值：`think`（规划/推理）、`tool`（检索/读笔记）、`done`（落库完成）。  
   - API（如 `GET /api/nextclaw/tasks`）聚合为 `ui: { headline, progress, currentStepLabel, steps }`，供任务台 **进度条 + 当前一步 + 展开全链路**。

3. **MCP 工具钩子（`executeTool`）**  
   - 统一入口：`lib/nextclaw-agent-tools.ts` 的 `executeTool(tool, ctx)`。  
   - 现阶段为 **Mock**（`search_notes` / `read_note` / `synthesize` / `noop`），返回可写入 `steps` 与 Prompt 的 **摘要字符串**；后续可替换为真实 MCP 或本地沙箱，不改 Plan 与 `steps` 契约。

4. **记忆上下文注入（参考书）**  
   - `lib/nextclaw-kb-digest.ts` 将 RAG 命中笔记压平为 **「知识库参考书摘要」** 文本块。  
   - 注入点：`generateNextClawAutoLearnLite` 的 **system 侧**（与 `toolTrace` 并列），保证每张卡片生成时都能利用 **Top-K 相关笔记摘要**，并保留 **工具执行摘要** 便于溯源。

5. **UI 信息架构（任务台）**  
   - **默认**：一行状态（`ui.headline`）+ **当前步说明**（`ui.currentStepLabel`）+ **分段进度条**（`ui.progress`）。  
   - **展开**：展示 `ui.steps` 全量步骤及 `toolSummary`（与 §7.1「默认折叠、展开看链路」一致）。

#### 4.2 实施进度（自治 Agent 主线）

| 能力 | 状态 | 说明 |
|------|------|------|
| Plan-Based Runner | **已完成** | `generateLearningPlan` → `learning_jobs.plan`；逐步 `executeTool` → 统一 `generateNextClawAutoLearnLite` |
| `steps` 持久化 + 任务台 UI | **已完成** | `GET /api/nextclaw/tasks` 含 `ui`；工作台进度条 / 展开步骤 |
| 参考书 + `toolTrace` 注入 | **已完成** | `buildKbDigestFromRelated` + 工具摘要进 system |
| `executeTool` Mock | **已完成** | `lib/nextclaw-agent-tools.ts`；后续替换为 MCP 即可 |
| RAG 深度差异 | **已完成** | `NOTE_LEARN_DEEP`：`RAG_TOPK_DEEP` + `mode:"deep"` 卡片规则 |
| Plan 步数上限 | **已完成** | `NEXTCLAW_MAX_PLAN_STEPS`（默认 10） |
| 智能流「Agent 执行中」条 | **已完成** | `GET /api/nextclaw/feed` → `activeJobs`；`IntelligenceFeed` 顶部条带 |
| API 兼容未迁移库 | **已完成** | `findLearningJobsForTaskDesk` 降级查询，避免缺列 500 |
| 同仓 MCP（stdio）读笔记 + 语义搜索 | **已完成** | `mcp-servers/nextclaw-knowledge/run.ts`；`NEXTCLAW_MCP_ENABLED=true` 时 `executeTool` 优先走 MCP，失败回退进程内逻辑 |
| 同仓 MCP：Web Reader（抓网页→Markdown） | **已完成** | `mcp-servers/nextclaw-web-reader/run.ts`（工具 `fetch_url`，基于 `r.jina.ai`） |
| 同仓 MCP：Knowledge Auditor（内容审计） | **已完成** | `mcp-servers/nextclaw-knowledge-auditor/run.ts`（工具 `audit_content`，LLM 输出冲突/补位/关联 noteId） |
| 同仓 MCP：Bridge（单进程多工具） | **已完成** | `mcp-servers/nextclaw-bridge/run.ts`（建议作为 `NEXTCLAW_MCP_KNOWLEDGE_ENTRY` 入口） |
| 远程 MCP / 额外沙箱 | **待办** | 按需把 `StdioClientTransport` 换为 HTTP/SSE 或 Sidecar |
| `budgetTokens` 硬约束 | **待办** | 可在 Runner 内对 LLM 调用次数 / Plan 步数做联合封顶 |
| 失败自动 replan | **待办** | 工具失败时单次重试或精简 Plan 再跑 |
| 引擎 C 外部注入 + 指纹过滤 | **待办** | 见 §7.3，与 Agent 并行迭代 |

---

### 5. 体验与克制（避免“侵略性过头”）

- **推送策略**
  - 默认只在 Feed 出现，不强弹窗
  - 每天最多推送 N 条（例如 3 条），其余沉底到“学习日志”
- **可控性**
  - 全局开关：关闭自动学习 / 仅手动触发
  - 单笔记开关：不再对该笔记学习
  - 清空：删除某笔记的学习卡片与复习任务
- **可解释**
  - 每张卡片显示“触发原因”（例如：检测到版本号/命中标签/相似笔记命中）

---

### 6. 里程碑（建议落地顺序）

- **MVP（先让用户立刻感知“它在学”）**
  - 只做：相似检索 + 冲突/补位卡 + 复习要点
  - UI：笔记详情页增加「NextClaw 学习卡片」折叠区 + Feed
- **V2（复习闭环）**
  - 引入 `supermemo-2` + 自测题 + **时间轴/侧栏任务条**（参见 §8），避免整页死板日历
- **V3（外部注入与主题聚合）**
  - Release Note / 弃用预警（**必须**带技术栈指纹 §7.3）
  - 多笔记主题级学习路线
- **V2.5～V3 穿插**
  - **Thought Trace（§7.1）**：`learning_jobs.steps` + NextClaw 极简进度条
  - **贡献度/勋章（§7.2）**：与卡片产出、复习完成挂钩，形成记笔记 → AI 有素材 → 用户有反馈的正循环

---

### 7. 从「扎实」到「惊艳」：自主感 × 掌控感

#### 7.1 思维链透明化（Thought Trace）

**目的**：让用户相信 AI 在“认真比对、检索、推理”，而不是黑盒脚本；提升对「自主学习」的信任感。

- **数据**：在 `learning_jobs` 增加 `steps Json?`（或由 `lastTrace Json` 只保留最新一段展示用摘要，视产品偏好二选一；推荐 **`steps` 数组追加**，便于审计与排障）。
- **`steps` 建议结构（单条）**
  - `at`：ISO 时间
  - `phase`：`retrieve | compare | external | synthesize | finalize` 等枚举字符串
  - `message`：给 **用户看的** 一句自然语言（短，1～2 行）
  - `meta`：可选，如 `relatedNoteIds[]`、`query`、`sourceUrl`（仅内部或“展开详情”用）
- **前端展示示例（NextClaw / 笔记侧）**
  - 「正在交叉比对 3 篇关于 Java 并发的笔记…」
  - 「发现 synchronized 与 ReentrantLock 的用法可能存在逻辑冲突，正在生成冲突卡…」
  - 「正在检索与你笔记中 JDK 版本相关的公开变更说明（已限流）…」
- **克制**：步骤条默认 **折叠**；最多展示最近 3～5 条；失败时显示最后一步 + 重试，不把堆栈甩给用户。

#### 7.2 知识贡献度与勋章（Gamification）

**目的**：知识库在“成长”，用户要 **看得见、有激励**；记更多高质量笔记 → AI 有更多素材 → 自动学习更强，形成正循环。

- **概念**：**NextClaw 贡献值**（可命名 `nextclaw_contribution_points`，单位整数即可；具体是否展示“等级”由产品定）。
- **加分规则（示例，可配置）**
  - AI 产出并被你 **采纳/保留** 的一张「踩坑 / 冲突」类卡片：+10
  - AI 帮你生成并保留的「对比 / 补位」结构化内容（如对比表）：+5
  - 完成一次 **高难度复习**（例如：到期复习 + 自测得分 ≥ 阈值，或 SM2 间隔被显著拉长那次）：+20
  - 连续 N 天有有效笔记更新：小额阶梯奖励（防刷：需字数/去重视窗）
- **勋章（Badge）**：里程碑式解锁，如「避坑先锋」「补位能手」「复习钉子户」；展示位：NextClaw 顶栏、个人设置、或周小结里。
- **掌控**：贡献值可 **关闭展示**；清空仅影响展示层或一并回滚统计（需明确隐私文案）。

#### 7.3 技术栈指纹（Tech Stack Fingerprint）—— 引擎 C 的防噪核心

**问题**：仅靠关键词/版本号去抓外部资讯，极易变成 **“新闻联播式”推送**，伤害信任。

**做法**：

- **画像来源**：对全库（或最近 90 天活跃笔记）做 **技术实体抽取 + 共现聚类**，得到稳定指纹，例如：`Next.js 14 + Tailwind + Prisma + PostgreSQL`。
- **画像结构（概念）**：`stack_fingerprint: { ecosystems: string[], versions?: Record<string,string>, confidence: number, updatedAt }`（存 `UserMemory`、独立表或快照均可）。
- **过滤规则**：
  - 外部事件必须 **命中指纹中的至少一条强约束**（如主框架 + 主运行时版本），才进入「可推送」候选池。
  - **安全/CVE**、**breaking change**、**你笔记里显式写过的库** → 提高优先级；泛泛框架新闻 → 默认丢弃或周汇总一篇。
- **效果**：外部注入从「广撒网」变为 **“特调情报”**：只在你 **真的在用的技术组合** 出现重大变动时打扰你。

---

### 8. 界面建议：复习与任务 —— 时间轴 / 侧栏，而非整页日历

- **不推荐**：占满视口的传统月历作为主视图（信息密度低、与「今天该巩固什么」弱相关）。
- **推荐**：
  - **侧边悬浮任务条**：固定「今日 3 件要事」+ 一键展开看说明/卡片。
  - **时间轴（Timeline）**：按 **到期复习、自动学习产物、外部情报** 混排，强调 **因果与时间顺序**，而不是“格子里有没有点”。
- **与 Thought Trace 结合**：时间轴上某条「正在分析…」可作为进行中状态节点，完成后变为可点击卡片。