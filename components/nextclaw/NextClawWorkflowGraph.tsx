"use client";

import { useMemo } from "react";
import ReactFlow, { Background, Handle, Position, type Node, type Edge } from "reactflow";
import "reactflow/dist/style.css";

type StepLike = {
  id: string;
  label: string;
  status: string;
  toolSummary?: string;
};

type NodeStatus = "idle" | "running" | "done" | "failed";

function statusFromSteps(steps: StepLike[], stepIds: string[]): NodeStatus {
  const byId = new Map(steps.map((s) => [s.id, s]));
  for (const id of stepIds) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.status === "running") return "running";
    if (s.status === "failed") return "failed";
  }
  let any = false;
  for (const id of stepIds) {
    const s = byId.get(id);
    if (!s) continue;
    any = true;
    if (s.status !== "done") return "idle";
  }
  return any ? "done" : "idle";
}

function pickSummary(steps: StepLike[], stepId: string): string | null {
  const s = steps.find((x) => x.id === stepId);
  return (s?.toolSummary ?? "").trim() || null;
}

function NodeCard({
  data,
}: {
  data: { title: string; status: NodeStatus; summary?: string | null };
}) {
  const tone =
    data.status === "running"
      ? "border-primary/35 bg-primary/10"
      : data.status === "done"
        ? "border-emerald-500/25 bg-emerald-500/10"
        : data.status === "failed"
          ? "border-error/30 bg-error/10"
          : "border-outline-variant/15 bg-surface-container-low/20";
  const badge =
    data.status === "running" ? "running" : data.status === "done" ? "done" : data.status === "failed" ? "failed" : "idle";
  const badgeTone =
    data.status === "running"
      ? "bg-primary/20 text-primary"
      : data.status === "done"
        ? "bg-emerald-500/15 text-emerald-400"
        : data.status === "failed"
          ? "bg-error/15 text-error"
          : "bg-surface-container-highest/30 text-on-surface-variant";

  return (
    <div className={`w-[210px] rounded-xl border px-3 py-2 ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-black text-on-surface">{data.title}</div>
        <span className={`rounded-md px-1.5 py-0.5 text-[9px] font-black ${badgeTone}`}>{badge}</span>
      </div>
      {data.summary ? (
        <div className="mt-1 line-clamp-2 text-[10px] leading-snug text-on-surface-variant">{data.summary}</div>
      ) : (
        <div className="mt-1 text-[10px] text-outline/60">—</div>
      )}
      <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-outline/40" />
      <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-outline/40" />
    </div>
  );
}

export function NextClawWorkflowGraph({ steps }: { steps: StepLike[] }) {
  const { nodes, edges } = useMemo(() => {
    const s = Array.isArray(steps) ? steps : [];

    const stRetrieve = statusFromSteps(s, ["retrieve"]);
    const stReason = statusFromSteps(s, ["auto-reason"]);
    const stSearch = statusFromSteps(s, ["auto-web-search"]);
    const stFilter = statusFromSteps(s, ["auto-filter"]);
    const stFetch = statusFromSteps(s, ["auto-fetch"]);
    const stAudit = statusFromSteps(s, ["auto-audit"]);
    const stPlan = statusFromSteps(s, ["plan"]);
    const stExec = statusFromSteps(s, ["plan-exec"]);
    const stCoach = statusFromSteps(s, ["coach"]);
    const stPersist = statusFromSteps(s, ["persist"]);
    const stEval = statusFromSteps(s, ["evaluation", "evaluation-failed"]);

    // 竖向紧凑布局：单列主链路 + 右侧一列 Autonomous（可选）
    const n: Node[] = [
      { id: "retrieve", position: { x: 0, y: 0 }, type: "card", data: { title: "Retriever · RAG", status: stRetrieve, summary: pickSummary(s, "retrieve") } },
      { id: "auto-reason", position: { x: 0, y: 120 }, type: "card", data: { title: "Reason · 是否需要联网", status: stReason, summary: pickSummary(s, "auto-reason") } },
      { id: "plan", position: { x: 0, y: 240 }, type: "card", data: { title: "Planner · 计划", status: stPlan, summary: pickSummary(s, "plan") } },
      { id: "plan-exec", position: { x: 0, y: 360 }, type: "card", data: { title: "Execute · 执行计划", status: stExec, summary: pickSummary(s, "plan-exec") } },
      { id: "coach", position: { x: 0, y: 480 }, type: "card", data: { title: "Coach · 生成卡片", status: stCoach, summary: pickSummary(s, "coach") } },
      { id: "persist", position: { x: 0, y: 600 }, type: "card", data: { title: "Persist · 写入", status: stPersist, summary: pickSummary(s, "persist") } },
      { id: "evaluation", position: { x: 0, y: 720 }, type: "card", data: { title: "Evaluate · 评估", status: stEval, summary: pickSummary(s, "evaluation") ?? pickSummary(s, "evaluation-failed") } },

      { id: "auto-web-search", position: { x: 240, y: 120 }, type: "card", data: { title: "Tool · web_search", status: stSearch, summary: pickSummary(s, "auto-web-search") } },
      { id: "auto-filter", position: { x: 240, y: 240 }, type: "card", data: { title: "Filter · 选源", status: stFilter, summary: pickSummary(s, "auto-filter") } },
      { id: "auto-fetch", position: { x: 240, y: 360 }, type: "card", data: { title: "Tool · fetch_url", status: stFetch, summary: pickSummary(s, "auto-fetch") } },
      { id: "auto-audit", position: { x: 240, y: 480 }, type: "card", data: { title: "Auditor · 审计", status: stAudit, summary: pickSummary(s, "auto-audit") } },
    ];

    const e: Edge[] = [
      { id: "e-retrieve-reason", source: "retrieve", target: "auto-reason", animated: stReason === "running" },
      { id: "e-reason-plan", source: "auto-reason", target: "plan", animated: stPlan === "running" },
      { id: "e-plan-exec", source: "plan", target: "plan-exec", animated: stExec === "running" },
      { id: "e-exec-coach", source: "plan-exec", target: "coach", animated: stCoach === "running" },
      { id: "e-coach-persist", source: "coach", target: "persist", animated: stPersist === "running" },
      { id: "e-persist-eval", source: "persist", target: "evaluation", animated: stEval === "running" },

      { id: "e-reason-search", source: "auto-reason", target: "auto-web-search", animated: stSearch === "running" },
      { id: "e-search-filter", source: "auto-web-search", target: "auto-filter", animated: stFilter === "running" },
      { id: "e-filter-fetch", source: "auto-filter", target: "auto-fetch", animated: stFetch === "running" },
      { id: "e-fetch-audit", source: "auto-fetch", target: "auto-audit", animated: stAudit === "running" },
      { id: "e-audit-persist", source: "auto-audit", target: "persist", animated: stPersist === "running" },
    ];

    return { nodes: n, edges: e };
  }, [steps]);

  return (
    <div className="h-[300px] w-full overflow-hidden rounded-xl border border-outline-variant/12 bg-surface-container-lowest/20">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={{ card: NodeCard as any }}
        fitView
        // 初始稍微放大一点：减少 padding，让默认视图更“近”
        fitViewOptions={{ padding: 0.08 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        panOnScroll
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} color="rgba(255,255,255,0.06)" />
      </ReactFlow>
    </div>
  );
}

