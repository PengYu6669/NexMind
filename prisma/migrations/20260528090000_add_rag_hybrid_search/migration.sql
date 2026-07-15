-- RAG hybrid search: FTS + trigram + pgvector
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE note_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS note_chunks_search_vector_idx ON note_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS note_chunks_content_trgm_idx ON note_chunks USING GIN (content gin_trgm_ops);

-- Source chunks are created lazily by the runtime RAG bootstrap in older
-- installations. Create the table here so a clean migration can be applied
-- without depending on the application having started first.
CREATE TABLE IF NOT EXISTS source_embedding_chunks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding vector NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS source_embedding_chunks_user_id_idx ON source_embedding_chunks (user_id);
CREATE INDEX IF NOT EXISTS source_embedding_chunks_source_id_idx ON source_embedding_chunks (source_id);

ALTER TABLE source_embedding_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS source_embedding_chunks_search_vector_idx ON source_embedding_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS source_embedding_chunks_content_trgm_idx ON source_embedding_chunks USING GIN (content gin_trgm_ops);
