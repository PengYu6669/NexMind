"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { NextClawCommandBar } from "@/components/nextclaw/NextClawCommandBar";
import { IntelligenceFeed, type IntelligenceFeedCard } from "@/components/nextclaw/IntelligenceFeed";
import { consumeChatMessageSse } from "@/lib/chat-sse";

const NextClawTaskDesk = dynamic(
  () => import("@/components/nextclaw/NextClawTaskDesk").then((mod) => mod.NextClawTaskDesk),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-0 flex-col rounded-2xl border border-black/10 bg-white p-3">
        <div className="h-8 rounded-lg bg-black/[0.04]" />
        <div className="mt-3 h-24 rounded-xl bg-black/[0.035]" />
        <div className="mt-3 flex-1 rounded-xl bg-black/[0.03]" />
      </div>
    ),
  },
);

/** 与 GET /api/nextclaw/feed 返回的 cards 项对齐（避免客户端依赖 Prisma 类型） */
type ApiFeedCard = {
  id: string;
  noteId: string;
  noteTitle: string;
  uiType: IntelligenceFeedCard["type"];
  dbType?: IntelligenceFeedCard["dbType"];
  badgeLabel: string;
  title: string;
  summary: string;
  metaLeft: string;
  metaRight: string;
  chips?: string[];
  codeA?: string;
  codeB?: string;
  review?: IntelligenceFeedCard["review"];
};

function mapFeedDtoToCard(c: ApiFeedCard): IntelligenceFeedCard {
  return {
    id: c.id,
    noteId: c.noteId,
    type: c.uiType,
    dbType: c.dbType,
    badgeLabel: c.badgeLabel,
    title: c.title,
    summary: c.summary,
    metaLeft: `《${c.noteTitle}》`,
    metaRight: `${c.metaRight} · ${c.metaLeft}`,
    chips: c.chips,
    codeA: c.codeA,
    codeB: c.codeB,
    review: c.review,
  };
}

export function NextClawPageClient() {
  const [feedCards, setFeedCards] = useState<IntelligenceFeedCard[] | null>(null);
  const [feedLoading, setFeedLoading] = useState(true);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [pendingJobs, setPendingJobs] = useState(0);
  const [activeAgentJobs, setActiveAgentJobs] = useState<
    {
      id: string;
      status: string;
      type: string;
      noteTitle: string;
      ui: {
        headline: string;
        progress: number;
        currentStepLabel: string | null;
        steps: { id: string; label: string; status: string; toolSummary?: string }[];
        generatedNotes?: { id: string; title: string }[];
      };
    }[]
  >([]);
  const [selectedAgentJobId, setSelectedAgentJobId] = useState<string | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const firstSsePayloadRef = useRef(true);
  const activeJobsSignatureRef = useRef("");

  const refreshFeed = useCallback(async () => {
    const r = await fetch("/api/nextclaw/feed", { credentials: "include" });
    if (!r.ok) {
      if (r.status === 401) throw new Error("请先登录");
      throw new Error("加载智能流失败");
    }
    const data = (await r.json()) as {
      cards?: ApiFeedCard[];
      pendingJobs?: number;
      activeJobs?: {
        id: string;
        status: string;
        type: string;
        noteTitle: string;
        ui: {
          headline: string;
          progress: number;
          currentStepLabel: string | null;
          steps: { id: string; label: string; status: string; toolSummary?: string }[];
          generatedNotes?: { id: string; title: string }[];
        };
      }[];
    };
    const raw = Array.isArray(data.cards) ? data.cards : [];
    setFeedCards(raw.map(mapFeedDtoToCard));
    setPendingJobs(typeof data.pendingJobs === "number" ? data.pendingJobs : 0);
    setActiveAgentJobs(Array.isArray(data.activeJobs) ? data.activeJobs : []);
  }, []);

  useEffect(() => {
    if (!selectedAgentJobId) return;
    if (activeAgentJobs.some((j) => j.id === selectedAgentJobId)) return;
    setSelectedAgentJobId(null);
  }, [activeAgentJobs, selectedAgentJobId]);

  const bootstrap = useCallback(async () => {
    setFeedLoading(true);
    setFeedError(null);
    try {
      const activePromise = fetch("/api/chat/active?purpose=nextclaw", { credentials: "include" });
      const feedPromise = refreshFeed();
      const activeRes = await activePromise;

      if (activeRes.ok) {
        const a = (await activeRes.json()) as { conversationId?: string | null };
        if (a.conversationId) setConversationId(a.conversationId);
      } else if (activeRes.status === 401) {
        setFeedError("请先登录后使用 NextClaw。");
      }

      await feedPromise;
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : "加载失败");
      setFeedCards([]);
    } finally {
      setFeedLoading(false);
    }
  }, [refreshFeed]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const refreshFeedRef = useRef(refreshFeed);
  refreshFeedRef.current = refreshFeed;

  useEffect(() => {
    // 用 SSE 替代轮询：实时推送 activeJobs/pendingJobs，避免整包刷新导致卡顿
    let cancelled = false;
    let abort: AbortController | null = null;

    const connect = async () => {
      abort?.abort();
      abort = new AbortController();
      try {
        const res = await fetch("/api/nextclaw/feed/stream", {
          credentials: "include",
          headers: { Accept: "text/event-stream" },
          signal: abort.signal,
        });
        if (!res.ok) {
          throw new Error(res.status === 401 ? "请先登录" : `订阅失败：HTTP ${res.status}`);
        }
        if (!res.body) throw new Error("订阅响应为空");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const blk of blocks) {
            const lines = blk.split("\n");
            const event = (lines.find((x) => x.startsWith("event:")) ?? "").replace(/^event:\s*/, "").trim();
            const dataLine = (lines.find((x) => x.startsWith("data:")) ?? "").replace(/^data:\s*/, "").trim();
            if (!event || !dataLine) continue;
            if (event === "ping") continue;
            let payload: unknown = null;
            try {
              payload = JSON.parse(dataLine);
            } catch {
              continue;
            }

            if (event === "active_jobs") {
              const activePayload =
                payload && typeof payload === "object"
                  ? (payload as { activeJobs?: unknown; pendingJobs?: unknown })
                  : null;
              const jobs = Array.isArray(activePayload?.activeJobs) ? activePayload.activeJobs : [];
              const signature = JSON.stringify(
                jobs.map((job) => {
                  const j = job as {
                    id?: unknown;
                    status?: unknown;
                    ui?: { progress?: unknown; currentStepLabel?: unknown };
                  };
                  return [j.id, j.status, j.ui?.progress, j.ui?.currentStepLabel];
                }),
              );
              const isFirst = firstSsePayloadRef.current;
              const changed = signature !== activeJobsSignatureRef.current;
              firstSsePayloadRef.current = false;
              activeJobsSignatureRef.current = signature;
              if (!cancelled) {
                setActiveAgentJobs(jobs);
                setPendingJobs(typeof activePayload?.pendingJobs === "number" ? activePayload.pendingJobs : 0);
                // 首包只同步当前任务态；后续状态变化再刷新卡片，避免进页重复拉 feed。
                if (!isFirst && changed) {
                  refreshFeedRef.current().catch(() => {});
                }
              }
            }
          }
        }
      } catch {
        // 断线自动重连（不阻塞 UI）
        if (cancelled) return;
        setTimeout(() => {
          if (!cancelled) void connect();
        }, 1200);
      }
    };

    void connect();
    return () => {
      cancelled = true;
      abort?.abort();
    };
  }, []);

  const sendNextClaw = useCallback(
    async (text: string, opts?: { learningCardId?: string; noteId?: string }) => {
      if (!conversationId) {
        return;
      }
      setCommandBusy(true);
      try {
        const res = await fetch("/api/chat/message", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            content: text,
            conversationId,
            nextclaw: true,
            ...(opts?.noteId ? { noteId: opts.noteId } : {}),
            ...(opts?.learningCardId ? { learningCardId: opts.learningCardId } : {}),
          }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(err?.error || `请求失败 (${res.status})`);
        }
        if (!res.body) throw new Error("响应体为空");
        await consumeChatMessageSse(res.body);
        void refreshFeed();
      } catch {
        // noop: errors are surfaced in feed/task UI
      } finally {
        setCommandBusy(false);
      }
    },
    [conversationId, refreshFeed],
  );

  // NOTE_EXTERNAL_INJECT（capture）是“资料摄取管道”，不属于多节点 Agent 工作流展示范畴；
  // 中间区域只展示真正的学习/自治工作流，避免重复与错位。
  const workflowJobs = useMemo(
    () => activeAgentJobs.filter((j) => j.type !== "NOTE_EXTERNAL_INJECT"),
    [activeAgentJobs],
  );
  const captureJobs = useMemo(
    () => activeAgentJobs.filter((j) => j.type === "NOTE_EXTERNAL_INJECT"),
    [activeAgentJobs],
  );

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-[#fbfbfa] font-body text-black">
      <AppSidebar />
      <div className="flex h-full min-h-0 flex-col pl-64">
        <AppTopBar
          center={
            <NextClawCommandBar
              disabled={commandBusy}
              onSubmit={(text) => {
                void sendNextClaw(text);
              }}
            />
          }
        />

        <div className="flex min-h-0 flex-1 overflow-hidden pb-6 pt-16">
          <aside className="hidden min-h-0 w-[20%] min-w-[260px] max-w-[420px] flex-col overflow-hidden border-r border-black/10 bg-white lg:flex">
            {/* 控制台：占满左侧栏剩余空间 */}
            <div className="min-h-0 flex-1 overflow-hidden p-3">
              <NextClawTaskDesk
                className="h-full"
                onTasksChanged={() => {
                  void refreshFeed();
                }}
              />
            </div>
          </aside>

          <main className="flex min-h-0 w-full flex-col overflow-hidden bg-[#fbfbfa]">
            <IntelligenceFeed
              cards={feedLoading ? null : feedCards}
              loading={feedLoading}
              error={feedError}
              activeAgentJobs={feedLoading ? [] : workflowJobs}
              graphJobs={feedLoading ? [] : captureJobs}
              pendingJobs={pendingJobs}
              selectedAgentJobId={selectedAgentJobId}
              onSelectAgentJob={(jobId) => setSelectedAgentJobId(jobId)}
              onAsk={(payload) => {
                void sendNextClaw(payload.text, {
                  learningCardId: payload.cardId,
                  noteId: payload.noteId,
                });
              }}
              onAfterReviewScore={() => {
                void refreshFeed();
              }}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
