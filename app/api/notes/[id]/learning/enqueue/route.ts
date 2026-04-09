import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { enqueueErrorResponse, runLearningEnqueue } from "@/lib/note-learning-enqueue";

export async function POST(req: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录", code: "UNAUTHORIZED" }, { status: 401 });

  let noteId: string;
  try {
    const p = await context.params;
    noteId = p.id;
  } catch {
    return NextResponse.json({ error: "无效请求", code: "BAD_REQUEST" }, { status: 400 });
  }
  if (!noteId?.trim()) {
    return NextResponse.json({ error: "缺少笔记 id", code: "MISSING_NOTE_ID" }, { status: 400 });
  }

  const body = (await req.json().catch(() => ({}))) as { mode?: "lite" | "deep" };
  const mode = body.mode === "deep" ? "deep" : "lite";

  try {
    return await runLearningEnqueue({ user, noteId: noteId.trim(), mode });
  } catch (e) {
    return enqueueErrorResponse(e);
  }
}
