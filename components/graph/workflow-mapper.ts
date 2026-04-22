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
): {
  nodes: Node<WorkflowNodeData>[];
  edges: Edge[];
} {
  const MAX_VISIBLE = 42;
  const nodesSource = payload.nodes;
  const sorted = [...nodesSource].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const visible = sorted.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, sorted.length - visible.length);
  const visibleIds = new Set<string>();
  const nodes: Node<WorkflowNodeData>[] = [];

  function hash(s: string) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return Math.abs(h >>> 0);
  }

  visible.forEach((n, idx) => {
    const { layer, variant } = mapByNodeKind(n.nodeKind);
    const col = idx % 6;
    const row = Math.floor(idx / 6);
    const jitter = (hash(n.id) % 100) - 50;
    const baseX = 120 + col * 260;
    const baseY = 90 + row * 170;
    const layerOffset = layer === "input" ? -70 : layer === "output" ? 70 : 0;
    const x = baseX + layerOffset + jitter * 0.6;
    const y = baseY + ((hash(`${n.id}-y`) % 80) - 40);
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
      nodes.push({
        id: "collapsed:graph",
        type: "workflowNode",
        position: { x: 120, y: 60 + Math.ceil(visible.length / 6) * 170 },
        draggable: false,
        data: {
          title: `还有 ${hiddenCount} 个节点`,
          subtitle: "已折叠，避免图谱过长",
          layer: "agent",
          variant: "toolNode",
          reasoningLog: ["节点数量过多，已自动折叠。", "可通过筛选/分页进一步查看。"],
        },
      });
  }

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

