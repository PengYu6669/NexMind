import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { ragSearch } from "@/lib/rag";
import { firstValidationMessage, searchInputSchema } from "@/lib/api-inputs";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = searchInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });
  const { query, noteId, topK } = parsed.data;

  try {
    const hits = await ragSearch({ userId: user.id, query, topK, noteId });
    return NextResponse.json({ hits });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "搜索失败";
    console.error("[api/search] ragSearch failed:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

