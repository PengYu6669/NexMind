"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  GitBranch,
  Loader2,
  MessageSquarePlus,
  Pin,
  Sparkles,
  Trash2,
} from "lucide-react";
import { NextClawWorkflowGraph } from "@/components/nextclaw/NextClawWorkflowGraph";

const AgentOpsPanel = dynamic(
  () => import("@/components/nextclaw/AgentOpsPanel").then((mod) => mod.AgentOpsPanel),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center rounded-xl border border-black/10 bg-white text-xs text-neutral-500">
        正在加载工作流视图...
      </div>
    ),
  },
);

type FeedCardType = "conflict" | "external_update" | "review";
type FeedDbType = "REVIEW" | "FILL_GAP" | "PITFALL" | "CONFLICT" | "RELATED" | "EXTERNAL" | "AUDIT";

export type IntelligenceFeedCard = {
  id: string;
  /** 所属笔记，用于追问时带上 noteId / learningCardId */
  noteId?: string;
  type: FeedCardType;
  dbType?: FeedDbType;
  /** 覆盖徽标文案（如：冲突 / 踩坑 / 补位） */
  badgeLabel?: string;
  title: string;
  contentMd?: string;
  summary: string;
  metaLeft: string;
  metaRight: string;
  chips?: string[];
  sourceNotes?: { noteId: string; title: string; distance?: number | null }[];
  codeA?: string;
  codeB?: string;
  review?: { reviewItemId: string; progressLabel: string; dueLabel: string; prompt: string };
};

function CardTypeBadge({ type, label }: { type: FeedCardType; label?: string }) {
  if (type === "conflict") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] font-bold text-red-700">
        <AlertTriangle className="h-3.5 w-3.5" />
        {label ?? "冲突"}
      </span>
    );
  }
  if (type === "external_update") {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-black/10 bg-[#f4ecd6] px-2 py-1 text-[11px] font-bold text-neutral-800">
        <ArrowUpRight className="h-3.5 w-3.5" />
        {label ?? "情报"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-bold text-emerald-700">
      <Pin className="h-3.5 w-3.5" />
      {label ?? "复习"}
    </span>
  );
}

function cardActionMeta(card: IntelligenceFeedCard): { label: string; hint: string; tone: string } {
  switch (card.dbType) {
    case "REVIEW":
      return { label: "开始自测", hint: "用自己的话回答，再让 AI 评分", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" };
    case "FILL_GAP":
      return { label: "补一句", hint: "把缺失概念补回原笔记", tone: "bg-[#f4ecd6] text-neutral-800 border-black/10" };
    case "PITFALL":
      return { label: "避坑核对", hint: "确认这里是不是你的易错点", tone: "bg-red-50 text-red-700 border-red-200" };
    case "CONFLICT":
      return { label: "核对冲突", hint: "展开查看两段说法的差异", tone: "bg-red-50 text-red-700 border-red-200" };
    case "RELATED":
      return { label: "建立关联", hint: "把它和已有笔记连起来", tone: "bg-blue-50 text-blue-700 border-blue-200" };
    case "AUDIT":
      return { label: "审计确认", hint: "检查证据与结论是否可靠", tone: "bg-violet-50 text-violet-700 border-violet-200" };
    case "EXTERNAL":
      return { label: "阅读补充", hint: "快速吸收外部新增信息", tone: "bg-blue-50 text-blue-700 border-blue-200" };
    default:
      return { label: "查看卡片", hint: "展开后继续处理", tone: "bg-[#f7f7f5] text-neutral-700 border-black/10" };
  }
}

function InlineAsk({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState("");
  if (!open) return null;

  return (
    <div className="mt-3 rounded-xl border border-outline-variant/15 bg-surface-container-lowest/40 p-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const v = text.trim();
          if (!v) return;
          onSubmit(v);
          setText("");
          onClose();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-outline-variant/15 bg-surface-container-low/60 px-3 py-2 text-sm text-on-surface outline-none placeholder:text-outline/40 focus:ring-1 focus:ring-primary/25"
          placeholder="追问这个卡片的细节…"
          aria-label="追问输入框"
        />
        <button
          type="submit"
          className="rounded-lg bg-primary-container px-3 py-2 text-sm font-bold text-on-primary-container transition-colors hover:bg-primary-container/90"
        >
          发送
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-outline-variant/20 px-3 py-2 text-sm text-on-surface-variant hover:bg-surface-container-low"
        >
          取消
        </button>
      </form>
      <div className="mt-2 text-[11px] text-outline/70">
        需要时再问一句即可，不用切到整页聊天。
      </div>
    </div>
  );
}

export type IntelligenceFeedAgentJob = {
  id: string;
  status: string;
  type: string;
  noteTitle: string;
  ui: {
    headline: string;
    progress: number;
    currentStepLabel: string | null;
    steps: { id: string; label: string; status: string; toolSummary?: string }[];
    generatedNotes?: { id: string; title: string }[];
  };
};

export function IntelligenceFeed({
  cards,
  loading,
  error,
  activeAgentJobs,
  graphJobs,
  pendingJobs,
  selectedAgentJobId,
  onSelectAgentJob,
  onAsk,
  onAfterReviewScore,
}: {
  /** null = 加载中；undefined = 未请求（演示数据）；有数组 = 接口结果（可为空） */
  cards?: IntelligenceFeedCard[] | null;
  loading?: boolean;
  error?: string | null;
  /** 自治 Agent 进行中任务（来自 GET /api/nextclaw/feed.activeJobs） */
  activeAgentJobs?: IntelligenceFeedAgentJob[] | null;
  /** 右侧迁移而来的图谱数据源（含 capture 任务） */
  graphJobs?: IntelligenceFeedAgentJob[] | null;
  pendingJobs?: number;
  /** 若指定，则优先展示该 job 的工作流 */
  selectedAgentJobId?: string | null;
  onSelectAgentJob?: (jobId: string) => void;
  onAsk?: (payload: { cardId: string; noteId?: string; text: string }) => void;
  onAfterReviewScore?: () => void;
}) {
  const demoCards = useMemo<IntelligenceFeedCard[]>(
    () => [
      {
        id: "demo-conflict",
        type: "conflict",
        dbType: "CONFLICT",
        badgeLabel: "示例",
        title: "水合错误：客户端与服务端渲染结果不一致",
        summary:
          "检测到组件树在首屏渲染时存在非确定性分支。优先排查：依赖时间/随机数、条件渲染、useEffect 里改写结构。",
        metaLeft: "Claw Agent · 冲突卡",
        metaRight: "演示",
        codeA: "useEffect(() => { setMounted(true) }, [])",
        codeB: "const data = use(promise)",
      },
      {
        id: "demo-external",
        type: "external_update",
        dbType: "EXTERNAL",
        badgeLabel: "示例",
        title: "Next.js 版本更新：运行时与缓存语义变化",
        summary:
          "从你的笔记指纹推断：你正在触及 App Router + 数据缓存。建议先确认升级路径与 breaking changes，再决定是否切换默认 bundler。",
        metaLeft: "External · 变更卡",
        metaRight: "演示",
        chips: ["React 19", "Turbopack 默认", "Fetch 缓存 v2"],
      },
      {
        id: "demo-review",
        type: "review",
        dbType: "REVIEW",
        badgeLabel: "示例",
        title: "复习任务：Server Actions（第 4 次）",
        summary:
          "你的留存曲线进入 L4 阶段。今天的最小动作：用 1 句话写清 revalidate 的触发点，并用一个例子区分 path/tag。",
        metaLeft: "Smart Ebbinghaus · 复习卡",
        metaRight: "演示",
        review: {
          reviewItemId: "demo-review-item",
          progressLabel: "第 4 次复习 / 84% 留存",
          dueLabel: "下一次：+3 天",
          prompt: "Server Actions 如何处理重新校验（revalidatePath / revalidateTag）？分别适用于什么场景？",
        },
      },
    ],
    [],
  );

  const data = useMemo(() => {
    if (loading || cards === null) return [];
    if (cards === undefined) return demoCards;
    return cards;
  }, [cards, demoCards, loading]);

  const isDemo = cards === undefined;
  const [activeFilter, setActiveFilter] = useState<FeedDbType | "__all__">("__all__");
  const [localCards, setLocalCards] = useState<IntelligenceFeedCard[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);

  const [askOpen, setAskOpen] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [answerByCardId, setAnswerByCardId] = useState<Record<string, string>>({});
  const [aiBusyByCardId, setAiBusyByCardId] = useState<Record<string, boolean>>({});
  const [aiErrorByCardId, setAiErrorByCardId] = useState<Record<string, string | null>>({});
  const [aiResultByCardId, setAiResultByCardId] = useState<
    Record<
      string,
      | {
          lastScore: number;
          feedback?: string;
          matchedKeyPoints?: string[];
          missingKeyPoints?: string[];
        }
      | undefined
    >
  >({});

  const filterDefs: { key: FeedDbType; label: string }[] = [
    { key: "AUDIT", label: "审计" },
    { key: "REVIEW", label: "复习" },
    { key: "RELATED", label: "关联" },
    { key: "FILL_GAP", label: "查漏补缺" },
    { key: "PITFALL", label: "踩坑" },
    { key: "CONFLICT", label: "冲突" },
    { key: "EXTERNAL", label: "外部" },
  ];

  const filterCountMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of localCards) {
      const k = c.dbType ?? "EXTERNAL";
      m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  }, [localCards]);

  const filteredData = useMemo(() => {
    if (activeFilter === "__all__") return localCards;
    return localCards.filter((c) => c.dbType === activeFilter);
  }, [activeFilter, localCards]);

  async function submitReviewAnswer(cardId: string, reviewItemId: string) {
    const answer = (answerByCardId[cardId] ?? "").trim();
    if (!answer) return;
    if (isDemo) return;
    if (aiBusyByCardId[cardId]) return;

    setAiErrorByCardId((m) => ({ ...m, [cardId]: null }));
    setAiBusyByCardId((m) => ({ ...m, [cardId]: true }));
    try {
      const r = await fetch("/api/nextclaw/review/score", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewItemId, learningCardId: cardId, answer }),
      });
      const data = (await r.json().catch(() => null)) as { error?: string } & {
        lastScore?: number;
        aiParsed?: { feedback?: string; matchedKeyPoints?: string[]; missingKeyPoints?: string[] };
      };
      if (!r.ok) throw new Error(data?.error || `AI 评分失败：HTTP ${r.status}`);

      setAiResultByCardId((m) => ({
        ...m,
        [cardId]: {
          lastScore: typeof data.lastScore === "number" ? data.lastScore : 0,
          feedback: data.aiParsed?.feedback,
          matchedKeyPoints: data.aiParsed?.matchedKeyPoints,
          missingKeyPoints: data.aiParsed?.missingKeyPoints,
        },
      }));

      onAfterReviewScore?.();
    } catch (e) {
      setAiErrorByCardId((m) => ({ ...m, [cardId]: e instanceof Error ? e.message : "AI 评分失败" }));
    } finally {
      setAiBusyByCardId((m) => ({ ...m, [cardId]: false }));
    }
  }

  async function deleteCard(cardId: string) {
    if (isDemo) return;
    setDeleting(cardId);
    try {
      const r = await fetch("/api/nextclaw/feed", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string };
      if (!r.ok) throw new Error(j?.error || "删除失败");
      setLocalCards((prev) => prev.filter((x) => x.id !== cardId));
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(null);
    }
  }

  async function deleteAllCards() {
    if (isDemo) return;
    if (!window.confirm("确定清空全部学习卡片吗？此操作不可撤销。")) return;
    setDeleting("__all__");
    try {
      const r = await fetch("/api/nextclaw/feed", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string };
      if (!r.ok) throw new Error(j?.error || "清空失败");
      setLocalCards([]);
    } catch (e) {
      alert(e instanceof Error ? e.message : "清空失败");
    } finally {
      setDeleting(null);
    }
  }

  const liveAgentJob = useMemo(() => {
    const jobs = Array.isArray(activeAgentJobs) ? activeAgentJobs : [];
    if (selectedAgentJobId) {
      const picked = jobs.find((j) => j.id === selectedAgentJobId);
      if (picked) return picked;
    }
    return jobs[0] ?? null;
  }, [activeAgentJobs, selectedAgentJobId]);
  const [hitlUrl, setHitlUrl] = useState("");
  const [hitlBusy, setHitlBusy] = useState(false);
  const [hitlError, setHitlError] = useState<string | null>(null);

  useEffect(() => {
    setLocalCards(data);
  }, [data]);

  const needUrl = Boolean(liveAgentJob?.ui.steps?.some((s) => s.id === "hitl-need-url"));

  async function submitHitlUrl() {
    if (!liveAgentJob) return;
    const url = hitlUrl.trim();
    if (!url) return;
    setHitlBusy(true);
    setHitlError(null);
    try {
      const r = await fetch(`/api/nextclaw/tasks/${liveAgentJob.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "override_source", url }),
      });
      const data = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(data?.error || "提交来源失败");
      setHitlUrl("");
    } catch (e) {
      setHitlError(e instanceof Error ? e.message : "提交来源失败");
    } finally {
      setHitlBusy(false);
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-outline-variant/10 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="font-headline text-sm font-black tracking-tight text-on-surface">学习卡片</h2>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
              这里集中显示：哪里可能记拧了、哪里要补一句、今天该复习什么。点卡片可看细节。
            </p>
            {error ? <p className="mt-2 text-xs text-error">{error}</p> : null}
            {!loading ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveFilter("__all__")}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                    activeFilter === "__all__"
                      ? "border-black bg-black text-white"
                      : "border-black/10 bg-white text-neutral-600 hover:border-black/20 hover:bg-[#f7f7f5]"
                  }`}
                >
                  全部（{localCards.length}）
                </button>
                {filterDefs.map((f) => {
                  const active = activeFilter === f.key;
                  const count = filterCountMap[f.key] ?? 0;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setActiveFilter((prev) => (prev === f.key ? "__all__" : f.key))}
                      className={`rounded-full border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                        active
                          ? "border-black bg-black text-white"
                          : "border-black/10 bg-white text-neutral-600 hover:border-black/20 hover:bg-[#f7f7f5]"
                      }`}
                    >
                      {f.label}（{count}）
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => void deleteAllCards()}
                  disabled={deleting === "__all__" || localCards.length === 0}
                  className="rounded-full border border-red-200 bg-white px-3 py-1.5 text-[11px] font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                >
                  {deleting === "__all__" ? "清空中…" : "全删"}
                </button>
              </div>
            ) : null}
          </div>
          <div className="hidden items-center gap-2 text-[11px] font-bold text-outline xl:flex">
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-outline-variant/20 bg-surface-container-low/60 px-2 py-1">
              <GitBranch className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">信号：笔记冲突</span>
            </span>
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-outline-variant/20 bg-surface-container-low/60 px-2 py-1">
              <Pin className="h-3.5 w-3.5" />
              <span className="whitespace-nowrap">任务：今日复习</span>
            </span>
          </div>
        </div>
      </div>

      <div className="no-scrollbar min-h-0 flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
        {liveAgentJob ? (
          <div className="shrink-0 rounded-2xl border border-primary/30 bg-primary/5 p-4 shadow-sm backdrop-blur-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-primary/25 bg-primary/10">
                    <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-on-surface">Agent 实时工作流</div>
                    <div className="mt-0.5 truncate text-[11px] text-on-surface-variant">
                      {liveAgentJob.noteTitle}
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[11px] text-on-surface-variant">
                  <span className="font-bold text-outline/90">{liveAgentJob.ui.headline}</span>
                  {liveAgentJob.ui.currentStepLabel ? (
                    <>
                      <span className="mx-1 opacity-40">·</span>
                      <span>{liveAgentJob.ui.currentStepLabel}</span>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="shrink-0 rounded-md bg-surface-container-high/50 px-2 py-1 text-[10px] font-bold text-outline">
                  {liveAgentJob.type === "NOTE_LEARN_DEEP" ? "深度模式" : "轻量模式"}
                </span>
              </div>
            </div>

            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest/50">
              <div
                className="h-full rounded-full bg-primary/85 transition-[width] duration-300"
                style={{ width: `${Math.round((liveAgentJob.ui.progress ?? 0) * 100)}%` }}
              />
            </div>

            {liveAgentJob.ui.steps?.length ? (
              <div className="mt-3 rounded-xl border border-outline-variant/12 bg-surface-container-lowest/25 p-2">
                <NextClawWorkflowGraph steps={liveAgentJob.ui.steps} />
              </div>
            ) : null}

            {needUrl ? (
              <div className="mt-3 rounded-xl border border-primary/25 bg-primary/10 p-3">
                <div className="text-[11px] font-black text-primary">需要你提供来源 URL</div>
                <div className="mt-1 text-[11px] leading-snug text-on-surface-variant">
                  搜索无结果或不可用。粘贴一个可阅读的网页 URL，Agent 会从该来源继续执行。
                </div>
                {hitlError ? <div className="mt-1 text-[11px] font-bold text-error">{hitlError}</div> : null}
                <div className="mt-2 flex items-center gap-2">
                  <input
                    value={hitlUrl}
                    onChange={(e) => setHitlUrl(e.target.value)}
                    placeholder="https://..."
                    className="min-w-0 flex-1 rounded-lg border border-outline-variant/20 bg-surface-container-low/40 px-3 py-2 text-[12px] text-on-surface outline-none placeholder:text-outline/45 focus:ring-1 focus:ring-primary/25"
                  />
                  <button
                    type="button"
                    disabled={hitlBusy}
                    onClick={() => void submitHitlUrl()}
                    className="shrink-0 rounded-lg bg-primary px-3 py-2 text-[12px] font-black text-white hover:bg-primary/90 disabled:opacity-50"
                  >
                    {hitlBusy ? "提交中…" : "继续"}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {(graphJobs?.length ?? 0) > 0 ? (
          <div className="shrink-0 rounded-2xl border border-outline-variant/12 bg-surface-container-low/20 p-2">
            <div className="h-[62vh] min-h-[560px] overflow-hidden rounded-xl">
              <AgentOpsPanel
                loading={loading}
                jobs={Array.isArray(graphJobs) ? graphJobs : []}
                pendingJobs={typeof pendingJobs === "number" ? pendingJobs : 0}
                selectedJobId={selectedAgentJobId}
                onSelectJob={onSelectAgentJob}
              />
            </div>
          </div>
        ) : null}

        {loading || cards === null ? (
          <div className="shrink-0 rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/30 px-4 py-3 text-center text-xs text-on-surface-variant">
            正在加载智能流…
          </div>
        ) : null}

        {!loading && localCards.length === 0 ? (
          <div className="shrink-0 rounded-2xl border border-dashed border-outline-variant/25 bg-surface-container-lowest/20 px-4 py-3 text-center">
            <p className="text-xs font-bold text-on-surface">暂无学习卡片</p>
            <p className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
              在笔记中保存内容后，可通过「学习队列」触发{" "}
              <code className="rounded bg-surface-container-high px-1 text-[11px]">POST /api/notes/[id]/learning-enqueue</code>{" "}
              或定时任务 <code className="rounded bg-surface-container-high px-1 text-[11px]">POST /api/internal/learning/run-jobs</code>{" "}
              生成卡片。
            </p>
          </div>
        ) : null}

        {localCards.length > 0 ? (
        <div className="shrink-0 space-y-3">
          {filteredData.map((c) => {
          const open = !!askOpen[c.id];
          const isExpanded = !!expanded[c.id];
          const hasDetails = !!(c.chips?.length || c.codeA || c.codeB || c.review);
          const action = cardActionMeta(c);
          return (
            <article
              key={c.id}
              className="group rounded-xl border border-black/10 bg-white p-4 shadow-sm transition-colors hover:border-black/25"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTypeBadge type={c.type} label={c.badgeLabel} />
                    <span className={`rounded-md border px-2 py-1 text-[11px] font-bold ${action.tone}`}>
                      {action.label}
                    </span>
                  </div>
                  <h3 className="mt-2 font-headline text-base font-extrabold leading-snug tracking-tight text-neutral-950">
                    {c.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-medium text-neutral-500">
                    <span>{c.metaLeft}</span>
                    <span className="opacity-40">·</span>
                    <span>{c.metaRight}</span>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => void deleteCard(c.id)}
                    disabled={deleting === c.id}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-red-200 bg-white px-2 py-1.5 text-[11px] font-bold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-40"
                    aria-label="删除卡片"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {deleting === c.id ? "删除中" : "删除"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpanded((s) => ({ ...s, [c.id]: !s[c.id] }))}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-black/10 bg-white px-2 py-1.5 text-[11px] font-bold text-neutral-600 transition-colors hover:border-black/20 hover:bg-[#f7f7f5] hover:text-black"
                    aria-label={isExpanded ? "收起详情" : "展开详情"}
                  >
                    {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    {isExpanded ? "收起" : "展开"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setAskOpen((s) => ({ ...s, [c.id]: !s[c.id] }))}
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-sm font-bold text-neutral-600 opacity-0 transition-all hover:border-black/20 hover:bg-[#f7f7f5] hover:text-black group-hover:opacity-100 focus:opacity-100"
                    aria-label="追问"
                  >
                    <MessageSquarePlus className="h-3.5 w-3.5" />
                    追问
                  </button>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-black/10 bg-[#fbfbfa] px-3 py-2">
                <div className="text-[10px] font-black uppercase text-neutral-400">下一步</div>
                <div className="mt-1 text-xs font-semibold leading-5 text-neutral-700">{action.hint}</div>
              </div>

              <p className="mt-3 line-clamp-3 text-sm leading-7 text-neutral-700">{c.summary}</p>

              {!isExpanded && hasDetails ? (
                <div className="mt-2 text-[11px] font-medium text-neutral-500">
                  展开后处理细节、自测题或证据片段。
                </div>
              ) : null}

              {isExpanded ? (
                <div className="mt-3 rounded-xl border border-black/10 bg-white p-3">
                  <div className="text-[10px] font-black uppercase text-neutral-400">卡片正文</div>
                  <p className="mt-1 whitespace-pre-wrap text-xs leading-6 text-neutral-700">{c.contentMd ?? c.summary}</p>
                </div>
              ) : null}

              {isExpanded && c.sourceNotes?.length ? (
                <div className="mt-3 rounded-xl border border-black/10 bg-[#fbfbfa] p-3">
                  <div className="text-[10px] font-black uppercase text-neutral-400">证据来源</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.sourceNotes.map((source) => (
                      <a
                        key={source.noteId}
                        href={`/notes/${source.noteId}`}
                        className="rounded-full border border-black/10 bg-white px-2.5 py-1 text-[11px] font-bold text-neutral-700 transition-colors hover:border-black/30 hover:text-black"
                      >
                        {source.title}
                      </a>
                    ))}
                  </div>
                </div>
              ) : null}

              {isExpanded && c.chips?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {c.chips.map((x) => (
                    <span
                      key={x}
                      className="rounded-md border border-outline-variant/12 bg-surface-container-low/30 px-2 py-1 text-[11px] text-on-surface"
                    >
                      {x}
                    </span>
                  ))}
                </div>
              ) : null}

              {isExpanded && (c.codeA || c.codeB) ? (
                <div className="mt-3.5 grid grid-cols-1 gap-2 md:grid-cols-2">
                  {c.codeA ? (
                    <div className="rounded-xl border border-red-200 bg-red-50/60 p-3">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-700">冲突片段</div>
                      <pre className="overflow-x-auto text-[11px] leading-relaxed text-red-800">
                        <code>{c.codeA}</code>
                      </pre>
                    </div>
                  ) : null}
                  {c.codeB ? (
                    <div className="rounded-xl border border-black/10 bg-[#f7f7f5] p-3">
                      <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-neutral-700">修复候选</div>
                      <pre className="overflow-x-auto text-[11px] leading-relaxed text-neutral-800">
                        <code>{c.codeB}</code>
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {isExpanded && c.review ? (
                <div className="mt-3.5 rounded-xl border border-black/10 bg-[#fbfbfa] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[11px] font-bold text-on-surface-variant">当前掌握进度</div>
                    <div className="text-[11px] font-black text-primary">{c.review.progressLabel}</div>
                  </div>
                  <div className="mt-3 rounded-lg border border-black/10 bg-white p-3 text-xs text-neutral-600">
                    <div className="text-[11px] font-bold text-on-surface">自测题</div>
                    <div className="mt-1 text-[12px] leading-relaxed">{c.review.prompt}</div>
                    <div className="mt-2 text-[10px] text-outline/70">{c.review.dueLabel}</div>
                    <div className="mt-3">
                      <div className="mb-1 text-[10px] font-bold text-outline/70">写下你的回答（AI 会自动评分 + 解析）</div>
                      <textarea
                        value={answerByCardId[c.id] ?? ""}
                        onChange={(e) => setAnswerByCardId((m) => ({ ...m, [c.id]: e.target.value }))}
                        rows={3}
                        placeholder="用你自己的话回答…（越具体越好）"
                        className="min-h-[72px] w-full resize-none rounded-lg border border-black/10 bg-white px-3 py-2 text-xs leading-relaxed text-neutral-900 outline-none focus:ring-1 focus:ring-black/20"
                      />
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <button
                          type="button"
                          disabled={isDemo || !!aiBusyByCardId[c.id]}
                          onClick={() => submitReviewAnswer(c.id, c.review!.reviewItemId)}
                          className="rounded-lg bg-black px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {aiBusyByCardId[c.id] ? "AI 评分中…" : "提交并 AI 评分"}
                        </button>
                        <div className="text-[10px] text-outline/70">0-5 分将用于 SM2 更新</div>
                      </div>

                      {aiErrorByCardId[c.id] ? (
                        <div className="mt-2 text-[10px] font-bold text-error">{aiErrorByCardId[c.id]}</div>
                      ) : null}

                      {aiResultByCardId[c.id] ? (
                        <div className="mt-3 rounded-lg border border-black/10 bg-[#f7f7f5] p-3">
                          <div className="text-[10px] font-bold text-on-surface-variant">AI 解析结果</div>
                          <div className="mt-1 text-[11px] font-bold text-primary">
                            评分：{aiResultByCardId[c.id]?.lastScore}/5
                          </div>
                          {aiResultByCardId[c.id]?.feedback ? (
                            <div className="mt-1 text-[10px] leading-relaxed text-on-surface-variant/90">
                              {aiResultByCardId[c.id]?.feedback}
                            </div>
                          ) : null}

                          {aiResultByCardId[c.id]?.matchedKeyPoints?.length ? (
                            <div className="mt-2 text-[10px] font-bold text-outline/70">
                              匹配要点：{aiResultByCardId[c.id]?.matchedKeyPoints?.slice(0, 3).join("；")}
                            </div>
                          ) : null}
                          {aiResultByCardId[c.id]?.missingKeyPoints?.length ? (
                            <div className="mt-1 text-[10px] font-bold text-outline/70">
                              缺失要点：{aiResultByCardId[c.id]?.missingKeyPoints?.slice(0, 3).join("；")}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}

              <InlineAsk
                open={open}
                onClose={() => setAskOpen((s) => ({ ...s, [c.id]: false }))}
                onSubmit={(text) => onAsk?.({ cardId: c.id, noteId: c.noteId, text })}
              />
            </article>
          );
          })}

          {!loading && filteredData.length === 0 && localCards.length > 0 ? (
            <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-lowest/20 px-4 py-2 text-center text-[11px] text-on-surface-variant">
              当前筛选下暂无卡片，切换上方标签查看其它类型。
            </div>
          ) : null}
        </div>
        ) : null}
      </div>
    </section>
  );
}

