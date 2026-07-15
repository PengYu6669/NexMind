import "dotenv/config";

process.env.NEXTCLAW_MCP_ENABLED = "false";

import { executeTool } from "@/lib/nextclaw-agent-tools";

async function main() {
  const result = await executeTool("audit_content", {
    userId: "verify-user",
    note: {
      id: "note-1",
      title: "RAG 设计",
      content: "<p>RAG 采用向量检索与词法检索结合。</p>",
    },
    relatedNotes: [
      {
        noteId: "note-2",
        title: "混合检索",
        snippet: "混合检索通常结合向量召回与全文检索。",
      },
    ],
    toolInput: {
      newContent: "新的内容提到 deprecated 做法以及需要补充的检索细节。",
    },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        result,
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
