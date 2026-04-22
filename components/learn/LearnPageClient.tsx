"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";
import Link from "next/link";
import { Clock3, Loader2, MessageSquarePlus, Sparkles } from "lucide-react";

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
  uiTypeLabel?: string;
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

function easeTag(easeFactor: number): { label: string; cls: string } {
  if (easeFactor < 2.0) return { label: "紧急", cls: "border-error/30 bg-error/10 text-error" };
  if (easeFactor < 3.0) return { label: "一般", cls: "border-amber-500/25 bg-amber-500/10 text-amber-400" };
  return { label: "稳定", cls: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400" };
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

  const fetchDashboard = async () => {
    const r = await fetch("/api/learn/dashboard", { credentials: "include" });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      throw new Error(j?.error || `加载失败（HTTP ${r.status}）`);
    }
    const json = (await r.json()) as DashboardData & { ok?: boolean };
    return json;
  };

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
    if (selected) {
      if (selected.kind === "review") {
        const exists = data.pendingReviews.items.some((x) => x.reviewItemId === selected.reviewItemId);
        if (exists) return;
      }
      if (selected.kind === "card") {
        const exists = data.todayCards.some((x) => x.cardId === selected.cardId);
        if (exists) return;
      }
      if (selected.kind === "job") {
        const exists = data.activeJobs.some((x) => x.jobId === selected.jobId);
        if (exists) return;
      }
    }
    const firstReview = data.pendingReviews.items[0];
    if (firstReview) setSelected({ kind: "review", reviewItemId: firstReview.reviewItemId });
    else if (data.todayCards[0]) setSelected({ kind: "card", cardId: data.todayCards[0].cardId });
    else if (data.activeJobs[0]) setSelected({ kind: "job", jobId: data.activeJobs[0].jobId });
    else setSelected(null);
  }, [loading, data, selected]);

  const selectedReview = useMemo(() => {
    if (!data || !selected || selected.kind !== "review") return null;
    return data.pendingReviews.items.find((x) => x.reviewItemId === selected.reviewItemId) ?? null;
  }, [data, selected]);

  const selectedReviewIndex = useMemo(() => {
    if (!data || !selectedReview) return -1;
    return data.pendingReviews.items.findIndex((x) => x.reviewItemId === selectedReview.reviewItemId);
  }, [data, selectedReview]);

  const nextReview = useMemo(() => {
    if (!data || selectedReviewIndex < 0) return null;
    return data.pendingReviews.items[selectedReviewIndex + 1] ?? null;
  }, [data, selectedReviewIndex]);

  const selectedCard = useMemo(() => {
    if (!data || !selected || selected.kind !== "card") return null;
    return data.todayCards.find((x) => x.cardId === selected.cardId) ?? null;
  }, [data, selected]);

  const selectedJob = useMemo(() => {
    if (!data || !selected || selected.kind !== "job") return null;
    return data.activeJobs.find((x) => x.jobId === selected.jobId) ?? null;
  }, [data, selected]);

  const submitReview = async () => {
    if (!selectedReview) return;
    const reviewItemId = selectedReview.reviewItemId;
    const learningCardId = selectedReview.learningCardId;
    if (!learningCardId) return;

    const answer = (answerByReviewId[reviewItemId] ?? "").trim();
    if (!answer || answer.length < 2) return;
    if (busyByReviewId[reviewItemId]) return;

    setAiErrorByReviewId((m) => ({ ...m, [reviewItemId]: null }));
    setBusyByReviewId((m) => ({ ...m, [reviewItemId]: true }));

    try {
      const r = await fetch("/api/nextclaw/review/score", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewItemId, learningCardId, answer }),
      });
      const json = (await r.json().catch(() => null)) as { error?: string } & {
        lastScore?: number;
        aiParsed?: AiParsed;
      };
      if (!r.ok) throw new Error(json?.error || `AI 评分失败（HTTP ${r.status}）`);

      const lastScore = typeof json.lastScore === "number" ? json.lastScore : 0;
      setAiByReviewId((m) => ({
        ...m,
        [reviewItemId]: { lastScore, aiParsed: json.aiParsed },
      }));

      // 刷新 dashboard，下一条自动前移
      const beforeId = reviewItemId;
      const nextData = await fetchDashboard();
      setData(nextData);

      const idx = nextData.pendingReviews.items.findIndex((x) => x.reviewItemId === beforeId);
      if (idx >= 0 && nextData.pendingReviews.items[idx + 1]) {
        setSelected({ kind: "review", reviewItemId: nextData.pendingReviews.items[idx + 1].reviewItemId });
      } else if (nextData.pendingReviews.items[0]) {
        setSelected({ kind: "review", reviewItemId: nextData.pendingReviews.items[0].reviewItemId });
      } else {
        setSelected(nextData.todayCards[0] ? { kind: "card", cardId: nextData.todayCards[0].cardId } : nextData.activeJobs[0] ? { kind: "job", jobId: nextData.activeJobs[0].jobId } : null);
      }
    } catch (e) {
      setAiErrorByReviewId((m) => ({ ...m, [reviewItemId]: e instanceof Error ? e.message : "AI 评分失败" }));
    } finally {
      setBusyByReviewId((m) => ({ ...m, [reviewItemId]: false }));
    }
  };

  const selectReviewByOffset = (offset: -1 | 1) => {
    if (!data || selectedReviewIndex < 0) return;
    const nextIdx = selectedReviewIndex + offset;
    const target = data.pendingReviews.items[nextIdx];
    if (!target) return;
    setSelected({ kind: "review", reviewItemId: target.reviewItemId });
  };

  const appendToCurrentAnswer = (text: string) => {
    if (!selectedReview) return;
    const id = selectedReview.reviewItemId;
    setAnswerByReviewId((m) => {
      const prev = (m[id] ?? "").trim();
      const addon = text.trim();
      if (!addon) return m;
      const merged = prev ? `${prev}\n- ${addon}` : `- ${addon}`;
      return { ...m, [id]: merged };
    });
  };

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-surface">
      <AppSidebar />
      <div className="flex h-full min-h-0 flex-col pl-64">
        <AppTopBar />
        <div className="flex min-h-0 flex-1 overflow-hidden pt-16 pb-8">
          <div className="flex min-h-0 w-full flex-col lg:flex-row">
            <aside className="min-h-0 w-full overflow-hidden border-b border-outline-variant/10 lg:w-[30%] lg:max-w-[420px] lg:border-b-0 lg:border-r">
              <div className="min-h-0 overflow-y-auto px-4 py-3">
                {loading ? (
                  <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/20 px-3 py-4 text-center text-xs text-on-surface-variant">
                    <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
                    正在加载学习中心…
                  </div>
                ) : error ? (
                  <div className="rounded-xl border border-error/20 bg-error/5 px-3 py-4 text-xs font-bold text-error">{error}</div>
                ) : !data ? null : (
                  <div className="space-y-3">
                    <Section
                      title="待复习"
                      count={data.pendingReviews.total}
                      icon={<Clock3 className="h-3.5 w-3.5" />}
                      emptyText="暂无待复习内容"
                    >
                      <div className="space-y-2">
                        {data.pendingReviews.items.map((r) => {
                          const isActive = selected?.kind === "review" && selected.reviewItemId === r.reviewItemId;
                          const tag = easeTag(r.easeFactor);
                          const score = aiByReviewId[r.reviewItemId]?.lastScore ?? r.lastScore;
                          return (
                            <button
                              key={r.reviewItemId}
                              type="button"
                              onClick={() => setSelected({ kind: "review", reviewItemId: r.reviewItemId })}
                              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                                isActive
                                  ? "border-primary/35 bg-primary/10"
                                  : "border-outline-variant/15 hover:border-primary/20 bg-surface-container-low/20"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-bold text-on-surface">{r.noteTitle}</div>
                                  <div className="mt-1 flex items-center gap-2">
                                    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${tag.cls}`}>
                                      {tag.label}
                                    </span>
                                    <span className="text-[10px] font-bold text-outline/70">{r.dueLabel}</span>
                                    <span className="text-[10px] font-bold text-outline/60">≈{r.estimatedMinutes} 分钟</span>
                                  </div>
                                </div>
                                <div className="shrink-0 text-[10px] font-black text-primary/90">{score != null ? `${score}/5` : ""}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </Section>

                    <Section
                      title="今日卡片"
                      count={data.todayCards.length}
                      icon={<Sparkles className="h-3.5 w-3.5" />}
                      emptyText="暂无今日新卡片"
                    >
                      <div className="space-y-2">
                        {data.todayCards.slice(0, 8).map((c) => {
                          const isActive = selected?.kind === "card" && selected.cardId === c.cardId;
                          return (
                            <button
                              key={c.cardId}
                              type="button"
                              onClick={() => setSelected({ kind: "card", cardId: c.cardId })}
                              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                                isActive
                                  ? "border-primary/35 bg-primary/10"
                                  : "border-outline-variant/15 hover:border-primary/20 bg-surface-container-low/20"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-bold text-on-surface">{c.title}</div>
                                  <div className="mt-1 text-[10px] text-on-surface-variant line-clamp-2">{c.summary}</div>
                                  <div className="mt-1 text-[10px] font-bold text-outline/70 truncate">{c.noteTitle}</div>
                                </div>
                                  <span className="shrink-0 rounded-md border border-outline-variant/20 bg-surface-container-high/30 px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
                                  {cardTypeLabel(c.dbType)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </Section>

                    <Section
                      title="进行中任务"
                      count={data.activeJobs.length}
                      icon={<Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      emptyText="当前没有进行中的任务"
                    >
                      <div className="space-y-2">
                        {data.activeJobs.map((j) => {
                          const isActive = selected?.kind === "job" && selected.jobId === j.jobId;
                          return (
                            <button
                              key={j.jobId}
                              type="button"
                              onClick={() => setSelected({ kind: "job", jobId: j.jobId })}
                              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                                isActive
                                  ? "border-primary/35 bg-primary/10"
                                  : "border-outline-variant/15 hover:border-primary/20 bg-surface-container-low/20"
                              }`}
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-bold text-on-surface">{j.noteTitle}</div>
                                <div className="mt-1 flex items-center justify-between gap-2">
                                  <span className="text-[10px] font-bold text-outline/70">{j.type}</span>
                                  <span className="text-[10px] font-bold text-primary/90">{Math.round(j.progress * 100)}%</span>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </Section>
                  </div>
                )}
              </div>
            </aside>

            <main className="min-h-0 flex-1 overflow-hidden">
              <div className="min-h-0 overflow-y-auto px-5 py-4">
                {!data || loading ? (
                  <div className="text-xs text-on-surface-variant">正在加载…</div>
                ) : !selected ? (
                  <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/20 p-6 text-center">
                    <div className="text-sm font-black text-on-surface">选择左侧条目开始学习</div>
                    <div className="mt-2 text-xs text-on-surface-variant">
                      今日有 {data.pendingReviews.total} 条待复习、{data.todayCards.length} 张新卡片
                    </div>
                  </div>
                ) : selected.kind === "review" && selectedReview ? (
                  <ReviewRightPanel
                    item={selectedReview}
                    queueIndex={selectedReviewIndex + 1}
                    queueTotal={data.pendingReviews.items.length}
                    nextTitle={nextReview?.noteTitle ?? null}
                    answer={answerByReviewId[selectedReview.reviewItemId] ?? ""}
                    busy={!!busyByReviewId[selectedReview.reviewItemId]}
                    ai={aiByReviewId[selectedReview.reviewItemId]}
                    aiError={aiErrorByReviewId[selectedReview.reviewItemId]}
                    onAnswerChange={(v) => setAnswerByReviewId((m) => ({ ...m, [selectedReview.reviewItemId]: v }))}
                    onSubmit={submitReview}
                    onPrev={() => selectReviewByOffset(-1)}
                    onNext={() => selectReviewByOffset(1)}
                    canPrev={selectedReviewIndex > 0}
                    canNext={selectedReviewIndex >= 0 && selectedReviewIndex < data.pendingReviews.items.length - 1}
                    onInsertMissingPoint={appendToCurrentAnswer}
                  />
                ) : selected.kind === "card" && selectedCard ? (
                  <CardRightPanel card={selectedCard} />
                ) : selected.kind === "job" && selectedJob ? (
                  <JobRightPanel job={selectedJob} />
                ) : (
                  <div className="text-xs text-on-surface-variant">该条目已不可用</div>
                )}
              </div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  count,
  icon,
  emptyText,
  children,
}: {
  title: string;
  count: number;
  icon?: ReactNode;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {icon ? <div className="text-primary/90">{icon}</div> : null}
          <div className="truncate text-xs font-black text-on-surface">{title}</div>
        </div>
        <span className="shrink-0 rounded-md border border-outline-variant/20 bg-surface-container-high/30 px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
          {count}
        </span>
      </div>
      <div className="mt-3">{count === 0 ? <div className="text-[11px] text-on-surface-variant">{emptyText}</div> : children}</div>
    </section>
  );
}

function ReviewRightPanel({
  item,
  queueIndex,
  queueTotal,
  nextTitle,
  answer,
  busy,
  ai,
  aiError,
  onAnswerChange,
  onSubmit,
  onPrev,
  onNext,
  canPrev,
  canNext,
  onInsertMissingPoint,
}: {
  item: PendingReviewItem;
  queueIndex: number;
  queueTotal: number;
  nextTitle: string | null;
  answer: string;
  busy: boolean;
  ai?: AiScoreResult;
  aiError?: string | null;
  onAnswerChange: (v: string) => void;
  onSubmit: () => Promise<void>;
  onPrev: () => void;
  onNext: () => void;
  canPrev: boolean;
  canNext: boolean;
  onInsertMissingPoint: (text: string) => void;
}) {
  const tag = easeTag(item.easeFactor);
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-on-surface">{item.noteTitle}</div>
            <div className="mt-1 text-[11px] font-bold text-primary/90">
              队列进度：第 {queueIndex}/{Math.max(1, queueTotal)} 条
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${tag.cls}`}>{tag.label}</span>
              <span className="rounded-md border border-outline-variant/20 bg-surface-container-high/20 px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
                {item.dueLabel}
              </span>
              {item.lastScore != null ? (
                <span className="rounded-md border border-outline-variant/20 bg-surface-container-high/20 px-2 py-0.5 text-[10px] font-bold text-on-surface-variant">
                  上次 {item.lastScore}/5
                </span>
              ) : null}
            </div>
            {nextTitle ? (
              <div className="mt-2 truncate text-[11px] text-on-surface-variant">
                下一条：{nextTitle}
              </div>
            ) : null}
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={onPrev}
                disabled={!canPrev}
                className="rounded-md border border-outline-variant/20 px-2 py-1 text-[10px] font-bold text-on-surface-variant disabled:opacity-40"
              >
                上一条
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!canNext}
                className="rounded-md border border-outline-variant/20 px-2 py-1 text-[10px] font-bold text-on-surface-variant disabled:opacity-40"
              >
                下一条
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <div className="text-xs font-black text-on-surface-variant">核心要点</div>
        <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-on-surface/90">{item.corePreview || "（暂无要点预览）"}</div>
      </div>

      <details className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <summary className="cursor-pointer text-xs font-black text-on-surface-variant">
          展开自测题（1 题）
        </summary>
        <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-on-surface/90">
          {item.selfTestPreview || "（暂无自测题）"}
        </div>
      </details>

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <div className="text-xs font-black text-on-surface-variant">作答提示（帮助你输出高质量回答）</div>
        <div className="mt-2 space-y-1 text-xs text-on-surface-variant">
          <div>- 先讲定义，再讲步骤，最后讲风险/边界。</div>
          <div>- 尽量给一个你自己的例子，避免只复述术语。</div>
          <div>- 回答控制在 3-8 行，信息密度高于字数长度。</div>
        </div>
      </div>

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <div className="text-xs font-black text-outline/80">你的回答（用于 AI 评分）</div>
        <textarea
          value={answer}
          onChange={(e) => onAnswerChange(e.target.value)}
          rows={5}
          placeholder="用你自己的话回答；越具体越好。"
          className="mt-2 min-h-[120px] w-full resize-none rounded-xl border border-outline-variant/15 bg-surface-container-lowest/35 px-3 py-2 text-xs leading-relaxed outline-none focus:ring-1 focus:ring-primary/25"
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={busy || !item.learningCardId || !answer.trim() || answer.trim().length < 2}
            onClick={() => void onSubmit()}
            className="rounded-xl bg-primary-container px-4 py-2 text-xs font-black text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "AI 评分中…" : item.learningCardId ? "提交并 AI 评分" : "缺少复习卡片（无法评分）"}
          </button>
          <div className="text-[11px] text-on-surface-variant">
            评分后会自动切换下一条（队列模式）。
          </div>
        </div>
        {aiError ? <div className="mt-2 text-xs font-bold text-error">{aiError}</div> : null}
      </div>

      <details className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <summary className="cursor-pointer text-xs font-black text-on-surface-variant">
          参考答案要点（复习后可对照）
        </summary>
        <div className="mt-2 space-y-1 text-xs text-on-surface-variant">
          {item.answerPointItems.length ? (
            item.answerPointItems.map((x, i) => <div key={`${i}-${x}`}>- {x}</div>)
          ) : (
            <div>{item.answerPointsPreview || "（暂无提取到的要点，建议查看完整复习卡）"}</div>
          )}
        </div>
      </details>

      <details className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <summary className="cursor-pointer text-xs font-black text-on-surface-variant">
          查看完整复习卡
        </summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-outline-variant/10 bg-surface-container-lowest/30 px-3 py-2 text-[11px] leading-relaxed text-on-surface/90">
          {item.reviewCardContentMd || item.reviewCardTitle || "（暂无内容）"}
        </pre>
      </details>

      {ai ? (
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
          <div className="text-xs font-black text-on-surface-variant">AI 解析结果</div>
          <div className="mt-2 text-sm font-black text-primary">{ai.lastScore}/5</div>
          {ai.aiParsed?.feedback ? <div className="mt-2 text-xs leading-relaxed text-on-surface-variant">{ai.aiParsed.feedback}</div> : null}
          {ai.aiParsed?.matchedKeyPoints?.length ? (
            <div className="mt-3">
              <div className="text-[11px] font-bold text-outline/80">匹配要点</div>
              <div className="mt-1 space-y-1 text-xs text-on-surface-variant">
                {ai.aiParsed.matchedKeyPoints.slice(0, 4).map((x, i) => (
                  <div key={`${i}-${x}`} className="whitespace-pre-wrap">- {x}</div>
                ))}
              </div>
            </div>
          ) : null}
          {ai.aiParsed?.missingKeyPoints?.length ? (
            <div className="mt-3">
              <div className="text-[11px] font-bold text-outline/80">缺失要点</div>
              <div className="mt-1 space-y-1 text-xs text-on-surface-variant">
                {ai.aiParsed.missingKeyPoints.slice(0, 4).map((x, i) => (
                  <div key={`${i}-${x}`} className="flex items-start justify-between gap-2">
                    <div className="whitespace-pre-wrap">- {x}</div>
                    <button
                      type="button"
                      onClick={() => onInsertMissingPoint(x)}
                      className="shrink-0 rounded-md border border-outline-variant/20 px-2 py-0.5 text-[10px] font-bold text-primary hover:bg-primary/10"
                    >
                      插入回答
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CardRightPanel({ card }: { card: TodayCard }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
        <div className="text-sm font-black text-on-surface">{card.title}</div>
        <div className="mt-2 text-[11px] text-on-surface-variant">
          类型：<span className="font-bold text-on-surface">{cardTypeLabel(card.dbType)}</span> · 来源：{" "}
          <Link href={`/notes/${card.noteId}`} className="font-bold text-primary hover:underline">
            {card.noteTitle}
          </Link>
        </div>
      </div>

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <div className="text-xs font-black text-on-surface-variant">学习摘要</div>
        <div className="mt-2 text-xs leading-relaxed text-on-surface-variant whitespace-pre-wrap">
          {card.contentMdPreview || card.summary || "（暂无内容）"}
        </div>
      </div>

      {card.actionItems.length ? (
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
          <div className="text-xs font-black text-on-surface-variant">怎么做（行动建议）</div>
          <div className="mt-2 space-y-1 text-xs text-on-surface-variant">
            {card.actionItems.slice(0, 6).map((x, i) => (
              <div key={`${i}-${x}`} className="whitespace-pre-wrap">- {x}</div>
            ))}
          </div>
        </div>
      ) : null}

      {card.pitfallItems.length ? (
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
          <div className="text-xs font-black text-on-surface-variant">易错点提醒</div>
          <div className="mt-2 space-y-1 text-xs text-on-surface-variant">
            {card.pitfallItems.slice(0, 6).map((x, i) => (
              <div key={`${i}-${x}`} className="whitespace-pre-wrap">- {x}</div>
            ))}
          </div>
        </div>
      ) : null}

      {card.selfTestPreview ? (
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
          <div className="text-xs font-black text-on-surface-variant">可复习问题</div>
          <div className="mt-2 text-xs leading-relaxed text-on-surface-variant whitespace-pre-wrap">{card.selfTestPreview}</div>
        </div>
      ) : null}

      {card.answerPointItems.length ? (
        <details className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
          <summary className="cursor-pointer text-xs font-black text-on-surface-variant">参考答案要点</summary>
          <div className="mt-2 space-y-1 text-xs text-on-surface-variant">
            {card.answerPointItems.slice(0, 8).map((x, i) => (
              <div key={`${i}-${x}`} className="whitespace-pre-wrap">- {x}</div>
            ))}
          </div>
        </details>
      ) : null}

      <details className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <summary className="cursor-pointer text-xs font-black text-on-surface-variant">查看完整卡片</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded-xl border border-outline-variant/10 bg-surface-container-lowest/30 px-3 py-2 text-[11px] leading-relaxed text-on-surface/90">
          {card.contentMd || card.contentMdPreview || card.summary || "（暂无内容）"}
        </pre>
      </details>

      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4 text-[11px] text-on-surface-variant">
        今日卡片在学习中心作为复习入口展示；如需“追问”可进入 NextClaw 使用对话式追问。
      </div>
    </div>
  );
}

function JobRightPanel({ job }: { job: ActiveJob }) {
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-primary/25 bg-primary/5 p-4">
        <div className="text-sm font-black text-on-surface">{job.noteTitle}</div>
        <div className="mt-2 text-[11px] text-on-surface-variant">
          任务类型：<span className="font-bold text-on-surface">{job.type}</span>
        </div>
      </div>
      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/20 p-4">
        <div className="text-xs font-black text-on-surface-variant">任务详情入口</div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest/50">
          <div
            className="h-full rounded-full bg-primary/85 transition-[width] duration-300"
            style={{ width: `${Math.max(0, Math.min(100, Math.round((job.progress ?? 0) * 100)))}%` }}
          />
        </div>
        {job.currentStepLabel ? (
          <div className="mt-2 text-[11px] text-on-surface-variant">
            当前步骤：<span className="font-bold text-on-surface/90">{job.currentStepLabel}</span>
          </div>
        ) : null}
        <div className="mt-2 text-xs leading-relaxed text-on-surface-variant">
          该任务的实时步骤在 NextClaw 可查看（当前 MVP 学习中心仅展示入口）。
        </div>
        <div className="mt-3">
          <Link href="/nextclaw" className="inline-flex items-center gap-2 rounded-xl bg-primary-container px-4 py-2 text-xs font-black text-on-primary-container hover:bg-primary-container/90">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            打开 NextClaw
          </Link>
        </div>
      </div>
    </div>
  );
}

