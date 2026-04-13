import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: Request,
  context: { params: Promise<{ jobId: string }> }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const p = await context.params;
  const jobId = p.jobId?.trim();
  if (!jobId) return NextResponse.json({ error: "缺少 jobId" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as { action?: string; url?: string };
  const action = (body.action ?? "").trim().toLowerCase();
  if (!action) return NextResponse.json({ error: "缺少 action" }, { status: 400 });

  const job = await prisma.learningJob.findFirst({
    where: { id: jobId, userId: user.id },
    select: {
      id: true,
      userId: true,
      noteId: true,
      type: true,
      status: true,
      priority: true,
      noteUpdatedAt: true,
      budgetTokens: true,
      plan: true,
      steps: true,
    },
  });
  if (!job) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

  if (action === "pause") {
    if (job.status !== "RUNNING" && job.status !== "PENDING") {
      return NextResponse.json({ error: "当前状态不可中断" }, { status: 409 });
    }
    await prisma.learningJob.update({
      where: { id: job.id },
      data: {
        status: "CANCELLED",
        finishedAt: new Date(),
        lastError: "用户中断：等待继续执行",
      },
    });
    return NextResponse.json({ ok: true, message: "任务已中断" });
  }

  if (action === "override_source") {
    const url = (body.url ?? "").trim();
    if (!url) return NextResponse.json({ error: "缺少 url" }, { status: 400 });
    if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "仅支持 http/https URL" }, { status: 400 });
    // 最小 HITL：建议先中断再覆盖来源，避免与 RUNNING 写入产生竞态。
    if (job.status === "RUNNING" || job.status === "PENDING") {
      return NextResponse.json({ error: "请先中断任务，再选择来源继续执行" }, { status: 409 });
    }
    if (!["FAILED", "CANCELLED", "SKIPPED"].includes(job.status)) {
      return NextResponse.json({ error: "当前状态不可选择来源" }, { status: 409 });
    }
    const planBase = job.plan && typeof job.plan === "object" && !Array.isArray(job.plan) ? (job.plan as Record<string, unknown>) : {};
    const nextPlan = {
      ...planBase,
      __hitl: {
        ...(planBase.__hitl && typeof planBase.__hitl === "object" ? (planBase.__hitl as Record<string, unknown>) : {}),
        overrideUrl: url,
        at: new Date().toISOString(),
      },
    };
    await prisma.learningJob.update({
      where: { id: job.id },
      data: {
        plan: nextPlan,
        status: "PENDING",
        runAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
    });
    return NextResponse.json({ ok: true, job: { id: job.id } });
  }

  if (action === "resume" || action === "retry_from_step") {
    if (!job.noteId) return NextResponse.json({ error: "缺少 noteId，无法继续" }, { status: 409 });
    if (!["FAILED", "CANCELLED", "SKIPPED"].includes(job.status)) {
      return NextResponse.json({ error: "当前状态不可继续执行" }, { status: 409 });
    }
    // 根治：不再创建新 job/删除旧 job，直接让同一个 jobId 重新进入队列。
    // LangGraph 的 thread_id=jobId，未来会在此基础上接入真正 checkpoint 恢复。
    await prisma.learningJob.update({
      where: { id: job.id },
      data: {
        status: "PENDING",
        runAt: new Date(),
        finishedAt: null,
        lastError: null,
      },
    });
    return NextResponse.json({ ok: true, job: { id: job.id } });
  }

  return NextResponse.json({ error: "不支持的 action" }, { status: 400 });
}

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

