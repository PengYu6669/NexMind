import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "文档 · NexMind",
  description: "NexMind 产品文档",
};

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-surface px-6 py-24 font-body text-on-surface">
      <div className="mx-auto max-w-2xl">
        <Link href="/" className="text-sm text-primary hover:underline">
          ← 返回首页
        </Link>
        <h1 className="font-headline mt-8 text-3xl font-bold">文档</h1>
        <p className="mt-4 text-on-surface-variant">产品说明与接入指南将发布于此。</p>
        <h2 id="api" className="font-headline mt-12 scroll-mt-24 text-xl font-semibold">
          API
        </h2>
        <p className="mt-2 text-sm text-on-surface-variant">REST / SDK 文档占位，后续版本提供。</p>
      </div>
    </div>
  );
}
