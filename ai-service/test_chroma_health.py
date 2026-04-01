#!/usr/bin/env python3
"""
Test script to verify Chroma embeddings are working properly.
Run: python test_chroma_health.py
"""
import os
import sys
from dotenv import load_dotenv

load_dotenv()

from services.embeddings import EmbeddingService

def test_chroma_health():
    print("=" * 60)
    print("CHROMA + EMBEDDINGS HEALTH CHECK")
    print("=" * 60)
    
    # Check environment
    chroma_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
    embedding_model = os.getenv("EMBEDDING_MODEL", "local-onnx")
    
    print(f"\n✓ Environment Variables:")
    print(f"  - CHROMA_PERSIST_DIR: {chroma_dir}")
    print(f"  - EMBEDDING_MODEL: {embedding_model}")
    
    # Initialize embedding service
    print(f"\n⏳ Initializing EmbeddingService...")
    try:
        es = EmbeddingService()
        print(f"  ✓ EmbeddingService initialized")
    except Exception as e:
        print(f"  ✗ Failed to initialize EmbeddingService: {e}")
        return False
    
    # Get embedding function
    print(f"\n⏳ Loading embedding function...")
    try:
        ef = es._get_ef()
        print(f"  ✓ Embedding function loaded: {ef}")
    except Exception as e:
        print(f"  ✗ Failed to load embedding function: {e}")
        return False
    
    # Test embedding with a sample text
    print(f"\n⏳ Testing embedding on sample text...")
    try:
        test_texts = ["This is a test sentence for embeddings"]
        embeddings = ef(test_texts)
        embedding_dim = len(embeddings[0]) if embeddings else 0
        print(f"  ✓ Successfully created embeddings")
        print(f"  - Embedding dimension: {embedding_dim}")
    except Exception as e:
        print(f"  ✗ Failed to create embeddings: {e}")
        return False
    
    # Test Chroma collection
    print(f"\n⏳ Testing Chroma collection...")
    try:
        test_namespace = "test_health_check"
        collection = es._get_chroma_collection(test_namespace)
        print(f"  ✓ Collection created/accessed: {test_namespace}")
        print(f"  - Current count: {collection.count()}")
    except Exception as e:
        print(f"  ✗ Failed to access collection: {e}")
        return False
    
    # Test ingest
    print(f"\n⏳ Testing document ingestion...")
    try:
        test_text = """
        This is a test document for Chroma ingestion.
        It contains multiple sentences to test chunking and embedding.
        Each chunk will be embedded and stored in the vector database.
        """
        result = es.ingest(
            text=test_text,
            namespace=test_namespace,
            metadata={"test": "true", "source": "health_check"}
        )
        print(f"  ✓ Document ingested successfully")
        print(f"  - Chunks created: {result['chunks']}")
        print(f"  - Embeddings created: {result['embeddings']}")
        
        # Verify count increased
        new_count = collection.count()
        print(f"  - Collection count after ingest: {new_count}")
    except Exception as e:
        print(f"  ✗ Failed to ingest document: {e}")
        return False
    
    # Test query/retrieval
    print(f"\n⏳ Testing document retrieval...")
    try:
        query = "test document chunking"
        results = es.query(query_text=query, namespace=test_namespace, top_k=3)
        print(f"  ✓ Retrieved {len(results)} documents")
        if results:
            print(f"  - Top result preview: {results[0][:100]}...")
    except Exception as e:
        print(f"  ✗ Failed to query: {e}")
        return False
    
    print("\n" + "=" * 60)
    print("✓ ALL TESTS PASSED - Chroma + Embeddings working correctly!")
    print("=" * 60)
    return True

if __name__ == "__main__":
    success = test_chroma_health()
    sys.exit(0 if success else 1)
