"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import type { WorkflowNodeData } from "@/components/graph/workflow-mapper";

function stylesByVariant(v: WorkflowNodeData["variant"]) {
  if (v === "auditNode") return "border-primary/35 bg-primary/10";
  if (v === "knowledgeNode" || v === "reviewNode") return "border-emerald-500/30 bg-emerald-500/10";
  if (v === "searchNode" || v === "toolNode") return "border-amber-400/30 bg-amber-400/10";
  return "border-outline-variant/20 bg-surface-container-low/60";
}

export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div
      className={`min-w-[220px] max-w-[260px] rounded-xl border p-3 shadow-sm backdrop-blur-sm ${stylesByVariant(data.variant)} ${
        selected ? "ring-2 ring-primary/45" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-primary/70" />
      <div className="text-[11px] font-black uppercase tracking-wider text-outline/75">{data.layer}</div>
      <div className="mt-1 line-clamp-2 text-sm font-bold text-on-surface">{data.title}</div>
      <div className="mt-1 text-[11px] text-on-surface-variant">{data.subtitle}</div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-primary/70" />
    </div>
  );
}

