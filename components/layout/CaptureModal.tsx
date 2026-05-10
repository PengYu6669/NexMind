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
    setProgress("启动摄取任务...");
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
          const event = (lines.find((x) => x.startsWith("event:")) ?? "").replace(/^event:\s*/, "").trim();
          const payloadText = (lines.find((x) => x.startsWith("data:")) ?? "").replace(/^data:\s*/, "").trim();
          if (!payloadText) continue;
          let payload: Record<string, unknown> = {};
          try {
            payload = JSON.parse(payloadText) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event === "job_started") {
            setProgress("任务已创建，准备接收来源...");
          } else if (event === "step") {
            const step = payload.step as { label?: string; toolSummary?: string } | undefined;
            setProgress(step?.label ? String(step.label) : "处理中...");
          } else if (event === "chunk_created") {
            const created = Number(payload.createdNotes ?? 0);
            if (Number.isFinite(created)) setCreatedNotes(created);
            setProgress(`已生成 ${created} 篇分片笔记...`);
          } else if (event === "linked") {
            setProgress("正在建立知识图谱关联边...");
          } else if (event === "completed" || event === "done") {
            finalNoteId = typeof payload.noteId === "string" && payload.noteId ? payload.noteId : finalNoteId;
            setProgress("完成，正在跳转...");
          } else if (event === "error") {
            throw new Error(typeof payload.error === "string" ? payload.error : "捕获失败");
          }
        }
      }

      if (!finalNoteId) throw new Error("未返回 noteId");
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-lg rounded-2xl border border-black bg-white p-5 shadow-[12px_12px_0_#000]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black text-white">
              <MaterialIcon name="content_paste" filled />
            </div>
            <div>
              <h2 className="font-headline text-lg font-black text-black">快速捕获</h2>
              <p className="text-xs leading-relaxed text-neutral-500">粘贴 URL 或文本片段，自动抽取正文、分片并生成关联笔记。</p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-full p-2 text-neutral-500 hover:bg-[#f7f7f5] hover:text-black"
            onClick={onClose}
            aria-label="关闭"
          >
            <MaterialIcon name="close" />
          </button>
        </div>

        <div className="space-y-3">
          <textarea
            className="h-28 w-full resize-none rounded-xl border border-black/10 bg-[#f7f7f5] px-4 py-3 text-sm font-medium text-black placeholder:text-neutral-400 focus:border-black focus:bg-white focus:outline-none"
            placeholder="例如：https://example.com/article 或直接粘贴一段文字内容..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />

          {loading ? (
            <div className="rounded-xl border border-black/10 bg-[#fbfbfa] px-3 py-3 text-xs text-neutral-600">
              <div className="flex items-center gap-2 font-semibold text-black">
                <span className="h-2 w-2 rounded-full bg-black animate-pulse" />
                {progress}
              </div>
              <div className="mt-2 text-[11px] text-neutral-500">已生成笔记：{createdNotes}</div>
            </div>
          ) : null}

          {error ? (
            <p className="text-sm font-semibold text-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              className="rounded-full border border-black/10 bg-white px-4 py-2 text-sm font-semibold text-neutral-600 hover:bg-[#f7f7f5]"
              onClick={onClose}
              disabled={loading}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-full bg-black px-4 py-2 text-sm font-bold text-white transition-transform active:scale-[0.98] disabled:opacity-50"
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
