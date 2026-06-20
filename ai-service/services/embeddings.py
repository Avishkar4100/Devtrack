import os
import re
from typing import List, Dict, Any


def _get_chroma_client(persist_dir: str):
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "FALSE")
    import chromadb
    from chromadb.config import Settings

    return chromadb.PersistentClient(
        path=persist_dir,
        settings=Settings(anonymized_telemetry=False),
    )


def split_sections(text: str) -> List[Dict[str, str]]:
    """Split text by markdown/numbered headings and keep section labels."""
    if not text or not text.strip():
        return []

    lines = text.splitlines()
    heading_re = re.compile(r"^\s*(#{1,6}\s+.+|\d+(?:\.\d+){0,3}\s+.+)\s*$")
    sections: List[Dict[str, str]] = []
    current_heading = "Preamble"
    current_lines: List[str] = []

    for line in lines:
        if heading_re.match(line):
            body = "\n".join(current_lines).strip()
            if body:
                sections.append({"heading": current_heading, "text": body})
            current_heading = line.strip().lstrip("#").strip()
            current_lines = []
        else:
            current_lines.append(line)

    tail = "\n".join(current_lines).strip()
    if tail:
        sections.append({"heading": current_heading, "text": tail})

    return sections or [{"heading": "Document", "text": text.strip()}]


def extract_requirement_ids(text: str) -> List[str]:
    """Extract requirement-like IDs such as FR-AUTH-001, NFR-SEC-01, FR-1."""
    pattern = re.compile(r"\b(?:FR|NFR)(?:-[A-Z0-9]+)*-\d{1,4}\b", re.IGNORECASE)
    ids = [m.group(0).upper() for m in pattern.finditer(text or "")]
    seen = set()
    ordered = []
    for req_id in ids:
        if req_id not in seen:
            seen.add(req_id)
            ordered.append(req_id)
    return ordered


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[Dict[str, Any]]:
    """Split text into heading-aware overlapping chunks and attach requirement IDs."""
    char_size = chunk_size * 4
    char_overlap = overlap * 4
    chunks: List[Dict[str, Any]] = []

    for section in split_sections(text):
        section_text = section.get("text", "")
        heading = section.get("heading", "Document")
        if not section_text:
            continue

        start = 0
        while start < len(section_text):
            end = start + char_size
            body = section_text[start:end].strip()
            if body:
                combined = f"[{heading}]\n{body}" if heading else body
                req_ids = extract_requirement_ids(combined)
                chunks.append({
                    "text": combined,
                    "heading": heading,
                    "requirement_ids": req_ids,
                })
            start += char_size - char_overlap

    return chunks


class EmbeddingService:
    """
    Uses ChromaDB's built-in local ONNX embedding model (all-MiniLM-L6-v2).
    Completely FREE — runs on your machine, no API key required.
    """
    def __init__(self):
        self._collection_cache = {}
        self._ef = None
        # Default to local ONNX to avoid first-run internet/model download stalls.
        self.model_name = os.getenv("EMBEDDING_MODEL", "local-onnx")
        self.model_provider = os.getenv("EMBEDDING_PROVIDER", "local-onnx").lower()

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

        persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
        client = _get_chroma_client(persist_dir)

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

        # Duplicate records per requirement ID so Chroma metadata filters can target exact IDs.
        docs = []
        ids = []
        metadatas = []

        for i, chunk in enumerate(chunks):
            chunk_text_value = chunk.get("text", "").strip()
            req_ids = chunk.get("requirement_ids") or []
            heading = chunk.get("heading") or ""

            if not chunk_text_value:
                continue

            if not req_ids:
                docs.append(chunk_text_value)
                ids.append(f"{namespace}-{i}")
                metadatas.append({
                    **metadata,
                    "chunk_index": i,
                    "chunk_heading": heading,
                    "requirement_id": "",
                    "requirement_ids_csv": "",
                    "requirement_ids_count": 0,
                })
                continue

            for ridx, req_id in enumerate(req_ids):
                docs.append(chunk_text_value)
                ids.append(f"{namespace}-{i}-rid-{ridx}")
                metadatas.append({
                    **metadata,
                    "chunk_index": i,
                    "chunk_heading": heading,
                    "requirement_id": req_id,
                    "requirement_ids_csv": ",".join(req_ids),
                    "requirement_ids_count": len(req_ids),
                })

        # ChromaDB embeds locally — no API call
        collection.upsert(
            ids=ids,
            documents=docs,
            metadatas=metadatas,
        )

        return {"chunks": len(chunks), "embeddings": len(docs)}

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
