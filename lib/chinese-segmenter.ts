/**
 * 中文分词工具（基于 Node.js 内置 Intl.Segmenter）。
 *
 * 用于 FTS 全文搜索前对中文文本做分词处理，
 * 替代 PostgreSQL 'simple' 配置的空白分词，使 tsvector 能正确索引中文词汇。
 *
 * 示例：
 *   "LangGraph多智能体编排系统" → "LangGraph 多 智能 体 编排 系统"
 */

let _segmenter: Intl.Segmenter | null = null;

function getSegmenter(): Intl.Segmenter {
  if (!_segmenter) {
    _segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  }
  return _segmenter;
}

/**
 * 对文本做中文分词，用空格连接。
 * 英文/数字保持原样，中文按词汇边界插入空格。
 * 结果可直接喂给 `to_tsvector('simple', ...)`。
 */
export function segmentForFts(text: string): string {
  if (!text) return "";
  const seg = getSegmenter();
  const parts: string[] = [];
  for (const { segment, isWordLike } of seg.segment(text)) {
    if (isWordLike) {
      parts.push(segment);
    }
    // 非 word-like 的片段（标点、空格等）跳过，tsvector 不需要
  }
  return parts.join(" ");
}

/**
 * 对检索查询做分词（与写入端保持一致）。
 */
export function segmentQueryForFts(query: string): string {
  return segmentForFts(query);
}
