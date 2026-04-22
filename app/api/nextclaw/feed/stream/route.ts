import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildTaskUiPayload } from "@/lib/nextclaw-task-ui";
import { onLearningJobEvent } from "@/lib/learning-job-events";

async function buildActiveJobsPayload(userId: string) {
  const jobRows = await prisma.learningJob.findMany({
    where: {
      userId,
      OR: [
        { status: { in: ["PENDING", "RUNNING"] } },
        // HITL：等待用户输入来源 URL 的任务也要保持可见，否则中间工作流与右侧图谱会“消失”
        { status: "CANCELLED", lastError: { contains: "HITL" } },
      ],
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 5,
    select: {
      id: true,
      status: true,
      type: true,
      steps: true,
      note: { select: { title: true } },
    },
  });

  const uiByJob = jobRows.map((j) => ({
    id: j.id,
    status: j.status,
    type: j.type,
    noteTitle: j.note?.title ?? "（无标题）",
    ui: buildTaskUiPayload({ status: j.status, steps: j.steps }),
  }));

  const noteIds = Array.from(
    new Set(
      uiByJob.flatMap((j) =>
        (j.ui.steps ?? [])
          .map((s) => (s.toolSummary ?? "").match(/noteId=([a-z0-9]+)/i)?.[1] ?? "")
          .filter(Boolean),
      ),
    ),
  );

  const titleMap = new Map<string, string>();
  if (noteIds.length) {
    const rows = await prisma.note.findMany({
      where: { userId, id: { in: noteIds } },
      select: { id: true, title: true },
    });
    for (const r of rows) titleMap.set(r.id, r.title || "（无标题）");
  }

  const activeJobs = uiByJob.map((j) => {
    const generatedNotes = (j.ui.steps ?? [])
      .map((s) => {
        const id = (s.toolSummary ?? "").match(/noteId=([a-z0-9]+)/i)?.[1];
        if (!id) return null;
        return { id, title: titleMap.get(id) ?? "（新笔记）" };
      })
      .filter((x): x is { id: string; title: string } => Boolean(x));
    return {
      ...j,
      ui: {
        ...j.ui,
        generatedNotes,
      },
    };
  });

  const pendingJobs = await prisma.learningJob.count({
    where: {
      userId,
      OR: [
        { status: { in: ["PENDING", "RUNNING"] } },
        { status: "CANCELLED", lastError: { contains: "HITL" } },
      ],
    },
  });

  return { activeJobs, pendingJobs, generatedAt: new Date().toISOString() };
}

export async function GET(req: Request) {
  const user = await getAuthUser();
  if (!user) {
    return new Response("event: error\ndata: {\"error\":\"未登录\"}\n\n", {
      status: 401,
      headers: { "Content-Type": "text/event-stream; charset=utf-8" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };

      // 首包：推当前 activeJobs（避免前端等事件才有数据）
      try {
        const payload = await buildActiveJobsPayload(user.id);
        send("active_jobs", payload as unknown as Record<string, unknown>);
      } catch (e) {
        send("error", { error: e instanceof Error ? e.message : "初始化失败" });
      }

      // 心跳：防止某些代理/浏览器中途断开
      const heartbeat = setInterval(() => {
        try {
          send("ping", { t: Date.now() });
        } catch {
          // ignore
        }
      }, 15000);

      const unsubscribe = onLearningJobEvent("jobs_changed", async (evt) => {
        if (closed) return;
        const e = evt as { type: string; userId?: string };
        if (e.userId && e.userId !== user.id) return;
        try {
          const payload = await buildActiveJobsPayload(user.id);
          send("active_jobs", payload as unknown as Record<string, unknown>);
        } catch (err) {
          send("error", { error: err instanceof Error ? err.message : "刷新失败" });
        }
      });

      // 客户端断开时清理
      // @ts-expect-error - TS doesn't know about req.signal in this context
      req.signal?.addEventListener?.("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

