import type { Edge, Node } from "reactflow";
import type { GraphPayload } from "@/components/graph/KnowledgeGraphView";

export type WorkflowLayer = "input" | "agent" | "output";
export type WorkflowNodeType = "noteNode" | "searchNode" | "toolNode" | "auditNode" | "knowledgeNode" | "reviewNode";

export type WorkflowNodeData = {
  title: string;
  subtitle: string;
  excerpt?: string | null;
  updatedAt?: string;
  layer: WorkflowLayer;
  variant: WorkflowNodeType;
  reasoningLog: string[];
};

function mapByNodeKind(kind: "note" | "card" | "job" | undefined): {
  layer: WorkflowLayer;
  variant: WorkflowNodeType;
} {
  if (kind === "card") return { layer: "agent", variant: "auditNode" };
  if (kind === "job") return { layer: "output", variant: "knowledgeNode" };
  return { layer: "input", variant: "noteNode" };
}

function reasoningFromKind(
  kind: "note" | "card" | "job" | undefined,
  title: string,
  excerpt?: string | null,
): string[] {
  const base = excerpt?.trim() || "";
  if (kind === "card") {
    return [
      `学习卡片：${title}`,
      base ? `关键信息：${base.slice(0, 100)}${base.length > 100 ? "..." : ""}` : "卡片内容摘要为空",
      "建议关注：可执行步骤 / 易错点 / 自测问题",
    ];
  }
  if (kind === "job") {
    return [
      `任务记录：${title}`,
      "该节点主要用于回溯执行产物，不代表实时工作流状态。",
      base ? `摘要：${base.slice(0, 100)}${base.length > 100 ? "..." : ""}` : "无摘要",
    ];
  }
  return [
    `知识源笔记：${title}`,
    base ? `摘要线索：${base.slice(0, 100)}${base.length > 100 ? "..." : ""}` : "暂无摘要线索",
    "可用于关联冲突、补位与复习任务。",
  ];
}

export function mapGraphToWorkflow(
  payload: GraphPayload,
  opts?: { includeJobs?: boolean },
): {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
} {
  const includeJobs = opts?.includeJobs ?? false;
  const MAX_PER_LAYER = 14;
  const LANE_X: Record<WorkflowLayer, number> = { input: 120, agent: 620, output: 1120 };
  const COL_GAP = 300;
  const ROW_GAP = 140;
  const layerBuckets: Record<WorkflowLayer, GraphPayload["nodes"]> = { input: [], agent: [], output: [] };

  for (const n of payload.nodes) {
    if (!includeJobs && n.nodeKind === "job") continue;
    const { layer } = mapByNodeKind(n.nodeKind);
    layerBuckets[layer].push(n);
  }

  const visibleIds = new Set<string>();
  const nodes: Node<WorkflowNodeData>[] = [];

  (Object.keys(layerBuckets) as WorkflowLayer[]).forEach((layer) => {
    const bucket = layerBuckets[layer];
    bucket.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const visible = bucket.slice(0, MAX_PER_LAYER);
    const hiddenCount = Math.max(0, bucket.length - visible.length);

    visible.forEach((n, idx) => {
      const { variant } = mapByNodeKind(n.nodeKind);
      // 每层两列排布，减少纵向拉长
      const laneCol = idx % 2;
      const laneRow = Math.floor(idx / 2);
      const x = LANE_X[layer] + laneCol * COL_GAP;
      const y = 90 + laneRow * ROW_GAP + (laneCol === 1 ? 10 : 0);
      visibleIds.add(n.id);
      nodes.push({
        id: n.id,
        type: "workflowNode",
        position: { x, y },
        draggable: true,
        data: {
          title: n.title || "无标题",
          subtitle: `${n.degree} 关联`,
          excerpt: n.excerpt,
          updatedAt: n.updatedAt,
          layer,
          variant,
          reasoningLog:
            Array.isArray(n.reasoningLog) && n.reasoningLog.length
              ? n.reasoningLog
              : reasoningFromKind(n.nodeKind, n.title || "无标题", n.excerpt),
        },
      });
    });

    if (hiddenCount > 0) {
      const x = LANE_X[layer] + 110;
      const y = 90 + Math.ceil(visible.length / 2) * ROW_GAP;
      nodes.push({
        id: `collapsed:${layer}`,
        type: "workflowNode",
        position: { x, y },
        draggable: false,
        data: {
          title: `还有 ${hiddenCount} 个${layer}节点`,
          subtitle: "已折叠，避免图谱过长",
          layer,
          variant: layer === "input" ? "searchNode" : layer === "agent" ? "toolNode" : "reviewNode",
          reasoningLog: ["节点数量过多，已自动折叠。", "可通过筛选/分页进一步查看。"],
        },
      });
    }
  });

  const edges: Edge[] = payload.edges
    .map((e, i) => ({
      id: `e-${i}-${e.source}-${e.target}`,
      source: e.source,
      target: e.target,
      type: "animatedAuditEdge",
      animated: e.kind === "CONFLICT_HINT" || e.kind === "DERIVED_FROM",
      markerEnd: "url(#rf__arrowclosed)",
      data: { active: e.kind === "CONFLICT_HINT", kind: e.kind },
    }))
    .filter((e) => visibleIds.has(String(e.source)) && visibleIds.has(String(e.target)));

  return { nodes, edges };
}

