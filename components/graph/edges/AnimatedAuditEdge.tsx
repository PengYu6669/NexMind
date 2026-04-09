"use client";

import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from "reactflow";

export function AnimatedAuditEdge(props: EdgeProps<{ active?: boolean }>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
    curvature: 0.32,
  });

  const active = Boolean(props.data?.active);
  return (
    <>
      <BaseEdge
        id={props.id}
        path={edgePath}
        markerEnd={props.markerEnd}
        style={{
          stroke: active ? "rgba(99,102,241,0.9)" : "rgba(148,163,184,0.5)",
          strokeWidth: active ? 2 : 1.4,
          strokeDasharray: "8 8",
          animation: "auditEdgeFlow 1.1s linear infinite",
        }}
      />
      {active ? (
        <EdgeLabelRenderer>
          <div
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}
            className="pointer-events-none absolute rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary"
          >
            processing
          </div>
        </EdgeLabelRenderer>
      ) : null}
    </>
  );
}

