import Link from "next/link";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export function MarketingNav() {
  return (
    <header className="fixed top-0 z-50 w-full bg-slate-950/60 shadow-[0_20px_40px_rgba(79,70,229,0.06)] backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between px-6 py-4">
        <div className="flex items-center gap-8">
          <Link
            href="/"
            className="font-headline flex items-center gap-2 text-xl font-bold tracking-tighter text-slate-100"
          >
            <MaterialIcon name="terminal" className="text-indigo-400" filled />
            NexMind
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <Link
              href="/dashboard"
              className="border-b border-indigo-500/50 pb-1 text-sm font-medium tracking-tight text-indigo-400 antialiased"
            >
              探索
            </Link>
            <Link
              href="/docs"
              className="text-sm font-medium tracking-tight text-slate-400 transition-colors hover:text-slate-100 antialiased"
            >
              文档
            </Link>
            <Link
              href="/docs#api"
              className="text-sm font-medium tracking-tight text-slate-400 transition-colors hover:text-slate-100 antialiased"
            >
              接口
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/login"
            className="px-4 py-1.5 text-sm font-medium text-slate-400 transition-all duration-200 active:scale-95 hover:text-slate-100"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="rounded-xl bg-indigo-500 px-5 py-1.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all duration-200 active:scale-95 hover:bg-indigo-400"
          >
            注册
          </Link>
        </div>
      </div>
      <div className="h-px w-full bg-gradient-to-b from-slate-800/20 to-transparent" />
    </header>
  );
}
