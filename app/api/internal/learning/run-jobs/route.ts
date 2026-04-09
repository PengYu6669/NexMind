import { NextResponse } from "next/server";
import { executeLearningJobsBatch } from "@/lib/learning-jobs-runner";

function verifyCron(req: Request): boolean {
  const token = process.env.INTERNAL_CRON_TOKEN?.trim();
  if (!token) return false;
  const auth = req.headers.get("authorization")?.trim();
  return auth === `Bearer ${token}`;
}

export async function POST(req: Request) {
  if (!verifyCron(req)) {
    return NextResponse.json(
      { error: process.env.INTERNAL_CRON_TOKEN ? "未授权" : "服务未配置 INTERNAL_CRON_TOKEN" },
      { status: process.env.INTERNAL_CRON_TOKEN ? 401 : 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = typeof body.limit === "number" && Number.isFinite(body.limit) ? body.limit : 10;
  const { claimed, succeeded, failed, skipped } = await executeLearningJobsBatch(limit);

  return NextResponse.json({
    ok: true,
    claimed,
    succeeded,
    failed,
    skipped,
  });
}
