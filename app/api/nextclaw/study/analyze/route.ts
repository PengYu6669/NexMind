import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { generateNextClawStudyAnalyzeResult } from "@/lib/nextclaw-study";
import { firstValidationMessage, studyAnalyzeInputSchema } from "@/lib/api-inputs";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = studyAnalyzeInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });
  const { userText, assistantText, focusNoteTitle, relatedNotes } = parsed.data;

  try {
    const analysis = await generateNextClawStudyAnalyzeResult({
      userText,
      assistantText,
      focusNoteTitle: focusNoteTitle ?? null,
      relatedNotes,
    });

    return NextResponse.json({ analysis });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "学习分析生成失败" },
      { status: 500 }
    );
  }
}

