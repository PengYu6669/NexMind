"use client";

import { Handle, Position, type NodeProps } from "reactflow";
import type { WorkflowNodeData } from "@/components/graph/workflow-mapper";

function stylesByVariant(v: WorkflowNodeData["variant"]) {
  if (v === "auditNode") return "bg-primary";
  if (v === "knowledgeNode" || v === "reviewNode") return "bg-emerald-400";
  if (v === "searchNode" || v === "toolNode") return "bg-amber-300";
  return "bg-slate-200";
}

export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeData>) {
  return (
    <div className="group relative min-w-[210px] max-w-[400px]">
      <Handle type="target" position={Position.Left} className="!size-2 !border-0 !bg-primary/65" />
      <div className="flex items-center gap-3">
        <span
          className={`inline-flex size-6 shrink-0 rounded-full shadow-[0_0_0_2px_rgba(255,255,255,0.06)] ${stylesByVariant(data.variant)} ${
            selected ? "ring-4 ring-primary/45 ring-offset-2 ring-offset-surface" : "group-hover:ring-2 group-hover:ring-primary/25"
          }`}
        />
        <span
          className={`line-clamp-1 text-sm font-semibold tracking-tight text-on-surface/90 ${
            selected ? "text-primary" : "group-hover:text-on-surface"
          }`}
          title={data.title}
        >
          {data.title}
        </span>
      </div>
      <Handle type="source" position={Position.Right} className="!size-2 !border-0 !bg-primary/65" />
    </div>
  );
}

