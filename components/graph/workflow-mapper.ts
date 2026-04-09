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

function reasoningFromNode(title: string, excerpt?: string | null): string[] {
  const base = excerpt?.trim() || "";
  return [
    `接收输入：${title}`,
    "执行一致性检查与语义对齐",
    base ? `关键线索：${base.slice(0, 88)}${base.length > 88 ? "..." : ""}` : "关键线索：暂无摘要，使用标题与关联边推断",
    "输出候选：补位/冲突/复习建议",
  ];
}

export function mapGraphToWorkflow(payload: GraphPayload): {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
} {
  const MAX_PER_LAYER = 14;
  const LANE_X: Record<WorkflowLayer, number> = { input: 120, agent: 620, output: 1120 };
  const COL_GAP = 300;
  const ROW_GAP = 140;
  const layerBuckets: Record<WorkflowLayer, GraphPayload["nodes"]> = { input: [], agent: [], output: [] };

  for (const n of payload.nodes) {
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
              : reasoningFromNode(n.title || "无标题", n.excerpt),
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

  const edges: Edge[] = payload.edges.map((e, i) => ({
    id: `e-${i}-${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    type: "animatedAuditEdge",
    animated: true,
    markerEnd: "url(#rf__arrowclosed)",
    data: { active: i % 3 === 0 },
  })).filter((e) => visibleIds.has(String(e.source)) && visibleIds.has(String(e.target)));

  return { nodes, edges };
}

