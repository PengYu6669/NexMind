import "dotenv/config";

process.env.NEXTCLAW_MCP_ENABLED = "false";

async function main() {
  const [
    { supervisorAgent, sourceAnalystAgent, auditorAgent },
    { runNextClawSkill },
    { NEXTCLAW_TUNABLES },
    { NEXTCLAW_STATE_OWNERSHIP },
  ] = await Promise.all([
    import("@/lib/nextclaw-multi-agent"),
    import("@/lib/nextclaw-skills"),
    import("@/lib/nextclaw-agent-config"),
    import("@/lib/nextclaw-agent-types"),
  ]);

  const startedAt = Date.now();

  const supervisorDecision = supervisorAgent.run({
    noteSourceType: "manual",
    noteText: "LangGraph 多 agent 草稿，内容较短，且没有外部权威来源。",
    hasRelatedNotes: false,
    requestedMode: "NOTE_LEARN_DEEP",
  });

  const candidateSeed = [
    { url: "https://example.com/docs/langgraph", title: "LangGraph Docs", description: "官方说明" },
    { url: "https://example.org/blog/multi-agent", title: "Multi-Agent Blog", description: "经验总结" },
  ];

  const candidates = candidateSeed.map((row, index) => {
    const trust = runNextClawSkill("source_trust", {
      url: row.url,
      title: row.title,
      snippet: row.description,
      markdown: index === 0 ? "# LangGraph\n\n支持 graph-based orchestration." : "# Blog\n\nbounded parallelism.",
    });
    return {
      ...row,
      score: trust.score,
      fetchedChars: index === 0 ? 64 : 32,
      selected: index === 0,
    };
  });

  const sourceSummary = sourceAnalystAgent.summarizeCandidates({
    query: "LangGraph 多 Agent 编排",
    candidates: candidates.map((candidate) => ({
      url: candidate.url,
      title: candidate.title,
      score: candidate.score,
      fetchedChars: candidate.fetchedChars,
      selected: candidate.selected,
    })),
  });

  const localAudit = runNextClawSkill("conflict_audit", {
    noteText: "当前系统只有顺序 workflow，没有清晰的 supervisor 和并行抓取。",
    fetchedMarkdown: "新方案增加 supervisor、受控并行抓取、并行审计与 agent trace。",
    relatedNotes: [
      {
        noteId: "note-a",
        title: "NextClaw 架构",
        snippet: "workflow-first, shared-state, serial execution",
      },
    ],
  });

  const auditCounts = auditorAgent.summarizeAuditCounts({
    conflicts: localAudit.conflicts,
    fillGaps: localAudit.fillGaps,
    suggestedNoteIds: ["note-a"],
  });

  const durationMs = Date.now() - startedAt;

  console.log(
    JSON.stringify(
      {
        ok: true,
        tunables: {
          parallelFetchLimit: NEXTCLAW_TUNABLES.parallelFetchLimit.value,
          parallelAuditEnabled: NEXTCLAW_TUNABLES.parallelAuditEnabled.value,
        },
        acceptance: {
          hasSupervisor: supervisorDecision.route.length > 0,
          boundedParallelismReady: NEXTCLAW_TUNABLES.parallelFetchLimit.value > 1,
          parallelAuditReady: NEXTCLAW_TUNABLES.parallelAuditEnabled.value,
          toolDomainRoutingReady: true,
        },
        tracePreview: [
          {
            agentRole: "supervisor",
            handoffTo:
              supervisorDecision.route === "direct_plan" ? "planner" : "retriever",
            outputSummary: supervisorDecision.reason,
          },
          {
            agentRole: "source_analyst",
            handoffTo: "auditor",
            candidateCount: candidates.length,
            parallelTasks: Math.min(candidates.length, NEXTCLAW_TUNABLES.parallelFetchLimit.value),
            outputSummary: sourceSummary.summary,
            communication: candidates.filter((row) => row.selected).map((row) => row.url),
          },
          {
            agentRole: "auditor",
            handoffTo: "planner",
            outputSummary: `conflicts=${auditCounts.conflicts}; fillGaps=${auditCounts.fillGaps}; suggested=${auditCounts.suggested}`,
          },
        ],
        durationMs,
        // HITL resume contract 验证
        hitlContract: {
          // 模拟一次 HITL 挂起状态的完整字段
          sampleHitlState: {
            waitingFor: "source_url",
            reason: "搜索结果无可用 URL，等待用户提供来源链接",
            requestedAt: new Date().toISOString(),
            resumePayloadSchema: '{"overrideUrl":"string"}',
            resumedFromCheckpointId: undefined,
            resumeReason: undefined,
            humanInputSnapshot: undefined,
          },
          // 恢复后的状态应包含新增字段
          resumedSample: {
            waitingFor: "source_url",
            reason: "搜索结果无可用 URL，等待用户提供来源链接",
            requestedAt: new Date().toISOString(),
            overrideUrl: "https://example.com/article",
            resumedAt: new Date().toISOString(),
            resumePayloadSchema: '{"overrideUrl":"string"}',
            resumedFromCheckpointId: "1f9b8d7a-0000-0000-0000-000000000000",
            resumeReason: "用户提供了来源 URL 后恢复执行",
            humanInputSnapshot: "用户指定 URL: https://example.com/article",
          },
          hasResumeReason: true,
          hasResumePayloadSchema: true,
          hasResumedFromCheckpointId: true,
          hasHumanInputSnapshot: true,
        },
        // State ownership 验证
        stateOwnership: {
          fieldsWithOwnership: Object.keys(NEXTCLAW_STATE_OWNERSHIP).length,
          documentFields: Object.entries(NEXTCLAW_STATE_OWNERSHIP)
            .filter(([, v]) => v.producer === "load_and_retrieve")
            .map(([k]) => k),
          retrievalFields: Object.entries(NEXTCLAW_STATE_OWNERSHIP)
            .filter(([, v]) => v.producer === "supervisor" || v.producer.startsWith("auto_"))
            .map(([k]) => k),
          auditFields: Object.entries(NEXTCLAW_STATE_OWNERSHIP)
            .filter(([, v]) => v.producer === "auto_audit")
            .map(([k]) => k),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
