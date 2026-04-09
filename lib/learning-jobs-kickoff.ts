import { after } from "next/server";
import { executeLearningJobsBatch } from "@/lib/learning-jobs-runner";

/**
 * 响应返回后继续处理队列，无需单独配置 cron 即可在入队后执行。
 */
export function scheduleLearningJobsProcessing(reason: string, limit = 15) {
  after(async () => {
    try {
      const r = await executeLearningJobsBatch(limit);
      if (process.env.NODE_ENV === "development") {
        console.log(`[learning-jobs kickoff:${reason}]`, r);
      }
    } catch (e) {
      console.error(`[learning-jobs kickoff:${reason}]`, e);
    }
  });
}
