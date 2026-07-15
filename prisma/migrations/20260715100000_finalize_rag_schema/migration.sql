-- Production RAG schema for the configured 1024-dimensional embedding model.
-- Future dimension changes require an explicit migration and index rebuild.
ALTER TABLE note_chunks
  ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024);

ALTER TABLE source_embedding_chunks
  ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024);

CREATE INDEX IF NOT EXISTS note_chunks_embedding_hnsw_idx
  ON note_chunks USING hnsw (embedding vector_cosine_ops);

CREATE INDEX IF NOT EXISTS source_embedding_chunks_embedding_hnsw_idx
  ON source_embedding_chunks USING hnsw (embedding vector_cosine_ops);
