from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.manual_bridge_service import manual_bridge_service


router = APIRouter()


class ResolveRequest(BaseModel):
    responseText: str


class RejectRequest(BaseModel):
    error: str


@router.get("/requests")
async def list_requests(status: Optional[str] = None, limit: int = 100):
    return {
        "success": True,
        "data": manual_bridge_service.list_requests(status=status, limit=limit),
    }


@router.get("/requests/{request_id}")
async def get_request(request_id: str):
    item = manual_bridge_service.get_request(request_id)
    if not item:
        raise HTTPException(status_code=404, detail="Manual bridge request not found")
    return {"success": True, "data": item}


@router.post("/requests/{request_id}/resolve")
async def resolve_request(request_id: str, body: ResolveRequest):
    try:
        item = manual_bridge_service.resolve_request(request_id, body.responseText)
        return {"success": True, "data": item}
    except KeyError:
        raise HTTPException(status_code=404, detail="Manual bridge request not found")


@router.post("/requests/{request_id}/reject")
async def reject_request(request_id: str, body: RejectRequest):
    try:
        item = manual_bridge_service.reject_request(request_id, body.error)
        return {"success": True, "data": item}
    except KeyError:
        raise HTTPException(status_code=404, detail="Manual bridge request not found")


@router.get("/stats")
async def get_stats():
    return {"success": True, "data": manual_bridge_service.stats()}
