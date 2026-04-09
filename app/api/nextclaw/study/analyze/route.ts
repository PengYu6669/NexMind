import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { generateNextClawStudyAnalyzeResult } from "@/lib/nextclaw-study";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as {
    userText?: string;
    assistantText?: string;
    focusNoteTitle?: string | null;
    relatedNotes?: { noteId: string; title: string; snippet: string }[];
  };

  const userText = body.userText?.trim();
  const assistantText = body.assistantText?.trim();
  if (!userText || !assistantText) {
    return NextResponse.json({ error: "缺少 userText/assistantText" }, { status: 400 });
  }

  try {
    const analysis = await generateNextClawStudyAnalyzeResult({
      userText,
      assistantText,
      focusNoteTitle: body.focusNoteTitle ?? null,
      relatedNotes: Array.isArray(body.relatedNotes) ? body.relatedNotes : [],
    });

    return NextResponse.json({ analysis });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "学习分析生成失败" },
      { status: 500 }
    );
  }
}

