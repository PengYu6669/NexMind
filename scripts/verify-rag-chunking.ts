import "dotenv/config";
import { buildStructuredChunks } from "@/lib/rag-chunking";

async function main() {
  const text = `# LangGraph

LangGraph 是一个图编排框架。

## Checkpoint

它支持 checkpoint 与恢复。

## Retrieval

RAG 检索需要结构化 chunk。
`;

  const chunks = await buildStructuredChunks({
    title: "测试文档",
    text,
    sourceKind: "knowledge_source",
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        count: chunks.length,
        sample: chunks.slice(0, 2),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
