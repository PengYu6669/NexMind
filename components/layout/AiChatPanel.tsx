"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { marked } from "marked";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { WorkspaceHomeStrip } from "@/components/layout/WorkspaceHomeStrip";

type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt?: string;
};

type NoteOption = { id: string; title: string };

type ConvSummary = {
  id: string;
  title: string;
  preview: string;
  updatedAt: string;
};

const STREAM_ASSISTANT_ID = "streaming-assistant";
const CHAT_CONV_STORAGE = "nexmind_chat_conversation_id";

function isPersistedChatMessageId(id: string): boolean {
  if (!id || id === STREAM_ASSISTANT_ID) return false;
  if (id.startsWith("user-") || id.startsWith("assistant-")) return false;
  return true;
}

const ALLOWED_HTML_TAGS = new Set([
  "p",
  "br",
  "strong",
  "em",
  "u",
  "code",
  "pre",
  "blockquote",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "a",
]);

function cleanAssistantMarkdown(text: string): string {
  if (!text) return "";
  return text
    .replace(/^\s*引用[:：].*$/gim, "")
    .replace(/\[(\d+)\](?=\s|$|[，。！？；：,.!?;:])/g, "")
    .replace(/\[(\d+)\]\[(\d+)\]/g, "")
    .replace(/^\s*(---+|\*\*\*+|___+)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function markdownToSafeHtml(md: string): string {
  const cleaned = cleanAssistantMarkdown(md);
  const raw = marked.parse(cleaned, { gfm: true, breaks: true }) as string;
  if (typeof window === "undefined") return raw;

  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, "text/html");

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (!ALLOWED_HTML_TAGS.has(tag)) {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
      return;
    }

    if (tag === "a") {
      const href = el.getAttribute("href") ?? "";
      if (!/^https?:\/\//i.test(href)) {
        el.removeAttribute("href");
      } else {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer nofollow");
      }
    } else {
      for (const attr of Array.from(el.attributes)) el.removeAttribute(attr.name);
    }

    for (const child of Array.from(el.childNodes)) walk(child);
  };

  for (const child of Array.from(doc.body.childNodes)) walk(child);
  return doc.body.innerHTML;
}

function formatConvListTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    if (Number.isNaN(d.getTime())) return "";
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) {
      return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
  } catch {
    return "";
  }
}

export type AiChatPanelProps = {
  className?: string;
  /** NextClaw 页：独立会话、专用提示词、隐藏历史侧栏与「AI 建议」 */
  variant?: "default" | "nextclaw";
  /** 左侧一键填入后传入，填入后由 onPendingPromptConsumed 清空 */
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
  /** 为 true 时，在 NextClaw 场景下接收到 pendingPrompt 会自动发送（而不是仅填入输入框） */
  autoSendPendingPrompt?: boolean;
};

export function AiChatPanel({
  className = "",
  variant = "default",
  pendingPrompt,
  onPendingPromptConsumed,
  autoSendPendingPrompt = false,
}: AiChatPanelProps) {
  const isNextClaw = variant === "nextclaw";
  const router = useRouter();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [initLoading, setInitLoading] = useState(true);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [switchingSession, setSwitchingSession] = useState(false);
  const [sendLoading, setSendLoading] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string>("");
  const [streamReasoning, setStreamReasoning] = useState<string>("");
  const [streamAnswer, setStreamAnswer] = useState<string>("");
  const [saveLoading, setSaveLoading] = useState(false);
  /** 开启后仅保存勾选的消息；关闭则保存当前会话全部消息 */
  const [pickMessagesForSave, setPickMessagesForSave] = useState(false);
  const [selectedMessageIds, setSelectedMessageIds] = useState<Record<string, boolean>>({});
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteOption[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  /** 空字符串 = 全库 RAG；有值 = 只针对该篇笔记 */
  const [selectedNoteId, setSelectedNoteId] = useState("");
  /** 待随下一条消息一并发送的附件（已上传为可访问 URL） */
  const [pendingAttachments, setPendingAttachments] = useState<
    { name: string; url: string; sourceId?: string }[]
  >([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  function mergeReasoningAndAnswer(reasoning: string, answer: string): string {
    const r = (reasoning || "").trim();
    const a = (answer || "").trim();
    if (r && a) {
      return `> 思考过程（流式）\n>\n${r
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}\n\n${a}`;
    }
    if (a) return a;
    if (r) {
      return `> 思考过程（流式）\n>\n${r
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n")}`;
    }
    return "";
  }

  async function loadConversationList(): Promise<ConvSummary[]> {
    const r = await fetch("/api/chat/conversations", { credentials: "include" });
    if (!r.ok) return [];
    const data = (await r.json().catch(() => null)) as { conversations?: ConvSummary[] } | null;
    return Array.isArray(data?.conversations) ? data!.conversations! : [];
  }

  async function fetchActiveSession(pickId: string | null) {
    const url = pickId
      ? `/api/chat/active?conversationId=${encodeURIComponent(pickId)}`
      : "/api/chat/active";
    const r = await fetch(url, { credentials: "include" });
    const data = r.ok
      ? await r.json()
      : { conversationId: null as string | null, messages: [] as ChatMessage[] };
    return data as { conversationId: string | null; messages: ChatMessage[] };
  }

  useEffect(() => {
    let alive = true;
    setInitLoading(true);
    setSessionsLoading(true);
    (async () => {
      try {
        if (isNextClaw) {
          const r = await fetch("/api/chat/active?purpose=nextclaw", { credentials: "include" });
          const data = r.ok
            ? await r.json()
            : { conversationId: null as string | null, messages: [] as ChatMessage[] };
          if (!alive) return;
          setConversationId(data.conversationId ?? null);
          setMessages(data.messages ?? []);
          setConversations([]);
          return;
        }

        let list = await loadConversationList();
        if (!alive) return;
        setConversations(list);

        let pick: string | null = null;
        if (typeof window !== "undefined") {
          const stored = localStorage.getItem(CHAT_CONV_STORAGE)?.trim();
          if (stored && list.some((c) => c.id === stored)) pick = stored;
        }
        if (!pick && list[0]) pick = list[0].id;

        const data = await fetchActiveSession(pick);
        if (!alive) return;
        setConversationId(data.conversationId ?? null);
        setMessages(data.messages ?? []);
        if (data.conversationId && typeof window !== "undefined") {
          localStorage.setItem(CHAT_CONV_STORAGE, data.conversationId);
        }

        if (list.length === 0 && data.conversationId) {
          list = await loadConversationList();
          if (!alive) return;
          setConversations(list);
        }
      } catch {
        if (!alive) return;
        setError("加载会话失败");
      } finally {
        if (!alive) return;
        setInitLoading(false);
        setSessionsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [isNextClaw]);

  useEffect(() => {
    setPickMessagesForSave(false);
    setSelectedMessageIds({});
  }, [conversationId]);

  async function refreshConversationList() {
    const list = await loadConversationList();
    setConversations(list);
  }

  async function switchSession(id: string) {
    if (!id || id === conversationId || switchingSession || sendLoading) return;
    setSwitchingSession(true);
    setError(null);
    try {
      const data = await fetchActiveSession(id);
      setConversationId(data.conversationId ?? id);
      setMessages(data.messages ?? []);
      if (data.conversationId && typeof window !== "undefined") {
        localStorage.setItem(CHAT_CONV_STORAGE, data.conversationId);
      }
    } catch {
      setError("切换会话失败");
    } finally {
      setSwitchingSession(false);
    }
  }

  async function clearNextClawHistory() {
    if (!conversationId || !isNextClaw) return;
    if (!confirm("确定清空 NextClaw 的全部聊天记录？")) return;
    setError(null);
    const prevMessages = messages;
    setMessages([]);
    setPickMessagesForSave(false);
    setSelectedMessageIds({});
    try {
      const r = await fetch(`/api/chat/conversations/${conversationId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "clearMessages" }),
      });
      const data = (await r.json().catch(() => null)) as { error?: string };
      if (!r.ok) throw new Error(data?.error || "清空失败");
    } catch (e) {
      setMessages(prevMessages);
      setError(e instanceof Error ? e.message : "清空失败");
    }
  }

  async function removeConversationFromList(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("确定删除该会话？其中所有消息将一并删除。")) return;
    setError(null);
    try {
      const r = await fetch(`/api/chat/conversations/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await r.json().catch(() => null)) as { error?: string };
      if (!r.ok) throw new Error(data?.error || "删除失败");
      const list = await loadConversationList();
      setConversations(list);
      if (conversationId === id) {
        if (list.length > 0) {
          await switchSession(list[0].id);
        } else {
          await newConversation();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function uploadAttachments(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    if (!conversationId) {
      setError("请先等待会话加载完成后再上传附件");
      return;
    }
    for (const file of arr) {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("conversationId", conversationId);
      try {
        const r = await fetch("/api/chat/attachments", {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        const data = (await r.json().catch(() => null)) as {
          url?: string;
          name?: string;
          sourceId?: string;
          error?: string;
        };
        if (!r.ok) throw new Error(data?.error || "上传失败");
        if (data.url && data.name) {
          setPendingAttachments((prev) => [
            ...prev,
            { url: data.url!, name: data.name!, sourceId: data.sourceId },
          ]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "上传失败");
        return;
      }
    }
  }

  async function newConversation() {
    if (sendLoading || switchingSession) return;
    setSwitchingSession(true);
    setError(null);
    try {
      const r = await fetch("/api/chat/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({}),
      });
      const data = (await r.json().catch(() => null)) as { conversationId?: string } | null;
      if (!r.ok || !data?.conversationId) throw new Error("新建会话失败");
      const id = data.conversationId;
      setConversationId(id);
      setMessages([]);
      if (typeof window !== "undefined") localStorage.setItem(CHAT_CONV_STORAGE, id);
      await refreshConversationList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "新建会话失败");
    } finally {
      setSwitchingSession(false);
    }
  }

  useEffect(() => {
    let alive = true;
    setNotesLoading(true);
    fetch("/api/notes", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : Promise.resolve({ notes: [] })))
      .then((data: { notes?: NoteOption[] }) => {
        if (!alive) return;
        setNotes(Array.isArray(data.notes) ? data.notes : []);
      })
      .catch(() => {
        if (!alive) return;
        setNotes([]);
      })
      .finally(() => {
        if (!alive) return;
        setNotesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const text = pendingPrompt?.trim();
    if (!text) return;
    setInput(text);
    onPendingPromptConsumed?.();
    if (autoSendPendingPrompt && isNextClaw) {
      // NextClaw 模式下：一键开场预设自动发送
      void send(text, { autonomousStudy: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt, onPendingPromptConsumed, autoSendPendingPrompt, isNextClaw]);

  async function send(
    forcedContent?: string,
    opts?: {
      autonomousStudy?: boolean;
    }
  ) {
    if (!conversationId || switchingSession) return;
    // 防御：若上一次请求还没完全释放，先中断
    streamAbortRef.current?.abort();
    const controller = new AbortController();
    streamAbortRef.current = controller;
    let content = (forcedContent ?? input).trim();
    if (!content) return;

    setSendLoading(true);
    setStreamStatus("正在准备上下文...");
    setStreamReasoning("");
    setStreamAnswer("");
    setError(null);
    const hideUserBubble = Boolean(opts?.autonomousStudy);
    const shouldDispatchStudySnapshotUpdated = Boolean(isNextClaw && opts?.autonomousStudy);
    const userTempId = `user-${Date.now()}`;
    const userMessage: ChatMessage = {
      id: userTempId,
      role: "USER",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [
      ...prev,
      ...(hideUserBubble ? [] : [userMessage]),
      { id: STREAM_ASSISTANT_ID, role: "ASSISTANT", content: "", createdAt: new Date().toISOString() },
    ]);
    setInput("");

    const attachmentSourceIds = pendingAttachments
      .map((a) => a.sourceId)
      .filter((x): x is string => Boolean(x));

    let streamed = "";
    let reasoningStreamed = "";
    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: controller.signal,
        body: JSON.stringify({
          content,
          conversationId,
          ...(selectedNoteId ? { noteId: selectedNoteId } : {}),
          ...(isNextClaw ? { nextclaw: true } : {}),
          ...(opts?.autonomousStudy ? { autonomousStudy: true } : {}),
          ...(attachmentSourceIds.length ? { attachmentSourceIds } : {}),
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(err?.error || `发送失败 (${res.status})`);
      }
      if (!res.body) throw new Error("发送失败");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let lineBuf = "";
      let finalMessage: ChatMessage | null = null;
      let lastUserMessageIdFromServer: string | undefined;

      const appendStream = (delta: string) => {
        streamed += delta;
        setStreamAnswer(streamed);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === STREAM_ASSISTANT_ID
              ? { ...m, content: streamed }
              : m
          )
        );
      };
      const appendReasoning = (delta: string) => {
        reasoningStreamed += delta;
        setStreamReasoning(reasoningStreamed);
      };

      const handleDataPayload = (payload: string) => {
        const raw = payload.trim();
        if (!raw || raw === "[DONE]") return;
        let json: {
          choices?: { delta?: { content?: string } }[];
          error?: { message?: string };
          nexmind_done?: { message?: ChatMessage; lastUserMessageId?: string };
          nexmind_status?: { phase?: string; message?: string };
        };
        try {
          json = JSON.parse(raw) as typeof json;
        } catch {
          return;
        }
        if (json.error?.message) throw new Error(json.error.message);
        if (json.nexmind_done?.message?.id) {
          finalMessage = json.nexmind_done.message as ChatMessage;
          if (typeof json.nexmind_done.lastUserMessageId === "string") {
            lastUserMessageIdFromServer = json.nexmind_done.lastUserMessageId;
          }
          return;
        }
        if (json.nexmind_status?.message) {
          setStreamStatus(json.nexmind_status.message);
          return;
        }
        const d = json.choices?.[0]?.delta as { content?: string; reasoning_content?: string } | undefined;
        if (typeof d?.reasoning_content === "string" && d.reasoning_content.length > 0) {
          appendReasoning(d.reasoning_content);
        }
        if (typeof d?.content === "string" && d.content.length > 0) {
          appendStream(d.content);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        lineBuf += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = lineBuf.indexOf("\n")) >= 0) {
          const line = lineBuf.slice(0, nl);
          lineBuf = lineBuf.slice(nl + 1);
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const dataPart = trimmed.slice(5).trimStart();
          handleDataPayload(dataPart);
        }
      }

      if (lineBuf.trim()) {
        const trimmed = lineBuf.trim();
        if (trimmed.startsWith("data:")) {
          handleDataPayload(trimmed.slice(5).trimStart());
        }
      }

      setMessages((prev) => {
        let next = prev.filter((m) => m.id !== STREAM_ASSISTANT_ID);
        if (lastUserMessageIdFromServer) {
          for (let i = next.length - 1; i >= 0; i--) {
            if (next[i].role === "USER" && next[i].id.startsWith("user-")) {
              next = [
                ...next.slice(0, i),
                { ...next[i], id: lastUserMessageIdFromServer },
                ...next.slice(i + 1),
              ];
              break;
            }
          }
        }
        if (finalMessage) {
          const merged = mergeReasoningAndAnswer(streamReasoning || reasoningStreamed, finalMessage.content || "");
          return [
            ...next,
            {
              ...finalMessage,
              content: merged || finalMessage.content,
            },
          ];
        }
        if (streamed.trim()) {
          const merged = mergeReasoningAndAnswer(streamReasoning || reasoningStreamed, streamed);
          return [
            ...next,
            {
              id: `assistant-${Date.now()}`,
              role: "ASSISTANT",
              content: merged || streamed,
              createdAt: new Date().toISOString(),
            },
          ];
        }
        return next;
      });
      if (!isNextClaw) void refreshConversationList();
      setPendingAttachments([]);
    } catch (e) {
      const aborted =
        (e instanceof DOMException && e.name === "AbortError") ||
        (e instanceof Error && /aborted|abort/i.test(e.message));
      if (aborted) {
        // 用户主动中断：保留已生成片段（含思考），仅移除占位中的 streaming 消息
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== STREAM_ASSISTANT_ID);
          const merged = mergeReasoningAndAnswer(streamReasoning || reasoningStreamed, streamAnswer || streamed);
          if (!merged.trim()) return next;
          return [
            ...next,
            {
              id: `assistant-abort-${Date.now()}`,
              role: "ASSISTANT",
              content: `${merged}\n\n> （本次回答已手动停止）`,
              createdAt: new Date().toISOString(),
            },
          ];
        });
        setError("已停止本次生成");
      } else {
        setMessages((prev) =>
          prev.filter((m) => m.id !== STREAM_ASSISTANT_ID && m.id !== userTempId)
        );
        setError(e instanceof Error ? e.message : "发送失败");
      }
    } finally {
      streamAbortRef.current = null;
      setSendLoading(false);
      setStreamStatus("");
      setStreamReasoning("");
      setStreamAnswer("");
      if (shouldDispatchStudySnapshotUpdated && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("nextclaw_study_snapshot_updated"));
      }
    }
  }

  const canSend =
    !!conversationId &&
    !switchingSession &&
    !sendLoading &&
    (input.trim().length > 0 || pendingAttachments.length > 0);

  async function saveToNote() {
    if (!conversationId) return;
    const pickedIds = Object.entries(selectedMessageIds)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (pickMessagesForSave && pickedIds.length === 0) {
      setError("请勾选至少一条消息，或关闭「按条勾选」以保存全部对话。");
      return;
    }
    setSaveLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/save-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          conversationId,
          ...(pickMessagesForSave ? { messageIds: pickedIds } : {}),
          raw: false,
        }),
      });
      const data = (await res.json().catch(() => null)) as { noteId?: string; error?: string } | null;
      if (!res.ok || !data?.noteId) throw new Error(data?.error || "保存为笔记失败");
      router.push(`/notes/${data.noteId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaveLoading(false);
    }
  }

  async function saveToNoteRaw() {
    if (!conversationId) return;
    const pickedIds = Object.entries(selectedMessageIds)
      .filter(([, v]) => v)
      .map(([id]) => id);
    if (pickMessagesForSave && pickedIds.length === 0) {
      setError("请勾选至少一条消息，或关闭「按条勾选」以保存全部对话。");
      return;
    }
    setSaveLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat/save-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          conversationId,
          ...(pickMessagesForSave ? { messageIds: pickedIds } : {}),
          raw: true,
        }),
      });
      const data = (await res.json().catch(() => null)) as { noteId?: string; error?: string } | null;
      if (!res.ok || !data?.noteId) throw new Error(data?.error || "保存原文失败");
      router.push(`/notes/${data.noteId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaveLoading(false);
    }
  }

  return (
    <section
      className={`relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface ${isNextClaw ? "" : "md:flex-row"} ${className}`.trim()}
    >
      {!isNextClaw ? (
      <aside className="flex min-h-0 w-full shrink-0 flex-col overflow-hidden border-b border-outline-variant/15 bg-surface-container-low/90 max-md:max-h-[min(40vh,18rem)] md:h-full md:w-60 md:max-h-none md:border-b-0 md:border-r">
        <div className="shrink-0 border-b border-outline-variant/10 px-4 py-4">
          <div className="flex items-center gap-2">
            <MaterialIcon name="forum" className="shrink-0 text-primary" />
            <h2 className="min-w-0 flex-1 font-headline text-sm font-bold text-on-surface">历史对话</h2>
            <button
              type="button"
              onClick={() => void newConversation()}
              disabled={initLoading || sessionsLoading || sendLoading || switchingSession}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-primary/35 bg-primary-container/12 px-2.5 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary-container/22 disabled:opacity-50"
              title="新对话"
            >
              <MaterialIcon name="add" className="text-sm" />
              新建
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 py-2 [scrollbar-gutter:stable]">
          {sessionsLoading && conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-on-surface-variant">正在加载列表…</p>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs leading-relaxed text-on-surface-variant">
              暂无会话，点「新建」开始。
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {conversations.map((c) => {
                const active = c.id === conversationId;
                return (
                  <li key={c.id} className="flex gap-1 rounded-xl border border-transparent hover:border-outline-variant/10">
                    <button
                      type="button"
                      onClick={() => void switchSession(c.id)}
                      disabled={switchingSession || sendLoading}
                      className={`min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left transition-colors disabled:opacity-50 ${
                        active
                          ? "bg-primary-container/20 ring-1 ring-primary/35"
                          : "hover:bg-surface-container-high/80"
                      } `}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs font-bold text-on-surface">{c.title}</p>
                        <span className="shrink-0 tabular-nums text-[10px] text-on-surface-variant/80">
                          {formatConvListTime(c.updatedAt)}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-on-surface-variant">{c.preview}</p>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 self-start rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-error/10 hover:text-error disabled:opacity-40"
                      disabled={switchingSession || sendLoading}
                      title="删除会话"
                      aria-label="删除会话"
                      onClick={(e) => void removeConversationFromList(c.id, e)}
                    >
                      <MaterialIcon name="delete" className="text-lg" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>
      ) : null}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:h-full">
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-5 py-6 md:px-8 md:py-8 [scrollbar-gutter:stable]">
          <div className="mx-auto w-full max-w-6xl">
          {isNextClaw ? (
            <>
              <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary-container/10 px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm leading-relaxed text-on-surface-variant">
                  <span className="font-bold text-on-surface">NextClaw</span>
                  会结合你的知识库片段作答。左侧一键开场会自动发送，不必再点「发送」。
                </p>
                <button
                  type="button"
                  className="shrink-0 rounded-xl border border-outline-variant/25 bg-surface-container-low px-3 py-2 text-xs font-semibold text-on-surface-variant transition-colors hover:border-error/30 hover:bg-error/10 hover:text-error"
                  onClick={() => void clearNextClawHistory()}
                  disabled={!conversationId || initLoading || sendLoading}
                >
                  清除聊天记录
                </button>
              </div>
              {sendLoading ? (
                <div className="mb-5 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary-container/15 px-4 py-3 text-xs text-on-surface-variant">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15">
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-on-surface">
                      正在执行一键开场任务…
                    </p>
                    <p className="mt-0.5 text-[11px] text-on-surface-variant">
                      请稍候，NextClaw 正在结合你的知识库生成学习建议。
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          ) : messages.length === 0 ? (
            <div className="mb-8">
              <WorkspaceHomeStrip showLists={!initLoading} />
            </div>
          ) : null}

          <div className="space-y-6">
            <div className="glass-panel rounded-2xl border border-outline-variant/8 bg-surface-container-lowest/25 p-3 backdrop-blur-md sm:p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-4">
                <div className="flex shrink-0 items-center gap-2">
                  <MaterialIcon name={isNextClaw ? "assistant" : "smart_toy"} className="text-primary" filled />
                  <h4 className="font-headline text-base font-bold">{isNextClaw ? "NextClaw" : "对话"}</h4>
                  {switchingSession ? (
                    <span className="text-[11px] font-medium text-on-surface-variant">切换中…</span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1 lg:pt-0.5">
                  <label className="sr-only" htmlFor="chat-note-scope">
                    对话范围
                  </label>
                  <select
                    id="chat-note-scope"
                    value={selectedNoteId}
                    onChange={(e) => setSelectedNoteId(e.target.value)}
                    disabled={initLoading || notesLoading}
                    className="w-full rounded-xl border border-outline-variant/8 bg-surface-container-lowest/40 px-3 py-2 text-xs font-medium text-on-surface outline-none backdrop-blur-sm focus:border-primary/25 focus:ring-1 focus:ring-primary/20"
                  >
                    <option value="">全部笔记（知识库检索）</option>
                    {notes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {(n.title || "无标题").slice(0, 48)}
                        {(n.title || "").length > 48 ? "…" : ""}
                      </option>
                    ))}
                  </select>
                  {selectedNoteId ? (
                    <p className="mt-1.5 text-[11px] text-on-surface-variant">
                      已限定：仅使用该笔记的内容作答（优先向量片段，无索引时用正文摘录）。
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 lg:shrink-0 lg:pt-0.5">
                  <button
                    type="button"
                    className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-primary-container/90 px-3.5 py-2 text-xs font-bold text-white shadow-sm backdrop-blur-sm transition-all hover:bg-primary-container disabled:opacity-60"
                    onClick={() => void saveToNote()}
                    disabled={saveLoading || initLoading}
                  >
                    <MaterialIcon name="note_add" className="text-sm text-white" />
                    {saveLoading
                      ? "生成中…"
                      : pickMessagesForSave
                        ? `保存（${Object.values(selectedMessageIds).filter(Boolean).length} 条）`
                        : "保存为笔记"}
                  </button>
                  <details className="relative">
                    <summary className="cursor-pointer list-none rounded-lg px-2 py-1.5 text-[11px] font-semibold text-on-surface-variant transition-colors hover:bg-surface-container-low/50 hover:text-on-surface [&::-webkit-details-marker]:hidden">
                      <span className="inline-flex items-center gap-1">
                        <MaterialIcon name="more_horiz" className="text-base" />
                        更多保存
                      </span>
                    </summary>
                    <div className="absolute right-0 z-20 mt-1 min-w-[12rem] rounded-xl border border-outline-variant/10 bg-surface-container-low/95 p-2 shadow-lg backdrop-blur-md">
                      <button
                        type="button"
                        className={`mb-1 w-full rounded-lg border px-3 py-2 text-left text-[11px] font-semibold transition-colors ${
                          pickMessagesForSave
                            ? "border-primary/45 bg-primary/12 text-primary"
                            : "border-outline-variant/15 text-on-surface-variant hover:bg-surface-container-high/80"
                        }`}
                        onClick={() => {
                          setPickMessagesForSave((v) => {
                            if (v) setSelectedMessageIds({});
                            return !v;
                          });
                        }}
                      >
                        勾选保存
                      </button>
                      {pickMessagesForSave ? (
                        <button
                          type="button"
                          className="mb-2 w-full rounded-lg px-3 py-1.5 text-left text-[11px] font-medium text-primary/90 hover:bg-surface-container-high/50"
                          onClick={() => {
                            const next: Record<string, boolean> = {};
                            for (const m of messages) {
                              if (isPersistedChatMessageId(m.id)) next[m.id] = true;
                            }
                            setSelectedMessageIds(next);
                          }}
                        >
                          全选消息
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg border border-outline-variant/15 px-3 py-2 text-[11px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container-high/80"
                        onClick={() => void saveToNoteRaw()}
                        disabled={saveLoading || initLoading}
                        title="不经过 AI 改写，直接保存原文"
                      >
                        <MaterialIcon name="save" className="text-sm" />
                        保存原文
                      </button>
                    </div>
                  </details>
                </div>
              </div>
              {pickMessagesForSave ? (
                <p className="mt-3 border-t border-outline-variant/10 pt-3 text-[11px] leading-relaxed text-on-surface-variant">
                  勾选消息旁的复选框后点「保存」；点「全选」可快速选中当前列表；关闭「勾选保存」则保存整段会话。
                </p>
              ) : null}
            </div>

            {error ? (
              <p className="rounded-xl border border-error-container/30 bg-error-container/10 px-4 py-3 text-sm font-medium text-on-error-container">
                {error}
              </p>
            ) : null}

            {initLoading || switchingSession ? (
              <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4 text-sm text-on-surface-variant">
                {initLoading ? "正在加载会话..." : "正在切换会话..."}
              </div>
            ) : messages.length ? (
              <div className="space-y-6">
                {messages.map((m) =>
                  m.role === "USER" ? (
                    <div key={m.id} className="flex justify-end">
                      <div className="flex max-w-[min(100%,52rem)] flex-row-reverse items-start gap-2.5">
                        <div className="rounded-2xl rounded-tr-none bg-surface-container-high px-5 py-4 text-sm leading-relaxed text-on-surface shadow-sm">
                          {m.content}
                        </div>
                        {pickMessagesForSave && isPersistedChatMessageId(m.id) ? (
                          <input
                            type="checkbox"
                            className="mt-3.5 h-4 w-4 shrink-0 cursor-pointer rounded border-outline-variant/50 accent-primary"
                            checked={!!selectedMessageIds[m.id]}
                            onChange={() =>
                              setSelectedMessageIds((prev) => ({
                                ...prev,
                                [m.id]: !prev[m.id],
                              }))
                            }
                            aria-label="选中以保存该条"
                          />
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="flex gap-3">
                      {pickMessagesForSave && isPersistedChatMessageId(m.id) ? (
                        <input
                          type="checkbox"
                          className="mt-3.5 h-4 w-4 shrink-0 cursor-pointer self-start rounded border-outline-variant/50 accent-primary"
                          checked={!!selectedMessageIds[m.id]}
                          onChange={() =>
                            setSelectedMessageIds((prev) => ({
                              ...prev,
                              [m.id]: !prev[m.id],
                            }))
                          }
                          aria-label="选中以保存该条"
                        />
                      ) : null}
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary-container/20">
                        <MaterialIcon name={isNextClaw ? "assistant" : "smart_toy"} className="text-primary" filled />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="rounded-2xl rounded-tl-none border border-outline-variant/10 bg-surface-container-low px-5 py-4 text-sm leading-relaxed text-on-surface-variant">
                          {m.id === STREAM_ASSISTANT_ID ? (
                            <div className="space-y-3">
                              {streamReasoning ? (
                                <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest/30 px-3 py-2">
                                  <div className="mb-1 text-[11px] font-medium text-on-surface-variant/90">思考过程</div>
                                  <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-on-surface-variant/75">
                                    {streamReasoning}
                                  </div>
                                </div>
                              ) : null}
                              {streamAnswer ? (
                                <div
                                  className="chat-markdown"
                                  dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(streamAnswer) }}
                                />
                              ) : (
                                <span>{streamStatus || "思考中..."}</span>
                              )}
                            </div>
                          ) : m.content ? (
                            <div
                              className="chat-markdown"
                              dangerouslySetInnerHTML={{ __html: markdownToSafeHtml(m.content) }}
                            />
                          ) : (
                            ""
                          )}
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4 text-sm text-on-surface-variant">
                {isNextClaw ? "在下方输入，或从左侧点「一键开场」。" : "请输入问题，开始对话。"}
              </div>
            )}
          </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-outline-variant/10 px-5 pb-6 pt-4 md:px-8">
          <div className="group relative mx-auto w-full max-w-6xl">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv,application/pdf,text/plain,text/markdown,application/json"
              onChange={(e) => {
                const files = e.target.files;
                if (files?.length) void uploadAttachments(files);
                e.target.value = "";
              }}
            />
            {pendingAttachments.length > 0 ? (
              <div className="mb-2 flex flex-wrap gap-2 px-1">
                {pendingAttachments.map((a) => (
                  <span
                    key={`${a.url}-${a.name}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full border border-outline-variant/20 bg-surface-container-high px-2.5 py-1 text-[11px] text-on-surface"
                  >
                    <MaterialIcon name="attach_file" className="shrink-0 text-sm text-primary" />
                    <span className="truncate">{a.name}</span>
                    <button
                      type="button"
                      className="ml-0.5 rounded-full p-0.5 hover:bg-surface-container-lowest"
                      aria-label="移除"
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((x) => x.url !== a.url))
                      }
                    >
                      <MaterialIcon name="close" className="text-sm text-on-surface-variant" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            {sendLoading && streamStatus ? (
              <div className="mb-2 px-1 text-[11px] text-on-surface-variant">{streamStatus}</div>
            ) : null}
            <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-r from-primary/20 via-primary-container/10 to-primary/20 opacity-50 blur-xl transition duration-500 group-focus-within:opacity-100" />
            <div className="relative flex items-center gap-3 rounded-full border border-outline-variant/8 bg-surface-container-lowest/35 px-4 py-2.5 glass-panel thinking-glow backdrop-blur-md sm:gap-4 sm:px-5 sm:py-3">
              <button
                type="button"
                className="shrink-0 p-2 text-slate-400 transition-colors hover:text-primary disabled:opacity-40"
                aria-label="添加附件"
                disabled={sendLoading || !conversationId}
                onClick={() => fileInputRef.current?.click()}
              >
                <MaterialIcon name="attach_file" />
              </button>
              <input
                type="text"
                placeholder={
                  sendLoading
                    ? "AI 正在思考中，你可以继续输入下一条..."
                    : isNextClaw
                      ? "说说你想复习、拓展或整理什么…"
                      : "向 NexMind 提问或记录灵感…"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
                className="min-w-0 flex-1 border-none bg-transparent py-2 text-base text-on-surface placeholder:text-slate-500 focus:ring-0 focus:outline-none"
                aria-label="输入内容"
              />
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-container text-white shadow-lg shadow-primary-container/30 transition-all hover:scale-105 active:scale-95 disabled:opacity-60"
                aria-label={sendLoading ? "停止生成" : "发送"}
                onClick={() => {
                  if (sendLoading) {
                    streamAbortRef.current?.abort();
                    return;
                  }
                  void send();
                }}
                disabled={sendLoading ? false : !canSend}
              >
                <MaterialIcon name={sendLoading ? "stop" : "arrow_upward"} className="text-white" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
