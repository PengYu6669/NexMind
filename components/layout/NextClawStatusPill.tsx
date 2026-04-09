"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type DashStats = {
  dueToday?: number;
  pendingJobs?: number;
};

export function NextClawStatusPill() {
  const [stats, setStats] = useState<DashStats | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/nextclaw/dashboard", { credentials: "include" });
        if (!r.ok) throw new Error();
        const data = (await r.json()) as { stats?: DashStats };
        if (!alive) return;
        setStats(data.stats ?? null);
        setErr(false);
      } catch {
        if (alive) setErr(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const due = typeof stats?.dueToday === "number" ? stats.dueToday : null;
  const jobs = typeof stats?.pendingJobs === "number" ? stats.pendingJobs : null;
  const aiBusy = jobs != null && jobs > 0;

  return (
    <Link
      href="/nextclaw"
      className="group flex max-w-[min(100%,14rem)] shrink-0 items-center gap-2 rounded-full border border-outline-variant/10 bg-surface-container-lowest/40 px-2.5 py-1.5 text-[10px] backdrop-blur-md transition-colors hover:border-primary/25 hover:bg-surface-container-low/50"
      title="打开 NextClaw 控制台"
    >
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <MaterialIcon name="hub" className="text-xs" />
      </span>
      <span className="min-w-0 flex flex-col gap-0 leading-tight">
        <span className="truncate font-black uppercase tracking-wider text-outline/90">NextClaw</span>
        {err ? (
          <span className="text-[9px] text-on-surface-variant">状态不可用</span>
        ) : due == null || jobs == null ? (
          <span className="text-[9px] text-on-surface-variant">加载中…</span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[9px] text-on-surface-variant">
            <span className="tabular-nums text-on-surface/90">今日复习 {due}</span>
            <span className="text-outline-variant/50">·</span>
            <span
              className={`inline-flex items-center gap-0.5 tabular-nums ${
                aiBusy ? "font-semibold text-primary" : "text-on-surface-variant"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  aiBusy ? "animate-pulse bg-primary" : "bg-outline-variant/60"
                }`}
              />
              {aiBusy ? `AI 运行 ${jobs}` : "AI 空闲"}
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}
