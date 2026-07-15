-- FTS 中文分词：将 search_vector 从 GENERATED 列改为手动维护，
-- 以便写入前用 Intl.Segmenter 做中文分词后再存入 tsvector。
-- 同时新增 search_text 列存储分词后文本，便于调试和重建索引。

-- note_chunks: 重建 search_vector
DROP INDEX IF EXISTS note_chunks_search_vector_idx;
ALTER TABLE note_chunks DROP COLUMN IF EXISTS search_vector;
ALTER TABLE note_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE note_chunks ADD COLUMN IF NOT EXISTS search_text TEXT;
CREATE INDEX IF NOT EXISTS note_chunks_search_vector_idx ON note_chunks USING GIN (search_vector);

-- source_embedding_chunks: 重建 search_vector
DROP INDEX IF EXISTS source_embedding_chunks_search_vector_idx;
ALTER TABLE source_embedding_chunks DROP COLUMN IF EXISTS search_vector;
ALTER TABLE source_embedding_chunks ADD COLUMN IF NOT EXISTS search_vector tsvector;
ALTER TABLE source_embedding_chunks ADD COLUMN IF NOT EXISTS search_text TEXT;
CREATE INDEX IF NOT EXISTS source_embedding_chunks_search_vector_idx ON source_embedding_chunks USING GIN (search_vector);
