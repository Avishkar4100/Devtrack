import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from services.llm_service import LLMService

router = APIRouter()
llm_service = LLMService()
logger = logging.getLogger(__name__)


def _safe_error_text(err: Exception, fallback: str) -> str:
    text = str(err or '').strip()
    if not text:
        return fallback
    return text[:260] if len(text) > 260 else text


class JiraIssueSnapshot(BaseModel):
    key: str
    summary: str = ''
    status: str = ''
    priority: str = ''
    type: str = ''


class JiraSummaryRequest(BaseModel):
    project_key: str
    issues: List[JiraIssueSnapshot]
    ai_config: Optional[Dict[str, Any]] = None


@router.post('/summarize')
async def summarize_jira(req: JiraSummaryRequest) -> Dict[str, Any]:
    try:
        result = llm_service.summarize_jira_project(
            project_key=req.project_key,
            issues=[i.model_dump() for i in req.issues],
            ai_config=req.ai_config,
        )
        meta = llm_service.get_last_call_meta()
        return {'success': True, 'data': result, 'meta': meta}
    except Exception as err:
        logger.error('Jira summarization failed for %s: %s', req.project_key, err)
        raise HTTPException(
            status_code=502,
            detail=f"Jira summarization failed: {_safe_error_text(err, 'LLM summarization request failed')}",
        )
