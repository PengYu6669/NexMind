import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { extractTextFromUrl, normalizeCaptureInput } from "@/lib/extractPage";
import { generateCaptureResult } from "@/lib/doubao";

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const body = (await req.json()) as { input?: string };
  const input = body.input?.trim();
  if (!input) {
    return NextResponse.json({ error: "缺少 input" }, { status: 400 });
  }

  try {
    const normalized = normalizeCaptureInput(input);
    const rawText =
      normalized.sourceType === "url"
        ? await extractTextFromUrl(normalized.sourceUrl!)
        : normalized.text;

    const ai = await generateCaptureResult(rawText);

    const noteTitle = ai.title?.trim() || "未命名笔记";
    const keyPoints = ai.keyPoints ?? [];
    const excerpt = keyPoints.length ? keyPoints.join("；") : undefined;

    // 写入 Tag（name 存为 #xxx，便于前端直接展示）
    const tagIds: string[] = [];
    for (const tagName of ai.tags ?? []) {
      const name = tagName.startsWith("#") ? tagName : `#${tagName}`;
      const existed = await prisma.tag.findFirst({
        where: { userId: user.id, name },
        select: { id: true },
      });
      if (existed?.id) {
        tagIds.push(existed.id);
        continue;
      }
      const created = await prisma.tag.create({
        data: { userId: user.id, name },
        select: { id: true },
      });
      tagIds.push(created.id);
    }

    const note = await prisma.note.create({
      data: {
        title: noteTitle,
        // cleanedContent 期望为 Markdown；兜底时也给一个较长的截断，避免看起来过于精简
        content: ai.cleanedContent || rawText.slice(0, 4000),
        excerpt,
        sourceUrl: normalized.sourceType === "url" ? normalized.sourceUrl : undefined,
        sourceType: "capture",
        userId: user.id,
        tags:
          tagIds.length > 0
            ? {
                create: tagIds.map((tagId) => ({ tagId })),
              }
            : undefined,
      },
      select: { id: true },
    });

    return NextResponse.json({ noteId: note.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "捕获失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

