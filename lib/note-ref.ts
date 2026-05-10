/**
 * 正文 HTML 中的笔记互引用：href 形如 /notes/<noteId>
 * 纯函数，可安全用于客户端与服务端。
 */

const INTERNAL_NOTE_HREF = /^\/notes\/([^/?#]+)\/?$/i;

/** 从 HTML 中解析所有指向 /notes/:id 的笔记 id（去重） */
export function extractNoteRefIdsFromHtml(html: string): string[] {
  if (!html) return [];
  const ids = new Set<string>();
  const re = /href\s*=\s*["']\/notes\/([^"'/?#\s]+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    ids.add(m[1]);
  }
  return [...ids];
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 从正文中解析 Obsidian 风格的 [[笔记标题]] / [[笔记标题|别名]] */
export function extractWikiLinkTitlesFromHtml(html: string): string[] {
  if (!html) return [];
  const plain = htmlToPlainText(html);
  const titles = new Set<string>();
  const re = /\[\[([^\]\n]{1,120})\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain)) !== null) {
    const raw = (m[1] ?? "").split("|")[0]?.trim();
    if (raw) titles.add(raw);
  }
  return [...titles];
}

export function isInternalNoteHref(href: string): boolean {
  return INTERNAL_NOTE_HREF.test(href.trim());
}

/** 从 /notes/:id 解析出 id，非法时返回 null */
export function parseNoteIdFromInternalHref(href: string): string | null {
  const m = href.trim().match(INTERNAL_NOTE_HREF);
  return m ? m[1] : null;
}
