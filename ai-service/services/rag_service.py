import os
import logging
from typing import List, Dict, Any
from services.embeddings import EmbeddingService

logger = logging.getLogger(__name__)


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
            logger.info(f"[RAG] retrieve: query='{query}', project_id={project_id}, top_k={top_k}")
            persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
            client = _get_chroma_client(persist_dir)

            # Find all collections with this project_id
            all_collections = client.list_collections()
            logger.debug(f"[RAG] Total collections: {len(all_collections)}")
            
            project_collections = [
                c for c in all_collections
                if project_id.replace("-", "_") in c.name
            ]
            logger.info(f"[RAG] Project collections for {project_id}: {len(project_collections)}")

            if not project_collections:
                logger.warning(f"[RAG] No collections found for project {project_id}")
                return []

            all_chunks = []
            for collection_info in project_collections:
                logger.debug(f"[RAG] Querying collection {collection_info.name}")
                chunks = self.embedding_service.query(
                    query_text=query,
                    namespace=collection_info.name,
                    top_k=top_k,
                )
                logger.debug(f"[RAG] Retrieved {len(chunks)} chunks from {collection_info.name}")
                all_chunks.extend(chunks)

            # Return unique top chunks
            seen = set()
            unique_chunks = []
            for chunk in all_chunks:
                if chunk not in seen:
                    seen.add(chunk)
                    unique_chunks.append(chunk)

            result = unique_chunks[:top_k]
            logger.info(f"[RAG] retrieve: returning {len(result)} chunks")
            if result:
                logger.debug(f"[RAG] First chunk: {result[0][:100]}...")
            return result

        except Exception as e:
            logger.error(f"RAG retrieve error: {e}", exc_info=True)
            return []

    def get_chunks_by_ids(self, project_id: str, requirement_ids: List[str], top_k_per_id: int = 2) -> List[str]:
        """Fetch targeted chunks by requirement_id metadata for a given project."""
        if not requirement_ids:
            logger.warning(f"get_chunks_by_ids: requirement_ids is empty")
            return []

        try:
            persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
            client = _get_chroma_client(persist_dir)

            all_collections = client.list_collections()
            logger.info(f"[RAG] Total collections in store: {len(all_collections)}")
            logger.debug(f"[RAG] Collection names: {[c.name for c in all_collections]}")
            
            project_collections = [
                c for c in all_collections
                if project_id.replace("-", "_") in c.name
            ]
            logger.info(f"[RAG] Project collections for {project_id}: {len(project_collections)}")
            logger.debug(f"[RAG] Project collection names: {[c.name for c in project_collections]}")
            
            if not project_collections:
                logger.warning(f"[RAG] No collections found for project_id={project_id}")
                return []

            collected = []
            total_queried = 0
            for collection_info in project_collections:
                collection = self.embedding_service._get_chroma_collection(collection_info.name)
                count = collection.count()
                logger.info(f"[RAG] Collection {collection_info.name}: {count} total chunks")
                
                if count == 0:
                    logger.warning(f"[RAG] Collection {collection_info.name} is empty")
                    continue

                for req_id in requirement_ids:
                    logger.debug(f"[RAG] Querying requirement_id={req_id} in {collection_info.name}")
                    result = collection.query(
                        query_texts=[f"Requirement {req_id}"],
                        n_results=min(max(1, top_k_per_id), count),
                        where={"requirement_id": str(req_id).upper()},
                    )
                    docs = result.get("documents", [[]])[0]
                    logger.info(f"[RAG] Requirement {req_id}: {len(docs)} chunks retrieved")
                    if docs:
                        logger.debug(f"[RAG] First doc for {req_id}: {docs[0][:150]}...")
                    collected.extend(docs)
                    total_queried += 1

            logger.info(f"[RAG] Total collected: {len(collected)} chunks from {total_queried} queries")
            
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
            logger.warning(f"get_chunks_by_refs: chunk_refs is empty")
            return []

        try:
            logger.info(f"[RAG] get_chunks_by_refs: {len(chunk_refs)} chunk references")
            persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
            client = _get_chroma_client(persist_dir)

            all_collections = client.list_collections()
            project_collections = [
                c for c in all_collections
                if project_id.replace("-", "_") in c.name
            ]
            logger.info(f"[RAG] Found {len(project_collections)} project collections")
            
            if not project_collections:
                logger.warning(f"[RAG] No project collections found for {project_id}")
                return []

            collected = []
            for collection_info in project_collections:
                collection = self.embedding_service._get_chroma_collection(collection_info.name)
                count = collection.count()
                logger.debug(f"[RAG] Collection {collection_info.name}: {count} total chunks")
                
                if count == 0:
                    continue

                ids = []
                for ref in chunk_refs:
                    chunk_id = str(ref.get("chunk_id") or "").strip()
                    if chunk_id:
                        ids.append(chunk_id)

                logger.debug(f"[RAG] Looking up {len(ids)} chunk IDs")
                if not ids:
                    logger.warning(f"[RAG] No valid chunk IDs extracted from refs")
                    continue

                result = collection.get(ids=ids)
                docs = result.get("documents", [])
                logger.info(f"[RAG] Retrieved {len(docs)} documents for {len(ids)} chunk IDs")
                
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
            
            logger.info(f"[RAG] get_chunks_by_refs: returning {len(unique)} unique chunks")
            return unique

        except Exception as e:
            logger.error(f"RAG exact ref retrieval error: {e}", exc_info=True)
            return []
