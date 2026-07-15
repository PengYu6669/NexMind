import "dotenv/config";
import { prisma } from "@/lib/prisma";
import {
  buildNextClawMemoryBlock,
  upsertNextClawMemoryEntries,
  NEXTCLAW_MEMORY_SCOPE,
} from "@/lib/nextclaw-memory";

async function main() {
  const user = await prisma.user.findFirst({ select: { id: true } });
  if (!user) {
    console.log(JSON.stringify({ ok: false, reason: "no_user" }));
    return;
  }

  await upsertNextClawMemoryEntries(
    user.id,
    {
      current_topic: "在优化 NextClaw 的 RAG 与工作流",
      next_action: "先完成记忆模块，再继续参数治理",
    },
    {
      confidence: 0.8,
      source: "system",
      sourceConversationId: "verify-nextclaw-memory",
    }
  );

  const block = await buildNextClawMemoryBlock(user.id);
  const rows = await prisma.userMemory.findMany({
    where: { userId: user.id, scope: NEXTCLAW_MEMORY_SCOPE },
    orderBy: { updatedAt: "desc" },
    take: 2,
    select: { key: true, value: true },
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        memoryBlock: block,
        rows,
      },
      null,
      2
    )
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
