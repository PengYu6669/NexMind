import { stripHtmlToText } from "@/lib/rag";

/**
 * 将检索到的相关笔记压成「参考书」摘要块，注入 System Prompt。
 */
export function buildKbDigestFromRelated(params: {
  noteTitle: string;
  relatedNotes: { noteId: string; title: string; snippet: string; distance?: number }[];
  maxNotes?: number;
  snippetChars?: number;
}): string {
  const maxNotes = params.maxNotes ?? 5;
  const snippetChars = params.snippetChars ?? 200;
  const lines = params.relatedNotes.slice(0, maxNotes).map((n, i) => {
    const plain = stripHtmlToText(n.snippet).replace(/\s+/g, " ").trim();
    const cut = plain.slice(0, snippetChars);
    return `${i + 1}. 《${n.title}》（noteId=${n.noteId}）\n${cut}${plain.length > snippetChars ? "…" : ""}`;
  });
  if (!lines.length) {
    return `【知识库参考书摘要】\n当前未检索到其他强相关笔记；以下仅基于《${params.noteTitle}》正文生成。`;
  }
  return `【知识库参考书摘要（RAG Top-${lines.length}）】\n${lines.join("\n\n")}`;
}
