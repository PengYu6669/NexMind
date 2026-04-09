import { prisma } from "@/lib/prisma";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { OpenAIEmbeddings } from "@langchain/openai";
import pgvector from "pgvector";

/** 火山方舟多模态向量：完整 URL，例如 …/api/v3/embeddings/multimodal（与对话的 AI_API_BASE_URL 不同） */
const ENV_EMBEDDING_URL = "AI_API_EMBEDDING_URL";

/** 未配置 AI_EMBEDDING_DIMENSION 且模型名无法识别时的兜底（OpenAI text-embedding-3-small 等） */
const DEFAULT_EMBEDDING_DIM = 1536;

/**
 * 火山 doubao-embedding-vision-251215（Seed1.6-Embedding-1215）默认 **2048** 维；
 * 若请求里传 `dimensions` 手动降维到 **1024**，请把 AI_EMBEDDING_DIMENSION 设为 1024（此时可用 pgvector HNSW，见 PGVECTOR_ANN_MAX_DIM）。
 */
const DOUBAO_EMBEDDING_VISION_251215_DIM = 2048;

/** pgvector：HNSW / IVFFlat 等近似索引对单列维度有上限（当前扩展一般为 2000），超过则只能顺序扫描做 `<=>` */
const PGVECTOR_ANN_MAX_DIM = 2000;

function inferDefaultEmbeddingDimFromModel(): number {
  const name = `${process.env.AI_MODEL_EMBEDDING ?? ""} ${process.env.AI_MODEL_SEARCH ?? ""}`.toLowerCase();
  if (name.includes("doubao-embedding-vision-251215")) {
    return DOUBAO_EMBEDDING_VISION_251215_DIM;
  }
  return DEFAULT_EMBEDDING_DIM;
}

/** 与 pgvector 列 `vector(N)`、查询/插入中的 `::vector(N)` 一致，避免 22023 column does not have dimensions */
export function getExpectedEmbeddingDim(): number {
  const raw = process.env.AI_EMBEDDING_DIMENSION?.trim();
  if (!raw) return inferDefaultEmbeddingDimFromModel();
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1 || n > 32000) return inferDefaultEmbeddingDimFromModel();
  return n;
}

function assertEmbeddingMatchesSchema(vec: number[], where: string): void {
  const expected = getExpectedEmbeddingDim();
  if (vec.length !== expected) {
    throw new Error(
      `${where}：接口返回向量维度为 ${vec.length}，与 AI_EMBEDDING_DIMENSION=${expected} 不一致。请在环境变量中设置 AI_EMBEDDING_DIMENSION=${vec.length} 后重启服务。`
    );
  }
}

export type RagHit = {
  noteId: string;
  chunkId: string;
  chunkIndex: number;
  content: string;
  distance: number;
  noteTitle?: string;
};

function getEmbeddingModelName(): string {
  return (
    process.env.AI_MODEL_EMBEDDING ||
    process.env.AI_MODEL_SEARCH ||
    "text-embedding-3-small"
  );
}

/** 多模态 embedding 端点（完整 URL）；未配置则走标准 OpenAI 兼容 /embeddings */
function getMultimodalEmbeddingUrl(): string {
  const raw = process.env[ENV_EMBEDDING_URL]?.trim();
  if (raw) return raw.replace(/\/$/, "");
  return "";
}

function getEmbeddingConfig(): {
  model: string;
  apiKey: string;
  /** 标准 OpenAI 兼容 chat/completions 同级的 base，如 …/api/v3 */
  openAiBaseURL: string;
  multimodalUrl: string;
} {
  const apiKey = process.env.AI_API_KEY ?? "";
  const openAiBaseURL = (process.env.AI_API_BASE_URL ?? "").replace(/\/$/, "");
  const multimodalUrl = getMultimodalEmbeddingUrl();
  const model = getEmbeddingModelName();

  if (!apiKey) throw new Error("缺少 AI_API_KEY（用于 embedding）");

  if (!multimodalUrl && !openAiBaseURL) {
    throw new Error(
      `请配置 ${ENV_EMBEDDING_URL}（火山多模态向量完整地址）或 AI_API_BASE_URL（标准 embeddings）`
    );
  }

  return { model, apiKey, openAiBaseURL, multimodalUrl };
}

function isNumberArray(x: unknown): x is number[] {
  return (
    Array.isArray(x) &&
    x.length > 0 &&
    x.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/** 在 JSON 里找「最长的纯数字数组」，用于兼容方舟与 OpenAI 不同字段名 */
function findLongestEmbeddingVector(node: unknown, minLen = 64): number[] | null {
  let best: number[] | null = null;
  const visit = (n: unknown) => {
    if (n === null || n === undefined) return;
    if (isNumberArray(n) && n.length >= minLen) {
      if (!best || n.length > best.length) best = n;
      return;
    }
    if (Array.isArray(n)) {
      for (const item of n) visit(item);
      return;
    }
    if (typeof n === "object") {
      for (const v of Object.values(n as object)) visit(v);
    }
  };
  visit(node);
  return best;
}

function parseArkEmbeddingPayload(data: unknown): number[] {
  const d = data as Record<string, unknown>;

  const apiErr =
    (d?.error as { message?: string } | undefined)?.message ||
    (typeof d?.message === "string" ? d.message : undefined);
  if (apiErr) throw new Error(apiErr);

  const code = d?.code;
  if (typeof code === "number" && code !== 0 && code !== 200) {
    throw new Error(`向量接口业务错误 code=${code}`);
  }

  // OpenAI 兼容：data[0].embedding
  const dataField = d?.data;
  if (Array.isArray(dataField) && dataField[0] && typeof dataField[0] === "object") {
    const emb = (dataField[0] as { embedding?: unknown }).embedding;
    if (isNumberArray(emb)) return emb;
  }

  // data 为对象：data.embedding / data.vector 等
  if (dataField && typeof dataField === "object" && !Array.isArray(dataField)) {
    const inner = dataField as Record<string, unknown>;
    for (const key of ["embedding", "vector", "embeddings"]) {
      const v = inner[key];
      if (isNumberArray(v)) return v;
      if (Array.isArray(v) && v[0] && typeof v[0] === "object") {
        const e = (v[0] as { embedding?: unknown }).embedding;
        if (isNumberArray(e)) return e;
      }
    }
  }

  // 顶层 embedding
  if (isNumberArray(d?.embedding)) return d.embedding as number[];

  // 兜底：扫描整棵 JSON（方舟字段名可能与 OpenAI 不一致）
  const guessed = findLongestEmbeddingVector(data, 32);
  if (guessed) return guessed;

  const preview =
    typeof data === "object" && data !== null
      ? JSON.stringify(data).slice(0, 800)
      : String(data);
  throw new Error(`无法解析向量接口返回，响应片段：${preview}`);
}

/**
 * 火山方舟多模态向量：与官方 curl 一致。
 * 纯文本 RAG 只传一条 { type: "text", text }。
 * doubao-embedding-vision 等默认 2048 维；若需 1024 维须同时设 AI_EMBEDDING_DIMENSION=1024，并在请求里传 dimensions（与库表 vector(N) 一致）。
 */
async function arkMultimodalEmbed(text: string): Promise<number[]> {
  const { model, apiKey, multimodalUrl } = getEmbeddingConfig();
  if (!multimodalUrl) {
    throw new Error("内部错误：未配置多模态向量 URL");
  }

  const dimensions = getExpectedEmbeddingDim();

  const res = await fetch(multimodalUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: [{ type: "text", text }],
      dimensions,
    }),
  });

  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string }; message?: string })?.error?.message ||
      (data as { message?: string })?.message ||
      `向量请求失败 HTTP ${res.status}`;
    throw new Error(msg);
  }

  return parseArkEmbeddingPayload(data);
}

async function arkMultimodalEmbedMany(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const t of texts) {
    out.push(await arkMultimodalEmbed(t));
  }
  return out;
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ensureRagSchema(): Promise<void> {
  const dim = getExpectedEmbeddingDim();
  if (!Number.isInteger(dim)) {
    throw new Error("AI_EMBEDDING_DIMENSION 必须为整数");
  }

  await prisma.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector;`);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS note_chunks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      note_id TEXT NOT NULL,
      chunk_index INT NOT NULL,
      content TEXT NOT NULL,
      embedding vector(${dim}) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS note_chunks_user_id_idx ON note_chunks (user_id);
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS note_chunks_note_id_idx ON note_chunks (note_id);
  `);

  await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS note_chunks_embedding_hnsw_idx`);
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE note_chunks ALTER COLUMN embedding TYPE vector(${dim}) USING embedding::vector(${dim})`
    );
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[rag] note_chunks.embedding 列类型已是 vector(" + dim + ") 或无法自动迁移，可忽略：", e);
    }
  }

  if (dim <= PGVECTOR_ANN_MAX_DIM) {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes WHERE indexname = 'note_chunks_embedding_hnsw_idx'
        ) THEN
          CREATE INDEX note_chunks_embedding_hnsw_idx
          ON note_chunks
          USING hnsw (embedding vector_cosine_ops);
        END IF;
      END $$;
    `);
  } else if (process.env.NODE_ENV === "development") {
    console.warn(
      `[rag] 向量维度 ${dim} 超过 pgvector 近似索引上限（${PGVECTOR_ANN_MAX_DIM}），已跳过 HNSW；检索仍可用，数据量很大时会偏慢。`
    );
  }
}

function createOpenAiCompatibleEmbeddings() {
  const { model, apiKey, openAiBaseURL } = getEmbeddingConfig();
  if (!openAiBaseURL) {
    throw new Error("未配置 AI_API_BASE_URL，无法使用标准 OpenAI embeddings");
  }
  return new OpenAIEmbeddings({
    model,
    apiKey,
    configuration: {
      baseURL: openAiBaseURL,
    },
  });
}

async function embedQueryUnified(text: string): Promise<number[]> {
  const { multimodalUrl } = getEmbeddingConfig();
  let vec: number[];
  if (multimodalUrl) {
    vec = await arkMultimodalEmbed(text);
  } else {
    const emb = createOpenAiCompatibleEmbeddings();
    vec = await emb.embedQuery(text);
  }
  assertEmbeddingMatchesSchema(vec, "RAG 查询向量");
  return vec;
}

async function embedDocumentsUnified(texts: string[]): Promise<number[][]> {
  const { multimodalUrl } = getEmbeddingConfig();
  let vectors: number[][];
  if (multimodalUrl) {
    vectors = await arkMultimodalEmbedMany(texts);
  } else {
    const emb = createOpenAiCompatibleEmbeddings();
    vectors = await emb.embedDocuments(texts);
  }
  for (let i = 0; i < vectors.length; i++) {
    assertEmbeddingMatchesSchema(vectors[i]!, `RAG 索引向量 chunk ${i}`);
  }
  return vectors;
}

/** 用于验证当前 AI_MODEL_EMBEDDING + BaseURL 是否可用（不写入数据库） */
export async function smokeTestEmbedding(): Promise<{
  ok: boolean;
  model: string;
  mode: "multimodal" | "openai_compatible";
  endpoint: string;
  dimension?: number;
  expectedDim?: number;
  error?: string;
}> {
  try {
    const cfg = getEmbeddingConfig();
    const vec = await (async () => {
      if (cfg.multimodalUrl) {
        return arkMultimodalEmbed("NexMind embedding 连通性测试");
      }
      const emb = createOpenAiCompatibleEmbeddings();
      return emb.embedQuery("NexMind embedding 连通性测试");
    })();
    const expected = getExpectedEmbeddingDim();
    const mismatch = vec.length !== expected;
    return {
      ok: !mismatch,
      model: cfg.model,
      mode: cfg.multimodalUrl ? "multimodal" : "openai_compatible",
      endpoint: cfg.multimodalUrl || `${cfg.openAiBaseURL}/embeddings`,
      dimension: vec.length,
      expectedDim: expected,
      ...(mismatch
        ? {
            error: `接口返回向量维度为 ${vec.length}，与 AI_EMBEDDING_DIMENSION=${expected} 不一致。请在 .env 中设置 AI_EMBEDDING_DIMENSION=${vec.length} 后重启。`,
          }
        : {}),
    };
  } catch (e) {
    const mm = getMultimodalEmbeddingUrl();
    return {
      ok: false,
      model: process.env.AI_MODEL_EMBEDDING || process.env.AI_MODEL_SEARCH || "",
      mode: mm ? "multimodal" : "openai_compatible",
      endpoint: mm || `${process.env.AI_API_BASE_URL || ""}/embeddings`,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function indexNoteForRag(params: {
  userId: string;
  noteId: string;
  title: string;
  content: string;
}): Promise<{ chunks: number }> {
  await ensureRagSchema();

  // 先清掉旧索引，保证更新内容后检索一致
  await prisma.$executeRawUnsafe(`DELETE FROM note_chunks WHERE user_id = $1 AND note_id = $2`, params.userId, params.noteId);

  const textBase = stripHtmlToText(params.content);
  const fullText = `${params.title}\n\n${textBase}`.trim();

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 700,
    chunkOverlap: 120,
  });
  const docs = await splitter.createDocuments([fullText]);
  const chunks = docs.map((d) => d.pageContent.trim()).filter(Boolean).slice(0, 60);

  if (!chunks.length) return { chunks: 0 };

  const vectors = await embedDocumentsUnified(chunks);
  const dim = getExpectedEmbeddingDim();

  for (let i = 0; i < chunks.length; i++) {
    const id = `${params.noteId}:${i}`;
    const embeddingSql = pgvector.toSql(vectors[i] as number[]);
    await prisma.$executeRawUnsafe(
      `INSERT INTO note_chunks (id, user_id, note_id, chunk_index, content, embedding)
       VALUES ($1, $2, $3, $4, $5, $6::vector(${dim}))`,
      id,
      params.userId,
      params.noteId,
      i,
      chunks[i],
      embeddingSql
    );
  }

  return { chunks: chunks.length };
}

export async function ragSearch(params: {
  userId: string;
  query: string;
  topK?: number;
  /** 限定只在该笔记的 chunk 中检索（工作台「选中笔记对话」） */
  noteId?: string;
}): Promise<RagHit[]> {
  await ensureRagSchema();

  const q = params.query.trim();
  if (!q) return [];

  const qVec = await embedQueryUnified(q);
  const qSql = pgvector.toSql(qVec as number[]);
  const topK = Math.max(1, Math.min(10, params.topK ?? 3));
  const dim = getExpectedEmbeddingDim();

  const noteId = params.noteId?.trim();

  const rows = noteId
    ? ((await prisma.$queryRawUnsafe(
        `
      SELECT
        nc.note_id as "noteId",
        nc.id as "chunkId",
        nc.chunk_index as "chunkIndex",
        nc.content as "content",
        (nc.embedding <=> ($1::vector(${dim}))) as "distance",
        n.title as "noteTitle"
      FROM note_chunks nc
      JOIN "Note" n ON n.id = nc.note_id
      WHERE nc.user_id = $2 AND n.archived = false AND nc.note_id = $4
      ORDER BY nc.embedding <=> ($1::vector(${dim}))
      LIMIT $3
    `,
        qSql,
        params.userId,
        topK,
        noteId
      )) as RagHit[])
    : ((await prisma.$queryRawUnsafe(
        `
      SELECT
        nc.note_id as "noteId",
        nc.id as "chunkId",
        nc.chunk_index as "chunkIndex",
        nc.content as "content",
        (nc.embedding <=> ($1::vector(${dim}))) as "distance",
        n.title as "noteTitle"
      FROM note_chunks nc
      JOIN "Note" n ON n.id = nc.note_id
      WHERE nc.user_id = $2 AND n.archived = false
      ORDER BY nc.embedding <=> ($1::vector(${dim}))
      LIMIT $3
    `,
        qSql,
        params.userId,
        topK
      )) as RagHit[]);

  return rows ?? [];
}

