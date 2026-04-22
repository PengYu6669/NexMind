"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export function CaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>("待开始");
  const [createdNotes, setCreatedNotes] = useState(0);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    setProgress("启动抓取任务...");
    setCreatedNotes(0);
    try {
      const res = await fetch("/api/capture?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ input }),
      });

      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error || "捕获失败");
      }
      if (!res.body) throw new Error("流式响应为空");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalNoteId: string | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";

        for (const raw of events) {
          const lines = raw.split("\n");
          const eventLine = lines.find((x) => x.startsWith("event:")) ?? "";
          const dataLine = lines.find((x) => x.startsWith("data:")) ?? "";
          const event = eventLine.replace(/^event:\s*/, "").trim();
          const payloadText = dataLine.replace(/^data:\s*/, "").trim();
          if (!payloadText) continue;
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(payloadText) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event === "job_started") {
            setProgress("任务已创建，准备抽取正文...");
          } else if (event === "step") {
            const step = payload.step as { label?: string; toolSummary?: string } | undefined;
            setProgress(step?.label ? String(step.label) : "处理中...");
          } else if (event === "chunk_created") {
            const created = Number(payload.createdNotes ?? 0);
            if (Number.isFinite(created)) setCreatedNotes(created);
            setProgress(`已生成 ${created} 篇分片笔记...`);
          } else if (event === "linked") {
            setProgress("正在建立笔记关联边...");
          } else if (event === "completed" || event === "done") {
            finalNoteId =
              typeof payload.noteId === "string" && payload.noteId ? payload.noteId : finalNoteId;
            setProgress("完成，正在跳转...");
          } else if (event === "error") {
            throw new Error(typeof payload.error === "string" ? payload.error : "捕获失败");
          }
        }
      }

      if (!finalNoteId) {
        throw new Error("未返回 noteId");
      }
      onClose();
      router.push(`/notes/${finalNoteId}`);
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

          {loading ? (
            <div className="rounded-lg border border-outline-variant/15 bg-surface-container-lowest/40 px-3 py-2 text-xs text-on-surface-variant">
              <div>{progress}</div>
              <div className="mt-1 text-[11px] text-outline/75">已生成笔记：{createdNotes}</div>
            </div>
          ) : null}

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

