import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import Subscript from "@tiptap/extension-subscript";
import Superscript from "@tiptap/extension-superscript";
import TextAlign from "@tiptap/extension-text-align";
import { ParagraphLayout } from "./paragraph-layout";

export type NoteEditorLinkConfig = {
  isAllowedUri: (url: string, ctx: { defaultValidate: (u: string) => boolean }) => boolean;
};

export function createNoteEditorExtensions(params: {
  placeholder: string;
  link: NoteEditorLinkConfig;
}) {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      paragraph: false,
      bulletList: { keepMarks: true, keepAttributes: false },
      orderedList: { keepMarks: true, keepAttributes: false },
    }),
    ParagraphLayout,
    Underline,
    TextStyleKit.configure({
      color: {},
      backgroundColor: {},
      fontFamily: {},
      fontSize: {},
      lineHeight: false,
    }),
    Highlight.configure({ multicolor: true }),
    Image.configure({
      inline: false,
      allowBase64: false,
      resize: {
        enabled: true,
        minWidth: 64,
        minHeight: 48,
        // 允许左右/上下自由缩放（不锁比例）
        // Shift 期间 TipTap 会临时锁定比例（符合 ResizableNodeView 行为）
        alwaysPreserveAspectRatio: false,
        directions: ["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"],
      },
    }),
    Subscript,
    Superscript,
    TextAlign.configure({
      types: ["heading", "paragraph"],
      defaultAlignment: "left",
    }),
    Link.configure({
      openOnClick: false,
      linkOnPaste: true,
      autolink: false,
      HTMLAttributes: {
        class: "note-editor-link",
      },
      isAllowedUri: params.link.isAllowedUri,
    }),
    Placeholder.configure({
      placeholder: params.placeholder,
    }),
  ];
}
