import { EventEmitter } from "node:events";

type LearningJobEvent =
  | { type: "job_updated"; userId: string; jobId: string }
  | { type: "jobs_changed"; userId: string };

declare global {
  // eslint-disable-next-line no-var
  var __nexmindLearningJobEmitter: EventEmitter | undefined;
}

function getEmitter(): EventEmitter {
  if (!globalThis.__nexmindLearningJobEmitter) {
    globalThis.__nexmindLearningJobEmitter = new EventEmitter();
    // 避免多连接（SSE）时触发 MaxListeners 警告
    globalThis.__nexmindLearningJobEmitter.setMaxListeners(200);
  }
  return globalThis.__nexmindLearningJobEmitter;
}

export function emitLearningJobEvent(event: LearningJobEvent) {
  try {
    getEmitter().emit(event.type, event);
  } catch {
    // ignore
  }
}

export function onLearningJobEvent(
  type: LearningJobEvent["type"],
  handler: (event: LearningJobEvent) => void,
): () => void {
  const emitter = getEmitter();
  emitter.on(type, handler as any);
  return () => {
    emitter.off(type, handler as any);
  };
}

