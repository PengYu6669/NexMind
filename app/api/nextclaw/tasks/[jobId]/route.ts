import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const p = await context.params;
  const jobId = p.jobId?.trim();
  if (!jobId) return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });

  const job = await prisma.learningJob.findFirst({
    where: { id: jobId, userId: user.id },
    select: { id: true, status: true },
  });
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  if (job.status === "RUNNING") {
    return NextResponse.json({ error: "任务正在执行中，请稍后再删" }, { status: 409 });
  }

  await prisma.learningJob.delete({ where: { id: job.id } });
  return NextResponse.json({ ok: true });
}

