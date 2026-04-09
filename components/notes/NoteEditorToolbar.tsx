"use client";

import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const FONT_PRESETS = [
  { label: "系统默认", value: "" },
  { label: "宋体", value: "SimSun, serif" },
  { label: "黑体", value: "SimHei, sans-serif" },
  { label: "微软雅黑", value: "Microsoft YaHei, sans-serif" },
  { label: "等宽", value: "ui-monospace, monospace" },
];

const SIZE_PRESETS = ["12px", "14px", "16px", "18px", "20px", "24px", "28px"];

function ToolbarBtn({
  onClick,
  disabled,
  title,
  active,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 rounded-lg p-1.5 transition-colors disabled:opacity-40 ${
        active ? "bg-primary/25 text-primary" : "text-slate-300 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="mx-0.5 h-6 w-px shrink-0 self-center bg-white/15" />;
}

export function NoteEditorToolbar({
  editor,
  disabled,
  aiBusy,
  onAiPolish,
}: {
  editor: Editor | null;
  disabled: boolean;
  aiBusy: boolean;
  onAiPolish: () => void;
}) {
  if (!editor) return null;

  const d = disabled || aiBusy;

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const insertAutoToc = () => {
    const items: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name !== "heading") return;
      const text = node.textContent.trim();
      if (text) items.push(text);
    });
    if (items.length === 0) return;
    const html = `<ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
    editor
      .chain()
      .focus()
      .deleteSelection()
      .insertContent(html)
      .run();
  };

  const bumpIndent = (delta: number) => {
    const attrs = editor.getAttributes("paragraph") as { indent?: number };
    const cur = typeof attrs.indent === "number" ? attrs.indent : 0;
    const next = Math.max(0, Math.min(8, cur + delta));
    editor.chain().focus().updateAttributes("paragraph", { indent: next }).run();
  };

  const setParagraphLineHeight = (lineHeight: string) => {
    editor.chain().focus().updateAttributes("paragraph", { lineHeight }).run();
  };

  const setParagraphSpacing = (marginTop: string | null, marginBottom: string | null) => {
    editor
      .chain()
      .focus()
      .updateAttributes("paragraph", {
        marginTop: marginTop ?? null,
        marginBottom: marginBottom ?? null,
      })
      .run();
  };

  const setFirstLineIndent = (textIndent: string | null) => {
    editor.chain().focus().updateAttributes("paragraph", { textIndent }).run();
  };

  return (
    <div className="flex max-w-[min(96vw,1200px)] flex-wrap items-center gap-0.5 overflow-x-auto px-3 py-2">
      <ToolbarBtn
        title="撤销"
        disabled={d || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <MaterialIcon name="undo" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="重做"
        disabled={d || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <MaterialIcon name="redo" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        title="复制"
        disabled={d}
        onClick={async () => {
          const { from, to } = editor.state.selection;
          const text = editor.state.doc.textBetween(from, to, "\n");
          await navigator.clipboard.writeText(text);
        }}
      >
        <MaterialIcon name="content_copy" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="剪切"
        disabled={d}
        onClick={async () => {
          const { from, to } = editor.state.selection;
          if (from === to) return;
          const text = editor.state.doc.textBetween(from, to, "\n");
          await navigator.clipboard.writeText(text);
          editor.chain().focus().deleteRange({ from, to }).run();
        }}
      >
        <MaterialIcon name="content_cut" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="从剪贴板粘贴纯文本"
        disabled={d}
        onClick={async () => {
          const text = await navigator.clipboard.readText();
          editor.chain().focus().insertContent(text).run();
        }}
      >
        <MaterialIcon name="content_paste" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        title="加粗"
        active={editor.isActive("bold")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <MaterialIcon name="format_bold" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="斜体"
        active={editor.isActive("italic")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <MaterialIcon name="format_italic" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="下划线"
        active={editor.isActive("underline")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <MaterialIcon name="format_underlined" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="删除线"
        active={editor.isActive("strike")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <MaterialIcon name="strikethrough_s" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="上标"
        active={editor.isActive("superscript")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <MaterialIcon name="superscript" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="下标"
        active={editor.isActive("subscript")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <MaterialIcon name="subscript" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <select
        title="字体"
        disabled={d}
        className="max-w-[120px] shrink-0 rounded-lg border border-white/10 bg-surface-container-highest/80 px-1.5 py-1 text-[11px] text-on-surface outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (!v) editor.chain().focus().unsetFontFamily().run();
          else editor.chain().focus().setFontFamily(v).run();
          // 让 select 保持非受控状态即可
        }}
      >
        {FONT_PRESETS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        title="字号"
        disabled={d}
        className="w-[72px] shrink-0 rounded-lg border border-white/10 bg-surface-container-highest/80 px-1.5 py-1 text-[11px] text-on-surface outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontSize(v).run();
          // 让 select 保持非受控状态即可
        }}
      >
        <option value="">字号</option>
        {SIZE_PRESETS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-1 py-0.5 hover:bg-white/5">
        <span className="text-[10px] text-slate-500">字色</span>
        <input
          type="color"
          disabled={d}
          className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
      </label>
      <label className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-white/10 px-1 py-0.5 hover:bg-white/5">
        <span className="text-[10px] text-slate-500">底色</span>
        <input
          type="color"
          disabled={d}
          className="h-6 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
          onChange={(e) => editor.chain().focus().setBackgroundColor(e.target.value).run()}
        />
      </label>
      <ToolbarBtn
        title="高亮（黄）"
        active={editor.isActive("highlight")}
        disabled={d}
        onClick={() =>
          editor.chain().focus().toggleHighlight({ color: "#fde047" }).run()
        }
      >
        <MaterialIcon name="highlight" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="清除格式"
        disabled={d}
        onClick={() => {
          let chain = editor.chain().focus().unsetAllMarks().unsetTextAlign();
          if (editor.isActive("heading")) chain = chain.setParagraph();
          if (editor.isActive("blockquote")) chain = chain.toggleBlockquote();
          if (editor.isActive("codeBlock")) chain = chain.toggleCodeBlock();
          if (editor.isActive("bulletList")) chain = chain.toggleBulletList();
          if (editor.isActive("orderedList")) chain = chain.toggleOrderedList();
          chain.run();
        }}
      >
        <MaterialIcon name="format_clear" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <select
        title="标题层级"
        disabled={d}
        className="max-w-[100px] shrink-0 rounded-lg border border-white/10 bg-surface-container-highest/80 px-1.5 py-1 text-[11px] text-on-surface outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v === "p") editor.chain().focus().setParagraph().run();
          else if (v.startsWith("h")) {
            const level = parseInt(v.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
            editor.chain().focus().toggleHeading({ level }).run();
          }
          // 让 select 保持非受控状态即可
        }}
      >
        <option value="">标题</option>
        <option value="p">正文</option>
        <option value="h1">H1</option>
        <option value="h2">H2</option>
        <option value="h3">H3</option>
        <option value="h4">H4</option>
        <option value="h5">H5</option>
        <option value="h6">H6</option>
      </select>
      <ToolbarBtn
        title="自动生成目录（基于 H1-H6）"
        disabled={d}
        onClick={insertAutoToc}
      >
        <MaterialIcon name="table_rows" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        title="左对齐"
        active={editor.isActive({ textAlign: "left" })}
        disabled={d}
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
      >
        <MaterialIcon name="format_align_left" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="居中"
        active={editor.isActive({ textAlign: "center" })}
        disabled={d}
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
      >
        <MaterialIcon name="format_align_center" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="右对齐"
        active={editor.isActive({ textAlign: "right" })}
        disabled={d}
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
      >
        <MaterialIcon name="format_align_right" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="两端对齐"
        active={editor.isActive({ textAlign: "justify" })}
        disabled={d}
        onClick={() => editor.chain().focus().setTextAlign("justify").run()}
      >
        <MaterialIcon name="format_align_justify" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn title="减少缩进" disabled={d} onClick={() => bumpIndent(-1)}>
        <MaterialIcon name="format_indent_decrease" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn title="增加缩进" disabled={d} onClick={() => bumpIndent(1)}>
        <MaterialIcon name="format_indent_increase" className="text-lg" />
      </ToolbarBtn>
      <select
        title="行距（段落）"
        disabled={d}
        className="w-[76px] shrink-0 rounded-lg border border-white/10 bg-surface-container-highest/80 px-1.5 py-1 text-[11px] text-on-surface outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) setParagraphLineHeight(v);
          // 让 select 保持非受控状态即可
        }}
      >
        <option value="">行距</option>
        <option value="1">1.0</option>
        <option value="1.25">1.25</option>
        <option value="1.5">1.5</option>
        <option value="1.75">1.75</option>
        <option value="2">2.0</option>
      </select>
      <select
        title="段前距"
        disabled={d}
        className="w-[76px] shrink-0 rounded-lg border border-white/10 bg-surface-container-highest/80 px-1.5 py-1 text-[11px] text-on-surface outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) setParagraphSpacing(v, null);
          // 非受控模式
        }}
      >
        <option value="">段前</option>
        <option value="0">无</option>
        <option value="0.25em">小</option>
        <option value="0.5em">中</option>
        <option value="1em">大</option>
      </select>
      <select
        title="段后距"
        disabled={d}
        className="w-[76px] shrink-0 rounded-lg border border-white/10 bg-surface-container-highest/80 px-1.5 py-1 text-[11px] text-on-surface outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) setParagraphSpacing(null, v);
        }}
      >
        <option value="">段后</option>
        <option value="0">无</option>
        <option value="0.25em">小</option>
        <option value="0.5em">中</option>
        <option value="1em">大</option>
      </select>
      <select
        title="首行缩进"
        disabled={d}
        className="w-[88px] shrink-0 rounded-lg border border-white/10 bg-surface-container-highest/80 px-1.5 py-1 text-[11px] text-on-surface outline-none"
        defaultValue=""
        onChange={(e) => {
          const v = e.target.value;
          if (v !== "") setFirstLineIndent(v || null);
        }}
      >
        <option value="">首行</option>
        <option value="0">无</option>
        <option value="2em">2 字</option>
        <option value="3em">3 字</option>
      </select>
      <ToolbarDivider />
      <ToolbarBtn
        title="无序列表"
        active={editor.isActive("bulletList")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <MaterialIcon name="format_list_bulleted" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="有序列表"
        active={editor.isActive("orderedList")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <MaterialIcon name="format_list_numbered" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn
        title="水平分割线"
        disabled={d}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <MaterialIcon name="horizontal_rule" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <ToolbarBtn
        title="引用"
        active={editor.isActive("blockquote")}
        disabled={d}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <MaterialIcon name="format_quote" className="text-lg" />
      </ToolbarBtn>
      <ToolbarBtn title="代码块" active={editor.isActive("codeBlock")} disabled={d} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <MaterialIcon name="code" className="text-lg" />
      </ToolbarBtn>
      <ToolbarDivider />
      <button
        type="button"
        title="AI 润色选区或全文"
        disabled={d}
        onClick={onAiPolish}
        className="flex shrink-0 items-center gap-1 rounded-full bg-primary/20 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/30 disabled:opacity-40"
      >
        <MaterialIcon name="auto_fix" className="text-base" />
        AI 润色
      </button>
    </div>
  );
}
