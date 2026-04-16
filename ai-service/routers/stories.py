from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import logging
import json
from services.rag_service import RAGService
from services.llm_service import LLMService
from services.enhanced_document_parser import EnhancedDocumentParser

logger = logging.getLogger(__name__)
router = APIRouter()
rag_service = RAGService()
llm_service = LLMService()


def _safe_error_text(err: Exception, fallback: str) -> str:
    text = str(err or '').strip()
    if not text:
        return fallback
    return text[:260] if len(text) > 260 else text


class GenerateStoriesRequest(BaseModel):
    project_id: str
    project_name: str
    module_name: str
    document_id: Optional[str] = None
    additional_context: Optional[str] = None
    budget: Optional[float] = None
    deadline: Optional[str] = None
    team_members: Optional[List[Dict[str, Any]]] = None
    ai_config: Optional[Dict[str, Any]] = None


class SuggestStoriesRequest(BaseModel):
    project_id: str
    project_name: str
    module_name: str
    user_input: Optional[str] = None
    context_graph: Dict[str, Any] = {}
    fetched_chunks: Optional[List[str]] = None
    project_state: Optional[Dict[str, Any]] = None
    ai_config: Optional[Dict[str, Any]] = None


class DiscoverGapsRequest(BaseModel):
    project_id: str
    module_name: str
    user_input: Optional[str] = None
    requirement_map: Dict[str, Any]
    project_state: Dict[str, Any]
    completed_jira_ids: Optional[List[str]] = None
    ai_config: Optional[Dict[str, Any]] = None


class ChunksByIdsRequest(BaseModel):
    project_id: str
    requirement_ids: List[str]
    top_k_per_id: Optional[int] = 2


class ExtractRequirementsRequest(BaseModel):
    project_id: str
    document_id: str
    file_path: str
    file_type: str
    ai_config: Optional[Dict[str, Any]] = None


class StandupSummaryRequest(BaseModel):
    prompt: str
    ai_config: Optional[Dict[str, Any]] = None


class SuggestAction(BaseModel):
    title: str
    type: str
    priority: str
    module: str
    reason: str


async def _extract_technical_tasks(srs_context: str, project_state_md: str) -> str:
    """Step 1 (Brain): extract only actionable technical tasks as a plain bullet list."""
    prompt = f"""You are a senior technical architect.

Read the SRS context and project state below. Output ONLY a plain-text bulleted list of actionable technical tasks.

Requirements:
- Output format MUST be plain text bullets, one task per line, each line starting with '- '.
- Include only concrete technical implementation tasks.
- Do not include JSON, markdown code fences, explanations, or section headings.
- Do not include generic filler tasks like optimize/refactor/improve unless explicitly required by context.
- Each bullet should be concise and engineering-executable.

SRS Context:
{srs_context or 'N/A'}

Project State:
{project_state_md or 'N/A'}
"""

    raw = llm_service._call_llm(
        prompt,
        temperature=0.2,
        ai_config=None,
        operation="extract_technical_tasks",
    ).strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("text"):
            raw = raw[4:]

    lines = [line.strip() for line in raw.splitlines() if line.strip()]
    normalized = []
    for line in lines:
        normalized.append(line if line.startswith('- ') else f"- {line.lstrip('- ').strip()}")

    return "\n".join(normalized)


async def _format_to_jira_schema(bulleted_tasks: str) -> List[Dict[str, Any]]:
    """Step 2 (Secretary): convert bullet tasks into strict Jira-like JSON rows."""
    prompt = f"""You are a Jira backlog formatter.

Convert the bulleted technical task list into a JSON array where each item matches this exact field schema:
- Summary (string)
- Description (string)
- Acceptance Criteria (array of strings)

Rules:
- Return ONLY valid JSON array.
- Do not include markdown or code fences.
- Keep each Summary short and specific.
- Description should be implementation-focused.
- Acceptance Criteria should be testable and concrete.

Bulleted Tasks:
{bulleted_tasks or '- No tasks provided'}
"""

    raw = llm_service._call_llm(
        prompt,
        temperature=0.1,
        ai_config=None,
        operation="format_to_jira_schema",
    ).strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        parsed = json.loads(raw)
    except Exception:
        raise ValueError("LLM returned invalid JSON while formatting Jira schema")

    if not isinstance(parsed, list):
        raise ValueError("LLM returned non-array response for Jira schema formatting")

    normalized = []
    for row in parsed:
        if not isinstance(row, dict):
            continue
        summary = str(row.get('Summary', '')).strip()
        description = str(row.get('Description', '')).strip()
        acceptance = row.get('Acceptance Criteria', [])
        if not isinstance(acceptance, list):
            acceptance = [str(acceptance).strip()] if str(acceptance).strip() else []

        if not summary:
            continue

        normalized.append({
            'Summary': summary,
            'Description': description,
            'Acceptance Criteria': [str(item).strip() for item in acceptance if str(item).strip()],
        })

    return normalized


async def _critic_review(generated_jira_json: list, srs_context: str) -> Dict[str, Any]:
    """Step 3 (Critic): strict QA review before downstream Jira operations."""
    prompt = f"""You are a strict QA engineer performing a release gate review.

Evaluate whether the generated Jira JSON items actually satisfy the SRS context and contain testable acceptance criteria.

Review criteria:
- Coverage: key SRS scope is represented.
- Specificity: items are concrete and implementation-ready.
- Testability: Acceptance Criteria are measurable/testable.
- Quality: no vague placeholders or duplicated generic work.

Return ONLY valid JSON object with EXACT shape:
{{"approved": boolean, "feedback": string}}

SRS Context:
{srs_context or 'N/A'}

Generated Jira JSON:
{json.dumps(generated_jira_json or [], ensure_ascii=False)}
"""

    raw = llm_service._call_llm(
        prompt,
        temperature=0.1,
        ai_config=None,
        operation="critic_review",
    ).strip()

    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]

    try:
        parsed = json.loads(raw)
    except Exception:
        raise ValueError("LLM returned invalid JSON for critic review")

    if not isinstance(parsed, dict):
        raise ValueError("LLM returned non-object response for critic review")

    approved = bool(parsed.get('approved', False))
    feedback = str(parsed.get('feedback', '')).strip() or 'No feedback provided by critic'
    return {'approved': approved, 'feedback': feedback}


@router.post("/generate")
async def generate_stories(req: GenerateStoriesRequest):
    """RAG-based story generation: retrieve context from KB → LLM → structured JSON."""
    try:
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
            team_members_json=json.dumps(req.team_members or [], ensure_ascii=False),
            ai_config=req.ai_config,
        )

        return {"success": True, **result}
    except Exception as err:
        logger.error("Story generation failed for project %s module %s: %s", req.project_id, req.module_name, err)
        raise HTTPException(status_code=502, detail=f"Story generation failed: {_safe_error_text(err, 'LLM request failed')}")


@router.post("/extract-requirements")
async def extract_requirements(req: ExtractRequirementsRequest):
    """Extract functional/non-functional requirements from SRS document."""
    
    # Parse document with validation and magic number detection
    parse_result = EnhancedDocumentParser.parse_document(
        file_path=req.file_path,
        file_type=req.file_type,
        validate=True,
        check_magic=True
    )
    
    if not parse_result.success:
        logger.error(f"Document parsing failed: {parse_result.error}")
        raise HTTPException(
            status_code=400,
            detail=f"Failed to parse SRS: {parse_result.error}"
        )
    
    text = parse_result.text
    if not text or not text.strip():
        raise HTTPException(status_code=400, detail="Could not extract text from document")

    try:
        extracted = llm_service.extract_requirements(
            text=text,
            ai_config=req.ai_config,
        )
        logger.info(
            f"Successfully extracted requirements from {req.document_id}: "
            f"{len(extracted.get('functional_requirements', []))} functional, "
            f"{len(extracted.get('non_functional_requirements', []))} non-functional, "
            f"{len(extracted.get('modules', []))} modules, "
            f"{len(extracted.get('actors', []))} actors"
        )
    except Exception as err:
        logger.error(f"Requirement extraction failed: {err}")
        raise HTTPException(status_code=502, detail=f"Requirement extraction failed: {_safe_error_text(err, 'LLM extraction failed')}")

    return {
        "success": True,
        **extracted,
        "parseMetadata": {
            "detectedType": parse_result.metadata.get("detected_type"),
            "detectionMethod": parse_result.metadata.get("detection_method"),
            "wordCount": parse_result.metadata.get("word_count"),
            "validationPassed": parse_result.metadata.get("validation_passed"),
            "warnings": parse_result.metadata.get("warnings", []),
        },
    }


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
            fetched_chunks=req.fetched_chunks or [],
            project_state=req.project_state or {},
            ai_config=req.ai_config,
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Suggest generation failed: {_safe_error_text(err, 'LLM suggest failed')}")

    return {"success": True, "suggestions": suggestions}


@router.post("/discover-gaps")
async def discover_gaps(req: DiscoverGapsRequest):
    try:
        requirement_ids = llm_service.extract_target_requirement_ids(
            module_name=req.module_name,
            user_input=req.user_input or "",
            requirement_map_json=json.dumps(req.requirement_map or {}, ensure_ascii=False),
            project_state_json=json.dumps(req.project_state or {}, ensure_ascii=False),
            completed_jira_ids_json=json.dumps(req.completed_jira_ids or [], ensure_ascii=False),
            ai_config=req.ai_config,
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Gap discovery failed: {_safe_error_text(err, 'LLM gap discovery failed')}")

    return {"success": True, "requirement_ids": requirement_ids}


@router.post("/chunks-by-ids")
async def chunks_by_ids(req: ChunksByIdsRequest):
    try:
        chunks = rag_service.get_chunks_by_ids(
            project_id=req.project_id,
            requirement_ids=req.requirement_ids,
            top_k_per_id=int(req.top_k_per_id or 2),
        )
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Targeted retrieval failed: {_safe_error_text(err, 'RAG targeted retrieval failed')}")

    return {"success": True, "chunks": chunks}


@router.post("/standup-summary")
async def standup_summary(req: StandupSummaryRequest):
    try:
        summary = llm_service.summarize_standup(context=req.prompt, ai_config=req.ai_config)
        return {"success": True, "summary": summary}
    except Exception as err:
        raise HTTPException(status_code=502, detail=f"Standup summary failed: {_safe_error_text(err, 'LLM standup summarization failed')}")
