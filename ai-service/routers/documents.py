import os
import time
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.enhanced_document_parser import EnhancedDocumentParser
from services.embeddings import EmbeddingService

logger = logging.getLogger(__name__)
router = APIRouter()
embedding_service = EmbeddingService()


def _safe_error_text(err: Exception, fallback: str) -> str:
    text = str(err or '').strip()
    if not text:
        return fallback
    return text[:260] if len(text) > 260 else text


class IngestRequest(BaseModel):
    document_id: str
    file_path: str
    file_type: str
    namespace: str
    project_id: str


class IngestResponse(BaseModel):
    success: bool
    chunks: int
    embeddings: int
    processingTime: int
    parseMetadata: dict
    requirement_graph: list = []


@router.post("/ingest")
async def ingest_document(req: IngestRequest) -> IngestResponse:
    """
    Extract text from SRS document, chunk it, embed and store in vector DB.
    Enhanced with file type detection, validation, and detailed error reporting.
    """
    start = time.time()

    if not os.path.exists(req.file_path):
        raise HTTPException(status_code=404, detail=f"File not found: {req.file_path}")

    # Parse document with enhanced validation
    parse_result = EnhancedDocumentParser.parse_document(
        file_path=req.file_path,
        file_type=req.file_type,
        validate=True,
        check_magic=True
    )
    
    if not parse_result.success:
        logger.error(f"Document parsing failed for {req.document_id}: {parse_result.error}")
        raise HTTPException(
            status_code=400,
            detail=f"Could not parse document: {parse_result.error}"
        )
    
    text = parse_result.text
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="No extractable text found in document")

    # Chunk, embed, store
    try:
        result = embedding_service.ingest(
            text=text,
            namespace=req.namespace,
            metadata={
                "document_id": req.document_id,
                "project_id": req.project_id,
                "detected_type": parse_result.metadata.get("detected_type"),
                "word_count": parse_result.metadata.get("word_count"),
            },
        )
    except Exception as e:
        logger.error(f"Embedding failed for {req.document_id}: {e}")
        raise HTTPException(
            status_code=502,
            detail=f"Document ingestion failed: {_safe_error_text(e, 'Embedding service error')}"
        )

    elapsed = int((time.time() - start) * 1000)
    
    logger.info(
        f"Successfully ingested document {req.document_id}: "
        f"{result['chunks']} chunks, {result['embeddings']} embeddings, "
        f"{parse_result.metadata.get('word_count', 0)} words, {elapsed}ms"
    )

    return {
        "success": True,
        "chunks": result["chunks"],
        "embeddings": result["embeddings"],
        "processingTime": elapsed,
        "requirement_graph": result.get("requirement_graph", []),
        "parseMetadata": {
            "detectedType": parse_result.metadata.get("detected_type"),
            "detectionMethod": parse_result.metadata.get("detection_method"),
            "wordCount": parse_result.metadata.get("word_count"),
            "textLength": parse_result.metadata.get("text_length"),
            "validationPassed": parse_result.metadata.get("validation_passed"),
            "warnings": parse_result.metadata.get("warnings", []),
        },
    }
