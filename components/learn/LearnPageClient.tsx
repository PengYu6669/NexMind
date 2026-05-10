"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  Sparkles,
  Target,
  Zap,
} from "lucide-react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";

type PendingReviewItem = {
  reviewItemId: string;
  noteId: string;
  noteTitle: string;
  lastScore: number | null;
  easeFactor: number;
  dueDate: string;
  dueLabel: string;
  learningCardId: string | null;
  reviewCardTitle: string;
  reviewCardContentMd: string;
  corePreview: string;
  selfTestPreview: string;
  answerPointsPreview: string;
  answerPointItems: string[];
  estimatedMinutes: number;
};

type TodayCard = {
  cardId: string;
  noteId: string;
  noteTitle: string;
  dbType: string;
  title: string;
  summary: string;
  contentMdPreview: string;
  selfTestPreview: string;
  answerPointItems: string[];
  actionItems: string[];
  pitfallItems: string[];
  contentMd: string;
  createdAt: string;
};

type ActiveJob = {
  jobId: string;
  type: string;
  noteTitle: string;
  progress: number;
  currentStepLabel: string | null;
};

type DashboardData = {
  pendingReviews: { items: PendingReviewItem[]; total: number };
  todayCards: TodayCard[];
  activeJobs: ActiveJob[];
};

type Selected =
  | { kind: "review"; reviewItemId: string }
  | { kind: "card"; cardId: string }
  | { kind: "job"; jobId: string }
  | null;

type AiParsed = {
  feedback?: string;
  matchedKeyPoints?: string[];
  missingKeyPoints?: string[];
};

type AiScoreResult = {
  lastScore: number;
  aiParsed?: AiParsed;
};

function cardTypeLabel(type: string): string {
  if (type === "FILL_GAP") return "查漏补缺";
  if (type === "PITFALL") return "易错提醒";
  if (type === "CONFLICT") return "冲突校验";
  if (type === "RELATED") return "关联拓展";
  if (type === "REVIEW") return "知识复习";
  if (type === "AUDIT") return "知识审计";
  if (type === "EXTERNAL") return "外部补充";
  return type;
}

function easeMeta(easeFactor: number): { label: string; className: string; tone: string } {
  if (easeFactor < 2.0) {
    return { label: "优先", className: "border-red-200 bg-red-50 text-red-700", tone: "border-l-red-400" };
  }
  if (easeFactor < 3.0) {
    return { label: "巩固", className: "border-amber-200 bg-amber-50 text-amber-700", tone: "border-l-amber-400" };
  }
  return { label: "稳定", className: "border-emerald-200 bg-emerald-50 text-emerald-700", tone: "border-l-emerald-400" };
}

function compactJobType(type: string): string {
  if (type === "NOTE_LEARN_DEEP") return "深度学习";
  if (type === "NOTE_LEARN_LITE") return "轻量学习";
  if (type === "NOTE_EXTERNAL_INJECT") return "知识摄取";
  return type;
}

async function fetchDashboard() {
  const r = await fetch("/api/learn/dashboard", { credentials: "include" });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { error?: string };
    throw new Error(j?.error || `加载失败：HTTP ${r.status}`);
  }
  return (await r.json()) as DashboardData & { ok?: boolean };
}

export function LearnPageClient() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData | null>(null);
  const [selected, setSelected] = useState<Selected>(null);
  const [answerByReviewId, setAnswerByReviewId] = useState<Record<string, string>>({});
  const [aiByReviewId, setAiByReviewId] = useState<Record<string, AiScoreResult>>({});
  const [busyByReviewId, setBusyByReviewId] = useState<Record<string, boolean>>({});
  const [aiErrorByReviewId, setAiErrorByReviewId] = useState<Record<string, string | null>>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchDashboard()
      .then((d) => {
        if (!alive) return;
        setData(d);
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : "加载失败");
      })
      .finally(() => {
        if (!alive) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (loading || !data) return;
    if (selected?.kind === "review" && data.pendingReviews.items.some((x) => x.reviewItemId === selected.reviewItemId)) return;
    if (selected?.kind === "card" && data.todayCards.some((x) => x.cardId === selected.cardId)) return;
    if (selected?.kind === "job" && data.activeJobs.some((x) => x.jobId === selected.jobId)) return;

    const firstReview = data.pendingReviews.items[0];
    if (firstReview) setSelected({ kind: "review", reviewItemId: firstReview.reviewItemId });
    else if (data.todayCards[0]) setSelected({ kind: "card", cardId: data.todayCards[0].cardId });
    else if (data.activeJobs[0]) setSelected({ kind: "job", jobId: data.activeJobs[0].jobId });
    else setSelected(null);
  }, [data, loading, selected]);

  const selectedReview = useMemo(() => {
    if (!data || selected?.kind !== "review") return null;
    return data.pendingReviews.items.find((x) => x.reviewItemId === selected.reviewItemId) ?? null;
  }, [data, selected]);

  const selectedReviewIndex = useMemo(() => {
    if (!data || !selectedReview) return -1;
    return data.pendingReviews.items.findIndex((x) => x.reviewItemId === selectedReview.reviewItemId);
  }, [data, selectedReview]);

  const selectedCard = useMemo(() => {
    if (!data || selected?.kind !== "card") return null;
    return data.todayCards.find((x) => x.cardId === selected.cardId) ?? null;
  }, [data, selected]);

  const selectedJob = useMemo(() => {
    if (!data || selected?.kind !== "job") return null;
    return data.activeJobs.find((x) => x.jobId === selected.jobId) ?? null;
  }, [data, selected]);

  const stats = useMemo(() => {
    const reviews = data?.pendingReviews.items ?? [];
    const minutes = reviews.reduce((sum, item) => sum + item.estimatedMinutes, 0);
    const priority = reviews.filter((item) => item.easeFactor < 2.0).length;
    return {
      reviews: data?.pendingReviews.total ?? 0,
      minutes,
      priority,
      cards: data?.todayCards.length ?? 0,
      jobs: data?.activeJobs.length ?? 0,
    };
  }, [data]);

  const submitReview = async () => {
    if (!selectedReview?.learningCardId) return;
    const reviewItemId = selectedReview.reviewItemId;
    const answer = (answerByReviewId[reviewItemId] ?? "").trim();
    if (!answer || answer.length < 2 || busyByReviewId[reviewItemId]) return;

    setAiErrorByReviewId((m) => ({ ...m, [reviewItemId]: null }));
    setBusyByReviewId((m) => ({ ...m, [reviewItemId]: true }));

    try {
      const r = await fetch("/api/nextclaw/review/score", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewItemId, learningCardId: selectedReview.learningCardId, answer }),
      });
      const json = (await r.json().catch(() => null)) as { error?: string; lastScore?: number; aiParsed?: AiParsed } | null;
      if (!r.ok) throw new Error(json?.error || `AI 评分失败：HTTP ${r.status}`);

      setAiByReviewId((m) => ({
        ...m,
        [reviewItemId]: { lastScore: typeof json?.lastScore === "number" ? json.lastScore : 0, aiParsed: json?.aiParsed },
      }));

      const nextData = await fetchDashboard();
      setData(nextData);
      const next = nextData.pendingReviews.items[0];
      if (next) setSelected({ kind: "review", reviewItemId: next.reviewItemId });
      else if (nextData.todayCards[0]) setSelected({ kind: "card", cardId: nextData.todayCards[0].cardId });
      else setSelected(null);
    } catch (e) {
      setAiErrorByReviewId((m) => ({ ...m, [reviewItemId]: e instanceof Error ? e.message : "AI 评分失败" }));
    } finally {
      setBusyByReviewId((m) => ({ ...m, [reviewItemId]: false }));
    }
  };

  const selectReviewByOffset = (offset: -1 | 1) => {
    if (!data || selectedReviewIndex < 0) return;
    const target = data.pendingReviews.items[selectedReviewIndex + offset];
    if (target) setSelected({ kind: "review", reviewItemId: target.reviewItemId });
  };

  const insertMissingPoint = (text: string) => {
    if (!selectedReview) return;
    const id = selectedReview.reviewItemId;
    setAnswerByReviewId((m) => {
      const prev = (m[id] ?? "").trim();
      return { ...m, [id]: prev ? `${prev}\n- ${text}` : `- ${text}` };
    });
  };

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-[#fbfbfa] font-body text-black">
      <AppSidebar />
      <div className="flex h-full min-h-0 flex-col pl-64">
        <AppTopBar />
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)_340px] gap-0 overflow-hidden pb-6 pt-16">
          <aside className="min-h-0 overflow-y-auto border-r border-black/10 bg-white px-4 py-4">
            <LearnPlanRail
              loading={loading}
              error={error}
              data={data}
              stats={stats}
              selected={selected}
              onSelect={setSelected}
            />
          </aside>

          <main className="min-h-0 overflow-y-auto px-6 py-5">
            {loading ? (
              <LoadingState />
            ) : error ? (
              <ErrorState error={error} />
            ) : !data || !selected ? (
              <EmptyLearningState />
            ) : selectedReview ? (
              <ReviewSession
                item={selectedReview}
                queueIndex={selectedReviewIndex + 1}
                queueTotal={data.pendingReviews.items.length}
                answer={answerByReviewId[selectedReview.reviewItemId] ?? ""}
                busy={!!busyByReviewId[selectedReview.reviewItemId]}
                ai={aiByReviewId[selectedReview.reviewItemId]}
                aiError={aiErrorByReviewId[selectedReview.reviewItemId]}
                canPrev={selectedReviewIndex > 0}
                canNext={selectedReviewIndex < data.pendingReviews.items.length - 1}
                onPrev={() => selectReviewByOffset(-1)}
                onNext={() => selectReviewByOffset(1)}
                onAnswerChange={(v) => setAnswerByReviewId((m) => ({ ...m, [selectedReview.reviewItemId]: v }))}
                onSubmit={submitReview}
                onInsertMissingPoint={insertMissingPoint}
              />
            ) : selectedCard ? (
              <CardStudyView card={selectedCard} />
            ) : selectedJob ? (
              <JobStudyView job={selectedJob} />
            ) : (
              <EmptyLearningState />
            )}
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-black/10 bg-white px-4 py-4">
            <LearningSidePanel data={data} selected={selected} onSelect={setSelected} />
          </aside>
        </div>
      </div>
    </div>
  );
}

function LearnPlanRail({
  loading,
  error,
  data,
  stats,
  selected,
  onSelect,
}: {
  loading: boolean;
  error: string | null;
  data: DashboardData | null;
  stats: { reviews: number; minutes: number; priority: number; cards: number; jobs: number };
  selected: Selected;
  onSelect: (selected: Selected) => void;
}) {
  if (loading) return <LoadingState compact />;
  if (error) return <ErrorState error={error} compact />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-black/10 bg-[#fbfbfa] p-4">
        <div className="text-xs font-black text-neutral-500">今日学习计划</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Metric label="待复习" value={stats.reviews} />
          <Metric label="预计分钟" value={stats.minutes} />
          <Metric label="优先项" value={stats.priority} tone={stats.priority > 0 ? "warn" : "normal"} />
          <Metric label="新卡片" value={stats.cards} />
        </div>
        <div className="mt-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-[11px] leading-5 text-neutral-600">
          建议按顺序完成待复习。每次只回答一题，AI 评分后队列会自动前进。
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-black text-neutral-950">复习队列</h2>
          <span className="text-[11px] font-semibold text-neutral-500">{data.pendingReviews.total}</span>
        </div>
        <div className="space-y-2">
          {data.pendingReviews.items.length ? (
            data.pendingReviews.items.map((item, index) => {
              const active = selected?.kind === "review" && selected.reviewItemId === item.reviewItemId;
              const meta = easeMeta(item.easeFactor);
              return (
                <button
                  key={item.reviewItemId}
                  type="button"
                  onClick={() => onSelect({ kind: "review", reviewItemId: item.reviewItemId })}
                  className={`w-full rounded-xl border border-l-4 p-3 text-left transition-colors ${meta.tone} ${
                    active ? "border-black bg-black text-white" : "border-black/10 bg-white hover:border-black/20"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className={`truncate text-xs font-bold ${active ? "text-white" : "text-neutral-950"}`}>
                        {index + 1}. {item.noteTitle}
                      </div>
                      <div className={`mt-1 line-clamp-2 text-[11px] leading-4 ${active ? "text-white/65" : "text-neutral-500"}`}>
                        {item.selfTestPreview || item.corePreview || "等待生成复习题"}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold ${active ? "border-white/20 text-white" : meta.className}`}>
                      {meta.label}
                    </span>
                  </div>
                  <div className={`mt-2 flex items-center gap-2 text-[10px] font-semibold ${active ? "text-white/60" : "text-neutral-500"}`}>
                    <span>{item.dueLabel}</span>
                    <span>{item.estimatedMinutes} 分钟</span>
                    {item.lastScore != null ? <span>{item.lastScore}/5</span> : null}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="rounded-xl border border-dashed border-black/15 bg-white px-3 py-4 text-center text-xs text-neutral-500">
              今天没有到期复习。
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ReviewSession({
  item,
  queueIndex,
  queueTotal,
  answer,
  busy,
  ai,
  aiError,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onAnswerChange,
  onSubmit,
  onInsertMissingPoint,
}: {
  item: PendingReviewItem;
  queueIndex: number;
  queueTotal: number;
  answer: string;
  busy: boolean;
  ai?: AiScoreResult;
  aiError?: string | null;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onAnswerChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onInsertMissingPoint: (text: string) => void;
}) {
  const meta = easeMeta(item.easeFactor);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-black/10 bg-[#f4ecd6] px-2 py-1 text-[11px] font-bold text-neutral-900">
                第 {queueIndex}/{Math.max(1, queueTotal)} 题
              </span>
              <span className={`rounded-md border px-2 py-1 text-[11px] font-bold ${meta.className}`}>{meta.label}</span>
              <span className="rounded-md border border-black/10 px-2 py-1 text-[11px] font-semibold text-neutral-500">
                {item.dueLabel}
              </span>
            </div>
            <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-950">{item.noteTitle}</h1>
            <p className="mt-2 text-sm leading-6 text-neutral-600">
              先回忆，再作答。不要急着看答案要点，系统会根据你的回答更新复习间隔。
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="rounded-lg border border-black/10 px-3 py-2 text-xs font-bold text-neutral-600 disabled:opacity-40" disabled={!canPrev} onClick={onPrev}>
              上一题
            </button>
            <button className="rounded-lg border border-black/10 px-3 py-2 text-xs font-bold text-neutral-600 disabled:opacity-40" disabled={!canNext} onClick={onNext}>
              下一题
            </button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_280px] gap-4">
        <div className="space-y-4">
          <div className="rounded-xl border border-black/10 bg-white p-5">
            <div className="mb-2 flex items-center gap-2 text-xs font-black text-neutral-500">
              <Target className="h-4 w-4" />
              当前自测题
            </div>
            <div className="whitespace-pre-wrap text-base leading-8 text-neutral-950">
              {item.selfTestPreview || item.corePreview || "这张复习卡暂时没有提取到自测题，请根据核心要点自由回忆。"}
            </div>
          </div>

          <div className="rounded-xl border border-black/10 bg-white p-5">
            <div className="mb-2 text-xs font-black text-neutral-500">你的回答</div>
            <textarea
              value={answer}
              onChange={(e) => onAnswerChange(e.target.value)}
              rows={8}
              placeholder="用自己的话回答：定义、关键步骤、边界条件、一个例子。"
              className="min-h-[220px] w-full resize-none rounded-xl border border-black/10 bg-[#fbfbfa] px-4 py-3 text-sm leading-7 text-neutral-950 outline-none focus:ring-2 focus:ring-black/10"
            />
            <div className="mt-3 flex items-center justify-between gap-3">
              <button
                type="button"
                disabled={busy || !item.learningCardId || answer.trim().length < 2}
                onClick={() => void onSubmit()}
                className="inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                {busy ? "评分中" : "提交并进入下一题"}
              </button>
              <span className="text-[11px] text-neutral-500">建议 3-8 行，高信息密度即可。</span>
            </div>
            {aiError ? <div className="mt-2 text-xs font-bold text-red-600">{aiError}</div> : null}
          </div>

          {ai ? <AiScoreCard ai={ai} onInsertMissingPoint={onInsertMissingPoint} /> : null}
        </div>

        <div className="space-y-4">
          <InfoCard title="核心要点">
            {item.corePreview || "暂无核心要点预览。"}
          </InfoCard>
          <details className="rounded-xl border border-black/10 bg-white p-4">
            <summary className="cursor-pointer text-xs font-black text-neutral-500">参考答案要点</summary>
            <div className="mt-3 space-y-2 text-sm leading-6 text-neutral-700">
              {item.answerPointItems.length ? item.answerPointItems.map((x) => <div key={x}>- {x}</div>) : item.answerPointsPreview || "暂无答案要点。"}
            </div>
          </details>
          <Link
            href={`/notes/${item.noteId}`}
            className="flex items-center justify-between rounded-xl border border-black/10 bg-white p-4 text-sm font-bold text-neutral-800 hover:bg-[#f7f7f5]"
          >
            打开原笔记
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}

function AiScoreCard({ ai, onInsertMissingPoint }: { ai: AiScoreResult; onInsertMissingPoint: (text: string) => void }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs font-black text-neutral-500">AI 评分结果</div>
          <div className="mt-1 text-3xl font-black text-neutral-950">{ai.lastScore}/5</div>
        </div>
        <div className="rounded-full border border-black/10 bg-[#f4ecd6] px-3 py-1 text-xs font-bold text-neutral-800">
          已更新复习间隔
        </div>
      </div>
      {ai.aiParsed?.feedback ? <p className="mt-3 text-sm leading-6 text-neutral-700">{ai.aiParsed.feedback}</p> : null}
      {ai.aiParsed?.missingKeyPoints?.length ? (
        <div className="mt-4">
          <div className="mb-2 text-xs font-black text-neutral-500">可补充到回答里</div>
          <div className="space-y-2">
            {ai.aiParsed.missingKeyPoints.slice(0, 4).map((point) => (
              <div key={point} className="flex items-start justify-between gap-3 rounded-lg border border-black/10 bg-[#fbfbfa] px-3 py-2">
                <span className="text-sm leading-6 text-neutral-700">{point}</span>
                <button
                  type="button"
                  onClick={() => onInsertMissingPoint(point)}
                  className="shrink-0 rounded-md border border-black/10 bg-white px-2 py-1 text-[11px] font-bold text-neutral-700 hover:bg-[#f7f7f5]"
                >
                  插入
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LearningSidePanel({ data, selected, onSelect }: { data: DashboardData | null; selected: Selected; onSelect: (selected: Selected) => void }) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-black/10 bg-[#fbfbfa] p-4">
        <div className="flex items-center gap-2 text-xs font-black text-neutral-500">
          <Sparkles className="h-4 w-4" />
          今日新增卡片
        </div>
        <div className="mt-3 space-y-2">
          {data?.todayCards.length ? (
            data.todayCards.slice(0, 8).map((card) => {
              const active = selected?.kind === "card" && selected.cardId === card.cardId;
              return (
                <button
                  key={card.cardId}
                  type="button"
                  onClick={() => onSelect({ kind: "card", cardId: card.cardId })}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    active ? "border-black bg-black text-white" : "border-black/10 bg-white hover:border-black/20"
                  }`}
                >
                  <div className={`truncate text-xs font-bold ${active ? "text-white" : "text-neutral-950"}`}>{card.title}</div>
                  <div className={`mt-1 line-clamp-2 text-[11px] leading-4 ${active ? "text-white/60" : "text-neutral-500"}`}>
                    {card.summary}
                  </div>
                  <div className={`mt-2 text-[10px] font-semibold ${active ? "text-white/50" : "text-neutral-400"}`}>
                    {cardTypeLabel(card.dbType)}
                  </div>
                </button>
              );
            })
          ) : (
            <div className="text-xs text-neutral-500">今天还没有新卡片。</div>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-black/10 bg-[#fbfbfa] p-4">
        <div className="flex items-center gap-2 text-xs font-black text-neutral-500">
          <Zap className="h-4 w-4" />
          正在生成
        </div>
        <div className="mt-3 space-y-2">
          {data?.activeJobs.length ? (
            data.activeJobs.map((job) => {
              const active = selected?.kind === "job" && selected.jobId === job.jobId;
              return (
                <button
                  key={job.jobId}
                  type="button"
                  onClick={() => onSelect({ kind: "job", jobId: job.jobId })}
                  className={`w-full rounded-lg border p-3 text-left transition-colors ${
                    active ? "border-black bg-black text-white" : "border-black/10 bg-white hover:border-black/20"
                  }`}
                >
                  <div className={`truncate text-xs font-bold ${active ? "text-white" : "text-neutral-950"}`}>{job.noteTitle}</div>
                  <div className={`mt-1 text-[10px] font-semibold ${active ? "text-white/60" : "text-neutral-500"}`}>
                    {compactJobType(job.type)} · {Math.round(job.progress * 100)}%
                  </div>
                  <div className={`mt-2 h-1 overflow-hidden rounded-full ${active ? "bg-white/20" : "bg-black/10"}`}>
                    <div className={`h-full rounded-full ${active ? "bg-white" : "bg-black"}`} style={{ width: `${Math.round(job.progress * 100)}%` }} />
                  </div>
                </button>
              );
            })
          ) : (
            <div className="text-xs text-neutral-500">没有进行中的学习任务。</div>
          )}
        </div>
      </section>
    </div>
  );
}

function CardStudyView({ card }: { card: TodayCard }) {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="rounded-md border border-black/10 bg-[#f4ecd6] px-2 py-1 text-[11px] font-bold text-neutral-900 inline-flex">
          {cardTypeLabel(card.dbType)}
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-950">{card.title}</h1>
        <div className="mt-2 text-sm text-neutral-600">
          来源：
          <Link href={`/notes/${card.noteId}`} className="font-bold text-neutral-950 hover:underline">
            {card.noteTitle}
          </Link>
        </div>
      </section>
      <InfoCard title="学习摘要">{card.contentMdPreview || card.summary || "暂无内容。"}</InfoCard>
      {card.selfTestPreview ? <InfoCard title="可复习问题">{card.selfTestPreview}</InfoCard> : null}
      {card.actionItems.length ? <ListCard title="行动建议" items={card.actionItems} /> : null}
      {card.pitfallItems.length ? <ListCard title="易错提醒" items={card.pitfallItems} /> : null}
      {card.answerPointItems.length ? <ListCard title="参考答案要点" items={card.answerPointItems} /> : null}
    </div>
  );
}

function JobStudyView({ job }: { job: ActiveJob }) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-black text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在生成学习内容
        </div>
        <h1 className="mt-3 text-2xl font-black tracking-tight text-neutral-950">{job.noteTitle}</h1>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/10">
          <div className="h-full rounded-full bg-black" style={{ width: `${Math.round(job.progress * 100)}%` }} />
        </div>
        <div className="mt-2 text-sm text-neutral-600">{job.currentStepLabel || compactJobType(job.type)}</div>
        <Link href="/nextclaw" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800">
          <MessageSquarePlus className="h-4 w-4" />
          打开 NextClaw 查看工作流
        </Link>
      </section>
    </div>
  );
}

function Metric({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "warn" }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${tone === "warn" ? "border-red-200 bg-red-50" : "border-black/10 bg-white"}`}>
      <div className="text-2xl font-black text-neutral-950">{value}</div>
      <div className="mt-0.5 text-[10px] font-semibold text-neutral-500">{label}</div>
    </div>
  );
}

function InfoCard({ title, children }: { title: string; children: string }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <div className="mb-2 text-xs font-black text-neutral-500">{title}</div>
      <div className="whitespace-pre-wrap text-sm leading-7 text-neutral-700">{children}</div>
    </section>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <div className="mb-2 text-xs font-black text-neutral-500">{title}</div>
      <div className="space-y-2 text-sm leading-6 text-neutral-700">
        {items.slice(0, 8).map((item) => (
          <div key={item}>- {item}</div>
        ))}
      </div>
    </section>
  );
}

function LoadingState({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-black/10 bg-white ${compact ? "p-4" : "mx-auto mt-10 max-w-md p-6 text-center"}`}>
      <Loader2 className="mx-auto h-5 w-5 animate-spin text-neutral-500" />
      <div className="mt-2 text-xs font-semibold text-neutral-500">正在加载学习中心...</div>
    </div>
  );
}

function ErrorState({ error, compact = false }: { error: string; compact?: boolean }) {
  return (
    <div className={`rounded-xl border border-red-200 bg-red-50 text-red-700 ${compact ? "p-4 text-xs" : "mx-auto mt-10 max-w-md p-6 text-sm"}`}>
      {error}
    </div>
  );
}

function EmptyLearningState() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-xl border border-dashed border-black/15 bg-white p-8 text-center">
      <BookOpenCheck className="mx-auto h-8 w-8 text-neutral-400" />
      <h1 className="mt-3 text-xl font-black text-neutral-950">今天没有学习任务</h1>
      <p className="mt-2 text-sm leading-6 text-neutral-600">
        去笔记里触发学习，或在 NextClaw 中摄取一篇资料，系统会生成复习卡片和学习队列。
      </p>
      <Link href="/nextclaw" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-black px-4 py-2 text-sm font-bold text-white hover:bg-neutral-800">
        打开 NextClaw
        <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
