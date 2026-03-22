from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from services.rag_service import RAGService
from services.llm_service import LLMService

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


@router.post("/suggest")
async def suggest_stories(req: SuggestStoriesRequest):
    suggestions = llm_service.suggest_planner_prompts(
        project_name=req.project_name,
        module_name=req.module_name,
        user_input=req.user_input or "",
        context_graph=req.context_graph,
        ai_config=req.ai_config,
    )
    return {"success": True, "suggestions": suggestions}
