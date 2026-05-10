"use client";

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
      <header className="fixed left-64 right-0 top-0 z-30 flex h-16 items-center justify-between gap-5 border-b border-black/10 bg-white/90 px-5 backdrop-blur-xl md:px-8">
        <div className="min-w-0 flex-1">
          <p className="hidden text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400 sm:block">
            Workspace
          </p>
          <h1 className="truncate font-headline text-xl font-black leading-tight tracking-normal text-black">{title}</h1>
        </div>

        {center ? <div className="flex min-w-0 flex-[1.4] items-center justify-center">{center}</div> : null}

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {isDashboard ? <NextClawStatusPill /> : null}
          <form
            className={`hidden max-w-[min(100%,320px)] flex-1 items-center gap-2 md:flex ${
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
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-base text-neutral-500"
              />
              <input
                type="search"
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                placeholder="搜索笔记、概念、资料"
                className="w-full rounded-full border border-black/10 bg-[#f7f7f5] py-2.5 pl-10 pr-4 text-sm font-medium text-black outline-none placeholder:text-neutral-400 focus:border-black focus:bg-white"
                aria-label="语义搜索"
              />
            </div>
          </form>

          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white px-3 py-2 text-sm font-bold text-black transition-colors hover:bg-[#f7f7f5]"
            aria-label="快速捕获"
            onClick={() => setCaptureOpen(true)}
          >
            <MaterialIcon name="add_circle" className="text-lg" />
            <span className="hidden lg:inline">捕获</span>
          </button>
        </div>
      </header>
    </>
  );
}
