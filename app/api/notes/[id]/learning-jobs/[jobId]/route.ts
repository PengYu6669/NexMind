import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * 删除本笔记下的一条学习任务（仅本人）。执行中的任务不可删除，请先等待结束。
 */
export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string; jobId: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  let noteId: string;
  let jobId: string;
  try {
    const p = await context.params;
    noteId = p.id;
    jobId = p.jobId;
  } catch {
    return NextResponse.json({ error: "无效请求" }, { status: 400 });
  }

  const job = await prisma.learningJob.findFirst({
    where: { id: jobId, userId: user.id, noteId },
    select: { id: true, status: true },
  });

  if (!job) {
    return NextResponse.json({ error: "任务不存在或无权操作" }, { status: 404 });
  }

  if (job.status === "RUNNING") {
    return NextResponse.json({ error: "任务正在执行中，请稍后再删或等待完成" }, { status: 409 });
  }

  await prisma.learningJob.delete({ where: { id: job.id } });

  return NextResponse.json({ ok: true });
}
