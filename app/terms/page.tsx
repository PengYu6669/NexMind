import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "服务条款 · NexMind",
};

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-surface px-6 py-24 font-body text-on-surface">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm text-primary hover:underline">
          ← 返回首页
        </Link>
        <h1 className="font-headline mt-8 text-3xl font-bold">Terms of Service</h1>
        <p className="mt-4 text-sm text-on-surface-variant">服务条款正文占位，上线前请替换为正式法律文本。</p>
      </div>
    </div>
  );
}
