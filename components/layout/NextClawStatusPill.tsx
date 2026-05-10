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
      className="group flex max-w-[min(100%,15rem)] shrink-0 items-center gap-2 rounded-full border border-black/10 bg-[#f7f7f5] px-3 py-1.5 text-[10px] transition-colors hover:border-black hover:bg-white"
      title="打开 NextClaw 控制台"
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-white">
        <MaterialIcon name="hub" className="text-sm" />
      </span>
      <span className="min-w-0 flex flex-col gap-0 leading-tight">
        <span className="truncate font-black uppercase tracking-[0.12em] text-black">NextClaw</span>
        {err ? (
          <span className="text-[9px] font-medium text-neutral-500">状态不可用</span>
        ) : due == null || jobs == null ? (
          <span className="text-[9px] font-medium text-neutral-500">加载中...</span>
        ) : (
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0 text-[9px] font-medium text-neutral-500">
            <span className="tabular-nums text-neutral-700">今日复习 {due}</span>
            <span className="text-neutral-300">/</span>
            <span className={`inline-flex items-center gap-0.5 tabular-nums ${aiBusy ? "text-black" : ""}`}>
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${aiBusy ? "animate-pulse bg-black" : "bg-neutral-300"}`} />
              {aiBusy ? `AI 运行 ${jobs}` : "AI 空闲"}
            </span>
          </span>
        )}
      </span>
    </Link>
  );
}
