import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  generateNextClawStudyNoteFromAnalyzeResult,
  type NextClawStudyAnalyzeResult,
} from "@/lib/nextclaw-study";
import { firstValidationMessage, studyAnalysisInputSchema } from "@/lib/api-inputs";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const input = await req.json().catch(() => ({}));
  const parsed = zodStudyBody(input);
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });

  try {
    const note = await generateNextClawStudyNoteFromAnalyzeResult({
      analysis: parsed.data.analysis,
    });

    return NextResponse.json({ note });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "学习笔记生成失败" },
      { status: 500 }
    );
  }
}

function zodStudyBody(input: unknown) {
  const result = studyAnalysisInputSchema.safeParse((input && typeof input === "object" && "analysis" in input)
    ? (input as { analysis?: unknown }).analysis
    : undefined);
  return result.success ? { success: true as const, data: { analysis: result.data as NextClawStudyAnalyzeResult } } : result;
}

