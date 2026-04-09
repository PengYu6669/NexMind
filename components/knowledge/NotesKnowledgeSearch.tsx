"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type RagHit = {
  noteId: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  distance: number;
  noteTitle?: string;
};

function snippet(text: string, max = 180) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function dedupeByNote(hits: RagHit[]): RagHit[] {
  const best = new Map<string, RagHit>();
  for (const h of hits) {
    const cur = best.get(h.noteId);
    if (!cur || h.distance < cur.distance) best.set(h.noteId, h);
  }
  return [...best.values()].sort((a, b) => a.distance - b.distance);
}

/** 嵌入知识库左栏：语义搜索 + 精简结果 */
export function NotesKnowledgeSearch() {
  const searchParams = useSearchParams();
  const initialQ = searchParams.get("q")?.trim() ?? "";

  const [query, setQuery] = useState(initialQ);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<RagHit[]>([]);

  const displayHits = useMemo(() => dedupeByNote(hits), [hits]);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) {
      setHits([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ query: trimmed, topK: 10 }),
      });
      const data = (await res.json().catch(() => null)) as { hits?: RagHit[]; error?: string };
      if (!res.ok) throw new Error(data?.error || "搜索失败");
      setHits(data.hits ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "搜索失败");
      setHits([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const q = searchParams.get("q")?.trim() ?? "";
    setQuery(q);
    if (q) void runSearch(q);
  }, [searchParams, runSearch]);

  const syncUrl = (q: string) => {
    const url = new URL(window.location.href);
    if (q.trim()) url.searchParams.set("q", q.trim());
    else url.searchParams.delete("q");
    window.history.replaceState(null, "", url.pathname + url.search);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void runSearch(query);
    syncUrl(query);
  };

  const showResultsPanel =
    query.trim().length > 0 && (loading || !!error || displayHits.length > 0 || (!loading && !error));

  return (
    <div className="shrink-0 border-b border-outline-variant/10 bg-surface-container-low/40 px-4 py-3">
      <form onSubmit={onSubmit} className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <MaterialIcon
            name="search"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-base text-slate-500"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="语义搜索知识库…"
            className="w-full rounded-lg border border-outline-variant/15 bg-surface-container-lowest py-2 pl-9 pr-3 text-xs text-on-surface outline-none ring-primary/20 placeholder:text-slate-500 focus:ring-1"
            autoComplete="off"
            aria-label="语义搜索知识库"
          />
        </div>
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 rounded-lg bg-primary/90 px-3 py-2 text-xs font-bold text-white hover:bg-primary disabled:opacity-50"
        >
          {loading ? "…" : "搜"}
        </button>
      </form>

      {error ? (
        <p className="mt-2 text-[11px] text-error">{error}</p>
      ) : null}

      {showResultsPanel ? (
        <div className="mt-2 max-h-[min(40vh,16rem)] space-y-1.5 overflow-y-auto overscroll-y-contain pr-0.5 [scrollbar-gutter:stable]">
          {loading ? (
            <p className="flex items-center gap-2 py-1 text-[11px] text-on-surface-variant">
              <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
              检索中…
            </p>
          ) : !error && query.trim() && displayHits.length === 0 ? (
            <p className="py-1 text-[11px] leading-relaxed text-on-surface-variant">
              无匹配片段。可换说法或先保存笔记以建立索引。
            </p>
          ) : (
            displayHits.map((h) => (
              <Link
                key={`${h.noteId}-${h.chunkId}`}
                href={`/notes/${h.noteId}`}
                className="block rounded-lg border border-outline-variant/10 bg-surface-container-lowest/90 px-2.5 py-2 transition-colors hover:border-primary/30 hover:bg-surface-container-low"
              >
                <p className="truncate text-[11px] font-semibold text-on-surface">{h.noteTitle || "未命名"}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-on-surface-variant">{snippet(h.content)}</p>
              </Link>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
