import { after } from "next/server";

async function executeLearningJobsBatchLazy(limit: number) {
  const mod = await import("@/lib/learning-jobs-runner");
  return mod.executeLearningJobsBatch(limit);
}

/**
 * 响应返回后继续处理队列，无需单独配置 cron 即可在入队后执行。
 */
export function scheduleLearningJobsProcessing(reason: string, limit = 15) {
  // DEV：`after()` 在部分环境会延迟执行，导致 UI 看到“空跑 30-60s”。
  // 这里直接 fire-and-forget 跑一轮，让任务尽快进入 RUNNING 并写出 steps。
  if (process.env.NODE_ENV === "development") {
    void executeLearningJobsBatchLazy(limit)
      .then((r) => console.log(`[learning-jobs kickoff(dev):${reason}]`, r))
      .catch((e) => console.error(`[learning-jobs kickoff(dev):${reason}]`, e));
  }

  after(async () => {
    try {
      const r = await executeLearningJobsBatchLazy(limit);
      if (process.env.NODE_ENV === "development") {
        console.log(`[learning-jobs kickoff:${reason}]`, r);
      }
    } catch (e) {
      console.error(`[learning-jobs kickoff:${reason}]`, e);
    }
  });
}
