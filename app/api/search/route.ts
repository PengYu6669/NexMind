import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { ragSearch } from "@/lib/rag";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as { query?: string; noteId?: string; topK?: number };
  const query = body.query?.trim();
  if (!query) return NextResponse.json({ error: "缺少 query" }, { status: 400 });

  const noteId = body.noteId?.trim();
  const rawK = body.topK;
  const topK =
    typeof rawK === "number" && Number.isFinite(rawK)
      ? Math.max(1, Math.min(15, Math.floor(rawK)))
      : 3;

  const hits = await ragSearch({ userId: user.id, query, topK, noteId: noteId || undefined });
  return NextResponse.json({ hits });
}

