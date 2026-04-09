import { Prisma } from "@prisma/client";
import { AUTONOMOUS_MAX_ROUNDS, RAG_TOPK_DEEP, RAG_TOPK_LITE } from "@/lib/nextclaw-agent-config";
import type { PlanToolName } from "@/lib/nextclaw-agent-types";
import type { LearningJobStepRecord } from "@/lib/nextclaw-agent-types";
import { executeTool } from "@/lib/nextclaw-agent-tools";
import { decideNeedWebSearch, pickBestFromWebResults } from "@/lib/nextclaw-autonomous-loop";
import { generateLearningPlan } from "@/lib/nextclaw-learning-plan";
import { buildKbDigestFromRelated } from "@/lib/nextclaw-kb-digest";
import { prisma } from "@/lib/prisma";
import { generateNextClawAutoLearnLite } from "@/lib/nextclaw-auto-learn";
import { ragSearch, stripHtmlToText } from "@/lib/rag";

/** 与保存笔记自动入队、worker 跳过逻辑一致（纯文本字数，去 HTML） */
export const MIN_NOTE_PLAIN_CHARS_FOR_LEARNING = 300;

async function claimNextJobs(limit: number) {
  const now = new Date();
  const jobs = await prisma.learningJob.findMany({
    where: { status: "PENDING", runAt: { lte: now } },
    orderBy: [{ priority: "desc" }, { runAt: "asc" }],
    take: Math.max(1, Math.min(50, limit)),
  });

  const claimed: typeof jobs = [];
  for (const j of jobs) {
    const updated = await prisma.learningJob.updateMany({
      where: { id: j.id, status: "PENDING" },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
    if (updated.count > 0) claimed.push(j);
  }
  return claimed;
}

export type LearningJobsBatchResult = {
  claimed: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

export async function executeLearningJobsBatch(limit: number): Promise<LearningJobsBatchResult> {
  const claimed = await claimNextJobs(limit);

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const job of claimed) {
    const stepRecords: LearningJobStepRecord[] = [];
    let fetchedMarkdown: { url: string; markdown: string } | null = null;
    let auditResult:
      | { conflicts: string[]; fillGaps: string[]; suggestedNoteIds: string[] }
      | null = null;
    let webSearchResults:
      | { query: string; results: { title?: string; url?: string; description?: string }[] }
      | null = null;

    async function flushSteps(extra?: { plan?: object }) {
      await prisma.learningJob.update({
        where: { id: job.id },
        data: {
          steps: stepRecords as unknown as Prisma.InputJsonValue,
          ...(extra?.plan ? { plan: extra.plan as Prisma.InputJsonValue } : {}),
        },
      });
    }

    try {
      if (job.type !== "NOTE_LEARN_LITE" && job.type !== "NOTE_LEARN_DEEP") {
        await prisma.learningJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED", finishedAt: new Date(), lastError: "暂不支持的 job type" },
        });
        skipped += 1;
        continue;
      }

      if (!job.noteId) {
        await prisma.learningJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED", finishedAt: new Date(), lastError: "缺少 noteId" },
        });
        skipped += 1;
        continue;
      }

      const note = await prisma.note.findFirst({
        where: { id: job.noteId, userId: job.userId },
        select: { id: true, title: true, content: true, updatedAt: true, archived: true },
      });

      if (!note || note.archived) {
        await prisma.learningJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED", finishedAt: new Date(), lastError: "笔记不存在或已归档" },
        });
        skipped += 1;
        continue;
      }

      if (job.noteUpdatedAt && note.updatedAt.getTime() > job.noteUpdatedAt.getTime()) {
        await prisma.learningJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED", finishedAt: new Date(), lastError: "笔记已更新，跳过旧版本任务" },
        });
        skipped += 1;
        continue;
      }

      const noteText = stripHtmlToText(note.content);
      if (noteText.length < MIN_NOTE_PLAIN_CHARS_FOR_LEARNING) {
        await prisma.learningJob.update({
          where: { id: job.id },
          data: { status: "SKIPPED", finishedAt: new Date(), lastError: "内容过短" },
        });
        skipped += 1;
        continue;
      }

      const query = `${note.title}\n${noteText.slice(0, 1200)}`.trim();
      const topK = job.type === "NOTE_LEARN_DEEP" ? RAG_TOPK_DEEP : RAG_TOPK_LITE;
      const hits = await ragSearch({ userId: job.userId, query, topK });

      const byNote = new Map<string, { noteId: string; title: string; snippet: string; distance: number }>();
      for (const h of hits) {
        if (h.noteId === note.id) continue;
        const exist = byNote.get(h.noteId);
        if (!exist || h.distance < exist.distance) {
          byNote.set(h.noteId, {
            noteId: h.noteId,
            title: h.noteTitle || "（无标题）",
            snippet: h.content,
            distance: h.distance,
          });
        }
      }

      let relatedNotes = Array.from(byNote.values()).slice(0, topK);

      // 去重检测：如果检索到的片段高度重复，自动扩大 topK / 增加关键词差异度再检索一次
      const sig = (s: string) =>
        stripHtmlToText(s)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 220);
      const sigs = relatedNotes.map((n) => sig(n.snippet)).filter(Boolean);
      const dupRatio = sigs.length ? 1 - new Set(sigs).size / sigs.length : 0;
      if (dupRatio >= 0.45) {
        const sDedup: LearningJobStepRecord = {
          id: "dedup",
          phase: "think",
          label: "检索去重：结果相似度偏高，扩大范围重试",
          status: "running",
          at: new Date().toISOString(),
        };
        stepRecords.push(sDedup);
        await flushSteps();

        const expandedTopK = 10;
        const diversifiedQuery = `${note.title}\n${noteText.slice(0, 800)}\n边界 条件 对比 例子 常见坑`.trim();
        const hits2 = await ragSearch({ userId: job.userId, query: diversifiedQuery, topK: expandedTopK });
        const byNote2 = new Map<string, { noteId: string; title: string; snippet: string; distance: number }>();
        for (const h of hits2) {
          if (h.noteId === note.id) continue;
          const exist = byNote2.get(h.noteId);
          if (!exist || h.distance < exist.distance) {
            byNote2.set(h.noteId, {
              noteId: h.noteId,
              title: h.noteTitle || "（无标题）",
              snippet: h.content,
              distance: h.distance,
            });
          }
        }
        relatedNotes = Array.from(byNote2.values()).slice(0, Math.max(topK, RAG_TOPK_LITE));

        sDedup.status = "done";
        sDedup.toolSummary = `重复率约 ${Math.round(dupRatio * 100)}%，已扩大 topK 并增加关键词差异度`;
        await flushSteps();
      }
      const kbDigest = buildKbDigestFromRelated({
        noteTitle: note.title,
        relatedNotes,
        maxNotes: topK,
      });
      const relatedLines = relatedNotes.map((n) => {
        const plain = stripHtmlToText(n.snippet).replace(/\s+/g, " ").trim();
        return `${n.title}: ${plain.slice(0, 220)}`;
      });

      const sRetrieve: LearningJobStepRecord = {
        id: "retrieve",
        phase: "tool",
        label: "检索相关笔记并构建知识库上下文（RAG）",
        status: "running",
        toolName: "search_notes",
        at: new Date().toISOString(),
      };
      stepRecords.push(sRetrieve);
      await flushSteps();

      const t0 = await executeTool("search_notes", {
        userId: job.userId,
        note,
        relatedNotes,
      });
      sRetrieve.status = "done";
      sRetrieve.toolSummary = t0.summary;
      await flushSteps();

      const sPlan: LearningJobStepRecord = {
        id: "plan",
        phase: "think",
        label: "生成 JSON 执行计划（Plan-Based）",
        status: "running",
        at: new Date().toISOString(),
      };
      stepRecords.push(sPlan);
      await flushSteps();

      const plan = await generateLearningPlan({
        noteTitle: note.title,
        noteSnippet: noteText,
        relatedLines,
        jobType: job.type,
        urls: Array.from(noteText.matchAll(/https?:\/\/[^\s)>\]]+/g))
          .map((m) => m[0])
          .slice(0, 5),
      });

      sPlan.status = "done";
      sPlan.toolSummary = `steps=${plan.steps.length}`;
      await flushSteps({ plan });

      const toolTraceLines: string[] = [t0.summary];

      // 自主学习循环：当知识不足时，允许主动 search → filter → read → audit
      for (let round = 0; round < AUTONOMOUS_MAX_ROUNDS; round++) {
        const sReason: LearningJobStepRecord = {
          id: `reason-${round + 1}`,
          phase: "think",
          label: "判断是否需要联网补充来源（Autonomous Reasoning）",
          status: "running",
          at: new Date().toISOString(),
        };
        stepRecords.push(sReason);
        await flushSteps();

        const decision = await decideNeedWebSearch({
          noteTitle: note.title,
          noteText,
          kbDigest,
        });
        sReason.status = "done";
        sReason.toolSummary = decision.needSearch
          ? `需要搜索：${decision.query ?? ""}${decision.reason ? `（${decision.reason}）` : ""}`
          : "无需搜索：现有知识库已足够";
        await flushSteps();

        if (!decision.needSearch || !decision.query) break;

        const sSearch: LearningJobStepRecord = {
          id: `web_search-${round + 1}`,
          phase: "tool",
          label: `自主搜索：${decision.query}`,
          status: "running",
          toolName: "web_search",
          at: new Date().toISOString(),
        };
        stepRecords.push(sSearch);
        await flushSteps();

        const sr = await executeTool("web_search", {
          userId: job.userId,
          note,
          relatedNotes,
          toolInput: { query: decision.query, topK: 5 },
        });
        toolTraceLines.push(`[web_search] ${sr.summary}`);
        sSearch.status = sr.ok ? "done" : "failed";
        sSearch.toolSummary = sr.summary;
        await flushSteps();
        if (!sr.ok) break;

        const srData = sr.data as { query?: string; results?: { title?: string; url?: string; description?: string }[] } | null;
        const results = Array.isArray(srData?.results) ? srData!.results! : [];

        const sFilter: LearningJobStepRecord = {
          id: `filter-${round + 1}`,
          phase: "think",
          label: "评估来源并选择优先阅读项（Filter）",
          status: "running",
          at: new Date().toISOString(),
        };
        stepRecords.push(sFilter);
        await flushSteps();

        const pick = await pickBestFromWebResults({ query: decision.query, results });
        sFilter.status = "done";
        sFilter.toolSummary = pick.announce;
        await flushSteps();
        toolTraceLines.push(`[filter] ${pick.announce}`);

        if (!pick.selectedUrl) break;

        const sRead: LearningJobStepRecord = {
          id: `fetch-${round + 1}`,
          phase: "tool",
          label: `深度阅读：抓取 ${pick.selectedUrl}`,
          status: "running",
          toolName: "fetch_url",
          at: new Date().toISOString(),
        };
        stepRecords.push(sRead);
        await flushSteps();

        const fr = await executeTool("fetch_url", {
          userId: job.userId,
          note,
          relatedNotes,
          toolInput: { url: pick.selectedUrl },
        });
        toolTraceLines.push(`[fetch_url] ${fr.summary}`);
        sRead.status = fr.ok ? "done" : "failed";
        sRead.toolSummary = fr.summary;
        await flushSteps();
        if (!fr.ok) break;

        const fData = fr.data as { markdown?: string; url?: string } | null;
        if (fData?.markdown && fData?.url) {
          fetchedMarkdown = { url: fData.url, markdown: fData.markdown };
        }

        if (!fetchedMarkdown?.markdown) break;

        const sAudit: LearningJobStepRecord = {
          id: `audit-${round + 1}`,
          phase: "think",
          label: "对账审计：与知识库查漏补缺（Audit）",
          status: "running",
          toolName: "audit_content",
          at: new Date().toISOString(),
        };
        stepRecords.push(sAudit);
        await flushSteps();

        const ar = await executeTool("audit_content", {
          userId: job.userId,
          note,
          relatedNotes,
          toolInput: { newContent: fetchedMarkdown.markdown },
        });
        toolTraceLines.push(`[audit_content] ${ar.summary}`);
        sAudit.status = ar.ok ? "done" : "failed";
        sAudit.toolSummary = ar.summary;
        await flushSteps();
        if (!ar.ok) break;

        const aData = ar.data as { conflicts?: string[]; fillGaps?: string[]; suggestedNoteIds?: string[] } | null;
        auditResult = {
          conflicts: Array.isArray(aData?.conflicts) ? aData!.conflicts!.map(String) : [],
          fillGaps: Array.isArray(aData?.fillGaps) ? aData!.fillGaps!.map(String) : [],
          suggestedNoteIds: Array.isArray(aData?.suggestedNoteIds) ? aData!.suggestedNoteIds!.map(String) : [],
        };

        // 一轮闭环完成即停止（避免无限递归）
        break;
      }

      for (const ps of plan.steps) {
        const tool = (ps.tool ?? "noop") as PlanToolName;
        const st: LearningJobStepRecord = {
          id: ps.id,
          phase:
            tool === "search_notes" || tool === "read_note"
              ? "tool"
              : tool === "synthesize"
                ? "think"
                : "think",
          label: ps.title,
          status: "running",
          toolName: tool,
          at: new Date().toISOString(),
        };
        stepRecords.push(st);
        await flushSteps();

        const tr = await executeTool(tool, {
          userId: job.userId,
          note,
          relatedNotes,
          toolInput:
            tool === "web_search"
              ? {
                  query: `学习 ${note.title}（官网 GitHub 文档 教程）`,
                  topK: 5,
                }
              : tool === "fetch_url"
              ? {
                  url: (() => {
                    const fromFetched = fetchedMarkdown?.url;
                    if (fromFetched) return fromFetched;
                    const fromSearch = webSearchResults?.results?.[0]?.url;
                    if (fromSearch) return fromSearch;
                    const fromNote = Array.from(noteText.matchAll(/https?:\/\/[^\s)>\]]+/g)).map((m) => m[0])[0];
                    return fromNote || "";
                  })(),
                }
              : tool === "audit_content"
                ? {
                    newContent: fetchedMarkdown?.markdown ?? "",
                  }
                : undefined,
        });
        toolTraceLines.push(`[${ps.id}] ${tr.summary}`);
        st.status = tr.ok ? "done" : "failed";
        st.toolSummary = tr.summary;
        await flushSteps();
        if (!tr.ok) throw new Error(tr.summary);

        if (tool === "fetch_url") {
          const d = tr.data as { markdown?: string; url?: string } | undefined;
          const md = typeof d?.markdown === "string" ? d.markdown : "";
          const url = typeof d?.url === "string" ? d.url : "";
          if (md && url) fetchedMarkdown = { url, markdown: md };
        }
        if (tool === "web_search") {
          const d = tr.data as { query?: string; results?: unknown } | undefined;
          const results = Array.isArray((d as any)?.results) ? ((d as any).results as any[]) : [];
          webSearchResults = {
            query: typeof d?.query === "string" ? d.query : "",
            results: results.slice(0, 5).map((r) => ({
              title: typeof r?.title === "string" ? r.title : undefined,
              url: typeof r?.url === "string" ? r.url : undefined,
              description: typeof r?.description === "string" ? r.description : undefined,
            })),
          };
        }
        if (tool === "audit_content") {
          const d = tr.data as
            | { conflicts?: string[]; fillGaps?: string[]; suggestedNoteIds?: string[] }
            | undefined;
          auditResult = {
            conflicts: Array.isArray(d?.conflicts) ? d!.conflicts.map(String) : [],
            fillGaps: Array.isArray(d?.fillGaps) ? d!.fillGaps.map(String) : [],
            suggestedNoteIds: Array.isArray(d?.suggestedNoteIds) ? d!.suggestedNoteIds.map(String) : [],
          };
        }
      }

      const lite = await generateNextClawAutoLearnLite({
        noteTitle: note.title,
        noteHtml: note.content,
        relatedNotes,
        kbDigest,
        toolTrace: toolTraceLines.join("\n"),
        mode: job.type === "NOTE_LEARN_DEEP" ? "deep" : "lite",
      });

      if (auditResult) {
        const conflicts = auditResult.conflicts.slice(0, 6);
        const fillGaps = auditResult.fillGaps.slice(0, 6);
        const suggest = auditResult.suggestedNoteIds.slice(0, 6);
        const md = [
          fetchedMarkdown?.url ? `来源：${fetchedMarkdown.url}` : null,
          "",
          conflicts.length ? "## 冲突点" : null,
          conflicts.length ? conflicts.map((x) => `- ${x}`).join("\n") : null,
          "",
          fillGaps.length ? "## 知识补位点" : null,
          fillGaps.length ? fillGaps.map((x) => `- ${x}`).join("\n") : null,
          "",
          suggest.length ? "## 建议关联的笔记" : null,
          suggest.length ? suggest.map((x) => `- ${x}`).join("\n") : null,
        ]
          .filter((x) => typeof x === "string" && x.length > 0)
          .join("\n");
        lite.cards.unshift({
          type: "AUDIT",
          title: "知识审计：与知识库对比",
          contentMd: md || "（审计完成：未发现明显冲突或补位点）",
          sources: { suggestedNoteIds: suggest },
        });
      }

      const sWrite: LearningJobStepRecord = {
        id: "persist",
        phase: "done",
        label: "写入学习卡片与复习任务",
        status: "running",
        at: new Date().toISOString(),
      };
      stepRecords.push(sWrite);
      await flushSteps();

      await prisma.learningCard.deleteMany({
        where: {
          userId: job.userId,
          noteId: note.id,
          noteUpdatedAt: job.noteUpdatedAt ?? undefined,
        },
      });

      await prisma.learningCard.createMany({
        data: lite.cards.map((c) => ({
          userId: job.userId,
          noteId: note.id,
          type: c.type,
          title: c.title,
          contentMd: c.contentMd,
          sources: c.sources ?? {
            relatedNotes: relatedNotes.map((n) => ({ noteId: n.noteId, title: n.title, distance: n.distance })),
          },
          noteUpdatedAt: job.noteUpdatedAt ?? note.updatedAt,
        })),
      });

      const dueDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.reviewItem.upsert({
        where: { userId_noteId: { userId: job.userId, noteId: note.id } },
        create: {
          userId: job.userId,
          noteId: note.id,
          dueDate,
          intervalDays: 1,
          easeFactor: 2.5,
        },
        update: {
          dueDate,
        },
      });

      sWrite.status = "done";
      sWrite.toolSummary = `cards=${lite.cards.length}`;
      await flushSteps();

      await prisma.learningJob.update({
        where: { id: job.id },
        data: { status: "SUCCEEDED", finishedAt: new Date(), lastError: null },
      });

      succeeded += 1;
    } catch (e) {
      await prisma.learningJob.update({
        where: { id: job.id },
        data: {
          status: "FAILED",
          finishedAt: new Date(),
          lastError: e instanceof Error ? e.message : String(e),
          ...(stepRecords.length
            ? { steps: stepRecords as unknown as Prisma.InputJsonValue }
            : {}),
        },
      });
      failed += 1;
    }
  }

  return {
    claimed: claimed.length,
    succeeded,
    failed,
    skipped,
  };
}
