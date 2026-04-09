import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "知识库 · NexMind",
  description: "笔记与知识库列表",
};

export default async function NotesPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const notes = await prisma.note.findMany({
    where: { userId: user.id, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 30,
  });

  // 没有传入笔记 id 时，自动切到置顶/最新的一条，保证“切换笔记=切换编辑区”
  const first = notes[0];
  if (first?.id) {
    redirect(`/notes/${first.id}`);
  }

  return (
    <div className="p-8">
      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6 text-on-surface-variant">
        暂无笔记。请先使用左上角的捕获功能生成内容。
      </div>
    </div>
  );
}
