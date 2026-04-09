/**
 * 笔记间链接导航：记录「从哪篇、滚动位置」，用于返回按钮与恢复阅读位置。
 * 仅 sessionStorage，标签页关闭即清空。
 */

const NAV_KEY = "nexmind_note_nav";
const SCROLL_RESTORE_KEY = "nexmind_note_scroll_restore";

export type NoteNavPayload = {
  previousNoteId: string;
  previousScrollTop: number;
  /** 通过正文链接进入的当前篇 id；用于判断是否显示「返回」 */
  viaLinkToNoteId: string;
};

export function saveNoteLinkNavigation(payload: NoteNavPayload): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(NAV_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
}

/** 当前页是否由「从另一篇点链接」进入；是则可用于展示返回 */
export function readNoteNavForCurrentNote(currentNoteId: string): NoteNavPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(NAV_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as NoteNavPayload;
    if (
      p.viaLinkToNoteId === currentNoteId &&
      p.previousNoteId &&
      p.previousNoteId !== currentNoteId
    ) {
      return p;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearNoteNav(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(NAV_KEY);
}

export function saveScrollRestoreForNote(scrollTop: number): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(SCROLL_RESTORE_KEY, JSON.stringify({ scrollTop }));
  } catch {
    // ignore
  }
}

/** 读取并清除，避免重复滚动 */
export function consumeScrollRestore(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SCROLL_RESTORE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(SCROLL_RESTORE_KEY);
    const p = JSON.parse(raw) as { scrollTop?: number };
    return typeof p.scrollTop === "number" ? p.scrollTop : null;
  } catch {
    return null;
  }
}
