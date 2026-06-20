import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from services.llm_service import LLMService

router = APIRouter()
llm_service = LLMService()
logger = logging.getLogger(__name__)


def _safe_error_text(err: Exception, fallback: str) -> str:
    text = str(err or '').strip()
    if not text:
        return fallback
    return text[:260] if len(text) > 260 else text


class ChangedFile(BaseModel):
    filename: str
    status: str
    patch: Optional[str] = ""


class StoryInput(BaseModel):
    id: str
    title: str
    acceptanceCriteria: List[str]


class AnalyzeRequest(BaseModel):
    project_id: str
    changed_files: List[ChangedFile]
    stories: List[StoryInput]
    commit_sha: str
    commit_message: str
    ai_config: Optional[Dict[str, Any]] = None


@router.post("/analyze")
async def analyze_code(req: AnalyzeRequest):
    """Analyze changed files against story acceptance criteria using LLM."""
    try:
        results = []

        for story in req.stories:
            # Compile code evidence from changed files
            code_snippets = []
            for f in req.changed_files:
                if f.patch:
                    code_snippets.append(f"File: {f.filename}\n{f.patch[:2000]}")

            if not code_snippets:
                results.append({
                    "storyId": story.id,
                    "status": "not_started",
                    "evidence": [],
                })
                continue

            combined_code = "\n\n---\n\n".join(code_snippets[:5])  # limit context

            try:
                result = llm_service.validate_code_against_story(
                    story_title=story.title,
                    acceptance_criteria=story.acceptanceCriteria,
                    code_diff=combined_code,
                    commit_message=req.commit_message,
                    ai_config=req.ai_config,
                )
                results.append({
                    "storyId": story.id,
                    "status": result["status"],
                    "evidence": result.get("evidence", []),
                    "reasoning": result.get("reasoning", ""),
                    "meta": llm_service.get_last_call_meta(),
                })
            except Exception as story_err:
                logger.error("Code analysis failed for story %s: %s", story.id, story_err)
                results.append({
                    "storyId": story.id,
                    "status": "unknown",
                    "evidence": [],
                    "reasoning": f"Validation failed for this story: {str(story_err)}",
                })

        return {"success": True, "results": results}
    except Exception as err:
        logger.error("GitHub analysis request failed: %s", err)
        raise HTTPException(status_code=502, detail=f"Code analysis failed: {_safe_error_text(err, 'LLM analysis request failed')}")
