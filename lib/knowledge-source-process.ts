import mammoth from "mammoth";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { baiduOcrAccurateBasic, baiduOcrPdf } from "@/lib/baidu-ocr";
import { deleteKnowledgeSourceRagChunks, indexKnowledgeSourceForRag } from "@/lib/rag";
import { downloadChatFileBuffer } from "@/lib/tos-chat-upload";
import { buildStructuredChunks } from "@/lib/rag-chunking";

const TEXT_MAX = 500_000;

async function extractTextFromBuffer(params: {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}): Promise<string> {
  const { buffer, mimeType, fileName } = params;
  const lower = fileName.toLowerCase();
  const mime = mimeType || "application/octet-stream";

  if (mime.startsWith("image/")) {
    const text = await baiduOcrAccurateBasic(buffer.toString("base64"));
    return text.trim();
  }

  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    const mod = await import("pdf-parse");
    const pdfParse = ((mod as { default?: unknown }).default ?? mod) as (b: Buffer) => Promise<{ text?: string }>;
    let text = "";
    try {
      const parsed = await pdfParse(buffer);
      text = (parsed.text || "").trim();
    } catch {
      text = "";
    }
    if (text.length < 80) {
      const ocr = await baiduOcrPdf(buffer.toString("base64"), "1");
      text = ocr.trim() || text;
    }
    return text;
  }

  if (
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    const r = await mammoth.extractRawText({ buffer });
    return (r.value || "").trim();
  }

  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "text/csv" ||
    mime === "text/markdown" ||
    mime === "text/x-markdown"
  ) {
    return buffer.toString("utf8").trim();
  }

  throw new Error(`暂不支持的文件类型：${mime}`);
}

/** 解析全文、写入 SourceChunk、写入向量表 */
export async function processKnowledgeSource(sourceId: string): Promise<void> {
  const row = await prisma.knowledgeSource.findUnique({ where: { id: sourceId } });
  if (!row?.storageKey) {
    await prisma.knowledgeSource.updateMany({
      where: { id: sourceId },
      data: { parseStatus: "failed", parseError: "缺少 storageKey", indexStatus: "failed" },
    });
    return;
  }

  await prisma.knowledgeSource.updateMany({
    where: { id: sourceId },
    data: { parseStatus: "running", parseError: null },
  });

  try {
    const buf = await downloadChatFileBuffer({ storageKey: row.storageKey });
    const textRaw = await extractTextFromBuffer({
      buffer: buf,
      mimeType: row.mimeType || "application/octet-stream",
      fileName: row.fileName || row.title,
    });
    const text = textRaw.slice(0, TEXT_MAX);
    if (!text.trim()) {
      throw new Error("解析结果为空");
    }

    await prisma.knowledgeSource.updateMany({
      where: { id: sourceId },
      data: { extractedText: text, parseStatus: "succeeded" },
    });

    await prisma.sourceChunk.deleteMany({ where: { sourceId } });
    await deleteKnowledgeSourceRagChunks(sourceId);

    const structuredChunks = await buildStructuredChunks({
      title: row.title,
      text,
      sourceKind: "knowledge_source",
    });
    const chunks = structuredChunks.map((c) => c.content).filter(Boolean);
    const searchTexts = structuredChunks.map((c) => c.searchText);

    if (chunks.length) {
      await prisma.sourceChunk.createMany({
        data: structuredChunks.map((chunk, i) => ({
          userId: row.userId,
          sourceId,
          chunkIndex: i,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          pageStart: chunk.pageStart ?? null,
          pageEnd: chunk.pageEnd ?? null,
          metadata: (chunk.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        })),
      });
      await indexKnowledgeSourceForRag({
        userId: row.userId,
        sourceId,
        title: row.title,
        chunks,
        searchTexts,
      });
    }

    await prisma.knowledgeSource.updateMany({
      where: { id: sourceId },
      data: { indexStatus: chunks.length ? "succeeded" : "failed", parseError: chunks.length ? null : "无可索引片段" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.knowledgeSource.updateMany({
      where: { id: sourceId },
      data: { parseStatus: "failed", parseError: msg, indexStatus: "failed" },
    });
  }
}

/** 发送消息前确保附件已解析（若仍 pending 则同步解析一次） */
export async function ensureKnowledgeSourceIndexed(sourceId: string): Promise<void> {
  const row = await prisma.knowledgeSource.findUnique({
    where: { id: sourceId },
    select: { parseStatus: true, indexStatus: true },
  });
  if (!row) return;
  if (row.parseStatus === "succeeded" && row.indexStatus === "succeeded") return;
  await processKnowledgeSource(sourceId);
}
