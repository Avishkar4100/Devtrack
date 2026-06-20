import os
import logging
from dotenv import load_dotenv
load_dotenv()

# Force-disable Chroma telemetry before any Chroma client import/initialization.
os.environ.setdefault("ANONYMIZED_TELEMETRY", "FALSE")

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from routers import documents, stories, github_analysis, jira, manual_bridge
from services.embeddings import EmbeddingService

logger = logging.getLogger(__name__)
logging.getLogger("chromadb.telemetry").setLevel(logging.CRITICAL)
logging.getLogger("chromadb.telemetry.product").setLevel(logging.CRITICAL)
logging.getLogger("chromadb.telemetry.product.posthog").setLevel(logging.CRITICAL)

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
app.include_router(manual_bridge.router, prefix="/manual-bridge", tags=["Manual Bridge"])


@app.get("/")
async def root():
    return {"status": "OK", "service": "DevTrack AI Service", "version": "1.0.0"}


@app.get("/health")
async def health():
    """Basic health check with Chroma and embedding model verification."""
    health_status = {
        "status": "healthy",
        "llm_model": os.getenv("LLM_MODEL", "deepseek-v4-flash"),
        "embedding_model": os.getenv("EMBEDDING_MODEL", "local-onnx"),
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
        from chromadb.config import Settings
        persist_dir = os.getenv("CHROMA_PERSIST_DIR", "./chroma_store")
        
        if not os.path.exists(persist_dir):
            os.makedirs(persist_dir, exist_ok=True)
            details["note"] = "Chroma directory created"
        
        client = chromadb.PersistentClient(
            path=persist_dir,
            settings=Settings(anonymized_telemetry=False),
        )
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
async def global_exception_handler(request: Request, exc: Exception):
    request_id = request.headers.get("x-request-id")
    logger.exception(
        "Unhandled AI service error request_id=%s method=%s path=%s",
        request_id,
        request.method,
        request.url.path,
    )

    message = str(exc or '').strip()
    lower_message = message.lower()

    if 'api key' in lower_message:
        public_message = 'AI provider API key is not configured. Update AI settings and try again.'
    elif 'rate limit' in lower_message or '429' in lower_message:
        public_message = 'AI provider rate limit reached. Please retry shortly.'
    elif 'invalid json' in lower_message:
        public_message = 'AI provider returned an invalid structured response. Please retry.'
    elif 'unsupported file type' in lower_message:
        public_message = message
    elif 'file not found' in lower_message:
        public_message = message
    elif isinstance(exc, (ValueError, RuntimeError)) and message:
        public_message = message[:260]
    else:
        public_message = 'AI service failed to process the request.'

    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "message": public_message,
            "errorCode": "AI_INTERNAL_ERROR",
            "requestId": request_id,
        },
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    request_id = request.headers.get("x-request-id")

    details = []
    for item in exc.errors():
        loc = '.'.join(str(part) for part in item.get('loc', []) if part != 'body')
        msg = item.get('msg', 'Invalid value')
        details.append(f"{loc}: {msg}" if loc else msg)

    message = ', '.join(details[:5]) if details else 'Request validation failed'

    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "message": message,
            "detail": details,
            "errorCode": "AI_VALIDATION_ERROR",
            "requestId": request_id,
        },
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 8000)), reload=True)
