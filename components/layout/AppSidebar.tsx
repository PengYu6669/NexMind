"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const navItems = [
  { href: "/dashboard", label: "首页", icon: "home" as const },
  { href: "/notes", label: "知识库", icon: "database" as const },
  { href: "/graph", label: "知识图谱", icon: "hub" as const },
  { href: "/nextclaw", label: "NextClaw", icon: "assistant" as const },
  { href: "/settings", label: "设置", icon: "settings" as const },
];

export function AppSidebar() {
  const pathname = usePathname();
  const [user, setUser] = useState<{
    id: string;
    email: string;
    name: string | null;
    plan: string;
  } | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);

  useEffect(() => {
    let alive = true;
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.resolve({ user: null })))
      .then((data) => {
        if (!alive) return;
        setUser(data.user ?? null);
      })
      .catch(() => {
        if (!alive) return;
        setUser(null);
      })
      .finally(() => {
        if (!alive) return;
        setLoadingUser(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const avatarText = useMemo(() => {
    const source = user?.name || user?.email;
    if (!source) return "U";
    return source.slice(0, 1).toUpperCase();
  }, [user]);

  const planLabel = useMemo(() => {
    if (!user) return "未登录";
    return user.plan === "pro" ? "专业版用户" : "免费版用户";
  }, [user]);

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col bg-[#0b1326] py-8 font-headline tracking-tight shadow-[20px_0_40px_rgba(79,70,229,0.02)]">
      <div className="mb-10 px-6">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-container">
            <MaterialIcon name="smart_toy" className="text-xl text-white" filled />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tighter text-[#4F46E5]">NexMind</h1>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">AI 智能笔记</p>
          </div>
        </Link>
      </div>

      <div className="mb-8 px-4">
        <Link
          href="/notes/new"
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4F46E5] py-3 font-bold text-white shadow-lg shadow-primary-container/20 transition-transform active:scale-95"
        >
          <MaterialIcon name="add" className="text-sm text-white" />
          <span>新建笔记</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {navItems.map((item) => {
          const active =
            item.href === "/notes"
              ? pathname.startsWith("/notes")
              : item.href === "/graph"
                ? pathname.startsWith("/graph")
                : item.href === "/nextclaw"
                  ? pathname.startsWith("/nextclaw")
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
          const base =
            "flex items-center gap-3 px-4 py-3 transition-all duration-200 rounded-r-full active:scale-95";
          const activeCls = active
            ? "bg-[#4F46E5]/10 font-bold text-[#4F46E5]"
            : "text-slate-400 hover:bg-[#2d3449] hover:text-slate-200";
          return (
            <Link key={item.href} href={item.href} className={`${base} ${activeCls}`}>
              <MaterialIcon name={item.icon} filled={active} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-3 pt-4">
        <Link
          href="/help"
          className={`flex items-center gap-3 rounded-lg px-4 py-3 transition-all duration-200 hover:bg-[#2d3449] hover:text-slate-200 ${
            pathname.startsWith("/help") ? "bg-[#2d3449] text-slate-200" : "text-slate-400"
          }`}
        >
          <MaterialIcon name="help" />
          <span>帮助</span>
        </Link>
        <div className="mt-6 flex items-center gap-3 rounded-xl bg-surface-container-low px-4 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/20 bg-surface-container-highest">
            <span className="text-sm font-bold text-on-surface">{avatarText}</span>
          </div>
          <div className="min-w-0 overflow-hidden">
            <p className="truncate text-sm font-bold">
              {loadingUser ? "加载中..." : user?.name || user?.email || "未登录"}
            </p>
            <p className="truncate text-xs text-slate-500">{loadingUser ? " " : planLabel}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
