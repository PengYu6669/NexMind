import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { extractTextFromUrl, normalizeCaptureInput } from "@/lib/extractPage";
import { generateCaptureChunkNote, generateCaptureResult } from "@/lib/doubao";
import { enqueueLearningJob } from "@/lib/note-learning-enqueue";
import { emitLearningJobEvent } from "@/lib/learning-job-events";
import { indexNoteForRag } from "@/lib/rag";

type StepStatus = "done" | "running" | "failed";
type JobStep = {
  id: string;
  phase: "tool" | "think" | "done";
  label: string;
  status: StepStatus;
  at: string;
  toolSummary?: string;
};

type CaptureResult = {
  noteId: string;
  rawNoteId: string;
  noteIds: string[];
  folder: { raw: string; theme: string };
  edges: Array<{ fromNoteId: string; toNoteId: string }>;
  jobId: string;
  learningJobIds: string[];
};

const CONCURRENCY = 3;

function nowIso() {
  return new Date().toISOString();
}

function preliminaryTitle(input: string): string {
  if (input.startsWith("http://") || input.startsWith("https://")) {
    try {
      const url = new URL(input);
      const host = url.hostname.replace(/^www\./, "");
      const path = url.pathname !== "/" ? ` ${url.pathname.replace(/[/]/g, " ").trim().slice(0, 40)}` : "";
      return (host + path).trim().slice(0, 60);
    } catch {
      // ignore and fall back to text
    }
  }
  return input.replace(/[\n\r]+/g, " ").trim().slice(0, 60) || "知识摄取";
}

async function ensureFolder(userId: string, name: string) {
  const existed = await prisma.noteFolder.findFirst({ where: { userId, name }, select: { id: true } });
  if (existed?.id) return existed.id;
  const agg = await prisma.noteFolder.aggregate({ where: { userId }, _max: { sortOrder: true } });
  const folder = await prisma.noteFolder.create({
    data: { userId, name, sortOrder: (agg._max.sortOrder ?? -1) + 1 },
    select: { id: true },
  });
  return folder.id;
}

async function ensureTags(userId: string, rawNames: string[]) {
  const names = Array.from(new Set(rawNames.map((x) => x.trim()).filter(Boolean)))
    .map((x) => (x.startsWith("#") ? x : `#${x}`))
    .slice(0, 10);
  const ids: string[] = [];
  for (const name of names) {
    const existed = await prisma.tag.findFirst({ where: { userId, name }, select: { id: true } });
    if (existed?.id) {
      ids.push(existed.id);
      continue;
    }
    const created = await prisma.tag.create({ data: { userId, name }, select: { id: true } });
    ids.push(created.id);
  }
  return ids;
}

function classifyTheme(params: { title: string; tags: string[]; text: string }): string {
  const t = `${params.title}\n${params.tags.join(" ")}\n${params.text}`.toLowerCase();
  if (t.includes("company") || t.includes("商业") || t.includes("组织") || t.includes("团队")) return "公司";
  if (t.includes("product") || t.includes("产品") || t.includes("体验") || t.includes("roadmap")) return "产品";
  if (t.includes("market") || t.includes("市场") || t.includes("用户增长") || t.includes("行业")) return "市场分析";
  if (t.includes("case") || t.includes("案例") || t.includes("实践复盘")) return "案例研究";
  if (t.includes("method") || t.includes("方法") || t.includes("框架") || t.includes("流程")) return "方法论";
  if (t.includes("person") || t.includes("人物") || t.includes("作者") || t.includes("创始人")) return "人物";
  return "技术概念";
}

function splitLargeParagraph(paragraph: string, limit: number): string[] {
  const p = paragraph.trim();
  if (!p) return [];
  if (p.length <= limit) return [p];
  const out: string[] = [];
  let rest = p;
  while (rest.length > limit) {
    const window = rest.slice(0, limit);
    const cut = Math.max(
      window.lastIndexOf("。"),
      window.lastIndexOf("！"),
      window.lastIndexOf("？"),
      window.lastIndexOf("."),
      window.lastIndexOf("\n"),
    );
    const end = cut > 120 ? cut + 1 : limit;
    out.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function chunkTextByParagraphs(text: string, maxChars = 2200, overlapChars = 220): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (!paragraphs.length) return splitLargeParagraph(text.trim(), Math.max(900, maxChars));
  const normalized = paragraphs.flatMap((p) => splitLargeParagraph(p, Math.max(900, maxChars - 320)));
  const chunks: string[] = [];
  let current = "";
  for (const p of normalized) {
    if (!current) {
      current = p;
      continue;
    }
    if (current.length + 2 + p.length <= maxChars) {
      current += `\n\n${p}`;
      continue;
    }
    chunks.push(current);
    const overlap = current.slice(Math.max(0, current.length - overlapChars)).trim();
    current = overlap ? `${overlap}\n\n${p}` : p;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter((x) => x.trim().length >= 160);
}

function mergeAdjacentChunks(chunks: string[], maxCount: number): string[] {
  const out = [...chunks];
  if (maxCount < 1) return [chunks.join("\n\n")].filter(Boolean);
  while (out.length > maxCount && out.length > 1) {
    let bestIdx = 0;
    let bestSize = Number.POSITIVE_INFINITY;
    for (let i = 0; i < out.length - 1; i += 1) {
      const size = (out[i]?.length ?? 0) + (out[i + 1]?.length ?? 0);
      if (size < bestSize) {
        bestSize = size;
        bestIdx = i;
      }
    }
    out.splice(bestIdx, 2, `${out[bestIdx]}\n\n${out[bestIdx + 1]}`.trim());
  }
  return out;
}

function clampChunkBudget(rawChars: number, planned: number): { min: number; max: number } {
  const baseMax = rawChars >= 14000 ? 8 : rawChars >= 11000 ? 7 : rawChars >= 8000 ? 6 : rawChars >= 5500 ? 5 : rawChars >= 3200 ? 4 : 3;
  const baseMin = rawChars >= 9000 ? 3 : rawChars >= 6000 ? 2 : 1;
  const target = Math.max(baseMin, Math.min(baseMax, planned));
  const min = Math.max(1, target - 1);
  const max = Math.max(min, Math.min(baseMax, target + 1));
  return { min, max };
}

function buildRawSnapshotMarkdown(params: {
  input: string;
  sourceType: string;
  sourceUrl?: string;
  rawText: string;
}) {
  const sourceLine = params.sourceUrl ? `- 来源链接：${params.sourceUrl}` : `- 来源输入：${params.input.slice(0, 300)}`;
  return [
    "## 原文快照",
    sourceLine,
    `- 来源类型：${params.sourceType}`,
    `- 原文字数：${params.rawText.length}`,
    "",
    "## 正文",
    params.rawText.trim(),
  ].join("\n");
}

async function flushCaptureJob(
  userId: string,
  jobId: string,
  steps: JobStep[],
  status: "RUNNING" | "FAILED" | "SUCCEEDED",
  lastError?: string | null,
) {
  const updated = await prisma.learningJob.updateMany({
    where: { id: jobId },
    data: {
      status,
      steps: steps as unknown as object,
      ...(status === "SUCCEEDED" || status === "FAILED" ? { finishedAt: new Date() } : {}),
      ...(lastError !== undefined ? { lastError } : {}),
    },
  });
  if (updated.count > 0) {
    emitLearningJobEvent({ type: "job_updated", userId, jobId });
    emitLearningJobEvent({ type: "jobs_changed", userId });
  }
}

async function runCapturePipeline(params: {
  userId: string;
  input: string;
  mode?: "lite" | "deep";
  onProgress?: (event: {
    type: "job_started" | "step" | "chunk_created" | "linked" | "completed";
    jobId: string;
    payload: Record<string, unknown>;
  }) => Promise<void> | void;
}): Promise<CaptureResult> {
  const preliminary = preliminaryTitle(params.input);
  const captureJob = await prisma.learningJob.create({
    data: { userId: params.userId, type: "NOTE_EXTERNAL_INJECT", status: "RUNNING", title: preliminary },
    select: { id: true },
  });
  const steps: JobStep[] = [];

  await params.onProgress?.({ type: "job_started", jobId: captureJob.id, payload: { jobId: captureJob.id } });

  const pushStep = async (step: JobStep) => {
    steps.push(step);
    await flushCaptureJob(params.userId, captureJob.id, steps, "RUNNING");
    await params.onProgress?.({ type: "step", jobId: captureJob.id, payload: { step } });
  };

  const updateLastStep = async (patch: Partial<JobStep>) => {
    steps[steps.length - 1] = { ...steps[steps.length - 1]!, ...patch };
    await flushCaptureJob(params.userId, captureJob.id, steps, "RUNNING");
    await params.onProgress?.({ type: "step", jobId: captureJob.id, payload: { step: steps[steps.length - 1] } });
  };

  const normalized = normalizeCaptureInput(params.input);
  await pushStep({
    id: "capture-source",
    phase: "tool",
    label: "接收来源并识别类型",
    status: "done",
    at: nowIso(),
    toolSummary:
      normalized.sourceType === "url"
        ? `sourceType=url; url=${normalized.sourceUrl}`
        : `sourceType=text; chars=${normalized.text.length}`,
  });

  await pushStep({
    id: "capture-extract",
    phase: "tool",
    label: normalized.sourceType === "url" ? "抓取链接并抽取正文" : "整理粘贴文本正文",
    status: "running",
    at: nowIso(),
  });
  const rawText = normalized.sourceType === "url" ? await extractTextFromUrl(normalized.sourceUrl!) : normalized.text;
  await updateLastStep({ status: "done", toolSummary: `sourceType=${normalized.sourceType}; chars=${rawText.length}` });

  const ai = await generateCaptureResult(rawText);
  await pushStep({
    id: "capture-parse",
    phase: "think",
    label: "规划主题与标签",
    status: "done",
    at: nowIso(),
    toolSummary: `title=${ai.title}; tags=${(ai.tags ?? []).slice(0, 4).join(",")}`,
  });

  const noteTitle = ai.title?.trim() || "未命名笔记";
  const cleanedForTheme = (ai.cleanedContent || "").trim();
  await prisma.learningJob.updateMany({ where: { id: captureJob.id }, data: { title: noteTitle } });
  const predictedTheme = classifyTheme({
    title: noteTitle,
    tags: ai.tags ?? [],
    text: cleanedForTheme.slice(0, 4000) || rawText.slice(0, 4000),
  });

  const rawFolderId = await ensureFolder(params.userId, `${predictedTheme} · 原文`);
  const rawTagIds = await ensureTags(params.userId, [...(ai.tags ?? []), "#原文"]);
  const rawMarkdown = buildRawSnapshotMarkdown({
    input: params.input,
    sourceType: normalized.sourceType,
    sourceUrl: normalized.sourceType === "url" ? normalized.sourceUrl : undefined,
    rawText,
  });
  const rawNote = await prisma.note.create({
    data: {
      title: `原文快照｜${noteTitle}`,
      content: rawMarkdown,
      excerpt: rawText.replace(/\s+/g, " ").slice(0, 260),
      sourceUrl: normalized.sourceType === "url" ? normalized.sourceUrl : undefined,
      sourceType: "capture_raw",
      folderId: rawFolderId,
      userId: params.userId,
      tags: rawTagIds.length > 0 ? { create: rawTagIds.map((tagId) => ({ tagId })) } : undefined,
    },
    select: { id: true },
  });
  await indexNoteForRag({
    userId: params.userId,
    noteId: rawNote.id,
    title: `原文快照｜${noteTitle}`,
    content: rawMarkdown,
  }).catch((e) => {
    console.warn("[capture] index raw snapshot failed:", e);
  });
  await pushStep({
    id: "capture-raw-snapshot",
    phase: "done",
    label: "保存原文快照",
    status: "done",
    at: nowIso(),
    toolSummary: `rawNoteId=${rawNote.id}; rawChars=${rawText.length}; theme=${predictedTheme}`,
  });

  const cleanedRatio = rawText.length > 0 ? cleanedForTheme.length / rawText.length : 0;
  const shouldUseCleaned = cleanedForTheme.length >= 1200 && (rawText.length < 2600 || cleanedRatio >= 0.58);
  const chunkBaseText = shouldUseCleaned ? cleanedForTheme : rawText;
  const preferredChars = rawText.length >= 14000 ? 2200 : rawText.length >= 8000 ? 2000 : 1800;
  const plannedChunks = Math.max(1, Math.ceil(chunkBaseText.length / preferredChars));
  const targetChunks = clampChunkBudget(rawText.length, plannedChunks).max;

  await pushStep({
    id: "capture-plan-chunks",
    phase: "think",
    label: "规划分片预算",
    status: "done",
    at: nowIso(),
    toolSummary: `targetChunks=${targetChunks}; preferredChars=${preferredChars}; rawChars=${rawText.length}`,
  });

  let chunkChars = preferredChars;
  let chunks = chunkTextByParagraphs(chunkBaseText, chunkChars, Math.min(260, Math.round(chunkChars * 0.12)));
  for (let i = 0; i < 4; i += 1) {
    if (chunks.length >= targetChunks) break;
    chunkChars = Math.max(1200, chunkChars - 220);
    chunks = chunkTextByParagraphs(chunkBaseText, chunkChars, Math.min(220, Math.round(chunkChars * 0.1)));
  }
  const budget = clampChunkBudget(rawText.length, targetChunks);
  if (chunks.length > budget.max) chunks = mergeAdjacentChunks(chunks, budget.max);
  if (!chunks.length) throw new Error("未能从来源中抽取到可用正文");

  await pushStep({
    id: "capture-chunk-budget",
    phase: "think",
    label: "确认分片数量",
    status: "done",
    at: nowIso(),
    toolSummary: `target=${targetChunks}; actual=${chunks.length}; budget=${budget.min}-${budget.max}`,
  });

  const folderIdCache = new Map<string, string>();
  let finalTheme = predictedTheme;
  const createdNoteIds: (string | null)[] = new Array(chunks.length).fill(null);

  for (let i = 0; i < chunks.length; i += 1) {
    await pushStep({ id: `capture-chunk-${i + 1}`, phase: "done", label: `整理并写入笔记 ${i + 1}/${chunks.length}`, status: "running", at: nowIso() });
  }

  for (let batchStart = 0; batchStart < chunks.length; batchStart += CONCURRENCY) {
    const batchEnd = Math.min(batchStart + CONCURRENCY, chunks.length);
    const batchResults = await Promise.allSettled(
      Array.from({ length: batchEnd - batchStart }, async (_, offset) => {
        const index = batchStart + offset;
        const chunk = chunks[index]!;
        const chunkAi = await generateCaptureChunkNote({
          globalTitle: noteTitle,
          globalTags: ai.tags ?? [],
          chunkText: chunk,
          index,
          total: chunks.length,
          sourceUrl: normalized.sourceType === "url" ? normalized.sourceUrl : undefined,
        });
        const folderName = chunkAi.folder ?? predictedTheme;
        if (chunks.length === 1) finalTheme = folderName;
        if (!folderIdCache.has(folderName)) folderIdCache.set(folderName, await ensureFolder(params.userId, folderName));
        const tagIds = await ensureTags(params.userId, [...(ai.tags ?? []), ...(chunkAi.tags ?? [])]);
        const note = await prisma.note.create({
          data: {
            title: chunkAi.title,
            content: chunkAi.markdown,
            excerpt: (chunkAi.markdown || "").replace(/\s+/g, " ").slice(0, 260),
            sourceUrl: normalized.sourceType === "url" ? normalized.sourceUrl : undefined,
            sourceType: "capture",
            folderId: folderIdCache.get(folderName),
            userId: params.userId,
            tags: tagIds.length > 0 ? { create: tagIds.map((tagId) => ({ tagId })) } : undefined,
          },
          select: { id: true },
        });
        await indexNoteForRag({
          userId: params.userId,
          noteId: note.id,
          title: chunkAi.title,
          content: chunkAi.markdown,
        }).catch((e) => {
          console.warn("[capture] index generated note failed:", e);
        });
        return { noteId: note.id, chunkAi, folderName, index, chunk };
      }),
    );

    for (const result of batchResults) {
      if (result.status === "rejected") {
        console.error("[capture] chunk AI failed:", result.reason);
        continue;
      }
      const { noteId, chunkAi, folderName, index, chunk } = result.value;
      createdNoteIds[index] = noteId;
      const stepIdx = steps.findIndex((s) => s.id === `capture-chunk-${index + 1}`);
      if (stepIdx >= 0) {
        steps[stepIdx] = {
          ...steps[stepIdx]!,
          status: "done",
          toolSummary: `chunkChars=${chunk.length}; noteId=${noteId}; folder=${folderName}; title=${chunkAi.title}`,
        };
      }
      await flushCaptureJob(params.userId, captureJob.id, steps, "RUNNING");
      await params.onProgress?.({
        type: "chunk_created",
        jobId: captureJob.id,
        payload: { noteId, index: index + 1, total: chunks.length, createdNotes: createdNoteIds.filter(Boolean).length },
      });
    }
  }

  const validNoteIds = createdNoteIds.filter((x): x is string => x !== null);
  if (!validNoteIds.length) throw new Error("未生成任何笔记");

  const edgePairs: Array<{ fromNoteId: string; toNoteId: string }> = [];
  for (const noteId of validNoteIds) {
    edgePairs.push({ fromNoteId: rawNote.id, toNoteId: noteId });
  }
  for (let i = 0; i < validNoteIds.length - 1; i += 1) {
    edgePairs.push({ fromNoteId: validNoteIds[i]!, toNoteId: validNoteIds[i + 1]! });
  }
  if (edgePairs.length) {
    await prisma.noteLink.createMany({ data: edgePairs.map((e) => ({ ...e, userId: params.userId })), skipDuplicates: true });
  }
  await params.onProgress?.({ type: "linked", jobId: captureJob.id, payload: { edges: edgePairs.length } });
  await pushStep({
    id: "capture-link",
    phase: "done",
    label: "建立知识图谱关联边",
    status: "done",
    at: nowIso(),
    toolSummary: `edges=${edgePairs.length}; chunks=${chunks.length}; theme=${finalTheme}`,
  });

  const learnMode = params.mode ?? "lite";
  const learningTargetNoteIds = learnMode === "deep" ? validNoteIds : validNoteIds.slice(0, 1);
  const learningJobIds: string[] = [];
  for (const noteId of learningTargetNoteIds) {
    const jobResult = await enqueueLearningJob({ userId: params.userId, noteId, noteUpdatedAt: new Date(), mode: learnMode });
    if ("id" in jobResult) learningJobIds.push(jobResult.id);
  }
  await pushStep({
    id: "capture-auto-enqueue",
    phase: "done",
    label: "自动触发学习任务",
    status: "done",
    at: nowIso(),
    toolSummary: `enqueued=${learningJobIds.length}/${learningTargetNoteIds.length}; generatedNotes=${validNoteIds.length}; mode=${learnMode}`,
  });

  await flushCaptureJob(params.userId, captureJob.id, steps, "SUCCEEDED", null);
  const result: CaptureResult = {
    noteId: validNoteIds[0]!,
    rawNoteId: rawNote.id,
    noteIds: [rawNote.id, ...validNoteIds],
    folder: { raw: `${predictedTheme} · 原文`, theme: finalTheme },
    edges: edgePairs,
    jobId: captureJob.id,
    learningJobIds,
  };
  await params.onProgress?.({ type: "completed", jobId: captureJob.id, payload: result as unknown as Record<string, unknown> });
  return result;
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { input?: string; mode?: string } | null;
  const input = body?.input?.trim();
  if (!input) return NextResponse.json({ error: "缺少 input" }, { status: 400 });
  const mode = body?.mode === "deep" ? "deep" : "lite";
  const wantsStream =
    (req.headers.get("accept") || "").includes("text/event-stream") || new URL(req.url).searchParams.get("stream") === "1";

  try {
    if (!wantsStream) {
      const result = await runCapturePipeline({ userId: user.id, input, mode });
      return NextResponse.json(result);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: string, payload: Record<string, unknown>) => {
          controller.enqueue(encoder.encode(`event: ${event}\n`));
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        };
        try {
          const result = await runCapturePipeline({
            userId: user.id,
            input,
            mode,
            onProgress: async (e) => send(e.type, { jobId: e.jobId, ...e.payload }),
          });
          send("done", result as unknown as Record<string, unknown>);
          controller.close();
        } catch (e) {
          send("error", { error: e instanceof Error ? e.message : "捕获失败" });
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "捕获失败";
    const lowered = message.toLowerCase();
    if (lowered.includes("http 4") || lowered.includes("缺少") || lowered.includes("invalid url")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    if (lowered.includes("http 5") || lowered.includes("ai")) {
      return NextResponse.json({ error: message }, { status: 502 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
