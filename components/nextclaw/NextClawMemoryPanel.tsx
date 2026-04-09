"use client";

import { useCallback, useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type Snapshot = {
  id: string;
  summary: string;
  createdAt: string;
  recommendations: unknown;
  quizItems?: unknown;
} | null;

export function NextClawMemoryPanel() {
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [memoryCount, setMemoryCount] = useState(0);
  const [snapshot, setSnapshot] = useState<Snapshot>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setErr(null);
    const r = await fetch("/api/user/nextclaw-memory", { credentials: "include" });
    if (!r.ok) {
      setErr(r.status === 401 ? "请先登录" : "加载失败");
      setLoading(false);
      return;
    }
    const data = (await r.json()) as {
      memoryEnabled: boolean;
      memoryCount: number;
      latestSnapshot: Snapshot;
    };
    setMemoryEnabled(data.memoryEnabled);
    setMemoryCount(data.memoryCount);
    setSnapshot(data.latestSnapshot);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const onUpdated = () => {
      void refresh();
    };
    window.addEventListener("nextclaw_study_snapshot_updated", onUpdated);
    return () => {
      window.removeEventListener("nextclaw_study_snapshot_updated", onUpdated);
    };
  }, [refresh]);

  const toggleMemory = async () => {
    setBusy(true);
    setErr(null);
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
    } catch {
      setErr("开关保存失败");
    } finally {
      setBusy(false);
    }
  };

  const clearMemory = async () => {
    if (!memoryCount) return;
    if (!window.confirm("确定清空 NextClaw 长期记忆？（学习快照仍会保留）")) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/user/nextclaw-memory", {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) throw new Error("清空失败");
      setMemoryCount(0);
    } catch {
      setErr("清空失败");
    } finally {
      setBusy(false);
    }
  };

  const recTitles =
    snapshot?.recommendations &&
    typeof snapshot.recommendations === "object" &&
    snapshot.recommendations !== null &&
    "recentNoteTitles" in snapshot.recommendations &&
    Array.isArray((snapshot.recommendations as { recentNoteTitles?: unknown }).recentNoteTitles)
      ? ((snapshot.recommendations as { recentNoteTitles: string[] }).recentNoteTitles as string[])
      : [];

  const quizPayload =
    snapshot?.quizItems && typeof snapshot.quizItems === "object" && snapshot.quizItems !== null
      ? (snapshot.quizItems as { quizItems?: unknown; cards?: unknown })
      : null;

  const quizQuestions =
    quizPayload?.quizItems && Array.isArray(quizPayload.quizItems) ? (quizPayload.quizItems as unknown[]) : [];

  const quizCards =
    quizPayload?.cards && Array.isArray(quizPayload.cards) ? (quizPayload.cards as unknown[]) : [];

  if (loading) {
    return (
      <div className="shrink-0 border-b border-outline-variant/10 px-4 py-3 text-xs text-on-surface-variant">
        加载记忆与快照…
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-outline-variant/10 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-headline text-sm font-bold text-on-surface">记忆与快照</h2>
        <button
          type="button"
          role="switch"
          aria-label="NextClaw 长期记忆开关"
          aria-checked={memoryEnabled}
          disabled={busy}
          onClick={() => void toggleMemory()}
          className={`relative ml-auto inline-flex h-7 w-11 shrink-0 items-center rounded-full border border-outline-variant/20 transition-colors md:ml-0 ${
            memoryEnabled ? "bg-primary/35" : "bg-surface-container-high"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-on-surface shadow transition-transform ${
              memoryEnabled ? "translate-x-[22px] bg-primary-container" : "translate-x-1"
            }`}
          />
        </button>
        <span className="text-xs text-on-surface-variant">
          {memoryEnabled ? "注入与抽取已开启" : "已关闭（对话不再读写长期记忆）"}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-on-surface-variant">
        已存记忆条数：{memoryCount}。关闭后仅不注入/不抽取，已存数据保留。
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || memoryCount === 0}
          onClick={() => void clearMemory()}
          className="rounded-lg border border-outline-variant/20 px-2.5 py-1 text-xs font-medium text-on-surface transition-colors hover:border-error/40 hover:text-error disabled:opacity-40"
        >
          清空长期记忆
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
          className="rounded-lg border border-outline-variant/20 px-2.5 py-1 text-xs text-on-surface-variant hover:bg-surface-container-low"
        >
          刷新
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-error">{err}</p> : null}

      {snapshot?.summary ? (
        <div className="mt-3 rounded-xl border border-outline-variant/15 bg-surface-container-low/80 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-xs font-bold text-on-surface">
            <MaterialIcon name="insights" className="text-lg text-primary" />
            最近学习快照
            <span className="font-normal text-on-surface-variant">
              {new Date(snapshot.createdAt).toLocaleDateString("zh-CN")}
            </span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">{snapshot.summary}</p>

          {quizQuestions.length > 0 ? (
            <div className="mt-3">
              <div className="text-xs font-bold text-on-surface">自测题</div>
              <ul className="mt-2 space-y-2">
                {quizQuestions.slice(0, 5).map((q, idx) => {
                  const qq = q as { question?: unknown; answerKeyPoints?: unknown; answerKeyPoint?: unknown };
                  const question = String(qq.question ?? "").trim();
                  const pointsRaw = Array.isArray(qq.answerKeyPoints)
                    ? qq.answerKeyPoints
                    : Array.isArray(qq.answerKeyPoint)
                      ? qq.answerKeyPoint
                      : [];
                  const points = (pointsRaw as unknown[]).map((x) => String(x).trim()).filter(Boolean);
                  if (!question) return null;

                  return (
                    <li
                      key={`${question}-${idx}`}
                      className="rounded-lg border border-outline-variant/10 bg-surface-container-low/60 px-2.5 py-2"
                    >
                      <div className="text-[11px] font-semibold text-on-surface">
                        {idx + 1}. {question}
                      </div>
                      {points.length > 0 ? (
                        <div className="mt-1 text-[11px] text-on-surface-variant">
                          答案要点：{points.slice(0, 5).join("；")}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {quizCards.length > 0 ? (
            <div className="mt-3">
              <div className="text-xs font-bold text-on-surface">学习卡片（Q/A）</div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {quizCards.slice(0, 6).map((c, idx) => {
                  const cc = c as { front?: unknown; back?: unknown };
                  const front = String(cc.front ?? "").trim();
                  const back = String(cc.back ?? "").trim();
                  if (!front || !back) return null;

                  return (
                    <div
                      key={`${front}-${idx}`}
                      className="rounded-lg border border-outline-variant/10 bg-surface-container-low/60 px-2.5 py-2"
                    >
                      <div className="text-[11px] font-semibold text-on-surface">Q：{front}</div>
                      <div className="mt-1 text-[11px] text-on-surface-variant">A：{back}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {recTitles.length > 0 ? (
            <ul className="mt-2 list-inside list-disc text-[11px] text-on-surface-variant">
              {recTitles.slice(0, 5).map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-on-surface-variant">
          尚无快照。可在服务端配置定时任务调用{" "}
          <code className="rounded bg-surface-container-high px-1">POST /api/internal/learning/daily</code>{" "}
          生成。
        </p>
      )}
    </div>
  );
}
