"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { NextClawCommandBar } from "@/components/nextclaw/NextClawCommandBar";
import { IntelligenceFeed, type IntelligenceFeedCard } from "@/components/nextclaw/IntelligenceFeed";
import { AnalysisDashboard } from "@/components/nextclaw/AnalysisDashboard";
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
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [statusLines, setStatusLines] = useState<string[]>([
    "冲突/补位信号扫描：对照历史笔记片段做一致性检查。",
    "技术栈指纹（Tech Stack Fingerprint）：用于外部情报降噪与优先级。",
    "复习调度：结合 SM2 与到期队列更新间隔。",
  ]);

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

  const [dashLoading, setDashLoading] = useState(true);
  const [dashboard, setDashboard] = useState<{
    radar: { label: string; value: number }[];
    ribbon: { date: string; label: string; cards: number; due: number; overdue: number; heat: number; pulse?: boolean }[];
    reviewStage: string;
    retentionPercent: number;
    dueToday: number;
    pendingJobs: number;
    reviewQueue?: {
      id: string;
      noteId: string;
      title: string;
      stageLabel: string;
      dueDate?: string;
      learningCardId?: string | null;
      prompt?: string;
    }[];
  } | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);

  const appendStatus = useCallback((line: string) => {
    setStatusLines((prev) => [line, ...prev].slice(0, 8));
  }, []);

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

  const refreshDashboard = useCallback(async () => {
    const r = await fetch("/api/nextclaw/dashboard", { credentials: "include" });
    if (!r.ok) {
      if (r.status === 401) throw new Error("请先登录");
      throw new Error("加载看板失败");
    }
    const data = (await r.json()) as {
      radar?: { label: string; value: number }[];
      ribbon?: { date: string; label: string; cards: number; due: number; overdue: number; heat: number; pulse?: boolean }[];
      reviewStage?: string;
      stats?: { retentionPercent?: number; dueToday?: number; pendingJobs?: number };
      reviewQueue?: {
        id: string;
        noteId: string;
        title: string;
        stageLabel: string;
        dueDate?: string;
        learningCardId?: string | null;
        prompt?: string;
      }[];
    };
    setDashboard({
      radar: data.radar ?? [],
      ribbon: data.ribbon ?? [],
      reviewStage: data.reviewStage ?? "L1",
      retentionPercent: typeof data.stats?.retentionPercent === "number" ? data.stats.retentionPercent : 0,
      dueToday: typeof data.stats?.dueToday === "number" ? data.stats.dueToday : 0,
      pendingJobs: typeof data.stats?.pendingJobs === "number" ? data.stats.pendingJobs : 0,
      reviewQueue: Array.isArray(data.reviewQueue) ? data.reviewQueue : undefined,
    });
  }, []);

  const bootstrap = useCallback(async () => {
    setFeedLoading(true);
    setDashLoading(true);
    setFeedError(null);
    try {
      const [memRes, activeRes] = await Promise.all([
        fetch("/api/user/nextclaw-memory", { credentials: "include" }),
        fetch("/api/chat/active?purpose=nextclaw", { credentials: "include" }),
      ]);

      if (memRes.ok) {
        const mem = (await memRes.json()) as { memoryEnabled?: boolean };
        if (typeof mem.memoryEnabled === "boolean") setMemoryEnabled(mem.memoryEnabled);
      }

      if (activeRes.ok) {
        const a = (await activeRes.json()) as { conversationId?: string | null };
        if (a.conversationId) setConversationId(a.conversationId);
      } else if (activeRes.status === 401) {
        setFeedError("请先登录后使用 NextClaw。");
      }

      await Promise.all([refreshFeed(), refreshDashboard()]);
    } catch (e) {
      setFeedError(e instanceof Error ? e.message : "加载失败");
      setFeedCards([]);
    } finally {
      setFeedLoading(false);
      setDashLoading(false);
    }
  }, [refreshDashboard, refreshFeed]);

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

  const toggleMemory = async () => {
    setMemoryBusy(true);
    try {
      const next = !memoryEnabled;
      const r = await fetch("/api/user/nextclaw-memory", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memoryEnabled: next }),
      });
      if (!r.ok) throw new Error("保存失败");
      setMemoryEnabled(next);
      appendStatus(next ? "已开启：下次对话会更记得你的偏好。" : "已关闭：不再自动带入偏好（已保存的不会丢）。");
    } catch {
      appendStatus("开关没保存成功，请稍后再试。");
    } finally {
      setMemoryBusy(false);
    }
  };

  const sendNextClaw = useCallback(
    async (text: string, opts?: { learningCardId?: string; noteId?: string }) => {
      if (!conversationId) {
        appendStatus("还没连上对话，请刷新页面再试一次。");
        return;
      }
      setCommandBusy(true);
        appendStatus(`已发送：${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`);
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
        const reply = await consumeChatMessageSse(res.body);
        const short = reply.replace(/\s+/g, " ").trim().slice(0, 360);
        appendStatus(short ? `回复摘要：${short}${reply.length > 360 ? "…" : ""}` : "已回复，可在中间区域查看。");
        void refreshFeed();
        void refreshDashboard();
      } catch (e) {
        appendStatus(e instanceof Error ? e.message : "发送失败");
      } finally {
        setCommandBusy(false);
      }
    },
    [appendStatus, conversationId, refreshDashboard, refreshFeed],
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
                  appendStatus("学习进度已更新。");
                  void Promise.all([refreshFeed(), refreshDashboard()]);
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
              onAsk={(payload) => {
                void sendNextClaw(payload.text, {
                  learningCardId: payload.cardId,
                  noteId: payload.noteId,
                });
              }}
              onAfterReviewScore={() => {
                void Promise.all([refreshFeed(), refreshDashboard()]);
              }}
            />
          </main>

          <aside className="hidden min-h-0 w-[28%] min-w-[280px] flex-col overflow-hidden border-l border-outline-variant/10 bg-surface-container-lowest/20 glass-panel xl:flex">
            <AnalysisDashboard
              loading={dashLoading}
              radar={dashboard?.radar}
              ribbon={dashboard?.ribbon}
              reviewStage={dashboard?.reviewStage}
              retentionPercent={dashboard?.retentionPercent ?? 0}
              dueToday={dashboard?.dueToday}
              pendingJobs={dashboard?.pendingJobs ?? pendingJobs}
              reviewQueue={dashboard?.reviewQueue}
              onAfterReviewScore={() => {
                void Promise.all([refreshFeed(), refreshDashboard()]);
              }}
            />
          </aside>
        </div>
      </div>
    </div>
  );
}
