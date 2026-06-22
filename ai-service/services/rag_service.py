import os
from typing import List, Dict, Any
from services.embeddings import EmbeddingService


def _get_chroma_client(persist_dir: str):
    os.environ.setdefault("ANONYMIZED_TELEMETRY", "FALSE")
    import chromadb
    from chromadb.config import Settings

    return chromadb.PersistentClient(
        path=persist_dir,
        settings=Settings(anonymized_telemetry=False),
    )


class RAGService:
    def __init__(self):
        self.embedding_service = EmbeddingService()

    def retrieve(self, query: str, project_id: str, top_k: int = 5) -> List[str]:
        """Retrieve relevant chunks from all namespaces for a project."""
        # Try to find project namespaces in ChromaDB
        try:
            persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
            client = _get_chroma_client(persist_dir)

            # Find all collections with this project_id
            all_collections = client.list_collections()
            project_collections = [
                c for c in all_collections
                if project_id.replace("-", "_") in c.name
            ]

            if not project_collections:
                return []

            all_chunks = []
            for collection_info in project_collections:
                chunks = self.embedding_service.query(
                    query_text=query,
                    namespace=collection_info.name,
                    top_k=top_k,
                )
                all_chunks.extend(chunks)

            # Return unique top chunks
            seen = set()
            unique_chunks = []
            for chunk in all_chunks:
                if chunk not in seen:
                    seen.add(chunk)
                    unique_chunks.append(chunk)

            return unique_chunks[:top_k]

        except Exception as e:
            print(f"RAG retrieve error: {e}")
            return []

    def get_chunks_by_ids(self, project_id: str, requirement_ids: List[str], top_k_per_id: int = 2) -> List[str]:
        """Fetch targeted chunks by requirement_id metadata for a given project."""
        if not requirement_ids:
            return []

        try:
            persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
            client = _get_chroma_client(persist_dir)

            all_collections = client.list_collections()
            project_collections = [
                c for c in all_collections
                if project_id.replace("-", "_") in c.name
            ]
            if not project_collections:
                return []

            collected = []
            for collection_info in project_collections:
                collection = self.embedding_service._get_chroma_collection(collection_info.name)
                count = collection.count()
                if count == 0:
                    continue

                for req_id in requirement_ids:
                    result = collection.query(
                        query_texts=[f"Requirement {req_id}"],
                        n_results=min(max(1, top_k_per_id), count),
                        where={"requirement_id": str(req_id).upper()},
                    )
                    docs = result.get("documents", [[]])[0]
                    collected.extend(docs)

            seen = set()
            unique = []
            for chunk in collected:
                if not chunk:
                    continue
                key = chunk.strip()
                if key in seen:
                    continue
                seen.add(key)
                unique.append(chunk)
            return unique

        except Exception as e:
            print(f"RAG targeted retrieval error: {e}")
            return []

    def get_chunks_by_refs(self, project_id: str, chunk_refs: List[Dict[str, Any]]) -> List[str]:
        """Fetch exact chunks by stored chunk refs for a given project."""
        if not chunk_refs:
            return []

        try:
            persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
            client = _get_chroma_client(persist_dir)

            all_collections = client.list_collections()
            project_collections = [
                c for c in all_collections
                if project_id.replace("-", "_") in c.name
            ]
            if not project_collections:
                return []

            collected = []
            for collection_info in project_collections:
                collection = self.embedding_service._get_chroma_collection(collection_info.name)
                count = collection.count()
                if count == 0:
                    continue

                ids = []
                for ref in chunk_refs:
                    chunk_id = str(ref.get("chunk_id") or "").strip()
                    if chunk_id:
                        ids.append(chunk_id)

                if not ids:
                    continue

                result = collection.get(ids=ids)
                docs = result.get("documents", [])
                if docs and isinstance(docs[0], list):
                    for doc_list in docs:
                        for doc in doc_list or []:
                            if doc:
                                collected.append(doc)
                else:
                    for doc in docs or []:
                        if doc:
                            collected.append(doc)

            seen = set()
            unique = []
            for chunk in collected:
                key = chunk.strip()
                if not key or key in seen:
                    continue
                seen.add(key)
                unique.append(chunk)
            return unique

        except Exception as e:
            print(f"RAG exact ref retrieval error: {e}")
            return []
