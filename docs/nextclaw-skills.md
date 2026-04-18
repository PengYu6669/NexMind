# NextClaw Skills（运行时）

本文档描述的是 **NextClaw 工作流运行时 skill**，不是 Cursor 平台的 `SKILL.md`。

- 代码入口：`lib/nextclaw-skills/index.ts`
- 统一调用：`runNextClawSkill(name, input)`
- 当前挂载节点：`auto_filter` / `auto_audit` / `coach` / `persist`

---

## 1) SourceTrustSkill

- **skill 名**：`source_trust`
- **实现**：`lib/nextclaw-skills/source-trust-skill.ts`
- **挂载节点**：`auto_filter`
- **目标**：对候选 URL 做轻量可信度评分，降低抓错源风险

### 输入（来自工作流状态）

- `url`：`state.hitlOverrideUrl` 或 `pick.selectedUrl`
- `title`：搜索结果标题 / pick 标题
- `snippet`：搜索结果描述
- `markdown`：过滤阶段为空，后续可扩展为抓取正文摘要

### 输出

- `score: number (0~100)`
- `level: "low" | "medium" | "high"`
- `reasons: string[]`

### 写回效果

- `steps.toolSummary` 追加：`trust=<level>/<score>`
- `toolTraceLines` 追加：`[source_trust] ...`

---

## 2) ConflictAuditSkill

- **skill 名**：`conflict_audit`
- **实现**：`lib/nextclaw-skills/conflict-audit-skill.ts`
- **挂载节点**：`auto_audit`
- **目标**：在 `audit_content`（MCP/工具）之外，提供本地可用的补位/冲突审计兜底

### 输入

- `noteText`：`state.noteText`
- `fetchedMarkdown`：`state.autoFetched?.markdown`
- `relatedNotes`：`state.relatedNotes[]`

### 输出

- `conflicts: string[]`
- `fillGaps: string[]`
- `evidence: string[]`

### 写回效果

- 与 `audit_content` 的结果合并（去重后写入 `state.autoAudit`）
- `steps.toolSummary` 体现合并后的 `conflicts/fillGaps/suggested` 计数
- `toolTraceLines` 追加：`[conflict_audit] ...`

---

## 3) ReviewQuestionSkill

- **skill 名**：`review_question`
- **实现**：`lib/nextclaw-skills/review-question-skill.ts`
- **挂载节点**：`coach`
- **目标**：给 REVIEW 卡生成“可测验”的问题与答案要点，避免照抄原文

### 输入

- `cardTitle`：当前卡片标题
- `noteText`：`state.noteText`
- `keyPoints`：当前实现传空数组（后续可接 reviewCoreIdeas）

### 输出

- `question: string`
- `answerKeyPoints: string[]`
- `antiCopyCheck: { copiedPhraseRate: number; passed: boolean }`

### 写回效果

- 若 REVIEW 卡缺少“自测问题/参考答案要点”段落，则自动补齐
- `steps.toolSummary` 写入：
  - `reviewEnhanced=<count>`
  - `antiCopyPass=<pass>/<total>`

---

## 4) CardQualityGuardSkill

- **skill 名**：`card_quality_guard`
- **实现**：`lib/nextclaw-skills/card-quality-guard-skill.ts`
- **挂载节点**：`persist`
- **目标**：入库前做轻量质量守门，减少“可存储但不可复习”的卡片

### 输入

- `type`：卡片类型（REVIEW/FILL_GAP/PITFALL/CONFLICT/RELATED/AUDIT）
- `title`：卡片标题
- `contentMd`：卡片正文

### 输出

- `passed: boolean`
- `score: number`
- `issues: string[]`
- `suggestions: string[]`

### 写回效果

- 若未通过且有建议：在卡片末尾追加“质量改进建议”
- `steps.toolSummary` 写入：
  - `qualityPass=<count>`
  - `qualityFail=<count>`

---

## 在 LangGraph 中的实际调用顺序

1. `auto_filter`  
   `pickBestFromWebResults` -> `source_trust`
2. `auto_audit`  
   `audit_content` -> `conflict_audit` -> 合并结果写回 `autoAudit`
3. `coach`  
   `coachAgent.run()` 生成卡片 -> 对 REVIEW 卡调用 `review_question`
4. `persist`  
   入库前逐卡调用 `card_quality_guard`

---

## 设计边界（当前版本）

- 这些 skill 是**确定性本地逻辑**，用于提升稳定性和可观测性；不是替代主模型推理。
- 主要价值：把“高频质量控制”从 prompt 中拆出，变成可测代码。
- 后续可扩展：
  - skill 输出写入独立 metrics 字段（而不仅是 `toolSummary`）
  - 对 `review_question` 增加 n-gram 抄袭判定
  - 对 `source_trust` 引入域名白名单配置与来源黑名单库
