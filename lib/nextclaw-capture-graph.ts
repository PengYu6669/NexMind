export type CaptureGraphJob = {
  id: string;
  status: string;
  type: string;
  noteTitle: string;
  ui: {
    headline: string;
    currentStepLabel: string | null;
    steps: { id: string; label: string; status: string; toolSummary?: string }[];
    generatedNotes?: { id: string; title: string }[];
  };
};

export type CaptureGraphNode = {
  id: string;
  title: string;
  kind: "source" | "theme" | "note";
  status: "done" | "running" | "pending";
};

export type CaptureGraphEdge = {
  id: string;
  source: string;
  target: string;
  active: boolean;
};

export function extractFirstUrlFromJob(job: CaptureGraphJob): string | null {
  const text = [
    job.ui.headline,
    job.ui.currentStepLabel ?? "",
    ...job.ui.steps.map((s) => `${s.label} ${s.toolSummary ?? ""}`),
  ].join(" ");
  const matched = text.match(/https?:\/\/[^\s)>\]]+/);
  return matched?.[0] ?? null;
}

export function nodeIdForSource(jobId: string) {
  return `source:${jobId}`;
}
export function nodeIdForTheme(jobId: string, theme: string) {
  return `theme:${jobId}:${theme}`;
}
export function nodeIdForNote(noteId: string) {
  return `note:${noteId}`;
}

export function buildCaptureGraphChain(job: CaptureGraphJob): {
  nodes: CaptureGraphNode[];
  edges: CaptureGraphEdge[];
  sourceUrl: string | null;
} {
  const sourceStep = job.ui.steps.find((s) => s.id === "capture-source" && s.status === "done");
  const sourceReady = Boolean(sourceStep);
  const sourceStatus: CaptureGraphNode["status"] = sourceReady ? "done" : "pending";
  const sourceUrl = extractFirstUrlFromJob(job);
  const linkStep = job.ui.steps.find((s) => s.id === "capture-link");
  const theme = (linkStep?.toolSummary ?? "").match(/theme=([^;]+)/)?.[1]?.trim() || "";
  const splitRunning = job.ui.steps.some((s) => s.id.startsWith("capture-chunk-") && s.status === "running");

  const notes = Array.from(new Map((job.ui.generatedNotes ?? []).map((n) => [n.id, n.title])).entries()).map(
    ([id, title]) => ({ id, title }),
  );

  const nodes: CaptureGraphNode[] = [];
  const edges: CaptureGraphEdge[] = [];

  if (!sourceReady && !theme && notes.length === 0) {
    return { nodes, edges, sourceUrl };
  }

  const sourceId = nodeIdForSource(job.id);
  if (sourceReady) {
    nodes.push({
      id: sourceId,
      title: sourceUrl ? "来源" : "来源",
      kind: "source",
      status: sourceStatus,
    });
  }

  let themeId: string | null = null;
  if (theme) {
    themeId = nodeIdForTheme(job.id, theme);
    nodes.push({
      id: themeId,
      title: theme,
      kind: "theme",
      status: splitRunning ? "running" : "done",
    });
    if (sourceReady) {
      edges.push({ id: `${sourceId}=>${themeId}`, source: sourceId, target: themeId, active: true });
    }
  }

  notes.forEach((n, idx) => {
    const id = nodeIdForNote(n.id);
    nodes.push({
      id,
      title: n.title || "（无标题）",
      kind: "note",
      status: "done",
    });
    const parent = themeId ?? (sourceReady ? sourceId : null);
    if (parent) {
      edges.push({ id: `${parent}=>${id}`, source: parent, target: id, active: true });
    }
    if (idx > 0) {
      const prevId = nodeIdForNote(notes[idx - 1]!.id);
      edges.push({ id: `${prevId}=>${id}`, source: prevId, target: id, active: true });
    }
  });

  return { nodes, edges, sourceUrl };
}

