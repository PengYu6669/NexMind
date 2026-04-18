import { runNextClawSkill } from "@/lib/nextclaw-skills";

/**
 * 示例：如何在 LangGraph 节点里调用 skill。
 * 你可以把这些片段粘到 nextclaw-langgraph.ts 对应节点中。
 */
export function demoSkillCalls() {
  const sourceTrust = runNextClawSkill("source_trust", {
    url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript",
    title: "JavaScript Docs",
    snippet: "官方文档，覆盖语法与兼容性说明",
    markdown: "## JS\n- Reference\n- Browser compatibility",
  });

  const audit = runNextClawSkill("conflict_audit", {
    noteText: "项目使用旧版 API X，推荐配置 A。",
    fetchedMarkdown: "官方文档：API X 已弃用，建议迁移到 API Y。",
    relatedNotes: [{ noteId: "n1", title: "迁移记录", snippet: "旧 API 到新 API 的差异" }],
  });

  const review = runNextClawSkill("review_question", {
    cardTitle: "Promise 错误处理",
    noteText: "Promise 链建议统一在末尾 catch，避免吞错。",
    keyPoints: ["catch 放在链末", "并发时使用 allSettled 汇总异常"],
  });

  const quality = runNextClawSkill("card_quality_guard", {
    type: "REVIEW",
    title: "Promise 错误处理检查清单",
    contentMd: `## 自测问题\n- 为什么 catch 放链末？\n## 答案要点\n- 避免中间分支漏处理\n- 异常收敛便于日志追踪`,
  });

  return { sourceTrust, audit, review, quality };
}
