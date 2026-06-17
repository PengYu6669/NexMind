-- RAG hybrid search: FTS + trigram + pgvector
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE note_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS note_chunks_search_vector_idx ON note_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS note_chunks_content_trgm_idx ON note_chunks USING GIN (content gin_trgm_ops);

ALTER TABLE source_embedding_chunks
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', COALESCE(content, ''))) STORED;

CREATE INDEX IF NOT EXISTS source_embedding_chunks_search_vector_idx ON source_embedding_chunks USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS source_embedding_chunks_content_trgm_idx ON source_embedding_chunks USING GIN (content gin_trgm_ops);
