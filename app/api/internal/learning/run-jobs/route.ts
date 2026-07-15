import { NextResponse } from "next/server";
import { internalCronAuthError, verifyInternalCron } from "@/lib/internal-cron";
import { executeLearningJobsBatch } from "@/lib/learning-jobs-runner";
import { firstValidationMessage, internalBatchInputSchema } from "@/lib/api-inputs";

export async function POST(req: Request) {
  if (!verifyInternalCron(req)) {
    const authError = internalCronAuthError();
    return NextResponse.json({ error: authError.error }, { status: authError.status });
  }

  const parsed = internalBatchInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });
  const { limit } = parsed.data;
  const { claimed, succeeded, failed, skipped } = await executeLearningJobsBatch(limit);

  return NextResponse.json({
    ok: true,
    claimed,
    succeeded,
    failed,
    skipped,
  });
}
