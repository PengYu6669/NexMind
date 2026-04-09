import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import {
  generateNextClawStudyNoteFromAnalyzeResult,
  type NextClawStudyAnalyzeResult,
} from "@/lib/nextclaw-study";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json()) as {
    analysis?: NextClawStudyAnalyzeResult;
  };

  if (!body.analysis) {
    return NextResponse.json({ error: "缺少 analysis" }, { status: 400 });
  }

  try {
    const note = await generateNextClawStudyNoteFromAnalyzeResult({
      analysis: body.analysis,
    });

    return NextResponse.json({ note });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "学习笔记生成失败" },
      { status: 500 }
    );
  }
}

