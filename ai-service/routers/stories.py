from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from services.rag_service import RAGService
from services.llm_service import LLMService
from services.document_parser import parse_document

router = APIRouter()
rag_service = RAGService()
llm_service = LLMService()


class GenerateStoriesRequest(BaseModel):
    project_id: str
    project_name: str
    module_name: str
    document_id: Optional[str] = None
    additional_context: Optional[str] = None
    budget: Optional[float] = None
    deadline: Optional[str] = None
    ai_config: Optional[Dict[str, Any]] = None


class SuggestStoriesRequest(BaseModel):
    project_id: str
    project_name: str
    module_name: str
    user_input: Optional[str] = None
    context_graph: Dict[str, Any]
    ai_config: Optional[Dict[str, Any]] = None


class ExtractRequirementsRequest(BaseModel):
    project_id: str
    document_id: str
    file_path: str
    file_type: str
    ai_config: Optional[Dict[str, Any]] = None


class SuggestAction(BaseModel):
    title: str
    type: str
    priority: str
    module: str
    reason: str


@router.post("/generate")
async def generate_stories(req: GenerateStoriesRequest):
    """RAG-based story generation: retrieve context from KB → LLM → structured JSON."""

    # Retrieve relevant chunks from vector store
    context_chunks = rag_service.retrieve(
        query=req.module_name,
        project_id=req.project_id,
        top_k=int(__import__('os').getenv('TOP_K_RETRIEVAL', 5)),
    )

    context_text = "\n\n".join(context_chunks) if context_chunks else ""

    # Build prompt
    budget_info = f"Budget: ${req.budget:,.0f}" if req.budget else ""
    deadline_info = f"Deadline: {req.deadline}" if req.deadline else ""
    constraints = f"\n{budget_info}\n{deadline_info}".strip()

    # Generate via LLM
    result = llm_service.generate_stories(
        project_name=req.project_name,
        module_name=req.module_name,
        context=context_text,
        additional_context=req.additional_context or "",
        constraints=constraints,
        ai_config=req.ai_config,
    )

    return {"success": True, **result}


@router.post("/extract-requirements")
async def extract_requirements(req: ExtractRequirementsRequest):
    try:
        text = parse_document(req.file_path, req.file_type)
    except Exception as err:
        raise HTTPException(status_code=400, detail=f"Failed to parse SRS: {str(err)}")

    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from document")

    try:
        extracted = llm_service.extract_requirements(
            text=text,
            ai_config=req.ai_config,
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Requirement extraction failed: {str(err)}")

    return {"success": True, **extracted}


@router.post("/suggest")
async def suggest_stories(req: SuggestStoriesRequest):
    try:
        suggestions = llm_service.suggest_phase_actions(
            project_name=req.project_name,
            module_name=req.module_name,
            user_input=req.user_input or "",
            phase=req.context_graph.get("phase", "start"),
            modules=req.context_graph.get("modules", []),
            functional_requirements=req.context_graph.get("functional", []),
            non_functional_requirements=req.context_graph.get("nonFunctional", []),
            actors=req.context_graph.get("actors", []),
            existing_work=req.context_graph.get("existingStories", []),
            ai_config=req.ai_config,
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Suggest generation failed: {str(err)}")

    return {"success": True, "suggestions": suggestions}
