import { describe, expect, it } from "vitest";
import { buildStructuredChunks } from "@/lib/rag-chunking";

describe("RAG structured chunking", () => {
  it("preserves heading metadata and Chinese search text", async () => {
    const chunks = await buildStructuredChunks({
      title: "测试笔记",
      sourceKind: "note",
      text: "# 检索设计\n\n混合检索同时使用向量召回和全文检索。",
      chunkSize: 120,
      chunkOverlap: 20,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.metadata?.heading).toBe("检索设计");
    expect(chunks[0]?.searchText).toContain("检索");
  });

  it("returns no chunks for empty input", async () => {
    await expect(buildStructuredChunks({ title: "空", sourceKind: "note", text: "" })).resolves.toEqual([]);
  });
});
