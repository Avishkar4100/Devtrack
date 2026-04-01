import os
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routers import documents, stories, github_analysis, jira
from services.embeddings import EmbeddingService

app = FastAPI(
    title="DevTrack AI Microservice",
    description="AI-powered story generation, document ingestion, and code analysis service",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5000", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize embedding service globally for health checks
_embedding_service = None
def get_embedding_service():
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService()
    return _embedding_service

app.include_router(documents.router, prefix="/documents", tags=["Documents"])
app.include_router(stories.router, prefix="/stories", tags=["Stories"])
app.include_router(github_analysis.router, prefix="/github", tags=["GitHub Analysis"])
app.include_router(jira.router, prefix="/jira", tags=["Jira"])


@app.get("/")
async def root():
    return {"status": "OK", "service": "DevTrack AI Service", "version": "1.0.0"}


@app.get("/health")
async def health():
    """Basic health check with Chroma and embedding model verification."""
    health_status = {
        "status": "healthy",
        "llm_model": os.getenv("LLM_MODEL", "deepseek-chat"),
        "embedding_model": os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5"),
        "chroma_dir": os.getenv("CHROMA_PERSIST_DIR", "./chroma_store"),
    }
    
    try:
        # Test Chroma connection and embedding function
        es = get_embedding_service()
        
        # Try to load the embedding function
        ef = es._get_ef()
        health_status["embedding_function"] = "initialized"
        
        # Test with a simple query
        test_namespace = "health_check"
        test_collection = es._get_chroma_collection(test_namespace)
        health_status["chroma_collection"] = "accessible"
        health_status["collection_count"] = test_collection.count()
        
        # Try a test embedding if collection has data
        if test_collection.count() > 0:
            query_result = es.query("test", test_namespace, top_k=1)
            health_status["query_test"] = "success"
        else:
            health_status["query_test"] = "skipped_empty_collection"
        
    except Exception as e:
        health_status["status"] = "degraded"
        health_status["chroma_error"] = str(e)
    
    return health_status


@app.get("/health/detailed")
async def health_detailed():
    """Detailed health check with Chroma status and statistics."""
    details = {
        "llm": os.getenv("LLM_MODEL", "not configured"),
        "embedding": os.getenv("EMBEDDING_MODEL", "not configured"),
        "chroma_persist_dir": os.getenv("CHROMA_PERSIST_DIR", "./chroma_store"),
        "collections": [],
        "errors": [],
    }
    
    try:
        import chromadb
        persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
        
        if not os.path.exists(persist_dir):
            os.makedirs(persist_dir, exist_ok=True)
            details["note"] = "Chroma directory created"
        
        client = chromadb.PersistentClient(path=persist_dir)
        collections = client.list_collections()
        
        for col in collections:
            details["collections"].append({
                "name": col.name,
                "count": col.count() if hasattr(col, 'count') else "unknown",
            })
        
        # Test embedding model
        es = get_embedding_service()
        ef = es._get_ef()
        
        # Verify it can create embeddings
        test_embedding = ef(["test sentence"])
        details["embedding_test"] = {
            "success": True,
            "embedding_dimension": len(test_embedding[0]) if test_embedding else 0,
        }
        
    except Exception as e:
        details["errors"].append(str(e))
    
    return details


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    return JSONResponse(
        status_code=500,
        content={"success": False, "message": str(exc)},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
