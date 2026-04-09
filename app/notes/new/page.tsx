import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspacePlaceholder } from "@/components/layout/WorkspacePlaceholder";
import { NewNoteClient } from "@/components/notes/NewNoteClient";

export const metadata: Metadata = {
  title: "新建笔记 · NexMind",
  description: "创建新笔记",
};

export default function NewNotePage() {
  return (
    <AppShell
      center={
        <>
          <NewNoteClient />
          <WorkspacePlaceholder title="新建笔记" description="创建中…" />
        </>
      }
    />
  );
}
