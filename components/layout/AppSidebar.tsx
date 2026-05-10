"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const navItems = [
  { href: "/dashboard", label: "工作台", icon: "home" as const },
  { href: "/notes", label: "知识库", icon: "database" as const },
  { href: "/graph", label: "知识图谱", icon: "hub" as const },
  { href: "/nextclaw", label: "NextClaw", icon: "assistant" as const },
  { href: "/learn", label: "学习中心", icon: "school" as const },
  { href: "/settings", label: "设置", icon: "settings" as const },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
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

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  };

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-black/10 bg-white px-3 py-5 font-body text-black shadow-[18px_0_45px_rgba(0,0,0,0.04)]">
      <div className="px-3 pb-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-white">
            <MaterialIcon name="neurology" className="text-xl" filled />
          </span>
          <div className="min-w-0">
            <h1 className="font-headline text-xl font-black leading-tight tracking-normal">NexMind</h1>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              Knowledge OS
            </p>
          </div>
        </Link>
      </div>

      <div className="px-2 pb-5">
        <Link
          href="/notes/new"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-black px-4 py-3 text-sm font-bold text-white transition-transform active:scale-[0.98]"
        >
          <MaterialIcon name="add" className="text-base" />
          <span>新建笔记</span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-1">
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
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors active:scale-[0.99]";
          const activeCls = active
            ? "border border-black bg-[#dceeb1] text-black"
            : "border border-transparent text-neutral-600 hover:bg-[#f7f7f5] hover:text-black";
          return (
            <Link key={item.href} href={item.href} className={`${base} ${activeCls}`}>
              <MaterialIcon name={item.icon} className="text-xl" filled={active} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto px-1 pt-4">
        <div className="mt-4 rounded-2xl border border-black/10 bg-[#f7f7f5] p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black bg-white">
              <span className="text-sm font-black text-black">{avatarText}</span>
            </div>
            <div className="min-w-0 overflow-hidden">
              <p className="truncate text-sm font-bold text-black">
                {loadingUser ? "加载中..." : user?.name || user?.email || "未登录"}
              </p>
              <p className="mt-0.5 truncate text-xs font-medium text-neutral-500">{loadingUser ? " " : planLabel}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-xs font-bold text-neutral-700 transition-colors hover:border-black/20 hover:bg-black hover:text-white"
          >
            <MaterialIcon name="logout" className="text-base" />
            退出登录
          </button>
        </div>
      </div>
    </aside>
  );
}
