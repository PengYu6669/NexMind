"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import {
  buildCaptureGraphChain,
  type CaptureGraphJob,
} from "@/lib/nextclaw-capture-graph";

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
  edges: { source: string; target: string; kind?: "LINK" | "DERIVED_FROM" | "PRODUCES" | "CONFLICT_HINT" }[];
};

type FolderOption = { id: string; name: string };

export function KnowledgeGraphView() {
  const router = useRouter();
  const [data, setData] = useState<GraphPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [folderId, setFolderId] = useState<string>("__all__");
  const [activeJobs, setActiveJobs] = useState<CaptureGraphJob[]>([]);
  const [viewport, setViewport] = useState({ width: 900, height: 640 });
  const hostRef = useRef<HTMLDivElement | null>(null);
  const simulationRef = useRef<Simulation<RenderNode, RenderEdge> | null>(null);
  const panningRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const draggingNodeRef = useRef<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [panZoom, setPanZoom] = useState({ x: 0, y: 0, k: 1 });
  const fitMetaRef = useRef<{ lastNodeCount: number; fittedOnce: boolean }>({ lastNodeCount: 0, fittedOnce: false });

  const fetchGraph = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query = folderId ? `?folderId=${encodeURIComponent(folderId)}` : "";
      const res = await fetch(`/api/graph${query}`, { credentials: "include" });
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
  }, [folderId]);

  const fetchActiveJobs = useCallback(async () => {
    try {
      const res = await fetch("/api/nextclaw/feed", { credentials: "include" });
      const json = (await res.json().catch(() => null)) as {
        activeJobs?: CaptureGraphJob[];
      } | null;
      if (!res.ok) return;
      setActiveJobs(Array.isArray(json?.activeJobs) ? json!.activeJobs! : []);
    } catch {
      // ignore
    }
  }, []);

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch("/api/notes/folders", { credentials: "include" });
      const json = (await res.json().catch(() => null)) as { folders?: { id: string; name: string }[] };
      if (!res.ok) return;
      setFolders((json.folders ?? []).map((f) => ({ id: f.id, name: f.name })));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([fetchFolders(), fetchGraph(), fetchActiveJobs()]);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchFolders, fetchGraph, fetchActiveJobs, refreshTick]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      const next = {
        width: Math.max(360, Math.floor(box.width)),
        height: Math.max(360, Math.floor(box.height)),
      };
      setViewport((prev) => (prev.width === next.width && prev.height === next.height ? prev : next));
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [loading, error]);

  type FGNode = {
    id: string;
    title: string;
    degree: number;
    nodeKind?: GraphNodePayload["nodeKind"];
    kind?: "source" | "theme" | "note";
  };
  type FGLink = {
    source: string;
    target: string;
    kind?: GraphPayload["edges"][number]["kind"];
  };

  type RenderNode = SimulationNodeDatum & FGNode & { bornAt: number; clusterX?: number; clusterY?: number };
  type RenderEdge = SimulationLinkDatum<RenderNode> & FGLink & { id: string; source: string | RenderNode; target: string | RenderNode };

  const graphData = useMemo(() => {
    const baseNodes: FGNode[] = (data?.nodes ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      degree: n.degree,
      nodeKind: n.nodeKind,
      kind: n.id.startsWith("source:") ? "source" : n.id.startsWith("theme:") ? "theme" : "note",
    }));
    const baseLinks: FGLink[] = (data?.edges ?? []).map((e) => ({
      source: e.source,
      target: e.target,
      kind: e.kind,
    }));

    // 与 NextClaw 预览保持一致：叠加 capture 的 来源->主题->笔记 链路
    const captureJobs = (activeJobs ?? []).filter((j) => j.type === "NOTE_EXTERNAL_INJECT");
    const overlayNodes: FGNode[] = [];
    const overlayLinks: FGLink[] = [];
    for (const job of captureJobs) {
      const chain = buildCaptureGraphChain(job);
      for (const n of chain.nodes) {
        overlayNodes.push({
          id: n.id,
          title: n.title,
          degree: 1,
          nodeKind: n.kind === "source" ? "job" : "note",
          kind: n.kind,
        });
      }
      for (const e of chain.edges) {
        overlayLinks.push({
          source: e.source,
          target: e.target,
          kind: "PRODUCES",
        });
      }
    }

    const nodeMap = new Map<string, FGNode>();
    for (const n of baseNodes) nodeMap.set(n.id, n);
    for (const n of overlayNodes) {
      if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
    }

    const linkMap = new Map<string, FGLink>();
    for (const l of baseLinks) linkMap.set(`${String(l.source)}=>${String(l.target)}`, l);
    for (const l of overlayLinks) {
      const key = `${String(l.source)}=>${String(l.target)}`;
      if (!linkMap.has(key)) linkMap.set(key, l);
    }

    const links = Array.from(linkMap.values()).map((l) => ({
      ...l,
      id: `${String(l.source)}=>${String(l.target)}`,
      source: String(l.source),
      target: String(l.target),
    })) as RenderEdge[];

    const now = Date.now();
    const nodes = Array.from(nodeMap.values()).map((n) => ({ ...n, bornAt: now })) as RenderNode[];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const adjacency = new Map<string, Set<string>>();
    for (const n of nodes) adjacency.set(n.id, new Set());
    for (const l of links) {
      const s = String(l.source);
      const t = String(l.target);
      if (!adjacency.has(s) || !adjacency.has(t)) continue;
      adjacency.get(s)!.add(t);
      adjacency.get(t)!.add(s);
    }

    const visited = new Set<string>();
    const components: RenderNode[][] = [];
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      const queue = [node.id];
      const group: RenderNode[] = [];
      visited.add(node.id);
      while (queue.length) {
        const id = queue.shift()!;
        const current = byId.get(id);
        if (current) group.push(current);
        for (const nextId of adjacency.get(id) ?? []) {
          if (visited.has(nextId)) continue;
          visited.add(nextId);
          queue.push(nextId);
        }
      }
      components.push(group);
    }

    components.sort((a, b) => b.length - a.length);
    const cols = Math.max(1, Math.ceil(Math.sqrt(components.length)));
    const gapX = 360;
    const gapY = 280;
    components.forEach((group, componentIndex) => {
      const col = componentIndex % cols;
      const row = Math.floor(componentIndex / cols);
      const clusterX = (col - (cols - 1) / 2) * gapX;
      const clusterY = (row - Math.max(0, Math.ceil(components.length / cols) - 1) / 2) * gapY;
      const radius = Math.max(70, Math.min(220, 42 + group.length * 12));
      group.forEach((node, nodeIndex) => {
        const angle = (Math.PI * 2 * nodeIndex) / Math.max(1, group.length);
        const ring = group.length === 1 ? 0 : radius;
        node.clusterX = clusterX;
        node.clusterY = clusterY;
        node.x = clusterX + Math.cos(angle) * ring;
        node.y = clusterY + Math.sin(angle) * ring;
        if (node.kind === "source") {
          node.x = clusterX;
          node.y = clusterY;
          node.fx = clusterX;
          node.fy = clusterY;
        }
      });
    });

    return { nodes, links };
  }, [data, activeJobs]);

  useEffect(() => {
    if (simulationRef.current) simulationRef.current.stop();
    const sim = forceSimulation(graphData.nodes)
      .force(
        "link",
        forceLink<RenderNode, RenderEdge>(graphData.links)
          .id((d) => d.id)
          .distance((l) => {
            const s = l.source as RenderNode;
            const t = l.target as RenderNode;
            if (s.kind === "source" || t.kind === "source") return 150;
            if (s.kind === "theme" || t.kind === "theme") return 124;
            return 96 + Math.min(42, ((s.degree ?? 0) + (t.degree ?? 0)) * 4);
          })
          .strength(0.28),
      )
      .force("charge", forceManyBody<RenderNode>().strength((n) => -260 - Math.min(220, (n.degree ?? 0) * 32)))
      .force(
        "collide",
        forceCollide<RenderNode>((n) => {
          if (n.kind === "source") return 34;
          if (n.kind === "theme") return 30;
          return 24 + Math.min(10, (n.degree ?? 0) * 2);
        }).iterations(3),
      )
      .force("x", forceX<RenderNode>((n) => n.clusterX ?? 0).strength(0.055))
      .force("y", forceY<RenderNode>((n) => n.clusterY ?? 0).strength(0.055))
      .force("center", forceCenter(0, 0))
      .alpha(1)
      .alphaDecay(0.075)
      .velocityDecay(0.38);
    sim.on("tick", () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => setTick((v) => v + 1));
    });
    simulationRef.current = sim;
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      sim.stop();
    };
  }, [graphData.nodes, graphData.links]);

  useEffect(() => {
    const nodes = graphData.nodes;
    if (!nodes.length || viewport.width < 200 || viewport.height < 200) return;

    const shouldFit =
      !fitMetaRef.current.fittedOnce ||
      nodes.length >= fitMetaRef.current.lastNodeCount + 2 ||
      (fitMetaRef.current.lastNodeCount === 0 && nodes.length > 0);
    if (!shouldFit) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return;
    }

    const graphW = Math.max(120, maxX - minX);
    const graphH = Math.max(120, maxY - minY);
    const padding = 90;
    const fitK = Math.max(
      0.45,
      Math.min(2.8, Math.min((viewport.width - padding * 2) / graphW, (viewport.height - padding * 2) / graphH)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    setPanZoom({
      k: fitK,
      x: -cx * fitK,
      y: -cy * fitK,
    });
    fitMetaRef.current = { lastNodeCount: nodes.length, fittedOnce: true };
  }, [graphData.nodes, viewport.width, viewport.height]);

  const nodeStyle = (node: FGNode) => {
    const id = String(node.id || "");
    if (id.startsWith("source:")) {
      return { fill: "#111111", stroke: "#111111", label: "#111111", radius: 13 };
    }
    if (id.startsWith("theme:")) {
      return { fill: "#dceeb1", stroke: "#111111", label: "#111111", radius: 11 };
    }
    if (node.nodeKind === "job") return { fill: "#c8e6cd", stroke: "#111111", label: "#111111", radius: 10 };
    const degree = Math.max(0, Number(node.degree ?? 0));
    return { fill: "#ffffff", stroke: degree > 2 ? "#111111" : "#b8b8b2", label: "#343434", radius: Math.min(12, 7 + degree * 0.9) };
  };

  const toScreen = (x: number, y: number) => ({
    x: viewport.width / 2 + panZoom.x + x * panZoom.k,
    y: viewport.height / 2 + panZoom.y + y * panZoom.k,
  });
  const toWorld = (sx: number, sy: number) => ({
    x: (sx - viewport.width / 2 - panZoom.x) / panZoom.k,
    y: (sy - viewport.height / 2 - panZoom.y) / panZoom.k,
  });

  const handleWheel = (e: React.WheelEvent<SVGSVGElement>) => {
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

  // 每次渲染预构建节点索引与边类型标签（避免在 JSX map 中重复 O(N) 查找）
  const nodeIdx = useMemo(() => {
    const m = new Map<string, RenderNode>();
    for (const n of graphData.nodes) m.set(n.id, n);
    return m;
  }, [graphData.nodes]);
  const adjacency = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const n of graphData.nodes) m.set(n.id, new Set());
    for (const l of graphData.links) {
      const sid = String(typeof l.source === "object" ? (l.source as RenderNode).id : l.source);
      const tid = String(typeof l.target === "object" ? (l.target as RenderNode).id : l.target);
      if (!m.has(sid) || !m.has(tid)) continue;
      m.get(sid)!.add(tid);
      m.get(tid)!.add(sid);
    }
    return m;
  }, [graphData.links, graphData.nodes]);
  const edgeKindLabel: Record<string, string> = { LINK: "引用", DERIVED_FROM: "衍生", PRODUCES: "生成", CONFLICT_HINT: "冲突" };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[#fbfbfa] text-black">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-black/10 bg-white px-5 py-4">
        <div className="min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black text-white">
              <MaterialIcon name="hub" className="text-lg" />
            </span>
            <h1 className="text-base font-bold tracking-tight text-on-surface/90">知识图谱</h1>
          </div>
          <p className="max-w-xl pl-10 text-[12px] leading-relaxed text-on-surface-variant/75">
            仅展示真实引用关系，拖拽整理视图，双击节点打开对应笔记。
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
          <select
            className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold text-black outline-none transition-colors hover:border-black/30"
            value={folderId}
            onChange={(e) => setFolderId(e.target.value)}
            title="按文件夹筛选图谱"
          >
            <option value="__all__">全部文件夹</option>
            <option value="__uncat__">未分类</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          {data ? (
            <span className="rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-medium tabular-nums text-neutral-500">
              {data.nodes.length} 节点 · {data.edges.length} 条边
            </span>
          ) : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-full border border-black/10 bg-white px-3 py-1.5 text-[11px] font-semibold text-black transition-colors hover:border-black/30 hover:bg-neutral-100 disabled:opacity-50"
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
        <div className="pointer-events-none absolute inset-0 tech-grid opacity-35" aria-hidden />

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
        ) : !loading && !error && graphData.nodes.length === 0 ? (
          <div className="relative flex h-full flex-col items-center justify-center gap-2 p-8 text-center text-sm text-on-surface-variant">
            <MaterialIcon name="hub" className="text-5xl text-primary/25" />
            <p className="font-medium text-on-surface/85">还没有可展示的关联</p>
            <p className="max-w-sm text-xs leading-relaxed text-on-surface-variant/75">
              在笔记中添加引用、抓取外部信息后，工作流节点会自动形成连线。
            </p>
          </div>
        ) : !loading && !error ? (
          <div ref={hostRef} id="knowledge-graph-canvas-host" className="h-full w-full">
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
                <filter id="kgNodeGlow" x="-50%" y="-50%" width="200%" height="200%">
                  <feGaussianBlur stdDeviation="3.2" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <rect x={0} y={0} width={viewport.width} height={viewport.height} fill="#fbfbfa" />
              {graphData.links.map((l) => {
                const l2 = l as unknown as RenderEdge;
                const sid = String(typeof l2.source === "object" ? (l2.source as RenderNode).id : l2.source);
                const tid = String(typeof l2.target === "object" ? (l2.target as RenderNode).id : l2.target);
                const s = nodeIdx.get(sid);
                const t = nodeIdx.get(tid);
                if (!s || !t) return null;
                const ps = toScreen(s.x ?? 0, s.y ?? 0);
                const pt = toScreen(t.x ?? 0, t.y ?? 0);
                const mx = (ps.x + pt.x) / 2;
                const my = (ps.y + pt.y) / 2;
                const dx = pt.x - ps.x;
                const dy = pt.y - ps.y;
                const curve = Math.min(24, Math.max(-24, (dx + dy) * 0.03));
                const hover = hoverNodeId && (hoverNodeId === sid || hoverNodeId === tid);
                const dimmed = hoverNodeId && !hover;
                const kindLabel = edgeKindLabel[l2.kind ?? ""] ?? "";
                return (
                  <g key={`${sid}=>${tid}`}>
                    <path
                      d={`M ${ps.x} ${ps.y} Q ${mx + curve} ${my - curve} ${pt.x} ${pt.y}`}
                      fill="none"
                      stroke={hover ? "#111111" : "#cfcfca"}
                      strokeWidth={hover ? 1.8 : 1}
                      opacity={hover ? 0.95 : dimmed ? 0.18 : 0.62}
                    />
                    {kindLabel && hover ? (
                      <text
                        x={mx + curve * 1.4}
                        y={my - curve * 1.4 - 4}
                        textAnchor="middle"
                        fill="#111111"
                        fontSize={9}
                        fontWeight={600}
                      >
                        {kindLabel}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {graphData.nodes.map((n) => {
                const p = toScreen(n.x ?? 0, n.y ?? 0);
                const hover = hoverNodeId === n.id;
                const nearHover = hoverNodeId ? adjacency.get(hoverNodeId)?.has(n.id) : false;
                const dimmed = hoverNodeId && !hover && !nearHover;
                const style = nodeStyle(n);
                const age = Math.max(0, Date.now() + tick - n.bornAt);
                const appear = Math.min(1, age / 280);
                const radius = style.radius * (0.45 + 0.55 * appear);
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
                    onDoubleClick={() => {
                      const normalized = String(n.id || "").replace(/^note:/, "");
                      if (String(n.id || "").startsWith("note:") && normalized) router.push(`/notes/${normalized}`);
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <title>{n.title}</title>
                    <circle
                      cx={p.x}
                      cy={p.y}
                      r={radius + (hover ? 2 : nearHover ? 1 : 0)}
                      fill={style.fill}
                      opacity={dimmed ? 0.28 : 0.65 + appear * 0.35}
                      stroke={hover ? "#111111" : style.stroke}
                      strokeWidth={hover ? 2 : 1.3}
                      filter={hover ? "url(#kgNodeGlow)" : undefined}
                    />
                    <text
                      x={p.x}
                      y={p.y + radius + 12}
                      textAnchor="middle"
                      fill={hover ? "#111111" : style.label}
                      fontSize={11}
                      fontWeight={n.kind === "source" ? 700 : 500}
                      opacity={dimmed ? 0.22 : 1}
                    >
                      {n.title ? (n.title.length > 12 ? n.title.slice(0, 11) + "…" : n.title) : ""}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="relative flex h-full items-center justify-center text-sm text-on-surface-variant">
            正在初始化画布…
          </div>
        )}
      </div>
    </div>
  );
}
