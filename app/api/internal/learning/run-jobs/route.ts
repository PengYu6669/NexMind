import { NextResponse } from "next/server";
import { internalCronAuthError, verifyInternalCron } from "@/lib/internal-cron";
import { executeLearningJobsBatch } from "@/lib/learning-jobs-runner";

export async function POST(req: Request) {
  if (!verifyInternalCron(req)) {
    const authError = internalCronAuthError();
    return NextResponse.json({ error: authError.error }, { status: authError.status });
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
