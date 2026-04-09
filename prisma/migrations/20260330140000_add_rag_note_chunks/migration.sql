-- RAG：笔记向量切片表（与 lib/rag.ts ensureRagSchema 一致，纳入迁移历史以消除 drift）
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS note_chunks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    note_id TEXT NOT NULL,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    embedding vector NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS note_chunks_user_id_idx ON note_chunks (user_id);
CREATE INDEX IF NOT EXISTS note_chunks_note_id_idx ON note_chunks (note_id);

-- HNSW 依赖 pgvector 与向量维度；由 lib/rag.ts ensureRagSchema() 在运行时按需创建，避免 shadow DB 校验失败
