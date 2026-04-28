"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Clock,
  Globe,
  Layers,
  Loader2,
  MinusCircle,
  RefreshCcw,
  Sparkles,
  Trash2,
  XCircle,
  Zap,
} from "lucide-react";

type NoteOption = { id: string; title: string };
type TaskStepUi = {
  id: string;
  phase: string;
  label: string;
  status: string;
  toolName?: string;
  toolSummary?: string;
  at: string;
};

type TaskUi = {
  headline: string;
  progress: number;
  currentStepLabel: string | null;
  steps: TaskStepUi[];
};

type TaskItem = {
  id: string;
  noteId: string | null;
  noteTitle: string;
  type: "NOTE_LEARN_LITE" | "NOTE_LEARN_DEEP" | "NOTE_EXTERNAL_INJECT";
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "SKIPPED";
  attempts: number;
  lastError?: string | null;
  runAt: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
  plan?: unknown | null;
  steps?: unknown | null;
  ui?: TaskUi | null;
  result?: { noteUrl: string; latestCardId?: string | null } | null;
};

function typeIcon(type: TaskItem["type"]) {
  if (type === "NOTE_LEARN_DEEP") return Layers;
  if (type === "NOTE_EXTERNAL_INJECT") return Globe;
  return Zap;
}

function StatusGlyph({ status }: { status: TaskItem["status"] }) {
  if (status === "SUCCEEDED") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (status === "FAILED") return <XCircle className="h-3.5 w-3.5 shrink-0 text-error" aria-hidden />;
  if (status === "RUNNING") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />;
  if (status === "PENDING") return <Clock className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />;
  return <MinusCircle className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" aria-hidden />;
}

export function NextClawTaskDesk({
  onTasksChanged,
  className,
}: {
  onTasksChanged?: () => void;
  className?: string;
}) {
  const [notes, setNotes] = useState<NoteOption[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [createMode, setCreateMode] = useState<"capture" | "note">("capture");
  const [captureInput, setCaptureInput] = useState("");
  const [noteId, setNoteId] = useState("");
  const [learnMode, setLearnMode] = useState<"lite" | "deep">("lite");
  const [dragOver, setDragOver] = useState(false);
  const [feedFocused, setFeedFocused] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [autoExpandedOnce, setAutoExpandedOnce] = useState(false);
  const [noteDropdownOpen, setNoteDropdownOpen] = useState(false);
  const noteDropdownRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!noteDropdownOpen) return;
    const onDown = (e: MouseEvent) => {
      const el = noteDropdownRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) {
        setNoteDropdownOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [noteDropdownOpen]);

  const refresh = useCallback(async () => {
    setErr(null);
    const [notesRes, tasksRes] = await Promise.all([
      fetch("/api/notes?limit=30", { credentials: "include" }),
      fetch("/api/nextclaw/tasks", { credentials: "include" }),
    ]);
    if (!notesRes.ok || !tasksRes.ok) {
      throw new Error("加载任务工作台失败");
    }
    const notesData = (await notesRes.json()) as { notes?: NoteOption[] };
    const tasksData = (await tasksRes.json()) as { tasks?: TaskItem[] };
    setNotes(Array.isArray(notesData.notes) ? notesData.notes : []);
    setTasks(Array.isArray(tasksData.tasks) ? tasksData.tasks : []);
    if (!noteId && Array.isArray(notesData.notes) && notesData.notes[0]?.id) {
      setNoteId(notesData.notes[0].id);
    }
  }, [noteId]);

  useEffect(() => {
    (async () => {
      try {
        await refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [refresh]);

  const hasRunning = useMemo(
    () => tasks.some((t) => t.status === "PENDING" || t.status === "RUNNING"),
    [tasks]
  );

  useEffect(() => {
    if (!hasRunning) return;
    const t = window.setInterval(() => {
      void refresh().catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [hasRunning, refresh]);

  async function createTask() {
    setBusy(true);
    setErr(null);
    try {
      let targetNoteId = noteId;
      if (createMode === "capture") {
        const input = captureInput.trim();
        if (!input) throw new Error("请先输入 URL 或文本");
        const captureRes = await fetch("/api/capture?stream=1", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ input, mode: learnMode }),
        });
        if (!captureRes.ok || !captureRes.body) {
          const captureData = (await captureRes.json().catch(() => null)) as { noteId?: string; error?: string } | null;
          throw new Error(captureData?.error || "提取笔记失败");
        }

        const reader = captureRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let gotStarted = false;
        let finalNoteId: string | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";
          for (const blk of blocks) {
            const lines = blk.split("\n");
            const event = (lines.find((x) => x.startsWith("event:")) ?? "").replace(/^event:\s*/, "").trim();
            const dataLine = (lines.find((x) => x.startsWith("data:")) ?? "").replace(/^data:\s*/, "").trim();
            if (!event || !dataLine) continue;
            let payload: Record<string, unknown> = {};
            try {
              payload = JSON.parse(dataLine) as Record<string, unknown>;
            } catch {
              continue;
            }
            if (event === "job_started" && !gotStarted) {
              gotStarted = true;
              // 任务一创建就刷新，避免“发布任务卡住但列表没变化”
              await refresh();
              onTasksChanged?.();
            }
            if (event === "completed" || event === "done") {
              const noteIdFromPayload =
                typeof payload.noteId === "string" && payload.noteId ? payload.noteId : null;
              if (noteIdFromPayload) finalNoteId = noteIdFromPayload;
            }
            if (event === "error") {
              const msg = typeof payload.error === "string" ? payload.error : "提取笔记失败";
              throw new Error(msg);
            }
          }
        }
        if (!finalNoteId) throw new Error("提取完成但未返回 noteId");
        // Capture pipeline 已在服务端自动触发学习任务，无需手动 POST
        setCaptureInput("");
        await refresh();
        onTasksChanged?.();
        return;
      } else if (!targetNoteId) {
        throw new Error("请选择一个笔记");
      }

      const taskRes = await fetch("/api/nextclaw/tasks", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ noteId: targetNoteId, mode: learnMode }),
      });
      const taskData = (await taskRes.json().catch(() => null)) as { error?: string } | null;
      if (!taskRes.ok) throw new Error(taskData?.error || "发布任务失败");

      await refresh();
      onTasksChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTask(jobId: string) {
    setErr(null);
    const res = await fetch(`/api/nextclaw/tasks/${jobId}`, {
      method: "DELETE",
      credentials: "include",
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok) {
      setErr(data?.error || "删除任务失败");
      return;
    }
    await refresh();
    onTasksChanged?.();
    setExpandedId(null);
  }

  async function controlTask(task: TaskItem, action: "pause" | "resume") {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(`/api/nextclaw/tasks/${task.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await r.json().catch(() => null)) as { error?: string; job?: { id?: string } } | null;
      if (!r.ok) throw new Error(data?.error || "任务操作失败");
      await refresh();
      const nextJobId = typeof data?.job?.id === "string" ? data.job.id : null;
      if (nextJobId) setExpandedId(nextJobId);
      onTasksChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "任务操作失败");
    } finally {
      setBusy(false);
    }
  }


  const shownTasks = useMemo(() => {
    const rank = (s: TaskItem["status"]) => {
      if (s === "RUNNING") return 0;
      if (s === "PENDING") return 1;
      return 2;
    };
    return [...tasks].sort((a, b) => {
      const r = rank(a.status) - rank(b.status);
      if (r !== 0) return r;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [tasks]);

  const activeTaskId = useMemo(
    () => shownTasks.find((t) => t.status === "RUNNING" || t.status === "PENDING")?.id ?? null,
    [shownTasks]
  );

  useEffect(() => {
    if (!activeTaskId) return;
    if (autoExpandedOnce) return;
    setExpandedId(activeTaskId);
    setAutoExpandedOnce(true);
  }, [activeTaskId, autoExpandedOnce]);

  const feedGlow = feedFocused || dragOver;

  return (
    <div
      className={`mt-0 flex h-full min-h-0 flex-col rounded-2xl border border-outline-variant/10 bg-surface-container-lowest/15 p-3 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-on-surface">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate text-sm font-black">工作台</span>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="shrink-0 rounded-lg border border-outline-variant/15 p-1.5 text-on-surface-variant hover:bg-surface-container-low"
          aria-label="刷新"
        >
          <RefreshCcw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          onClick={() => setCreateMode("capture")}
          className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs font-bold transition-colors ${
            createMode === "capture"
              ? "border-primary/35 bg-primary/10 text-primary"
              : "border-outline-variant/15 bg-transparent text-on-surface-variant hover:bg-surface-container-low/50"
          }`}
        >
          链接提取
        </button>
        <button
          type="button"
          onClick={() => setCreateMode("note")}
          className={`min-w-0 flex-1 rounded-lg border px-2 py-1.5 text-xs font-bold transition-colors ${
            createMode === "note"
              ? "border-primary/35 bg-primary/10 text-primary"
              : "border-outline-variant/15 bg-transparent text-on-surface-variant hover:bg-surface-container-low/50"
          }`}
        >
          全库学习
        </button>
      </div>

      <div className="mt-2">
        {createMode === "capture" ? (
          <div
            className={`relative rounded-xl border border-dashed transition-shadow duration-200 ${
              dragOver ? "border-primary/50 bg-primary/5" : "border-outline-variant/20 bg-surface-container-low/30"
            } ${feedGlow ? "shadow-[0_0_0_3px_rgba(99,102,241,0.2)] ring-1 ring-primary/35" : ""}`}
          >
          <textarea
              value={captureInput}
              onChange={(e) => setCaptureInput(e.target.value)}
              onFocus={() => setFeedFocused(true)}
              onBlur={() => setFeedFocused(false)}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const text = e.dataTransfer.getData("text/plain")?.trim();
                if (text) setCaptureInput((prev) => (prev ? `${prev}\n${text}` : text));
              }}
              placeholder="链接 / 需求"
              className={`w-full resize-none rounded-xl border-0 bg-transparent px-2.5 pb-9 pt-2 text-xs leading-relaxed text-on-surface outline-none transition-[min-height] duration-200 placeholder:text-outline/45 ${
                feedFocused ? "min-h-[6.75rem]" : "min-h-[3rem]"
              }`}
            />
            <div className="absolute bottom-1.5 right-1.5">
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void createTask()}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-black text-white shadow-sm transition hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                发布任务
              </button>
            </div>
          </div>
        ) : (
          <div
            className={`rounded-xl border border-outline-variant/20 bg-surface-container-low/30 transition-shadow duration-200 ${
              feedFocused ? "shadow-[0_0_0_3px_rgba(99,102,241,0.2)] ring-1 ring-primary/35" : ""
            }`}
          >
            <div className="relative" ref={noteDropdownRef}>
              <button
                type="button"
                onClick={() => setNoteDropdownOpen((o) => !o)}
                className="flex w-full items-center justify-between gap-2 rounded-t-xl px-2.5 py-2 text-left text-xs font-medium text-on-surface outline-none focus:ring-1 focus:ring-primary/25"
                aria-haspopup="listbox"
                aria-expanded={noteDropdownOpen}
              >
                <span className="min-w-0 flex-1 truncate">
                  {notes.find((n) => n.id === noteId)?.title || "（无标题）"}
                </span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-outline/70" />
              </button>

              {noteDropdownOpen ? (
                <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-outline-variant/15 bg-[#1A1B2E] shadow-lg">
                  <div className="max-h-[220px] overflow-y-auto overscroll-contain">
                    {notes.map((n) => {
                      const active = n.id === noteId;
                      return (
                        <button
                          key={n.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onClick={() => {
                            setNoteId(n.id);
                            setNoteDropdownOpen(false);
                          }}
                          className={`w-full px-2.5 py-2 text-left text-xs transition-colors ${
                            active
                              ? "bg-[#7C3AED]/20 text-white"
                              : "text-on-surface hover:bg-surface-container-low/40"
                          }`}
                        >
                          <span className="block truncate">{n.title || "（无标题）"}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-end border-t border-outline-variant/10 px-1.5 py-1">
              <button
                type="button"
                disabled={busy || loading}
                onClick={() => void createTask()}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-2.5 py-1 text-[11px] font-black text-white hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                发布任务
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center rounded-lg bg-[#1A1B2E] p-0.5">
        <button
          type="button"
          onClick={() => setLearnMode("lite")}
          className={`min-w-0 flex-1 rounded-md py-1.5 text-xs font-bold transition-colors ${
            learnMode === "lite"
              ? "bg-[#7C3AED] text-white shadow-[0_0_0_3px_rgba(124,58,237,0.18)]"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          轻量
        </button>
        <button
          type="button"
          onClick={() => setLearnMode("deep")}
          className={`min-w-0 flex-1 rounded-md py-1.5 text-xs font-bold transition-colors ${
            learnMode === "deep"
              ? "bg-[#7C3AED] text-white shadow-[0_0_0_3px_rgba(124,58,237,0.18)]"
              : "text-on-surface-variant hover:text-on-surface"
          }`}
        >
          深度
        </button>
      </div>

      {err ? <div className="mt-1.5 text-[11px] font-bold leading-tight text-error">{err}</div> : null}

      {/* 任务列表：占据剩余空间，长链路可滚动查看 */}
      <div className="mt-2 min-h-0 flex-1 overflow-hidden rounded-lg border border-outline-variant/10">
        <div className="grid grid-cols-[26px_1fr_22px] items-center gap-0.5 border-b border-outline-variant/10 bg-surface-container-low/30 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-outline/75">
          <span />
          <span className="truncate">任务</span>
          <span className="text-right">状态</span>
        </div>
        {loading ? (
          <div className="px-2 py-2.5 text-center text-[11px] text-on-surface-variant">加载中…</div>
        ) : shownTasks.length === 0 ? (
          <div className="px-2 py-2.5 text-center text-[11px] text-on-surface-variant">无记录</div>
        ) : (
          <ul className="no-scrollbar h-full overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
            {shownTasks.map((t) => {
              const TypeIc = typeIcon(t.type);
              const open = expandedId === t.id;
              const ui = t.ui;
              const showTrace =
                ui &&
                (t.status === "RUNNING" ||
                  t.status === "PENDING" ||
                  t.status === "SUCCEEDED" ||
                  t.status === "FAILED");
              return (
                <li key={t.id} className="border-b border-outline-variant/5 last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                    className="grid w-full grid-cols-[26px_1fr_22px] items-start gap-0.5 px-1.5 py-1 text-left hover:bg-surface-container-low/30"
                  >
                    <span className="flex justify-center pt-0.5 text-primary/90">
                      <TypeIc className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-semibold text-on-surface">{t.noteTitle}</div>
                      {showTrace ? (
                        <div className="mt-1 space-y-1">
                          <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-highest/50">
                            <div
                              className="h-full rounded-full bg-primary/80 transition-[width] duration-300"
                              style={{ width: `${Math.round((ui?.progress ?? 0) * 100)}%` }}
                            />
                          </div>
                          <div className="text-[10px] leading-snug text-on-surface-variant">
                            {open ? (
                              <span className="font-bold text-primary/90">{ui?.headline}</span>
                            ) : (
                              <span>
                                <span className="font-bold text-outline/90">{ui?.headline}</span>
                                {ui?.currentStepLabel ? (
                                  <>
                                    <span className="mx-1 opacity-40">·</span>
                                    <span>{ui.currentStepLabel}</span>
                                  </>
                                ) : null}
                              </span>
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <span className="flex justify-end pt-0.5">
                      <StatusGlyph status={t.status} />
                    </span>
                  </button>
                  {open ? (
                    <div className="space-y-1.5 border-t border-outline-variant/5 bg-surface-container-low/20 px-2 py-1.5">
                      {ui?.steps?.length ? (
                        <ol className="list-decimal space-y-1 pl-4 text-[10px] leading-relaxed text-on-surface-variant">
                          {ui.steps.map((s, idx) => (
                            <li key={`${s.id}-${idx}`}>
                              <span className="font-semibold text-on-surface/90">{s.label}</span>
                              <span className="ml-1 rounded bg-surface-container-highest/40 px-1 text-[9px] text-outline">
                                {s.status}
                              </span>
                              {s.toolName ? (
                                <span className="ml-1 text-[9px] text-outline/80">tool:{s.toolName}</span>
                              ) : null}
                              {s.toolSummary ? (
                                <div className="mt-0.5 text-[9px] text-outline/70">{s.toolSummary}</div>
                              ) : null}
                            </li>
                          ))}
                        </ol>
                      ) : null}
                      {t.lastError && t.status === "FAILED" ? (
                        <span className="max-w-full truncate text-[10px] text-error/90" title={t.lastError}>
                          {t.lastError}
                        </span>
                      ) : null}
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {t.result?.noteUrl ? (
                          <a
                            href={t.result.noteUrl}
                            className="text-[10px] font-bold text-primary hover:underline"
                          >
                            笔记
                          </a>
                        ) : null}
                        {t.status === "RUNNING" || t.status === "PENDING" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void controlTask(t, "pause");
                            }}
                            className="text-[10px] text-amber-500 hover:text-amber-400 disabled:opacity-50"
                          >
                            中断
                          </button>
                        ) : null}
                        {t.status === "FAILED" || t.status === "CANCELLED" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={(e) => {
                              e.stopPropagation();
                              void controlTask(t, "resume");
                            }}
                            className="text-[10px] text-primary hover:text-primary/90 disabled:opacity-50"
                          >
                            继续执行
                          </button>
                        ) : null}
                        {t.status !== "RUNNING" ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void deleteTask(t.id);
                            }}
                            className="inline-flex items-center gap-0.5 text-[10px] text-error hover:underline"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                            删除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
