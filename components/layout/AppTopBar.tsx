"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { CaptureModal } from "@/components/layout/CaptureModal";
import { NextClawStatusPill } from "@/components/layout/NextClawStatusPill";

function pageTitleFromPath(pathname: string): string {
  if (pathname === "/dashboard" || pathname === "/") return "工作台";
  if (pathname === "/notes/new") return "新建笔记";
  if (pathname.startsWith("/notes/")) return "笔记";
  if (pathname.startsWith("/notes")) return "知识库";
  if (pathname.startsWith("/graph")) return "知识图谱";
  if (pathname.startsWith("/nextclaw") || pathname.startsWith("/companion")) return "NextClaw";
  if (pathname.startsWith("/learn")) return "学习中心";
  if (pathname.startsWith("/settings")) return "设置";
  if (pathname.startsWith("/help")) return "帮助";
  if (pathname.startsWith("/docs")) return "文档";
  return "NexMind";
}

export function AppTopBar({ center }: { center?: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [captureOpen, setCaptureOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");

  const title = useMemo(() => pageTitleFromPath(pathname || ""), [pathname]);
  const isNextClaw = (pathname || "").startsWith("/nextclaw");
  const isDashboard = pathname === "/dashboard";

  return (
    <>
      <CaptureModal open={captureOpen} onClose={() => setCaptureOpen(false)} />
      <header className="fixed left-64 right-0 top-0 z-30 flex h-16 items-center justify-between gap-6 border-b border-outline-variant/10 bg-[#0b1326]/85 px-5 backdrop-blur-xl md:px-8">
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-headline text-lg font-bold tracking-tight text-on-surface">{title}</h1>
        </div>

        {/* 中央 Command Bar 区（NextClaw 专用；外页保留搜索框） */}
        {center ? (
          <div className="flex min-w-0 flex-1 items-center justify-center">{center}</div>
        ) : null}

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {isDashboard ? <NextClawStatusPill /> : null}
          <form
            className={`hidden max-w-[min(100%,280px)] flex-1 items-center gap-2 md:flex ${
              isNextClaw ? "md:hidden" : ""
            }`}
            onSubmit={(e) => {
              e.preventDefault();
              const q = searchQ.trim();
              if (q) router.push(`/notes?q=${encodeURIComponent(q)}`);
              else router.push("/notes");
            }}
          >
            <div className="relative min-w-0 flex-1">
              <MaterialIcon
                name="search"
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 text-base"
              />
              <input
                type="search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="语义搜索…"
                className="w-full rounded-xl border border-outline-variant/8 bg-surface-container-lowest/35 py-2 pl-9 pr-3 text-xs text-on-surface outline-none backdrop-blur-md placeholder:text-slate-500 focus:border-primary/25 focus:ring-1 focus:ring-primary/20"
                aria-label="语义搜索"
              />
            </div>
          </form>
          {isDashboard ? (
            <button
              type="button"
              className="rounded-xl border border-outline-variant/8 bg-surface-container-lowest/35 p-2 text-slate-400 backdrop-blur-md transition-colors hover:border-primary/20 hover:bg-surface-container-low/50 hover:text-primary"
              aria-label="快速捕获"
              onClick={() => setCaptureOpen(true)}
            >
              <MaterialIcon name="add_circle" />
            </button>
          ) : (
            <div className="flex items-center gap-0.5 rounded-xl border border-outline-variant/8 bg-surface-container-lowest/35 p-1 backdrop-blur-md">
              <button
                type="button"
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-surface-container-high/80 hover:text-slate-200"
                aria-label="快速捕获"
                onClick={() => setCaptureOpen(true)}
              >
                <MaterialIcon name="add_circle" />
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-surface-container-high/80 hover:text-slate-200"
                aria-label="语音"
              >
                <MaterialIcon name="mic" />
              </button>
              <button
                type="button"
                className="cursor-pointer rounded-lg p-2 text-slate-400 transition-colors hover:bg-surface-container-high/80 hover:text-slate-200"
                aria-label="粘贴"
                onClick={() => setCaptureOpen(true)}
              >
                <MaterialIcon name="content_paste" />
              </button>
            </div>
          )}
          <Link
            href="/docs"
            className={`shrink-0 rounded-xl bg-primary-container/80 px-3 py-2 text-sm font-bold text-on-primary-container backdrop-blur-sm transition-colors hover:bg-primary-container sm:px-4 ${
              isDashboard ? "hidden" : ""
            }`}
          >
            快速开始
          </Link>
        </div>
      </header>
    </>
  );
}
