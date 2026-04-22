"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { NotesKnowledgeSearch } from "@/components/knowledge/NotesKnowledgeSearch";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type NoteFolderVm = { id: string; name: string; sortOrder: number };

export type NoteListRowVm = {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  timeLabel: string;
  featured?: boolean;
  folderId: string | null;
  pinned: boolean;
};

const UNCAT = "__uncat__";

function sortNotes(a: NoteListRowVm, b: NoteListRowVm) {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return 0;
}

type ContextTarget =
  | { type: "note"; id: string; title: string }
  | { type: "folder"; id: string; name: string };

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function NotesLibrarySidebar({
  className = "",
  folders: initialFolders,
  notes: initialNotes,
}: {
  className?: string;
  folders: NoteFolderVm[];
  notes: NoteListRowVm[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const activeId = useMemo(() => {
    const m = pathname?.match(/^\/notes\/([^/]+)/);
    return m?.[1] && m[1] !== "new" ? m[1] : null;
  }, [pathname]);

  const [folders, setFolders] = useState(initialFolders);
  const [notes, setNotes] = useState(initialNotes);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editFolderName, setEditFolderName] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editNoteTitle, setEditNoteTitle] = useState("");
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);

  const [menu, setMenu] = useState<(ContextTarget & { x: number; y: number }) | null>(null);

  useEffect(() => {
    setFolders(initialFolders);
    setNotes(initialNotes);
  }, [initialFolders, initialNotes]);

  useEffect(() => {
    const activeNote = notes.find((x) => x.id === activeId);
    if (activeNote) setCurrentFolderId(activeNote.folderId ?? null);
  }, [activeId, notes]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [menu]);

  const grouped = useMemo(() => {
    const byFolder = new Map<string | null, NoteListRowVm[]>();
    byFolder.set(null, []);
    for (const f of folders) byFolder.set(f.id, []);
    for (const n of notes) {
      const k = n.folderId && byFolder.has(n.folderId) ? n.folderId : null;
      if (!byFolder.has(k)) byFolder.set(null, byFolder.get(null) ?? []);
      byFolder.get(k)!.push(n);
    }
    for (const [, arr] of byFolder) arr.sort(sortNotes);
    return byFolder;
  }, [folders, notes]);

  const toggle = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isOpen = (id: string) => !collapsed.has(id);

  const refresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const openContextMenu = (e: React.MouseEvent, target: ContextTarget) => {
    e.preventDefault();
    e.stopPropagation();
    const w = 160;
    const h = target.type === "folder" ? 88 : 88;
    const x = clamp(e.clientX, 8, window.innerWidth - w - 8);
    const y = clamp(e.clientY, 8, window.innerHeight - h - 8);
    setMenu({ ...target, x, y });
  };

  const patchNoteFolder = async (noteId: string, folderId: string | null) => {
    setBusy(noteId);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ folderId }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string };
      if (!res.ok) throw new Error(data?.error || "移动失败");
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, folderId } : n))
      );
      setCurrentFolderId(folderId);
      refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "移动失败");
    } finally {
      setBusy(null);
    }
  };

  const createFolderQuick = async () => {
    const name = "新建文件夹";
    setCreating(true);
    try {
      const res = await fetch("/api/notes/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name }),
      });
      const data = (await res.json().catch(() => null)) as {
        folder?: NoteFolderVm;
        error?: string;
      };
      if (!res.ok) throw new Error(data?.error || "创建失败");
      if (data.folder) {
        setFolders((prev) =>
          [...prev, data.folder!].sort(
            (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
          )
        );
        setEditingFolderId(data.folder.id);
        setEditFolderName(data.folder.name);
        if (collapsed.has(`folder:${data.folder.id}`)) {
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(`folder:${data.folder!.id}`);
            return next;
          });
        }
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const createNoteQuick = async () => {
    const title = "新建笔记";
    setCreating(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title, folderId: currentFolderId }),
      });
      const data = (await res.json().catch(() => null)) as { noteId?: string; error?: string };
      if (!res.ok) throw new Error(data?.error || "创建失败");
      if (data.noteId) {
        const folderKey = currentFolderId ? `folder:${currentFolderId}` : UNCAT;
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(folderKey);
          return next;
        });
        setNotes((prev) => [
          {
            id: data.noteId!,
            title,
            excerpt: "",
            tags: [],
            timeLabel: "刚刚",
            folderId: currentFolderId,
            pinned: false,
          },
          ...prev,
        ]);
        setEditingNoteId(data.noteId);
        setEditNoteTitle(title);
        router.push(`/notes/${data.noteId}`);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "创建失败");
    } finally {
      setCreating(false);
    }
  };

  const renameFolder = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const prevName = folders.find((f) => f.id === id)?.name ?? "";
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f)));
    setEditingFolderId(null);
    try {
      const res = await fetch(`/api/notes/folders/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: trimmed }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string };
      if (!res.ok) throw new Error(data?.error || "重命名失败");
      refresh();
    } catch (e) {
      setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: prevName } : f)));
      alert(e instanceof Error ? e.message : "重命名失败");
    }
  };

  const deleteFolder = async (id: string) => {
    if (!window.confirm("删除该文件夹以及其中全部笔记？此操作不可撤销。")) return;
    try {
      const res = await fetch(`/api/notes/folders/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as { error?: string; notesDeleted?: number };
      if (!res.ok) throw new Error(data?.error || "删除失败");
      setFolders((prev) => prev.filter((f) => f.id !== id));
      setNotes((prev) => prev.filter((n) => n.folderId !== id));
      refresh();
      const active = notes.find((n) => n.id === activeId);
      if (active?.folderId === id) {
        router.push("/notes");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const saveNoteTitle = async (id: string) => {
    const title = editNoteTitle.trim() || "无标题";
    const prevTitle = notes.find((n) => n.id === id)?.title ?? "";
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title } : n)));
    setEditingNoteId(null);
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string };
      if (!res.ok) throw new Error(data?.error || "保存失败");
      refresh();
    } catch (e) {
      setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, title: prevTitle } : n)));
      alert(e instanceof Error ? e.message : "保存失败");
    }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm("删除这条笔记？")) return;
    try {
      const res = await fetch(`/api/notes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as { error?: string; nextNoteId?: string | null };
      if (!res.ok) throw new Error(data?.error || "删除失败");
      setNotes((prev) => prev.filter((n) => n.id !== id));
      refresh();
      if (activeId === id) {
        if (data.nextNoteId) router.push(`/notes/${data.nextNoteId}`);
        else router.push("/notes");
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "删除失败");
    }
  };

  const renderNoteRow = (n: NoteListRowVm) => {
    const active = activeId === n.id;
    return (
      <div
        key={n.id}
        onContextMenu={(e) => openContextMenu(e, { type: "note", id: n.id, title: n.title })}
        className={`group flex min-w-0 items-start gap-1 rounded-lg border border-transparent py-1.5 pl-2 pr-1 transition-colors ${
          active ? "border-primary/30 bg-primary/10" : "hover:bg-surface-container-high/80"
        }`}
      >
        {editingNoteId === n.id ? (
          <form
            className="min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              void saveNoteTitle(n.id);
            }}
          >
            <input
              autoFocus
              value={editNoteTitle}
              onChange={(e) => setEditNoteTitle(e.target.value)}
              className="w-full rounded border border-primary/40 bg-surface-container-lowest px-2 py-1 text-sm font-semibold text-on-surface outline-none"
              maxLength={200}
              onBlur={() => {
                if (editingNoteId === n.id) void saveNoteTitle(n.id);
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingNoteId(null);
              }}
            />
          </form>
        ) : (
          <Link
            href={`/notes/${n.id}`}
            className="min-w-0 flex-1"
            title={n.title}
            onClick={(e) => {
              if (editingNoteId) e.preventDefault();
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <MaterialIcon
                name="description"
                className={`shrink-0 text-lg ${active ? "text-primary" : "text-on-surface-variant/70"}`}
              />
              <div className="min-w-0 flex-1">
                <p
                  className={`truncate text-sm font-semibold leading-tight ${
                    active ? "text-primary" : "text-on-surface"
                  }`}
                >
                  {n.title || "无标题"}
                </p>
                <p className="truncate text-[11px] text-on-surface-variant/80">{n.timeLabel}</p>
              </div>
            </div>
          </Link>
        )}
        <select
          className="mt-0.5 max-w-[5.5rem] shrink-0 cursor-pointer rounded border border-outline-variant/25 bg-surface-container-lowest/80 py-0.5 text-[10px] text-on-surface-variant outline-none focus:border-primary/40"
          value={n.folderId ?? ""}
          disabled={busy === n.id}
          title="移动到文件夹"
          onChange={(e) => {
            const v = e.target.value;
            void patchNoteFolder(n.id, v === "" ? null : v);
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <option value="">未分类</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
    );
  };

  const renderBucket = (key: string, titleRow: ReactNode, list: NoteListRowVm[]) => {
    const open = isOpen(key);
    return (
      <div key={key} className="border-b border-outline-variant/10 pb-2 last:border-b-0">
        <div className="flex min-w-0 items-start gap-1">
          <div className="min-w-0 flex-1">{titleRow}</div>
        </div>
        {open ? (
          <div className="ml-1 border-l border-outline-variant/15 pl-2 pt-1">
            {list.length === 0 ? (
              <p className="py-2 pl-1 text-[11px] text-on-surface-variant/70">暂无笔记</p>
            ) : (
              list.map(renderNoteRow)
            )}
          </div>
        ) : null}
      </div>
    );
  };

  const uncatNotes = grouped.get(null) ?? [];

  return (
    <section className={`relative flex min-h-0 flex-col bg-surface ${className}`.trim()}>
      <div className="shrink-0 border-b border-outline-variant/10 px-3 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-headline text-lg font-extrabold tracking-tight text-on-surface">知识库</h2>
            <p className="text-[10px] leading-relaxed text-on-surface-variant">文件夹 + 语义搜索</p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title="新建笔记"
              onClick={() => void createNoteQuick()}
              disabled={creating}
              className="rounded-md p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
            >
              <MaterialIcon name="note_add" className="text-[22px]" />
            </button>
            <button
              type="button"
              title="新建文件夹"
              onClick={() => void createFolderQuick()}
              disabled={creating}
              className="rounded-md p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40"
            >
              <MaterialIcon name="create_new_folder" className="text-[22px]" />
            </button>
          </div>
        </div>
      </div>

      <Suspense
        fallback={
          <div className="shrink-0 px-3 py-2 text-xs text-on-surface-variant">加载搜索…</div>
        }
      >
        <NotesKnowledgeSearch />
      </Suspense>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 py-3 no-scrollbar">
        {renderBucket(
          UNCAT,
          <button
            type="button"
            onClick={() => {
              setCurrentFolderId(null);
              toggle(UNCAT);
            }}
            className="flex w-full min-w-0 items-center gap-1 rounded-lg py-2 pl-1 pr-1 text-left text-on-surface hover:bg-surface-container-high/50"
            aria-expanded={isOpen(UNCAT)}
          >
            <MaterialIcon
              name={isOpen(UNCAT) ? "expand_more" : "chevron_right"}
              className="shrink-0 text-on-surface-variant"
            />
            <MaterialIcon name="folder" className="shrink-0 text-amber-200/90" filled />
            <span className="min-w-0 truncate text-sm font-bold tracking-tight">未分类</span>
            <span className="ml-auto shrink-0 rounded-full bg-surface-container-high px-1.5 py-0 text-[10px] font-mono text-on-surface-variant">
              {uncatNotes.length}
            </span>
          </button>,
          uncatNotes
        )}

        {folders.map((f) => {
          const list = grouped.get(f.id) ?? [];
          const fk = `folder:${f.id}`;
          return renderBucket(
            fk,
            editingFolderId === f.id ? (
              <form
                className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-surface-container-lowest/50 p-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void renameFolder(f.id, editFolderName);
                }}
              >
                <input
                  autoFocus
                  value={editFolderName}
                  onChange={(e) => setEditFolderName(e.target.value)}
                  className="w-full rounded border border-outline-variant/30 bg-surface px-2 py-1.5 text-xs text-on-surface"
                  maxLength={80}
                  onBlur={() => {
                    if (editingFolderId === f.id) void renameFolder(f.id, editFolderName);
                  }}
                />
                <p className="text-right text-[11px] text-on-surface-variant">回车或失焦保存</p>
              </form>
            ) : (
              <div
                className="flex min-w-0 items-center gap-1"
                onContextMenu={(e) => openContextMenu(e, { type: "folder", id: f.id, name: f.name })}
              >
                <button
                  type="button"
                  onClick={() => {
                    setCurrentFolderId(f.id);
                    toggle(fk);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded-lg py-2 pl-1 pr-1 text-left text-on-surface hover:bg-surface-container-high/50"
                  aria-expanded={isOpen(fk)}
                >
                  <MaterialIcon
                    name={isOpen(fk) ? "expand_more" : "chevron_right"}
                    className="shrink-0 text-on-surface-variant"
                  />
                  <MaterialIcon name="folder" className="shrink-0 text-amber-200/90" filled />
                  <span className="min-w-0 truncate text-sm font-bold tracking-tight">{f.name}</span>
                  <span className="ml-auto shrink-0 rounded-full bg-surface-container-high px-1.5 py-0 text-[10px] font-mono text-on-surface-variant">
                    {list.length}
                  </span>
                </button>
                <button
                  type="button"
                  title="删除文件夹"
                  className="rounded p-1 text-on-surface-variant/70 transition-colors hover:bg-error/10 hover:text-error"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteFolder(f.id);
                  }}
                >
                  <MaterialIcon name="delete" className="text-[16px]" />
                </button>
              </div>
            ),
            list
          );
        })}

        {folders.length === 0 ? (
          <p className="px-2 py-2 text-center text-[11px] text-on-surface-variant/80">
            暂无自定义文件夹。点击顶部文件夹图标创建。
          </p>
        ) : null}
      </div>

      {menu ? (
        <>
          <div
            className="fixed inset-0 z-[200]"
            aria-hidden
            onClick={(e) => {
              e.stopPropagation();
              setMenu(null);
            }}
          />
          <div
            role="menu"
            className="fixed z-[201] min-w-[148px] overflow-hidden rounded-lg border border-outline-variant/20 bg-surface-container-highest py-1 shadow-xl"
            style={{ left: menu.x, top: menu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            {menu.type === "note" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container-high"
                  onClick={() => {
                    setEditingNoteId(menu.id);
                    setEditNoteTitle(menu.title);
                    setMenu(null);
                  }}
                >
                  <MaterialIcon name="edit" className="text-base" />
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-error hover:bg-error/10"
                  onClick={() => {
                    const id = menu.id;
                    setMenu(null);
                    void deleteNote(id);
                  }}
                >
                  <MaterialIcon name="delete" className="text-base" />
                  删除
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container-high"
                  onClick={() => {
                    setEditingFolderId(menu.id);
                    setEditFolderName(menu.name);
                    setMenu(null);
                  }}
                >
                  <MaterialIcon name="edit" className="text-base" />
                  重命名
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-error hover:bg-error/10"
                  onClick={() => {
                    const id = menu.id;
                    setMenu(null);
                    void deleteFolder(id);
                  }}
                >
                  <MaterialIcon name="delete" className="text-base" />
                  删除
                </button>
              </>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
