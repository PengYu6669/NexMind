"use client";

import type { WorkflowNodeData } from "@/components/graph/workflow-mapper";

export function ReasoningDrawer({
  open,
  data,
  onClose,
}: {
  open: boolean;
  data: WorkflowNodeData | null;
  onClose: () => void;
}) {
  if (!open || !data) return null;
  return (
    <aside className="absolute right-4 top-4 z-20 w-[360px] max-w-[calc(100%-2rem)] rounded-2xl border border-outline-variant/15 bg-surface-container-high/70 p-4 backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-widest text-outline/70">{data.layer}</div>
          <h3 className="mt-1 text-sm font-black text-on-surface">{data.title}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-outline-variant/20 px-2 py-1 text-xs text-on-surface-variant hover:bg-surface-container-low"
        >
          关闭
        </button>
      </div>
      <div className="mt-3 text-xs text-on-surface-variant">{data.subtitle}</div>
      <div className="mt-3 rounded-lg border border-outline-variant/10 bg-surface-container-low/40 p-3">
        <div className="text-[11px] font-bold text-on-surface-variant">Reasoning 日志</div>
        <ol className="mt-2 list-decimal space-y-1 pl-4 text-[12px] leading-relaxed text-on-surface-variant">
          {data.reasoningLog.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ol>
      </div>
    </aside>
  );
}

