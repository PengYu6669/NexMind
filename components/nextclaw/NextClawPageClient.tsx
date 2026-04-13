"use client";

import { useCallback, useEffect, useState } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { NextClawCommandBar } from "@/components/nextclaw/NextClawCommandBar";
import { IntelligenceFeed, type IntelligenceFeedCard } from "@/components/nextclaw/IntelligenceFeed";
import { AgentOpsPanel } from "@/components/nextclaw/AgentOpsPanel";
import { NextClawTaskDesk } from "@/components/nextclaw/NextClawTaskDesk";
import { consumeChatMessageSse } from "@/lib/chat-sse";

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
      };
    }[]
  >([]);
  const [selectedAgentJobId, setSelectedAgentJobId] = useState<string | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);

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
      const activeRes = await fetch("/api/chat/active?purpose=nextclaw", { credentials: "include" });

      if (activeRes.ok) {
        const a = (await activeRes.json()) as { conversationId?: string | null };
        if (a.conversationId) setConversationId(a.conversationId);
      } else if (activeRes.status === 401) {
        setFeedError("请先登录后使用 NextClaw。");
      }

      await refreshFeed();
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

  useEffect(() => {
    if (!activeAgentJobs.length) return;
    const timer = window.setInterval(() => {
      void refreshFeed().catch(() => {});
    }, 3500);
    return () => window.clearInterval(timer);
  }, [activeAgentJobs.length, refreshFeed]);

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

  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-surface">
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

        <div className="flex min-h-0 flex-1 overflow-hidden pt-16 pb-8">
          <aside className="hidden min-h-0 w-[20%] min-w-[260px] max-w-[420px] flex-col overflow-hidden border-r border-outline-variant/10 bg-surface-container-lowest/20 lg:flex">
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

          <main className="flex min-h-0 w-full flex-col overflow-hidden bg-surface-container-lowest/10 lg:w-[55%]">
            <IntelligenceFeed
              cards={feedLoading ? null : feedCards}
              loading={feedLoading}
              error={feedError}
              activeAgentJobs={feedLoading ? [] : activeAgentJobs}
              selectedAgentJobId={selectedAgentJobId}
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

          <aside className="hidden min-h-0 w-[28%] min-w-[280px] flex-col overflow-hidden border-l border-outline-variant/10 bg-surface-container-lowest/20 glass-panel xl:flex">
            <AgentOpsPanel
              loading={feedLoading}
              jobs={feedLoading ? [] : activeAgentJobs}
              pendingJobs={pendingJobs}
              selectedJobId={selectedAgentJobId}
              onSelectJob={(jobId) => setSelectedAgentJobId(jobId)}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
