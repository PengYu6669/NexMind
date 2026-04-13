"use client";

import { Bot, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";

type AgentJob = {
  id: string;
  status: string;
  type: string;
  noteTitle: string;
  ui: {
    headline: string;
    progress: number;
    currentStepLabel: string | null;
    steps: { id: string; label: string; status: string; toolSummary?: string }[];
  };
};

function statusIcon(status: string) {
  if (status === "RUNNING") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "PENDING") return <Clock3 className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "SUCCEEDED") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "FAILED") return <XCircle className="h-3.5 w-3.5 text-error" />;
  return <Bot className="h-3.5 w-3.5 text-outline" />;
}

type RoleKey = "planner" | "retriever" | "auditor" | "coach" | "scheduler";

const ROLE_LABELS: Array<{ key: RoleKey; label: string }> = [
  { key: "planner", label: "Planner" },
  { key: "retriever", label: "Retriever" },
  { key: "auditor", label: "Auditor" },
  { key: "coach", label: "Coach" },
  { key: "scheduler", label: "Scheduler" },
];

function roleFromStep(step: { label: string; toolSummary?: string; toolName?: string }): RoleKey | null {
  const label = (step.label || "").toLowerCase();
  const summary = (step.toolSummary || "").toLowerCase();
  const toolName = (step.toolName || "").toLowerCase();
  if (label.includes("planner")) return "planner";
  if (label.includes("retriever")) return "retriever";
  if (label.includes("auditor")) return "auditor";
  if (label.includes("coach")) return "coach";
  if (label.includes("scheduler")) return "scheduler";
  if (toolName === "search_notes" || toolName === "web_search" || toolName === "fetch_url" || toolName === "read_note") return "retriever";
  if (toolName === "audit_content") return "auditor";
  if (toolName === "synthesize") return "coach";
  if (summary.includes("planner=") && summary.includes("scheduler=")) return "scheduler";
  return null;
}

function roleStatusForJob(job: AgentJob): Array<{ key: RoleKey; label: string; status: string }> {
  const state = new Map<RoleKey, string>();
  for (const r of ROLE_LABELS) state.set(r.key, "idle");
  for (const s of job.ui.steps) {
    const role = roleFromStep(s);
    if (!role) continue;
    // running > failed > done > idle
    const prev = state.get(role) ?? "idle";
    if (s.status === "running") state.set(role, "running");
    else if (s.status === "failed" && prev !== "running") state.set(role, "failed");
    else if (s.status === "done" && prev === "idle") state.set(role, "done");
  }
  return ROLE_LABELS.map((r) => ({ key: r.key, label: r.label, status: state.get(r.key) ?? "idle" }));
}

export function AgentOpsPanel({
  jobs,
  pendingJobs,
  loading,
  selectedJobId,
  onSelectJob,
}: {
  jobs: AgentJob[];
  pendingJobs: number;
  loading?: boolean;
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-outline-variant/10 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="truncate font-headline text-sm font-black tracking-tight text-on-surface">Agent 列表</h2>
          </div>
          <span className="rounded-md border border-outline-variant/20 bg-surface-container-low/40 px-2 py-0.5 text-[11px] font-bold text-on-surface-variant">
            队列 {pendingJobs}
          </span>
        </div>
        <p className="mt-1 text-xs text-on-surface-variant">聚焦任务进程，不展示非核心分析组件</p>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/20 px-3 py-4 text-center text-xs text-on-surface-variant">
            正在加载 Agent 任务…
          </div>
        ) : jobs.length === 0 ? (
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/20 px-3 py-4 text-center text-xs text-on-surface-variant">
            当前没有运行中的 Agent 任务
          </div>
        ) : (
          jobs.map((job) => {
            const selected = selectedJobId === job.id;
            return (
            <button
              key={job.id}
              type="button"
              onClick={() => onSelectJob?.(job.id)}
              className={`w-full rounded-xl border p-3 text-left transition-colors ${
                selected
                  ? "border-primary/35 bg-primary/10"
                  : "border-outline-variant/15 bg-surface-container-low/25 hover:bg-surface-container-low/35"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold text-on-surface">{job.noteTitle}</div>
                  <div className="mt-0.5 text-[10px] text-on-surface-variant">{job.type}</div>
                </div>
                <div className="flex items-center gap-1 rounded-md bg-surface-container-highest/35 px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">
                  {statusIcon(job.status)}
                  <span>{job.status}</span>
                </div>
              </div>

              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-container-highest/50">
                <div
                  className="h-full rounded-full bg-primary/85 transition-[width] duration-300"
                  style={{ width: `${Math.max(0, Math.min(100, Math.round((job.ui.progress ?? 0) * 100)))}%` }}
                />
              </div>

              <div className="mt-2 text-[11px] font-semibold text-primary/90">{job.ui.headline}</div>
              {job.ui.currentStepLabel ? (
                <div className="mt-1 text-[11px] leading-snug text-on-surface-variant">{job.ui.currentStepLabel}</div>
              ) : null}

              <div className="mt-2 rounded-lg border border-outline-variant/12 bg-surface-container-lowest/20 p-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-outline/80">角色协作状态</div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {roleStatusForJob(job).map((r) => (
                    <div key={`${job.id}-${r.key}`} className="flex items-center justify-between rounded-md border border-outline-variant/10 bg-surface-container-highest/20 px-2 py-1">
                      <span className="text-[10px] font-semibold text-on-surface">{r.label}</span>
                      <span className="inline-flex items-center gap-1 text-[10px] text-on-surface-variant">
                        {statusIcon(
                          r.status === "idle"
                            ? "PENDING"
                            : r.status === "done"
                              ? "SUCCEEDED"
                              : r.status === "failed"
                                ? "FAILED"
                                : "RUNNING",
                        )}
                        {r.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </button>
          )})
        )}
      </div>
    </section>
  );
}
