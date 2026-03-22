from typing import List, Dict, Any
from fastapi import APIRouter
from pydantic import BaseModel
from services.llm_service import LLMService

router = APIRouter()
llm_service = LLMService()


class JiraIssueSnapshot(BaseModel):
    key: str
    summary: str = ''
    status: str = ''
    priority: str = ''
    type: str = ''


class JiraSummaryRequest(BaseModel):
    project_key: str
    issues: List[JiraIssueSnapshot]


@router.post('/summarize')
async def summarize_jira(req: JiraSummaryRequest) -> Dict[str, Any]:
    result = llm_service.summarize_jira_project(
        project_key=req.project_key,
        issues=[i.model_dump() for i in req.issues],
    )
    return {'success': True, 'data': result}
