"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Editor } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";
import { NodeSelection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { marked } from "marked";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { NoteEditorToolbar } from "@/components/notes/NoteEditorToolbar";
import { isInternalNoteHref, parseNoteIdFromInternalHref } from "@/lib/note-ref";
import { createNoteEditorExtensions } from "@/lib/tiptap/note-editor-extensions";
import {
  clearNoteNav,
  consumeScrollRestore,
  readNoteNavForCurrentNote,
  saveNoteLinkNavigation,
  saveScrollRestoreForNote,
  type NoteNavPayload,
} from "@/lib/note-nav-session";

marked.setOptions({ gfm: true, breaks: true });

function normalizeUrl(raw: string): string | null {
  const base = raw.trim().replace(/，/g, ",").replace(/\s+/g, "");
  if (!base) return null;
  const withProtocol = /^(https?:\/\/|mailto:)/i.test(base) ? base : `https://${base}`;
  try {
    const parsed = new URL(withProtocol);
    if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) return null;
    return withProtocol;
  } catch {
    return null;
  }
}

function sanitizeHtmlLinks(html: string): string {
  if (!html || typeof window === "undefined") return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const anchors = doc.body.querySelectorAll("a");
  anchors.forEach((a) => {
    const href = a.getAttribute("href") ?? "";
    if (isInternalNoteHref(href)) {
      a.setAttribute("href", href.trim());
      return;
    }
    const normalized = normalizeUrl(href);
    if (!normalized) {
      a.removeAttribute("href");
    } else {
      a.setAttribute("href", normalized);
    }
  });
  return doc.body.innerHTML;
}

function markdownOrHtmlToHtml(input: string): string {
  const trimmed = input?.trim();
  if (!trimmed) return "";
  // 兼容历史数据：如果已经是 HTML，就原样喂给编辑器
  if (trimmed.startsWith("<")) return sanitizeHtmlLinks(trimmed);
  return sanitizeHtmlLinks(marked.parse(trimmed) as string);
}

function normalizePastedHtml(html: string): string {
  if (!html) return "";
  // 只在浏览器环境运行
  if (typeof window === "undefined") return html;

  const allowedTags = new Set([
    "p",
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "del",
    "a",
    "ul",
    "ol",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "blockquote",
    "pre",
    "code",
    "sub",
    "sup",
    "span",
    "mark",
    "img",
  ]);

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // 去掉绝大多数内联样式，避免“带一堆字体/颜色/行高”污染编辑器
    el.removeAttribute("style");
    el.removeAttribute("class");

    // 特判：图片必须保留 src/alt/title，否则会变成空节点
    if (tag === "img") {
      const src = (el.getAttribute("src") ?? "").trim();
      const alt = (el.getAttribute("alt") ?? "").trim();
      const title = (el.getAttribute("title") ?? "").trim();
      for (const attr of Array.from(el.attributes)) {
        if (!["src", "alt", "title"].includes(attr.name)) el.removeAttribute(attr.name);
      }
      // 只允许 http(s) 或 data:image（粘贴截图有些浏览器会给 data URL）
      if (!/^https?:\/\//i.test(src) && !/^data:image\//i.test(src)) {
        el.removeAttribute("src");
      } else {
        el.setAttribute("src", src);
      }
      if (alt) el.setAttribute("alt", alt);
      if (title) el.setAttribute("title", title);
      return;
    }

    // 仅保留链接的 href：http(s)/mailto 或站内 /notes/:id
    if (tag === "a") {
      const href = el.getAttribute("href")?.trim() ?? "";
      if (isInternalNoteHref(href)) {
        el.setAttribute("href", href);
      } else if (!/^(https?:\/\/|mailto:)/i.test(href)) {
        el.removeAttribute("href");
      } else {
        el.setAttribute("href", href);
      }
      // 其余属性全部删掉
      for (const attr of Array.from(el.attributes)) {
        if (attr.name !== "href") el.removeAttribute(attr.name);
      }
    } else {
      // 其它元素一律移除所有属性
      for (const attr of Array.from(el.attributes)) {
        el.removeAttribute(attr.name);
      }
    }

    // 不允许的标签：尽量“展开”其内容而不是直接丢弃
    if (!allowedTags.has(tag)) {
      // 常见的 div/span：展开为子节点
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
        return;
      }
    }

    // 递归处理子节点（注意：因为可能被展开/移除，所以用静态数组）
    for (const child of Array.from(el.childNodes)) {
      walk(child);
    }
  };

  for (const child of Array.from(doc.body.childNodes)) {
    walk(child);
  }

  // 把顶层的 div 规范化成 p（展开逻辑已处理大多数 div/span，这里再兜底）
  const out = doc.body.innerHTML
    .replace(/<(\/?)div\b/gi, "<$1p")
    .replace(/<(\/?)span\b/gi, "<$1span")
    .replace(/<span>/gi, "")
    .replace(/<\/span>/gi, "");

  return out;
}

/** 从右键目标解析出图片 DOM（含拖拽缩放手柄等兄弟节点） */
function findImageElementFromContextTarget(view: EditorView, target: HTMLElement): HTMLImageElement | null {
  const direct = target.closest?.("img");
  if (direct && view.dom.contains(direct)) return direct as HTMLImageElement;
  const wrap = target.closest?.("[data-resize-wrapper]");
  if (wrap && view.dom.contains(wrap)) {
    const img = wrap.querySelector("img");
    if (img) return img;
  }
  const container = target.closest?.("[data-resize-container][data-node='image']");
  if (container && view.dom.contains(container)) {
    const img = container.querySelector("img");
    if (img) return img;
  }
  return null;
}

/** 解析图片节点在文档中的起始位置（用于 NodeSelection） */
function resolveImageNodePos(view: EditorView, img: HTMLImageElement): number | null {
  try {
    const pos = view.posAtDOM(img, 0);
    const node = view.state.doc.nodeAt(pos);
    if (node?.type.name === "image") return pos;
    for (const delta of [-1, 1]) {
      const p = pos + delta;
      if (p < 0 || p > view.state.doc.content.size) continue;
      const n = view.state.doc.nodeAt(p);
      if (n?.type.name === "image") return p;
    }
  } catch {
    return null;
  }
  return null;
}

type BrushSnapshot = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  superscript: boolean;
  subscript: boolean;
  bulletList: boolean;
  orderedList: boolean;
  headingLevel: 1 | 2 | 3 | 4 | 5 | 6 | null;
  blockquote: boolean;
  codeBlock: boolean;
  textAlign: "left" | "center" | "right" | "justify" | null;
  indent: number | null;
  lineHeight: string | null;
  marginTop: string | null;
  marginBottom: string | null;
  textIndent: string | null;
  fontFamily: string | null;
  fontSize: string | null;
  color: string | null;
  backgroundColor: string | null;
  highlightColor: string | null;
};

type ParagraphAttrs = {
  textAlign?: "left" | "center" | "right" | "justify" | null;
  indent?: number | null;
  lineHeight?: string | null;
  marginTop?: string | null;
  marginBottom?: string | null;
  textIndent?: string | null;
};

type TextStyleAttrs = {
  fontFamily?: string | null;
  fontSize?: string | null;
  color?: string | null;
  backgroundColor?: string | null;
};

type HighlightAttrs = {
  color?: string | null;
};

export function NoteEditor({
  noteId,
  initialTitle,
  initialContent,
  initialOutgoing = [],
  initialIncoming = [],
}: {
  noteId: string;
  initialTitle: string;
  initialContent: string;
  /** 本文引用的其它笔记（出链） */
  initialOutgoing?: { id: string; title: string }[];
  /** 引用本文的笔记（反向链接） */
  initialIncoming?: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiSummaryBusy, setAiSummaryBusy] = useState(false);
  const [aiSummary, setAiSummary] = useState<string>("");
  const suppressNextUpdateRef = useRef(false);

  const [brushArmed, setBrushArmed] = useState(false);
  const brushSnapshotRef = useRef<BrushSnapshot | null>(null);

  /** 正文区内右键：自定义菜单（对齐底部工具栏能力，含关联笔记） */
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  const ctxMenuRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);

  const [notePickerOpen, setNotePickerOpen] = useState(false);
  const [notePickerList, setNotePickerList] = useState<{ id: string; title: string }[]>([]);
  const [notePickerQuery, setNotePickerQuery] = useState("");

  /** 由站内笔记链接进入时，可返回上一篇并恢复滚动 */
  const [navBack, setNavBack] = useState<NoteNavPayload | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const noteIdRef = useRef(noteId);
  useEffect(() => {
    noteIdRef.current = noteId;
  }, [noteId]);

  const initialHtml = useMemo(() => markdownOrHtmlToHtml(initialContent), [initialContent]);
  const htmlContentRef = useRef<string>(initialHtml);

  const extensions = useMemo(
    () =>
      createNoteEditorExtensions({
        placeholder:
          "开始输入...（支持加粗/斜体/下划线/删除线/上标下标/列表/标题/字体/字号/颜色/高亮/对齐/间距/关联其它笔记）",
        link: {
          isAllowedUri: (url, ctx) => {
            if (url && url.startsWith("/notes/")) return true;
            return ctx.defaultValidate(url);
          },
        },
      }),
    []
  );

  const editor = useEditor({
    extensions,
    content: initialHtml,
    // Next.js 会先进行 SSR 再水合，显式关闭立即渲染可避免 hydration mismatch
    immediatelyRender: false,
    editorProps: {
      attributes: {
        spellcheck: "true",
      },
      transformPastedHTML: (html) => normalizePastedHtml(html),
      handleDOMEvents: {
        paste: (_view, event) => {
          const e = event as ClipboardEvent;
          const filesFromFiles = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/"));
          const filesFromItems = Array.from(e.clipboardData?.items ?? [])
            .filter((it) => it.kind === "file" && it.type.startsWith("image/"))
            .map((it) => it.getAsFile())
            .filter((f): f is File => Boolean(f));
          const files = [...filesFromFiles, ...filesFromItems];

          const hasImageInClipboard =
            files.length > 0 ||
            Array.from(e.clipboardData?.types ?? []).some((t) => t.startsWith("image/")) ||
            Array.from(e.clipboardData?.items ?? []).some((it) => it.type.startsWith("image/"));

          const html = e.clipboardData?.getData?.("text/html") ?? "";
          const hasImgTagInHtml = html.includes("<img") && html.includes("src=");

          // 如果剪贴板没有直接给出图片文件，但包含 `<img src="...">`，走我们自己的图片代理+上传插入。
          if (hasImgTagInHtml && files.length === 0) {
            e.preventDefault();
            setError(null);
            setAiBusy(true);
            void (async () => {
              try {
                const doc = new DOMParser().parseFromString(html, "text/html");
                const imgs = Array.from(doc.querySelectorAll("img"));
                const srcs = imgs.map((img) => (img.getAttribute("src") ?? "").trim()).filter(Boolean);
                if (srcs.length === 0) return;

                for (const src of srcs) {
                  const proxyUrl = `/api/notes/${noteId}/images?src=${encodeURIComponent(src)}`;
                  const res = await fetch(proxyUrl, { credentials: "include" });
                  if (!res.ok) continue;
                  const blob = await res.blob();
                  const mime = blob.type || "image/png";
                  const file = new File([blob], `pasted-${Date.now()}`, { type: mime });
                  await uploadAndInsertImage(file);
                }
              } catch (err) {
                setError(err instanceof Error ? err.message : "粘贴图片失败");
              } finally {
                setAiBusy(false);
              }
            })();
            return true;
          }

          // 没有图像就交给编辑器默认粘贴逻辑
          if (!hasImageInClipboard) return false;

          e.preventDefault();
          setError(null);
          setAiBusy(true);
          void (async () => {
            try {
              // 1) 优先用 clipboardData.files/items 里直接可拿到的 File
              if (files.length > 0) {
                for (const f of files) {
                  await uploadAndInsertImage(f);
                }
                return;
              }

              // 2) 某些浏览器（或某些复制方式）下 clipboardData 可能拿不到 file，
              //    这时尝试用 navigator.clipboard.read() 读取图片 blob。
              const clipItems = await navigator.clipboard.read();
              for (const item of clipItems) {
                const imageType = item.types.find((t) => t.startsWith("image/"));
                if (!imageType) continue;
                const blob = await item.getType(imageType);
                const file = new File([blob], `pasted-${Date.now()}`, { type: imageType });
                await uploadAndInsertImage(file);
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : "粘贴图片失败");
            } finally {
              setAiBusy(false);
            }
          })();
          return true;
        },
        drop: (_view, event) => {
          const e = event as DragEvent;
          const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith("image/"));
          if (files.length === 0) return false;
          e.preventDefault();
          setError(null);
          setAiBusy(true);
          void (async () => {
            try {
              for (const f of files) {
                await uploadAndInsertImage(f);
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : "拖拽图片失败");
            } finally {
              setAiBusy(false);
            }
          })();
          return true;
        },
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest?.("a");
          if (!anchor) return false;
          const href = anchor.getAttribute("href");
          if (!href) return true;
          // 站内笔记链在 editor DOM 的 capture 阶段已 preventDefault + router.push，这里勿再触发浏览器跟随 <a href>
          if (parseNoteIdFromInternalHref(href)) {
            return true;
          }
          const normalized = normalizeUrl(href);
          if (!normalized) {
            event.preventDefault();
            setError("检测到无效链接，已拦截打开");
            return true;
          }
          anchor.setAttribute("href", normalized);
          return false;
        },
        contextmenu: (view, event) => {
          event.preventDefault();
          const pad = 8;
          const mw = 220;
          const target = event.target as HTMLElement;
          const imgEl = findImageElementFromContextTarget(view, target);
          const imgPos = imgEl ? resolveImageNodePos(view, imgEl) : null;

          // 右键图片：先把光标/选择切到 image node（便于菜单里的“复制/删除”工作正常）
          if (imgPos !== null) {
            const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, imgPos));
            view.dispatch(tr);
          }

          const mh = 320;
          let x = event.clientX;
          let y = event.clientY;
          if (x + mw > window.innerWidth - pad) x = Math.max(pad, window.innerWidth - mw - pad);
          if (y + mh > window.innerHeight - pad) y = Math.max(pad, window.innerHeight - mh - pad);
          if (x < pad) x = pad;
          if (y < pad) y = pad;
          setCtxMenu({ x, y });
          return true;
        },
      },
    },
    onUpdate: ({ editor }) => {
      htmlContentRef.current = editor.getHTML();
      if (suppressNextUpdateRef.current) {
        suppressNextUpdateRef.current = false;
        return;
      }
      setDirty(true);
    },
  });

  editorRef.current = editor;

  useEffect(() => {
    if (!editor) return;
    const nextHtml = markdownOrHtmlToHtml(initialContent);
    suppressNextUpdateRef.current = true;
    editor.commands.setContent(nextHtml, { emitUpdate: false });
    htmlContentRef.current = nextHtml;
    setTitle(initialTitle);
    setDirty(false);
    setError(null);
    setSavedAt(null);
  }, [editor, noteId, initialContent, initialTitle]);

  useEffect(() => {
    setNavBack(readNoteNavForCurrentNote(noteId));
  }, [noteId]);

  useEffect(() => {
    const top = consumeScrollRestore();
    if (top == null) return;
    const apply = () => {
      const el = mainScrollRef.current;
      if (el) el.scrollTop = top;
    };
    apply();
    requestAnimationFrame(apply);
    const t = window.setTimeout(apply, 80);
    return () => window.clearTimeout(t);
  }, [noteId]);

  /** 捕获阶段拦截站内 <a href="/notes/...">，彻底阻止浏览器默认跳转（否则会整页打开或新开标签） */
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;

    const onClickCapture = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement | null;
      const anchor = t?.closest?.("a");
      if (!anchor || !dom.contains(anchor)) return;
      const href = anchor.getAttribute("href");
      if (!href) return;
      const internalId = parseNoteIdFromInternalHref(href);
      if (!internalId) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const scrollEl = mainScrollRef.current;
      const previousScrollTop = scrollEl?.scrollTop ?? 0;
      saveNoteLinkNavigation({
        previousNoteId: noteIdRef.current,
        previousScrollTop,
        viaLinkToNoteId: internalId,
      });
      router.push(`/notes/${internalId}`, { scroll: false });
    };

    dom.addEventListener("click", onClickCapture, true);
    return () => dom.removeEventListener("click", onClickCapture, true);
  }, [editor, router]);

  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onDocPointerDown = (e: PointerEvent) => {
      if (ctxMenuRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onScroll = () => close();
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [ctxMenu]);

  useEffect(() => {
    if (!editor) return;
    if (!brushArmed) return;

    const handle = () => {
      const snapshot = brushSnapshotRef.current;
      if (!snapshot) return;
      if (editor.state.selection.empty) return;

      let chain = editor.chain().focus();

      if (snapshot.bold && !editor.isActive("bold")) chain = chain.toggleBold();
      if (snapshot.italic && !editor.isActive("italic")) chain = chain.toggleItalic();
      if (snapshot.underline && !editor.isActive("underline")) chain = chain.toggleUnderline();
      if (snapshot.strike && !editor.isActive("strike")) chain = chain.toggleStrike();
      if (
        snapshot.superscript &&
        !editor.isActive("superscript")
      )
        chain = chain.toggleSuperscript();
      if (
        snapshot.subscript &&
        !editor.isActive("subscript")
      )
        chain = chain.toggleSubscript();

      if (snapshot.bulletList && !editor.isActive("bulletList")) chain = chain.toggleBulletList();
      if (snapshot.orderedList && !editor.isActive("orderedList")) chain = chain.toggleOrderedList();
      if (snapshot.blockquote && !editor.isActive("blockquote")) chain = chain.toggleBlockquote();
      if (snapshot.codeBlock && !editor.isActive("codeBlock")) chain = chain.toggleCodeBlock();

      if (
        snapshot.headingLevel &&
        !editor.isActive("heading", { level: snapshot.headingLevel })
      ) {
        chain = chain.toggleHeading({ level: snapshot.headingLevel });
      }

      if (snapshot.textAlign && !editor.isActive({ textAlign: snapshot.textAlign })) {
        chain = chain.setTextAlign(snapshot.textAlign);
      }

      if (snapshot.indent != null || snapshot.lineHeight != null || snapshot.marginTop != null || snapshot.marginBottom != null || snapshot.textIndent != null) {
        chain = chain.updateAttributes("paragraph", {
          indent: snapshot.indent,
          lineHeight: snapshot.lineHeight,
          marginTop: snapshot.marginTop,
          marginBottom: snapshot.marginBottom,
          textIndent: snapshot.textIndent,
        });
      }

      if (snapshot.fontFamily) chain = chain.setFontFamily(snapshot.fontFamily);
      if (snapshot.fontSize) chain = chain.setFontSize(snapshot.fontSize);
      if (snapshot.color) chain = chain.setColor(snapshot.color);
      if (snapshot.backgroundColor) chain = chain.setBackgroundColor(snapshot.backgroundColor);
      if (snapshot.highlightColor) chain = chain.setHighlight({ color: snapshot.highlightColor });

      chain.run();
      setBrushArmed(false);
    };

    editor.on("selectionUpdate", handle);
    return () => {
      editor.off("selectionUpdate", handle);
    };
  }, [editor, brushArmed]);

  function applyUndo() {
    if (!editor) return;
    setBrushArmed(false);
    editor.chain().focus().undo().run();
  }

  function applyRedo() {
    if (!editor) return;
    setBrushArmed(false);
    editor.chain().focus().redo().run();
  }

  function onFormatBrush() {
    if (!editor) return;

    const headingLevels = [1, 2, 3, 4, 5, 6] as const;
    const headingLevel = headingLevels.find((lvl) => editor.isActive("heading", { level: lvl })) ?? null;

    const paragraphAttrs = editor.getAttributes("paragraph") as ParagraphAttrs;
    const textStyleAttrs = editor.getAttributes("textStyle") as TextStyleAttrs;
    const highlightAttrs = editor.getAttributes("highlight") as HighlightAttrs;

    brushSnapshotRef.current = {
      bold: editor.isActive("bold"),
      italic: editor.isActive("italic"),
      underline: editor.isActive("underline"),
      strike: editor.isActive("strike"),
      superscript: editor.isActive("superscript"),
      subscript: editor.isActive("subscript"),
      bulletList: editor.isActive("bulletList"),
      orderedList: editor.isActive("orderedList"),
      headingLevel,
      blockquote: editor.isActive("blockquote"),
      codeBlock: editor.isActive("codeBlock"),
      textAlign: paragraphAttrs.textAlign ?? null,
      indent: paragraphAttrs.indent ?? null,
      lineHeight: paragraphAttrs.lineHeight ?? null,
      marginTop: paragraphAttrs.marginTop ?? null,
      marginBottom: paragraphAttrs.marginBottom ?? null,
      textIndent: paragraphAttrs.textIndent ?? null,
      fontFamily: textStyleAttrs.fontFamily ?? null,
      fontSize: textStyleAttrs.fontSize ?? null,
      color: textStyleAttrs.color ?? null,
      backgroundColor: textStyleAttrs.backgroundColor ?? null,
      highlightColor: highlightAttrs.color ?? null,
    };

    setBrushArmed(true);
  }

  function onBold() {
    if (!editor) return;
    setBrushArmed(false);
    editor.chain().focus().toggleBold().run();
  }

  function onItalic() {
    if (!editor) return;
    setBrushArmed(false);
    editor.chain().focus().toggleItalic().run();
  }

  function formatBullets() {
    if (!editor) return;
    setBrushArmed(false);
    editor.chain().focus().toggleBulletList().run();
  }

  function toggleHeading1() {
    if (!editor) return;
    setBrushArmed(false);
    editor.chain().focus().toggleHeading({ level: 1 }).run();
  }

  async function openNoteRefPicker() {
    if (!editor) return;
    setBrushArmed(false);
    setNotePickerQuery("");
    setNotePickerOpen(true);
    try {
      const res = await fetch("/api/notes?limit=200");
      const data = (await res.json()) as { notes?: { id: string; title: string }[] };
      setNotePickerList(data.notes ?? []);
    } catch {
      setNotePickerList([]);
    }
  }

  function applyNoteRef(targetId: string) {
    if (!editor || targetId === noteId) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: `/notes/${targetId}` }).run();
    setNotePickerOpen(false);
    setDirty(true);
  }

  type NoteAiAction = "summary" | "expand" | "grammar" | "tone" | "polish" | "outline";

  function getSelectionPlainTextOrWhole(): string {
    if (!editor) return "";
    const { from, to } = editor.state.selection;
    if (from === to) return editor.getText();
    return editor.state.doc.textBetween(from, to, "\n", "\n");
  }

  async function onCopySelectionOrImage() {
    if (!editor) return;
    setError(null);

    const selection = editor.state.selection;
    if (selection instanceof NodeSelection && selection.node.type.name === "image") {
      const src = (selection.node.attrs?.src as string | null) ?? null;
      if (!src) {
        setError("该图片没有可复制的 src");
        return;
      }

      try {
        // 不直接 fetch(s3/tos) 资源，改为走同域代理接口：
        // 解决对象存储通常不提供 CORS，导致无法读取二进制写入剪贴板的问题。
        const proxyUrl = `/api/notes/${noteId}/images?src=${encodeURIComponent(src)}`;
        const res = await fetch(proxyUrl, { credentials: "include" });
        if (!res.ok) {
          setError("复制图片失败：图片代理读取失败");
          return;
        }
        const blob = await res.blob();
        const mime = blob.type || "image/png";
        if (!mime.startsWith("image/")) {
          setError("复制图片失败：代理返回的内容不是图片");
          return;
        }

        const html = `<img src="${src}" alt="" />`;
        const htmlBlob = new Blob([html], { type: "text/html" });
        await navigator.clipboard.write([
          new ClipboardItem({
            [mime]: blob,
            "text/html": htmlBlob,
          }),
        ]);
      } catch {
        setError("复制图片失败（可能受跨域/权限限制）");
      }

      return;
    }

    const { from, to } = selection;
    if (from === to) {
      setError("未选中任何内容");
      return;
    }

    const text = editor.state.doc.textBetween(from, to, "\n", "\n");
    if (!text.trim()) {
      setError("选中内容为空");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setError("复制文字失败，请检查浏览器剪贴板权限");
    }
  }

  function onDeleteSelection() {
    if (!editor) return;
    setBrushArmed(false);
    editor.chain().focus().deleteSelection().run();
  }

  async function requestNoteAiMarkdown(action: NoteAiAction, plainText: string): Promise<string> {
    const res = await fetch(`/api/notes/${noteId}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ action, plainText }),
    });
    const data = (await res.json().catch(() => null)) as { markdown?: string; error?: string } | null;
    if (!res.ok) throw new Error(data?.error || `AI ${action} 失败`);
    if (typeof data?.markdown !== "string") throw new Error(`AI ${action} 返回内容异常`);
    return data.markdown;
  }

  async function applyMarkdownToEditor(action: NoteAiAction) {
    if (!editor) return;
    const plainText = getSelectionPlainTextOrWhole().trim();
    if (!plainText) {
      setError("没有可处理的正文，请先输入内容或选中一段文字");
      return;
    }

    const markdown = await requestNoteAiMarkdown(action, plainText);
    const html = markdownOrHtmlToHtml(markdown);

    const { from, to } = editor.state.selection;
    // 有选区：只替换选区；无选区：替换全文
    if (from === to) {
      editor.commands.setContent(html);
    } else {
      editor.chain().focus().deleteSelection().insertContent(html).run();
    }
  }

  async function runAiSummary() {
    if (!editor) return;
    setError(null);
    setAiSummaryBusy(true);
    try {
      const plainText = editor.getText().trim();
      if (!plainText) {
        setError("当前笔记为空，无法生成摘要");
        return;
      }
      const markdown = await requestNoteAiMarkdown("summary", plainText);
      setAiSummary(markdown.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成摘要失败");
    } finally {
      setAiSummaryBusy(false);
    }
  }

  async function runAiPolish() {
    if (!editor) return;
    setError(null);
    setAiBusy(true);
    try {
      await applyMarkdownToEditor("polish");
    } catch (e) {
      setError(e instanceof Error ? e.message : "AI 润色失败");
    } finally {
      setAiBusy(false);
    }
  }

  async function runAiExpert(action: Exclude<NoteAiAction, "summary" | "polish">) {
    if (!editor) return;
    setError(null);
    setAiBusy(true);
    try {
      await applyMarkdownToEditor(action);
    } catch (e) {
      setError(e instanceof Error ? e.message : `AI 专家 ${action} 失败`);
    } finally {
      setAiBusy(false);
    }
  }

  async function uploadAndInsertImage(file: File) {
    if (!editor) return;
    if (!file.type.startsWith("image/")) return;

    const fd = new FormData();
    fd.append("file", file, file.name || "image.png");
    const res = await fetch(`/api/notes/${noteId}/images`, {
      method: "POST",
      body: fd,
      credentials: "include",
    });
    const data = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
    if (!res.ok || !data?.url) throw new Error(data?.error || "图片上传失败");

    editor.chain().focus().setImage({ src: data.url }).run();
    setDirty(true);
  }

  const saveNote = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (saving) return;
    if (!dirty && silent) return;
    if (!silent) setError(null);
    setSaving(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content: htmlContentRef.current }),
      });
      const dataUnknown = (await res.json().catch(() => null)) as unknown;
      const data = (dataUnknown && typeof dataUnknown === "object" ? dataUnknown : {}) as { error?: string };
      if (!res.ok) throw new Error(data.error || "保存失败");
      setDirty(false);
      setSavedAt(Date.now());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }, [dirty, noteId, router, saving, title]);

  async function onSave() {
    await saveNote({ silent: false });
  }

  async function onDelete() {
    if (saving || deleting) return;
    const ok = window.confirm("确认删除这条笔记吗？删除后不可恢复。");
    if (!ok) return;

    setError(null);
    setDeleting(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "DELETE",
        credentials: "include",
      });
      const data = (await res.json().catch(() => null)) as { error?: string; nextNoteId?: string | null } | null;
      if (!res.ok) throw new Error(data?.error || "删除失败");

      const nextId = data?.nextNoteId;
      if (nextId) {
        router.push(`/notes/${nextId}`);
      } else {
        router.push("/notes");
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(false);
    }
  }

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      void saveNote({ silent: true });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, saveNote]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const saveHotkey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";
      if (!saveHotkey) return;
      e.preventDefault();
      void saveNote({ silent: false });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNote]);

  const canUndo = editor ? editor.can().undo() : false;
  const canRedo = editor ? editor.can().redo() : false;

  const notePickerFiltered = useMemo(() => {
    const q = notePickerQuery.trim().toLowerCase();
    return notePickerList.filter(
      (n) => n.id !== noteId && (q === "" || n.title.toLowerCase().includes(q))
    );
  }, [notePickerList, noteId, notePickerQuery]);

  useEffect(() => {
    if (!notePickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNotePickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notePickerOpen]);

  return (
    <div className="min-h-0 flex h-full">
      {/* 中间编辑区（滚动位置用于笔记互链返回） */}
      <div ref={mainScrollRef} className="min-h-0 flex-1 overflow-y-auto px-12 py-10">
        <div className="mx-auto w-full max-w-4xl no-scrollbar">
          {/* AI 摘要 */}
          <div className="mb-12 rounded-2xl border border-primary/5 bg-surface-container-low p-6 relative group">
            <div className="absolute -top-3 left-6 px-3 py-1 rounded-full bg-primary text-on-primary text-[10px] font-black tracking-widest uppercase">
              AI 摘要
            </div>
            <p className="text-sm text-on-surface-variant leading-relaxed italic mt-8 whitespace-pre-wrap">
              {aiSummary ? aiSummary : "点击“生成摘要”提取重点，输出 3–8 句简洁摘要。"}
            </p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-[11px] text-slate-500">基于当前全文内容</div>
              <button
                type="button"
                className="flex items-center gap-2 text-primary text-xs font-bold hover:underline disabled:opacity-50"
                onClick={() => void runAiSummary()}
                disabled={!editor || aiSummaryBusy}
              >
                <MaterialIcon name="auto_awesome" className="text-sm" />
                {aiSummaryBusy ? "生成中..." : "生成摘要"}
              </button>
            </div>
          </div>

          {/* Editor Header */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              {navBack ? (
                <button
                  type="button"
                  className="mr-1 flex items-center gap-1.5 rounded-xl border border-outline-variant/20 bg-surface-container-highest/80 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10"
                  onClick={() => {
                    saveScrollRestoreForNote(navBack.previousScrollTop);
                    clearNoteNav();
                    setNavBack(null);
                    router.push(`/notes/${navBack.previousNoteId}`, { scroll: false });
                  }}
                >
                  <MaterialIcon name="arrow_back" className="text-base" />
                  返回
                </button>
              ) : null}
              <button
                type="button"
                className="rounded-lg p-2 text-slate-300 hover:bg-surface-container-highest disabled:opacity-60"
                onClick={applyUndo}
                disabled={!canUndo || saving}
                aria-label="撤回"
              >
                <MaterialIcon name="undo" />
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-slate-300 hover:bg-surface-container-highest disabled:opacity-60"
                onClick={applyRedo}
                disabled={!canRedo || saving}
                aria-label="重做"
              >
                <MaterialIcon name="redo" />
              </button>

              <div className="h-6 w-px bg-outline-variant/20" />

              <button
                type="button"
                className={`rounded-lg p-2 text-slate-300 hover:bg-surface-container-highest ${
                  brushArmed ? "bg-primary-container/30 text-primary" : ""
                }`}
                onClick={onFormatBrush}
                aria-label="格式刷"
                disabled={saving}
              >
                <MaterialIcon name="format_color_reset" />
              </button>
            </div>

            <div className="flex items-center gap-2">
              {error ? (
                <p className="text-xs text-on-error-container bg-error-container/10 border border-error-container/30 px-3 py-2 rounded-xl">
                  {error}
                </p>
              ) : savedAt ? (
                <p className="text-xs text-on-surface-variant">
                  {dirty ? "有未保存更改" : "已保存"}
                </p>
              ) : null}
              <button
                type="button"
                className="rounded-xl bg-primary-container px-4 py-2 text-sm font-bold text-on-primary-container transition-colors hover:bg-primary-container/90 disabled:opacity-60"
                onClick={onSave}
                disabled={saving || deleting}
              >
                {saving ? "保存中..." : "保存"}
              </button>
              <button
                type="button"
                className="rounded-xl bg-error/15 px-4 py-2 text-sm font-bold text-error transition-colors hover:bg-error/25 disabled:opacity-60"
                onClick={onDelete}
                disabled={saving || deleting}
              >
                {deleting ? "删除中..." : "删除"}
              </button>
            </div>
          </div>

          {/* Title */}
          <input
            className="mb-4 w-full rounded-xl border border-outline-variant/10 bg-surface-container-lowest px-4 py-3 text-2xl font-bold text-on-surface outline-none focus:ring-1 focus:ring-primary/30"
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setDirty(true);
            }}
          />

          {/* Editor Content — 站内笔记链与外链样式区分 */}
          <div className="note-editor-surface w-full min-h-[520px] rounded-2xl border border-outline-variant/10 bg-surface-container-lowest [&_.ProseMirror_a[href^='/notes/']]:cursor-pointer [&_.ProseMirror_a[href^='/notes/']]:font-medium [&_.ProseMirror_a[href^='/notes/']]:text-primary [&_.ProseMirror_a[href^='/notes/']]:underline [&_.ProseMirror_a[href^='/notes/']]:decoration-primary/50">
            {editor ? (
              <EditorContent
                editor={editor}
                className="px-5 py-4 outline-none focus:outline-none"
              />
            ) : null}
          </div>

          <div className="h-28" />
        </div>
      </div>

      {/* 右侧面板 */}
      <aside className="w-80 bg-surface-container-low/50 border-l border-outline-variant/10 py-10 px-6 flex flex-col gap-10">
        <section>
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">AI 专家选项</h3>
          <div className="space-y-2">
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 bg-surface-container-lowest hover:bg-surface-container transition-colors rounded-xl group"
              onClick={() => void runAiExpert("expand")}
              disabled={aiBusy}
            >
              <div className="flex items-center gap-3">
                <MaterialIcon name="expand" className="text-slate-400 group-hover:text-primary transition-colors" />
                <span className="text-xs font-medium text-on-surface-variant">扩充内容</span>
              </div>
              <MaterialIcon name="chevron_right" className="text-slate-600 text-sm" />
            </button>
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 bg-surface-container-lowest hover:bg-surface-container transition-colors rounded-xl group"
              onClick={() => void runAiExpert("grammar")}
              disabled={aiBusy}
            >
              <div className="flex items-center gap-3">
                <MaterialIcon name="spellcheck" className="text-slate-400 group-hover:text-primary transition-colors" />
                <span className="text-xs font-medium text-on-surface-variant">纠正语法</span>
              </div>
              <MaterialIcon name="chevron_right" className="text-slate-600 text-sm" />
            </button>
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 bg-surface-container-lowest hover:bg-surface-container transition-colors rounded-xl group"
              onClick={() => void runAiExpert("tone")}
              disabled={aiBusy}
            >
              <div className="flex items-center gap-3">
                <MaterialIcon name="neurology" className="text-slate-400 group-hover:text-primary transition-colors" />
                <span className="text-xs font-medium text-on-surface-variant">改变语气</span>
              </div>
              <MaterialIcon name="chevron_right" className="text-slate-600 text-sm" />
            </button>
            <button
              type="button"
              className="w-full flex items-center justify-between p-3 bg-surface-container-lowest hover:bg-surface-container transition-colors rounded-xl group"
              onClick={() => void runAiExpert("outline")}
              disabled={aiBusy}
            >
              <div className="flex items-center gap-3">
                <MaterialIcon name="format_list_bulleted" className="text-slate-400 group-hover:text-primary transition-colors" />
                <span className="text-xs font-medium text-on-surface-variant">整理大纲</span>
              </div>
              <MaterialIcon name="chevron_right" className="text-slate-600 text-sm" />
            </button>
          </div>
        </section>

        <section className="flex-1 flex flex-col min-h-0 gap-6">
          <div className="flex flex-col min-h-0">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">本文引用</h3>
            <div className="space-y-2 overflow-y-auto pr-2 no-scrollbar max-h-[140px]">
              {initialOutgoing.length === 0 ? (
                <p className="text-[11px] text-slate-500">暂无。选中正文后点「关联笔记」或右键选「关联笔记」。</p>
              ) : (
                initialOutgoing.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => router.push(`/notes/${n.id}`)}
                    className="w-full text-left p-3 bg-surface-container-lowest rounded-xl border border-transparent hover:border-primary/25 transition-all"
                  >
                    <p className="text-[11px] font-bold text-on-surface hover:text-primary truncate">{n.title}</p>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="flex flex-col min-h-0 flex-1">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">引用本文</h3>
            <p className="text-[10px] text-slate-500 mb-2">其它笔记中指向本篇的链接（反向引用）</p>
            <div className="space-y-2 overflow-y-auto pr-2 no-scrollbar flex-1">
              {initialIncoming.length === 0 ? (
                <p className="text-[11px] text-slate-500">暂无反向引用。</p>
              ) : (
                initialIncoming.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => router.push(`/notes/${n.id}`)}
                    className="w-full text-left p-3 bg-surface-container-lowest rounded-xl border border-transparent hover:border-primary/25 transition-all"
                  >
                    <p className="text-[11px] font-bold text-on-surface hover:text-primary truncate">{n.title}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        </section>
      </aside>

      {/* 悬浮格式工具栏 */}
      <div className="fixed bottom-10 left-1/2 -translate-x-1/2 w-[min(96vw,1200px)] bg-surface-container-highest/60 backdrop-blur-2xl rounded-2xl border border-white/5 shadow-2xl z-[120]">
        <NoteEditorToolbar
          editor={editor}
          disabled={saving || deleting || aiBusy || aiSummaryBusy}
          aiBusy={aiBusy}
          onAiPolish={() => void runAiPolish()}
        />
      </div>

      {ctxMenu ? (
        <div
          ref={ctxMenuRef}
          role="menu"
          aria-label="编辑器菜单"
          className="fixed z-[200] min-w-[200px] overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-highest/95 py-1 shadow-2xl backdrop-blur-xl"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-on-surface hover:bg-white/10"
            onClick={() => {
              setCtxMenu(null);
              onBold();
            }}
          >
            <MaterialIcon name="format_bold" className="text-slate-400" />
            加粗
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-on-surface hover:bg-white/10"
            onClick={() => {
              setCtxMenu(null);
              onItalic();
            }}
          >
            <MaterialIcon name="format_italic" className="text-slate-400" />
            斜体
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-on-surface hover:bg-white/10"
            onClick={() => {
              setCtxMenu(null);
              void onCopySelectionOrImage();
            }}
          >
            <MaterialIcon name="content_copy" className="text-slate-400" />
            复制
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-on-surface hover:bg-white/10"
            onClick={() => {
              setCtxMenu(null);
              formatBullets();
            }}
          >
            <MaterialIcon name="format_list_bulleted" className="text-slate-400" />
            项目符号
          </button>
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-on-surface hover:bg-white/10"
            onClick={() => {
              setCtxMenu(null);
              toggleHeading1();
            }}
          >
            <MaterialIcon name="title" className="text-slate-400" />
            标题 H1
          </button>
          <div className="my-1 h-px bg-outline-variant/15" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-medium text-primary hover:bg-primary/10"
            onClick={() => {
              setCtxMenu(null);
              void openNoteRefPicker();
            }}
          >
            <MaterialIcon name="link" className="text-primary" />
            关联笔记
          </button>
          <div className="my-1 h-px bg-outline-variant/15" />
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-error hover:bg-error/10"
            onClick={() => {
              setCtxMenu(null);
              onDeleteSelection();
            }}
          >
            <MaterialIcon name="delete" className="text-slate-400" />
            删除
          </button>
        </div>
      ) : null}

      {notePickerOpen ? (
        <div
          className="fixed inset-0 z-[210] flex items-center justify-center bg-black/50 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="note-ref-picker-title"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setNotePickerOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-outline-variant/20 bg-surface-container-highest p-4 shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="note-ref-picker-title" className="text-sm font-bold text-on-surface mb-2">
              关联到笔记
            </h2>
            <p className="text-[11px] text-on-surface-variant mb-3 leading-relaxed">
              将当前选中的文字链向另一篇笔记；点击正文中的彩色链接即可跳转。保存后会同步图谱中的笔记关系。
            </p>
            <input
              type="search"
              className="mb-3 w-full rounded-xl border border-outline-variant/15 bg-surface-container-lowest px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary/30"
              placeholder="搜索标题…"
              value={notePickerQuery}
              onChange={(e) => setNotePickerQuery(e.target.value)}
              autoFocus
            />
            <ul className="max-h-64 overflow-y-auto space-y-1 no-scrollbar">
              {notePickerFiltered.length === 0 ? (
                <li className="text-xs text-slate-500 py-4 text-center">没有可关联的笔记</li>
              ) : (
                notePickerFiltered.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      className="w-full rounded-xl px-3 py-2.5 text-left text-sm text-on-surface hover:bg-primary/10"
                      onClick={() => applyNoteRef(n.id)}
                    >
                      {n.title}
                    </button>
                  </li>
                ))
              )}
            </ul>
            <button
              type="button"
              className="mt-3 w-full rounded-xl py-2 text-xs text-on-surface-variant hover:bg-white/5"
              onClick={() => setNotePickerOpen(false)}
            >
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

