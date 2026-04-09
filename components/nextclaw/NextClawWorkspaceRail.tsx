"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BookOpen, Brain, GitCompare, LayoutDashboard, Settings } from "lucide-react";

type MemoryState = { memoryEnabled: boolean; memoryCount: number };

async function fetchMemoryState(): Promise<MemoryState | null> {
  const r = await fetch("/api/user/nextclaw-memory", { credentials: "include" });
  if (!r.ok) return null;
  const data = (await r.json()) as { memoryEnabled?: unknown; memoryCount?: unknown };
  return {
    memoryEnabled: Boolean(data.memoryEnabled),
    memoryCount: Number.isFinite(Number(data.memoryCount)) ? Number(data.memoryCount) : 0,
  };
}

export function NextClawWorkspaceRail() {
  const pathname = usePathname() || "";
  const [memory, setMemory] = useState<MemoryState>({ memoryEnabled: true, memoryCount: 0 });
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await fetchMemoryState();
    if (s) setMemory(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggleMemory = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = !memory.memoryEnabled;
      const r = await fetch("/api/user/nextclaw-memory", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryEnabled: next }),
      });
      if (!r.ok) throw new Error("save failed");
      setMemory((s) => ({ ...s, memoryEnabled: next }));
    } finally {
      setBusy(false);
    }
  }, [busy, memory.memoryEnabled]);

  const nav = useMemo(
    () => [
      { href: "/dashboard", label: "工作台", icon: LayoutDashboard },
      { href: "/notes", label: "知识库", icon: BookOpen },
      { href: "/graph", label: "图谱", icon: Brain },
      { href: "/nextclaw", label: "NextClaw", icon: Activity },
      { href: "/settings", label: "设置", icon: Settings },
    ],
    [],
  );

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-outline-variant/10 bg-surface-container-lowest/25 px-4 py-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-headline text-sm font-black tracking-tight text-on-surface">回声工作区</div>
          <div className="mt-0.5 text-[11px] font-semibold text-primary">AI 助手运行中</div>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void toggleMemory()}
          className="group relative inline-flex items-center gap-2 rounded-full border border-outline-variant/15 bg-surface-container-low/40 px-2.5 py-1.5 text-[10px] font-black text-on-surface-variant"
          aria-label="记忆与快照开关（微缩）"
        >
          <GitCompare className="h-3.5 w-3.5 text-outline group-hover:text-primary" />
          <span className="hidden sm:inline">记忆</span>
          <span
            className={`relative inline-flex h-4 w-7 items-center rounded-full border border-outline-variant/20 transition-colors ${
              memory.memoryEnabled ? "bg-primary/30" : "bg-surface-container-high"
            }`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full shadow transition-transform ${
                memory.memoryEnabled ? "translate-x-[14px] bg-primary-container" : "translate-x-1 bg-on-surface"
              }`}
            />
          </span>
          <span className="text-outline/60">{memory.memoryCount}</span>
        </button>
      </div>

      <nav className="mt-5 space-y-1">
        {nav.map((x) => {
          const active =
            x.href === "/notes"
              ? pathname.startsWith("/notes")
              : x.href === "/graph"
                ? pathname.startsWith("/graph")
                : x.href === "/nextclaw"
                  ? pathname.startsWith("/nextclaw")
                  : pathname === x.href || pathname.startsWith(`${x.href}/`);
          const base =
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors active:scale-[0.99]";
          const cls = active
            ? "bg-primary/10 text-primary font-bold border border-primary/15"
            : "text-on-surface-variant hover:bg-surface-container-low/40 hover:text-on-surface";
          const Icon = x.icon;
          return (
            <Link key={x.href} href={x.href} className={`${base} ${cls}`}>
              <Icon className="h-4 w-4" />
              <span className="font-headline text-[13px]">{x.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/30 p-4">
        <div className="text-[10px] font-black uppercase tracking-widest text-outline/70">AI 助手状态</div>
        <div className="mt-2 h-14 overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low/30 px-3 py-2">
          <div className="text-[11px] leading-relaxed text-on-surface-variant">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
              正在监测笔记库冲突...
            </span>
          </div>
          <div className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-outline/50" />
              发现 2 处潜在水合不一致，已生成冲突卡候选
            </span>
          </div>
        </div>
        <button
          type="button"
          className="mt-3 w-full rounded-xl border border-outline-variant/15 bg-surface-container-low/30 px-3 py-2 text-[11px] font-bold text-on-surface-variant hover:bg-surface-container-low/45"
          onClick={() => void refresh()}
        >
          刷新状态
        </button>
      </div>
    </aside>
  );
}

