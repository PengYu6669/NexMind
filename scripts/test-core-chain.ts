import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { buildStructuredChunks } from "@/lib/rag-chunking";
import { createExecutionMetrics, toEvaluationSummary } from "@/lib/nextclaw-workflow-policy";
import { executeLearningJobsBatch } from "@/lib/learning-jobs-runner";
import { classifyCompletedJobStatus } from "@/lib/learning-job-status";
import { verifyInternalCron } from "@/lib/internal-cron";
import { createNoteInputSchema, learningEnqueueInputSchema, registerInputSchema } from "@/lib/api-inputs";
import { ensureRagSchema } from "@/lib/rag";

async function main() {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('User', 'Note', 'LearningJob', 'LearningCard', 'ReviewItem', 'note_chunks', 'source_embedding_chunks')
  `;
  const found = new Set(tables.map((row) => row.table_name));
  const required = ['User', 'Note', 'LearningJob', 'LearningCard', 'ReviewItem', 'note_chunks', 'source_embedding_chunks'];
  for (const table of required) {
    if (!found.has(table)) throw new Error(`缺少核心表: ${table}`);
  }

  const chunks = await buildStructuredChunks({
    title: '核心链路测试',
    sourceKind: 'note',
    text: '# 检索测试\n\n这是用于验证中文分词、结构化分块和元数据保存的测试文本。',
    chunkSize: 120,
    chunkOverlap: 20,
  });
  if (!chunks.length || !chunks[0]?.searchText.includes('检索')) {
    throw new Error('RAG 分块或中文检索文本生成失败');
  }
  if (
    registerInputSchema.safeParse({ email: 'invalid', password: '123456' }).success ||
    createNoteInputSchema.safeParse({ title: 'x'.repeat(301) }).success ||
    learningEnqueueInputSchema.safeParse({ mode: 'turbo' }).success
  ) {
    throw new Error('核心 API 输入校验未拒绝非法参数');
  }

  const previousNodeEnv = process.env.NODE_ENV;
  const previousRagAutoMigrate = process.env.RAG_SCHEMA_AUTO_MIGRATE;
  Reflect.set(process.env, 'NODE_ENV', 'production');
  process.env.RAG_SCHEMA_AUTO_MIGRATE = 'false';
  try {
    await ensureRagSchema();
  } finally {
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previousNodeEnv);
    if (previousRagAutoMigrate === undefined) delete process.env.RAG_SCHEMA_AUTO_MIGRATE;
    else process.env.RAG_SCHEMA_AUTO_MIGRATE = previousRagAutoMigrate;
  }

  const metrics = createExecutionMetrics();
  metrics.toolCalls = 2;
  metrics.retries = 1;
  const summary = toEvaluationSummary(metrics);
  if (summary.toolCalls !== 2 || summary.retries !== 1) {
    throw new Error('工作流指标汇总失败');
  }
  if (
    classifyCompletedJobStatus('SUCCEEDED') !== 'succeeded' ||
    classifyCompletedJobStatus('FAILED') !== 'failed' ||
    classifyCompletedJobStatus('CANCELLED') !== 'skipped'
  ) {
    throw new Error('任务最终状态分类失败');
  }

  const previousCronToken = process.env.INTERNAL_CRON_TOKEN;
  process.env.INTERNAL_CRON_TOKEN = 'core-chain-token';
  try {
    const allowed = verifyInternalCron(new Request('http://localhost', { headers: { authorization: 'Bearer core-chain-token' } }));
    const denied = verifyInternalCron(new Request('http://localhost', { headers: { authorization: 'Bearer wrong-token' } }));
    if (!allowed || denied) throw new Error('内部 cron 鉴权失败');
  } finally {
    if (previousCronToken === undefined) delete process.env.INTERNAL_CRON_TOKEN;
    else process.env.INTERNAL_CRON_TOKEN = previousCronToken;
  }

  const testUser = await prisma.user.create({
    data: { email: `core-chain-${Date.now()}@example.com` },
    select: { id: true },
  });
  try {
    const note = await prisma.note.create({
      data: { userId: testUser.id, title: '任务状态测试', content: '测试内容' },
      select: { id: true },
    });
    const job = await prisma.learningJob.create({
      data: {
        userId: testUser.id,
        noteId: note.id,
        type: 'NOTE_EXTERNAL_INJECT',
        status: 'PENDING',
        runAt: new Date(0),
        priority: 1000,
      },
      select: { id: true },
    });
    const batch = await executeLearningJobsBatch(1);
    const persisted = await prisma.learningJob.findUnique({ where: { id: job.id }, select: { status: true } });
    if (batch.claimed !== 1 || batch.skipped !== 1 || persisted?.status !== 'SKIPPED') {
      throw new Error(`任务状态闭环失败: ${JSON.stringify({ batch, status: persisted?.status })}`);
    }
  } finally {
    await prisma.user.delete({ where: { id: testUser.id } });
  }

  console.log(`core-chain: ok (tables=${found.size}, chunks=${chunks.length}, validation=ok, ragSchema=ok, jobLifecycle=ok)`);
}

main()
  .catch((error) => {
    console.error('core-chain: failed', error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
