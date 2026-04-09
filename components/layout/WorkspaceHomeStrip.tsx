"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

function formatRelativeTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "刚刚";
    if (m < 60) return `${m} 分钟前`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} 小时前`;
    const days = Math.floor(h / 24);
    if (days < 7) return `${days} 天前`;
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  } catch {
    return "";
  }
}

type DashboardPayload = {
  stats?: {
    dueToday?: number;
    pendingJobs?: number;
    learningCardsWeek?: number;
  };
};

type NoteRow = { id: string; title: string; updatedAt: string };

type TaskRow = {
  id: string;
  noteId: string | null;
  noteTitle: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "SKIPPED";
  type: string;
};

export function WorkspaceHomeStrip({ showLists }: { showLists: boolean }) {
  const [dash, setDash] = useState<DashboardPayload | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [dashLoading, setDashLoading] = useState(true);
  const [listsLoading, setListsLoading] = useState(showLists);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dRes = await fetch("/api/nextclaw/dashboard", { credentials: "include" });
        if (!alive) return;
        const dJson = dRes.ok ? ((await dRes.json()) as DashboardPayload) : null;
        setDash(dJson);
      } finally {
        if (alive) setDashLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!showLists) {
      setListsLoading(false);
      return;
    }
    let alive = true;
    setListsLoading(true);
    (async () => {
      try {
        const [nRes, tRes] = await Promise.all([
          fetch("/api/notes?limit=8", { credentials: "include" }),
          fetch("/api/nextclaw/tasks", { credentials: "include" }),
        ]);
        if (!alive) return;
        const nJson = nRes.ok ? ((await nRes.json()) as { notes?: NoteRow[] }) : { notes: [] };
        const tJson = tRes.ok ? ((await tRes.json()) as { tasks?: TaskRow[] }) : { tasks: [] };
        setNotes(Array.isArray(nJson.notes) ? nJson.notes : []);
        const raw = Array.isArray(tJson.tasks) ? tJson.tasks : [];
        setTasks(
          raw.filter((x) => x.status === "PENDING" || x.status === "RUNNING").slice(0, 6)
        );
      } finally {
        if (alive) setListsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [showLists]);

  const dueToday = dash?.stats?.dueToday ?? 0;
  const pendingJobs = dash?.stats?.pendingJobs ?? 0;
  const learningWeek = dash?.stats?.learningCardsWeek ?? 0;
  const loading = dashLoading;
  const listsBusy = showLists && listsLoading;

  const tiles: {
    key: string;
    label: string;
    num: number;
    unit: string;
    hint: string;
    icon: "schedule" | "bolt" | "explore";
    href: string;
    /** 玻璃卡背景层级：略不同的明度与色相，突出功能分区 */
    surface: string;
  }[] = [
    {
      key: "forget",
      label: "遗忘预警",
      num: dueToday,
      unit: "条",
      hint: "今日待复习",
      icon: "schedule",
      href: "/nextclaw",
      surface:
        "bg-gradient-to-br from-primary-container/35 via-surface-container-low/55 to-surface-container-lowest/75 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
    },
    {
      key: "jobs",
      label: "任务进度",
      num: pendingJobs,
      unit: "个",
      hint: "AI 队列进行中",
      icon: "bolt",
      href: "/nextclaw",
      surface:
        "bg-gradient-to-br from-primary/20 via-surface-container-high/45 to-surface-container-lowest/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]",
    },
    {
      key: "discover",
      label: "知识发现",
      num: learningWeek,
      unit: "张",
      hint: "近 7 天新卡片",
      icon: "explore",
      href: "/nextclaw",
      surface:
        "bg-gradient-to-br from-secondary-container/30 via-surface-container/40 to-surface-container-lowest/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-center gap-3 pb-0.5 pt-0.5 sm:gap-4">
        {tiles.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`group relative flex w-[11.25rem] flex-col gap-2 overflow-hidden rounded-2xl border border-white/[0.07] p-4 shadow-lg shadow-black/25 backdrop-blur-[18px] transition-all duration-300 hover:border-primary/35 hover:shadow-xl hover:shadow-primary/10 sm:w-[12.5rem] ${t.surface}`}
          >
            <div
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/[0.03]"
              aria-hidden
            />
            <div className="relative flex items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-black/20 text-primary ring-1 ring-white/10">
                <MaterialIcon name={t.icon} className="text-lg text-primary" filled />
              </span>
              <span className="min-w-0 text-[10px] font-black uppercase tracking-widest text-on-surface-variant/90">
                {t.label}
              </span>
            </div>
            <div className="relative flex min-h-[2.75rem] items-baseline gap-1">
              {loading ? (
                <span className="font-headline text-3xl font-bold tabular-nums tracking-tight text-primary/50">
                  …
                </span>
              ) : (
                <>
                  <span className="font-headline text-3xl font-bold tabular-nums tracking-tight text-primary sm:text-4xl">
                    {t.num}
                  </span>
                  <span className="text-sm font-semibold text-primary/75">{t.unit}</span>
                </>
              )}
            </div>
            <p className="relative text-[11px] leading-snug text-on-surface-variant/90">{t.hint}</p>
          </Link>
        ))}
      </div>

      {showLists ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-outline-variant/8 bg-surface-container-lowest/30 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-outline/90">最近编辑的笔记</h3>
              <Link
                href="/notes"
                className="text-[10px] font-bold text-primary/90 transition-colors hover:text-primary"
              >
                全部
              </Link>
            </div>
            {listsBusy ? (
              <p className="py-4 text-center text-xs text-on-surface-variant">加载中…</p>
            ) : notes.length === 0 ? (
              <p className="py-4 text-center text-xs text-on-surface-variant">暂无笔记，去新建一篇吧。</p>
            ) : (
              <ul className="space-y-1">
                {notes.map((n) => (
                  <li key={n.id}>
                    <Link
                      href={`/notes/${n.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-container-low/50"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-surface">
                        {n.title?.trim() || "无标题"}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-on-surface-variant">
                        {formatRelativeTime(n.updatedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-2xl border border-outline-variant/8 bg-surface-container-lowest/30 p-4 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-black uppercase tracking-widest text-outline/90">AI 待办任务</h3>
              <Link
                href="/nextclaw"
                className="text-[10px] font-bold text-primary/90 transition-colors hover:text-primary"
              >
                队列
              </Link>
            </div>
            {listsBusy ? (
              <p className="py-4 text-center text-xs text-on-surface-variant">加载中…</p>
            ) : tasks.length === 0 ? (
              <p className="py-4 text-center text-xs text-on-surface-variant">暂无排队中的 AI 任务。</p>
            ) : (
              <ul className="space-y-1">
                {tasks.map((j) => (
                  <li key={j.id}>
                    <Link
                      href={j.noteId ? `/notes/${j.noteId}` : "/nextclaw"}
                      className="flex items-start justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface-container-low/50"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-on-surface">{j.noteTitle}</p>
                        <p className="mt-0.5 text-[10px] text-on-surface-variant">
                          {j.type === "NOTE_LEARN_DEEP" ? "深度学习" : j.type === "NOTE_LEARN_LITE" ? "轻量学习" : "任务"}
                          {" · "}
                          {j.status === "RUNNING" ? "运行中" : "排队中"}
                        </p>
                      </div>
                      <MaterialIcon
                        name={j.status === "RUNNING" ? "sync" : "hourglass_empty"}
                        className={`mt-0.5 shrink-0 text-base ${j.status === "RUNNING" ? "animate-spin text-primary" : "text-on-surface-variant"}`}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
