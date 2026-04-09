"use client";

import { useMemo, useState } from "react";
import { Radar, Target, Timer } from "lucide-react";

export type RadarAxis = { label: string; value: number };

export type NextClawDashboardRibbon = {
  date: string;
  label: string;
  cards: number;
  due: number;
  overdue: number;
  heat: number;
  pulse?: boolean;
};

export type ReviewQueueItem = {
  id: string;
  noteId: string;
  title: string;
  stageLabel: string; // e.g. L1, L2, L3, L4+
  dueDate?: string;
  learningCardId?: string | null;
  prompt?: string;
};

export type AnalysisDashboardProps = {
  loading?: boolean;
  radar?: RadarAxis[];
  ribbon?: NextClawDashboardRibbon[];
  reviewStage?: string;
  retentionPercent?: number;
  dueToday?: number;
  pendingJobs?: number;
  reviewQueue?: ReviewQueueItem[];
  onAfterReviewScore?: () => void;
};

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function polygonPoints(values: number[], r = 38, cx = 50, cy = 50): string {
  const n = values.length;
  if (n === 0) return "";
  const step = (Math.PI * 2) / n;
  return values
    .map((v, i) => {
      const a = -Math.PI / 2 + i * step;
      const rr = r * clamp01(v);
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

const DEFAULT_RADAR: RadarAxis[] = [
  { label: "冲突", value: 0.35 },
  { label: "踩坑", value: 0.45 },
  { label: "补位", value: 0.3 },
  { label: "复习", value: 0.55 },
  { label: "外部/审计", value: 0.2 },
  { label: "关联", value: 0.25 },
];

const DEFAULT_RIBBON: NextClawDashboardRibbon[] = [
  { date: "d-9", label: "周一", cards: 1, due: 0, overdue: 0, heat: 0.15 },
  { date: "d-8", label: "周二", cards: 1, due: 0, overdue: 0, heat: 0.25 },
  { date: "d-7", label: "周三", cards: 2, due: 0, overdue: 0, heat: 0.45 },
  { date: "d-6", label: "周四", cards: 1, due: 1, overdue: 0, heat: 0.28 },
  { date: "d-5", label: "周五", cards: 0, due: 0, overdue: 0, heat: 0.08 },
  { date: "d-4", label: "周六", cards: 2, due: 1, overdue: 0, heat: 0.62 },
  { date: "d-3", label: "周日", cards: 1, due: 0, overdue: 0, heat: 0.34 },
  { date: "d-2", label: "周一", cards: 0, due: 1, overdue: 0, heat: 0.12 },
  { date: "d-1", label: "周二", cards: 1, due: 0, overdue: 0, heat: 0.2 },
  { date: "d-0", label: "今天", cards: 2, due: 1, overdue: 0, heat: 0.5, pulse: true },
];

function toLocalDayKey(input?: string): string | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function AnalysisDashboard({
  loading,
  radar,
  ribbon,
  reviewStage = "L1",
  retentionPercent = 0,
  dueToday,
  pendingJobs,
  reviewQueue,
  onAfterReviewScore,
}: AnalysisDashboardProps = {}) {
  const axes: RadarAxis[] = radar?.length ? radar : DEFAULT_RADAR;
  const points = polygonPoints(axes.map((a) => a.value));
  const ribbonData: NextClawDashboardRibbon[] = ribbon?.length ? ribbon : DEFAULT_RIBBON;

  const queue = reviewQueue?.slice(0, 5) ?? [];
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [timelineFilterDate, setTimelineFilterDate] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<
    | { score: number; feedback?: string; matchedKeyPoints?: string[]; missingKeyPoints?: string[] }
    | null
  >(null);

  const filteredQueue = useMemo(() => {
    if (!timelineFilterDate) return queue;
    return queue.filter((x) => toLocalDayKey(x.dueDate) === timelineFilterDate);
  }, [queue, timelineFilterDate]);

  const active = filteredQueue.find((x) => x.id === activeReviewId) ?? null;

  async function submitActiveReview() {
    if (!active) return;
    if (!active.learningCardId) {
      setErr("该条目暂无可用自测题（缺少 REVIEW 学习卡片）");
      return;
    }
    const a = answer.trim();
    if (!a) return;
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/nextclaw/review/score", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewItemId: active.id,
          learningCardId: active.learningCardId,
          answer: a,
        }),
      });
      const data = (await r.json().catch(() => null)) as
        | { error?: string; lastScore?: number; aiParsed?: { feedback?: string; matchedKeyPoints?: string[]; missingKeyPoints?: string[] } }
        | null;
      if (!r.ok) throw new Error(data?.error || `AI 评分失败：HTTP ${r.status}`);
      setResult({
        score: typeof data?.lastScore === "number" ? data.lastScore : 0,
        feedback: data?.aiParsed?.feedback,
        matchedKeyPoints: data?.aiParsed?.matchedKeyPoints,
        missingKeyPoints: data?.aiParsed?.missingKeyPoints,
      });
      onAfterReviewScore?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "AI 评分失败");
    } finally {
      setBusy(false);
    }
  }

  const stagePillClass = (stage: string) => {
    if (stage === "L4+") return "border-error-container/30 bg-error-container/15 text-error";
    if (stage === "L4") return "border-primary/25 bg-primary/10 text-primary";
    if (stage === "L3") return "border-tertiary/25 bg-tertiary/10 text-tertiary";
    if (stage === "L2") return "border-yellow-500/25 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400";
    return "border-outline-variant/25 bg-surface-container-low/40 text-on-surface-variant";
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-outline-variant/10 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-4 w-4 text-primary" />
              <h2 className="font-headline text-sm font-black tracking-tight text-on-surface">分析看板</h2>
            </div>
            <p className="mt-1 text-xs text-on-surface-variant">
              知识雷达 + 复习节奏（横向滚动时间轴）
              {typeof pendingJobs === "number" && pendingJobs > 0 ? (
                <span className="ml-2 text-primary">· 队列 {pendingJobs} 个任务</span>
              ) : null}
            </p>
          </div>
          <Target className="h-4 w-4 text-outline" />
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {loading ? (
          <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/30 px-4 py-6 text-center text-sm text-on-surface-variant">
            正在加载看板数据…
          </div>
        ) : (
          <>
        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="whitespace-nowrap text-[11px] font-black uppercase tracking-widest text-outline">掌握度雷达</div>
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold text-primary">
              <Target className="h-3.5 w-3.5" />
              主动学习引擎
            </span>
          </div>

          <div className="relative aspect-square mx-auto w-full max-w-[260px] overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/40">
            <div className="absolute inset-0 opacity-30">
              <div className="absolute inset-8 rounded-full border border-primary/25" />
              <div className="absolute inset-16 rounded-full border border-primary/20" />
              <div className="absolute inset-24 rounded-full border border-primary/15" />
            </div>
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full">
              <polygon points={points} fill="rgba(75, 77, 216, 0.25)" stroke="rgba(79, 70, 229, 0.85)" strokeWidth="1.5" />
              {axes.map((a, i) => {
                const n = axes.length;
                const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
                const x = 50 + Math.cos(ang) * 40;
                const y = 50 + Math.sin(ang) * 40;
                return <circle key={a.label} cx={x} cy={y} r="1.6" fill="rgba(192,193,255,0.9)" />;
              })}
            </svg>

            <div className="absolute inset-0 p-3 text-[11px] font-black uppercase tracking-widest text-outline">
              {axes.length === 6
                ? axes.map((a, i) => {
                    const cls =
                      i === 1
                        ? "absolute right-3 top-3 text-primary"
                        : i === 0
                          ? "absolute left-3 bottom-3"
                          : i === 2
                            ? "absolute right-3 top-1/2 -translate-y-1/2"
                            : i === 3
                              ? "absolute left-3 top-3"
                              : i === 4
                                ? "absolute right-3 bottom-3"
                                : "absolute left-3 top-1/2 -translate-y-1/2";
                    return (
                      <div key={a.label} className={cls}>
                        {a.label}
                      </div>
                    );
                  })
                : null}

              {axes.length !== 6 ? (
                <>
                  <div className="absolute left-3 bottom-3">{axes[0]?.label}</div>
                  <div className="absolute right-3 top-3 text-primary">{axes[1]?.label}</div>
                  <div className="absolute right-3 bottom-3">{axes[4]?.label}</div>
                </>
              ) : null}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-highest/40 p-2.5">
              <div className="whitespace-nowrap text-[11px] font-black uppercase tracking-widest text-outline">记忆留存</div>
              <div className="mt-1 font-headline text-base font-black text-on-surface">
                {retentionPercent}%
              </div>
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-highest/20 p-2.5">
              <div className="whitespace-nowrap text-[11px] font-black uppercase tracking-widest text-outline">今日待复习</div>
              <div className="mt-1 font-headline text-base font-black text-on-surface">{dueToday ?? "—"}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="whitespace-nowrap text-[11px] font-black uppercase tracking-widest text-outline">艾宾浩斯时间轴</div>
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold text-primary">
              <Timer className="h-3.5 w-3.5" />
              {reviewStage} 阶段
            </span>
          </div>

          <div className="mb-2 rounded-lg border border-outline-variant/10 bg-surface-container-low/30 px-2.5 py-2 text-[11px] leading-relaxed text-on-surface-variant">
            深色格表示该天学习与复习更密集。点击某一天，可直接筛选下方“待复习要点”。
          </div>

          <div className="no-scrollbar -mx-1 overflow-x-auto px-1">
            <div className="flex min-w-[620px] gap-1.5">
              {ribbonData.map((x) => {
                const a = clamp01(x.heat);
                const bg = `rgba(192, 193, 255, ${0.08 + a * 0.55})`;
                const border = a > 0.55 ? "rgba(79, 70, 229, 0.85)" : "rgba(70, 69, 85, 0.35)";
                const isActive = timelineFilterDate === x.date;
                return (
                  <button
                    type="button"
                    key={`ribbon-${x.date}`}
                    onClick={() => {
                      const next = timelineFilterDate === x.date ? null : x.date;
                      setTimelineFilterDate(next);
                      if (next) {
                        const first = queue.find((q) => toLocalDayKey(q.dueDate) === next);
                        setActiveReviewId(first?.id ?? null);
                      } else {
                        setActiveReviewId(null);
                      }
                    }}
                    className={`relative h-16 min-w-[58px] rounded-md border p-1 text-left transition-colors ${x.pulse ? "thinking-glow" : ""} ${isActive ? "ring-1 ring-primary/50" : ""}`}
                    style={{ background: bg, borderColor: border }}
                    title={`${x.label} | 学习卡片 ${x.cards}，待复习 ${x.due}${x.overdue ? `，逾期 ${x.overdue}` : ""}`}
                  >
                    <div className="text-[10px] font-bold text-on-surface-variant">{x.label}</div>
                    <div className="mt-1 text-[10px] text-on-surface-variant/85">学{x.cards} 复{x.due}</div>
                    {x.overdue > 0 ? <div className="text-[10px] font-bold text-error">逾{x.overdue}</div> : null}
                    {x.pulse ? (
                      <div className="absolute right-1 top-1">
                        <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-2 flex min-w-[620px] items-center justify-between text-[10px] font-bold text-outline/80">
              <span>学=学习卡片</span>
              <span>复=当天到期复习</span>
              <span>逾=逾期未复习</span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/20 p-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="whitespace-nowrap text-[11px] font-black uppercase tracking-widest text-outline">
              待复习要点
              <span className="ml-2 font-normal text-slate-500">（Review Queue）</span>
            </div>
            <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-bold text-primary">
              {filteredQueue.length ? `${filteredQueue.length} 项` : "—"}
            </span>
          </div>

          {timelineFilterDate ? (
            <div className="mb-2 flex items-center justify-between rounded-lg border border-outline-variant/10 bg-surface-container-low/25 px-2.5 py-1.5 text-[11px]">
              <span className="text-on-surface-variant">已按 {timelineFilterDate} 筛选</span>
              <button
                type="button"
                onClick={() => {
                  setTimelineFilterDate(null);
                  setActiveReviewId(null);
                }}
                className="rounded border border-outline-variant/20 px-2 py-0.5 text-on-surface-variant hover:bg-surface-container-low"
              >
                清除筛选
              </button>
            </div>
          ) : null}

          {filteredQueue.length ? (
            <ul className="space-y-2">
              {filteredQueue.map((q) => (
                <li
                  key={q.id}
                  className="rounded-xl border border-outline-variant/10 bg-surface-container-low/35"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setErr(null);
                      setResult(null);
                      setAnswer("");
                      setActiveReviewId((cur) => (cur === q.id ? null : q.id));
                    }}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left"
                    aria-label={`开始复习：${q.title}`}
                  >
                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold ${stagePillClass(q.stageLabel)}`}
                    >
                      {q.stageLabel}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-semibold text-on-surface">{q.title}</div>
                      {q.prompt ? (
                        <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-on-surface-variant">
                          {q.prompt}
                        </div>
                      ) : null}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-on-surface-variant">
              {timelineFilterDate
                ? "该日期下没有待复习项，可切换其他日期查看。"
                : "暂无待复习要点。完成一次复习后会自动更新。"}
            </p>
          )}

          {active ? (
            <div className="mt-3 rounded-xl border border-outline-variant/12 bg-surface-container-lowest/30 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-on-surface">开始复习：{active.title}</div>
                  <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
                    {active.prompt ? active.prompt : "（暂无自测题内容）"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveReviewId(null)}
                  className="shrink-0 rounded-lg border border-outline-variant/20 px-2 py-1 text-[11px] text-on-surface-variant hover:bg-surface-container-low"
                >
                  收起
                </button>
              </div>

              <div className="mt-2">
                <div className="mb-1 text-[10px] font-bold text-outline/70">你的回答</div>
                <textarea
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  rows={3}
                  placeholder="写下你的回答…"
                  className="min-h-[72px] w-full resize-none rounded-lg border border-outline-variant/15 bg-surface-container-low/40 px-3 py-2 text-xs leading-relaxed text-on-surface outline-none focus:ring-1 focus:ring-primary/25"
                />
                <div className="mt-2 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={busy || !answer.trim() || !active.learningCardId}
                    onClick={() => void submitActiveReview()}
                    className="rounded-lg bg-primary-container px-3 py-2 text-[11px] font-bold text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? "AI 评分中…" : "提交并 AI 评分"}
                  </button>
                  <div className="text-[10px] text-outline/70">评分将用于 SM2 更新</div>
                </div>

                {err ? <div className="mt-2 text-[10px] font-bold text-error">{err}</div> : null}

                {result ? (
                  <div className="mt-3 rounded-lg border border-outline-variant/10 bg-surface-container-low/30 p-3">
                    <div className="text-[10px] font-bold text-on-surface-variant">AI 解析结果</div>
                    <div className="mt-1 text-[11px] font-bold text-primary">评分：{result.score}/5</div>
                    {result.feedback ? (
                      <div className="mt-1 text-[10px] leading-relaxed text-on-surface-variant/90">
                        {result.feedback}
                      </div>
                    ) : null}
                    {result.matchedKeyPoints?.length ? (
                      <div className="mt-2 text-[10px] font-bold text-outline/70">
                        匹配要点：{result.matchedKeyPoints.slice(0, 3).join("；")}
                      </div>
                    ) : null}
                    {result.missingKeyPoints?.length ? (
                      <div className="mt-1 text-[10px] font-bold text-outline/70">
                        缺失要点：{result.missingKeyPoints.slice(0, 3).join("；")}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
          </>
        )}
      </div>
    </section>
  );
}

