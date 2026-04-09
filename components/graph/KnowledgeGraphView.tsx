"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Edge,
  useEdgesState,
  useNodesState,
} from "reactflow";
import "reactflow/dist/style.css";
import { WorkflowNode } from "@/components/graph/nodes/WorkflowNode";
import { AnimatedAuditEdge } from "@/components/graph/edges/AnimatedAuditEdge";
import { mapGraphToWorkflow, type WorkflowNodeData } from "@/components/graph/workflow-mapper";
import { ReasoningDrawer } from "@/components/graph/ReasoningDrawer";

export type GraphNodePayload = {
  id: string;
  title: string;
  degree: number;
  excerpt: string | null;
  updatedAt: string;
  nodeKind?: "note" | "card" | "job";
  reasoningLog?: string[];
};

export type GraphPayload = {
  nodes: GraphNodePayload[];
  edges: { source: string; target: string }[];
};

export function KnowledgeGraphView() {
  const [data, setData] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeData, setSelectedNodeData] = useState<WorkflowNodeData | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/graph", { credentials: "include" });
      const json = (await res.json().catch(() => null)) as GraphPayload & { error?: string };
      if (!res.ok) throw new Error(json?.error || `加载失败 (${res.status})`);
      setData({
        nodes: json.nodes ?? [],
        edges: json.edges ?? [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchGraph();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchGraph, refreshTick]);

  const workflow = useMemo(() => (data ? mapGraphToWorkflow(data) : { nodes: [], edges: [] }), [data]);
  useEffect(() => setNodes(workflow.nodes), [workflow.nodes, setNodes]);
  useEffect(() => setEdges(workflow.edges), [workflow.edges, setEdges]);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/10 bg-surface-container-low/25 px-5 py-4 backdrop-blur-sm">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary/90">
              <MaterialIcon name="hub" className="text-lg" />
            </span>
            <h1 className="text-base font-bold tracking-tight text-on-surface/90">知识图谱</h1>
          </div>
          <p className="max-w-xl pl-10 text-[12px] leading-relaxed text-on-surface-variant/75">
            输入/搜索区 → Agent 审计加工区 → 知识存储掌握区
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          {data ? (
            <span className="rounded-full border border-outline-variant/10 bg-surface-container-highest/50 px-3 py-1.5 text-[11px] font-medium tabular-nums text-on-surface-variant/80">
              {data.nodes.length} 节点 · {data.edges.length} 条边
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-outline-variant/15 bg-surface-container-highest/50 px-3 py-1.5 text-[11px] font-semibold text-on-surface/90 transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary"
            onClick={() => {
              setRefreshTick((t) => t + 1);
            }}
            disabled={loading}
          >
            <MaterialIcon name="refresh" className="text-sm opacity-80" />
            刷新
          </button>
        </div>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_75%_65%_at_50%_38%,rgba(99,102,241,0.07),transparent_60%)]"
          aria-hidden
        />

        {error ? (
          <div className="relative flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-error">
            <MaterialIcon name="error" />
            {error}
            <button
              type="button"
              className="mt-2 text-xs font-bold text-primary hover:underline"
              onClick={() => setRefreshTick((t) => t + 1)}
            >
              重试加载
            </button>
          </div>
        ) : loading ? (
          <div className="relative flex h-full items-center justify-center gap-2 text-sm text-on-surface-variant">
            <span className="inline-block size-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
            加载数据中…
          </div>
        ) : !loading && !error && nodes.length === 0 ? (
          <div className="relative flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-on-surface-variant">
            <MaterialIcon name="hub" className="text-5xl text-primary/25" />
            <p className="font-medium text-on-surface/85">还没有可展示的关联</p>
            <p className="max-w-sm text-xs leading-relaxed text-on-surface-variant/75">
              在笔记中添加引用、抓取外部信息后，工作流节点会自动形成连线。
            </p>
          </div>
        ) : !loading && !error ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={{ workflowNode: WorkflowNode }}
            edgeTypes={{ animatedAuditEdge: AnimatedAuditEdge }}
            onNodeClick={(_, node) => {
              setSelectedNodeId(String(node.id));
              setSelectedNodeData((node.data as WorkflowNodeData | undefined) ?? null);
            }}
            onSelectionChange={({ nodes: selectedNodes }) => {
              if (!selectedNodes.length) return;
              const n = selectedNodes[0];
              setSelectedNodeId(String(n.id));
              setSelectedNodeData((n.data as WorkflowNodeData | undefined) ?? null);
            }}
            onPaneClick={() => {
              setSelectedNodeId(null);
              setSelectedNodeData(null);
            }}
            fitView
            fitViewOptions={{ padding: 0.18, minZoom: 0.58 }}
            minZoom={0.4}
            maxZoom={1.8}
          >
            <Background gap={24} size={1} />
            <MiniMap pannable zoomable />
            <Controls showInteractive={false} />
          </ReactFlow>
        ) : (
          <div className="relative flex h-full items-center justify-center text-sm text-on-surface-variant">
            正在初始化画布…
          </div>
        )}
        <div className="relative z-[1200]">
          <ReasoningDrawer
            open={Boolean(selectedNodeId && selectedNodeData)}
            data={selectedNodeData}
            onClose={() => {
              setSelectedNodeId(null);
              setSelectedNodeData(null);
            }}
          />
        </div>
      </div>
    </div>
  );
}
