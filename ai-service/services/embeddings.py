import os
from typing import List, Dict, Any


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into overlapping chunks by approximate token count (4 chars ≈ 1 token)."""
    char_size = chunk_size * 4
    char_overlap = overlap * 4
    chunks = []
    start = 0
    while start < len(text):
        end = start + char_size
        chunks.append(text[start:end].strip())
        start += char_size - char_overlap
    return [c for c in chunks if c]


class EmbeddingService:
    """
    Uses ChromaDB's built-in local ONNX embedding model (all-MiniLM-L6-v2).
    Completely FREE — runs on your machine, no API key required.
    """
    def __init__(self):
        self._collection_cache = {}
        self._ef = None
        self.model_name = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
        self.model_provider = os.getenv("EMBEDDING_PROVIDER", "sentence-transformers").lower()

    def _get_ef(self):
        """Lazy-load embedding function with model-first strategy and safe fallback."""
        if self._ef is None:
            from chromadb.utils.embedding_functions import (
                DefaultEmbeddingFunction,
                SentenceTransformerEmbeddingFunction,
            )

            # Handle local-onnx and sentence-transformers models
            if self.model_name == "local-onnx" or self.model_provider in ("sentence-transformers", "sentence_transformers", "st"):
                try:
                    # For local-onnx or sentence-transformers, use the default local model
                    if self.model_name == "local-onnx":
                        self._ef = DefaultEmbeddingFunction()
                    else:
                        self._ef = SentenceTransformerEmbeddingFunction(model_name=self.model_name)
                except Exception as e:
                    print(f"Warning: Failed to load {self.model_name}, falling back to default: {e}")
                    self._ef = DefaultEmbeddingFunction()
            else:
                self._ef = DefaultEmbeddingFunction()
        return self._ef

    def _get_chroma_collection(self, namespace: str):
        if namespace in self._collection_cache:
            return self._collection_cache[namespace]

        import chromadb
        persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
        client = chromadb.PersistentClient(path=persist_dir)

        # Pass the local embedding function so ChromaDB handles everything
        collection = client.get_or_create_collection(
            name=namespace.replace("-", "_").replace(":", "_")[:60],
            embedding_function=self._get_ef(),
            metadata={"hnsw:space": "cosine"},
        )
        self._collection_cache[namespace] = collection
        return collection

    def ingest(self, text: str, namespace: str, metadata: Dict[str, Any]) -> Dict:
        chunk_size = int(os.getenv("CHUNK_SIZE", 500))
        chunk_overlap = int(os.getenv("CHUNK_OVERLAP", 50))

        chunks = chunk_text(text, chunk_size, chunk_overlap)
        if not chunks:
            return {"chunks": 0, "embeddings": 0}

        collection = self._get_chroma_collection(namespace)

        ids = [f"{namespace}-{i}" for i in range(len(chunks))]
        metadatas = [{**metadata, "chunk_index": i} for i in range(len(chunks))]

        # ChromaDB embeds locally — no API call
        collection.upsert(
            ids=ids,
            documents=chunks,
            metadatas=metadatas,
        )

        return {"chunks": len(chunks), "embeddings": len(chunks)}

    def query(self, query_text: str, namespace: str, top_k: int = 5) -> List[str]:
        """Retrieve top-k relevant chunks for a query using local embeddings."""
        collection = self._get_chroma_collection(namespace)
        count = collection.count()
        if count == 0:
            return []

        results = collection.query(
            query_texts=[query_text],
            n_results=min(top_k, count),
        )
        return results.get("documents", [[]])[0]
