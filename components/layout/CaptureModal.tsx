"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export function CaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; noteId?: string } | null;
      if (!res.ok || !data?.noteId) {
        throw new Error(data?.error || "捕获失败");
      }
      onClose();
      router.push(`/notes/${data.noteId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "捕获失败");
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container/20">
              <MaterialIcon name="content_paste" className="text-primary" filled />
            </div>
            <div>
              <h2 className="font-headline text-lg font-bold">快速捕获</h2>
              <p className="text-xs text-on-surface-variant">粘贴 URL 或文本片段，自动生成要点与标签。</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-2 text-slate-300 hover:bg-surface-container-high"
            onClick={onClose}
            aria-label="关闭"
          >
            <MaterialIcon name="close" />
          </button>
        </div>

        <div className="space-y-3">
          <textarea
            className="h-28 w-full resize-none rounded-xl border border-outline-variant/10 bg-surface-container-lowest px-4 py-3 text-sm text-on-surface placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-primary/30"
            placeholder="例如： https://xxx.com 或直接粘贴一段文字内容..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          {error ? (
            <p className="text-sm font-medium text-on-error-container" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container-high"
              onClick={onClose}
              disabled={loading}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-xl bg-primary-container px-4 py-2 text-sm font-bold text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:opacity-60"
              onClick={onSubmit}
              disabled={loading || !input.trim()}
            >
              {loading ? "生成中..." : "开始捕获"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

