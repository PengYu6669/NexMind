import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { ragSearch } from "@/lib/rag";

async function main() {
  const user = await prisma.user.findFirst({
    select: { id: true },
  });

  if (!user) {
    console.log(JSON.stringify({ ok: false, reason: "no_user" }));
    return;
  }

  const note = await prisma.note.findFirst({
    where: { userId: user.id, archived: false },
    select: { id: true, title: true },
  });

  const query = note?.title?.slice(0, 24) || "学习";
  const hits = await ragSearch({
    userId: user.id,
    query,
    topK: 3,
    ...(note?.id ? { noteId: note.id } : {}),
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        userId: user.id,
        noteId: note?.id || null,
        query,
        hitCount: hits.length,
        hits: hits.slice(0, 2),
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
