import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { segmentForFts } from "@/lib/chinese-segmenter";
import {
  CHUNK_SIZE_NOTE,
  CHUNK_SIZE_LONGFORM,
  CHUNK_SIZE_CODE,
  CHUNK_SIZE_CONVERSATION,
} from "@/lib/nextclaw-agent-config";

export type StructuredChunk = {
  content: string;
  /** 中文分词后的文本，用空格分隔，供 FTS tsvector 使用 */
  searchText: string;
  tokenCount: number | null;
  pageStart?: number | null;
  pageEnd?: number | null;
  metadata?: Record<string, unknown>;
};

const MAX_CHUNKS = 60;

type DocKind = "note" | "longform" | "code" | "conversation";

/** 启发式判断文档类型，用于自动选择分块大小 */
function detectDocKind(text: string): DocKind {
  const sample = text.slice(0, 4000);

  // 代码特征：``` 行占比 > 15% 或缩进行占比 > 30%
  const lines = sample.split("\n");
  const codeFenceLines = lines.filter((l) => /^```/.test(l.trim())).length;
  const indentedLines = lines.filter((l) => /^( {2,}|\t)/.test(l)).length;
  if (
    codeFenceLines >= 3 ||
    (indentedLines / Math.max(1, lines.length)) > 0.3
  ) {
    return "code";
  }

  // 对话特征：高频出现 "用户："、"助手："、"user:"、"assistant:" 等标记
  const turnMarkers = (
    sample.match(/(用户|助手|user|assistant|Human|AI)[：:]/gi) ?? []
  ).length;
  if (turnMarkers >= 4) {
    return "conversation";
  }

  // 长文特征：段落数少但段落很长（平均段落 > 500 字）
  const paragraphs = sample.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  const avgParaLen =
    paragraphs.reduce((s, p) => s + p.length, 0) /
    Math.max(1, paragraphs.length);
  if (avgParaLen > 500 && text.length > 5000) {
    return "longform";
  }

  return "note";
}

/** 根据文档类型获取 chunk 参数 */
function chunkParamsFor(docKind: DocKind): {
  chunkSize: number;
  chunkOverlap: number;
} {
  switch (docKind) {
    case "code":
      return { chunkSize: CHUNK_SIZE_CODE, chunkOverlap: 80 };
    case "longform":
      return { chunkSize: CHUNK_SIZE_LONGFORM, chunkOverlap: 150 };
    case "conversation":
      return { chunkSize: CHUNK_SIZE_CONVERSATION, chunkOverlap: 80 };
    default:
      return { chunkSize: CHUNK_SIZE_NOTE, chunkOverlap: 120 };
  }
}

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, " ").trim();
}

function splitByStructure(text: string): Array<{ headingPath: string[]; content: string }> {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""));

  const sections: Array<{ headingPath: string[]; content: string }> = [];
  let headingPath: string[] = [];
  let buffer: string[] = [];
  let inCodeBlock = false;

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (!content) return;
    sections.push({
      headingPath: [...headingPath],
      content,
    });
    buffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 代码块保护：``` 起止之间完整保留，不按空行/标题切分
    if (/^```/.test(line.trim())) {
      if (inCodeBlock) {
        // 代码块结束
        buffer.push(line);
        inCodeBlock = false;
        flush();
        continue;
      } else {
        // 代码块开始
        flush();
        buffer.push(line);
        inCodeBlock = true;
        continue;
      }
    }
    if (inCodeBlock) {
      buffer.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flush();
      const level = headingMatch[1]!.length;
      const title = normalizeLine(headingMatch[2]!);
      headingPath = headingPath.slice(0, level - 1);
      headingPath[level - 1] = title;
      continue;
    }

    // 表格行保护：| ... | 开头的行视为表格行，和上文合并
    const trimmed = line.trim();
    if (/^\|.*\|$/.test(trimmed) && buffer.length > 0) {
      // 检查上一条是否也是表格行或表头分隔线
      const lastLine = buffer[buffer.length - 1]?.trim() ?? "";
      if (/^\|.*\|$/.test(lastLine) || /^\|[\s\-:|]+\|$/.test(lastLine)) {
        buffer.push(line);
        continue;
      }
    }

    if (trimmed) {
      buffer.push(line);
    } else if (buffer.length && buffer[buffer.length - 1] !== "") {
      buffer.push("");
    }
  }

  flush();
  return sections;
}

function guessTokenCount(text: string): number | null {
  const plain = text.trim();
  if (!plain) return 0;
  return Math.max(1, Math.ceil(plain.length / 4));
}

export async function buildStructuredChunks(params: {
  title: string;
  text: string;
  sourceKind: "note" | "knowledge_source";
  chunkSize?: number;
  chunkOverlap?: number;
  maxChunks?: number;
}): Promise<StructuredChunk[]> {
  const body = params.text.trim();
  if (!body) return [];

  // 动态分块：未显式指定时根据文档类型自动选择
  const docKind = detectDocKind(body);
  const autoParams = chunkParamsFor(docKind);
  const chunkSize = params.chunkSize ?? autoParams.chunkSize;
  const chunkOverlap = params.chunkOverlap ?? autoParams.chunkOverlap;

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
  });

  const sections = splitByStructure(body);
  const chunks: StructuredChunk[] = [];
  const maxChunks = params.maxChunks ?? MAX_CHUNKS;

  for (const section of sections.length
    ? sections
    : [{ headingPath: [], content: body }]) {
    const docs = await splitter.createDocuments([section.content]);
    for (const doc of docs) {
      const pageContent = doc.pageContent.trim();
      if (!pageContent) continue;
      const headingPath = section.headingPath.filter(Boolean);
      const heading = headingPath.at(-1);
      const content = [
        `标题：${params.title}`,
        heading ? `所在小节：${heading}` : null,
        "",
        pageContent,
      ]
        .filter((x): x is string => typeof x === "string")
        .join("\n")
        .trim();

      chunks.push({
        content,
        searchText: segmentForFts(content),
        tokenCount: guessTokenCount(content),
        metadata: {
          sourceKind: params.sourceKind,
          headingPath,
          heading,
          title: params.title,
        },
      });

      if (chunks.length >= maxChunks) {
        return chunks;
      }
    }
  }

  return chunks;
}
