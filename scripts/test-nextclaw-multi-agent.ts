import "dotenv/config";
process.env.NEXTCLAW_MCP_ENABLED = "false";

async function main() {
  const startedAt = Date.now();
  const [{ executeTool }, { NEXTCLAW_TUNABLES }, { supervisorAgent, sourceAnalystAgent }, { runNextClawSkill }] =
    await Promise.all([
      import("@/lib/nextclaw-agent-tools"),
      import("@/lib/nextclaw-agent-config"),
      import("@/lib/nextclaw-multi-agent"),
      import("@/lib/nextclaw-skills"),
    ]);

  const supervisorStartedAt = Date.now();
  const supervisor = supervisorAgent.run({
    noteSourceType: "manual",
    noteText: "这是一段较短的技术笔记，只提到概念，没有给出权威来源。",
    hasRelatedNotes: false,
    requestedMode: "NOTE_LEARN_DEEP",
  });
  const supervisorDurationMs = Date.now() - supervisorStartedAt;

  const sourceStartedAt = Date.now();
  const candidates = [
    {
      url: "https://example.com/docs/a",
      title: "官方文档 A",
      description: "入门指南",
    },
    {
      url: "https://example.org/blog/b",
      title: "博客 B",
      description: "经验总结",
    },
  ].map((row) => {
    const trust = runNextClawSkill("source_trust", {
      url: row.url,
      title: row.title,
      snippet: row.description,
      markdown: "",
    });
    return { ...row, score: trust.score };
  });

  const sourceSummary = sourceAnalystAgent.summarizeCandidates({
    query: "学习 LangGraph 多 Agent 编排",
    candidates: candidates.map((row, index) => ({
      url: row.url,
      title: row.title,
      score: row.score,
      selected: index === 0,
    })),
  });
  const sourceDurationMs = Date.now() - sourceStartedAt;

  const auditStartedAt = Date.now();
  const auditResult = await executeTool("audit_content", {
    userId: "verify-user",
    note: {
      id: "note-1",
      title: "LangGraph 工作流",
      content: "<p>当前系统已支持显式 DAG、RAG 与学习卡片闭环。</p>",
    },
    relatedNotes: [
      {
        noteId: "note-2",
        title: "多 Agent 设计",
        snippet: "强调 supervisor、specialized agents 与 bounded parallelism。",
      },
    ],
    toolInput: {
      newContent: "新设计要求补齐 supervisor，并让 audit 与 fetch 支持受控并行。",
    },
    runtime: {
      channelKey: "verify-audit",
    },
  });
  const auditDurationMs = Date.now() - auditStartedAt;
  const totalDurationMs = Date.now() - startedAt;

  console.log(
    JSON.stringify(
      {
        ok: true,
        tunables: {
          parallelFetchLimit: NEXTCLAW_TUNABLES.parallelFetchLimit.value,
          parallelAuditEnabled: NEXTCLAW_TUNABLES.parallelAuditEnabled.value,
        },
        timings: {
          supervisorDurationMs,
          sourceDurationMs,
          auditDurationMs,
          totalDurationMs,
        },
        supervisor,
        sourceSummary,
        communication: {
          supervisorToRetriever:
            supervisor.route === "retrieve_and_search" || supervisor.route === "retrieve_only",
          sourceAnalystSelected: candidates[0]?.url ?? null,
          auditChannelKey: "verify-audit",
        },
        auditResult,
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
