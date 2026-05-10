import Link from "next/link";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export function MarketingNav() {
  return (
    <header className="fixed top-0 z-50 w-full border-b border-black bg-white/90 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-5 py-4 sm:px-8 lg:px-10">
        <div className="flex min-w-0 items-center gap-8">
          <Link href="/" className="flex items-center gap-2 text-xl font-black tracking-normal text-black">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-white">
              <MaterialIcon name="neurology" className="text-xl" filled />
            </span>
            NexMind
          </Link>
          <nav className="hidden items-center gap-6 md:flex">
            <Link href="/dashboard" className="text-sm font-semibold text-neutral-700 transition-colors hover:text-black">
              工作台
            </Link>
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="rounded-full px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-[#f7f7f5]"
          >
            登录
          </Link>
          <Link
            href="/register"
            className="rounded-full bg-black px-5 py-2 text-sm font-semibold text-white transition-transform active:scale-[0.98]"
          >
            注册
          </Link>
        </div>
      </div>
    </header>
  );
}
