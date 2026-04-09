"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type LearningCardDto = {
  id: string;
  type: string;
  title: string;
  contentMd: string;
  createdAt: string;
};

type LearningJobDto = {
  id: string;
  type: string;
  status: string;
  priority: number;
  runAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  attempts: number;
  lastError: string | null;
  createdAt: string;
};

type LearningCardsResponse = {
  cards: LearningCardDto[];
  jobs: LearningJobDto[];
  error?: string;
};

function jobTypeLabel(t: string) {
  if (t === "NOTE_LEARN_LITE") return "轻量";
  if (t === "NOTE_LEARN_DEEP") return "深度";
  if (t === "NOTE_EXTERNAL_INJECT") return "外部注入";
  return t;
}

function jobStatusLabel(s: string) {
  const map: Record<string, string> = {
    PENDING: "待执行",
    RUNNING: "执行中",
    SUCCEEDED: "成功",
    FAILED: "失败",
    SKIPPED: "已跳过",
    CANCELLED: "已取消",
  };
  return map[s] ?? s;
}

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

export function NoteLearningCards({ noteId }: { noteId: string }) {
  const [open, setOpen] = useState(true);
  const [queueOpen, setQueueOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<LearningCardDto[]>([]);
  const [jobs, setJobs] = useState<LearningJobDto[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? false;
    setError(null);
    if (!silent) setLoading(true);
    try {
      const res = await fetch(`/api/notes/${noteId}/learning-cards`, { credentials: "include" });
      const dataUnknown = (await res.json().catch(() => null)) as unknown;
      const data = (dataUnknown && typeof dataUnknown === "object" ? dataUnknown : {}) as Partial<LearningCardsResponse>;
      if (!res.ok) throw new Error(data.error || "加载学习卡片失败");
      setCards(Array.isArray(data.cards) ? data.cards : []);
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载学习卡片失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [noteId]);

  async function enqueue(mode: "lite" | "deep") {
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}/learning-enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ mode }),
      });
      const dataUnknown = (await res.json().catch(() => null)) as unknown;
      const data = (dataUnknown && typeof dataUnknown === "object" ? dataUnknown : {}) as {
        error?: string;
        code?: string;
        detail?: string;
      };
      if (!res.ok) {
        const parts = [data.error, data.detail].filter(Boolean).join(" ");
        throw new Error(parts || `触发学习失败 (${res.status})`);
      }
      await refresh({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "触发学习失败");
    }
  }

  async function deleteJob(jobId: string, status: string) {
    if (status === "RUNNING") return;
    setError(null);
    setDeletingId(jobId);
    try {
      const res = await fetch(`/api/notes/${noteId}/learning-jobs/${jobId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const dataUnknown = (await res.json().catch(() => null)) as unknown;
      const data = (dataUnknown && typeof dataUnknown === "object" ? dataUnknown : {}) as { error?: string };
      if (!res.ok) throw new Error(data.error || "删除失败");
      await refresh({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeletingId(null);
    }
  }

  useEffect(() => {
    void refresh({ silent: false });
  }, [noteId, refresh]);

  const hasRunning = useMemo(() => jobs.some((j) => j.status === "PENDING" || j.status === "RUNNING"), [jobs]);

  useEffect(() => {
    if (!hasRunning) return;
    const t = window.setInterval(() => void refresh({ silent: true }), 5000);
    return () => window.clearInterval(t);
  }, [hasRunning, refresh]);

  return (
    <section className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-5">
      <button
        type="button"
        className="w-full flex items-center justify-between gap-3"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">NextClaw 学习卡片</span>
          {hasRunning ? (
            <span className="text-[10px] font-bold text-primary">生成中…</span>
          ) : null}
        </div>
        <MaterialIcon name={open ? "expand_less" : "expand_more"} className="text-slate-400" />
      </button>

      {open ? (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-xl bg-primary/15 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/20 disabled:opacity-60"
              onClick={() => void enqueue("lite")}
              disabled={loading}
            >
              触发轻量学习
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary-container px-3 py-2 text-xs font-bold text-on-primary-container hover:bg-primary-container/90 disabled:opacity-60"
              onClick={() => void enqueue("deep")}
              disabled={loading}
            >
              深度学习
            </button>
            <button
              type="button"
              className="ml-auto rounded-xl px-3 py-2 text-xs text-on-surface-variant hover:bg-white/5 disabled:opacity-60"
              onClick={() => void refresh({ silent: true })}
              disabled={loading}
            >
              刷新
            </button>
          </div>

          {error ? (
            <p className="text-xs text-on-error-container bg-error-container/10 border border-error-container/30 px-3 py-2 rounded-xl">
              {error}
            </p>
          ) : null}

          <div className="rounded-xl border border-outline-variant/15 bg-surface-container/30 overflow-hidden">
            <button
              type="button"
              className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-white/5"
              onClick={() => setQueueOpen((v) => !v)}
            >
              <span className="text-[11px] font-bold text-on-surface-variant">
                学习任务队列
                <span className="ml-2 font-normal text-slate-500">（本笔记最近 {jobs.length} 条）</span>
              </span>
              <MaterialIcon name={queueOpen ? "expand_less" : "expand_more"} className="text-slate-400 shrink-0" />
            </button>
            {queueOpen ? (
              <div className="border-t border-outline-variant/10 px-3 pb-3 pt-1 max-h-[280px] overflow-auto">
                <p className="text-[10px] text-slate-500 pb-2 leading-relaxed">
                  入队后会在当前请求结束后自动依次执行；执行中的任务不可删除。
                </p>
                {jobs.length === 0 ? (
                  <p className="text-xs text-on-surface-variant py-2">暂无任务。保存长文或点击上方按钮后会在此出现记录。</p>
                ) : (
                  <table className="w-full text-left text-[11px] border-collapse">
                    <thead>
                      <tr className="text-slate-500 border-b border-outline-variant/10">
                        <th className="py-1.5 pr-2 font-semibold">类型</th>
                        <th className="py-1.5 pr-2 font-semibold">状态</th>
                        <th className="py-1.5 pr-2 font-semibold hidden sm:table-cell">创建</th>
                        <th className="py-1.5 pr-2 font-semibold hidden md:table-cell">结束</th>
                        <th className="py-1.5 pl-1 font-semibold text-right w-[52px]">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {jobs.map((j) => (
                        <tr key={j.id} className="border-b border-outline-variant/5 align-top">
                          <td className="py-2 pr-2 text-on-surface whitespace-nowrap">{jobTypeLabel(j.type)}</td>
                          <td className="py-2 pr-2">
                            <span
                              className={
                                j.status === "SUCCEEDED"
                                  ? "text-green-600 dark:text-green-400"
                                  : j.status === "FAILED"
                                    ? "text-red-600 dark:text-red-400"
                                    : j.status === "PENDING" || j.status === "RUNNING"
                                      ? "text-primary font-semibold"
                                      : "text-on-surface-variant"
                              }
                            >
                              {jobStatusLabel(j.status)}
                            </span>
                            {j.attempts > 1 ? (
                              <span className="text-slate-500 ml-1">×{j.attempts}</span>
                            ) : null}
                          </td>
                          <td className="py-2 pr-2 text-on-surface-variant hidden sm:table-cell whitespace-nowrap">
                            {fmtTime(j.createdAt)}
                          </td>
                          <td className="py-2 pr-2 text-on-surface-variant hidden md:table-cell whitespace-nowrap">
                            {fmtTime(j.finishedAt)}
                          </td>
                          <td className="py-2 pl-1 text-right">
                            {j.status === "RUNNING" ? (
                              <span className="text-[10px] text-slate-500">—</span>
                            ) : (
                              <button
                                type="button"
                                className="text-[10px] font-bold text-on-surface-variant hover:text-error"
                                disabled={deletingId === j.id}
                                onClick={() => void deleteJob(j.id, j.status)}
                              >
                                {deletingId === j.id ? "…" : "删除"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {jobs.some((j) => j.lastError) ? (
                  <div className="mt-2 space-y-1.5">
                    {jobs
                      .filter((j) => j.lastError)
                      .slice(0, 3)
                      .map((j) => (
                        <p key={`${j.id}-err`} className="text-[10px] text-on-surface-variant break-words bg-error-container/5 rounded-lg px-2 py-1.5 border border-error-container/20">
                          <span className="font-mono text-slate-500">{j.id.slice(0, 8)}…</span> {jobStatusLabel(j.status)}：{j.lastError}
                        </p>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {loading && cards.length === 0 ? (
            <p className="text-xs text-on-surface-variant">加载中…</p>
          ) : null}

          {!loading && cards.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              还没有学习卡片。保存后系统会自动入队（内容足够长时），你也可以手动触发一次。
            </p>
          ) : null}

          {cards.map((c) => (
            <article key={c.id} className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">{c.type}</p>
                  <h4 className="mt-1 text-sm font-bold text-on-surface truncate">{c.title}</h4>
                </div>
              </div>
              <pre className="mt-3 whitespace-pre-wrap text-xs text-on-surface-variant leading-relaxed">
                {c.contentMd}
              </pre>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}
