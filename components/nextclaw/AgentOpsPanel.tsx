"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, CheckCircle2, Clock3, Loader2, XCircle } from "lucide-react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  buildCaptureGraphChain,
  extractFirstUrlFromJob,
  nodeIdForSource,
  nodeIdForTheme,
  nodeIdForNote,
  type CaptureGraphJob,
} from "@/lib/nextclaw-capture-graph";

type AgentJob = CaptureGraphJob & {
  ui: CaptureGraphJob["ui"] & {
    progress: number;
  };
};

function statusIcon(status: string) {
  if (status === "RUNNING") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "PENDING") return <Clock3 className="h-3.5 w-3.5 text-amber-500" />;
  if (status === "SUCCEEDED") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  if (status === "FAILED") return <XCircle className="h-3.5 w-3.5 text-error" />;
  return <Bot className="h-3.5 w-3.5 text-outline" />;
}

type GraphNode = SimulationNodeDatum & {
  id: string;
  title: string;
  kind: "source" | "theme" | "note";
  status: "done" | "running" | "pending";
  bornAt: number;
};

type GraphEdge = SimulationLinkDatum<GraphNode> & {
  id: string;
  source: string | GraphNode;
  target: string | GraphNode;
  active: boolean;
};

function nodeRefId(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && typeof (v as { id?: unknown }).id === "string") {
    return String((v as { id?: string }).id);
  }
  return "";
}

function makeNode(params: {
  id: string;
  title: string;
  kind: GraphNode["kind"];
  status: GraphNode["status"];
  bornAt: number;
  x?: number;
  y?: number;
}) {
  return {
    id: params.id,
    title: params.title,
    kind: params.kind,
    status: params.status,
    bornAt: params.bornAt,
    x: params.x,
    y: params.y,
  } as GraphNode;
}

function nodeRadius(node: GraphNode) {
  if (node.kind === "source") return 14;
  if (node.kind === "theme") return 11;
  return 9;
}

export function AgentOpsPanel({
  jobs,
  pendingJobs,
  loading,
  selectedJobId,
  onSelectJob,
}: {
  jobs: AgentJob[];
  pendingJobs: number;
  loading?: boolean;
  selectedJobId?: string | null;
  onSelectJob?: (jobId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState({ width: 620, height: 460 });
  const [panZoom, setPanZoom] = useState({ x: 0, y: 0, k: 1 });
  const graphByJobRef = useRef(new Map<string, { nodes: GraphNode[]; links: GraphEdge[] }>());
  const simulationRef = useRef<Simulation<GraphNode, GraphEdge> | null>(null);
  const panningRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const draggingNodeRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  const activeJob = useMemo(() => {
    if (!jobs.length) return null;
    if (selectedJobId) {
      const selected = jobs.find((x) => x.id === selectedJobId);
      if (selected) return selected;
    }
    return jobs[0] ?? null;
  }, [jobs, selectedJobId]);

  const graphData = useMemo(() => {
    if (!activeJob) return { nodes: [] as GraphNode[], links: [] as GraphEdge[] };
    const parsed = buildCaptureGraphChain(activeJob);
    let graph = graphByJobRef.current.get(activeJob.id);
    if (!graph) {
      graph = { nodes: [], links: [] };
      graphByJobRef.current.set(activeJob.id, graph);
    }

    const now = Date.now();
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const nextNodes: GraphNode[] = [];
    const nextLinks: GraphEdge[] = [];
    const sourceId = nodeIdForSource(activeJob.id);
    const sourceNode = parsed.nodes.find((n) => n.kind === "source");
    const themeNode = parsed.nodes.find((n) => n.kind === "theme");
    const noteNodes = parsed.nodes.filter((n) => n.kind === "note");

    if (sourceNode) {
      const source = byId.get(sourceId) ?? makeNode({
        id: sourceId,
        title: sourceNode.title,
        kind: "source",
        status: sourceNode.status,
        bornAt: now,
        x: 0,
        y: 0,
      });
      source.status = sourceNode.status;
      source.fx = 0;
      source.fy = 0;
      source.x = 0;
      source.y = 0;
      nextNodes.push(source);
    }

    let themeId: string | null = null;
    if (themeNode) {
      themeId = themeNode.id;
      const existing = byId.get(themeId);
      const theme = existing ?? makeNode({
        id: themeId,
        title: themeNode.title,
        kind: "theme",
        status: themeNode.status,
        bornAt: now,
        x: 120,
        y: 40,
      });
      theme.title = themeNode.title;
      theme.status = themeNode.status;
      nextNodes.push(theme);
      if (sourceNode) {
        nextLinks.push({
          id: `${sourceId}=>${themeId}`,
          source: sourceId,
          target: themeId,
          active: true,
        });
      }
    }

    noteNodes.forEach((noteNode, idx) => {
      const id = noteNode.id;
      const existing = byId.get(id);
      const angle = (Math.PI * 2 * idx) / Math.max(noteNodes.length, 1);
      const radius = themeId ? 220 : 170;
      const baseX = Math.cos(angle) * radius;
      const baseY = Math.sin(angle) * radius;
      const n =
        existing ??
        makeNode({
          id,
          title: noteNode.title || "（无标题）",
          kind: "note",
          status: noteNode.status,
          bornAt: now,
          x: baseX,
          y: baseY,
        });
      n.title = noteNode.title || "（无标题）";
      n.status = noteNode.status;
      nextNodes.push(n);
      const parent = themeId ?? (sourceNode ? sourceId : null);
      if (parent) {
        nextLinks.push({ id: `${parent}=>${id}`, source: parent, target: id, active: true });
      }
      if (idx > 0) {
        const prev = noteNodes[idx - 1]!.id;
        nextLinks.push({ id: `${prev}=>${id}`, source: prev, target: id, active: true });
      }
    });

    graph.nodes = nextNodes;
    graph.links = nextLinks;
    return graph;
  }, [activeJob?.id, activeJob?.ui?.steps, activeJob?.ui?.generatedNotes]);

  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graphData.links) {
      const a = nodeRefId(l.source);
      const b = nodeRefId(l.target);
      if (!a || !b) continue;
      if (!m.has(a)) m.set(a, new Set());
      if (!m.has(b)) m.set(b, new Set());
      m.get(a)!.add(b);
      m.get(b)!.add(a);
    }
    return m;
  }, [graphData.links]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const next = {
        width: Math.max(320, Math.floor(box.width)),
        height: Math.max(260, Math.floor(box.height)),
      };
      setViewport((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!activeJob) return;
    if (simulationRef.current) {
      simulationRef.current.stop();
    }
    const sim = forceSimulation(graphData.nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphEdge>(graphData.links)
          .id((d) => d.id)
          .distance((l) => {
            const s = l.source as GraphNode;
            const t = l.target as GraphNode;
            if (s.kind === "source" || t.kind === "source") return 160;
            if (s.kind === "theme" || t.kind === "theme") return 130;
            return 110;
          })
          .strength(0.35),
      )
      .force("charge", forceManyBody().strength(-430))
      .force("collide", forceCollide<GraphNode>((n) => nodeRadius(n) + 24).iterations(2))
      .force("center", forceCenter(0, 0))
      .alpha(1)
      .alphaDecay(0.08)
      .velocityDecay(0.32);
    sim.on("tick", () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setTick((v) => v + 1));
    });
    simulationRef.current = sim;
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      sim.stop();
    };
  }, [activeJob?.id, graphData.nodes, graphData.links]);

  useEffect(() => {
    if (!simulationRef.current) return;
    simulationRef.current.alpha(0.85).restart();
  }, [graphData.nodes.length, graphData.links.length]);

  const now = Date.now() + tick;
  const toScreen = (x: number, y: number) => ({
    x: viewport.width / 2 + panZoom.x + x * panZoom.k,
    y: viewport.height / 2 + panZoom.y + y * panZoom.k,
  });
  const toWorld = (sx: number, sy: number) => ({
    x: (sx - viewport.width / 2 - panZoom.x) / panZoom.k,
    y: (sy - viewport.height / 2 - panZoom.y) / panZoom.k,
  });

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.92 : 1.08;
    const nextK = Math.max(0.45, Math.min(2.8, panZoom.k * delta));
    setPanZoom((p) => ({ ...p, k: nextK }));
  };

  const handleMouseDownBackground = (e: React.MouseEvent<SVGSVGElement>) => {
    if (draggingNodeRef.current) return;
    panningRef.current = { active: true, x: e.clientX, y: e.clientY };
  };
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const dragId = draggingNodeRef.current;
    if (dragId) {
      const n = graphData.nodes.find((x) => x.id === dragId);
      if (!n) return;
      const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
      const world = toWorld(e.clientX - box.left, e.clientY - box.top);
      n.fx = world.x;
      n.fy = world.y;
      n.x = world.x;
      n.y = world.y;
      simulationRef.current?.alpha(0.25).restart();
      return;
    }
    if (!panningRef.current.active) return;
    const dx = e.clientX - panningRef.current.x;
    const dy = e.clientY - panningRef.current.y;
    panningRef.current.x = e.clientX;
    panningRef.current.y = e.clientY;
    setPanZoom((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
  };
  const endPointer = () => {
    panningRef.current.active = false;
    const dragId = draggingNodeRef.current;
    if (dragId) {
      const n = graphData.nodes.find((x) => x.id === dragId);
      if (n && n.kind !== "source") {
        n.fx = undefined;
        n.fy = undefined;
      }
      draggingNodeRef.current = null;
    }
  };

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-outline-variant/10 px-5 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h2 className="truncate font-headline text-sm font-black tracking-tight text-on-surface">知识摄取预览</h2>
          </div>
          <span className="rounded-md border border-outline-variant/20 bg-surface-container-low/40 px-2 py-0.5 text-[11px] font-bold text-on-surface-variant">
            队列 {pendingJobs}
          </span>
        </div>
        <p className="mt-1 text-xs text-on-surface-variant">从来源到主题拆分再到笔记连线，实时预览知识图谱成形过程</p>
      </div>

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/20 px-3 py-4 text-center text-xs text-on-surface-variant">
            正在加载 Agent 任务…
          </div>
        ) : jobs.length === 0 ? (
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-low/20 px-3 py-4 text-center text-xs text-on-surface-variant">
            当前没有运行中的 Agent 任务
          </div>
        ) : null}

        {!loading && jobs.length > 0 && activeJob ? (
          <>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {jobs.map((job) => {
                const selected = job.id === activeJob.id;
                return (
                  <button
                    key={job.id}
                    type="button"
                    onClick={() => onSelectJob?.(job.id)}
                    className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold transition-colors ${
                      selected
                        ? "border-primary/35 bg-primary/15 text-primary"
                        : "border-outline-variant/15 bg-surface-container-low/25 text-on-surface-variant hover:bg-surface-container-low/40"
                    }`}
                  >
                    {statusIcon(job.status)}
                    <span className="max-w-[120px] truncate">{job.noteTitle}</span>
                  </button>
                );
              })}
            </div>

            <div className="h-full rounded-xl border border-outline-variant/15 bg-surface-container-low/20 p-2">
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <div className="min-w-0">
                  <div className="truncate text-[11px] font-black text-on-surface">知识图谱预览</div>
                  <div className="mt-0.5 truncate text-[10px] text-on-surface-variant">{activeJob.noteTitle}</div>
                </div>
                <span className="shrink-0 rounded-md bg-surface-container-highest/35 px-2 py-1 text-[10px] font-bold text-on-surface-variant">
                  {Math.round((activeJob.ui.progress ?? 0) * 100)}%
                </span>
              </div>

              <div ref={hostRef} className="h-[100%] min-h-[380px] overflow-hidden rounded-lg border border-outline-variant/12 bg-[#040713]">
                <svg
                  width={viewport.width}
                  height={viewport.height}
                  className="h-full w-full cursor-grab active:cursor-grabbing"
                  onWheel={handleWheel}
                  onMouseDown={handleMouseDownBackground}
                  onMouseMove={handleMouseMove}
                  onMouseUp={endPointer}
                  onMouseLeave={endPointer}
                >
                  <defs>
                    <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="3.2" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="rgba(4,7,19,0.98)" />
                  {graphData.links.map((l) => {
                    const sid = nodeRefId(l.source);
                    const tid = nodeRefId(l.target);
                    const s = graphData.nodes.find((n) => n.id === sid);
                    const t = graphData.nodes.find((n) => n.id === tid);
                    if (!s || !t) return null;
                    const ps = toScreen(s.x ?? 0, s.y ?? 0);
                    const pt = toScreen(t.x ?? 0, t.y ?? 0);
                    const mx = (ps.x + pt.x) / 2;
                    const my = (ps.y + pt.y) / 2;
                    const dx = pt.x - ps.x;
                    const dy = pt.y - ps.y;
                    const curve = Math.min(24, Math.max(-24, (dx + dy) * 0.03));
                    const hover = hoverNodeId && (hoverNodeId === sid || hoverNodeId === tid);
                    return (
                      <path
                        key={l.id}
                        d={`M ${ps.x} ${ps.y} Q ${mx + curve} ${my - curve} ${pt.x} ${pt.y}`}
                        fill="none"
                        stroke={hover ? "rgba(236,72,153,0.92)" : "rgba(196,142,255,0.45)"}
                        strokeWidth={hover ? 2.2 : 1.4}
                        opacity={l.active ? 1 : 0.28}
                      />
                    );
                  })}
                  {graphData.nodes.map((n) => {
                    const p = toScreen(n.x ?? 0, n.y ?? 0);
                    const hover = hoverNodeId === n.id;
                    const nearHover = hoverNodeId ? adjacency.get(hoverNodeId)?.has(n.id) : false;
                    const baseR = n.kind === "source" ? 15 : n.kind === "theme" ? 12 : 9.5;
                    const age = Math.max(0, now - n.bornAt);
                    const appear = Math.min(1, age / 280);
                    const r = baseR * (0.45 + 0.55 * appear);
                    const fill =
                      n.kind === "source"
                        ? "rgba(122,63,255,0.92)"
                        : n.kind === "theme"
                          ? "rgba(167,106,255,0.82)"
                          : "rgba(196,142,255,0.72)";
                    const stroke = hover ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.22)";
                    const opacity = 0.45 + appear * 0.55;
                    return (
                      <g
                        key={n.id}
                        onMouseEnter={() => setHoverNodeId(n.id)}
                        onMouseLeave={() => setHoverNodeId((prev) => (prev === n.id ? null : prev))}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          draggingNodeRef.current = n.id;
                          n.fx = n.x ?? 0;
                          n.fy = n.y ?? 0;
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <circle
                          cx={p.x}
                          cy={p.y}
                          r={r + (hover ? 2 : nearHover ? 1 : 0)}
                          fill={fill}
                          opacity={opacity}
                          stroke={stroke}
                          strokeWidth={hover ? 2 : 1}
                          filter="url(#nodeGlow)"
                        />
                        <text
                          x={p.x}
                          y={p.y + r + 12}
                          textAnchor="middle"
                          fill={hover ? "rgba(255,255,255,0.98)" : "rgba(235,222,255,0.88)"}
                          fontSize={11}
                          fontWeight={n.kind === "source" ? 700 : 500}
                        >
                          {(n.title || "").slice(0, 18)}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              </div>

              <div className="mt-2 px-1 text-[10px] text-on-surface-variant">
                {extractFirstUrlFromJob(activeJob)
                  ? `来源：${extractFirstUrlFromJob(activeJob)}`
                  : "来源：后端生成后将自动出现"}
              </div>
              <div className="mt-1 px-1 text-[10px] text-on-surface-variant">
                节点数：{graphData.nodes.length} · 边数：{graphData.links.filter((x) => x.active).length}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
