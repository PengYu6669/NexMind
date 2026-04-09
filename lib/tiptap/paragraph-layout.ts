import Paragraph from "@tiptap/extension-paragraph";

/** 段落缩进、行距、段前段后、首行缩进（分栏等复杂版式暂不实现） */
export const ParagraphLayout = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      indent: {
        default: 0,
        parseHTML: (element) => {
          const v = element.getAttribute("data-indent");
          return v ? parseInt(v, 10) : 0;
        },
        renderHTML: (attributes) => {
          const n = attributes.indent as number;
          if (!n || n <= 0) return {};
          return {
            "data-indent": String(n),
            style: `margin-left: ${n * 1.5}em`,
          };
        },
      },
      lineHeight: {
        default: null as string | null,
        parseHTML: (element) => element.style.lineHeight || null,
        renderHTML: (attributes) => {
          const lh = attributes.lineHeight as string | null;
          if (!lh) return {};
          return { style: `line-height: ${lh}` };
        },
      },
      textIndent: {
        default: null as string | null,
        parseHTML: (element) => element.style.textIndent || null,
        renderHTML: (attributes) => {
          const ti = attributes.textIndent as string | null;
          if (!ti) return {};
          return { style: `text-indent: ${ti}` };
        },
      },
      marginTop: {
        default: null as string | null,
        parseHTML: (element) => element.style.marginTop || null,
        renderHTML: (attributes) => {
          const v = attributes.marginTop as string | null;
          if (!v) return {};
          return { style: `margin-top: ${v}` };
        },
      },
      marginBottom: {
        default: null as string | null,
        parseHTML: (element) => element.style.marginBottom || null,
        renderHTML: (attributes) => {
          const v = attributes.marginBottom as string | null;
          if (!v) return {};
          return { style: `margin-bottom: ${v}` };
        },
      },
    };
  },
});
