import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { getNoteSidebarLinks } from "@/lib/note-sidebar-links";
import { NoteEditor } from "@/components/notes/NoteEditor";

export const metadata: Metadata = {
  title: "笔记 · NexMind",
  description: "编辑笔记（MVP）",
};

export default async function NoteDetailPage({
  params,
}: {
  // Next.js 15+：动态路由 params 为 Promise，必须 await，否则 id 为 undefined，
  // Prisma 会忽略 undefined 条件，findFirst 永远命中「用户的第一条笔记」
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const note = await prisma.note.findFirst({
    where: { id, userId: user.id },
    include: {
      tags: {
        include: {
          tag: true,
        },
      },
    },
  });

  if (!note) notFound();

  const { outgoing, incoming } = await getNoteSidebarLinks(note.id, user.id);

  return (
    <NoteEditor
      key={note.id}
      noteId={note.id}
      initialTitle={note.title}
      initialContent={note.content}
      initialOutgoing={outgoing}
      initialIncoming={incoming}
    />
  );
}

