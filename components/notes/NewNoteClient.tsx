"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function NewNoteClient() {
  const router = useRouter();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({}),
        });
        const data = (await res.json().catch(() => null)) as { noteId?: string; error?: string } | null;
        if (!res.ok || !data?.noteId) throw new Error(data?.error || "新建笔记失败");
        if (!alive) return;
        router.replace(`/notes/${data.noteId}`);
      } catch {
        // 留在占位页即可
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);

  return null;
}

