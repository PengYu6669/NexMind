import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { NotesLibrarySidebar } from "@/components/notes/NotesLibrarySidebar";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

function formatRelativeTime(when: Date): string {
  const diffMs = Date.now() - when.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 60) return `${Math.max(1, diffMin)} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay} 天前`;
}

export default async function NotesLayout({ children }: { children: ReactNode }) {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const folders = await prisma.noteFolder.findMany({
    where: { userId: user.id },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, sortOrder: true },
  });

  const notes = await prisma.note.findMany({
    where: { userId: user.id, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 80,
    include: { tags: { include: { tag: true } } },
  });

  const list = notes.map((note, idx) => ({
    id: note.id,
    title: note.title,
    excerpt: note.excerpt ?? note.content.slice(0, 160),
    tags: note.tags.map((nt) => nt.tag.name),
    timeLabel: formatRelativeTime(note.updatedAt ?? note.createdAt),
    featured: note.pinned || idx === 0,
    folderId: note.folderId,
    pinned: note.pinned,
  }));

  return (
    <div className="min-h-screen bg-surface">
      <AppSidebar />
      <div className="flex min-h-screen flex-col pl-64">
        <AppTopBar />
        <div className="flex min-h-0 flex-1 pt-16">
          <div className="flex min-h-0 w-full max-w-sm shrink-0 flex-col self-stretch border-r border-outline-variant/10 lg:max-w-[320px]">
            <NotesLibrarySidebar
              folders={folders}
              notes={list}
              className="min-h-0 flex-1 border-0"
            />
          </div>
          <div className="min-h-0 flex-1 bg-surface">{children}</div>
        </div>
      </div>
    </div>
  );
}

