# 学习中心设计文档

**版本**: V2.1（对齐实现）
**日期**: 2026/04/15
**原则**: 单页、轻量、与现有页面零割裂

---

## 一、定位

学习中心 `/learn` 是一个**聚合入口页**，把散落在 NextClaw 和 Notes 里的学习产出集中展示：

- 待复习内容（来自 `ReviewItem`）
- 今日新卡片（来自 `LearningCard`）
- 进行中的学习任务（来自 `LearningJob`）

**不做的事**：不搞 gamification / 成就墙 / 贡献值 / 连胜徽章 / 独立统计页。这些可以以后迭代，现阶段先把"入口聚合"做好。

---

## 二、页面布局

### 2.1 路由

唯一路由：`/learn`，不设子路由。复习交互在同一页面内完成（右侧面板）。

### 2.2 布局方案

沿用项目 AppShell 三栏体系，与 NextClaw 页面布局风格一致：

```
┌── 侧边栏 256px ──┬── 左栏 30% ──────────┬── 右栏 70% ───────────────┐
│                   │                       │                            │
│  NexMind          │  ┌─ 待复习 ─────────┐ │  ┌─ 复习/卡片详情 ──────┐  │
│  导航             │  │ 3 条待复习       │ │  │                      │  │
│  ...              │  │ 按紧急度排序     │ │  │ 点击左栏条目后       │  │
│                   │  │                  │ │  │ 右栏展示详情         │  │
│  🏠 首页          │  └─────────────────│ │  │                      │  │
│  📚 知识库        │  ┌─ 今日卡片 ──────┐ │  │ 复习：要点 + 自评    │  │
│  ◉ 知识图谱       │  │ 2 张踩坑预警    │ │  │ 卡片：内容 + 来源    │  │
│  🤖 NextClaw      │  │ 1 张关联发现    │ │  │                      │  │
│  🎓 学习中心 ←    │  └─────────────────│ │  └───────────────────┘  │
│  ⚙ 设置          │  ┌─ 进行中任务 ────┐ │  │  空态：引导文案       │  │
│                   │  │ 1 个深度学习     │ │  │                      │  │
│                   │  └─────────────────│ │  └───────────────────┘  │
│                   │                       │                            │
└───────────────────┴───────────────────────┴────────────────────────────┘
```

**要点**：
- 左栏是列表（复习 + 卡片 + 任务），右栏是交互区
- 点击左栏条目 → 右栏展示详情；未选中时显示引导文案
- 复习自评（SM2 评分 0-5）在右栏内完成，不用跳转新页面
- 布局结构跟 NextClaw 一致（左栏列表 + 中栏内容 + 右栏详情），视觉零割裂

---

## 三、左栏：聚合列表

三个区块，纵向排列，风格沿用 IntelligenceFeed 的卡片样式（`rounded-xl` + `border-outline-variant/15` + `bg-surface-container-lowest/40`）。

### 3.1 待复习区块

**数据源**：`ReviewItem` where `dueDate <= today`，按 `easeFactor` 升序排列（越低越紧急）。

每条显示：
- 紧急度标签（easeFactor < 2.0 → 紧急，2.0-3.0 → 一般，> 3.0 → 稳定）
- 笔记标题
- 上次得分（`lastScore`，格式如 `2/5`）

点击 → 右栏进入复习模式。

区块底部："全部复习" 按钮 → 右栏进入复习队列（逐条展示，自评后自动切换下一条）。

### 3.2 今日卡片区块

**数据源**：`LearningCard` where `createdAt = today`，按类型分组。

每条显示：
- 卡片类型徽标（踩坑 / 补位 / 关联 / 冲突 — 复用 IntelligenceFeed 的 `CardTypeBadge`）
- 标题 + 摘要（截断）
- 来源笔记标题

点击 → 右栏展示卡片完整内容 + 来源笔记链接。

### 3.3 进行中任务区块

**数据源**：`LearningJob` where `status = RUNNING`。

每条显示：
- 任务类型（来自 `LearningJob.type`）：`NOTE_LEARN_LITE` / `NOTE_LEARN_DEEP`
- UI 展示文案：深度模式 / 轻量模式（与 `IntelligenceFeed` 保持一致）
- 关联笔记标题
- 进度百分比

点击 → 跳转 `/nextclaw`（任务详情在 NextClaw 查看，学习中心只展示入口）。

---

## 四、右栏：交互区

### 4.1 空态（未选中任何条目）

简洁引导文案：
```
选择左侧条目开始学习
今日有 3 条待复习、2 张新卡片
```

### 4.2 复习模式

选中一条 `ReviewItem` 后，右栏展示：

**上半区**：复习内容
- 核心要点（来自该笔记关联的 `LearningCard(type=REVIEW)` 内容摘要；默认仅展示摘要/要点）
- 自测题/复习提示（来自 `LearningCard(type=REVIEW)` 的内容）
  - 默认从卡片 `contentMd` 派生展示（类似 `mdToPlainSummary(contentMd, 500)`）
  - 若卡片生成阶段包含 `## 自测问题` / `## 参考答案要点`，优先展示这些区块摘要
- 可选：展开查看完整卡片内容（默认折叠全文，减少认知负担）

**下半区**：自评区
- AI 评分（默认且主路径）：填写回答文本 → 提交后由后端 `AI 评分器` 完成：
  - 0-5 分评分（用于 SM2 更新）
  - 解析匹配要点 `matchedKeyPoints` / 缺失要点 `missingKeyPoints`
  - 生成一句反馈 `feedback`
- 提交后右栏展示：
  - 评分：`lastScore/5`
  - AI 反馈
  - 匹配要点 / 缺失要点（用于用户再次摄取知识）
- 最后自动切换下一条（队列模式）或返回列表

交互增强项：
- 回答框提供轻量提示（例如“用你自己的话解释、给出步骤/例子”，降低写空回答概率）

交互逻辑对齐现有 NextClaw：
- 提示展示基于 `LearningCard(type=REVIEW)` 的 `contentMd` 派生
- 评分提交复用 `POST /api/nextclaw/review/score`

### 4.3 卡片详情模式

选中一条 LearningCard 后，右栏展示：
- 卡片完整内容（summary / codeA / codeB 等字段）
- 来源笔记链接（跳转 `/notes/[id]`）
- "追问" 按钮 → 触发 NextClaw 对话（复用现有 sendNextClaw 流程）

---

## 五、数据流

### 5.1 API

单个聚合接口，一次加载所有左栏数据：

```
GET /api/learn/dashboard
```

返回：

```typescript
{
  pendingReviews: {
    items: Array<{
      reviewItemId: string;
      noteId: string;
      noteTitle: string;
      lastScore: number;      // 0-5
      easeFactor: number;     // SM2 难度因子
      dueLabel: string;       // "今日" / "过期 2 天"
      /**
       * 用于右栏展示自测提示：从该 note 的最新 REVIEW 卡派生（不新增字段）
       */
      learningCardId: string;
      /** 右栏展示用：可用摘要（默认折叠） */
      reviewPrompt: string;
    }>;
    total: number;
  };
  todayCards: Array<{
    cardId: string;
    noteId: string;
    noteTitle: string;
    dbType: "PITFALL" | "FILL_GAP" | "RELATED" | "CONFLICT" | "REVIEW";
    badgeLabel: string;
    title: string;
    summary: string;
  }>;
  activeJobs: Array<{
    jobId: string;
    type: string;             // "NOTE_LEARN_LITE" | "NOTE_LEARN_DEEP"
    noteTitle: string;
    progress: number;         // 0-100
  }>;
}
```

复习评分提交：

```
// MVP 不新增评分路由：复用现有后端评分器
POST /api/nextclaw/review/score
Body:
// 本学习中心 MVP 默认走 AI 评分（需要 answer）
{ reviewItemId: string, learningCardId: string, answer: string }
返回：由后端计算并返回 `dueDate / 区间信息`（供 UI 展示“下次复习时间”）
```

卡片详情获取：

```
复用现有学习卡查询能力（不要求新增数据模型与大接口）：
GET /api/notes/[id]/learning-cards
前端根据 cardId 选择目标卡展示完整内容。
（可选）若需要更聚合，也可以新增 `GET /api/learn/card/:id` 作为轻量包装。
```

**不新增数据模型**。以上 API 仅做聚合查询与拼装：通过 `ReviewItem.noteId` 关联到该笔记的 `LearningCard(type=REVIEW)` 用于复习提示与展示。

---

## 六、组件结构

| 组件 | 职责 |
|------|------|
| `LearnPageClient` | 页面主组件，管理左栏列表 + 右栏交互状态 |
| `LearnLeftPanel` | 左栏：三个区块列表 |
| `LearnRightPanel` | 右栏：根据选中类型渲染复习/卡片详情/空态 |
| `ReviewInteraction` | 复习交互区：要点展示 + 自评按钮 + SM2 提交 |
| `CardDetail` | 卡片详情展示 + 来源笔记链接 + 追问按钮 |

**不新增**：TodayOverview / StreakBadge / AchievementWall / WeeklyGoalsProgress / StatsPage / GoalsPage 等组件。

---

## 七、导航入口

在 `AppSidebar` 的 `navItems` 中新增一条：

```typescript
{ href: "/learn", label: "学习中心", icon: "school" }
```

排在 NextClaw 之后、设置之前。使用 MaterialIcon `school`，与现有导航图标风格一致。

---

## 八、与现有模块的关系

| 关系 | 说明 |
|------|------|
| NextClaw → 学习中心 | 任务产出卡片/ReviewItem，学习中心聚合展示 |
| 学习中心 → NextClaw | "追问"按钮跳转、进行中任务跳转 |
| 学习中心 → Notes | 卡片来源笔记链接跳转 `/notes/[id]` |
| 学习中心 ← Dashboard | 侧栏导航入口 |

学习中心是**聚合层**，只展示和交互，不新增任何学习能力。

---

## 九、里程碑

### MVP（唯一阶段）

| 任务 | 说明 |
|------|------|
| `/learn` 路由 + LearnPageClient | AppShell 三栏布局 |
| 左栏三个区块 | 待复习 + 今日卡片 + 进行中任务 |
| 右栏复习交互 | ReviewInteraction + SM2 自评 |
| 右栏卡片详情 | CardDetail + 来源笔记链接 |
| `GET /api/learn/dashboard` | 聚合查询接口 |
| 评分提交 | 复用 `POST /api/nextclaw/review/score` |
| 侧栏导航入口 | AppSidebar 新增学习中心 |

后续迭代方向（不在 MVP 内）：连胜天数、周目标进度条、成就系统、统计图表。这些在 MVP 上线后根据用户反馈决定是否加。